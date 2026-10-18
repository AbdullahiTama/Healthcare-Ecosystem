# Business-Type Taxonomy → Module Registry Reconciliation

**Date:** 2026-10-18
**Status:** approved direction (user: "okay lets go ahead"); executed natively in this session.
**Spec sources:** `apps/carehub/src/pages/landing/data/businessTypes.js` (notes explicitly "written against the real module and permission system"), `apps/carehub/src/config/constants.js` `BUSINESS_TYPES`, `apps/carehub/src/lib/permissions.js` registry.

---

## Problem

Commit `1ea3859` (Sep 2 2026) replaced the signup taxonomy in `config/constants.js` with 9 types — `pharmacy, hospital, clinic, laboratory, aesthetic, spa, cosmetics, haircare, other` — but never updated the module registry in `lib/permissions.js`, whose gates still only know the legacy 8 types (`skincare…wholesale`).

Verified consequences:

1. **Every business registered under a new type resolves to zero modules.** `getModulesForType()` returns `[]` → empty sidebar, blank guarded shell inside the dashboard, no wallet nav (wallet is gated by `ALL_TYPES`), even though the business wallet row exists and RLS would allow the read.
2. **The landing page's claims are currently false** for all 7 new types (e.g. clinics promised appointments + consultations; laboratories promised the lab bench; cosmetics promised POS/inventory/catalogue).
3. **Adjacent surfaces drift**: `Clients.jsx` `canConsult` hardcodes skincare+pharmacy; the ADR presentation trio (`AdrNav.js` / `adr/repositories` / `adr/formEngine`) knows only legacy ids; `roleTemplates.js` has no entries for new types.

No legacy behaviour is broken (their gates still match). The bug is latent because no new-type business has been registered yet.

---

## Locked decisions

Universal set = the 18 `ALL_TYPES` modules: `overview, dashboard, pos, inventory, mastercatalog, clients, expenses, debts, purchases, demand, carefind, locations, staff, wallet, reports, adr-reports, ecommerce, settings`.

| type | universal | +appointments | +consultation | clinical | ADR presentation | preset roles offered |
|---|---|---|---|---|---|---|
| pharmacy, hospital, skincare, dental, optical, wellness, manufacturer_importer, wholesale | ✔ | unchanged | unchanged | unchanged | unchanged | unchanged |
| **clinic** | ✔ | ✔ | ✔ | — | hospital | Owner, Manager, Receptionist, Doctor, Cashier |
| **laboratory** | ✔ | — | — | `lab` only | hospital | Owner, Manager, Lab Technician, Cashier |
| **aesthetic** | ✔ | ✔ | ✔ | — | skincare | Owner, Manager, Therapist, Receptionist, Cashier |
| **spa** | ✔ | ✔ | ✔ | — | skincare | Owner, Manager, Therapist, Receptionist, Cashier |
| **haircare** | ✔ | ✔ | ✔ | — | skincare | Owner, Manager, Therapist, Receptionist, Cashier |
| **cosmetics** | ✔ | — | — | — | skincare | Owner, Manager, Receptionist, Cashier |
| **other** | ✔ | — | — | — | community_pharmacy (fallback) | Owner, Manager, Receptionist, Cashier |
| unknown / `''` | ✔ (normalized to `other`) | — | — | — | fallback unchanged | other's list |

Anchors from the landing notes (the product's own claims):
- clinic: "Appointments, consultations, client records, staff scheduling and the services you actually bill for."
- laboratory: "Laboratory services and requests, results, client billing and the stock your consumables depend on."
- aesthetic/spa/haircare: "Appointments … and the products you retail alongside." (explicitly "appointment-driven" in the file comment, together with clinic)
- cosmetics: "Product catalogue, stock levels, counter sales, staff and customer history."
- other: "Sales, stock, staff, locations and reporting."

Additional pins:
- **clinic clients label** = `Patients` (mirrors hospital; `labelByType`).
- **clinic/laboratory ordering**: clinic gets its own `NAV_ORDER.clinic` (appointments/consultation directly after dashboard); laboratory reuses the hospital ordering family (its gate only lets the lab bench through from the clinical block, and `lab` sorts early).
- **Wallet policy unchanged**: wallet in every Owner nav for every type; staff roles exclude it by default, grantable per custom role (the `roles` table). RLS (`business_id IN current_business_ids()`) remains authoritative.
- **Unknown-type fallback**: a business_type the registry doesn't know (typo, empty string, future addition) resolves to the `other` set instead of a bricked app.

---

## Global constraints

- Legacy behaviour byte-identical: no legacy type gains or loses a module; `ALL_NAV_DEFAULT/HOSPITAL/ENTERPRISE` unchanged (counts 20/24/18).
- Registry stays the single source of truth; no hardcoded type lists added anywhere (Clients.jsx is moved ONTO the registry).
- ADR: one mapping only — `adr/repositories.getModuleTypeFromBusinessType`; `AdrNav` and `formEngine` consume it (no second/third maps).
- No new dependencies. No user-visible copy changes beyond additive labels for new types.
- Security: no new type receives clinical/enterprise modules (beyond `lab` for laboratory); nothing weakens the Owner-only wallet default.
- TDD: tests first (red), then implementation (green); full suite + lint + build before commit.

---

## Tasks

### Task 0 — recon (done)
- [x] Read README, project docs, permissions.js, constants.js, landing notes, Staff/Sidebar/BusinessDashboard/Clients, ADR trio, roleTemplates, ecommerceSegments, all affected tests.
- [x] Enumerated every consumer of business_type (grep sweep; geo/facilityDiscovery/landing copy are geo-display only, out of scope).

### Task 1 — registry core: `apps/carehub/src/lib/permissions.js`

Edits:

1. **Family constants** (≈ lines 213-217):
   - `ALL_TYPES` += `'clinic', 'laboratory', 'aesthetic', 'spa', 'cosmetics', 'haircare', 'other'`
   - `RETAIL_TYPES` (this list is exclusively the `appointments` gate) += `'clinic', 'aesthetic', 'spa', 'haircare'`
   - `CONSULT_TYPES` += `'clinic', 'aesthetic', 'spa', 'haircare'`
   - `HOSPITAL_TYPES` and `ENTERPRISE_TYPES` unchanged; comments added explaining the two-taxonomy coexistence.
2. **`lab` module** (line 249): `types: [...HOSPITAL_TYPES, 'laboratory']`.
3. **`clients` labelByType** (line 225): `{ hospital: 'Patients', clinic: 'Patients' }`.
4. **`NAV_ORDER`** (≈ line 284): insert `clinic` list:
   `['overview','dashboard','appointments','consultation','pos','inventory','mastercatalog','clients','expenses','debts','wallet','purchases','demand','carefind','locations','staff','reports','adr-reports','ecommerce','settings']`
5. **`familyOf`** (≈ line 289): `clinic → 'clinic'`; `laboratory → 'hospital'` (ordering only, commented).
6. **Normalization** before `getModulesForType`:
   `const KNOWN_TYPES = new Set(ALL_TYPES)` + `normalizeType()`; `getModulesForType` and `rolesForType` pass the type through it (`'other'` for unknowns).
7. **`ROLES_FOR_TYPE`** (≈ line 411): add `clinic`, `laboratory`, `aesthetic`, `spa`, `haircare`, `cosmetics`, `other` keys per the table; `rolesForType` becomes a table lookup with the enterprise branch preserved.

Tests first (`apps/carehub/src/lib/__tests__/permissions.test.js`):
- UPDATE "hides consultation for every business type except skincare and pharmacy" → consultation-driven set {skincare, pharmacy, clinic, aesthetic, spa, haircare} positive; {hospital, laboratory, cosmetics, other, dental, manufacturer_importer, wholesale} negative.
- UPDATE "keeps consultation a skincare+pharmacy-only module" → same set + negatives.
- EXTEND clients-label test: `clinic → 'Patients'`, `laboratory → 'Clients'`.
- NEW describe "signup taxonomy (config/constants.js BUSINESS_TYPES)" (imports `BUSINESS_TYPES`): every id → non-empty owner nav containing `dashboard` and `wallet`; no clinical/enterprise leakage from any signup type (laboratory exempt only for `lab`; hospital skipped); appointment-driven four get appointments+consultation; cosmetics/other don't; laboratory gets `lab` and nothing else clinical/appointments; unknown/`''`/`null` normalize to the `other` set; `rolesForType` scoping for clinic/laboratory/aesthetic/cosmetics; ordering pins (clinic appointments before pos; laboratory lab before pos; clinic has no Clinical nav group).
- KEEP: ALL_NAV counts 20/24/18 unchanged.

Command: `cd apps/carehub && npx vitest run src/lib/__tests__/permissions.test.js`

### Task 2 — ADR surfaces (one mapping, consumed)

- `apps/carehub/src/modules/adr/repositories/index.js` — `getModuleTypeFromBusinessType` typeMap += `clinic: HOSPITAL, laboratory: HOSPITAL, aesthetic: SKINCARE, spa: SKINCARE, haircare: SKINCARE, cosmetics: SKINCARE` (comment updated). This drives `AdrReportsList.jsx` and `validation.js` today.
- `apps/carehub/src/modules/adr/AdrNav.js` — `getAdrNavItems` resolves the variant via `getModuleTypeFromBusinessType` (import from `./repositories`); removes the raw-key indirection; unknown fallback to `community_pharmacy` preserved. Side effect, correct per repositories' own comment: manufacturer_importer/wholesale now resolve to the industry items (previously collapsed to community_pharmacy here).
- `apps/carehub/src/modules/adr/formEngine.js` — `getModuleType` delegates to `services`' re-export of the repositories map (kills the duplicate map); `getBusinessTypeLabel` += labels for the 6 new types (clinic 'Clinic / Medical Centre', laboratory 'Laboratory', aesthetic 'Aesthetic Clinic', spa 'Spa / Wellness Centre', cosmetics 'Cosmetics / Beauty', haircare 'Hair-Care / Salon').

Tests first:
- `AdrNav.test.js`: NEW test — clinic/laboratory → `['adr-hospital']`; aesthetic/spa/haircare/cosmetics → `['adr-skincare']`; manufacturer_importer/wholesale → `['adr-industry','pv-tracker']`; existing unknown-type fallback test stays green.
- `repositories/index.test.js`: NEW test in the `getModuleTypeFromBusinessType` describe — the six new-type mappings; existing enterprise/fallback tests stay green.

Command: `cd apps/carehub && npx vitest run src/modules/adr/AdrNav.test.js src/modules/adr/repositories/index.test.js`

### Task 3 — adjacent consumers

- `apps/carehub/src/modules/clients/Clients.jsx` line 98: `canConsult` derives from the registry —
  `getModulesForType(brand?.business_type).some(([id]) => id === 'consultation')` (+ import). Keeps the "New Consultation" shortcut for every consultation-enabled type, drops it for the rest via the same gate as the nav.
- `apps/carehub/src/lib/__tests__/ecommerceSegments.test.js`: NEW test pinning the signup taxonomy → `retail` (code unchanged — `resolveEcommerceSegment` already lands there; the comment already lists clinic/laboratory/other).
- Deliberately NO `roleTemplates.js` change: its pharmacy/hospital/enterprise sets don't fit the new types cleanly (e.g. "Head Nurse" at a laboratory) — authoring clinic/lab/beauty template sets is a follow-up content pass, not a registry fix.

Command: `cd apps/carehub && npx vitest run src/lib/__tests__/ecommerceSegments.test.js`

### Task 4 — documentation

- NEW `docs/architecture/Business-Types-and-Module-Registry.md`: both taxonomies table, the type→module mapping, wallet policy, unknown-type fallback, ADR mapping, "adding a business type" checklist (constants + family lists + NAV_ORDER + labelByType + ROLES_FOR_TYPE + ADR maps + tests), test map.

### Task 5 — verify + commit

- `npm test` (full suite in `apps/carehub`), `npm run lint`, `npm run build`.
- One commit: `fix(permissions): resolve the signup taxonomy end-to-end in the module registry`
  Body: what/why/verified + plan/doc pointers.

---

## Interfaces that must not change

- `getModulesForType(type) → [id, icon, label][]` (shape unchanged)
- `getNavItems / getNavGroups / getReportTabs / getReportDefaultTab / modulePath / isModuleActive` signatures unchanged
- `rolesForType → string[]`; `ROLES_FOR_TYPE` shape unchanged
- `getModuleTypeFromBusinessType → one of the 4 ADR_MODULE_TYPES values`
- `ALL_NAV_DEFAULT / ALL_NAV_HOSPITAL / ALL_NAV_ENTERPRISE` lengths 20 / 24 / 18

## Review focus (for the human)

1. The type→module table above (product-shaping: what each signup type gets).
2. The unknown-type fallback (`'other'` set instead of an empty app).
3. ADR variant choices: clinic/laboratory → hospital presentation; beauty types → cosmetic event presentation.

## Self-review checklist (before commit)

- [x] Diff touches only: `permissions.js`, `permissions.test.js`, `AdrNav.js`, `AdrNav.test.js`, `repositories/index.js`, `repositories/index.test.js`, `formEngine.js`, `Clients.jsx`, `ecommerceSegments.test.js`, new architecture doc, this plan.
- [x] Legacy tuples unchanged (existing tests + ALL_NAV count pins green).
- [x] Every `BUSINESS_TYPES` id resolves: owner nav ⊇ {dashboard, wallet}; specialty modules per table.
- [x] Red→green evidence captured for every task.
- [x] Lint + build exit 0.
- [x] Wallet answer for the original question restated in the final report (owner wallet for all 9 types; staff/rep wallet = custom role grant).

---

## Execution record (2026-10-18)

- **Task 1 — registry core: done.** All edits landed as planned (~14 hunks). Focused suite: red run surfaced exactly the 10 expected failures (clinic/laboratory/beauty types → 0 modules, ADR collapsed to community_pharmacy, roles fell to retail), then green 85/85 after implementation.
- **Task 2 — ADR surfaces: done.** One mapping now lives in `repositories.getModuleTypeFromBusinessType`; `AdrNav` + `formEngine.getModuleType` consume it (duplicate map in formEngine deleted). Side effect that matches the repositories comment: enterprise ADR nav items now present as industry (previously collapsed to community_pharmacy in the nav only).
- **Task 3 — adjacent consumers: done.** `Clients.jsx` `canConsult` derives from the registry; signup-taxonomy → retail pin added to ecommerceSegments tests. `roleTemplates.js` deliberately unchanged (template authoring for clinic/laboratory/beauty is a follow-up content pass).
- **Task 4 — docs: done.** `docs/architecture/Business-Types-and-Module-Registry.md`.
- **Task 5 — verification evidence:**
  - focused 4 files: **85/85 passed** (red run had 10 failures before implementation);
  - full suite: **1518 passed / 12 skipped / 0 failed tests** across 132 files (one landing-responsive suite hit a 30s hook timeout under full-suite load; re-run in isolation **12/12 passed** — environmental, not a code failure);
  - `npm run lint`: **0 errors** (398 pre-existing warnings, none introduced);
  - `npm run build`: **exit 0** (✓ built in ~53s).
- **Commit:** `fix(permissions): resolve the signup taxonomy end-to-end in the module registry` — on `main`, unpushed (sits on top of the also-unpushed POS barcode commit `d51c675`).

### Follow-ups (documented, not executed)

1. Register wizard lucide icons for the 7 new types (`BIZ_ICONS` falls back to `Building2`; emoji ids already exist in `BUSINESS_TYPES`).
2. Consultation form variant for clinics (non-pharmacy types currently get the skincare-style form).
3. Role template sets for clinic / laboratory / beauty types (New Role picker shows none for them today).
4. Product decision: whether `manufacturer_importer` / `wholesale` return to the signup list (they remain legacy-only types, fully working).
5. Optional preset enterprise role template "Medical Rep" (user idea, not approved).
