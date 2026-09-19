---
title: 'Harden advisors: search_path, definer EXECUTE, FK indexes, RLS initplan, dedupe indexes'
type: 'chore'
created: '2026-09-05'
status: 'done'
baseline_commit: '9a3b0677e32de8803c6936621b40dac9d60b88c4'
review_loop_iteration: 0
context:
  - 'apps/carefind/sql/20260813_story_views.sql'
  - 'apps/carefind/api/_handlers/admin-auth.js'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `supabase advisors` shows 4 `ERROR` `security_definer_view` + 92 security `WARN` (45 auth definer, 25 anon definer, 11 `search_path`) + 500 perf `WARN` (174 unindexed FKs, 148 `multiple_permissive`, 114 `auth_rls_initplan`, 57 unused, 6 duplicate, no PK) — recent `news`/`stories`/`live_shows`/`paystack` add to it.

**Approach:** Single hardening migration: pin `search_path=public` on all `SECURITY DEFINER` functions, revoke anon/auth `EXECUTE` where not needed, add FK indexes, wrap `auth.uid()` as `(select auth.uid())` in RLS, drop unused/duplicate indexes, fix 4 `security_definer_view` to `security_invoker=true`.

## Boundaries & Constraints

**Always:** Keep `is_platform`/`host_id` RLS semantics; keep `increment_story_view`/`increment_news_view` behavior; keep `public` read for active stories/news; keep `service_role` admin path.

**Ask First:** Dropping any `security_definer_view` that is intentionally definer; adding `auth_leaked_password_protection`.

**Never:** Weaken `host_id=auth.uid()` update/delete RLS; expose `admin_users` via view; remove needed FK index.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Search path | `SELECT proname WHERE prosecdef` | All definer functions have `search_path=public` | None |
| Definer EXECUTE | `has_function_privilege('anon', '...')` | Only intended roles have EXECUTE (anon revoked where not needed) | No anon leak |
| FK index | ` unindexed_foreign_keys` count | 0 unindexed for `news`/`stories`/`live_shows` | No missing index |
| RLS initplan | `EXPLAIN` shows `InitPlan` | `auth.uid()` wrapped as `(select auth.uid())` | No per-row re-eval |
| Definer view | `pg_views where security_definer=true` | 0, all `security_invoker=true` | No definer view leak |

</frozen-after-approval>

## Code Map

- `apps/carefind/sql/*` -- `increment_story_view`, `increment_news_view`, `maintain_news_repost_count`, `get_story_viewers`, `verify_shop_payment` etc. are `SECURITY DEFINER` with mutable `search_path`; must add `set search_path=public`.
- `apps/carefind/sql/carefind_rls_hardening.sql:11` etc. -- `function_search_path_mutable` 11 functions.
- `pg_proc.proacl` -- `authenticated_security_definer_executable:45`, `anon:25` — revoke where anon not needed (keep `register_business` anon, `increment_*_view` maybe public but pin search_path).
- `information_schema` FKs -- 174 unindexed: add `create index on news(author_id)`, `news_comments(news_id)`, `story_views(story_id)`, `live_shows(host_id)` etc.
- `pg_policies` -- 148 `multiple_permissive_policies` per table (e.g., `news_reactions` 2 SELECT); keep but note.
- `pg_views` -- 4 `security_definer_view` (`shop_public_products` etc.) → `alter view ... security_invoker=true`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/carefind/sql/20260905_advisor_hardening.sql` (new) -- `alter function ... set search_path=public` for 11, `revoke execute on function ... from anon/authenticated` where not intended (keep `register_business` anon, `increment_*_view` maybe public but with search_path), `create index` for 174 FKs (at least for `news`/`stories`/`live_shows`/`story_views`/`news_*`), `alter view ... security_invoker=true` for 4, rewrite RLS `auth.uid()` → `(select auth.uid())` for 114, drop 57 unused / 6 duplicate after verifying `pg_stat_user_indexes`.
- [x] `apps/carefind/src/modules/social-feed/storyViews.test.js` etc. -- no code change needed, but verify `increment_story_view` still works after search_path pin.

**Acceptance Criteria:**
- Given advisors re-run, when checking security, then 0 `security_definer_view` ERROR, 0 `function_search_path_mutable` WARN for hardened functions, anon definer only where intended
- Given perf advisors, when checking, then 0 unindexed FKs for `news`/`stories`/`live_shows`/`story_views`, no duplicate/unused flagged for new indexes, `auth_rls_initplan` wrapped

## Spec Change Log

## Design Notes

Hardening is DB-only, no UI. Keep `extension_in_public` and `auth_leaked_password` out of scope per `Ask First`. `multiple_permissive_policies` per table is often intentional (SELECT vs INSERT) — keep 148 as `WARN` but not blocked.

## Verification

**Commands:**
- `supabase advisors` security + performance -- expected: 0 definer view ERROR, 0 search_path WARN for touched functions, reduced unindexed FKs
- `npm run build` (both apps) -- expected: vite build clean
