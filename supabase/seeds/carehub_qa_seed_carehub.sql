-- QA/test dummy data for CareHub — applied to production 2026-07-19, on
-- explicit request ("insert dummy data... from login to exploring the
-- whole apps"). Every account uses a *.carehub.test email and the password
-- Test1234! so it's unmistakably fake and trivial to bulk-delete later
-- (see the DELETE template at the bottom of this file, commented out).
--
-- Real Supabase Auth accounts are created directly via auth.users/
-- auth.identities (bcrypt via pgcrypto, matching what GoTrue itself would
-- write) rather than the app's signUp() flow, since this is server-side
-- seeding. Login.jsx tries authClient.auth.signInWithPassword() first, so
-- these log in through the real Phase 1 auth path, not the legacy
-- plaintext fallback. businesses.password/staff.password (legacy, NOT
-- NULL columns) are still set to a random unusable value so the fallback
-- path exists but is never actually reached for these rows.

do $$
declare
  v_instance_id uuid := '00000000-0000-0000-0000-000000000000';

  -- business ids
  v_pharm_id uuid := gen_random_uuid();
  v_hosp_id uuid := gen_random_uuid();
  v_ent_id uuid := gen_random_uuid();

  -- auth user ids (pharmacy)
  v_pharm_owner_uid uuid := gen_random_uuid();
  v_pharm_cashier_uid uuid := gen_random_uuid();
  -- staff row ids (pharmacy)
  v_pharm_cashier_staff_id uuid := gen_random_uuid();

  -- auth user ids (hospital)
  v_hosp_owner_uid uuid := gen_random_uuid();
  v_hosp_reception_uid uuid := gen_random_uuid();
  v_hosp_nurse_uid uuid := gen_random_uuid();
  v_hosp_doctor_uid uuid := gen_random_uuid();
  v_hosp_lab_uid uuid := gen_random_uuid();
  v_hosp_pharmacist_uid uuid := gen_random_uuid();
  -- staff row ids (hospital)
  v_hosp_reception_staff_id uuid := gen_random_uuid();
  v_hosp_nurse_staff_id uuid := gen_random_uuid();
  v_hosp_doctor_staff_id uuid := gen_random_uuid();
  v_hosp_lab_staff_id uuid := gen_random_uuid();
  v_hosp_pharmacist_staff_id uuid := gen_random_uuid();

  -- auth user ids (enterprise)
  v_ent_owner_uid uuid := gen_random_uuid();
  v_ent_rep_uid uuid := gen_random_uuid();
  v_ent_rep_staff_id uuid := gen_random_uuid();

  -- patient ids (hospital)
  v_pat_reception uuid := gen_random_uuid();
  v_pat_triage uuid := gen_random_uuid();
  v_pat_doctor uuid := gen_random_uuid();
  v_pat_lab uuid := gen_random_uuid();
  v_pat_pharmacy uuid := gen_random_uuid();
  v_pat_admitted uuid := gen_random_uuid();
  v_pat_discharged uuid := gen_random_uuid();

  -- products
  v_prod_1 uuid; v_prod_2 uuid; v_prod_3 uuid;

  -- consultation ids (hospital) — captured so lab/imaging/rx requests can reference them
  v_consult_doctor uuid := gen_random_uuid();
  v_consult_lab uuid := gen_random_uuid();
  v_consult_pharmacy uuid := gen_random_uuid();
  v_consult_admitted uuid := gen_random_uuid();
  v_consult_discharged uuid := gen_random_uuid();

  -- territory / location
  v_territory_id uuid := gen_random_uuid();
  v_location_id uuid := gen_random_uuid();

  v_placeholder_pw text := encode(gen_random_bytes(24), 'hex'); -- unusable legacy password
begin

  ------------------------------------------------------------------
  -- Helper pattern repeated per account: insert into auth.users +
  -- auth.identities with a real bcrypt password so Login.jsx's real-auth
  -- path (authClient.auth.signInWithPassword) works immediately.
  ------------------------------------------------------------------

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values
    (v_instance_id, v_pharm_owner_uid, 'authenticated', 'authenticated', 'owner.pharmacy@carehub.test', crypt('Test1234!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
    (v_instance_id, v_pharm_cashier_uid, 'authenticated', 'authenticated', 'cashier.pharmacy@carehub.test', crypt('Test1234!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
    (v_instance_id, v_hosp_owner_uid, 'authenticated', 'authenticated', 'owner.hospital@carehub.test', crypt('Test1234!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
    (v_instance_id, v_hosp_reception_uid, 'authenticated', 'authenticated', 'reception.hospital@carehub.test', crypt('Test1234!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
    (v_instance_id, v_hosp_nurse_uid, 'authenticated', 'authenticated', 'nurse.hospital@carehub.test', crypt('Test1234!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
    (v_instance_id, v_hosp_doctor_uid, 'authenticated', 'authenticated', 'doctor.hospital@carehub.test', crypt('Test1234!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
    (v_instance_id, v_hosp_lab_uid, 'authenticated', 'authenticated', 'lab.hospital@carehub.test', crypt('Test1234!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
    (v_instance_id, v_hosp_pharmacist_uid, 'authenticated', 'authenticated', 'pharmacist.hospital@carehub.test', crypt('Test1234!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
    (v_instance_id, v_ent_owner_uid, 'authenticated', 'authenticated', 'owner.wholesale@carehub.test', crypt('Test1234!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
    (v_instance_id, v_ent_rep_uid, 'authenticated', 'authenticated', 'rep.wholesale@carehub.test', crypt('Test1234!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
  select gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now(), now()
  from auth.users u
  where u.email in ('owner.pharmacy@carehub.test','cashier.pharmacy@carehub.test','owner.hospital@carehub.test','reception.hospital@carehub.test','nurse.hospital@carehub.test','doctor.hospital@carehub.test','lab.hospital@carehub.test','pharmacist.hospital@carehub.test','owner.wholesale@carehub.test','rep.wholesale@carehub.test');

  ------------------------------------------------------------------
  -- Businesses
  ------------------------------------------------------------------
  insert into businesses (id, name, owner, email, password, phone, whatsapp, address, state, city, business_type, hours, website, status, visible_on_carefind, plan)
  values
    (v_pharm_id, 'Test Pharmacy — QA', 'Chidinma Okoro', 'owner.pharmacy@carehub.test', v_placeholder_pw, '08010000001', '08010000001', '12 Allen Avenue', 'Lagos', 'Ikeja', 'pharmacy', '8am - 9pm', 'https://testpharmacy.test', 'active', true, 'basic'),
    (v_hosp_id, 'Test Hospital — QA', 'Dr. Emeka Nwosu', 'owner.hospital@carehub.test', v_placeholder_pw, '08010000002', '08010000002', '45 Ademola Street', 'Abuja', 'Wuse', 'hospital', '24 hours', 'https://testhospital.test', 'active', true, 'basic'),
    (v_ent_id, 'Test Wholesale Distributors — QA', 'Funke Adebayo', 'owner.wholesale@carehub.test', v_placeholder_pw, '08010000003', '08010000003', '3 Industrial Layout', 'Kano', 'Sabon Gari', 'wholesale', '8am - 6pm', 'https://testwholesale.test', 'active', true, 'basic');

  ------------------------------------------------------------------
  -- Staff (non-owner accounts; Owner accounts ARE the business row, per
  -- CareHub's existing model of businesses.email/password being the
  -- owner login)
  ------------------------------------------------------------------
  insert into staff (id, business_id, full_name, email, password, role, phone, status)
  values
    (v_pharm_cashier_staff_id, v_pharm_id, 'Tunde Bakare', 'cashier.pharmacy@carehub.test', v_placeholder_pw, 'Cashier', '08010000011', 'active'),
    (v_hosp_reception_staff_id, v_hosp_id, 'Ngozi Eze', 'reception.hospital@carehub.test', v_placeholder_pw, 'Receptionist', '08010000012', 'active'),
    (v_hosp_nurse_staff_id, v_hosp_id, 'Blessing Uche', 'nurse.hospital@carehub.test', v_placeholder_pw, 'Nurse', '08010000013', 'active'),
    (v_hosp_doctor_staff_id, v_hosp_id, 'Dr. Ibrahim Sani', 'doctor.hospital@carehub.test', v_placeholder_pw, 'Doctor', '08010000014', 'active'),
    (v_hosp_lab_staff_id, v_hosp_id, 'Grace Effiong', 'lab.hospital@carehub.test', v_placeholder_pw, 'Lab Technician', '08010000015', 'active'),
    (v_hosp_pharmacist_staff_id, v_hosp_id, 'Segun Aluko', 'pharmacist.hospital@carehub.test', v_placeholder_pw, 'Pharmacist', '08010000016', 'active'),
    (v_ent_rep_staff_id, v_ent_id, 'Kelechi Obi', 'rep.wholesale@carehub.test', v_placeholder_pw, 'Regional Manager', '08010000017', 'active');

  ------------------------------------------------------------------
  -- Pharmacy: products, sales, patients/clients, expenses, debts, purchases, appointments
  ------------------------------------------------------------------
  insert into products (id, business_id, name, generic_name, category, price, stock, emoji, cost_price, barcode, reorder_level, list_on_carefind)
  values
    (gen_random_uuid(), v_pharm_id, 'Paracetamol 500mg (Pack of 20)', 'Paracetamol', 'Medicines', 500, 120, '💊', 300, '6001010000001', 20, true),
    (gen_random_uuid(), v_pharm_id, 'Amoxicillin 500mg (Pack of 10)', 'Amoxicillin', 'Medicines', 1200, 60, '💊', 800, '6001010000002', 10, true),
    (gen_random_uuid(), v_pharm_id, 'Vitamin C Effervescent', 'Ascorbic Acid', 'Medicines', 1500, 45, '💊', 1000, '6001010000003', 10, true),
    (gen_random_uuid(), v_pharm_id, 'Hydrating Face Cream', null, 'Skincare', 3500, 25, '🧴', 2200, '6001010000004', 5, true),
    (gen_random_uuid(), v_pharm_id, 'Sunscreen SPF 50', null, 'Skincare', 4200, 18, '☀️', 2800, '6001010000005', 5, true),
    (gen_random_uuid(), v_pharm_id, 'Digital Thermometer', null, 'Equipment', 2500, 12, '🩺', 1600, '6001010000006', 3, false),
    (gen_random_uuid(), v_pharm_id, 'Hand Sanitizer 500ml', null, 'Consumables', 800, 80, '🧴', 500, '6001010000007', 15, true),
    (gen_random_uuid(), v_pharm_id, 'First Aid Kit', null, 'Equipment', 5000, 8, '🩹', 3200, '6001010000008', 2, false);

  select id into v_prod_1 from products where business_id = v_pharm_id and name = 'Paracetamol 500mg (Pack of 20)';
  select id into v_prod_2 from products where business_id = v_pharm_id and name = 'Amoxicillin 500mg (Pack of 10)';
  select id into v_prod_3 from products where business_id = v_pharm_id and name = 'Hydrating Face Cream';

  insert into patients (id, business_id, reg_no, full_name, date_of_birth, gender, phone, address, status, pay_status)
  values
    (gen_random_uuid(), v_pharm_id, 'PH-QA-001', 'Adaeze Nnamdi', '1990-04-12', 'Female', '08020000001', '10 Marina Road, Lagos', 'at_reception', 'paid'),
    (gen_random_uuid(), v_pharm_id, 'PH-QA-002', 'Chukwuemeka Obi', '1985-11-03', 'Male', '08020000002', '25 Opebi Road, Lagos', 'at_reception', 'pending'),
    (gen_random_uuid(), v_pharm_id, 'PH-QA-003', 'Fatima Bello', '1998-02-20', 'Female', '08020000003', '7 Awolowo Way, Lagos', 'at_reception', 'paid');

  insert into sales (id, business_id, txn_no, client_name, items, subtotal, discount, total, payment_method, amount_paid, balance, is_credit, is_on_hold, staff_name)
  values
    (gen_random_uuid(), v_pharm_id, 'TXN-QA-0001', 'Adaeze Nnamdi', jsonb_build_array(jsonb_build_object('product_id', v_prod_1, 'name', 'Paracetamol 500mg (Pack of 20)', 'qty', 2, 'price', 500)), 1000, 0, 1000, 'Cash', 1000, 0, false, false, 'Tunde Bakare'),
    (gen_random_uuid(), v_pharm_id, 'TXN-QA-0002', 'Walk-in', jsonb_build_array(jsonb_build_object('product_id', v_prod_2, 'name', 'Amoxicillin 500mg (Pack of 10)', 'qty', 1, 'price', 1200), jsonb_build_object('product_id', v_prod_3, 'name', 'Hydrating Face Cream', 'qty', 1, 'price', 3500)), 4700, 200, 4500, 'Transfer', 4500, 0, false, false, 'Tunde Bakare'),
    (gen_random_uuid(), v_pharm_id, 'TXN-QA-0003', 'Chukwuemeka Obi', jsonb_build_array(jsonb_build_object('product_id', v_prod_1, 'name', 'Paracetamol 500mg (Pack of 20)', 'qty', 1, 'price', 500)), 500, 0, 500, 'Cash', 0, 500, true, false, 'Tunde Bakare');

  insert into expenses (id, business_id, category, description, amount, date, staff_name)
  values
    (gen_random_uuid(), v_pharm_id, 'Rent', 'Monthly shop rent', 150000, to_char(now() - interval '10 days', 'YYYY-MM-DD'), 'Chidinma Okoro'),
    (gen_random_uuid(), v_pharm_id, 'Utilities', 'Electricity bill', 12000, to_char(now() - interval '5 days', 'YYYY-MM-DD'), 'Chidinma Okoro'),
    (gen_random_uuid(), v_pharm_id, 'Supplies', 'Packaging bags', 4500, to_char(now() - interval '2 days', 'YYYY-MM-DD'), 'Tunde Bakare');

  insert into debts (id, business_id, direction, party_name, amount, amount_paid, balance, due_date, status, description)
  values
    (gen_random_uuid(), v_pharm_id, 'owes_us', 'Chukwuemeka Obi', 500, 0, 500, to_char(now() + interval '7 days', 'YYYY-MM-DD'), 'pending', 'Credit sale TXN-QA-0003'),
    (gen_random_uuid(), v_pharm_id, 'we_owe', 'MedSupply Distributors Ltd', 85000, 40000, 45000, to_char(now() + interval '14 days', 'YYYY-MM-DD'), 'pending', 'Stock supply invoice #2291');

  insert into purchases (id, business_id, supplier_name, product_name, quantity, cost_price, total_cost, amount_paid, balance, supply_date, status)
  values
    (gen_random_uuid(), v_pharm_id, 'MedSupply Distributors Ltd', 'Paracetamol 500mg (Pack of 20)', 100, 300, 30000, 30000, 0, to_char(now() - interval '20 days', 'YYYY-MM-DD'), 'received'),
    (gen_random_uuid(), v_pharm_id, 'MedSupply Distributors Ltd', 'Amoxicillin 500mg (Pack of 10)', 50, 800, 40000, 15000, 25000, to_char(now() - interval '20 days', 'YYYY-MM-DD'), 'received');

  insert into appointments (id, business_id, client_name, service, date, time, status, staff_name)
  values
    (gen_random_uuid(), v_pharm_id, 'Fatima Bello', 'Consultation', to_char(now() + interval '2 days', 'YYYY-MM-DD'), '10:00', 'pending', 'Chidinma Okoro'),
    (gen_random_uuid(), v_pharm_id, 'Adaeze Nnamdi', 'Follow-up', to_char(now() + interval '5 days', 'YYYY-MM-DD'), '14:30', 'pending', 'Chidinma Okoro');

  ------------------------------------------------------------------
  -- Hospital: patients across every pipeline stage, consultations, a
  -- small pharmacy stock for rx_inbox, staff notifications
  ------------------------------------------------------------------
  insert into patients (id, business_id, reg_no, full_name, date_of_birth, gender, phone, address, next_of_kin, next_of_kin_phone, department, assigned_doctor, status, pay_status)
  values
    (v_pat_reception, v_hosp_id, 'HOS-QA-001', 'Amina Yusuf', '1995-06-15', 'Female', '08030000001', '5 Garki Street, Abuja', 'Musa Yusuf', '08030000011', 'General', null, 'at_reception', 'pending'),
    (v_pat_triage, v_hosp_id, 'HOS-QA-002', 'Peter Okonkwo', '1978-09-22', 'Male', '08030000002', '18 Wuse Zone 4, Abuja', 'Mary Okonkwo', '08030000012', 'General', null, 'at_triage', 'pending'),
    (v_pat_doctor, v_hosp_id, 'HOS-QA-003', 'Hauwa Abdullahi', '2001-01-30', 'Female', '08030000003', '9 Maitama, Abuja', 'Yusuf Abdullahi', '08030000013', 'General', 'Dr. Ibrahim Sani', 'at_doctor', 'paid'),
    (v_pat_lab, v_hosp_id, 'HOS-QA-004', 'Chinedu Okafor', '1988-03-11', 'Male', '08030000004', '22 Asokoro, Abuja', 'Ifeoma Okafor', '08030000014', 'General', 'Dr. Ibrahim Sani', 'at_lab', 'paid'),
    (v_pat_pharmacy, v_hosp_id, 'HOS-QA-005', 'Zainab Mohammed', '1992-12-05', 'Female', '08030000005', '3 Gwarinpa, Abuja', 'Ahmed Mohammed', '08030000015', 'General', 'Dr. Ibrahim Sani', 'at_pharmacy', 'paid'),
    (v_pat_admitted, v_hosp_id, 'HOS-QA-006', 'Emeka Chukwu', '1965-07-19', 'Male', '08030000006', '14 Jabi, Abuja', 'Ngozi Chukwu', '08030000016', 'General', 'Dr. Ibrahim Sani', 'admitted', 'paid'),
    (v_pat_discharged, v_hosp_id, 'HOS-QA-007', 'Ruth Adeyemi', '2010-05-08', 'Female', '08030000007', '30 Life Camp, Abuja', 'Tope Adeyemi', '08030000017', 'General', 'Dr. Ibrahim Sani', 'discharged', 'paid');

  insert into consultations (id, patient_id, business_id, hpi, examination, primary_diagnosis, disposition, ward, doctor_name, status, performed_by)
  values
    (v_consult_doctor, v_pat_doctor, v_hosp_id, 'Fever and headache for 3 days', 'Temp 38.9C, mild pharyngeal erythema', 'Malaria (clinical)', null, null, 'Dr. Ibrahim Sani', 'open', 'Dr. Ibrahim Sani'),
    (v_consult_lab, v_pat_lab, v_hosp_id, 'Persistent cough and weight loss', 'Reduced air entry left base', 'Suspected pulmonary TB', 'Discharge', null, 'Dr. Ibrahim Sani', 'completed', 'Dr. Ibrahim Sani'),
    (v_consult_pharmacy, v_pat_pharmacy, v_hosp_id, 'Lower abdominal pain, dysuria', 'Suprapubic tenderness', 'Urinary tract infection', 'Discharge', null, 'Dr. Ibrahim Sani', 'completed', 'Dr. Ibrahim Sani'),
    (v_consult_admitted, v_pat_admitted, v_hosp_id, 'Chest pain and shortness of breath', 'BP 160/95, crackles at lung bases', 'Congestive heart failure', 'Admit', 'Male Ward A', 'Dr. Ibrahim Sani', 'completed', 'Dr. Ibrahim Sani'),
    (v_consult_discharged, v_pat_discharged, v_hosp_id, 'Sore throat, resolved', 'Clear chest, throat mildly inflamed', 'Viral pharyngitis', 'Discharge', null, 'Dr. Ibrahim Sani', 'completed', 'Dr. Ibrahim Sani');

  -- Lab/Imaging/RxInbox dashboards query lab_requests/imaging_requests/prescriptions,
  -- not patients.status directly — Doctor.jsx creates these when a doctor sends a
  -- patient to Lab/Imaging/Pharmacy, so seeding needs to mirror that, not just set
  -- patients.status, or those three dashboards would show empty queues.
  insert into lab_requests (id, patient_id, business_id, consultation_id, requested_by, tests, status, priority)
  values (gen_random_uuid(), v_pat_lab, v_hosp_id, v_consult_lab, 'Dr. Ibrahim Sani', jsonb_build_array(jsonb_build_object('name','Full Blood Count'), jsonb_build_object('name','Sputum AFB'), jsonb_build_object('name','Chest X-ray correlate')), 'pending', 'urgent');

  insert into imaging_requests (id, patient_id, business_id, consultation_id, requested_by, scan_type, body_part, clinical_info, status)
  values (gen_random_uuid(), v_pat_lab, v_hosp_id, v_consult_lab, 'Dr. Ibrahim Sani', 'X-Ray', 'Chest', 'Suspected pulmonary TB', 'pending');

  insert into prescriptions (id, patient_id, business_id, consultation_id, patient_name, doctor_name, medicines, status)
  values (gen_random_uuid(), v_pat_pharmacy, v_hosp_id, v_consult_pharmacy, 'Zainab Mohammed', 'Dr. Ibrahim Sani', jsonb_build_array(jsonb_build_object('name','Ciprofloxacin 500mg','dose','1 tab BD x 5 days'), jsonb_build_object('name','Paracetamol 500mg','dose','1-2 tabs TDS PRN')), 'pending');

  -- One of each already-completed, so Lab/Imaging/RxInbox's "completed"/"dispensed" tabs aren't empty either
  insert into lab_requests (id, patient_id, business_id, consultation_id, requested_by, tests, status, priority)
  values (gen_random_uuid(), v_pat_discharged, v_hosp_id, v_consult_discharged, 'Dr. Ibrahim Sani', jsonb_build_array(jsonb_build_object('name','Rapid Strep Test')), 'completed', 'routine');

  insert into prescriptions (id, patient_id, business_id, consultation_id, patient_name, doctor_name, medicines, status, dispensed_by, dispensed_at)
  values (gen_random_uuid(), v_pat_discharged, v_hosp_id, v_consult_discharged, 'Ruth Adeyemi', 'Dr. Ibrahim Sani', jsonb_build_array(jsonb_build_object('name','Amoxicillin 250mg Suspension','dose','5ml TDS x 5 days')), 'dispensed', 'Segun Aluko', now() - interval '1 day');

  insert into products (id, business_id, name, generic_name, category, price, stock, emoji, cost_price, reorder_level, list_on_carefind)
  values
    (gen_random_uuid(), v_hosp_id, 'Paracetamol IV 1g', 'Paracetamol', 'Medicines', 2000, 40, '💉', 1400, 10, false),
    (gen_random_uuid(), v_hosp_id, 'Amoxicillin-Clavulanate 625mg', 'Co-amoxiclav', 'Medicines', 1800, 30, '💊', 1200, 10, false),
    (gen_random_uuid(), v_hosp_id, 'IV Fluid (Normal Saline 1L)', null, 'Consumables', 900, 60, '💧', 500, 15, false);

  insert into appointments (id, business_id, client_name, service, date, time, status, staff_name)
  values
    (gen_random_uuid(), v_hosp_id, 'Amina Yusuf', 'General Checkup', to_char(now() + interval '3 days', 'YYYY-MM-DD'), '09:00', 'pending', 'Ngozi Eze');

  insert into staff_notifications (id, business_id, staff_id, is_owner, kind, title, body)
  values
    (gen_random_uuid(), v_hosp_id, null, true, 'new_patient', 'New patient registered', 'Amina Yusuf was registered at Reception.');

  ------------------------------------------------------------------
  -- Enterprise (wholesale): territory, rep assignment, a warehouse
  -- location, stock batches, an order in progress
  ------------------------------------------------------------------
  insert into territories (id, business_id, name, level) values (v_territory_id, v_ent_id, 'Kano North Territory', 'zone');
  insert into rep_territories (id, staff_id, territory_id) values (gen_random_uuid(), v_ent_rep_staff_id, v_territory_id);

  insert into enterprise_locations (id, business_id, parent_location_id, name, location_type, country, state, address)
  values (v_location_id, v_ent_id, null, 'Kano Central Warehouse', 'warehouse', 'Nigeria', 'Kano', '3 Industrial Layout, Sabon Gari');

  insert into products (id, business_id, name, category, price, stock, emoji, cost_price, reorder_level, list_on_carefind)
  values (gen_random_uuid(), v_ent_id, 'Paracetamol 500mg (Carton of 100 packs)', 'Medicines', 22000, 500, '📦', 16000, 50, true)
  returning id into v_prod_1;

  insert into stock_batches (id, business_id, location_id, product_id, product_name, batch_number, quantity, expiry_date, date_received, supplier_source, status, received_by)
  values (gen_random_uuid(), v_ent_id, v_location_id, v_prod_1, 'Paracetamol 500mg (Carton of 100 packs)', 'BATCH-QA-001', 500, (now() + interval '18 months')::date, now()::date, 'Factory', 'available', 'Kelechi Obi');

  insert into orders (id, business_id, order_ref, customer_name, customer_contact, territory_id, location_id, status, total_value, created_by_staff_id, created_by_name, created_by_title)
  values (gen_random_uuid(), v_ent_id, 'ORD-QA-0001', 'Northgate Pharmacy Chain', '08040000001', v_territory_id, v_location_id, 'submitted', 220000, v_ent_rep_staff_id, 'Kelechi Obi', 'Regional Manager');

end $$;

-- ============================================================
-- CLEANUP TEMPLATE (not run) — bulk-remove every QA row created above.
-- businesses/staff cascade to most child tables via business_id, but this
-- goes table-by-table explicitly rather than relying on that, since not
-- every FK here is declared with ON DELETE CASCADE.
-- ============================================================
-- delete from orders where business_id in (select id from businesses where email like '%@carehub.test');
-- delete from stock_batches where business_id in (select id from businesses where email like '%@carehub.test');
-- delete from enterprise_locations where business_id in (select id from businesses where email like '%@carehub.test');
-- delete from rep_territories where staff_id in (select id from staff where email like '%@carehub.test');
-- delete from territories where business_id in (select id from businesses where email like '%@carehub.test');
-- delete from staff_notifications where business_id in (select id from businesses where email like '%@carehub.test');
-- delete from appointments where business_id in (select id from businesses where email like '%@carehub.test');
-- delete from prescriptions where business_id in (select id from businesses where email like '%@carehub.test');
-- delete from imaging_requests where business_id in (select id from businesses where email like '%@carehub.test');
-- delete from lab_requests where business_id in (select id from businesses where email like '%@carehub.test');
-- delete from consultations where business_id in (select id from businesses where email like '%@carehub.test');
-- delete from purchases where business_id in (select id from businesses where email like '%@carehub.test');
-- delete from debts where business_id in (select id from businesses where email like '%@carehub.test');
-- delete from expenses where business_id in (select id from businesses where email like '%@carehub.test');
-- delete from sales where business_id in (select id from businesses where email like '%@carehub.test');
-- delete from patients where business_id in (select id from businesses where email like '%@carehub.test');
-- delete from products where business_id in (select id from businesses where email like '%@carehub.test');
-- delete from staff where email like '%@carehub.test';
-- delete from businesses where email like '%@carehub.test';
-- delete from auth.identities where user_id in (select id from auth.users where email like '%@carehub.test');
-- delete from auth.users where email like '%@carehub.test';
