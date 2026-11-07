# Importer & Manufacturer Operating Models

How a pharmaceutical importer or manufacturer runs its sales representatives in CareHub: **Centralised** or
**Decentralised**, the representative ledger and statements that work under both, and switching between the two.

Spec: "CareHub | Importer & Manufacturer Operating Structures" (owner, 2026-11-02; gap review and completion 2026-11-04).
Migration: `supabase/migrations/carehub_20270102_importer_operating_models.sql` (**applied 2026-11-04**, §10).
Code: `apps/carehub/src/modules/representatives/`.

> The operating model changes how the company and its representatives work. It never reduces the platform: every
> CareHub and CareFind module stays available under both models.

## 1. The two models

| | Centralised | Decentralised |
|---|---|---|
| Representative's login | Staff of the company account | Staff (role `Owner`) of their own **representative account** |
| POS, stock, prices | The company's; prices set by the company (a role must allow `canEditPrice`) | Their own POS, stock, selling prices, sales and records |
| Company account | Representatives sell through it | Representatives can only **view** the company catalogue and prices (`rep_company_catalog`); only company staff transact in it |
| Privacy | Activity attributed to each rep inside the company records | A rep reaches only their own account (`current_business_ids()` gives staff one business) |
| Representative ledger and statements | Yes | Yes |

A representative account is a child `businesses` row of the company with `account_kind = 'rep_account'`. Reusing the
branch structure is what keeps every module working unchanged (POS, inventory, the stock ledger, purchases, expenses,
debts, clients, reports, field activity, notifications) because they all already work per business. The company owner
keeps oversight through the business tree, as for branches.

A representative account hides only what would publish it, open branches under it, or administer the company
(`REP_ACCOUNT_HIDDEN` in `lib/permissions.js`: overview, locations, master catalogue, CareFind profile, online store,
warehouses, staff, wallet, report-field setup) and the field-team manager pages.

A representative account is **not a location**: it does not count against the plan's location limit
(`guard_business_insert`, `business_billing_overview`), and the Locations page lists it separately ("Representative
account", "Open this account") and leaves its sales out of the company's combined figures.

## 2. Decisions taken (review these)

1. **Existing importers start Centralised.** That is how they work today (reps are company staff). A new importer is
   created Centralised by the database and the registration form records the owner's choice.
2. **Stock under Centralised stays in the company's count.** The spec has reps selling "through the company's central
   POS and inventory". If a supply took stock out of the company, the rep's sale on the central POS would take it out a
   second time. So a Centralised supply records the goods in the rep's **custody** (`rep_custody`) and the company stock
   is reduced when the sale is rung up. A good return reduces custody; a damaged or expired return reduces custody and
   writes the goods off company stock. Under Decentralised the stock really moves (company → rep account and back).
   *Open question for the owner:* if reps in Centralised take goods away and sell them **without** ringing them on the
   company POS, supplies should take stock out instead; that is a small change in `rep_entry_apply_stock`.
3. **Sales on the central POS do not reduce a rep's balance automatically.** They are company sales; when the company
   counts the money against the rep it records a payment. Automating this needs a rule for which sales count.
4. **Products move between accounts by master catalogue item** (`products.master_product_id`), as branch transfers do.
   An unlinked company product can be supplied under Centralised but not moved to a rep account; the database says so.
5. **Facility Discovery is in both models** (spec 5.1, decided 2026-11-04). It is now in the Owner preset (so the
   company owner and a rep running their own account have it), in the default rep login (`FIELD_REP_NAV`) and the
   "Field Rep" role template, and in the `Representative` role the database creates on a switch back. The registry
   still limits it to manufacturers and wholesalers. Custom roles a company already saved keep their own menu.
6. **Representative accounts are not locations** (spec 5.5, decided 2026-11-04). Counting them would let a switch to
   Decentralised use up the plan's branch allowance. Both counting functions skip `account_kind = 'rep_account'`.
   *Revisit* if the owner wants to bill per representative account; that is a pricing change, not a code one.
7. **Open field orders in a rep account block a switch to Centralised**: the rep loses access to the account, so
   nobody who knows the order could finish it, and it would likely be raised again centrally (spec 9.3: never lost or
   double-processed). Open company orders a rep raised (switch to Decentralised) stay company orders and are listed.
8. **Customers' unpaid credit in a rep account** stays in the archived account on a switch to Centralised. Nothing is
   moved or written off; the preview lists it and the owner can collect from that account (Locations).
9. **Company field managers do not see activity inside representative accounts** under Decentralised. The owner does
   (open the account from Locations). *Proposal, not built:* let a company role with "Manage field team" read field
   activity of the company's own rep accounts. It widens row level security across businesses, so it needs the owner's
   and the privacy lead's sign-off first.

## 3. The ledger

`rep_ledger_entries` + `rep_ledger_lines`, append-only (triggers refuse `DELETE` and any `UPDATE` except deciding a
pending entry inside the functions). Balance = posted debits − posted credits; positive means the rep owes the company.

| Entry | Effect on balance | Recorded with |
|---|---|---|
| `supply` | debit | products, quantities, agreed supply value, date, rep, reference |
| `payment` | credit | amount, date, method, reference, recipient |
| `return` | credit (accepted value) | products, quantities, condition, accepted value, approver; may wait as `pending` |
| `transfer_out` / `transfer_in` | credit sender / debit receiver | one `transfer_group`, reason, approval; may wait as `pending` |
| `adjustment` | debit or credit | reason and reference required |
| `reversal` | the mirror of one posted entry (both halves of a transfer) | reason; undoes the stock effect; once per entry |

Every write is a `SECURITY DEFINER` function that checks the caller, does the whole job in one transaction (entry,
lines, stock movements through `apply_stock_change`, custody, `audit_log` row) and is replay-safe on a request key.
A rep's own selling price lives on their account's products; the agreed supply value lives on the ledger line, so the
two never mix (spec 4.3).

A reversal of a stock-moving entry is refused once the company has changed model since that entry (the stock is in a
different structure); an adjustment is used instead.

### Who may do what

| Action | Allowed |
|---|---|
| Record, approve, reverse, add/deactivate reps | Owner, platform admin, role with `canManageRepLedger` |
| View every rep's statement and the summary | the above, or a role with `canViewRepLedger` |
| View own statement | the representative |
| Change the operating model | Owner, platform admin |

The two role switches are in Staff > Roles & Permissions (importers only). `rep_ledger_can()` reads them.

### Transaction register (spec 7 and 8)

Representatives > **Transactions**: `rep_ledger_register(company, from, to, rep, type, product, territory)` lists every
entry in the period (posted, pending and rejected, each marked) in date order, with its products, the representative
and their territory, the model it was recorded under and its **audit trail**: recorded by, approved or rejected by
(with the note), what it reverses and what reversed it. Only posted entries count in its totals. Filters:
representative, transaction type (`transfer` = both halves), product (a reversal matches through the entry it
reverses), territory and date range. Print/PDF and spreadsheet export; 200 rows a page with "Show more". Ledger viewers
only. The detailed statement and its exports also show who recorded and approved each line.

**Territory** is the representative's location for reports: `company_representatives.territory_id`, one of the
company's own territories (Territories page), set on the representative's card by a ledger manager
(`set_representative_territory`, audited). The consolidated summary takes the same territory filter.

## 4. Statements

`rep_statement(rep, from, to)` returns company and rep details, period, generation time, currency, opening balance
(everything posted before the period), every posted entry in the period in date order with a running balance, totals
by type, closing balance, position (`owes` / `credit` / `settled`) and pending items (listed, not counted). The closing
balance of one period is the opening balance of the next by construction.

The **Summary** and **Detailed** statements are two views of that one result. Both print to PDF (print-ready HTML, as
in ADR-Exports.md) and export to a spreadsheet. `rep_ledger_summary(company, from, to)` gives the consolidated figures
for every representative; the Consolidated summary tab exports it.

## 5. Switching

Settings > Operating model (importer's main account, Owner). Two steps:

1. `operating_model_preview(company, target)`: what changes, each rep (balance, whether they convert, whether their
   old account is reused), custody or rep-account stock, **blockers** and **warnings**, and a state token.
2. `switch_operating_model(company, target, token, stock_plan, note)`: refused if the state changed since the preview
   or if a blocker remains; otherwise one transaction. Any failure rolls the whole switch back, so a company is never
   left half converted. The way back is the reverse switch.

| Pending item | Handling |
|---|---|
| Returns / transfers awaiting approval | Blocker: approve or reject first |
| Held sales in a rep account (to Centralised) | Blocker: complete or delete |
| Stock transfers in transit to/from a rep account (to Centralised) | Blocker: receive or cancel |
| Open field orders in a rep account (to Centralised) | Blocker: deliver, reject or cancel |
| A rep with no active login (to Decentralised) | Blocker: wait for acceptance, or make the rep inactive |
| Held sales a rep left on the company POS (to Decentralised) | Warning: they stay company sales |
| Open orders a rep raised on the company account (to Decentralised) | Warning: they stay company orders; company staff finish them |
| Rep-account stock the company does not carry (to Centralised) | Warning: it stays in the rep's archived account |
| Customers' unpaid credit sales in a rep account (to Centralised) | Warning: they stay in the archived account; the owner can collect |
| Unpaid supplies (rep balances) | Carried over unchanged, both ways |

**Reconciliation and rollback (spec 9.2, 9.4).** Inside the switch, `operating_model_reconciliation` is taken before
and after: ledger entries, pending entries, every representative's balance, stock units by master item across the
company and every rep account it has had, and stock value at company cost. Any difference raises, which rolls the whole
switch back ("nothing changed"). The figures are stored with the change (`result.reconciliation`) and shown to the
owner after the switch. Custody is reported but not compared (it becomes account stock and back by design).

**To Decentralised:** each active rep gets their account (their previous one if it exists), their staff row moves into
it with role `Owner` (their company role is remembered), and their custody moves from company stock into the account
(the owner may lower the quantities; it is capped at company stock, with a note).
**To Centralised:** every rep's staff row returns to the company with their remembered role (or a created
`Representative` role), stock in their account that the company carries returns to company stock and is recorded as
their custody, and the account is kept as history (`account_dormant_since`).

Balances and ledger history are never touched. `operating_model_changes` (append-only) records who switched, when,
from and to, the reviewed summary, the result (with the reconciliation) and exceptions; `audit_log` records it too.
Reps, the owner and company staff whose role manages or views representative accounts are notified
(`staff_notifications`).

## 6. CareFind visibility

The company's own account stays the public catalogue under both models. A representative account is forced off every
public surface by the database: `visible_on_carefind`, `ecommerce_enabled` and `booking_enabled` are forced false,
its products are forced to `list_on_carefind = false`, and it cannot list on the online store.

## 7. Security notes

- New `SELECT` policy on `businesses`: a member of a rep account can read that account's row (needed to sign in; a
  branch's staff cannot read a non-public branch row today, a gap this does not widen).
- Moving a staff row between businesses happens only inside the switch and `add_company_representative`, which run as
  the function owner (trusted by `guard_staff_writes`, as `remove_staff_member` is). Id, email, login and invitation
  columns never change.
- `NULL` handling: the statement check uses `coalesce(..., false)`; a non-representative's `caller_representative_id()`
  is `NULL` and would otherwise pass a `NOT (a OR NULL)` test (caught by the PGlite suite).
- Exports are not written to `audit_log`: `record_export_audit` has an allow-list that does not include statements, and
  a statement is the rep's own data or data the viewer is entitled to read. Add `rep_statement.xlsx` to the allow-list if
  the owner wants exports audited.

## 8. Spec traceability

| Spec | Where |
|---|---|
| 2 Model chosen at registration | Register form (Manufacturer / Importer, restored 2026-11-07) → `/api/register-business` → `set_registration_operating_model` (server verified live) |
| 3.1 Company prices, central POS and stock, rep attribution | Reps are company staff; `canEditPrice` per role; sales carry `cashier_staff_id` |
| 3.2 Individual ledger: supply, payment, return, transfer, all details | `record_rep_*`, `rep_ledger_entries/lines` (§3) |
| 3.3 Account statement (opening, running, closing, company/rep details, position) | `rep_statement`, Representatives > Statement |
| 3.4 Summary and detailed views, date range, PDF and spreadsheet, consolidated | Statement views and exports; Consolidated summary tab |
| 4.1 Private rep accounts | `rep_account` child business; `current_business_ids()` gives a rep one business |
| 4.2 Reps view company catalogue, cannot sell through it | `rep_company_catalog`; reps are no longer company staff |
| 4.3 Supplies, payments, returns, transfers; supply value separate from retail price | Same ledger; stock moves between accounts; value on the ledger line |
| 5.1 Directory and location-based facility search | Facility Discovery in Owner preset, rep login and templates (decision 5) |
| 5.2 Reporting intact; attribution vs privacy | Every report module unchanged and per business; register and summary for the company |
| 5.3 AI intelligence | Demand and product insight modules unchanged, per business (no cross-account data) |
| 5.4 Live Feed | Field (live activity) in both models; per business RLS unchanged (decision 9) |
| 5.5 Nothing removed | Rep accounts keep every operating module; not counted as locations (decision 6) |
| 6 CareFind shows the company catalogue only | §6 triggers |
| 7 Company management, filters, exports, audit trail | Representatives page; Transactions register; territories |
| 8 Transaction records and balance treatment | §3; adjustments and reversals need reason, reference, audited |
| 9 Switching both ways, summary, preservation, reconciliation, rollback, notification | §5 |
| 10 Access control and integrity | §3 "Who may do what", §7 |

## 9. Test plan

- **Database (PGlite)**: `apps/carefind/src/test/operating-models/operatingModels.db.test.js`, 43 checks on one company
  through Centralised work, a switch to Decentralised with a custody plan, independent-account work and privacy, a
  switch back, and a second switch forward reusing the accounts: credit supply, payment, pending and accepted returns
  (accepted value), damaged returns, custody limits, transfers and pending transfers (as a pair), adjustments, reversals
  (once, not of a reversal, both halves of a transfer, stock undone), idempotent replays, statements (opening balance
  carried forward, running balance, totals, summary), access (rep sees only own, viewer vs plain staff vs another
  company), append-only, browser writes refused, blockers, stale preview, public visibility, registration default; the
  transaction register (audit trail, every filter, access), territories, open orders and customer credit in the
  preview, admin notifications, reconciliation recorded both ways, a tampered switch rolled back completely, and
  representative accounts not counted against the plan's locations.
- **Unit**: `src/modules/representatives/__tests__/` (services, repository with a recording transport, the page and
  the switch flow), `src/lib/__tests__/permissions.test.js` (navigation by context), `api/__tests__/registerBusiness.test.js`.
- **Manual, after applying** (in a rolled-back probe first, as for earlier migrations):
  1. Register a test importer choosing Decentralised; confirm `operating_model`.
  2. On an existing importer: add two reps, record a supply, payment, return (pending then approved), transfer and
     adjustment; print and export both statement views; check the summary totals.
  3. Switch to Decentralised: sign in as a rep, confirm their own POS and stock, the company catalogue, that the
     company's and the other rep's records are unreachable, and that nothing of theirs appears on CareFind.
  4. Switch back: confirm stock, custody, balances and history; then forward again and confirm no duplicate accounts.
  5. Confirm Facility Discovery (search hospitals in an LGA), reports, Demand intelligence and Field (live activity)
     work for the owner, a Centralised rep and a Decentralised rep; and that Locations shows rep accounts separately.
  6. Representatives > Transactions: filter by rep, type, product and territory; print and export.

## 10. Applying

**Applied to production 2026-11-04** in seven parts split at the file's section boundaries (every statement is
re-runnable), recorded in the migration history as `carehub_20270102_importer_operating_models_1_columns`, `_2_ledger`,
`_3_accounts_stock`, `_4_recording`, `_5_statements`, `_6_switching`, `_7_locations_grants`. The two live importers
started Centralised.

Checks before applying: every function, column and trigger the migration depends on exists live; the live triggers on
`businesses`, `staff` and `products` that the PGlite fixture does not model (branch email, verified owner, privileged
columns, staff plan limit, master-catalogue link) accept what the migration does.

Verification after applying:
- **Fidelity:** md5 of each of the 48 function bodies in production equals the repo file loaded on PGlite.
- **Security advisor:** nothing new. The only new entries are the app-callable functions under "authenticated security
  definer function executable" (intended; each checks its caller). None is executable by `anon`; every new table has
  RLS.
- **Rolled-back probe** as the owner of a real importer (a `DO` block ending in a raised exception, so nothing was kept;
  nothing on the touched tables calls outside the database):

| Check | Result |
|---|---|
| Owner's browser update of `operating_model` | refused |
| Add a staff member as representative | REP-001 |
| Supply 2 units at ₦100 on credit; same request key again | posted ₦200; replay returned the first entry |
| Payment ₦50 | balance ₦150 |
| Statement | opening ₦0, 2 entries, closing ₦150, "owes" |
| Register filtered by type and product; summary | 1 supply, recorded by the owner; summary closing ₦150 |
| Switch to Decentralised | no blockers; 1 converted; reconciled (691,317 units before and after); custody of 2 moved: company 999 → 997, rep account 2 |
| Rep account | `rep_account`, off CareFind, no shop; the rep's login moved into it |
| As the representative | sees only their own account; company catalogue readable; own statement ₦150; company products visible only as the public CareFind listing (existing public policy) |
| Switch back to Centralised | 1 converted; reconciled; rep back in the company with their previous role; company stock 999 again; custody 2; balance ₦150; 2 history rows |

## 11. Live end-to-end check (2026-11-06 to 2026-11-07)

Driven through the live app at carefindhub.com with Playwright (a real browser), against production, on a dedicated QA
company. Scripts are not in the repository; the evidence is below.

**Test data.** "QA Importer E2E Ltd" (`owner.importer-e2e@carehub.test`), created through `/api/register-business`;
three QA staff (`rep1`, `rep2`, `manager` `.manufacturer@carehub.test`, created with
`mint_confirmed_auth_user` and the QA seed's password); three master-catalogue products. The email-verification and
admin-approval steps were done in SQL (the `.test` inbox does not exist). Three QA products and the original QA
manufacturer (`owner.manufacturer@carehub.test`, password unknown and left alone) are untouched apart from those products.

| Area | Result |
|---|---|
| Registration choosing Decentralised | **Form:** Manufacturer / Importer is not offered (see below). **Server:** the same request the form sends created the company pending, `manufacturer_importer`, Decentralised, with a "Chosen at registration" history row. |
| Owner, Decentralised from the start | Settings shows the model and history; adding both reps gave each their own account at once (REP-001, REP-002, "Own account"). |
| Reps signing in, Decentralised | Own POS, Stock Management, Purchases, Field, Facility Discovery, My company account with the catalogue (company products and prices); no company admin or public modules. |
| Switch to Centralised | Summary, confirm, reconciled; reps back as company staff with their previous role. |
| Reps signing in, Centralised | **Failed first** (defect 1); after the fix: company POS, no stock or purchase management, own statement only, no catalogue tab. |
| Every entry type (Centralised) | Supply ₦10,000 (custody, company stock unchanged); return left pending, approved from Awaiting approval (₦1,800); damaged return (company stock 200 → 199); transfer Ada → Bayo ₦2,700 (both balances); adjustment refused without a reference, then recorded; payment by the owner; payment by the Sales Manager role; reversal from the statement. Final balances Ada ₦1,300, Bayo ₦2,700, matching the database; every action in `audit_log`. |
| Statement | Detailed and Summary views; opening and closing rows; position "Owes the company"; print view with company, rep, period and running balance; spreadsheet (Summary and Transactions sheets, closing 5300); Transactions register; Consolidated summary totals. |
| Switch to Decentralised with a custody plan | Owner moved 2 of Ada's 4 Amoxil: reconciled (₦4,000 owed, 9 entries, 599 units before and after); company 194, Ada 2 + 5, Bayo 3; rep products off CareFind. |
| Decentralised work and isolation | Supply moved 10 units company → Ada (₦10,300 owed); each rep's Stock Management shows only their own products; no company figures. |
| Switch back, then forward again | Back: stock and custody restored, accounts archived, balances kept. Forward: "Gets their previous account back", still 2 rep accounts, stock back in each. 5 history rows. |
| Facility Discovery, Financial Reports, Field, Demand | Open without error for the owner, a Decentralised rep, a Centralised rep and the Sales Manager. Facility search first found 0 (defect 3; OpenStreetMap is not reachable from the test environment); after the fixes a Lagos search returns CareHub's own businesses and no rep account (defect 4). |

**Defects found and fixed**

1. **Staff of a business not listed on CareFind could not sign in** ("No CareHub business or staff account matches
   this email"). They could not read their own business row. Fixed by
   `carehub_20270104_staff_read_own_business` (applied with the owner's approval). Also affected any unlisted
   pharmacy or clinic with staff.
2. **A rep running their own account got two refused requests on their dashboard**: the field-team check-in overview
   (the database's manager check does not accept staff with the Owner role) and the daily stock alerts written to
   the owner's notifications. `DashboardHome` now skips the overview for staff with the Owner role and sends their
   alerts to their own notifications; "Places to confirm" is hidden in representative accounts for the same reason.
3. **Facility Discovery's CareHub search returned nothing whenever a filter was left blank** (pre-existing, every
   business type): blank filters were sent as '' and the database dropped every business with no LGA or city
   recorded (all 13 in Lagos). `discoverFacilitiesPath` now leaves blank filters out.

4. **Facility Discovery listed representative accounts.** Its database search (`discover_facilities_cursor`) reads
   every businesses row, so with defect 3 fixed any company searching an area saw representatives' private accounts
   (name, city, phone). Fixed by `carehub_20270105_discovery_excludes_rep_accounts` (applied with the owner's
   approval): representative accounts and deleted businesses are skipped. Re-checked live after deploying: no
   refused requests on a rep account's dashboard, "Places to confirm" hidden there, Lagos search returns results and
   no rep account.

**Owner decision found, then taken:** the sign-up form had not offered Manufacturer / Importer (or Wholesale) since the
landing page redesign of 2026-09-02, so spec section 2 was unreachable from the form. On 2026-11-07 the owner had it
restored: `BUSINESS_TYPES` lists Manufacturer / Importer again (the landing page lists it too, with its own note), the
sign-up taxonomy test allows it the enterprise modules, and `Register.importer.test.jsx` drives the form through the
operating-model choice. Wholesale stays off the form.

