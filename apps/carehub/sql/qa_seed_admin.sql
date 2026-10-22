-- QA admin account for CareHub — run in the Supabase SQL Editor of a NON-PRODUCTION project only.
--
-- NEVER run this against production (carehub / szdybxmgmhndoytqanfb). It creates a PLATFORM ADMIN
-- login. A previous revision documented its password in this file; that account existed in
-- production with that password, and was rotated on 2026-10-22. Credentials do not belong in the repo.
--
-- The password is supplied by whoever runs the script, in the same session, and is never stored here:
--   set carehub.qa_admin_password = '<a long random password, 16+ characters>';
-- then run this file. Log in at /login as admin@carehub.test with that password, then open /admin.
-- The script refuses to run without it.
--
-- Uses the same bcrypt + auth.users pattern as qa_seed_carehub.sql
-- so the real Supabase Auth path works immediately.

do $$
declare
  v_instance_id uuid := '00000000-0000-0000-0000-000000000000';
  v_admin_uid uuid := gen_random_uuid();
  v_biz_id uuid := gen_random_uuid();
  v_placeholder_pw text := encode(gen_random_bytes(24), 'hex');
  v_admin_pw text := current_setting('carehub.qa_admin_password', true);
begin

  if v_admin_pw is null or length(v_admin_pw) < 16 then
    raise exception 'Refusing to seed: first run  set carehub.qa_admin_password = ''<16+ character random password>'';  in this session. Never run this on production.';
  end if;

  ------------------------------------------------------------------
  -- Auth account (bcrypt, matches Login.jsx's real auth path)
  ------------------------------------------------------------------
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values
    (v_instance_id, v_admin_uid, 'authenticated', 'authenticated', 'admin@carehub.test', crypt(v_admin_pw, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
  values (gen_random_uuid(), v_admin_uid, v_admin_uid::text, jsonb_build_object('sub', v_admin_uid::text, 'email', 'admin@carehub.test'), 'email', now(), now(), now());

  ------------------------------------------------------------------
  -- Business row with platform admin flag
  ------------------------------------------------------------------
  insert into businesses (id, name, owner, email, password, phone, whatsapp, address, state, city, business_type, hours, website, status, visible_on_carefind, plan, is_platform_admin)
  values
    (v_biz_id, 'CareHub Admin — QA', 'Super Admin', 'admin@carehub.test', v_placeholder_pw, '08000000000', '08000000000', '1 CareHub HQ', 'Lagos', 'Ikeja', 'pharmacy', '24 hours', 'https://carehub.test', 'active', false, 'enterprise', true);

end $$;
