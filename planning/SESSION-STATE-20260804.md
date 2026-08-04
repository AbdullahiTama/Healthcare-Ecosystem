# Session state — 2026-08-04 (resume here)

Working state for the **repository-seam architecture rollout**, plus two production
fixes that happened alongside it. Everything below is committed; the working tree
was clean at the end of the session.

Canonical trackers remain `planning/CODE_AUDIT.md` and
`architecture/Technical-Debt.md` — this file is the "where were we" note, not a
replacement for either.

---

## 1. Repository-seam rollout (the architecture workstream)

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
