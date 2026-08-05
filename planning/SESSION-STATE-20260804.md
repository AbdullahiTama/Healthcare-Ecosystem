# Session state — 2026-08-04 (resume here)

Working state for the **repository-seam architecture rollout**, plus two production
fixes that happened alongside it. Everything below is committed; the working tree
was clean at the end of the session.

Canonical trackers remain `planning/CODE_AUDIT.md` and
`architecture/Technical-Debt.md` — this file is the "where were we" note, not a
replacement for either.

---

## 1. Repository-seam rollout (the architecture workstream)

> **Updated 2026-08-05:** `debts` + `purchases` have since been migrated as the
> next unit. See §7 at the bottom for that pass; the table below is superseded
> by it.

**5 of 24 modules are on the seam. 16 have nothing at all.**

| Status | Modules |
|---|---|
| Fully off `services/supabase` | `inventory`, `expenses`, `clients` |
| Own aggregate on the seam, cross-aggregate residual (flagged in-file) | `orders`, `pos`, `purchases`* |
| Untouched | `appointments`, `carefind`, `consultation` (3 files), `dashboard-home`, `debts`, `demand`, `live-activity`, `locations`, `messages`, `referral-agent`, `reports`, `settings`, `staff`, `stock`, `territories`, `warehouses` |

\* `purchases` only had its *product* writes moved, as a side effect of the C5
work. Its own purchase aggregate is still on `services/supabase`.

### The pattern to copy

`createXRepository({ request = sbFetch, ...collaborators })` — a factory taking an
injected transport with `sbFetch`'s shape `(path, options) => Promise<rows>`.
Production binds the real one; tests bind `src/test/inMemoryClient.js`. Two
concrete adapters are what make the seam real. Inject a collaborator for anything
that is not the transport — `orders` injects `upload` and `notify`, `pos` injects
`offline` and `isOnline` — because that is what makes fan-out and branching
assertable without a network.

Every migrated repository scopes reads and writes by `business_id`. Cross-aggregate
calls that belong to unmigrated modules stay imported from `services/supabase`
and are commented as such at the import site.

### Recommended next unit: `debts` + `purchases` together

Not an arbitrary pick — they are coupled:
- both share `updateDebt`, the **last id-only PATCH on a money table** (POS and
  Debts both call it, which is exactly why it was left alone rather than changed
  from under an unmigrated module);
- `purchaseRepository` and `debtRepository` already exist but sit **misplaced and
  unused inside `inventory/repositories`** — migrating these two modules is what
  lets them move to where they belong;
- it is a contained unit, versus an open-ended march through 16 modules.

### Why the rollout has been worth doing

Every bug found this session was found *by* migrating a module, not by looking for
bugs: the unscoped order PATCH, the offline-sync data loss, and five id-only
writes. The 16 untouched modules are 16 more places nobody has read at that depth.

---

## 2. Applied to production this session

Both on explicit authorization, both as **tracked** migrations (recorded in
`supabase_migrations.schema_migrations`) — untracked direct changes are what
produced C16 and C17.

- **C17 — `credit_wallet` dropped.** `SECURITY DEFINER`, `EXECUTE` to `anon`,
  credited a caller-supplied `p_user` with a caller-supplied `p_coins`. Anyone
  with the public anon key could mint wallet balance without signing in.
  Superseded by `credit_wallet_topup` in C15 and never dropped — the *identical*
  mistake C15 itself found with the leftover `send_gift` overloads. See
  `apps/carefind/sql/drop_leftover_credit_wallet.sql`.
- **C5 — sales now decrement stock.** `sale_stock_movement` trigger +
  `increment_product_stock()` RPC, both `SECURITY INVOKER` with pinned
  `search_path`. See `apps/carehub/sql/20260804_sale_stock_movement.sql`.

---

## 3. Open items that need a human decision

1. **Stock backfill / physical count (operational, affects real businesses).**
   C5 was fixed forward-only by decision: 29 of 83 historical line items (35%)
   reference product ids that no longer exist, so replaying sales history could
   not be trusted. **Every business's `products.stock` is still overstated by
   everything they have sold to date** and only a physical count corrects it.
   Nothing in the codebase will fix this.
2. **Clamp vs negative stock.** The decrement uses `greatest(0, ...)` to match
   POS's existing `Math.max(0, ...)`. That hides oversells; a plain subtraction
   would surface "sold more than you had", arguably the better signal for a
   pharmacy. One-line change in the SQL file.

## 4. Known-open, not touched this session

Security (surfaced by `get_advisors`, all pre-existing):
- `staff_directory` and `professional_earnings` are `SECURITY DEFINER` **views**
  (ERROR level — views bypass RLS by default).
- `public.Inventory` has RLS enabled and **zero policies**.
- Five functions with mutable `search_path` (`handle_new_user`,
  `increment_story_view`, `increment_post_view`, `increment_news_view`,
  `pay_creator_subscription`).
- Leaked-password protection disabled.

Older backlog (see `REMEDIATION-STATUS.md`): `carefind_rls_hardening.sql` still
unapplied, `admin_users`/`admin_teams` policy cleanup, C13, the
`live_shows`/`live_sessions` reconciliation question, and the 7 CareHub accounts
still locked out pending re-login.

Architecture (see `CODE_AUDIT.md` Refactoring): H2 `readAuth()` duplicated across
5 files; `saveBizDetails` whitelist.

---

## 5. Two lessons worth carrying forward

- **"Replaced" RPCs are not dropped RPCs.** `CREATE OR REPLACE` leaves the old
  function in place when the signature differs. This has now caused two separate
  critical vulnerabilities in this project (C15's `send_gift` overloads, C17's
  `credit_wallet`). After replacing any RPC, check `pg_proc` for siblings.
- **`REVOKE ... FROM PUBLIC` does not produce the ACL you expect on Supabase.**
  Default privileges re-grant `EXECUTE` to `anon`/`authenticated` at function
  creation time, *after* the revoke. Always re-read `pg_proc.proacl` instead of
  trusting the statement. This was caught here only because the ACL was verified.
- Related habit that paid off: a `get_advisors` **baseline before** unrelated DDL.
  C17 was found that way, not by looking for it.

---

## 6. Verification commands

Run from `apps/carehub` (use the local binaries — `npx vite build` pulls a broken
rolldown build from the npx cache):

```
node_modules/.bin/vitest run      # 115 tests, all passing as of this session
node_modules/.bin/vite build      # clean
```

Live project is `carehub` / `szdybxmgmhndoytqanfb` (ACTIVE_HEALTHY). The other
project in the org, "Care hub" / `xerpyovjxhwoawzzfkne`, is INACTIVE — never
target it. The Supabase MCP connector needs re-authorizing each session; complete
the OAuth link promptly, as it has expired mid-flow several times in this
engagement.

---

## 7. Next unit completed — `debts` + `purchases` (2026-08-05)

**7 of 24 modules are now on the seam. 15 have nothing at all.**

| Status | Modules |
|---|---|
| Fully off `services/supabase` | `inventory`, `expenses`, `clients`, `debts`, `purchases` |
| Own aggregate on the seam, cross-aggregate residual (flagged in-file) | `orders`, `pos` |
| Untouched | `appointments`, `carefind`, `consultation` (3 files), `dashboard-home`, `demand`, `live-activity`, `locations`, `messages`, `referral-agent`, `reports`, `settings`, `staff`, `stock`, `territories`, `warehouses` |

Scope was confirmed up front as **full retirement**: rather than leave the old
functions in place for the two modules outside this unit that called them,
`POS.jsx` (debt calls) and `Reports.jsx` (purchases read) were repointed at the
new repositories, so `getDebts`/`addDebt`/`updateDebt`/`recordUnderpayment` and
`getPurchases`/`addPurchase`/`updatePurchase` are **deleted** from
`services/supabase.js` outright. That is what let `updateDebt` — the last
id-only PATCH on a money table — actually be scoped, instead of being scoped in
one place and left unscoped in another.

What landed:
- `modules/debts/repositories` (15 tests) and `modules/purchases/repositories`
  (6 tests). Suite is **136 tests**, up from 115.
- `recordUnderpayment` moved onto the debt aggregate, contract unchanged.
- `debtRepository`/`purchaseRepository` removed from `inventory/repositories`,
  which now holds only the product aggregate.
- `findOpenBySource` replaces the fetch-all-debts-and-scan-in-JS lookup that
  POS and Purchases had each written separately.

One deliberate call worth knowing about: `findOpenBySource` filters business,
source and source_ref in the query but keeps the `status !== 'paid'` test in
JavaScript. `status=neq.paid` in PostgREST drops NULL-status rows, which the
code it replaces matched — and a debt missed there stays outstanding after its
sale or purchase is marked paid. Every write path in the app sets a status, but
the schema does not guarantee one, so this was not worth assuming. Regression
test covers it.

Also newly flagged (not fixed, deliberately out of scope): `getClients` is still
a shared `services/supabase` read used by `Debts.jsx` and `POS.jsx` even though
`clients` owns a repository with the identical query.

---

## 8. Next unit completed — `reports` (2026-08-05)

**8 of 24 modules are now on the seam.**

| Status | Modules |
|---|---|
| Fully off `services/supabase` | `inventory`, `expenses`, `clients`, `debts`, `purchases`, `reports` |
| Own aggregate on the seam, cross-aggregate residual (flagged in-file) | `orders`, `pos` |
| Sales reads repointed only — otherwise unmigrated | `dashboard-home`, `locations` |
| Untouched | `appointments`, `carefind`, `consultation` (3 files), `demand`, `live-activity`, `messages`, `referral-agent`, `settings`, `staff`, `stock`, `territories`, `warehouses` |

**The architectural point of this one:** `reports` gets **no repository**. It
owns no table — it is a read-only projection over three aggregates that belong
to other modules — so it composes `saleRepository`/`expenseRepository`/
`purchaseRepository` rather than wrapping them. Inventing a `reportRepository`
would have been an abstraction over nothing and a fourth copy of the same three
queries. Not every module on the seam needs one; some are consumers.

Retiring `getSales`/`getTodaySales` meant repointing their two other callers, so
`DashboardHome.jsx` and `Locations.jsx` had their sales reads moved onto the
repository too. Those two are **not** migrated — everything else in them still
comes from `services/supabase`.

Found while doing it (both pre-existing, neither a live bug):
- `Locations.jsx` imported `getSales` and never called it.
- `addExpense`/`deleteExpense` had been **dead since the expenses migration**.
  `deleteExpense` was also an id-only DELETE with no business filter — same
  unscoped-write class as the removed `updateStock`/`updateClient`.

All five functions deleted. No new tests: no new logic was written, and the
repository methods Reports now calls were already covered. Suite stays at 136.

**`addSale` deliberately kept** in `services/supabase.js`. `PharmacyForm.jsx` is
its only caller and `saleRepository.create` is not a drop-in replacement — it
parks failed/offline writes on the offline queue for replay, which is right for
a till but would silently change behaviour for consultation dispensing. That
call is for the `consultation` migration to make deliberately.

---

## 9. Next unit completed — `appointments` (2026-08-05)

**10 of 24 modules are now on the seam.**

| Status | Modules |
|---|---|
| Fully off `services/supabase` | `inventory`, `expenses`, `clients`, `debts`, `purchases`, `reports`, `appointments`, `dashboard-home` |
| Own aggregate on the seam, cross-aggregate residual (flagged in-file) | `orders`, `pos` |
| Sales reads repointed only — otherwise unmigrated | `locations` |
| Untouched | `carefind`, `consultation` (3 files), `demand`, `live-activity`, `messages`, `referral-agent`, `settings`, `staff`, `stock`, `territories`, `warehouses` |

`createAppointmentRepository(request = sbFetch)`, 9 tests. Suite is **145**, up
from 136.

**The most consequential unscoped write found so far.** Both appointment writes
were unscoped in `services/supabase.js`: `updateAppointment` filtered on id
alone, and `deleteAppointment` was an id-only DELETE. The others this rollout
has found were corrective PATCHes; this one destroys a row, sits behind a
permission check and a confirm dialog that tells the user it cannot be undone.
Both are now scoped by `business_id`, with regression tests asserting a
cross-tenant update and a cross-tenant delete are each a no-op. Still latent
rather than a live leak — ids came from a business-scoped list.

**One thing the repository deliberately does not do:** filter by `source`.
CareFind books into this same table with `source: 'carefind'`, so those rows are
not CareHub's own writes but must stay visible. Covered by a test so a later
"tidy up the query" pass cannot quietly drop them.

`dashboard-home` fell off `services/supabase` entirely as a side effect — it
owns no table, and with its sales reads (from the `reports` unit) and now its
appointments read on repositories, it imports nothing from the service module.
Same consumer shape as `reports`, so it is listed as done without ever having
had a migration of its own.

---

## 10. Next unit completed — `stock` (2026-08-05)

**11 of 24 modules are now on the seam.** Suite is **164**, up from 145 — 19
tests, the largest aggregate migrated so far.

`createStockRepository({ request })` owns `stock_batches`, the `stock_movements`
journal, and the two multi-step **commands** (`transfer`, `adjust`) that were
previously loose functions in `services/supabase.js` for callers to assemble.

**The journal is not an injected collaborator.** `orders` injects `upload` and
`notify` because those are other systems; `stock_movements` is the same database
through the same transport and part of this aggregate. Writing a batch change
without its movement row is not a valid state, so no caller is given the option.
That distinction is worth keeping straight on the remaining modules: inject what
is a different system, absorb what is the same aggregate.

Both writes were unscoped (`updateStockBatch` id-only PATCH, `deleteStockBatch`
id-only DELETE) — now scoped, with cross-tenant regression tests on both plus on
`transfer` and `adjust`. The thrown validation messages go straight into toasts,
so they are preserved verbatim and asserted.

**Ownership overlap resolved.** `productRepository` carried
`getStockBatches`/`addStockBatch` reaching into a table stock owns — zero
callers, zero test coverage, and a *different* ordering
(`expiry_date.asc.nullslast`) than the functions the app actually used
(`created_at.desc`). Removed. This overlap is why `stock` was the right next
unit rather than `settings`.

### Two findings that need a decision (neither fixed)

1. **`stock_movements` is written but never read.** Every transfer and
   adjustment journals a complete row — batch, from/to location, signed
   quantity, reason, who — and nothing in the app has ever surfaced it.
   `getStockMovements` was the only reader-side function and had no callers, so
   it was not carried into the repository: adding a read method no screen calls
   would have made it speculative, the exact mistake the clients migration had
   to undo. Either build the movement-history view (the data is already there
   and complete) or stop writing it — but do not quietly drop the writes, since
   the journal is the only record of who moved or corrected stock.
2. ~~**The partial-transfer path is not atomic.**~~ **FIXED AND APPLIED TO
   PRODUCTION 2026-08-05 — see §11 below.**

---

## 11. Applied to production — atomic stock transfer and adjustment (2026-08-05)

On explicit authorization, as **tracked** migrations:

| version | name |
|---|---|
| 20260805075311 | `atomic_stock_transfer` |
| 20260805075332 | `atomic_stock_adjustment` |
| 20260805075408 | `restrict_stock_batch_rpcs_to_authenticated` (ACL follow-up) |

`transfer_stock_batch()` and `adjust_stock_batch()` — both `SECURITY INVOKER`
with pinned `search_path`, so RLS on `stock_batches`/`stock_movements` keeps
doing the tenant enforcement and no new SECURITY DEFINER surface exists (the
pattern that produced C15 and C17). SQL and full notes:
`apps/carehub/sql/20260805_atomic_stock_transfer.sql`.

**Three defects closed:**
1. Partial transfer was two client writes with no transaction — a failed
   destination insert debited the source and lost the stock, with the movement
   row written last so nothing recorded the loss.
2. The quantity check ran in JavaScript against a possibly-stale read, so two
   users could both pass it on the same batch. `SELECT … FOR UPDATE` now
   serialises them.
3. `adjust` journalled a client-computed difference, so a stale page could
   record a change that never happened. Now derived from the locked row.

Plus a data-fidelity fix: the split used to drop `notes`, `cost_price`,
`selling_price` and `sales_unit` from the destination batch. Measured inert on
today's data (0 of 1 batch has any of them set) before changing it.

**Verified in production** inside a `DO` block that raised at the end so it
rolled back — confirmed after: still 1 batch, 0 movements, no residue. The
sharpest result: an over-transfer was refused with *"You only have **70** units
in this batch"* — 70, not the stale 100 — which is the race fix demonstrated
rather than asserted. Advisors identical to the 27-finding baseline; `pg_proc`
shows exactly one row per name, no sibling overloads.

**The ACL trap bit again, exactly as recorded.** The `REVOKE … FROM PUBLIC` in
the creating migration did not produce the intended ACL: reading `proacl` back
showed `anon=X/postgres` on both functions, because Supabase's default
privileges re-grant EXECUTE at creation time *after* the revoke runs. Third
migration revoked anon explicitly; re-read confirms
`postgres | authenticated | service_role`. Never a live hole (INVOKER + no
`current_business_ids()` for anon ⇒ zero rows), but it is now the **second**
time this has needed a follow-up migration in this project — C5 was the first.
Assume it will happen every time and plan for the extra migration.

**Client side:** `modules/stock/repositories` calls the two RPCs. Its tests
assert the call shape — one write, correct arguments, and the difference
*absent* from the adjust request — while the transactional behaviour is proven
by the rolled-back block above rather than faked in the in-memory adapter. Suite
is **162** (stock's own file went 19 → 17 as those assertions moved into the
database, where they can actually be proven).

---

## 12. Next unit completed — `settings` (2026-08-05), and the critical it uncovered

**12 of 24 modules on the seam.** Suite is **176**, up from 162.

`createSettingsRepository(request = sbFetch)`, 14 tests. `Settings.jsx` imports
nothing from `services/supabase`; POS's receipt printer reads settings through
the same repository.

**The upsert became a real one.** `saveSettings` was a read-then-PATCH-or-POST.
It is now a single request resolved by the database on `business_settings`'
`UNIQUE (business_id)`. That closes a race where two first-time savers both read
"no row" and both inserted — the unique constraint meant the loser got a 409, so
nothing was ever corrupted, but a save failed for no reason the user could act
on.

**`updateBusiness` deliberately stays in `services/supabase`.** `businesses` has
no owning module: it is the tenant record, written by this page (profile,
booking config) and by AdminDashboard (approval status), which is a different
concern. The settings repository owns only what the Settings *page* may change,
as an explicit field list rather than "whatever is in the form object".

### C18 — found by picking up this unit

Checking whether the tracked `saveBizDetails` whitelist was worth doing is what
surfaced **C18: any business owner could make themselves a platform admin with
one PATCH.** Full write-up in `CODE_AUDIT.md` (Critical) and
`apps/carehub/sql/20260805_guard_business_privileged_columns.sql`. Short version:
`businesses`' policy scopes **rows, not columns**, and `is_platform_admin()`
reads a column its own holder could write. Fixed with a `BEFORE UPDATE` trigger,
applied to production, verified by re-running the real attack.

**The whitelist is therefore a code-quality item, not the security fix** — a
client-side list would have stopped nothing, because the attack never went
through the page. Both are now done, in that order and in separate commits.

Worth generalising: this is the fourth critical in this engagement found
*incidentally* rather than by hunting (C10, C13, C14, C17 before it). The
pattern holds — reading code carefully enough to change it is what finds them.

---

## 13. Next unit completed — `warehouses` (2026-08-05)

**13 of 24 modules on the seam.** Suite is **191**, up from 176. Two commits:
the migration (`83a2581`) and a behaviour fix (`cb31ce8`).

`createWarehouseRepository(request = sbFetch)` over `enterprise_locations`.
`updateEnterpriseLocation`/`deleteEnterpriseLocation` were both unscoped
(id-only PATCH, id-only DELETE) and are now scoped by `business_id` — which
matters more than usual here, because four foreign keys point at this table.

**Why this was the right unit:** it retires a genuinely *shared* read rather
than just moving calls. Both cross-aggregate readers were repointed — `Stock`
(which warehouse a batch sits in) and `Orders` (which location an order is
raised for) — so all four functions are gone from `services/supabase.js` and
Orders' flagged residual shrinks to `getStaff`/`getTerritories`.

Do not confuse this aggregate with `getAllLocations`/`getBranches`/`addBranch`,
which are the multi-branch `businesses` tree and stay put. Noted at the call
site so the next person does not merge them.

### Behaviour fix, own commit

Deleting a location still referenced by stock, orders or movement history is
correctly refused by the database, but the raw foreign-key violation went
straight into a toast. The repository now maps the **constraint name** — a
stable schema object, unlike the violation's prose — to a reason the user can
act on, and rethrows anything unrecognised untouched so a network error is
never flattened into "this location is in use".

### New finding, logged not fixed

**A warehouse that has ever received a transfer can never be deleted.**
`stock_movements.from_location_id`/`to_location_id` are FKs to
`enterprise_locations` with no cascade, and the movement log is append-only, so
once a location appears in it the row is permanent. Retiring a closed warehouse
has no path today. Inert right now (0 movements). Needs a product decision: an
archive flag on `enterprise_locations` (preferred — keeps the audit trail
honest) versus `ON DELETE SET NULL` on the two movement FKs, which would
silently blank the history's origin. Related to the open "`stock_movements` is
written but never read" question from §10.

---

## 14. Next unit completed — `territories` (2026-08-05)

**14 of 24 modules on the seam.** Suite is **208**, up from 191.

`createTerritoryRepository(request = sbFetch)` over `territories` **and** the
`rep_territories` join. Both cross-aggregate readers repointed (`Orders`,
`LiveActivity`), which takes **Orders down to a single residual: `getStaff`**.

**The thing to know before touching this aggregate: tenancy is not uniform
across it.**

| table | tenancy |
|---|---|
| `territories` | has `business_id` — scoped directly, like every other aggregate |
| `rep_territories` | **no `business_id` at all** — RLS derives it through the parent: `territory_id IN (SELECT id FROM territories WHERE business_id IN current_business_ids())` |

That is a sound design, not an omission, so the repository does not invent a
filter for a column that does not exist. It scopes join rows by **territory** —
ids that themselves came from a business-scoped list — which is exactly the
boundary RLS enforces server-side. Checked against the live schema and
`pg_policies`, not inferred. `removeRepFromTerritory` was an id-only DELETE and
is now scoped that way.

**`lib/dbErrors.js` extracted.** The delete-message helper written for
warehouses was needed verbatim here, so `translateConstraintError` became
shared rather than copied. Each repository keeps its own constraint→reason
table; the matching rule and the rethrow-unrecognised-untouched guarantee are
shared.

**Logged, not changed:** deleting a territory with reps assigned fails on
`rep_territories_territory_id_fkey`, and unlike the warehouses equivalent this
is immediately reachable — assigning a rep is a normal action on the same page,
with no guard before the delete confirm. The message is readable now, but
whether deleting a territory should simply remove its assignments is a product
decision.

---

## 15. `staff` (2026-08-05) — and the critical it uncovered

**15 of 24 modules on the seam.** Suite is **229**, up from 208.

### C19 first — found before a line of the migration was written

Checking RLS on `staff` showed an `Allow all` (`qual: true`) policy alongside
the scoped one. **C14 had never actually been fixed on 16 CareHub tables**, and
the whole of Phase 2's RLS was inert on them. Full write-up in `CODE_AUDIT.md`
(Critical) and `apps/carehub/sql/20260805_c14_regression_drop_blanket_policies.sql`.

The cause is worth internalising: `phase2_rls_pilot.sql` dropped
`"Allow all staff"` / `"Allow all products"` / … while the live policies were
all named plain `"Allow all"`. **`DROP POLICY IF EXISTS` on a wrong name is a
silent no-op.** One table in that file used the correct unsuffixed name
(`businesses`), which is why it genuinely was clean and made the whole file
look applied. So the fix drops **by predicate, not by name**.

That is the second instance of the same shape in one day — see also the
`REVOKE … FROM PUBLIC` trap in `20260805_atomic_stock_transfer.sql`. **A DDL
statement completing is not evidence it did anything.**

### The migration

`createStaffRepository` covers `staff`, `roles` and `staff_claims`. It retires
the most widely-shared read in the codebase — six call sites plus
`BusinessDashboard`'s permission bootstrap — and **`orders` is now fully off
`services/supabase`**.

Three tables, three different scoping situations, checked against live
`pg_policies` rather than assumed:

| table | scoping |
|---|---|
| `staff` | `business_id`, direct |
| `roles` | `business_id`, direct |
| `staff_claims` | **no tenant column reachable from a PostgREST filter** — RLS derives the reviewing business through the claimed staff row, so the decision writes are id-only by necessity |

That is the second aggregate in a row (after `territories`/`rep_territories`)
where tenancy is not uniform across the tables. Treat "check the live policy
per table" as the default, not the exception.

Also fixed `getStaffClaims`: it filtered `staff.business_id` on an embed
**without `!inner`**, which in PostgREST constrains the embedded resource
rather than the parent — so it returned every pending claim in the database
with a null embed for other businesses'. Inert on current data.

### `loginStaff`/`loginBusiness` are now unreachable — verified harmless

Both do a plaintext comparison as `anon`. `businesses` has been scoped since
July; `staff` since C19 today. Before accepting that, it was checked: all 12
active staff already have `auth.users` rows (`never_migrated: 0`), and four
staff sessions were impersonated to confirm each resolves its own row and full
team through the real Supabase Auth path. Nobody is locked out. This also means
**C2's plaintext password columns now have no live reader**, which makes that
cleanup materially easier.

**Recommended next unit: `messages`** (its own `internal_messages` aggregate,
and the last non-auth reader in that area), or **`consultation`** — which is
what would let `addSale` finally move onto `saleRepository.create` as a
deliberate decision rather than a side effect.

**Bigger open item than any remaining module:** the 9 tables from C19 that have
a blanket `ALL` policy and *no* scoped policy at all. Those still need policies
written.

Still open and unchanged: **`stock_movements` is written but never read** (§10),
and `getClients` remains a shared `services/supabase` read used by `Debts.jsx`,
`POS.jsx` and `Appointments.jsx` even though `clients` owns a repository with
the identical query.

Still open from §10: **`stock_movements` is written but never read.** Now that
transfers and adjustments journal atomically, that log is trustworthy for the
first time — which strengthens the case for building the history view rather
than dropping it.
