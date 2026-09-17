-- 20260917_migrate_admin_auth.sql
-- Migrate admin_users to Supabase Auth so login uses signInWithPassword
-- (matching CareHub's auth pattern).
--
-- For each active admin_users row that doesn't have a matching auth.users
-- account, create one with a confirmed email and a temporary password.
-- Admins should change their password after first login.

-- Step 1: Create auth users for admins that don't have one yet
DO $$
DECLARE
  admin_rec RECORD;
  auth_user_id UUID;
  temp_password TEXT := 'Admin@CareFind2026!';
BEGIN
  FOR admin_rec IN
    SELECT id, email, full_name
    FROM admin_users
    WHERE is_active = true
  LOOP
    -- Check if auth user already exists
    SELECT id INTO auth_user_id
    FROM auth.users
    WHERE lower(email) = lower(admin_rec.email)
    LIMIT 1;

    IF auth_user_id IS NULL THEN
      -- Create confirmed auth user
      auth_user_id := gen_random_uuid();
      INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at, confirmation_token,
        recovery_token, raw_app_meta_data, raw_user_meta_data,
        last_sign_in_at, is_super_admin
      ) VALUES (
        '00000000-0000-0000-0000-000000000000',
        auth_user_id,
        'authenticated',
        'authenticated',
        lower(admin_rec.email),
        crypt(temp_password, gen_salt('bf')),
        now(), now(), now(),
        encode(gen_random_bytes(32), 'hex'),
        encode(gen_random_bytes(32), 'hex'),
        '{"provider": "email", "providers": ["email"]}',
        jsonb_build_object('full_name', admin_rec.full_name),
        NULL,
        false
      );

      -- Create auth identities row
      INSERT INTO auth.identities (
        id, user_id, identity_data, provider, provider_id,
        last_sign_in_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(),
        auth_user_id,
        jsonb_build_object('sub', auth_user_id::text, 'email', lower(admin_rec.email)),
        'email',
        lower(admin_rec.email),
        now(), now(), now()
      );

      -- Create auth sessions reference
      INSERT INTO auth.instances (id, uuid, raw_base_config)
      VALUES ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', '{}')
      ON CONFLICT DO NOTHING;

      RAISE NOTICE 'Created auth user for % (%)', admin_rec.full_name, admin_rec.email;
    ELSE
      RAISE NOTICE 'Auth user already exists for % (%), skipping', admin_rec.full_name, admin_rec.email;
    END IF;
  END LOOP;
END $$;

-- Step 2: Verify the migration
SELECT
  au.email,
  au.full_name,
  au.role,
  CASE WHEN auth_u.id IS NOT NULL THEN 'YES' ELSE 'NO' END as has_auth_account
FROM admin_users au
LEFT JOIN auth.users auth_u ON lower(auth_u.email) = lower(au.email)
WHERE au.is_active = true
ORDER BY au.created_at;
