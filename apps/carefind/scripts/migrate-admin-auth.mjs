import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const supabase = createClient(
  'https://szdybxmgmhndoytqanfb.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6ZHlieG1nbWhuZG95dHFhbmZiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjY0NjczMSwiZXhwIjoyMDk4MjIyNzMxfQ.WQMU9yVMN-Ey616bP-rLRbtCoMObmcO5yAdGYjtGiFc'
)

const TEMP_PASSWORD = 'Admin@CareFind2026!'

async function run() {
  console.log('=== Step 1: Create exec_sql helper function ===\n')

  const createFnSql = `
    CREATE OR REPLACE FUNCTION public.exec_sql(sql text)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    BEGIN
      EXECUTE sql;
    END;
    $$;

    GRANT EXECUTE ON FUNCTION public.exec_sql(text) TO service_role;
  `

  const { error: fnErr } = await supabase.rpc('exec_sql', { sql: createFnSql }).single()
  // That will fail because exec_sql doesn't exist yet. Use a different approach.
  // We need to create the function via the SQL API or direct connection.

  // Alternative: use the Supabase REST API to run raw SQL via the /rest/v1/rpc endpoint
  // But we can't do DDL via RPC. We need to use a different approach.

  // Let's try using the Supabase Management API to execute SQL
  // Actually, let's just use a direct HTTP request to the PostgREST /rpc endpoint
  // and create a stored procedure that does the migration.

  // Simplest approach: create a migration function, call it, then drop it
  const migrationFnSql = `
    CREATE OR REPLACE FUNCTION public.migrate_admin_auth_users()
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $func$
    DECLARE
      admin_rec RECORD;
      auth_user_id UUID;
      result jsonb := '[]'::jsonb;
      temp_pw text := '${TEMP_PASSWORD}';
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

        IF auth_user_id IS NOT NULL THEN
          result := result || jsonb_build_object(
            'email', admin_rec.email,
            'status', 'already_exists',
            'auth_id', auth_user_id::text
          );
          CONTINUE;
        END IF;

        -- Disable trigger temporarily
        ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;

        auth_user_id := admin_rec.id;

        -- Create auth user
        INSERT INTO auth.users (
          instance_id, id, aud, role, email, encrypted_password,
          email_confirmed_at, created_at, updated_at,
          confirmation_token, recovery_token,
          raw_app_meta_data, raw_user_meta_data,
          last_sign_in_at, is_super_admin
        ) VALUES (
          '00000000-0000-0000-0000-000000000000',
          auth_user_id,
          'authenticated',
          'authenticated',
          lower(admin_rec.email),
          crypt(temp_pw, gen_salt('bf')),
          now(), now(), now(),
          encode(gen_random_bytes(32), 'hex'),
          encode(gen_random_bytes(32), 'hex'),
          '{"provider": "email", "providers": ["email"]}'::jsonb,
          jsonb_build_object('full_name', COALESCE(admin_rec.full_name, split_part(admin_rec.email, '@', 1))),
          now(),
          false
        )
        ON CONFLICT (id) DO NOTHING;

        -- Create auth identity
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
        )
        ON CONFLICT DO NOTHING;

        -- Create profile
        INSERT INTO public.profiles (id, display_name, full_name)
        VALUES (
          auth_user_id,
          COALESCE(admin_rec.full_name, split_part(admin_rec.email, '@', 1)) || ' (Admin)',
          admin_rec.full_name
        )
        ON CONFLICT (id) DO UPDATE
        SET display_name = COALESCE(admin_rec.full_name, split_part(admin_rec.email, '@', 1)) || ' (Admin)',
            full_name = admin_rec.full_name;

        -- Re-enable trigger
        ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;

        result := result || jsonb_build_object(
          'email', admin_rec.email,
          'status', 'created',
          'auth_id', auth_user_id::text
        );
      END LOOP;

      RETURN result;
    END;
    $func$;
  `

  console.log('Creating migration function via direct SQL...')

  // We can't use rpc because exec_sql doesn't exist. We need another way.
  // The only way to run raw SQL without an existing function is via the
  // Supabase SQL editor (dashboard) or a direct postgres connection.
  // Let's try using the Supabase client's raw fetch to the SQL endpoint.

  const resp = await fetch('https://szdybxmgmhndoytqanfb.supabase.co/rest/v1/rpc/migrate_admin_auth_users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6ZHlieG1nbWhuZG95dHFhbmZiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjY0NjczMSwiZXhwIjoyMDk4MjIyNzMxfQ.WQMU9yVMN-Ey616bP-rLRbtCoMObmcO5yAdGYjtGiFc',
      'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6ZHlieG1nbWhuZG95dHFhbmZiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjY0NjczMSwiZXhwIjoyMDk4MjIyNzMxfQ.WQMU9yVMN-Ey616bP-rLRbtCoMObmcO5yAdGYjtGiFc',
    },
    body: JSON.stringify({}),
  })

  if (!resp.ok) {
    const body = await resp.text()
    console.log(`Function doesn't exist yet (${resp.status}). Need to create it first.`)
    console.log('\nPlease run this SQL in the Supabase SQL Editor:\n')
    console.log(migrationFnSql)
    console.log('\nThen run this script again.')
    process.exit(1)
  }

  const result = await resp.json()
  console.log('\nMigration results:')
  for (const r of result) {
    console.log(`  ${r.email}: ${r.status} (${r.auth_id})`)
  }
  console.log(`\nTemporary password: ${TEMP_PASSWORD}`)
}

run()
