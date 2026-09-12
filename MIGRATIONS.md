# Database Migrations

CareHub uses Supabase CLI for schema migration management.

## Directory Structure

```
supabase/
├── config.toml          # Supabase project config
├── migrations/          # Ordered migration files
│   ├── carehub_YYYYMMDD_name.sql
│   └── carefind_YYYYMMDD_name.sql
└── seeds/               # Reference seed files (not auto-applied)
    ├── carehub_qa_seed_carehub.sql
    └── carefind_qa_seed_carefind.sql
```

## Naming Convention

Migrations follow the pattern: `{app}_YYYYMMDD_name.sql`

- **carehub_** prefix: CareHub (vendor) database changes
- **carefind_** prefix: CareFind (customer) database changes
- **YYYYMMDD**: Date the migration was created
- Files are applied in alphabetical order

## Creating a New Migration

1. Create a new file in `supabase/migrations/`:
   ```
   carehub_20260907_my_feature.sql
   ```

2. Write your SQL (DDL, RLS policies, RPCs, etc.)

3. Test locally:
   ```bash
   supabase db reset          # Reset local DB and run all migrations
   supabase migration up      # Apply pending migrations only
   ```

4. Apply to remote:
   ```bash
   supabase db push           # Push migrations to remote project
   ```

## Applying Migrations via MCP

For migrations that need to be applied via the Supabase MCP tool (recommended for production):

1. Read the SQL file content
2. Use `supabase_apply_migration` with a descriptive name
3. Verify the migration applied by checking `supabase_migrations.schema_migrations`

## Important Rules

- **Never modify an already-applied migration.** Create a new one instead.
- **Always test locally first** before pushing to production.
- **DDL completing does not mean it worked.** Always verify with `SELECT` queries.
- **Use `IF EXISTS` / `IF NOT EXISTS`** for idempotent migrations.
- **Check `pg_policies`** after creating RLS policies to confirm they exist.
- **REVOKE and GRANT** explicitly — don't assume defaults are safe.

## Legacy SQL Files

The original SQL files remain in their original locations:
- `apps/carehub/sql/` — CareHub migrations (69 files)
- `apps/carefind/sql/` — CareFind migrations (45 files)

These are kept for reference but all new migrations should go in `supabase/migrations/`.
