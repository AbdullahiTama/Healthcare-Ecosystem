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
- [x] **Deep repository seam — orders (2026-08-04).** Migrated `Orders.jsx` onto `modules/orders/repositories` (`createOrderRepository({ request, upload, notify })`, 10 in-memory-adapter tests). The orders aggregate is the first one that owns *commands*, not just queries: `create()` writes the order plus its items/watchers/files, logs the `submitted` event and fans out the approval + copy notifications; `advance()` moves the status, logs the event and notifies the raiser plus watchers. So three collaborators are injected, not one — `request` (transport), `upload` (object storage) and `notify` (notification fan-out) — which is what makes the fan-out assertable without a network, a bucket or a notifications table. Deleted the half-written `hooks/useOrders.js` (placeholder cross-domain loads, never imported). `Orders.jsx` still imports `getStaff`/`getTerritories`/`getEnterpriseLocations` from `services/supabase` — cross-aggregate reads belonging to modules that have not adopted the seam yet, flagged in-file.
- [x] **Deep repository seam — clients (2026-08-04).** Migrated `Clients.jsx` fully off `services/supabase` onto `createClientRepository(request = sbFetch)` (8 in-memory-adapter tests). The pre-existing `clientRepository` here was speculative and drifted — it exposed a `delete` and prescription reads nothing called, and lacked the four per-client history reads the page actually uses — so it was rewritten to the aggregate the page needs: `getAll`/`create`/`update` plus `getSales`/`getAppointments`/`getDebts`/`getConsultations`. The history reads are modelled as part of the *client* aggregate (projections of one client's record), not the sales/appointments/debts collections, which stay with their own modules. Deleted the unused `hooks/useClients.js` (drifted duplicate of logic already in the page). Cross-tenant hardening in the same pass — see below.
- [ ] **Repository-seam rollout (Candidate 1) still pending for ~20 modules.** Done: `inventory`, `expenses`, `orders`, `clients`. `pos` has empty `repositories/hooks/components` scaffolding; ~16 modules import `services/supabase` directly. `purchaseRepository`/`debtRepository` still sit unused/misplaced in `inventory/repositories` — move them to `modules/purchases`/`modules/debts` as those adopt the seam. Apply the inventory/expenses/orders pattern uniformly, or delete the unused scaffolding (see architecture review 2026-08-04).
- [x] **Latent bug fixed — `orderRepository.advance` issued an unscoped PATCH (2026-08-04).** `advance()` filtered by neither id nor business, so one call would have rewritten the stage/note of **every** order in the table, across every tenant. Same class as the removed inventory `updateStock`. It was dead at the time (the live path used `services/supabase.advanceOrder`), so it was a landmine rather than a live bug — but the orders migration above wires this exact method to the live approve/reject/dispatch buttons, so it was fixed first: scoped by `id` + `business_id`, with a regression test asserting a sibling order is untouched and another asserting a cross-tenant `advance` is a no-op. While fixing it, `advance` also stopped using `return=minimal` — it now reads the PATCH's returned rows to decide whether anything actually moved, so a cross-tenant or missing order no longer writes a phantom `order_events` audit entry for a status change that never happened (and it drops a redundant `getById` round-trip).
- [x] **Unscoped client reads/writes removed (2026-08-04, with the clients migration).** Four functions in `services/supabase.js` filtered on an id alone, with no `business_id`: `updateClient` (a PATCH — same unscoped-write class as the removed inventory `updateStock`) and `getSalesByClient`/`getAppointmentsByClient`/`getDebtsByClient`. All four had zero callers once `Clients.jsx` migrated (`updateClient` was already dead — imported but never called), so all four were removed rather than left to be reused. The repository replacements scope by `client_id` **and** `business_id`; all four history tables carry `business_id` and every insert site in the app stamps it, verified before the filters were added. Not a live-leak fix: the ids came from a business-scoped client list, so the exposure was latent.
- [ ] **`getLatestConsultation`/`getConsultationsByClient` still filter on `client_id` alone.** Kept in `services/supabase.js` because POS still calls them (it has not adopted the seam). Same latent class as the reads removed above — POS only passes ids from its own business-scoped client list, so it is not leaking today. Give them a `businessId` when `pos` adopts the repository seam.
