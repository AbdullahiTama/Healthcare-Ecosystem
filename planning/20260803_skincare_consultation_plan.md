# CareHub — Skincare & Aesthetic Consultation Module — Implementation Plan

Date: 2026-08-02 (plan review) — status: **AWAITING APPROVAL — NOT IMPLEMENTED**
Spec: "CAREHUB — FEATURE SPEC: Skincare & Aesthetic Consultation Module"

---

## 1. Scope & Understanding

**What exists today (verified in code):**
- `consultation` is already a first-class route key: it sits in `lib/permissions.js` role presets (Owner, Manager, Pharmacist, Therapist, Doctor), in `ALL_NAV_DEFAULT`, and in `BusinessDashboard.jsx`'s nested routes (`/consultation` → `ConsultationRouter`). `ConsultationRouter.jsx` is a placeholder ("coming in the next update").
- Client database exists (`clients` table: full_name, phone, email, address, date_of_birth, gender, notes, total_spend, visit_count, business_id) with a per-client history modal in `Clients.jsx` (tabs: Sales / Appointments / Debts) fed by `getSalesByClient` / `getAppointmentsByClient` / `getDebtsByClient`.
- POS (`POS.jsx`) links sales to clients by name-match (`resolveClientId`), stores line items as `items` JSONB (`{id, name, qty, price, ...}`), products have a `Services` category that skips stock deduction.
- PDF pattern: `window.open()` + `document.write()` + `window.print()` (Demand.jsx `printRequisition`, line 161–199); brand name only, no logo today. `businesses.logo_url` is now editable via Settings.
- `Consultations` route is currently visible to every non-hospital/enterprise business type — **must be restricted to `skincare`**.

**Out of scope (explicit):**
- CareFind-side consultation booking (separate work; appointments module already exists).
- Offline queuing for consultations (form is complex; POS offline path simply tags everything `walk-in`).
- Automatic "Consultation" POS line item. The consultation fee is a **data** item: staff create a `Services`-category product named "Consultation" (no code). *(Optional, not in v1: a "Charge consultation" shortcut button.)*

---

## 2. Data Model — NEW migration `apps/carehub/sql/20260803_skincare_consultations.sql`

New table `consultations` (following the app's existing hybrid pattern — core columns for filtering + `data` jsonb for the full form, same as `roles.permissions` and `sales.items`):

```sql
create table public.consultations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  client_id uuid not null references clients(id),
  client_name text not null default '',      -- snapshot for list/PDF
  consultation_date date not null default current_date,
  therapist_name text not null default '',
  skin_type text,                            -- quick-glance denorm
  recommended_products jsonb not null default '[]',  -- [{id, name}] for POS tagging
  data jsonb not null default '{}',          -- full form, sections below
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.consultations enable row level security;

-- Same shape as phase2_rls_pilot.sql (helpers already live in prod):
create policy "consultations of own business"
  on public.consultations for all
  using (business_id in (select current_business_ids()) or is_platform_admin())
  with check (business_id in (select current_business_ids()) or is_platform_admin());
```

**`data` jsonb sections** (mirror the paper form 1:1):

| Section | Fields |
|---|---|
| `client_info` | full_name, dob, age, phone, email, address, occupation, date |
| `emergency_contact` | name, relationship, phone |
| `skin_concerns` | selected[] (15 preset options + Other), other (text) |
| `skin_history` | skin_type (Dry/Oily/Combination/Normal/Sensitive), symptoms[] (Breakouts/Itching/Redness/Burning/Peeling/None), had_facial (yes/no), facial_date, past_treatments[] (Chemical Peel/Microneedling/Dermaplaning/Microdermabrasion/Laser/Acne Extraction/Other), other_treatment |
| `routine` | cleanser, toner, serum, moisturizer, sunscreen, exfoliant, other (free text) |
| `medical_history` | selected[] (Diabetes/High BP/Asthma/Thyroid Disorder/Epilepsy/Autoimmune Disorder/Eczema/Psoriasis/Active Cold Sores/Keloid Scarring/None/Other), other |
| `allergies` | selected[] (Skincare Products/Fragrances/Latex/Aspirin/Nuts/Medications/Foods), specify |
| `lifestyle` | water, sleep, stress, smoker (yes/no), sunscreen_frequency |
| `female` | pregnant (yes/no), contraceptives (yes/no) — only rendered when relevant, always storable |
| `consent` | agreed (bool), signature (data URL from canvas), date |
| `assessment` | skin_type, skin_condition, fitzpatrick (I–VI), treatment_recommended, products_recommended[] (from brand product list), homecare_plan, therapist_name, therapist_signature (data URL) |

Multi-select values stored as arrays of strings (keeps filtering/PDF simple, avoids a 15-column table).

---

## 3. Service Layer — `apps/carehub/src/services/supabase.js` (append, same sbFetch patterns)

```js
// CONSULTATIONS
getConsultations(businessId, { clientId, query, from, to } = {})   // server-side filters: client_id eq, full_name ilike via join? no — client_name ilike.*q*, consultation_date gte/lte
getConsultationsByClient(clientId)                                  // order=consultation_date.desc
getLatestConsultation(clientId)                                     // first of getConsultationsByClient (for POS tagging)
addConsultation(data)                                               // POST
updateConsultation(id, data)                                        // PATCH
```

Client-name search: since `consultations.client_name` is a snapshot, filter on it + `client_id` when known. For the module's client picker, reuse existing `searchClients`/`getClients`.

---

## 4. Consultation Module — replace `modules/consultation/ConsultationRouter.jsx` with `Consultation.jsx`

Route stays `/consultation` (already guarded + titled). New component receives `{ brand, products, role, perms }` via `pageProps`.

**Structure (single file + 2 small siblings, matching existing module conventions):**

- `modules/consultation/Consultation.jsx` — main screen
  - StatCards (Total Consultations, This Month, Unique Clients)
  - Search input (client name) + date-range filter; server-side query via `getConsultations`
  - List: Card per consultation — client name, date, therapist, skin type pill, recommended-product count → click opens detail
  - `+ New Consultation` button
- `modules/consultation/ConsultationForm.jsx` — the digitized form
  - Client step: search existing clients (`searchClients`) or "add new client quickly" (reuses `addClient` — name + phone required, matching Clients.jsx rules)
  - Multi-section form rendered as stacked section cards (mobile-friendly, scroll-based — same pattern as the Add Staff/Booking forms):
    1. Client Information (pre-filled from client record)
    2. Emergency Contact
    3. Skin Concerns (checkbox chips — custom multi-select, consistent with existing chip styling)
    4. Skin History (single-select pills + multi-select chips + had_facial Yes/No + date)
    5. Current Skincare Routine (5 text inputs + Other)
    6. Medical History (chips + Other text)
    7. Allergies (chips + specify text)
    8. Lifestyle (4 inputs + smoker toggle)
    9. Female Clients (pregnant/contraceptives toggles — shown collapsed under a heading)
    10. Consent (statement text + **e-signature canvas** + date)
    11. Therapist Assessment (staff-only section — always part of form; therapist name defaults to current staff member, skin type, skin condition, **Fitzpatrick selector I–VI**, treatment recommended, **products recommended** — multi-select from `products` (Services + retail items), homecare plan textarea, therapist signature canvas)
  - Save → `addConsultation` (builds `data` jsonb + denormalized `client_name`, `consultation_date`, `therapist_name`, `skin_type`, `recommended_products`) → toast → open detail with "Print"
  - Loading / error / empty states throughout; validation: client + consent agreed required (soft warning, not blocking save)
- `modules/consultation/SignaturePad.jsx` — small canvas component (pointer/touch drawing, Clear button, `getDataUrl()`); renders placeholder text "Sign here — use finger or mouse"
- `modules/consultation/consultationPrint.js` — PDF export util (see §5)

Detail view (in main file): read-only render of every section, with:
- `Print / Export PDF` button
- `New visit for this client` button (pre-selects the client in a fresh form)
- Recommended products shown with "tagged in POS" hint

---

## 5. PDF Export — `consultationPrint.js`

Reuse the Demand.jsx pattern (`window.open('', '_blank', 'width=760,height=600')` + `document.write` + auto `window.print()`), upgraded:

- **Header:** `brand.logo_url` (img tag, 44px, hide on error) + business name + address/phone from brand; "Skin & Aesthetic Consultation Form" title
- Client info block; all sections as labelled tables/rows; multi-selects joined as comma lists; recommended products as a table (product / recommended by / date); signatures rendered as `<img src="dataUrl">` with name + date under each
- Footer: "Generated by CareHub · {date}" — same as requisition footer
- Printed per consultation (per visit), triggered from detail view. Escapes all user text (existing pattern does not escape — we add a small `esc()` helper; security).

---

## 6. POS Source Tagging — `modules/pos/POS.jsx` (contained change)

- In `charge()` and `chargeCredit()`: after `resolveClientId(clientName)`:
  ```js
  const latest = clientId ? await getLatestConsultation(clientId).catch(() => null) : null
  const recIds = new Set((latest?.recommended_products || []).map(p => p.id))
  const items = cart.map(i => ({ ...i, source: recIds.has(i.id) ? 'recommended' : 'walk-in' }))
  ```
  and send `items: JSON.stringify(items)` instead of the raw cart. Never throws — failures fall back to `walk-in`.
- **No schema change**: `source` rides inside the existing `items` jsonb array (offline-queue payloads unaffected — offline sales are all `walk-in` by design).
- `Clients.jsx` sales-history tab: render a small Pill per item — `Recommended` (teal) / `Walk-in` (gray) — so staff see "already using Product X (recommended from March consultation)" vs "bought on their own" at a glance.

---

## 7. Client History — `modules/clients/Clients.jsx`

- Add `['consultations', Clipboard, 'Consultations']` to `HISTORY_TABS`; fetch via `getConsultationsByClient`; render cards: date, therapist, skin-type pill, recommended products line (from `recommended_products`), click → jump to consultation detail (needs `setSelectedConsultation` lifted or simply rendered inline; simplest: render detail inline in a nested modal or navigate to `/consultation?c=<id>` — pick the inline modal to avoid route coupling).
- **Filters row** (above tabs, visible for sales tab): date from/to, source-tag (`All / Recommended / Walk-in`), product name text filter — client-side filtering of the loaded history (history lists are per-client, small).
- **Export**: "Export history" button → CSV of the currently filtered history (same blob-download pattern as `exportCsv` in Clients.jsx), filename `CareHub_<client>_history.csv`.
- The existing empty-state copy for each tab is extended for consultations.

---

## 8. Permissions / Nav Scoping (skincare-only)

- `lib/permissions.js` `getNavItems()`: after selecting `all`, apply type gate —
  ```js
  if (businessType !== 'skincare') all = all.filter(i => i[0] !== 'consultation')
  ```
  (keeps role presets untouched; `ALL_NAV_DEFAULT` keeps the entry so skincare still sees it; `BusinessDashboard`'s `guard()` then blocks direct URL access for other types automatically).
- `modules/staff/Staff.jsx` role editor: hide the `consultation` checkbox unless the business is skincare (filter `ALL_NAV_UNION` for the checkbox list only, not for the custom-role nav array — a non-skincare business simply can't assign it).
- No changes to `BusinessDashboard.jsx` routes (route + guard already exist).

---

## 9. Quality Checklist (AGENTS.md standard)

- Loading / error / empty states in list, form save, detail, history tab
- Mobile-friendly form (stacked cards, touch signature pad)
- Accessibility: labels, `aria-pressed` on chips (existing pattern), canvas has accessible label
- Logging: `console.error` on failed saves/loads (existing pattern); toasts on all user actions
- Security: all user text escaped in PDF output (`esc()` helper); RLS on the new table from day one; signature data is stored locally in the business's own row (no external service)

---

## 10. Test Plan

1. `npm run build` in `apps/carehub` (clean) after all changes.
2. **Nav scoping:** skincare business sees `Consultations`; pharmacy / hospital / wholesale logins do NOT (sidebar + direct URL `/consultation` redirects to dashboard).
3. **Form:** create a client → fill every section (chips, toggles, signature pads) → save → re-open → all values persist.
4. **PDF:** print from detail — logo + business name in header, all sections present, signatures render, auto print dialog opens.
5. **POS tagging:** client with a consultation recommending Product A charges cart containing A + B → sale items show A `recommended`, B `walk-in` in Clients → Sales tab.
6. **History:** consultation tab shows past visits; date/source/product filters work; CSV export downloads filtered rows.
7. **Re-run safety:** migration is idempotent-ish (plain `create table` + policy; guarded by `if not exists` where applicable).

---

## 11. Docs to update after implementation

- `planning/REMEDIATION-STATUS.md` (session log entry) — or a new `planning/20260803_skincare_consultation_plan.md` (this file) updated to "DONE"
- `planning/CODE_AUDIT.md` — no new findings expected; note `consultation` now skincare-gated
- Commit: single conventional-commit message, e.g. `feat(carehub): skincare consultation module with PDF export, POS source tagging, client history`

---

## 12. Files touched (summary)

| File | Change |
|---|---|
| `apps/carehub/sql/20260803_skincare_consultations.sql` | NEW — table + RLS |
| `apps/carehub/src/services/supabase.js` | +5 consultation functions |
| `apps/carehub/src/modules/consultation/ConsultationRouter.jsx` | REPLACED by Consultation.jsx |
| `apps/carehub/src/modules/consultation/ConsultationForm.jsx` | NEW |
| `apps/carehub/src/modules/consultation/SignaturePad.jsx` | NEW |
| `apps/carehub/src/modules/consultation/consultationPrint.js` | NEW |
| `apps/carehub/src/modules/pos/POS.jsx` | source-tag line items (2 functions) |
| `apps/carehub/src/modules/clients/Clients.jsx` | consultations tab, filters, CSV export |
| `apps/carehub/src/lib/permissions.js` | skincare-only gate in `getNavItems` |
| `apps/carehub/src/modules/staff/Staff.jsx` | hide consultation checkbox for non-skincare |
| `apps/carehub/src/pages/dashboard/BusinessDashboard.jsx` | import Consultation; `staffName` in pageProps |
| `apps/carehub/src/pages/dashboard/hospital/Doctor.jsx` | `addConsultation` → `addHospitalConsultation` |
| `planning/` | plan file (this), session-log update |

---

## 13. IMPLEMENTED — 2026-08-01 (deviations from this plan, all verified by a clean `vite build`)

1. **Dedicated table `skincare_consultations`, not `consultations`.** The plan's
   §2 assumed the table was free. It isn't: `consultations` exists in production
   and belongs to the hospital clinical workflow (patient_id-linked,
   hpi/examination/disposition shape, RLS from `phase2_rls_pilot.sql`). A
   `create table` there would no-op and every skincare insert would fail. The
   migration now creates `skincare_consultations` (same columns, policy name
   `"skincare consultations of own business"`), leaving the hospital table
   untouched. The plan's `if not exists` re-run-safety claim now also covers
   the live hospital table, which it could not before.
2. **`addConsultation` export renamed for the hospital.** supabase.js exported
   `addConsultation` twice (line 190 skincare / line 261 hospital) — a
   duplicate-named export that would fail the build. The hospital one is now
   `addHospitalConsultation` (Doctor.jsx updated); the skincare module keeps
   the clean name.
3. **Everything else shipped as planned**: 11-section form (client picker +
   quick-add, chips/pills/yes-no, consent toggle, dual signature pads),
   Consultation.jsx list/detail module (search, date filters, stat cards,
   print via `printConsultation`, "New visit" pre-selects the client),
   POS source tagging (`getLatestConsultation` → `source: recommended|walk-in`,
   fail-safe to walk-in), Clients.jsx consultations history tab + per-tab CSV
   export + `rec` pill on sale items, skincare-only nav/route/checkbox gates,
   `staffName` prop wired from `auth.staff.full_name`.
4. **Untested (needs the migration applied + a live run)**: migration execution
   in the SQL editor, and manual test-plan §10 items 2–6.
