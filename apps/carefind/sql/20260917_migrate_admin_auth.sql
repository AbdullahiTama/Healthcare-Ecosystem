-- Migrate admin_users to Supabase Auth
-- Run this in Supabase SQL Editor, then login with the temp password

-- 1. Create the migration function
CREATE OR REPLACE FUNCTION public.migrate_admin_auth_users()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  admin_rec RECORD;
  auth_user_id UUID;
  result jsonb := '[]'::jsonb;
  temp_pw text := 'Admin@CareFind2026!';
BEGIN
  FOR admin_rec IN
    SELECT id, email, full_name
    FROM admin_users
    WHERE is_active = true
  LOOP
    SELECT id INTO auth_user_id
    FROM auth.users
    WHERE lower(email) = lower(admin_rec.email)
    LIMIT 1;

    IF auth_user_id IS NOT NULL THEN
      result := result || jsonb_build_object(
        'email', admin_rec.email, 'status', 'already_exists'
      );
      CONTINUE;
    END IF;

    -- Disable trigger to avoid unique_display_name conflict
    ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;

    auth_user_id := admin_rec.id;

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      confirmation_token, recovery_token,
      raw_app_meta_data, raw_user_meta_data,
      last_sign_in_at, is_super_admin
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      auth_user_id, 'authenticated', 'authenticated',
      lower(admin_rec.email), crypt(temp_pw, gen_salt('bf')),
      now(), now(), now(),
      encode(gen_random_bytes(32), 'hex'),
      encode(gen_random_bytes(32), 'hex'),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      jsonb_build_object('full_name', COALESCE(admin_rec.full_name, split_part(admin_rec.email, '@', 1))),
      now(), false
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), auth_user_id,
      jsonb_build_object('sub', auth_user_id::text, 'email', lower(admin_rec.email)),
      'email', lower(admin_rec.email), now(), now(), now()
    ) ON CONFLICT DO NOTHING;

    INSERT INTO public.profiles (id, display_name, full_name)
    VALUES (
      auth_user_id,
      COALESCE(admin_rec.full_name, split_part(admin_rec.email, '@', 1)) || ' (Admin)',
      admin_rec.full_name
    )
    ON CONFLICT (id) DO UPDATE
    SET display_name = EXCLUDED.display_name, full_name = EXCLUDED.full_name;

    ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;

    result := result || jsonb_build_object(
      'email', admin_rec.email, 'status', 'created'
    );
  END LOOP;

  RETURN result;
END;
$func$;

-- 2. Run it
SELECT * FROM public.migrate_admin_auth_users();

-- 3. Verify
SELECT
  au.email, au.full_name, au.role,
  CASE WHEN auth_u.id IS NOT NULL THEN 'YES' ELSE 'NO' END as has_auth
FROM admin_users au
LEFT JOIN auth.users auth_u ON lower(auth_u.email) = lower(au.email)
WHERE au.is_active = true;

-- 4. Cleanup (optional — run after verifying)
-- DROP FUNCTION IF EXISTS public.migrate_admin_auth_users();
