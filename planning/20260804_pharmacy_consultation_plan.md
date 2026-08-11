# Community Pharmacy Consultation Module — Implementation Plan

Status: **IMPLEMENTED** (shipped 2026-08-04; decisions §11 all accepted — go-ahead "continue") · Date: 2026-08-04 · CareHub only
Predecessor: `planning/20260803_skincare_consultation_plan.md` (shipped 2026-08-03, commit `993d86f`)

---

## 1. Scope & business-type scoping

Feature for the **`pharmacy`** business type only, used by the pharmacist.

- Nav key `consultation` (already exists in presets: Owner/Manager/Pharmacist/Therapist/Doctor) is
  **reused** for both skincare and pharmacy — one route, one module shell that dispatches by
  `brand.business_type`. This is the "one system, not two" the spec asks for.
- Gate change in `getNavItems()`: visible when `businessType === 'skincare' || businessType === 'pharmacy'`.
  Hospital, dental, optical, wellness, wholesale, manufacturer_importer are excluded automatically
  (no `clinic` type exists in the app — Register.jsx defines the full list).
- Staff.jsx role editor checkbox: show `consultation` only for skincare/pharmacy businesses.
- `getPerms` presets unchanged — no role preset edits needed.

## 2. Data model — ONE shared table (per spec §6)

The spec instructs: *"add a consultations table with a business_type / consultation_type field so both
skincare and pharmacy forms can share the underlying schema."* The skincare migration
`20260803_skincare_consultations.sql` is **NOT YET APPLIED to production**, so it is free to reshape:

**Action: rename + generalize** → delete `20260803_skincare_consultations.sql`, create
`apps/carehub/sql/20260803_consultation_forms.sql`:

```sql
create table if not exists public.consultation_forms (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  client_id uuid not null references clients(id),
  client_name text not null default '',
  consultation_date date not null default current_date,
  consultation_type text not null default 'skincare',   -- skincare | pharmacy
  provider_name text not null default '',               -- therapist (skincare) / pharmacist (pharmacy)
  recommended_products jsonb not null default '[]',     -- [{id, name, price, qty, source}] source: recommended | dispensed
  sale_id uuid,                                         -- set when the visit logged a sale (fee + dispensed products)
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists consultation_forms_business_date_idx on public.consultation_forms (business_id, consultation_date desc);
create index if not exists consultation_forms_client_idx on public.consultation_forms (client_id);
create index if not exists consultation_forms_business_type_idx on public.consultation_forms (business_id, consultation_type);
alter table public.consultation_forms enable row level security;
drop policy if exists "consultation forms of own business" on public.consultation_forms;
create policy "consultation forms of own business" on public.consultation_forms
  for all using (business_id in (select current_business_ids()) or is_platform_admin())
  with check (business_id in (select current_business_ids()) or is_platform_admin());
```

Changes vs the skincare-only draft (all safe — unapplied):
- `skincare_consultations` → `consultation_forms`; `consultation_type` column added.
- `therapist_name` → `provider_name` (generic).
- `skin_type` column **dropped** — it's skincare-specific; lives in `data.assessment.skin_type`
  (already duplicated there). List views read it from `data`.
- `sale_id` added for exact consultation→sale traceability (no FK — same convention as the rest of
  the schema; plain uuid link).
- Policy renamed `"consultation forms of own business"` (the old name never existed in prod).

## 3. Service layer — `src/services/supabase.js` (edit the CONSULTATIONS block)

| Function | Change |
|---|---|
| `getConsultations(businessId, {clientId, query, from, to, type})` | table → `consultation_forms`; new `type` filter (`consultation_type=eq.`) |
| `getConsultationsByClient(clientId)` | table → `consultation_forms` |
| `getLatestConsultation(clientId)` | unchanged (shared table — POS tagging works for both types automatically) |
| `addConsultation(data)` | table → `consultation_forms` |
| `updateConsultation(id, data)` | table → `consultation_forms` |

POS.jsx `tagItems()` needs **zero changes** — `getLatestConsultation` now returns pharmacy or skincare
visits; ids from `recommended_products` tag `recommended` vs `walk-in` as before.

## 4. Module structure — `modules/consultation/`

```
consultation/
  Consultation.jsx        ← shared shell (list, stats, filters, detail, form dispatch)
  ConsultationForm.jsx    ← skincare form (existing, small column renames)
  PharmacyForm.jsx        ← NEW — the pharmacy form (§5)
  SignaturePad.jsx        ← reused as-is
  consultationPrint.js    ← extract shared helpers; add printPharmacyConsultation()
```

- **Consultation.jsx** gains: business-type-aware "New" button (skincare → ConsultationForm,
  pharmacy → PharmacyForm); list card adapts by type (skincare: skin-type pill from `data`; pharmacy:
  sub-type pills from `data.type_of_consultation`); detail modal renders per-type section groups;
  consultation-type filter (All/Skincare/Pharmacy) added to the existing search + date filters.
- **New-visit pre-select**: read `useSearchParams().client` once; prefill form client (also lets
  Clients.jsx offer "Consultation" inside the client's file per spec §"inside the client's file").

## 5. Pharmacy form fields — `PharmacyForm.jsx`

Props `{ brand, products, staffName, initialClient, onSaved, onCancel }`. Client picker + quick-add
reused from the skincare form. All sections in `data`:

| # | Section (Card) | Fields |
|---|---|---|
| 3A | Client Information | dob, age, phone, email, address, occupation, **weight**, **blood_group** (Sel: A+/A-/B+/B-/AB+/AB-/O+/O-/Unknown) |
| — | **Type of Consultation** (first step, chips, multi-select) | New Symptom / OTC Request · Medication Therapy Review · Chronic Disease Monitoring · Other (+ text). Sections 3B/3C render only when their type is selected. |
| 3B | Presenting Complaint (OTC) | symptom (textarea), duration, severity (Pills: Mild/Moderate/Severe), associated symptoms, self-treatment tried, red-flag chips (Fever >3 days, Difficulty breathing, Chest pain, Severe vomiting/diarrhea, Blood in stool/urine/vomit, Pregnant, Child under 2 years, None of the above) |
| 3C | Medication Therapy Review | repeatable rows (Drug Name, Dose, Frequency, Prescriber, Indication, Start Date) with per-row Adherence Pills (Always/Sometimes Misses/Often Misses) + add/remove; Issues chips (Side effects, Missed doses, Ran out early, Cost/affordability, Confused about instructions, None); Interactions/Duplication check textarea |
| 3D | Medical History | chips (Diabetes, High BP, Asthma, Thyroid, Epilepsy, Kidney, Liver, Heart, Peptic Ulcer, None, Other+text) |
| 3E | Allergies | Drug allergies (drug + reaction), Food, Other + **"None on file"** toggle |
| 3F | For Female Clients | Pregnant/breastfeeding Yes/No |
| 3G | Vitals (optional) | BP, Blood glucose (RBS/FBS), Temperature, Pulse |
| 3H | Assessment & Outcome | assessment textarea; Recommendation type (Sel: OTC Product Recommended / Prescription Dispensed / Non-Drug Advice Only / Referred to Doctor or Hospital); **Products recommended/dispensed** (inventory picker, multi-select + qty — see §6); Counseling points textarea; Referral Yes/No + reason; Follow-up Yes/No + date |
| Consent | statement + signature pad + date (reuse SignaturePad) |
| Pharmacist (staff-only) | name (prefill `staffName`), **PCN license number**, signature pad, date |

`recommended_products` column = `[{id, name, price, qty, source}]`; `source` = `dispensed` for items
included in the sale, `recommended` for advice-only picks (so POS history pills stay truthful).

## 6. Fee toggle & sale logging (spec §2, §6)

New card in the form — **"Charges & Dispensing"**:

- Toggle **"Charge for this consultation"** (default OFF — fee is optional, never forced).
- When ON: Sel of `Services`-category products (e.g. staff-created "Consultation Fee ₦2,000").
  If none exist → hint: "Create a Services product named 'Consultation Fee' in Inventory" (no block).
- Dispensed products from 3H are always included as sale line items **when the toggle is ON**.
- On save, when toggle ON: build items = [fee product if selected] + dispensed products (qty × price),
  `addSale({ txn_no: genId('TXN'), client_id, client_name, items: JSON.stringify(items with source:'dispensed'),
  subtotal, discount: 0, total, payment_method: 'Cash', amount_paid: total, balance: 0, is_credit: false,
  is_on_hold: false, business_id })` → then `addConsultation({... sale_id: sale.id })`.
  Same `addSale` path as POS → stock behaviour is identical to a POS sale (whatever the platform does
  for POS applies here; no new mechanism).
- Toggle OFF + no products → consultation only, no sale, no debt. Fee failure does not silently drop:
  sale error aborts save with a toast.

## 7. PDF export — `consultationPrint.js`

Extract the shared primitives (`esc, t, row, section, sig, openPrintWindow`) from the skincare
template into the same file (no new abstraction layer — one file, two exported printers):

- `printConsultation(c, brand)` — existing skincare template, updated for `provider_name`.
- `printPharmacyConsultation(c, brand)` — pharmacy branding (logo + name header from `brand`, same
  window.open + print pattern): Client info (+ weight, blood group), Type badges, Presenting
  complaint (incl. red flags), Medication table (repeatable rows + adherence + issues), Medical
  history, Allergies, Vitals, Assessment + recommendation type, Products dispensed/recommended,
  Counseling, Referral/follow-up, Consent + dual signatures (client / pharmacist + PCN no), footer.

## 8. Client history & traceability — `Clients.jsx`

- **Source pills on sales items**: extend the existing `rec` pill — `source === 'dispensed'` →
  blue "dispensed" pill; `'recommended'` → purple `rec` (existing); `walk-in` → no pill.
- **"Currently on" strip** at the top of the history block: merge latest consultation's
  `recommended_products` + the last 30 days of sales items (any source), dedupe by name, render as
  chips with source pill + date ("Drug X — dispensed 01 Aug"). Catch duplicate/interaction therapy at
  a glance.
- **Timeline tab** (new HISTORY_TAB): merges `getSalesByClient` + `getConsultationsByClient`, sorted
  by date desc, one row per event (txn no / consultation, type badge, source pills, product summary).
- **Filters row** (applies to Timeline + Consultations tabs): date from/to, source (All /
  Recommended / Dispensed / Walk-in), product text, consultation type (All/Skincare/Pharmacy).
- **Export**: extend `exportHistoryCsv` — Timeline export (columns: date, event, type, source,
  products, total), consultations export gains `Type` column (skincare/pharmacy + sub-type from data).
- **"New Consultation" button** in the client detail header → `navigate('/dashboard/consultation?client=<id>')`
  (module reads the param; see §4).

## 9. Files touched

| File | Change |
|---|---|
| `apps/carehub/sql/20260803_consultation_forms.sql` | NEW (replaces unapplied `20260803_skincare_consultations.sql`, which is deleted) |
| `apps/carehub/src/services/supabase.js` | table renames + `type` filter |
| `apps/carehub/src/modules/consultation/Consultation.jsx` | type-aware list/detail, type filter, search-param client prefill |
| `apps/carehub/src/modules/consultation/ConsultationForm.jsx` | column renames (`provider_name`), skin_type from `data` |
| `apps/carehub/src/modules/consultation/PharmacyForm.jsx` | NEW — the pharmacy form |
| `apps/carehub/src/modules/consultation/consultationPrint.js` | shared helpers + pharmacy template |
| `apps/carehub/src/modules/clients/Clients.jsx` | pills, current-on strip, timeline tab, filters, export, new-visit button |
| `apps/carehub/src/lib/permissions.js` | gate: skincare **or** pharmacy |
| `apps/carehub/src/modules/staff/Staff.jsx` | checkbox gate: skincare or pharmacy |
| `planning/` | this plan, REMEDIATION-STATUS (migration rename), CODE_AUDIT note |

## 10. Quality standard & test plan

- Loading/error/empty states, responsive grid, accessibility (aria-pressed on chips/pills, labels),
  console.error on failures, toasts on success/failure (module conventions).
- `npm run build` clean.
- Manual: pharmacy login sees Consultations; skincare unchanged; hospital/wholesale/dental don't.
- Form: type chips show/hide 3B/3C; fee toggle ON logs sale with dispensed products + `sale_id`;
  OFF logs consultation only; PDF shows logo + all sections + both signatures.
- History: sale items show dispensed/rec pills; "currently on" strip correct; timeline merges
  purchases + visits; filters + CSV export work.
- Migration idempotent; `20260803_skincare_consultations.sql` must be **replaced** in Blocked-on-you
  #5 docs (never apply the old one).

## 11. Decisions needing your call (recommendations in brackets)

1. **Migration rename** — generalize the unapplied skincare table to `consultation_forms`
   (spec §6 asks for shared schema). [Recommended: yes — do exactly this; do NOT apply the old file.]
2. **Fee behaviour** — fee product + dispensed products are sold together only when the toggle is ON;
   toggle OFF = consultation record only, even if products were dispensed. [Recommended: as spec —
   fee optional, products charged when the pharmacy charges.]
3. **Timeline** — new combined Timeline tab vs separate tabs only. [Recommended: Timeline tab +
   "Currently on" strip — matches spec §5 "full timeline across every visit".]

---

## 12. IMPLEMENTED — 2026-08-04 (clean `vite build`)

All sections §1–§8 shipped as planned; decisions §11 all accepted per recommendation (go-ahead:
"continue"). Notes for the record:

- **Shared schema**: `20260803_skincare_consultations.sql` deleted (never applied to prod);
  `apps/carehub/sql/20260803_consultation_forms.sql` created — `consultation_type` ('skincare' |
  'pharmacy'), `provider_name`, `recommended_products` jsonb (per-product `source`:
  `recommended` | `dispensed`), `sale_id`; 3 indexes; RLS `"consultation forms of own business"`;
  idempotent. **Apply this file — never the deleted one** (Blocked-on-you #5 updated).
- **Gates**: `permissions.js` `getNavItems` + Staff.jsx role-editor checkbox now allow
  `skincare || pharmacy`. Pharmacist/Manager/Owner/Therapist presets already carried the
  `consultation` nav key.
- **Fee path**: PharmacyForm `charge` toggle (default OFF). ON → `addSale` (same shape as POS:
  `genId('TXN')`, Cash, full amount, `client_id`) with fee service product + dispensed products
  (`source:'dispensed'`), then `addConsultation({ sale_id })`. OFF → consultation record only.
  POS.jsx `tagItems()` untouched — shared `getLatestConsultation` tags both types.
- **Traceability**: Clients.jsx — source pills (`rec` purple / `dispensed` blue), "Currently on"
  strip (latest consultation + last-30-days sales, deduped by name), new Timeline tab (sales +
  consultations merged, date desc), filters row (date from/to, source, product, consultation type),
  CSV export per tab (consultations now include Type + Provider columns), "New Consultation" button
  → `/dashboard/consultation?client=<id>` (module deep-link prefill, param cleared after open).
- **Bug fixed while wiring (pre-existing)**: PostgREST `return=representation` returns an **array**
  for POST, so `addClient`/`addSale` results were arrays — quick-add set `client` to the array and
  `sale_id` never linked. Unwrapped `(...)[0]` in PharmacyForm AND the existing skincare
  ConsultationForm quick-add.
- **One build error fixed**: stray `\'` inside a JSX double-quoted attribute in PharmacyForm §2.
- Migration remains unapplied in prod (user action, Supabase SQL editor) — same "Blocked on you"
  status as the other three drafts.
