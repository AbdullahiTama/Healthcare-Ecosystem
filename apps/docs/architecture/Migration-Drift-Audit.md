# Migration Drift Audit — 2026-10-15

Status: **root cause identified, guard in place, gap NOT closed.** Nothing in production was changed.

## The question

Rem-08 asked whether `supabase/migrations/` faithfully reproduces production. It does not, and the gap is much
larger than a set of renamed files.

## What was measured

Three sources of truth were compared against live production (`szdybxmgmhndoytqanfb`, schema `public`):

- `supabase/migrations/` — 193 files, the Supabase-canonical folder
- `apps/carefind/sql/` — 101 files
- `apps/carehub/sql/` — the remainder

Production catalogue (names only, extension members excluded):

| | Live in production | With a `create` in the repo | **Unaccounted for** |
|---|---|---|---|
| Functions | 263 | 225 | **38** |
| Tables | 237 | 127 | **110** |

"Live but unaccounted for" means there is no `create function` / `create table` for it anywhere in the repository.

The migration ledger (`supabase_migrations.schema_migrations`, 257 rows) does not reproduce either — 131 files on disk
have no ledger entry and 195 ledger entries have no matching file. That is real drift, but it is bookkeeping, not the
risk. See below.

## Root cause

**`supabase/migrations/` is a delta stream with no baseline. There is no migration that creates the original schema.**

The foundational tables (`profiles`, `products`, `transactions`, `wallets`, `withdrawal_requests`, `businesses`, …)
were created outside the repository. Migrations only ever recorded *changes* to them. The base schema exists in the
repository only as a hand-maintained test fixture:

```
apps/carefind/src/test/payments/fixtures/liveSchemaSubset.sql
```

That fixture is what lets the PGlite suites boot. It is the load-bearing, undocumented keystone of the entire test
strategy — and it is maintained by hand, against a production schema nobody reconciles it with.

So the system works by coincidence of two things being kept in sync by people: the fixture, and the migration folder.
Nothing checks that they still are.

### Why this did not fail loudly

PL/pgSQL does not resolve function names when a function is created — only when it is first *called*. So a migration
that depends on a missing function applies cleanly, and then fails at runtime, in production, the first time someone
places an order. `supabase/migrations/carefind_20261019_red_team_fixes.sql` and
`carefind_20261021_shop_expiry_and_delivery_quotes.sql` both call `calculate_shop_delivery_fee` and
`calculate_shop_fulfilment_fee`, which are defined only in `apps/carehub/sql/20260906_payment_hardening.sql` — never in
`supabase/migrations/`.

The PGlite suites do not catch this either, because `liveSchemaSubset.sql` happens to define both of those functions
itself (lines 400–401). The fixture masks the gap it was created to work around.

## The most concerning names

Of the 38 missing functions, these decide who may read or write:

```
is_platform_admin_email      can_manage_staff            guard_role_writes
is_business_owner_email      can_manage_staff_as         guard_staff_writes
is_staff_owner_level         can_manage_directory        staff_email_conflict
role_grants_staff_management directory_businesses_guard  guard_email_outbox_quarantine
role_grants_directory_management
field_activities_directory_link_guard
```

An authz function that exists in production but in no migration cannot be reviewed, cannot be rebuilt, and cannot be
proven to a third party. That is a compliance problem independent of whether it currently behaves correctly.

## What was done

**A ratchet, not a repair.**

`apps/carefind/src/test/migrations/productionCatalogue.snapshot.json` records the live catalogue and the gap as it
stood on 2026-10-15. `apps/carefind/src/test/migrations/schemaCoverage.test.js` (7 tests, no database needed, runs in
the ordinary unit suite) enforces:

- the gap may **shrink** — back-filling a migration is progress and must not break CI
- the gap may never **grow** — a new object nobody wrote down fails the build, by name
- the snapshot may not be **doctored** — every recorded gap must remain in the catalogue, so the gap cannot be hidden by
  deleting a name from it
- removing a **security-relevant** name from the gap trips an explicit list, so those removals cannot pass unnoticed

Verified in all three directions:

| Scenario | Expected | Result |
|---|---|---|
| Baseline | pass | 7/7, `unaccounted: 38 functions / 110 tables` |
| New untracked object added | **fail** | 2 failed, naming `a_function_nobody_wrote_down` |
| Gap back-filled with real SQL | **pass** | 7/7, `fixedSinceBaseline: 1` |

## Ledger reconciliation — DONE 2026-10-15

The bookkeeping half of this audit is closed. 131 rows were inserted into
`supabase_migrations.schema_migrations`; the repo now has **0 migration files without a ledger row** (was 131).

- **What was verified before inserting:** for 123 of the 131, every object the file creates already exists in
  production. 6 more are partially superseded (their functions were later renamed by the withdrawal engine). 2 were
  checked individually — `carehub_20260808_close_businesses_password_disclosure` (its own guard now raises, because
  `businesses.password` was later purged, and anon has no `SELECT` on `businesses`) and
  `carefind_20260814_request_withdrawal_user_id_and_account_verify` (superseded by `create_withdrawal`).
  **None of the 131 were pending work.**
- **Why they were missing:** the file had been renamed after it shipped, so the ledger kept the old name.
- **How they were recorded:** version `<YYYYMMDD>90<NN>` — hour `90` can never collide with a real applied migration
  (hours run 00–23), so they sort after any same-day real apply and are self-evidently synthetic. Every row carries
  `created_by = 'ledger_reconciliation_2026_10_15'`.
- **What it touched:** one metadata table. No DDL, no DML against application data. Verified byte-identical before and
  after: business wallet total (2,404,000 kobo), 54 shop orders, 15 withdrawals, 77 transactions, 3 held vendor
  credits, 64 profiles, 64 auth users.
- **Rollback:** `apps/docs/architecture/migration-ledger-reconciliation.sql` (exact inserted set) and
  `apps/docs/architecture/production-migration-ledger-BACKUP.md` (all 257 pre-existing rows).

## What was NOT done, and why

- **No migration was authored to close the schema gap.** The correct fix is a baseline schema dump plus back-fill
  migrations. Authoring those from `pg_get_functiondef` would reproduce `SECURITY DEFINER` bodies and grants by machine,
  which is exactly the kind of change that must not be generated unreviewed.
- **The 131 historical files were NOT executed.** 93 of them contain `INSERT` / `UPDATE` / `DELETE` / `DROP`. Replaying
  them against a database that already has the schema would be a second run of historical data migrations on live
  wallet balances, orders and withdrawals — irreversible. The ledger fix records that they ran; it does not re-run them.
- **The fixture was not regenerated.** That is the highest-value follow-up (see below).

## Recommended next steps, in order

1. **Regenerate `liveSchemaSubset.sql` from production** and diff it. Until the fixture is machine-derived, it is a
   hand-maintained copy of production that will silently rot, and it is currently hiding real defects.
2. **Capture a baseline schema dump** (`pg_dump --schema-only`) into `supabase/migrations/` as version `00000000000000`.
   That converts the delta stream into something replayable and makes every later gap measurable.
3. **Back-fill the 38 functions**, security-relevant ones first, as ordinary reviewed migrations. Each one that lands
   comes off the `knownGap` list.
4. Reconcile migration filenames with the ledger, or adopt the documented rule that the ledger is a record only and
   `db push` is never run (current practice — `planning/financial-system/00-master-plan.md` states migrations are applied
   via `apply_migration`, never `execute_sql` or `db push`).

## Reproducing this audit

The snapshot was produced by comparing the live catalogue against the repository:

```sql
-- live functions, excluding extension members and internal helpers
select p.proname from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  left join pg_depend d on d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
 where n.nspname = 'public' and d.objid is null and p.proname not like '\_%'
 group by p.proname;
```

The repo side of the comparison is in the test itself. Refresh the snapshot by re-running the query, rewriting the two
`functions` / `tables` arrays, and keeping `knownGap` in step — the test will tell you immediately if you get it wrong.