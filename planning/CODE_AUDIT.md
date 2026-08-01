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

- [ ]

---

## UI

- [ ]

---

## Refactoring

- [ ] `saveBizDetails` sends the entire `bizForm` object via generic PATCH — fine today, but consider a whitelist as the businesses table grows.
