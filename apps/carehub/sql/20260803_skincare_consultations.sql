-- ============================================================================
-- Skincare & Aesthetic Consultation module
--
-- Dedicated table for digitized skincare consultation forms (skincare business
-- type only — the nav gate lives in lib/permissions.js, not here). Design
-- follows the app's hybrid pattern: core columns for filtering/listing + a
-- `data` jsonb holding the full paper-form structure (same as
-- roles.permissions and sales.items). `recommended_products` is denormalized
-- so the POS can tag sale line items as recommended vs walk-in without parsing
-- the full form.
--
-- NOTE: deliberately NOT named `consultations` — that table already exists in
-- production and belongs to the hospital clinical workflow (patient_id-linked,
-- hpi/examination/disposition shape, RLS from phase2_rls_pilot.sql). The
-- skincare form is client_id-linked with a completely different shape, so it
-- gets its own table and its own RLS policy; the hospital table is untouched.
--
-- RLS follows phase2_rls_pilot.sql's shape, using the live helpers
-- current_business_ids() / is_platform_admin(). Run via the Supabase SQL
-- editor or psql — idempotent (if not exists / drop policy).
-- ============================================================================

create table if not exists public.skincare_consultations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  client_id uuid not null references clients(id),
  client_name text not null default '',
  consultation_date date not null default current_date,
  therapist_name text not null default '',
  skin_type text not null default '',
  recommended_products jsonb not null default '[]',
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists skincare_consultations_business_date_idx
  on public.skincare_consultations (business_id, consultation_date desc);
create index if not exists skincare_consultations_client_idx
  on public.skincare_consultations (client_id);

alter table public.skincare_consultations enable row level security;

drop policy if exists "skincare consultations of own business" on public.skincare_consultations;
create policy "skincare consultations of own business"
  on public.skincare_consultations for all
  using (business_id in (select current_business_ids()) or is_platform_admin())
  with check (business_id in (select current_business_ids()) or is_platform_admin());
