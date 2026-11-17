import { PGlite } from '@electric-sql/pglite'
import { LIVE_HELPERS_SQL, read, BIZ, OTHER, OWNER, MANAGER, CASHIER, STRANGER, UID } from '../debts/debtsFixture'

// Shared PGlite fixture for the Hospital Model Phase 0 migrations (docs/architecture/Hospital-Phase-0.md):
// the live auth helpers (debtsFixture), businesses.business_type, admin_audit_log, clients and the live
// clients_phone_unique_per_business index (read live 2026-11-17), then the hospital migrations in order.
//
// BIZ is a hospital owned by OWNER with one member per preset role, plus the fixture's Manager and Cashier (roles
// rows without a nav, so no clinical modules) and a custom "Radiographer" role with Imaging ticked. OTHER is a
// pharmacy owned by STRANGER. LAB is a stand-alone laboratory.
export { BIZ, OTHER, OWNER, MANAGER, CASHIER, STRANGER }
export const LAB = 'c1000000-0000-4000-8000-000000000001'
export const RECEPTION = 'reception@hosp.ng', NURSE = 'nurse@hosp.ng', DOCTOR = 'doctor@hosp.ng', LABTECH = 'labtech@hosp.ng'
export const PHARMACIST = 'pharmacist@hosp.ng', RADIOGRAPHER = 'radio@hosp.ng', LAB_OWNER = 'owner@lab.ng', ADMIN = 'admin@carehub.ng'
export const USERS = {
  ...UID,
  [RECEPTION]: '20000000-0000-4000-8000-000000000001', [NURSE]: '20000000-0000-4000-8000-000000000002',
  [DOCTOR]: '20000000-0000-4000-8000-000000000003', [LABTECH]: '20000000-0000-4000-8000-000000000004',
  [PHARMACIST]: '20000000-0000-4000-8000-000000000005', [RADIOGRAPHER]: '20000000-0000-4000-8000-000000000006',
  [LAB_OWNER]: '20000000-0000-4000-8000-000000000007', [ADMIN]: '20000000-0000-4000-8000-000000000008',
}
export const PT = (n) => 'a1000000-0000-4000-8000-00000000000' + n
export const CL = (n) => 'c2000000-0000-4000-8000-00000000000' + n

export const MIGRATIONS = {
  baseline: read('carehub_20270123_hospital_schema_baseline.sql'),
  access: read('carehub_20270124_hospital_access.sql'),
  identity: read('carehub_20270125_hospital_identity_and_workflow.sql'),
}

// What delete_clients reads (live foreign keys to clients, 2026-11-10, as clientBulkDelete.db.test.js), then the
// live client bulk delete migration itself, so the identity migration replaces the real definition.
const CLIENT_DELETE_SQL = `
  create table audit_log (id uuid primary key default gen_random_uuid(), actor_id uuid, actor_type text default 'staff', branch_id uuid, action text,
    target_type text, target_id uuid, metadata jsonb default '{}', created_at timestamptz default now());
  create table sales (id uuid primary key default gen_random_uuid(), client_id uuid references clients(id));
  create table appointments (id uuid primary key default gen_random_uuid(), client_id uuid references clients(id));
  create table debts (id uuid primary key default gen_random_uuid(), client_id uuid references clients(id) on delete set null);
  create table customer_requests (id uuid primary key default gen_random_uuid(), client_id uuid references clients(id) on delete set null);
  create table skincare_consultations (id uuid primary key default gen_random_uuid(), client_id uuid references clients(id));
  create table consultation_forms (id uuid primary key default gen_random_uuid(), client_id uuid references clients(id));
  create table client_visits (id uuid primary key default gen_random_uuid(), global_client_id uuid references clients(id) on delete cascade);
`
const CLIENT_BULK_DELETE = read('carehub_20270111_client_bulk_delete.sql')

const SETUP_SQL = `
  alter table businesses add column business_type text;
  update businesses set business_type = 'hospital' where id = '${BIZ}';
  update businesses set business_type = 'pharmacy' where id = '${OTHER}';
  insert into businesses (id, name, email, owner_name, business_type) values
    ('${LAB}', 'Lab', '${LAB_OWNER}', 'Lami', 'laboratory'),
    ('d1000000-0000-4000-8000-000000000001', 'CareHub', '${ADMIN}', 'Admin', 'pharmacy');
  update businesses set is_platform_admin = true where email = '${ADMIN}';
  -- Live: the "own business row" policy and a column UPDATE grant let the owner update their own row.
  alter table businesses enable row level security;
  create policy "own business row" on businesses for all using ((lower(email) = lower(auth.email())) or is_platform_admin());
  grant select, update on businesses to authenticated;
  grant select on staff, roles to authenticated;

  insert into staff (business_id, full_name, email, role) values
    ('${BIZ}', 'Rita Reception', '${RECEPTION}', 'Receptionist'), ('${BIZ}', 'Nkem Nurse', '${NURSE}', 'Nurse'),
    ('${BIZ}', 'Dr Dayo', '${DOCTOR}', 'Doctor'), ('${BIZ}', 'Lanre Lab', '${LABTECH}', 'Lab Technician'),
    ('${BIZ}', 'Phebe Pharm', '${PHARMACIST}', 'Pharmacist'), ('${BIZ}', 'Remi Radio', '${RADIOGRAPHER}', 'Radiographer');
  insert into roles (business_id, name, permissions) values ('${BIZ}', 'Radiographer', '{"nav": ["dashboard", "imaging", "clients"]}');

  create table admin_audit_log (id bigserial primary key, actor_admin_id uuid, action text not null, target_table text not null,
    target_id text, before jsonb, after jsonb, ip text, ua text, created_at timestamptz not null default now());

  -- clients as live (2026-11-17), its unique phone index and policy.
  create table clients (id uuid primary key default gen_random_uuid(), business_id uuid, full_name text not null, phone text,
    email text, address text, date_of_birth text, gender text, notes text, total_spend numeric default 0, visit_count integer default 0,
    created_at timestamp default now(), global_client_id uuid);
  create unique index clients_phone_unique_per_business on clients (business_id, regexp_replace(phone, '[^0-9]', '', 'g'))
    where phone is not null and btrim(phone) <> '';
  alter table clients enable row level security;
  create policy "clients of own business" on clients for all using ((business_id in (select current_business_ids())) or is_platform_admin())
    with check ((business_id in (select current_business_ids())) or is_platform_admin());
  grant select, insert, update, delete on clients to authenticated;

  -- Live EXECUTE grants on the helpers (Supabase does not keep Postgres' default PUBLIC execute).
  revoke execute on function public.current_business_ids(), public.is_business_owner(uuid), public.is_platform_admin(), public.pos_actor(uuid) from public;
  grant execute on function public.current_business_ids() to authenticated, anon, service_role;
  grant execute on function public.is_platform_admin() to authenticated, service_role;
  grant execute on function public.is_business_owner(uuid), public.pos_actor(uuid) to service_role;
`

/** Patients and clinical rows as they could be live before Phase 0 (written as the database owner). */
export const SEED_SQL = `
  insert into patients (id, business_id, reg_no, full_name, phone, date_of_birth, gender, next_of_kin, next_of_kin_phone, insurance, status) values
    ('${PT(1)}', '${BIZ}', 'REG-1', 'Ada Obi', '0801 111 1111', '1990-01-02', 'Female', 'Obi Obi', '0802', 'NHIS', 'at_doctor'),
    ('${PT(2)}', '${BIZ}', 'REG-2', 'Bayo Ade', '0803', '', 'Male', '', '', 'None', 'at_triage'),
    ('${PT(9)}', '${OTHER}', 'REG-9', 'Pharmacy Patient', '0909', '', '', '', '', '', 'at_triage');
  insert into triage (patient_id, business_id, bp, chief_complaint, allergies) values ('${PT(1)}', '${BIZ}', '120/80', 'Headache', 'Penicillin');
  insert into consultations (id, patient_id, business_id, primary_diagnosis) values ('c3000000-0000-4000-8000-000000000001', '${PT(1)}', '${BIZ}', 'Malaria');
  insert into prescriptions (id, patient_id, consultation_id, business_id, patient_name, medicines) values
    ('c4000000-0000-4000-8000-000000000001', '${PT(1)}', 'c3000000-0000-4000-8000-000000000001', '${BIZ}', 'Ada Obi', '[{"name": "Artemether"}]');
  insert into lab_requests (id, patient_id, business_id, tests) values ('c5000000-0000-4000-8000-000000000001', '${PT(1)}', '${BIZ}', '[{"name": "FBC"}]');
  insert into imaging_requests (id, patient_id, business_id, scan_type) values ('c6000000-0000-4000-8000-000000000001', '${PT(1)}', '${BIZ}', 'X-ray');
  insert into patient_messages (patient_id, business_id, message) values ('${PT(1)}', '${BIZ}', 'Seen at triage');
`

/**
 * A fresh database at the requested step: 'baseline' (live today), 'access' (+ carehub_20270124),
 * 'identity' (+ carehub_20270125). `seed` adds the live-like patients and clinical rows before the migrations run,
 * and `beforeIdentity` is SQL run (as the database owner) just before carehub_20270125.
 */
export async function createHospitalDb({ upTo = 'access', seed = true, beforeIdentity = '' } = {}) {
  const db = new PGlite()
  await db.exec(LIVE_HELPERS_SQL)
  await db.exec(SETUP_SQL)
  await db.exec(MIGRATIONS.baseline)
  if (seed) await db.exec(SEED_SQL)
  if (upTo === 'baseline') return db
  await db.exec(MIGRATIONS.access)
  if (upTo === 'access') return db
  await db.exec(CLIENT_DELETE_SQL)
  await db.exec(CLIENT_BULK_DELETE)
  if (beforeIdentity) await db.exec(beforeIdentity)
  await db.exec(MIGRATIONS.identity)
  return db
}

/** Run statements as a signed-in user (or anon when email is null) inside a rolled-back transaction. */
export function actAs(db) {
  return async function as(email, sql) {
    await db.exec('begin')
    try {
      if (email) {
        await db.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: USERS[email], email, role: 'authenticated' })])
      }
      await db.exec(`set local role ${email ? 'authenticated' : 'anon'}`)
      const out = []
      for (const s of [].concat(sql)) out.push((await db.query(s)).rows)
      return { out }
    } catch (e) {
      return { error: e.message }
    } finally {
      await db.exec('rollback')
    }
  }
}
