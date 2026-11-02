# Importer & Manufacturer Operating Models

How a pharmaceutical importer or manufacturer runs its sales representatives in CareHub: **Centralised** or
**Decentralised**, the representative ledger and statements that work under both, and switching between the two.

Spec: "CareHub | Importer & Manufacturer Operating Structures" (owner, 2026-11-02).
Migration: `supabase/migrations/carehub_20270102_importer_operating_models.sql` (**not applied**).
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
5. **Facility Discovery** is not in the Owner preset for any business today (only a custom role can grant it), so a
   representative account, whose rep is its `Owner`, does not get it either. The `Representative` role the database
   creates on a switch back to Centralised includes it. *Open question:* add `discovery` to the Owner preset.
6. **Representative accounts count as locations** in the plan's location limit (the existing `guard_business_insert`
   counts the whole tree). The switch bypasses that guard, so it never blocks a switch, but a company on a small plan
   may then be unable to add a branch. *Open question:* exclude `rep_account` rows from the count, or bill them.

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
| A rep with no active login (to Decentralised) | Blocker: wait for acceptance, or make the rep inactive |
| Held sales a rep left on the company POS (to Decentralised) | Warning: they stay company sales |
| Rep-account stock the company does not carry (to Centralised) | Warning: it stays in the rep's archived account |

**To Decentralised:** each active rep gets their account (their previous one if it exists), their staff row moves into
it with role `Owner` (their company role is remembered), and their custody moves from company stock into the account
(the owner may lower the quantities; it is capped at company stock, with a note).
**To Centralised:** every rep's staff row returns to the company with their remembered role (or a created
`Representative` role), stock in their account that the company carries returns to company stock and is recorded as
their custody, and the account is kept as history (`account_dormant_since`).

Balances and ledger history are never touched. `operating_model_changes` (append-only) records who switched, when,
from and to, the reviewed summary, the result and exceptions; `audit_log` records it too. Reps and the owner are
notified (`staff_notifications`).

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

## 8. Test plan

- **Database (PGlite)**: `apps/carefind/src/test/operating-models/operatingModels.db.test.js`, 36 checks on one company
  through Centralised work, a switch to Decentralised with a custody plan, independent-account work and privacy, a
  switch back, and a second switch forward reusing the accounts: credit supply, payment, pending and accepted returns
  (accepted value), damaged returns, custody limits, transfers and pending transfers (as a pair), adjustments, reversals
  (once, not of a reversal, both halves of a transfer, stock undone), idempotent replays, statements (opening balance
  carried forward, running balance, totals, summary), access (rep sees only own, viewer vs plain staff vs another
  company), append-only, browser writes refused, blockers, stale preview, public visibility, registration default.
- **Unit**: `src/modules/representatives/__tests__/` (services, repository with a recording transport, the page and
  the switch flow), `src/lib/__tests__/permissions.test.js` (navigation by context), `api/__tests__/registerBusiness.test.js`.
- **Manual, after applying** (in a rolled-back probe first, as for earlier migrations):
  1. Register a test importer choosing Decentralised; confirm `operating_model`.
  2. On an existing importer: add two reps, record a supply, payment, return (pending then approved), transfer and
     adjustment; print and export both statement views; check the summary totals.
  3. Switch to Decentralised: sign in as a rep, confirm their own POS and stock, the company catalogue, that the
     company's and the other rep's records are unreachable, and that nothing of theirs appears on CareFind.
  4. Switch back: confirm stock, custody, balances and history; then forward again and confirm no duplicate accounts.
  5. Confirm Directory search, reports, AI features and the Live Feed behave as before in both models.

## 9. Applying

Apply the migration, then deploy the client. The client tolerates the migration being absent (new screens say
"not available yet", nothing else changes), but the new screens need it. After applying: re-read the function
bodies and grants, run the security advisor, and run a rolled-back probe as a real owner (supply, statement, preview).
