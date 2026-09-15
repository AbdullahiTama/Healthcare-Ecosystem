-- QA/test dummy data for CareFind — applied to production 2026-07-19,
-- companion to apps/carehub/sql/qa_seed_carehub.sql (same request: dummy
-- data across both apps for end-to-end manual testing). Every account
-- uses a *.carefind.test email and the password Test1234! (admin_users
-- uses admin-auth.js's own — fake but matching — hash scheme, since that
-- table isn't Supabase Auth at all). Cleanup template at the bottom.
--
-- profiles rows are created automatically by the existing
-- on_auth_user_created -> handle_new_user() trigger the moment each
-- auth.users row is inserted (confirmed live: it only sets id +
-- display_name from the email's local part), so this script updates
-- profiles afterward rather than inserting into it directly.
--
-- References apps/carehub/sql/qa_seed_carehub.sql's "Test Pharmacy — QA"
-- (d8663307-bec2-4881-a623-8df32eece770) and "Test Hospital — QA"
-- (aad12fcd-d263-4bc5-b7c1-46e6350acc45) business ids directly, to
-- exercise the CareHub<->CareFind claim bridge — run that script first.

do $$
declare
  v_instance_id uuid := '00000000-0000-0000-0000-000000000000';

  v_consumer_uid uuid := gen_random_uuid();
  v_pro_uid uuid := gen_random_uuid();
  v_pro_pending_uid uuid := gen_random_uuid();
  v_bizowner_uid uuid := gen_random_uuid();

  v_admin_id uuid := gen_random_uuid();

  v_pharmacy_business_id uuid := 'd8663307-bec2-4881-a623-8df32eece770';
  v_hospital_business_id uuid := 'aad12fcd-d263-4bc5-b7c1-46e6350acc45';

  v_post_pro_1 uuid := gen_random_uuid();
  v_post_pro_2 uuid := gen_random_uuid();
  v_post_consumer uuid := gen_random_uuid();

  v_task_id uuid := gen_random_uuid();
  v_news_published uuid := gen_random_uuid();
  v_news_pending uuid := gen_random_uuid();
begin

  ------------------------------------------------------------------
  -- Real Supabase Auth accounts (consumer identities). Same pattern as
  -- the CareHub seed: direct auth.users/auth.identities insert with a
  -- real bcrypt password, so AuthContext's signInWithPassword works
  -- immediately, no confirmation step needed.
  ------------------------------------------------------------------
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values
    (v_instance_id, v_consumer_uid, 'authenticated', 'authenticated', 'testconsumer@carefind.test', crypt('Test1234!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
    (v_instance_id, v_pro_uid, 'authenticated', 'authenticated', 'testprofessional@carefind.test', crypt('Test1234!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
    (v_instance_id, v_pro_pending_uid, 'authenticated', 'authenticated', 'testprofessional.pending@carefind.test', crypt('Test1234!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
    (v_instance_id, v_bizowner_uid, 'authenticated', 'authenticated', 'testbizowner@carefind.test', crypt('Test1234!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
  select gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now(), now()
  from auth.users u
  where u.email in ('testconsumer@carefind.test','testprofessional@carefind.test','testprofessional.pending@carefind.test','testbizowner@carefind.test');

  ------------------------------------------------------------------
  -- Admin account — NOT Supabase Auth. api/admin-auth.js's own login
  -- checks admin_users.password_hash directly against hashPassword(),
  -- which is `cf_hashed_${password}` (a known, tracked weakness — C3 in
  -- Technical-Debt.md — reproduced here deliberately since seeding has
  -- to match production's actual, current check to be useful for testing).
  ------------------------------------------------------------------
  insert into admin_users (id, email, password_hash, full_name, role, is_active)
  values (v_admin_id, 'testadmin@carefind.test', 'cf_hashed_Test1234!', 'Test Admin', 'super_admin', true);

  ------------------------------------------------------------------
  -- profiles — handle_new_user() already created a bare row per account
  -- (id + display_name only); fill in the rest.
  ------------------------------------------------------------------
  update profiles set full_name = 'Test Consumer', bio = 'Just here to test the app.', location = 'Lagos, Nigeria', phone = '08050000001'
  where id = v_consumer_uid;

  update profiles set full_name = 'Dr. Amara Nwachukwu', bio = 'General practitioner, 10 years experience. QA test account.', location = 'Lagos, Nigeria', phone = '08050000002',
    is_verified = true, verification_label = 'Verified Doctor', specialty = 'General Practice', subscription_price = 1000
  where id = v_pro_uid;

  update profiles set full_name = 'Dr. Bello Suleiman (Pending)', bio = 'Pharmacist awaiting verification. QA test account.', location = 'Abuja, Nigeria', phone = '08050000003', specialty = 'Pharmacy'
  where id = v_pro_pending_uid;

  update profiles set full_name = 'Chioma Eze (Business Owner)', bio = 'Owner of Test Pharmacy — QA. QA test account.', location = 'Lagos, Nigeria', phone = '08050000004'
  where id = v_bizowner_uid;

  ------------------------------------------------------------------
  -- Wallets & transactions
  ------------------------------------------------------------------
  insert into wallets (user_id, balance) values (v_consumer_uid, 42), (v_pro_uid, 12), (v_bizowner_uid, 5);

  insert into transactions (user_id, type, amount, naira_amount, reference, status, created_at)
  values
    (v_consumer_uid, 'topup', 50, 8500, 'cf_qa_topup_0001', 'success', now() - interval '6 days'),
    (v_consumer_uid, 'gift_sent', 8, null, 'cf_qa_gift_0001', 'success', now() - interval '3 days'),
    (v_pro_uid, 'gift_received', 6, null, 'cf_qa_gift_0001', 'success', now() - interval '3 days'),
    (v_pro_uid, 'subscription_earning', 1000, null, null, 'success', now() - interval '2 days');

  -- A pending withdrawal for the professional, mirroring what
  -- request_withdrawal() itself would have done (deduct then insert both
  -- rows), so the admin approve/reject actions we hardened have something
  -- real to act on.
  insert into withdrawal_requests (user_id, amount, bank_name, account_number, account_name, status, created_at)
  values (v_pro_uid, 5, 'GTBank', '0123456789', 'Amara Nwachukwu', 'pending', now() - interval '1 day');

  ------------------------------------------------------------------
  -- Monetization offers
  ------------------------------------------------------------------
  insert into subscriptions (professional_id, price, description, is_active)
  values (v_pro_uid, 1000, 'Monthly access to my exclusive health tips and Q&A posts.', true);

  insert into creator_subscriptions (subscriber_id, creator_id, price, auto_renew, expires_at)
  values (v_consumer_uid, v_pro_uid, 1000, true, now() + interval '25 days');

  ------------------------------------------------------------------
  -- Verification & claims — one already-resolved (verified pro), one
  -- still pending (pending pro) so the admin approval flow has a real
  -- pending item to act on.
  ------------------------------------------------------------------
  insert into verification_requests (user_id, full_name, profession, status, phone, workplace, work_address, years_experience)
  values
    (v_pro_uid, 'Dr. Amara Nwachukwu', 'General Practitioner', 'approved', '08050000002', 'Lagos General Hospital', '1 Marina Road, Lagos', '10'),
    (v_pro_pending_uid, 'Dr. Bello Suleiman', 'Pharmacist', 'pending', '08050000003', 'Test Pharmacy — QA', '12 Allen Avenue, Ikeja', '4');

  insert into business_claims (user_id, business_id, status)
  values
    (v_bizowner_uid, v_pharmacy_business_id, 'approved'),
    (v_consumer_uid, v_hospital_business_id, 'pending');

  ------------------------------------------------------------------
  -- Social feed
  ------------------------------------------------------------------
  insert into posts (id, user_id, content, post_type, view_count)
  values
    (v_post_pro_1, v_pro_uid, 'Reminder: stay hydrated this dry season! Aim for at least 2 litres of water a day. 💧', 'text', 34),
    (v_post_pro_2, v_pro_uid, 'Q&A session this Friday at 6pm — drop your health questions below.', 'text', 12),
    (v_post_consumer, v_consumer_uid, 'Just found this app, looks great for finding pharmacies near me!', 'text', 5);

  insert into post_reactions (post_id, user_id, reaction_type) values (v_post_pro_1, v_consumer_uid, 'like');
  insert into post_comments (post_id, user_id, content) values (v_post_pro_1, v_consumer_uid, 'Great reminder, thank you doctor!');
  insert into saved_posts (user_id, post_id) values (v_consumer_uid, v_post_pro_1);
  insert into reports (reporter_id, post_id, reason, status) values (v_consumer_uid, v_post_pro_2, 'Spam / promotional content', 'pending');

  insert into notifications (recipient_id, actor_id, type, message, post_id, read)
  values (v_pro_uid, v_consumer_uid, 'like', 'Test Consumer liked your post', v_post_pro_1, false);

  ------------------------------------------------------------------
  -- News & stories
  ------------------------------------------------------------------
  insert into news (id, headline, subtitle, body, author_id, status, published_at, view_count)
  values (v_news_published, 'New malaria vaccine rollout begins in Lagos', 'Free doses available at select PHCs', 'The Lagos State Ministry of Health has begun...', v_pro_uid, 'approved', now() - interval '2 days', 87);

  insert into news (id, headline, subtitle, body, author_id, status)
  values (v_news_pending, 'QA test: pending news submission', 'Awaiting admin review', 'This is a seeded pending news article for testing the approve/reject flow.', v_pro_uid, 'pending');

  insert into stories (title, body, user_id, is_platform)
  values ('Health Tip', 'Wash your hands regularly!', v_pro_uid, false);

  ------------------------------------------------------------------
  -- Live (both "families" per Schema-Reference-CareFind.md §3 — seeded
  -- lightly since neither can carry an actual live broadcast here)
  ------------------------------------------------------------------
  insert into live_shows (host_id, title, status, is_platform, scheduled_at)
  values (null, 'CareFind Live: Ask a Pharmacist', 'scheduled', true, now() + interval '2 days');

  insert into live_shows (host_id, title, status, started_at, ended_at, is_platform)
  values (v_pro_uid, 'Test past session', 'ended', now() - interval '5 days', now() - interval '5 days' + interval '40 minutes', false);

  ------------------------------------------------------------------
  -- Tasks (professional gig marketplace)
  ------------------------------------------------------------------
  -- created_by FKs to auth.users, not admin_users (admin accounts aren't
  -- Supabase Auth at all — see C3) — left null, same as any task an admin
  -- account actually posts today.
  insert into tasks (id, title, description, compensation, specialty, deadline, status, created_by)
  values (v_task_id, 'Write a health-tip article', 'Write a 300-word article on seasonal allergies for the CareFind blog.', 2000, 'General Practice', now() + interval '10 days', 'open', null);

  insert into task_submissions (task_id, professional_id, response, status)
  values (v_task_id, v_pro_uid, 'I''d like to take this on — draft attached.', 'pending');

  ------------------------------------------------------------------
  -- Admin-managed banner
  ------------------------------------------------------------------
  insert into promotions (title, image_url, link_url, expires_at)
  values ('QA test promotion banner', null, 'https://carefind.test/promo', now() + interval '14 days');

end $$;
