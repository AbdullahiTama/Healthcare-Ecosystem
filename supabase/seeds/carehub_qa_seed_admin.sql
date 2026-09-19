-- QA admin account for CareHub — run in Supabase SQL Editor.
-- Log in at /login with admin@carehub.test / Admin@1234!
-- Navigate to /admin to approve/reject businesses.
--
-- Uses the same bcrypt + auth.users pattern as qa_seed_carehub.sql
-- so the real Supabase Auth path works immediately.

do $$
declare
  v_instance_id uuid := '00000000-0000-0000-0000-000000000000';
  v_admin_uid uuid := gen_random_uuid();
  v_biz_id uuid := gen_random_uuid();
  v_placeholder_pw text := encode(gen_random_bytes(24), 'hex');
begin

  ------------------------------------------------------------------
  -- Auth account (bcrypt, matches Login.jsx's real auth path)
  ------------------------------------------------------------------
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values
    (v_instance_id, v_admin_uid, 'authenticated', 'authenticated', 'admin@carehub.test', crypt('Admin@1234!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
  values (gen_random_uuid(), v_admin_uid, v_admin_uid::text, jsonb_build_object('sub', v_admin_uid::text, 'email', 'admin@carehub.test'), 'email', now(), now(), now());

  ------------------------------------------------------------------
  -- Business row with platform admin flag
  ------------------------------------------------------------------
  insert into businesses (id, name, owner, email, password, phone, whatsapp, address, state, city, business_type, hours, website, status, visible_on_carefind, plan, is_platform_admin)
  values
    (v_biz_id, 'CareHub Admin — QA', 'Super Admin', 'admin@carehub.test', v_placeholder_pw, '08000000000', '08000000000', '1 CareHub HQ', 'Lagos', 'Ikeja', 'pharmacy', '24 hours', 'https://carehub.test', 'active', false, 'enterprise', true);

end $$;
