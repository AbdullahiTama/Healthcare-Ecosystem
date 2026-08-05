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

**Recommended next unit: `settings`.** Small, self-contained, and `saveBizDetails`
(already tracked under Refactoring) lives in that area — the whitelist question
can be settled at the same time. `stock` is the alternative if a bigger one is
wanted: it owns `stock_batches`, which `productRepository` currently reaches
into, so migrating it would resolve a genuine ownership overlap rather than just
moving calls.
