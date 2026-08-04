# CareHub Code Audit

This document tracks architecture issues discovered during review.

## Critical

- [ ]

---

## High

- [ ] `20260728_fix_missing_relationships.sql` is stale — live DB FKs are auto-named (`stories_user_id_fkey`, `live_items_sender_id_fkey`), not `fk_stories_user`/`fk_live_items_sender`. File should be reconciled with the live schema or removed. (Both FK failure bugs themselves are fixed in code via `ensureProfile()`.)
- [ ] Plaintext passwords remain in `businesses.password` / `staff.password` after migration (C2, still open) — the backfill migration writes bcrypt into `auth.users` but nothing purges the legacy plaintext columns.

---

## Medium

- [ ] Supabase "Confirm email" setting is effectively ON (live signup probe: 201 but no session, `confirmation_sent_at` set) — silently-provisioned accounts can never complete sign-in. Backfill migration `20260802_backfill_confirmed_auth_users.sql` bypasses this, but consider disabling confirmation for this project.
- [ ] `handle_new_user()` trigger (on `auth.users`) is not collision-safe: it sets `profiles.display_name = split_part(email,'@',1)`, but `profiles.display_name` is UNIQUE (`unique_display_name`) — any second signup whose local part is already taken fails the whole user insert (surfaced as 23505 during the backfill run). The backfill works around it by freeing the name before each insert, but the trigger should be hardened long-term (suffix on collision) or `unique_display_name` dropped — also note the SQL editor cannot modify the auth schema (42501), so any fix must be a function replacement or a `public.profiles` change.
- [ ] `consultation` module gated to skincare + pharmacy business types (2026-08-04) — gate lives in `getNavItems()` (`businessType !== 'skincare' && businessType !== 'pharmacy'` filters it), with route-level `guard()` coverage and the Staff.jsx role editor checkbox hidden for other types. No other business type can reach the route.

---

## Low

- [ ] `roles` table had no RLS (verified live — anon key could SELECT/INSERT any business's roles); draft `20260802_roles_rls.sql` written but NOT YET APPLIED.
- [ ] `businesses.cover_url` / `logo_url` / `description` columns exist but were null for every live business — no seed/UI wrote them until Settings gained inputs this session.

---

## Documentation

- [ ]

---

## Performance

- [ ] CareHub build chunk > 1.4 MB minified (single index chunk, 394 KB gzip) — consider route-level code splitting; `supabase.js` is both statically and dynamically imported (POS.jsx).

---

## Security

- [ ] `packages/shared-notifications/src/adapters/CareFindAdapter.js` and `CareHubAdapter.js` (lines 4–5) hardcode the live Supabase URL and anon key in source. Same pattern appears in `apps/carefind/src/config/supabaseClient.js` and `apps/carehub/src/config/supabase.js`. Anon keys are public by design for Supabase, but they should come from env/config so staging/prod differ and the key can be rotated without a code deploy.
- [ ] Referral Agent Program (2026-08-02) is code-complete and builds, but `sql/20260802_referral_agent_program.sql` is **NOT YET APPLIED** to Supabase — the program's tables/trigger/RLS and the `businesses.referring_agent_id`/`plan_payments.is_first_payment` columns must be created before agents/payouts go live. Server probes in the plan's §11 (payment→commission, UNIQUE(payment_id) idempotency, agent-anon RLS) are pending until then.

---

## UI

- [ ]

---

## Refactoring

- [ ] `saveBizDetails` sends the entire `bizForm` object via generic PATCH — fine today, but consider a whitelist as the businesses table grows.
- [x] **Deep repository seam — inventory pilot (2026-08-04).** `productRepository` is now a `createProductRepository(request = sbFetch)` factory: the transport (`sbFetch`, now exported from `services/supabase.js`) is an injected seam with two adapters — real PostgREST in prod, an in-memory adapter in `repositories/index.test.js` (10 tests). `Inventory.jsx` no longer imports `services/supabase` at all; every product read/write routes through the repository, which also enforces `business_id` tenant scoping on update/delete. Fixed two latent bugs uncovered in the process: (1) `productRepository.deleteBulk` was called by the duplicate-cleanup flow but never defined (would throw mid-cleanup, leaving a half-merged state); (2) `updateStock` was dead and malformed (unscoped PATCH with a non-PostgREST `{ increment }` body) — removed.
- [x] **Deep repository seam — expenses (2026-08-04).** Migrated `Expenses.jsx` fully off `services/supabase` onto a new `modules/expenses/repositories` (`createExpenseRepository(request = sbFetch)`, 5 in-memory-adapter tests). The in-memory adapter is now a shared test helper at `src/test/inMemoryClient.js` (the reusable second adapter — two concrete adapters make the transport seam real). Removed the duplicate/misplaced `expenseRepository` that had been sitting unused inside `inventory/repositories`.
- [ ] **Repository-seam rollout (Candidate 1) still pending for ~22 modules.** Done: `inventory`, `expenses`. `pos` has empty `repositories/hooks/components` scaffolding; `orders`/`clients` have unwired repositories+hooks their pages bypass (and `orders`' hook is half-written with placeholder cross-domain loads); ~16 modules import `services/supabase` directly. `purchaseRepository`/`debtRepository` still sit unused/misplaced in `inventory/repositories` — move them to `modules/purchases`/`modules/debts` as those adopt the seam. Apply the inventory/expenses pattern uniformly, or delete the unused scaffolding (see architecture review 2026-08-04).
- [ ] **Latent bug — `orderRepository.advance` issues an unscoped PATCH.** `modules/orders/repositories/index.js` `advance()` calls `sbFetch('orders', { method: 'PATCH', ... })` with NO id/business filter — it would update the stage/note of **every** order in the table. Same class as the removed inventory `updateStock`. Currently dead (the live path uses `services/supabase.advanceOrder`), so it's a landmine, not a live bug — fix (scope by id + business_id) or remove before wiring the orders repository.
