-- ============================================================================
-- Consultation forms (skincare & pharmacy modules) — ONE shared table.
--
-- Replaces the earlier draft `20260803_skincare_consultations.sql` (never
-- applied to production): both modules persist here, distinguished by
-- `consultation_type`. Design follows the app's hybrid pattern: core columns
-- for filtering/listing + a `data` jsonb holding the full paper-form
-- structure (same as roles.permissions and sales.items).
-- `recommended_products` is denormalized so the POS can tag sale line items
-- as recommended vs dispensed vs walk-in without parsing the full form.
-- `sale_id` links a visit that logged a sale (pharmacy fee + dispensed
-- products) to that sale for exact traceability.
--
-- NOTE: deliberately NOT named `consultations` — that table already exists in
-- production and belongs to the hospital clinical workflow (patient_id-linked,
-- hpi/examination/disposition shape, RLS from phase2_rls_pilot.sql). These
-- forms are client_id-linked with a completely different shape, so they get
-- their own table and their own RLS policy; the hospital table is untouched.
--
-- RLS follows phase2_rls_pilot.sql's shape, using the live helpers
-- current_business_ids() / is_platform_admin(). Run via the Supabase SQL
-- editor or psql — idempotent (if not exists / drop policy).
-- ============================================================================

create table if not exists public.consultation_forms (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  client_id uuid not null references clients(id),
  client_name text not null default '',
  consultation_date date not null default current_date,
  consultation_type text not null default 'skincare',   -- skincare | pharmacy
  provider_name text not null default '',               -- therapist (skincare) / pharmacist (pharmacy)
  recommended_products jsonb not null default '[]',     -- [{id, name, price, qty, source}] source: recommended | dispensed
  sale_id uuid,                                         -- set when the visit logged a sale (pharmacy fee + dispensed items)
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists consultation_forms_business_date_idx
  on public.consultation_forms (business_id, consultation_date desc);
create index if not exists consultation_forms_client_idx
  on public.consultation_forms (client_id);
create index if not exists consultation_forms_business_type_idx
  on public.consultation_forms (business_id, consultation_type);

alter table public.consultation_forms enable row level security;

drop policy if exists "consultation forms of own business" on public.consultation_forms;
create policy "consultation forms of own business"
  on public.consultation_forms for all
  using (business_id in (select current_business_ids()) or is_platform_admin())
  with check (business_id in (select current_business_ids()) or is_platform_admin());
