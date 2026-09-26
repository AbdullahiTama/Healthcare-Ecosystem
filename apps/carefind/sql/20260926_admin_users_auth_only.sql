-- Link every CareFind admin to a verified Supabase Auth identity before
-- removing the legacy password hashes. This is a fail-closed migration:
-- it aborts without changing credentials if an admin identity is missing
-- or email matching is ambiguous. Create/verify those Auth users, then retry.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.migrate_admin_auth_users()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.migrate_admin_auth_users() FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS auth_user_id uuid;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.admin_users
    GROUP BY lower(btrim(email))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate normalized admin emails; resolve before linking Auth identities';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.admin_users AS admin
    WHERE admin.auth_user_id IS NULL
      AND (
        SELECT count(*)
        FROM auth.users AS auth_user
        WHERE lower(btrim(auth_user.email)) = lower(btrim(admin.email))
      ) <> 1
  ) THEN
    RAISE EXCEPTION 'Every admin must have exactly one matching Supabase Auth user before credentials are cleared';
  END IF;

  IF EXISTS (
    SELECT auth_user_id
    FROM public.admin_users
    WHERE auth_user_id IS NOT NULL
    GROUP BY auth_user_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'A Supabase Auth identity is linked to multiple admin rows';
  END IF;
END $$;

UPDATE public.admin_users AS admin
SET auth_user_id = auth_user.id
FROM auth.users AS auth_user
WHERE admin.auth_user_id IS NULL
  AND lower(btrim(auth_user.email)) = lower(btrim(admin.email));

CREATE UNIQUE INDEX IF NOT EXISTS admin_users_auth_user_id_key
  ON public.admin_users (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.admin_users'::regclass
      AND conname = 'admin_users_auth_user_id_fkey'
  ) THEN
    ALTER TABLE public.admin_users
      ADD CONSTRAINT admin_users_auth_user_id_fkey
      FOREIGN KEY (auth_user_id) REFERENCES auth.users (id)
      ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE public.admin_users
  ALTER COLUMN password_hash DROP NOT NULL;

UPDATE public.admin_users
SET password_hash = NULL
WHERE password_hash IS NOT NULL;

COMMIT;
