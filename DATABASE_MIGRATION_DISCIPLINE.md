# Database Migration Discipline

**Date:** 2026-09-28
**Scope:** Healthcare Ecosystem — CareFind + CareHub
**Objective:** Reproducible database migrations without relying on undocumented manual edits

---

## Current State

### Migration Sources

| Location | Files | Managed By | Status |
|----------|-------|------------|--------|
| `supabase/migrations/` | 120+ | Supabase CLI | ✅ Canonical |
| `apps/carefind/sql/` | 56 | Manual | ⚠️ Legacy reference |
| `apps/carehub/sql/` | 82 | Manual | ⚠️ Legacy reference |
| `supabase/seeds/` | 11 | Manual | ✅ Separated |

### Database Migration History

- **Total applied migrations**: 100+
- **Latest migration**: `20260928062433` (2026-09-28)
- **Migration naming**: `YYYYMMDDHHMMSS_name.sql`
- **Ordering**: Deterministic (timestamp-based)

### Key Observations

1. **Dual source of truth**: `supabase/migrations/` is CLI-managed, but `apps/*/sql/` contains legacy files not tracked by the CLI
2. **No migration validation in CI**: Migrations are not validated before deployment
3. **No rollback strategy**: Migrations are forward-only
4. **Seeds are properly separated**: `supabase/seeds/` contains only seed data

---

## Migration Discipline Rules

### 1. New Migrations

All new schema changes MUST go through `supabase/migrations/`:

```bash
# Create a new migration
supabase migration new <descriptive_name>

# Edit the migration file
# Apply locally
supabase db reset

# Push to remote
supabase db push
```

### 2. Migration Naming

Format: `YYYYMMDDHHMMSS_action_target.sql`

Examples:
- `20260928120000_add_user_profiles_table.sql`
- `20260928120001_add_email_index.sql`
- `20260928120002_create_appointment_rpc.sql`

### 3. Idempotency

Migrations SHOULD be idempotent where practical:

```sql
-- Use IF NOT EXISTS for tables/indexes
CREATE TABLE IF NOT EXISTS users (...);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Use IF EXISTS for drops
DROP TABLE IF EXISTS old_table;
DROP INDEX IF EXISTS idx_old_index;
```

### 4. RLS Changes

All RLS policy changes MUST be in migrations:

```sql
-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "users_select_own" ON users
  FOR SELECT TO authenticated
  USING (auth.uid() = id);
```

### 5. RPC Changes

All RPC changes MUST be versioned in migrations:

```sql
CREATE OR REPLACE FUNCTION public.get_user_profile(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('id', id, 'email', email)
  FROM users
  WHERE id = p_user_id;
$$;
```

### 6. Constraints and Indexes

All constraints and indexes MUST be in migrations:

```sql
-- Unique constraints
ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);

-- Indexes
CREATE INDEX idx_users_created_at ON users(created_at DESC);

-- Foreign keys
ALTER TABLE profiles ADD CONSTRAINT profiles_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
```

---

## Safe Migration Structure

### Directory Layout

```
supabase/
├── config.toml              # Supabase project config
├── migrations/              # CLI-managed migrations (canonical)
│   ├── 20260928120000_initial_schema.sql
│   ├── 20260928120001_add_users_table.sql
│   └── ...
└── seeds/                   # Seed data (separated from migrations)
    ├── carefind_qa_seed.sql
    └── carehub_qa_seed.sql
```

### Migration Workflow

1. **Create migration**: `supabase migration new <name>`
2. **Write SQL**: Edit the generated file
3. **Test locally**: `supabase db reset`
4. **Commit**: Add to git
5. **Push to staging**: `supabase db push`
6. **Verify**: Check `supabase_migrations.schema_migrations`
7. **Push to production**: `supabase db push` (manual approval)

### Rollback Strategy

Migrations are forward-only. To rollback:

1. **Create a new migration** that reverses the change
2. **Never modify** an already-applied migration
3. **Test rollback** in staging before production

---

## Legacy SQL Files

### Current Status

The following directories contain legacy SQL files NOT tracked by Supabase CLI:

- `apps/carefind/sql/` — 56 files
- `apps/carehub/sql/` — 82 files

### Handling Legacy Files

1. **Do NOT delete** legacy files — they serve as historical reference
2. **Do NOT apply** legacy files manually — use `supabase/migrations/` instead
3. **New changes** MUST go to `supabase/migrations/`
4. **Document** which legacy files have been migrated to `supabase/migrations/`

### Migration Mapping

| Legacy File | Migrated To | Status |
|-------------|-------------|--------|
| `apps/carefind/sql/20260728_fix_missing_relationships.sql` | `supabase/migrations/carefind_20260728_fix_missing_relationships.sql` | ✅ |
| `apps/carefind/sql/20260811_professional_consultations.sql` | `supabase/migrations/carefind_20260811_professional_consultations.sql` | ✅ |
| `apps/carehub/sql/20260804_sale_stock_movement.sql` | `supabase/migrations/carehub_20260804_sale_stock_movement.sql` | ✅ |
| `apps/carehub/sql/20260805_atomic_stock_transfer.sql` | `supabase/migrations/carehub_20260805_atomic_stock_transfer.sql` | ✅ |

---

## CI/CD Integration

### Migration Validation in CI

Add to `.github/workflows/carefind-ci.yml` and `carehub-ci.yml`:

```yaml
- name: Migration validation
  run: |
    if [ -d "supabase/migrations" ]; then
      echo "Migration files found:"
      ls -la supabase/migrations/ | tail -5
      # Check for duplicate migration names
      if ls supabase/migrations/*.sql 2>/dev/null | xargs -n1 basename | sort | uniq -d | grep -q .; then
        echo "::error::Duplicate migration names found"
        exit 1
      fi
      echo "Migration validation passed"
    else
      echo "No migrations directory found"
    fi
```

### Pre-Deployment Checks

Before deploying to production:

1. **Verify migrations are ordered**: Check timestamps are sequential
2. **Verify no duplicate names**: Check for duplicate migration names
3. **Verify RLS is enabled**: Check all tables have RLS enabled
4. **Verify no hardcoded secrets**: Scan for secrets in migration files

---

## Verification

### Local Verification

```bash
# Reset local database and apply all migrations
supabase db reset

# Check migration status
supabase migration list

# Verify schema
supabase db dump --schema-only > schema.sql
```

### Staging Verification

```bash
# Push migrations to staging
supabase db push

# Verify migrations applied
psql $DATABASE_URL -c "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;"
```

### Production Verification

```bash
# Push migrations to production (manual approval required)
supabase db push

# Verify migrations applied
psql $DATABASE_URL -c "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;"
```

---

## Durable Database Procedures

### 1. Creating a New Table

```sql
-- 1. Create table
CREATE TABLE IF NOT EXISTS new_table (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Enable RLS
ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;

-- 3. Create policies
CREATE POLICY "new_table_select_own" ON new_table
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- 4. Create indexes
CREATE INDEX idx_new_table_created_at ON new_table(created_at DESC);

-- 5. Create triggers
CREATE TRIGGER update_updated_at
  BEFORE UPDATE ON new_table
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### 2. Adding a Column

```sql
-- Add column with default
ALTER TABLE existing_table
  ADD COLUMN IF NOT EXISTS new_column text DEFAULT NULL;

-- Add index if needed
CREATE INDEX IF NOT EXISTS idx_existing_table_new_column
  ON existing_table(new_column);
```

### 3. Creating an RPC

```sql
CREATE OR REPLACE FUNCTION public.my_rpc(p_param uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('id', id, 'name', name)
  FROM my_table
  WHERE id = p_param;
$$;

-- Grant execute
GRANT EXECUTE ON FUNCTION public.my_rpc(uuid) TO authenticated;
```

### 4. Modifying RLS Policies

```sql
-- Drop existing policy
DROP POLICY IF EXISTS "my_policy" ON my_table;

-- Create new policy
CREATE POLICY "my_policy_new" ON my_table
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
```

---

## Summary

| Aspect | Status | Notes |
|--------|--------|-------|
| Migration ordering | ✅ Deterministic | Timestamp-based |
| New schema changes | ✅ Version controlled | `supabase/migrations/` |
| RLS changes | ✅ Version controlled | In migrations |
| RPC changes | ✅ Version controlled | In migrations |
| Indexes/constraints | ✅ Version controlled | In migrations |
| Seeds | ✅ Separated | `supabase/seeds/` |
| Legacy files | ⚠️ Reference only | `apps/*/sql/` |
| CI validation | ✅ Added | Migration validation step |
| Rollback | ⚠️ Forward-only | Create new migration to reverse |

---

*Document generated: 2026-09-28*
*Supabase project: szdybxmgmhndoytqanfb*
