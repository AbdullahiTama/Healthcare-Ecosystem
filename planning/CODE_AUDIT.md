# Code Audit: Open Items

The open problems in the CareHub ecosystem, each with evidence, a severity and what would close it. Read it before a
change (`CLAUDE.md` / `AGENTS.md`); when you close or find an item, update it here in the same change.

- **Verified** means checked against the code at the stated commit or the live database on the stated date. Nothing
  here is inferred from comments or docs alone.
- Severity: **High** (security or data exposure, act soon), **Medium** (integrity, governance or a defect waiting to
  happen), **Low** (hygiene, tooling, debt).
- Detailed audits live in `docs/audits/`; this file indexes their open items rather than repeating them (section 3).

Last full review: 2026-11-02, against `main` at `c52f666` and the live Supabase project `szdybxmgmhndoytqanfb`.

## 1. Summary

| ID | Severity | Area | Item | Status |
|---|---|---|---|---|
| A1 | High | Security / ADR | PV routing P0-1 fix is live but was never probed live; the trigger is the only barrier | **Closed 2026-11-02**: probed live, holds |
| A2 | Medium | Governance | `export_logs` is not append-only: platform admins can edit or delete export records | **Closed 2026-11-02**: append-only, applied live |
| A3 | Medium | Process | 27 migrations say "not applied", "draft" or "review only" but are all live; a live migration also sits in `pending-migrations/` | Open |
| A4 | Medium | Security | Supabase security advisor: 2 errors and several actionable warnings | Open, partly accepted |
| A5 | Medium | Quality | React hook rules are not linted | Open |
| A6 | Medium | Data model | `plan_catalog` and `business_subscriptions` are unused mirrors; the Plan Catalog screen edits prices checkout ignores | Open: owner decision |
| A7 | Low | Admin | Hard delete of a business is selectable again | Open: owner decision |
| A8 | Low | Tooling | CodeRabbit reviews never run on PRs to `main` | Open |
| A9 | Low | Debt | About 600 `no-unused-vars` warnings | Open, tracked in Linting.md |
| A12 | High | POS (production defect) | Re-holding an edited held sale is refused (`permission denied for table sales`); duplicate held sales; carts lost when leaving the POS | **Closed 2026-11-02**: grant live, app deployed and in use; owner review of 4 double-charged pairs pending |
| A13 | Medium | Importer operating models | Every spec section implemented (gap review 2026-11-04); applied to production 2026-11-04 and probed; two owner decisions and one proposal open | Open: owner decisions |
| A14 | Medium | Payments | Reported ~1% reduction in amounts: not reproduced in code or live data; Paystack's fee was not stored, so bank deposits could not be matched to payments | Open: migration applied 2026-11-04; confirm backfill, then match deposits |
| A15 | Medium | Expenses | The expense budget lived only in the browser, per month: it vanished at each new month, on another device and for staff | Open: migration applied 2026-11-04; the reporting Owner opens Expenses once on the original device |
| A16 | Low | Expenses (data model) | Expenses had no payment status (every expense recorded as already paid) | **Closed 2026-11-09**: payment status, history and Record payment; migration applied and probed |
| A17 | Medium | Inventory (bulk delete) | Bulk delete / delete all and re-upload / restore through checked database functions | **Closed 2026-11-10**: applied with owner approval and probed |
| A18 | Low | Data hygiene | 6 products have no `business_id` (visible to no business; untouched by any business action) | Open: review and remove or reassign |
| A19 | Medium | Clients (bulk delete) | Client bulk delete and restore through checked database functions | **Closed 2026-11-10**: `carehub_20270111_client_bulk_delete` applied with owner approval and probed |
| A20 | Medium | Expenses (bulk delete) | Expense bulk delete and restore with payment history | **Closed 2026-11-10**: `carehub_20270112_expense_bulk_delete` applied with owner approval and probed |
| A21 | Medium | Debts (bulk delete) | Debt bulk delete and restore; sale / purchase debts kept (they are synced by source) | **Closed 2026-11-10**: `carehub_20270113_debt_bulk_delete` applied with owner approval and probed |
| A22 | Medium | Purchases (bulk edit / delete) | Purchase bulk edit through edit_purchase; delete takes stock back (kept when sold), restore puts it back | **Closed 2026-11-10**: `carehub_20270114_purchase_bulk_edit_delete` applied with owner approval and probed |
| A23 | Low | Purchases (import / export) | Bulk upload and Excel/CSV export; the export audit needed `purchases.*` in `record_export_audit`'s allow-list | **Closed 2026-11-11**: `carehub_20270115_purchase_export_audit` applied with owner approval and probed |
| A24 | Medium | Expenses (set new budget) | A used-up budget could only be edited (history rewritten, old spending counted against the new amount) | **Closed 2026-11-11**: `carehub_20270116_expense_new_budget` applied with owner approval and probed |
| A25 | Medium | Data exposure (cost price) | `products.cost_price` is readable by every member of a business; the new POS cost switch is display-only | Open: step 1 (screens) done 2026-11-16; step 2 (data-level) to plan |
| A26 | Medium | Debts / suppliers / credit accounts | Debt payment history, guarded hand-recorded debts, supplier accounts, account payments and debt import needed `carehub_20270117_debt_and_supplier_accounts` (unapplied, it was the cause of the 2026-11-15 "debt upload not working" report); Record Debt linking added | **Closed 2026-11-15**: applied with owner approval (version 20261115205734) and probed |
| A27 | High | POS (production defect) | An Owner's sales at a branch location are refused: "This sale is not authorized for your account." | **Closed 2026-11-15**: `carehub_20270118_sale_guard_branch_owner` applied with owner approval (version 20261115222717) and probed; a first version refused every sale for 72 s and was rolled back (see item) |
| A28 | Low | Suppliers (contact list) | Supplier list with contact details, import and export needs `carehub_20270119_supplier_directory` (new table; nothing existing changes); until applied the screen is as before | **Closed 2026-11-15**: applied with owner approval (version 20261115224942) and probed |
| A29 | Medium | Clients / POS (defect) | Resuming a held sale restored only the customer's name: a renamed client, or one sharing a name, was charged without (or to the wrong) client record | **Closed 2026-11-16**: re-picked by `client_id`; tested (fails on the old code) |
| A30 | Low | Clients (data integrity) | Any member can overwrite `clients.visit_count` / `total_spend` through the API (no guard); `anon` holds table grants on `clients` (RLS denies every row) | **Closed 2026-11-16**: `carehub_20270122_client_totals_guard` applied with owner approval (version 20261116104753); Owner or staff given access only |
| A31 | Medium | Clients / suppliers (opening balances) | A "we owe" debt linked to a client would have been listed and paid as a supplier; opening balances need one per client | **Closed 2026-11-16**: applied with owner approval (version 20261116092716), probed, then the app change deployed |
| A32 | Low | Debts (data hygiene) | 8 credit-sale debts have no `client_id`, some although their sale is linked to a client; Debts' Link to clients covers hand-recorded debts only | **Closed 2026-11-16**: `carehub_20270121_link_credit_sale_debts` applied with owner approval (version 20261116102618); 3 linked, 5 have no client to link |
| A33 | High | Uploads / debts / POS / Purchases | Inventory upload lost rows (generic-name duplicate rule, line breaks, .xlsx read as text, rows dropped uncounted); a failed purchase debt was reported as recorded; no supplier phone in Record Purchase or the purchase template; POS showed no price for out-of-stock products | **Closed 2026-11-16**: app only, no database change; tested |
| A34 | High | Hospital (clinical data access) | Every member of a business, in any role, can read, change and delete all clinical records through the API; deleting a patient cascades away their history; no clinical audit | **Closed 2026-11-17**: `carehub_20270124_hospital_access` applied with owner approval (version 20261117092614) and probed |
| A35 | High | Hospital (model boundary) | Hospital tables accept any business type; an owner can change their own `business_type` through the API | **Closed 2026-11-17**: `carehub_20270124_hospital_access` applied with owner approval and probed |
| A36 | High | Hospital (production defect) | Doctor → Lab / Imaging send fails (unknown `patient_name` column) and leaves partial records; jsonb read with `JSON.parse`; dispensing discharges the patient | **Closed 2026-11-17**: `carehub_20270125_hospital_identity_and_workflow` applied (version 20261117092916) and probed; app deployed |
| A37 | Medium | Hospital (schema) | The eight hospital tables, their policies and grants are not in `supabase/migrations/`; `anon` holds full grants including TRUNCATE | **Closed 2026-11-17**: `carehub_20270123_hospital_schema_baseline` (version 20261117092425) + `carehub_20270124` applied |
| A38 | Medium | Hospital (data model) | Two patient identities: Reception writes `patients`, the hospital "Patients" menu and the rest of CareHub use `clients` | **Closed 2026-11-17**: `clients` is the identity (owner); `carehub_20270125` applied; 3 test clients at pharmacies left for the owner |
| A39 | High | Business directory (visibility) | 215 bulk-imported directory listings never reached Manufacturer / Importer companies: Field Report showed verified listings only, the report link refused them, Facility Discovery never read the directory | **Closed 2026-11-18**: `carehub_20270126_directory_listings_in_field_and_discovery` applied with owner approval (version 20261118114804) and probed; app deployed |
| A40 | Medium | CareFind delivery map (XSS) | The delivery-tracking map put the pickup station's name and the delivery address into popup HTML unescaped | **Closed 2026-11-18**: popups built from text nodes during the Google Maps switch; tested |
| A41 | Low | POS (usability defect) | The product search text stayed in the box after a product was picked from the grid; the cashier deleted it by hand | **Closed 2026-11-19**: app only, `pickProduct` clears it on a successful add; tested (fails on the old code). See POS-Barcode-Scanning.md |
| A42 | Medium | Stock Validation (expiry dates) | A stock count could adjust quantities but not correct expiry dates; corrections were made elsewhere with no trace in the count history | **Closed 2026-11-19**: `carehub_20270129_stock_count_expiry` applied with owner approval (version 20261119081658) and probed; app deployed after it. See Stock-Ledger.md |
| A43 | High | ADR (facility reports never reach the company) | Facilities' company selections were saved but auto-routing, the reviewer queue and reviewer alerts were public-only (0 routes on 50 facility reports); the picker listed nothing until Search was pressed; a changed selection on a facility draft was added, not replaced | Open: `carehub_20270130_adr_facility_company_routing` written and tested on PGlite, **not applied**; extends auto-routing to facilities (security note in ADR-Facility-Company-Routing.md); apply (owner approval), probe, then deploy the app |

## 2. Items

### A1. PV routing: the P0-1 fix has never been probed live (High) — closed 2026-11-02

**Was:** [docs/audits/carefind-carehub-pv-routing-audit.md](../docs/audits/carefind-carehub-pv-routing-audit.md)
P0-1 (a public reporter could route their own case, with patient data, to any business) was fixed by the trigger
`trg_adr_guard_route_writes` (`carehub_20261113_adr_route_write_guard`, extended by `carehub_20261114_adr_route_review`),
but its live behaviour had never been tested while `authenticated` still holds column UPDATE on every route column and
12 cases were routed.

**Closed by:** a rolled-back live probe as an ordinary signed-in user owning a public draft. Every attempt to insert a
non-pending, pre-verified, forged-review or ineligible-business route, and every attempt to change status, the
responsible business, verification, hold/review fields, reporter-selection history or company workflow, was refused by
the guard; a legitimate pending route was accepted (control). Routing data was identical before and after. Full results
are in the `carehub_20261113_adr_route_write_guard` header.

**Still optional:** revoke the unused column grants as defence in depth. **Not exercised:** a submitter-chain user on a
routed *business* report, because none exists yet (all routed routes come from public reports); re-run the probe when
one does.

### A2. `export_logs` can be edited or deleted (Medium) — closed 2026-11-02

**Was:** platform admins could UPDATE or DELETE export records through the REST API (one `FOR ALL` policy), every client
role held TRUNCATE, and the actor was whatever id the browser sent.

**Closed by:** `carehub_20261231_export_logs_append_only` (applied live as version `20261102122934`): client roles keep
only SELECT and INSERT (anon nothing) under read and insert policies for platform admins; a BEFORE INSERT trigger
stamps the actor from the session and validates the reason, type, watermark and count; UPDATE, DELETE and TRUNCATE are
refused by trigger for every role. Verified by 11 PGlite tests
(`apps/carefind/src/test/admin-governance/exportLogs.db.test.js`, including one reproducing the original finding) and a
rolled-back live probe. The admin console needed no change.

### A3. Migration status headers drift from the live ledger (Medium)

**What:** headers are how a reader knows whether a protection is live. 27 files in `supabase/migrations/` still say
`NOT YET APPLIED`, `STATUS: NOT APPLIED`, `DRAFT — not yet applied` or `REVIEW ONLY — do NOT apply`.

**Evidence (live, 2026-11-02):** all 27 have a same-named entry in `supabase_migrations.schema_migrations`. They
include the ADR delete guards and routing migrations, `carehub_20261209_record_export_audit`, the businesses insert
guard, and the August referral, roles and master-catalogue migrations. Separately,
`docs/architecture/pending-migrations/carehub_20261211_sales_write_hardening.sql` is a draft in the folder for
migrations that must not be applied, yet `carehub_20261211_sales_write_hardening` is in the live ledger, and that
folder's README does not mention it.

**Risk:** someone re-applies a migration believing it is missing, or assumes a protection is absent (or present) when
it is not.

**Close by:** update the 27 headers to `APPLIED (version ...)`, move or annotate the stale draft, and add a check (a
test that reads a committed ledger snapshot, or a header convention a script can verify) so the two cannot drift
silently again. The file list is reproducible with
`grep -l -i "NOT YET APPLIED\|STATUS: NOT APPLIED\|not applied yet\|REVIEW ONLY" supabase/migrations/*.sql`
(27 files on 2026-11-02).

### A4. Supabase security advisor findings (Medium)

**Evidence (advisor run 2026-11-02, 208 findings in 8 groups):**

| Level | Finding | Count | Notes |
|---|---|---|---|
| ERROR | SECURITY DEFINER views | 2 | `adr_pv_case_view` is intentional and documented (column masking needs it; ADR-Privacy-Security-Audit.md). `carefind_products` has no recorded rationale: **review**. |
| ERROR | RLS disabled in public | 1 | `spatial_ref_sys`, the PostGIS reference table. Usually accepted; record the decision. |
| WARN | Mutable `search_path` | 3 | `create_shop_order`, `shop_order_receipts_guard`, `plan_enforcement_started_at`. One-line fixes (`SET search_path = public, pg_temp`). **Fix.** |
| WARN | Leaked-password protection off | 1 | Supabase Auth setting (HaveIBeenPwned check). **Enable** in the dashboard. |
| WARN | Extensions in `public` | 2 | `pg_trgm`, `postgis`. Moving them is disruptive; record as accepted unless there is a reason. |
| WARN | anon may execute SECURITY DEFINER functions | 24 | **Review** each one is meant to be public. |
| WARN | authenticated may execute SECURITY DEFINER functions | 141 | Mostly by design (RPCs that check the caller first, e.g. the three admin subscription functions). Spot-check the ones without an explicit caller check. |
| INFO | RLS enabled, no policy | 34 | Deny-all for clients; fine where only server code uses the table. |

**Close by:** fix the three `search_path` functions, enable leaked-password protection, review `carefind_products` and
the 24 anon-executable functions, and write down the accepted items so the next run only shows new findings.

### A5. React hook rules are not linted (Medium)

**Evidence (`main` at `c52f666`):** the shared `.eslintrc.json` loads only `eslint-plugin-react`; there is no
`eslint-plugin-react-hooks`, so `react-hooks/rules-of-hooks` and `exhaustive-deps` never run (a disable comment for
them fails lint with "Definition for rule ... was not found"). A real defect of this kind shipped: `DashboardStats` in
the admin console called hooks after early returns, which React rejects when the business list goes from empty to
non-empty. It was fixed in PR #39.

**Close by:** add `eslint-plugin-react-hooks` to both apps' devDependencies with `rules-of-hooks: error` and
`exhaustive-deps: warn`, then fix what it reports (expect a burst of `exhaustive-deps` warnings first).

### A6. Unused plan mirrors; Plan Catalog edits prices nothing uses (Medium, owner decision)

**Evidence (live and code, 2026-11-02):** `business_subscriptions` has 0 rows and, since PR #39, nothing in the admin
console reads it. `plan_catalog` holds `basic, pro, enterprise`, but the app sells `basic, growth, premium,
enterprise, custom`. Checkout (`api/_handlers/initiate-plan-payment.js`) takes prices from `src/lib/planLimits.js`, and
Money › Plan Catalog still creates and edits `plan_catalog` rows. An admin changing a price there changes nothing a
customer pays.

**Close by (decide one):**
1. make the database the price source (seed `plan_catalog` with the real plans; checkout and limits read it), or
2. retire `plan_catalog` and `business_subscriptions` and remove the Plan Catalog screen (or make it read-only from
   `planLimits.js`).

### A7. Hard delete of a business is selectable again (Low, owner decision)

**What:** PR #39 fixed `ConfirmDialog` props across the admin console. That made the Delete business dialog's
Soft/Hard choice visible; before, the choice never rendered and every delete was soft. `hardDeleteBusiness` issues a
plain `DELETE` on `businesses`, which the dialog itself warns "may break ledger references".

**Close by:** decide whether hard delete should exist in the console. If yes, require a typed confirmation and a
reason (and audit it); if no, remove the option and keep soft delete.

### A8. CodeRabbit never reviews pull requests to `main` (Low)

**Evidence:** on PR #39 (base `main`, the default branch) CodeRabbit skipped with "Auto reviews are disabled on
base/target branches other than the default branch", reporting `Repository: Unavailable` and no configuration
applied. Its check run is `skipped` on every push.

**Close by:** check the CodeRabbit installation's repository access and add a `.coderabbit.yaml`, or remove the app if
it is not wanted.

### A9. Lint debt (Low)

About 600 `no-unused-vars` and 140 `no-empty` warnings remain across both apps (warnings, not CI failures). The
burn-down plan and ratchet are in [docs/architecture/Linting.md](../docs/architecture/Linting.md) §3. The admin
dashboard alone reports 28.

### A12. POS held sales: re-hold refused, duplicates, lost carts (High) — closed 2026-11-02

(A10 and A11 are taken on the open A3 branch `ccr-f80f15d6-yvi6ui`; its A11 records the same refusal as this item's
first point and proposes the same grant.)

**What (verified live 2026-11-02):**
1. Re-holding an edited held sale fails every time: `updateHeld` PATCHes the held-content columns, but
   `carehub_20261211_sales_write_hardening` left `authenticated` UPDATE on only `status, is_on_hold, notes`. Edge logs:
   6 of 6 `PATCH /sales` answered 403. A held sale completed elsewhere also matched no row and the till reported success.
2. Duplicate held sales: Hold had no in-flight guard; identical held sales were created 0.0–1.5 s apart (one ₦44,700
   hold ~10 times; a new pair while this was written). Lost-response replays from the offline queue could also double.
3. Carts lost when the POS unmounts (navigation remounts routes, BuildUpdateWatcher reloads after a deploy, phones
   discard backgrounded tabs).

**Fixed in code:** a persisted per-location, per-staff POS draft; a synchronous Hold guard; client-generated sale ids
with duplicate-key recognition on replay; `updateHeld` detects a closed hold. Details, security implications and the
test plan: [POS-Drafts-and-Held-Sale-Reliability.md](../docs/architecture/POS-Drafts-and-Held-Sale-Reliability.md).

**Done:** `supabase/migrations/carehub_20270101_held_sale_edit_grants.sql` applied with the owner's approval
(version `20261102135828`); the rolled-back live probe in its header passed (owner and staff can save an edited held
sale; release, status and payment changes on a held sale and money/customer changes on a completed sale stay refused).

**Also done:** merged to `main` 2026-11-02 (`2588533`). The one duplicate held sale still open (`HLD994467`) was closed
by platform staff with an audit entry; no figure changed.

**Closed by:** CI green on `2588533` (CareHub, CareFind, financial mutation gate) and the deploy confirmed in use from
the production edge logs: the new build's held-sale save (`PATCH …&is_on_hold=eq.true&select=id`) answered 200 at
17:17 UTC, where every such save had been refused before. From 15:00 to 19:40 UTC: 4 held sales created, no
duplicates, 5 held sales charged.

**Still open (owner, not code):** the Owner of business `f7d9a912…` checks four pairs charged twice at the held amount
(₦150, ₦1,700, ₦500, ₦100), listed in the note.

### A13. Importer operating models: not applied, owner decisions open (Medium)

**What:** `supabase/migrations/carehub_20270102_importer_operating_models.sql` and `apps/carehub/src/modules/representatives/`
implement the spec "Importer & Manufacturer Operating Structures" (Centralised / Decentralised, representative ledger
and statements, switching both ways). Verified by 43 PGlite checks
(`apps/carefind/src/test/operating-models/operatingModels.db.test.js`) and unit tests. **Applied to production
2026-11-04** (seven parts; every function body verified identical to the file; rolled-back probe as a real importer's
owner passed both switch directions; security advisor clean for these objects; evidence in §10 of the note).

**Gap review 2026-11-04** (spec read section by section against the code; traceability table in
[Importer-Operating-Models.md](../docs/architecture/Importer-Operating-Models.md) §8). Closed in this pass:
Facility Discovery for reps in both models (5.1); a company transaction register filtered by representative, type,
product, territory and date, with the audit trail, print and export (7, 8); representative territories (7); switch
reconciliation before and after with full rollback on a mismatch (9.2, 9.4); open orders and customers' unpaid credit
in the migration summary (9.3); company admins notified of a switch (9.3); representative accounts no longer use up
the plan's locations or mix into the company's Locations figures (5.5).

**Live end-to-end check 2026-11-06/07** (§11 of the note): every flow passed on the live app after three fixes made
during the run (staff of an unlisted business could not sign in, applied as `carehub_20270104_staff_read_own_business`;
two refused requests on a rep account's dashboard; Facility Discovery's blank filters) and a privacy leak the last
fix exposed (Facility Discovery listed representative accounts; applied as
`carehub_20270105_discovery_excludes_rep_accounts`). The sign-up form had stopped offering Manufacturer / Importer
(removed 2026-09-02), leaving spec section 2 unreachable from the form; restored 2026-11-07 on the owner's decision.

**Owner decisions taken 2026-11-07** (§2): a Centralised supply takes the goods out of company stock
(`carehub_20270106_centralised_supply_takes_stock`); POS sales do not reduce a rep's balance; company field managers do
not see activity inside rep accounts; no charge per rep account for now; Wholesale / Distributor back on the sign-up form.

`carehub_20270106_centralised_supply_takes_stock` applied 2026-11-07 and probed live. Nothing left to close here;
A13 stays open only for the owner to review the QA test data it left in production.

### A14. Reported ~1% reduction in amounts; Paystack fee not stored (Medium)

**Report (owner, 2026-11-04):** transaction amounts appear reduced by about 1% across business types and modules.

**Verified 2026-11-04 (code at `ccd7b57`, live project read-only):** no code path or live database function applies a
1% reduction. No trigger on a money table rewrites an amount; `financial_config` has no rate near 1%. Live data:
1,030 sales, every line-item sum equals the subtotal and every total equals subtotal minus the cashier's discount
(discounts are 0.26% of sales); the `sale_payments` ledger matches what 812 completed sales were paid (one N200
difference, likely a later repayment); wallet top-ups credit the full base (the 10% fee is added on top); shop vendor
credits equal subtotal minus commission. The only deduction on card money outside our books is Paystack's own fee
(1.5%, plus N100 at N2,500 and above, capped at N2,000), kept before Paystack pays the bank. Of 12 settled payments
(N36,940, 2026-10-06 to 10-12) only 2 had that fee recorded (exactly 1.5%), in webhook payloads.

**Change:** `supabase/migrations/carefind_20270103_payment_provider_fee.sql` adds `payment_intents.provider_fee_kobo`
(write-once) and `provider_net_kobo` (generated: charged minus fee). `shared-payments` stores the fee after every
settlement (webhook and redirect), the 48-hour Paystack comparison fills it in, and a new reconciliation step
(`backfillProviderFees`, every 6 hours, up to 25 per pass) asks Paystack about older payments, so the October payments
backfill on their own. Storing the fee never changes or blocks a settlement. Verified by 35 PGlite checks
(`scripts/db-tests/paymentProviderFee.pglite.mjs`) and `shared-payments/src/__tests__/providerFee.test.js` (29).
**Migration applied to production 2026-11-04 (version 20261104071227)**; the rolled-back live probe is in its header.
The app code (`62e1292`) records fees once CareFind and CareHub are deployed.

**To close:** after the deploy and the next `fees` reconciliation step, confirm every
settled payment has a fee (`select count(*) from payment_intents where status in ('settled','refunded') and
provider_fee_kobo is null and purpose not like '%\_wallet'` returns 0); match `provider_net_kobo` against the
Paystack settlements export or the bank statement. If a ~1% gap remains in POS or report figures (which never touch
Paystack), get a specific transaction from the owner and trace it.

### A15. Expense budget disappeared: stored only in the browser (Medium)

**Report (2026-11-04):** a ₦50,000 expense budget, with its remaining balance, disappeared from Expenses.

**Verified 2026-11-04 (live project read-only):** the budget was never stored on the server. `Expenses.jsx` kept it in
`localStorage` (`carehub_expense_budget[business][YYYY-MM]`); no live table or column holds a budget. Expense records are
intact (2026-10: 22 rows across 4 businesses; 2026-11: 16). So the budget vanished at every new month (it was read for
the month shown only; the report came in on 4 November), on another device, browser or profile, after site data was
cleared or evicted (Safari, 7 days unused), and staff never saw it although the screen said they could.

**Fixed in code:** `supabase/migrations/carehub_20270103_expense_budgets.sql` (table `expense_budgets`, members read,
Owner-only `set_expense_budget`), `modules/expenses/useExpenseBudget.js`. A month without its own budget uses the latest
earlier one; budgets still in the Owner's browser are moved to the database on their first visit; a failed read is
shown as an error, never as "no budget" or "all remaining". Before the migration is applied the browser is used, as
before, with a notice. Tests: `expenseBudgets.db.test.js` (PGlite, live helpers), `Expenses.budget.test.jsx`.
See [Expense-Budgets.md](../docs/architecture/Expense-Budgets.md).

**Applied 2026-11-04** (version 20261104143040) with the owner's approval; rolled-back live probe passed (Owner sets,
staff and other businesses refused, carry-over, no direct writes, anon refused); security advisor: baseline plus the
one intended `set_expense_budget` finding. **To close:** the reporting Owner opens Expenses once on the device where the
budget was set (that moves it to the database), and it shows there and to staff.

### A16. Expenses had no payment status (Low) — closed 2026-11-09

**What (verified 2026-11-09, live columns):** `expenses` holds category, description, amount, date, staff and who
recorded it; there is no paid/unpaid state. The new Expenses filters (date, category, recorded by, amount, search;
[Record-Filters-POS-Customers-and-Held-Sales.md](../docs/architecture/Record-Filters-POS-Customers-and-Held-Sales.md))
therefore cannot filter by payment status. Money the business still owes is recorded as a purchase or a "We owe" debt,
which the Debts filters cover.

**Decided 2026-11-09 (owner request):** add payment status to expenses. **Built:** migration
`carehub_20270107_expense_payments` (amount paid, method, append-only `expense_payments` history,
`record_expense_payment`, a guard on direct edits) and the app (Payment choice when logging, Paid / Still to pay
totals, status filter, Record payment, history). Verified by 14 PGlite tests and the CareHub suite. The app works
unchanged until the migration is applied.

**Closed 2026-11-09:** applied with the owner's approval (version `20261109100502`); all 55 existing expenses read
paid in full with matching history; the rolled-back live probe passed (unpaid and part-paid expenses, payments in parts
by the Owner and a cashier, over-payment, direct edits, history writes, another business and anon all behave as
intended). Results in the migration header.

### A17. Inventory bulk delete and restore (Medium) — closed 2026-11-10

**What:** a plain product delete cascades away customer reviews, shop listings and stock-count lines, is refused for
products in orders or with batches, and leaves stock out of the ledger (live foreign keys, 2026-11-10). Bulk delete,
"Delete all & re-upload" and restore therefore go through `delete_products()` / `restore_deleted_products()` in
`supabase/migrations/carehub_20270109_inventory_bulk_delete.sql`, which keep linked products with the reason, write
stock off, keep a restorable copy and audit. Verified by 9 PGlite tests; see
[Inventory-Bulk-Edit-and-Delete.md](../docs/architecture/Inventory-Bulk-Edit-and-Delete.md). Until applied, bulk
delete says the update is needed and single delete works as before.

**Closed 2026-11-10:** applied with the owner's approval (`carehub_20270109_inventory_bulk_delete`, version
`20261110075244`), plus `carehub_20270110_restore_respects_plan_limit` (restore now stops at the plan's product limit:
the plan trigger does not see the function's own inserts). Rolled-back live probe passed (results in the migration
header); live data unchanged afterwards.

### A18. Six products with no business (Low)

**What (live, 2026-11-10):** 6 of 9,930 `products` rows have `business_id` NULL. No business can see or act on them
(every policy and function is scoped by business), so they are inert, but they are orphaned data.

**Close by:** look at what created them (names and created_at), then delete them or attach them to their business.

### A23. Purchases import and export: export audit migration (Low) — closed 2026-11-11

**What (2026-11-11):** purchases can be uploaded from Excel/CSV and exported to Excel/CSV
([Purchases-Import-Export.md](../docs/architecture/Purchases-Import-Export.md)). Uploads need no database change. Exports
are audited through `record_export_audit`, whose allow-list (read live 2026-11-11, identical to
`carehub_20261210_pos_accounting` §13) does not know `purchases.xlsx` / `purchases.csv`, so until
`carehub_20270115_purchase_export_audit` is applied the export is saved with "the audit record could not be saved".
Verified by 16 PGlite checks (`scripts/db-tests/purchaseExportAudit.pglite.mjs`).

**Closed 2026-11-11:** applied with the owner's approval (version `20261111153144`). Rolled-back live probe as a real
Owner, a staff member on an export role, a staff member without it and another business's owner: purchase exports
recorded as cost data for the first two, refused for the others and for anon and unknown types; nothing persisted.
Results in the migration header.

### A24. Expenses: set a new budget once one is used up (Medium) — closed 2026-11-11

**What (2026-11-11):** only Edit existed, which overwrote the month's budget: the overspend disappeared and the spending
that exhausted the old budget counted against the new one. `carehub_20270116_expense_new_budget` adds `starts_on`, an
insert-only `expense_budget_history`, and the Owner-only `start_new_expense_budget`; Edit now records the amount it
replaces. The app offers Set new budget only once the migration is applied. Verified by 11 PGlite tests
(`apps/carefind/src/test/expenses/expenseNewBudget.db.test.js`) with the live helpers and the live `set_expense_budget`
(read 2026-11-11). Details: [Expense-Budgets.md](../docs/architecture/Expense-Budgets.md) "Set new budget".

**Closed 2026-11-11:** applied with the owner's approval (version `20261111153408`). Rolled-back live probe (22 checks)
on the business that reported A15, whose ₦50,000 November budget was already used up (₦50,700 by the 10th): the Owner's
new budget closed the old one with that spending in the history and counted from its start; staff, managers, another
business and anon were refused; nobody could write the history directly. Security advisor: the baseline plus the one
intended finding for `start_new_expense_budget`. Results in the migration header.

### A25. Cost price is readable by every member of a business (Medium, owner decision)

**What (verified in code 2026-11-11):** the shared product catalogue loads `products?select=*`, so `cost_price` reaches
every signed-in member of the business, cashiers included, and is readable through the API whatever the screen shows.
The new POS switch ([POS-Cost-Visibility.md](../docs/architecture/POS-Cost-Visibility.md), permission
`canViewCostPrice`) only controls what the POS displays; it widens nothing.

**Close by (decide):** keep costs visible to all members (record it as accepted), or make them a data-level secret: a
column-level revoke on `products.cost_price` for non-cost roles with a cost-free read for them (view or RPC), and every
cost reader (Inventory, Purchases, reports, transfers, POS) switched over. The second changes access for existing roles
and needs a plan before implementing.


**Decided 2026-11-16 (owner):** the Owner or staff given access ("See cost prices"), screens first, then data.
**Step 1 done (screens):** Inventory shows cost price, margin, total profit and profit margin, the cost field in the
product form and bulk edit, and Cost Price / Cost Value in the Excel export only to the Owner or `canViewCostPrice`;
for anyone else the product's cost is saved unchanged. The POS already followed it. The permission is now labelled
"See cost prices" (Staff › Roles). Purchases still show what was paid (entering costs is the purchase itself; the
screen is limited to roles with Purchases). Tests: `modules/inventory/Inventory.cost.test.jsx`.
**Still open (step 2, data-level):** the API still returns `products.cost_price` and purchase costs to every member;
all staff share one database role, so this needs cost moved into a protected table and every reader and writer
(14 app files, 11 database functions, purchases) switched over. To plan and approve separately.
### A33. Incomplete uploads, unreported purchase debts, supplier phone, POS out-of-stock price (High) — closed 2026-11-16

**What (verified 2026-11-16 on `main` at `56e20dd` and the live database):** the Inventory upload skipped every row
whose *generic* name matched a product in stock, split rows on raw line breaks, read .xlsx as text and dropped nameless
and over-limit rows uncounted. `recordUnderpayment` returned null for a failed write, so Purchases reported a lost debt
as recorded. No supplier phone in Record Purchase or the purchase template; no price on out-of-stock products at the POS.
Debt linking itself was checked and found complete (A26, A32).

**Closed 2026-11-16 (app only):** every Inventory row is accounted for (imported / duplicate / needs fixing / over limit /
failed, with reasons and a rows-to-fix file); failed purchase debts reported; optional supplier phone saved on the
supplier record; POS shows the price. Details and test plan:
[Bulk-Uploads-and-Debt-Linking.md](../docs/architecture/Bulk-Uploads-and-Debt-Linking.md).

### A32. Credit-sale debts without their client (Low) — closed 2026-11-16

**Found 2026-11-16 (live, read-only)** while checking the Client Account against Debt Management: 8 `credit_sale`
debts have no `client_id`. For one client both credit sales are linked to the client but their debts are not (₦22,600).
The Clients page still counts them by exact name, so nothing shown is wrong today, but a renamed client, or two
clients sharing the name, would lose them from the position. **Close by:** a data fix setting `debts.client_id` from
the sale (`source = 'credit_sale' and source_ref = sales.txn_no`, same business) where the sale has a client, and
checking why those debts were created without it. Needs owner approval (changes data).

**Closed:** `carehub_20270121_link_credit_sale_debts` (applied with owner approval, version 20261116102618, after a
dry run in a rolled-back transaction) set `client_id` on the 3 debts whose single matching sale has a client of the
same business (TXN657611 ₦17,800 and TXN804886 ₦4,800 open, TXN568634 paid); nothing else on any debt changed. The
other 5 are left as they are: 3 walk-ins, and "Musa" (₦3,200 open) and a clinic (paid), sold to without a client
record (add a client and link from Debts if wanted). **Cause: historic.** The till passes the sale's client to the debt
and `edit_sale` keeps them in step; every credit-sale debt since 2026-10-26 10:37 (42 of 42) carries its sale's
client, so no code change. After the fix every client's Client Account balance equals Debt Management's by link
(0 of 39 differ). Tests: `apps/carefind/src/test/debts/linkCreditSaleDebts.db.test.js` (2, PGlite).

### A31. Client opening balances: supplier functions and one per client (Medium) — closed 2026-11-16

**What (2026-11-16):** "We owe client" opening balances are manual `we_owe` debts linked to the client. Read live:
`get_supplier_accounts`, `get_supplier_activity` and `record_supplier_payment` take every manual `we_owe` debt as a
supplier's supply record, so such a balance would have shown as a supplier named after the client and could have
taken a supplier payment (reproduced on PGlite). `carehub_20270120_client_opening_balances` adds `client_id IS NULL`
to those predicates (checked edit of the live definitions; aborts on mismatch or a second run) and a unique index for
one opening balance per client. Details: [Client-Position-and-Opening-Balances.md](../docs/architecture/Client-Position-and-Opening-Balances.md).
Tests: 8 PGlite. **To close:** apply with owner approval, probe (supplier accounts unchanged; a client credit not
listed or payable as a supplier; second opening balance refused), then deploy the app change.

**Closed:** applied 2026-11-16 as version 20261116092716 with owner approval; probed inside a rolled-back transaction
before committing and again after: all supplier accounts identical, a client's "we owe" balance neither listed nor
payable as a supplier, a second opening balance refused, function grants unchanged. App change pushed after.

### A29. Resuming a held sale lost its client (Medium) — closed 2026-11-16

**Found 2026-11-16** while adding Edit Client: `openHeld` (POS.jsx) restored only `client_name`; checkout found the
client by exact name (`creditCustomerFor`). A client renamed after the sale was held, or two clients with the same name,
meant the completed sale was saved without the client or against the other one, and a credit sale was refused for
having no customer. **Fixed:** the client is re-picked by the held sale's `client_id`. Test: `POS.held.test.jsx`
"Held sales linked to a client" (the same-name case fails on the previous code). Details:
[Client-Edit.md](../docs/architecture/Client-Edit.md) §3.

### A30. Client totals writable by members; anon grants on clients (Low) — closed 2026-11-16

**Verified live 2026-11-16 (read-only):** `clients` has no triggers; the only policy is "clients of own business" (ALL,
`current_business_ids()`); `authenticated` and `anon` hold every table privilege. So any member can PATCH
`visit_count` and `total_spend`, which are meant to come from sales (`refresh_client_totals`). Edit Client never sends
them. **Close by:** a BEFORE UPDATE trigger keeping both columns unless the caller is the totals function or a trusted
role, and revoking `anon`'s grants (RLS already denies it). Needs owner approval (changes access for existing roles).

**Closed** (owner's decision 2026-11-16: the Owner or staff given access): `carehub_20270122_client_totals_guard`,
applied with owner approval as version 20261116104753 after a probe in a rolled-back transaction, and probed again.
`can_adjust_client_totals(business)` (Owner, or a role with the new **canAdjustClientTotals** switch in Staff › Roles)
gates a BEFORE INSERT OR UPDATE trigger on `clients`: without it, a change to visits or total spent is refused and a
new client starts at 0; the database's own recalculation after each sale (`refresh_client_totals`, run as postgres) is
unaffected. `anon` lost every privilege on `clients`; `authenticated` lost TRUNCATE, REFERENCES and TRIGGER. Edit
Client shows the two figures to the Owner and permitted staff, noting the next sale recalculates them. Tests:
`apps/carefind/src/test/clients/clientTotalsGuard.db.test.js` (6, live helpers and grants; fails if the helper is not
executable by authenticated), `clientEdit.test.js`, `Clients.edit.test.jsx`. Advisor: the helper's SECURITY DEFINER +
EXECUTE warning is intended (it answers only for the caller), as `caller_owns_business`.

### A28. Supplier list: migration to apply (Low) — closed 2026-11-15

**What (2026-11-15):** bulk supplier import/export needed somewhere to keep contact details; suppliers were only names
on purchases. `carehub_20270119_supplier_directory` adds `suppliers` keyed by the purchases' supplier key, with RLS for
members, no DELETE, and a guard that keeps the key fixed. The app shows the list, import, Add / Edit details and the
contact columns in the export only once the table exists. Details and test plan:
[Supplier-Directory.md](../docs/architecture/Supplier-Directory.md). Tests: 10 PGlite (live helpers and grants), 24 app.

**Closed:** applied with owner approval as version 20261115224942; probed before committing (inside a rolled-back
transaction) and after: member add / edit accepted, same name in other capitals ignored, rename and delete refused,
another business sees nothing and cannot insert, anon refused. Security advisor: no finding for the table.

### A27. Owner's sales at a branch refused: "This sale is not authorized for your account." (High) — closed 2026-11-15

**Report (2026-11-15):** "blocked by the server … not authorized for your account" at the till, again and again.

**Verified 2026-11-15 (live definitions, read-only):** the message comes from the BEFORE INSERT trigger
`guard_sale_item_prices`. It recognised an Owner only when `businesses.email` of *the sale's own business* is theirs,
else it looked for a staff row there, else refused. The sales RLS policy (`current_business_ids()`) also gives an Owner
every branch below their business, and a branch is its own `businesses` row with its own email (all 3 live branches
differ from their parent). So the Owner passed RLS at a branch, had no staff row there, and the trigger refused the
sale. Queued sales show it most (they are posted under the location they were rung up at); online sales at a branch are
refused the same way. Queued sales are not lost: refused sales stay in the device queue and sync once the fix is live.

**Fixed:** `carehub_20270118_sale_guard_branch_owner` recognises an Owner when the sale's business is in
`current_business_ids()` and `caller_owns_business()` holds (the helper the live "owner manages own branches" policy
uses); nothing else in the trigger changes. Widens nothing RLS did not already allow: parent staff at a branch, a
branch outside the depth limit and strangers are still refused, and price overrides by staff still are. Tests:
`apps/carefind/src/test/pos/saleGuardBranchOwner.db.test.js` (10, PGlite, live helpers, policy and **function grants**;
reproduces the refusal first).

**Applied 2026-11-15** with owner approval as version 20261115222717, probed live before committing (inside a
rolled-back transaction) and after: Owner at a branch accepted, staff at catalog price accepted, stranger refused, staff
price override refused.

**Incident during the fix (2026-11-15, 21:38:11–21:39:23 UTC, 72 s):** the first version (20261115213811) called
`is_business_owner()`, which `authenticated` cannot execute (only `postgres` and `service_role`; its other callers are
SECURITY DEFINER). The trigger runs as the caller, so every signed-in sale was refused with "permission denied for
function is_business_owner". The live probe caught it and it was rolled back (20261115213923). No sale was recorded in
that window (last sale before it: 21:28:55); a till that tried one would have shown the error, and a queued sale stays
queued. Cause of the miss: the PGlite test granted EXECUTE by Postgres' default (PUBLIC); it now reproduces the live
grants and fails on that version. Lesson for every trigger that runs as the caller: check the live `proacl` of each
helper it calls, and probe new bodies inside a rolled-back transaction before applying.

**Remaining:** a till holding refused queued sales sends them on its next Sync.

### A26. Debts, supplier accounts and credit accounts: migration to apply (Medium) — closed 2026-11-15

**What (2026-11-14):** Receivables / Payables, part payments with history on debts recorded by hand, Excel/CSV debt
import (matching or creating customers and suppliers without duplicates) and export, Purchases › Supplier summary
(supplier accounts from purchases plus supply records, one payment applied oldest first) and POS › Credit customer
accounts. Details: [Debt-Accounts-and-POS-Stock-Limits.md](../docs/architecture/Debt-Accounts-and-POS-Stock-Limits.md).
POS stock limits (same note, §1) need no database change.

**Database:** `supabase/migrations/carehub_20270117_debt_and_supplier_accounts.sql` (written against the live schema
read 2026-11-14; 16 PGlite tests in `apps/carefind/src/test/debts/debtAccounts.db.test.js`). Until it is applied the app
works as before: debts can only be marked paid in full, the supplier summary shows purchase totals without supply
records or account payments, import says it is not available yet, and a customer-account payment that fits the oldest
visit is recorded on it.

**Reported 2026-11-15 as "debt upload not working; uploaded records neither processed nor displayed":** this is the
cause. Verified live that day: none of the migration's functions (`import_debts`, `get_supplier_accounts`, …) or
`debt_payments` exist, so every import stops at the preview. Its 24 PGlite tests pass on `main`.

**Done meanwhile (2026-11-15, no migration):** Record Debt links a typed debt to its client (created once when missing,
by name or phone, never guessing between two of one name) or supplier account, and **Link to clients** links the 3 live
unlinked receivables (note §2, "Record Debt: linking a debt typed in").

**Closed by:** applied to production 2026-11-15 with the owner's approval (version `20261115205734`) after checking no
later migration had changed the functions it replaces; the rolled-back live probe passed every step and the security
advisor shows only the intended new findings (results in the migration header). The 3 existing unlinked
receivables (three businesses; no name matched an existing client) were linked on 2026-11-15 with the Link to clients
rules: one client record created for each, notes "Added automatically when a debt was linked."; 0 left unlinked.

**Also found (not changed):** `anon` holds full table grants on `debts` (RLS denies it every row; revoke as defence in
depth). **Proposed:** a `suppliers` table so a supplier is an id rather than a normalised name (note §5); it would
re-key purchases and their functions, so it needs its own plan.

### A34–A38. Hospital Model findings (verified 2026-11-16)

Found while auditing the Hospital Model against the hospital upgrade specification. Full evidence, the gap matrix and the
recommended sequence are in
[Hospital-Model-Current-State-and-Gap-Analysis.md](../docs/architecture/Hospital-Model-Current-State-and-Gap-Analysis.md)
(§3.5 and §4). Verified against `main` at `7eadd23` and the live database (read-only).

- **A34 (High): clinical data is open to every role.** Each of `patients`, `triage`, `consultations`,
  `prescriptions`, `lab_requests`, `lab_results`, `imaging_requests` and `patient_messages` has one `FOR ALL`
  policy scoped only by business membership, so a Cashier can read every diagnosis and delete a patient. Every
  clinical foreign key is `ON DELETE CASCADE`, so deleting a patient deletes their clinical history. There is no audit trail.
  **Close by:** role-scoped read and write through checked functions, no client DELETE on clinical tables,
  retention-safe deletion, an append-only clinical audit. This changes access for existing roles and needs a plan
  approved first.
- **A35 (High): the Hospital Model boundary is UI-only.** No policy checks the business type (3 live patients belong to
  non-hospital businesses). `businesses.business_type` can be changed by the owner through the API: the `own business
  row` policy allows the update, `authenticated` holds column UPDATE, and neither `guard_business_privileged_columns`
  nor `businesses_operating_model_guard` checks the column. **Close by:** guarding `business_type` (platform-only,
  audited change), and hospital-only writes on the clinical tables.
- **A36 (High, production defect): the Doctor screen cannot send to Lab or Imaging.** `Doctor.jsx` writes
  `patient_name` to `lab_requests` and `imaging_requests`, which have no such column. The consultation and prescription
  are saved first, so a failure leaves partial records, and a retry duplicates the consultation. Also: `Lab.jsx` and
  `RxInbox.jsx` `JSON.parse` jsonb values that the live rows hold as arrays; Rx Inbox discharges the patient on dispense
  whatever is pending, without a stock deduction. Not reproduced through the API (read-only audit); the evidence is the code
  and the live columns. **Close by:** fixing the writes and reads, one atomic consultation function, with tests.
- **A37 (Medium): hospital schema not under version control.** None of the eight tables is created by a migration
  file. `anon` and `authenticated` hold every privilege, TRUNCATE included (same over-breadth closed for `export_logs`
  in A2). **Close by:** a baseline migration reproducing the live schema, verified on PGlite, then revoking the
  unneeded grants.
- **A38 (Medium, owner decision): two patient identities.** Reception writes `patients`; the "Patients" menu, POS,
  debts and appointments use `clients`. The specification requires one identity, reused. **Close by:** an owner
  decision on the identity of record, then a migration plan. This blocks the encounter model (Phase 1).

**Phase 0 (2026-11-17): closed A34–A38.** The owner decided `clients` is the patient identity, asked for Phase 0 and
approved applying it. Three migrations and the app change, applied in order with a rolled-back live probe before and
after (results in each migration header):
`carehub_20270123_hospital_schema_baseline` (a record of the live schema; a no-op on production; the eight tables leave
the migration drift ratchet's known gap), `carehub_20270124_hospital_access` (database-enforced clinical roles and
Hospital Model boundary, `business_type` platform-only, no client DELETE/TRUNCATE, history kept, append-only
`clinical_audit_log`), `carehub_20270125_hospital_identity_and_workflow` (patients linked to clients, atomic
registration, consultation and dispensing). Applied as versions 20261117092425, 20261117092614 and
20261117092916; the app change deployed after the third. Verified by 37 PGlite tests (`apps/carefind/src/test/hospital/`),
21 unit tests (`apps/carehub/src/modules/hospital/`) and the live probes. **Left for the owner:** 3 test patients of
2026-07-18 at pharmacies became clients in those pharmacies' lists and are kept there while their visit rows exist. Design, the per-role access table and what changes
for existing staff: [Hospital-Phase-0.md](../docs/architecture/Hospital-Phase-0.md).

### A39. Bulk-imported directory listings invisible to companies (High) — closed 2026-11-18

**What (verified live 2026-11-18):** 215 businesses (124 pharmacies, 91 hospitals) were bulk-imported by the platform
admin into the platform Business Directory on 2026-11-17, all with address, state, LGA, city and Nigerian
coordinates, all `unverified` (every import arrives unverified). Manufacturer / Importer companies saw none of them:
1. Field Report's "Possible nearby businesses" (`nearby_directory_businesses()`) returned verified listings only.
2. `field_activities_directory_link_guard()` refused to link an unverified listing to a report.
3. Facility Discovery, the companies' business directory, read registered `businesses` (plus map data) only; since
   `carehub_20261208` companies cannot read directory tables, so there was no path at all.

The records themselves were saved correctly, with no missing coordinates or places. The cause was the read paths.

**Fix (written, not applied):** `supabase/migrations/carehub_20270126_directory_listings_in_field_and_discovery.sql`
defines one eligibility rule (platform, active, not demo, not rejected; unverified kept and labelled) for the
suggestion, the link guard and a new read-only `discover_directory_listings()` (name / category / type text,
state / LGA / city, radius). Callers must belong to a Manufacturer / Importer or Wholesale business, or be platform staff. The
CareHub Discovery engine adds the directory as a source, keeps its recorded verification, and reports when the
directory could not be read. **Security:** widens company access from "verified listings within 1 km, no contact" to
every eligible listing with business phone and coordinates (no e-mail, contact person or notes); tightens who may call
the nearby function. Details: [CareHub-Business-Directory-and-Discovery.md](../docs/architecture/CareHub-Business-Directory-and-Discovery.md).

**Verified:** 34 PGlite tests (the defect reproduced first), 7 engine tests (fail on the old code), the full CareHub
suite and build. A rolled-back live probe as a real Manufacturer / Importer account found the following.
Field suggestion at the first import's position: 4 listings including it. Discovery nationwide: 216 (215 imports + 1
verified OSM listing). Keyword "pharmacy": 124. Keyword "hospital": 95. Within 5 km: 48, nearest first. Name search
finds it. A report linking an import is refused before the change and accepted after. Direct table reads: 0 rows.
A pharmacy account is refused. Production was confirmed unchanged afterwards.

**Closed by:** the app change deployed (`a5b183a`), then the migration applied with the owner's approval (version
`20261118114804`). The post-apply probe repeated every result above against production (the report insert rolled
back; no probe row left), and confirmed the grants: both functions executable by `authenticated` only, the link guard
by no API role. **Verified 2026-11-18 (owner instruction):** all 215 imports set to `verified` in one statement, scoped to platform,
active, unverified `import` rows; `verified_at` stamped by the trigger, `verified_by` set to "owner-approved bulk
verification of 2026-11-17 import (Claude Code session, 2026-11-18)" because no admin session was signed in; one
`admin_audit_log` entry (id 11, action `directory.bulk_verify`) lists all 215 ids. After: directory 216 verified
(215 imports + 1 external), none unstamped; a Manufacturer / Importer account sees all 216 as verified in Discovery
and Field Report. **Note:** this was a bulk owner decision, not a per-business check; to undo, set the ids in audit
entry 11 back to `unverified` (the trigger clears the stamp).

### A40. Delivery map popups rendered names as HTML (Medium) — closed 2026-11-18

**What:** `apps/carefind/src/components/shop/DeliveryTrackingMap.jsx` built its Leaflet popups as
`<strong>${pickupStation.name}</strong><br/>${pickupStation.address}` and the same for the delivery address, unescaped.
A station name or an address containing `<img src=x onerror=...>` would run in the customer's (or public tracking
page visitor's) session when the marker was opened.

**Closed by:** the map switch to the shared engine ([Maps.md](../docs/architecture/Maps.md)): every popup is a DOM node
built with `textContent`. Test: `apps/carefind/src/components/maps/__tests__/maps.test.jsx` ("a station name or
address with HTML stays text").

## 3. Open items recorded in other audits

Not re-verified in this review; see each document for evidence and status.

| Source | Open items |
|---|---|
| [PV routing audit](../docs/audits/carefind-carehub-pv-routing-audit.md) | P1-1 no notifications on routing events; P1-2 unknown/typed-company routes are dead ends; P1-3 tracker picks an arbitrary route per report; P1-4 companies cannot open private attachments (no signed URLs); P1-5 follow-ups on public cases reach nobody; P1-6 tracker has no refresh; P1-7 routed-company visibility of patient fields needs privacy-lead sign-off. (P0-1: see A1.) |
| [Financial figures consistency audit](../docs/audits/2026-10-31-financial-figures-consistency-audit.md) | F7 store money in kobo; a server-side `sales_summary` as the figure of record; per-business time zone; device clock skew. |
| [Live field activity audit](../docs/audits/live-field-activity-audit.md) §18.4 | Retention period for report positions; NDPA lawful basis review for location capture; whether owners can correct or remove reports; one timing-sensitive test; F2 and F10 owner decisions. |
| [Pending migrations](../docs/architecture/pending-migrations/README.md) | `purge_old_report_coordinates` held for the retention decision; `orders_read_scope` held for the warehouse-access decision. |
| [ADR privacy and security audit](../docs/architecture/ADR-Privacy-Security-Audit.md) | Reporter masking interim until the privacy lead rules; routing/follow-up notification templates need comms and privacy sign-off. |

## 4. Recently closed

| Item | Closed in |
|---|---|
| POS: a hold saved offline (or after a failed request) was missing from Held Sales until it synced; a sync did not refresh the list; a failed read showed "No held sales" | Record-Filters-POS-Customers-and-Held-Sales.md §4 (2026-11-09) |
| Clients: a failed load showed "No clients yet" | Record-Filters-POS-Customers-and-Held-Sales.md §2.2 (2026-11-09) |
| A1: PV routing write guard verified live (no code change needed) | live probe 2026-11-02; result in `carehub_20261113_adr_route_write_guard` |
| A2: `export_logs` append-only, actor stamped by the database | `carehub_20261231_export_logs_append_only` (live 2026-11-02) |
| Stored XSS in ADR print documents (concomitant medication fields from the public form) | PR #39 (`e171e47`) |
| CSV formula injection in admin and ADR exports | PR #39 (`e171e47`) |
| Admin confirmation dialogs rendered no explanation (`message`/`variant` vs `consequence`/`danger`) | PR #39 (`e171e47`) |
| Dialogs opened from a detail sheet appeared behind it | PR #39 (`e171e47`) |
| Admin dashboard hooks after early returns | PR #39 (`88627c7`) |
| Platform staff had no audited way to change a plan (raw PATCH, no reason or actor) | PR #39, migration `carehub_20261230_admin_subscription_management` |
| Money › Revenue showed ₦0 from an empty mirror table | PR #39 (`7255952`) |
