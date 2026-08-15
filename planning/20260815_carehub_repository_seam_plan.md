# CareHub Repository-Seam Completion Plan

> **Purpose:** Single source of truth for finishing the CareHub repository-seam
> rollout (the "last ten modules" thread). The discipline, ordering, and the one
> anchored product decision are fixed here so any agent (or human) can resume
> without re-deriving them.
>
> **Created:** 2026-08-15
> **Status:** **Unit 1 (fail-loud dispensing) COMPLETE 2026-08-15** — code shipped, 312/312 tests + build green, migration `dispense_ref_idempotency` applied live and verified behaviorally, `CODE_AUDIT.md` updated. Next unit: **Unit 2 (consultation repository)**. (This document's own creation produced no code changes.)
> **Sibling docs:** `planning/roadmap.md` (Strategy A §4.1, §7 Phase 3),
> `planning/CODE_AUDIT.md` ("Refactoring" section), `architecture/Technical-Debt.md`.
> **Apps:** `apps/carehub` (React + Vite + Supabase).

---

## 1. Context (why this plan exists)

CareHub's repository-seam rollout is the workstream with the best track record
in the project: **16 of 24 modules** are on the seam (`UI → repository
(application/domain) → sbFetch transport (infrastructure)`), and **every module
migrated so far has surfaced a real defect** — unscoped writes, missing tenant
filters, non-atomic transfers. The unmigrated modules are unaudited by
construction.

Current state, verified 2026-08-15:

- **Fully off `services/supabase.js` (14):** inventory, expenses, clients,
  debts, purchases, reports, appointments, dashboard-home, settings, warehouses,
  territories, staff, orders, messages.
- **On the seam with flagged cross-aggregate residuals (2):** `pos` (`POS.jsx`
  still imports `getClients`, `getLatestConsultation`), `stock` (`Stock.jsx`
  still imports `getProducts`).
- **Still importing `services/supabase.js` directly (~10):** `consultation`,
  `demand`, `locations`, `live-activity`, `overview`, `referral-agent`,
  `carefind` (the CareFind bridge module), plus the hospital-pipeline screens and
  the `pos`/`stock` residuals above.
- **`services/supabase.js`** remains a ~700-line god-module exporting ~95
  functions. Its correct end-state is **not zero functions** — see §4.

**The single most important fact for this plan:** the documented next unit is
`consultation`, and it is the one module with a deferred decision frozen in the
god-module — `addSale` is its only remaining caller, and `addSale` stays in
`services/supabase.js` because `saleRepository.create` is not a drop-in. That
decision is now made (see §2) and the plan is built around it.

---

## 2. Anchored Decisions (ruled by the product owner, 2026-08-15)

### 2.1 Fail-loud dispensing — **DECIDED**

When consultation adopts the seam, a prescription/dispensing sale **fails loud**
on any network or server error. It does **not** inherit the till's offline-queue
behavior:

- No write is ever parked in the offline store (`localStorage`).
- A failed insert means the `AFTER INSERT` stock trigger never ran, so **stock is
  not decremented on a phantom**.
- The existing server-side guards still run: `guard_sale_item_prices` (BEFORE
  INSERT on `sales`) and the stock trigger. Fail-loud is "the normal rules,
  minus the queue," never a bypass.
- The pharmacist sees a clear error ("dispensing requires a connection") the
  moment it happens, and can retry.

**Idempotency (required to make retry safe):** a network drop mid-request is
ambiguous — the sale may or may not have landed. Blind retry risks
double-dispensing and double-decrementing stock. Therefore the dispensing write
carries a client-generated **`dispense_ref`**, guarded server-side by a partial
unique index (the established pattern from wallet-credit reference uniqueness).
Replay of the same `dispense_ref` is a no-op that returns the existing sale.

### 2.2 Consultation seam ownership boundary — **DECIDED (room consensus)**

The `consultations` table is where CareHub and CareFind previously collided
(C8) and CareFind's professional-consultation payment flow writes into the same
domain. The repository owns **only CareHub's side** — the clinical record, the
form, the dispensing sale. CareFind's payment settlement stays RPC-owned
(`charge-consultation`, the settle RPCs). The repository does **not** reach into
the settle path. This is the same discipline as keeping `stock_movements` inside
the stock aggregate rather than an injected collaborator.

### 2.3 End-state of `services/supabase.js` — **DECIDED (room consensus)**

The goal is **not** a zero-line file. The god-module's end-state is:

1. the **transport** (`sbFetch`, `sbUpload`),
2. the **auth bootstrap** (functions that must run before any session exists:
   `registerBusiness`, `provisionStaffAuth`, `resolveAccountByEmail`, …),
3. the **genuinely shared, non-domain reads** (e.g. the multi-branch `businesses`
   tree), and
4. the **notification fan-out** if no module owns it.

Every domain-owned read and write lives in its owner's repository. Over-abstracting
shared reads into new layers is explicitly out of scope.

---

## 3. Work Units (sequential, with commit discipline)

**Commit discipline (project rule):** behavior-fix and refactor are separate
commits. Each unit below states which it is. Do not combine.

### Unit 1 — Fail-loud dispensing (behavior fix, own commit) — **DONE 2026-08-15**

- **Scope:** extend `createSaleRepository` with an explicit offline policy
  (`{ queueOffline: false }`); wire `PharmacyForm.jsx` to dispense with
  fail-loud; add `dispense_ref` idempotency (client generates, partial unique
  index server-side, replay → no-op returning the existing sale).
- **Files:** `apps/carehub/src/modules/pos/repositories/index.js` (+
  `index.test.js`), `apps/carehub/src/modules/consultation/PharmacyForm.jsx`,
  `apps/carehub/src/services/supabase.js` (`addSale` deleted),
  `apps/carehub/src/lib/dbErrors.js` (`isDuplicateError` extracted),
  `apps/carehub/sql/20260815_dispense_ref_idempotency.sql` (applied).
- **Tests:** 6 new (offline → rethrows + queue untouched; transient failure →
  rethrows, never queues; server rejection rethrows; `dispense_ref` replay →
  returns existing sale; unresolvable duplicate → rethrows; till default still
  queues). Full suite 312/312; build clean.
- **Live verification (2026-08-15, rolled-back probes):** fresh ref accepted;
  identical ref same business → 23505; identical ref other business → accepted;
  NULL ref (till) → accepted; zero residue; advisors unchanged.
- **Visible benefit:** a pharmacist is told the truth instead of a sale silently
  parking; retry is safe.

### Unit 2 — Consultation repository (refactor, own commit)

- **Scope:** `createConsultationRepository({ request })` over `consultations`
  + `consultation_forms`, composing `saleRepository` for dispensing (fail-loud).
  In-memory adapter + tenant-scoping tests. `PharmacyForm.jsx`/`Consultation.jsx`
  stop importing `services/supabase`. **`addSale` is already deleted** (Unit 1),
  so this unit retires the module's remaining service-module reads.
- **Ownership boundary per §2.2:** no writes reach CareFind's settle path.

### Unit 3 — Scoping fixes on consultation reads (behavior, own commit)

- **Scope:** `getLatestConsultation` / `getConsultationsByClient` currently
  filter on `client_id` alone. They gain a `businessId` filter, with regression
  tests asserting a cross-tenant client id returns nothing.
- **Why separate:** behavior change, not refactor — its own commit by rule.

### Unit 4 — Residual repoints (refactor, own commit)

- **Scope:** `POS.jsx` → `clientRepository.getAll` + consultation reads via the
  consultation repository (scoped); `Stock.jsx` → `productRepository.getAll`;
  `Debts.jsx` → `clientRepository.getAll`. Delete the shared copies
  (`getClients`, `getProducts`, consultation reads) from `services/supabase.js`.
- **Tests:** in-memory-adapter assertions that the repointed reads hit the
  owning repository and enforce `business_id`.

### Unit 5 — The rest (each module: refactor unit + its own scoping-fix unit)

Order, with rationale:

1. `demand` — requisition/out-of-stock writes already route through
   `create_requisition` (RPC), so the repository wraps an existing server
   boundary; small.
2. `locations` — multi-branch `businesses` tree reads; the last place
   `cloneBranchData`/`addBranch` live in the god-module.
3. `referral-agent` admin — 12 functions in the god-module.
4. `carefind` (the bridge module) — cross-app reads; define ownership explicitly
   (mirror §2.2).
5. `live-activity` — **blocked on an open ruling, see §5.2.** 1,212 lines of
   enterprise field-rep tooling; verdict is migrate or cut before a repository
   is built.

Hospital-pipeline screens (`pages/dashboard/hospital/*`) are in the same
unmigrated class and get swept under the relevant units rather than treated as a
separate project.

---

## 4. End-State Definition of Done (per module — from `planning/roadmap.md` §9)

- [ ] Data access goes through a repository with an injected transport (not
      `services/supabase.js` directly)
- [ ] Every write scoped by `business_id` (or documented reason it can't be)
- [ ] RLS policy verified behaviorally (impersonation probe), not just "a policy
      exists"
- [ ] Loading, error, and empty states present
- [ ] Verified responsive at 375/768/1280
- [ ] Test coverage for the repository (in-memory adapter) at minimum; UI test
      where behavior is non-trivial
- [ ] No native `alert()`/`confirm()`/`prompt()`
- [ ] Refactor and behavior-fix are separate commits
- [ ] `CODE_AUDIT.md` / `Technical-Debt.md` updated if the work closes or
      discovers a tracked item

---

## 5. Open Rulings

### 5.1 Skincare/pharmacy gating on consultation — **PARKED, does not block**

The consultation module is gated to `skincare` and `pharmacy` business types in
`getNavItems()`. This does not block the seam (the repository is gating-agnostic;
the gate lives in permissions/navigation). Re-examine only when a
non-pharmacy/non-skincare business asks for consultations.

### 5.2 `live-activity` — migrate or cut — **BLOCKS Unit 5.5**

1,212 lines of enterprise field-rep tooling (reverse-geocoding, voice uploads,
ten god-module functions). No verified evidence it is a live product surface.
**Decision needed:** if unused, cut it (delete) rather than build a repository —
cheaper, and it shrinks the god-module without a migration. If used, migrate it
with the standard DoD.

---

## 6. Verification Practice (standing, from this project's history)

- A DDL statement completing is **not** evidence it did anything. After every
  SQL change, re-read the catalog / re-probe the live behavior, never trust the
  file header.
- Every repository migration gets its behavioral RLS probe, not a policy count.
- `get_advisors` security baselines before/after risky DDL.

---

## 7. How to Continue

1. **Unit 1 (fail-loud dispensing) is done** — see the status header and §3.
   Next: **Unit 2 (consultation repository)**, the refactor that moves the
   module's reads off `services/supabase` and composes `saleRepository` for
   fail-loud dispensing, in its own commit.
2. Get the `live-activity` ruling (§5.2) so Unit 5 has no blocking item.
3. Update `CODE_AUDIT.md` as each unit closes or discovers a tracked item.