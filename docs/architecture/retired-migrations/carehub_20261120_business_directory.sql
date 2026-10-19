-- Enterprise Business Directory (Phase 1). PREPARED, NOT APPLIED, NOT TESTED
-- against a real Postgres (none was available when this was written).
-- Design: docs/architecture/CareHub-Business-Directory-and-Discovery.md
--
-- A platform-owned directory of prospect businesses, separate from `businesses`
-- (the tenant table). A directory row may be linked to a tenant through
-- claimed_business_id but never IS one.
--
-- Ownership boundary: every write goes through is_directory_admin(), the ONE
-- place that decides who administers the directory. Today it equals
-- is_platform_admin(). When the CareFind-vs-CareHub decision is made, change
-- that function body only; no table or policy changes.
--
-- Rollback: DROP TABLE public.directory_audit, public.directory_business_private,
-- public.directory_businesses, public.directory_categories CASCADE;
-- DROP FUNCTION public.is_directory_admin(), public.directory_set_verification(uuid,text,text),
-- public.directory_normalize_name(text), public.directory_normalize_phone(text);

CREATE OR REPLACE FUNCTION public.is_directory_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT auth.uid() IS NOT NULL AND public.is_platform_admin() $$;

REVOKE ALL ON FUNCTION public.is_directory_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_directory_admin() TO authenticated;

-- Normalisers. Must match normalizeName / normalizePhone in
-- apps/carehub/src/lib/facilityDiscovery.js (lower, collapse spaces, strip
-- non [a-z0-9 ]; phone = last 10 digits, a leading 234 dropped).
CREATE OR REPLACE FUNCTION public.directory_normalize_name(n text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT regexp_replace(regexp_replace(lower(btrim(coalesce(n, ''))), '\s+', ' ', 'g'), '[^a-z0-9 ]', '', 'g') $$;

CREATE OR REPLACE FUNCTION public.directory_normalize_phone(p text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p IS NULL THEN ''
    WHEN regexp_replace(p, '\D', '', 'g') ~ '^234' AND length(regexp_replace(p, '\D', '', 'g')) > 10
      THEN substr(regexp_replace(p, '\D', '', 'g'), 4, 10)
    ELSE right(regexp_replace(p, '\D', '', 'g'), 10)
  END
$$;

-- ---------------------------------------------------------------------------
-- Categories: one self-referencing table; parent_id NULL = category,
-- otherwise subcategory (one level only).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.directory_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  parent_id uuid REFERENCES public.directory_categories(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS directory_categories_parent_idx ON public.directory_categories (parent_id);

CREATE OR REPLACE FUNCTION public.directory_categories_one_level()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'A category cannot be its own parent';
  END IF;
  IF NEW.parent_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.directory_categories p WHERE p.id = NEW.parent_id AND p.parent_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Subcategories cannot be nested more than one level';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS directory_categories_one_level ON public.directory_categories;
CREATE TRIGGER directory_categories_one_level BEFORE INSERT OR UPDATE ON public.directory_categories
  FOR EACH ROW EXECUTE FUNCTION public.directory_categories_one_level();

-- ---------------------------------------------------------------------------
-- Businesses
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.directory_businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 250),
  name_normalized text NOT NULL DEFAULT '',
  category_id uuid REFERENCES public.directory_categories(id),
  subcategory_id uuid REFERENCES public.directory_categories(id),
  business_type text,
  address text,
  city text,
  state text,
  lga text,
  latitude double precision CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude double precision CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  phone text,
  phone_normalized text NOT NULL DEFAULT '',
  email text CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  website text,
  opening_hours jsonb,
  description text,
  -- Explicit, never inferred from a phone number, import, or Google listing.
  verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified','pending','verified','rejected')),
  verified_by uuid,
  verified_at timestamptz,
  verification_note text,
  data_source text NOT NULL DEFAULT 'manual'
    CHECK (data_source IN ('manual','import','osm','google','regulatory','partner','other')),
  source_ref text,
  claimed_business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid(),
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- A coordinate pair is both or neither.
  CONSTRAINT directory_businesses_coord_pair CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CONSTRAINT directory_businesses_verified_has_actor
    CHECK (verification_status <> 'verified' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS directory_businesses_name_norm_idx ON public.directory_businesses (name_normalized);
CREATE INDEX IF NOT EXISTS directory_businesses_phone_norm_idx ON public.directory_businesses (phone_normalized) WHERE phone_normalized <> '';
CREATE INDEX IF NOT EXISTS directory_businesses_geo_idx ON public.directory_businesses (state, lga, city);
CREATE INDEX IF NOT EXISTS directory_businesses_coord_idx ON public.directory_businesses (latitude, longitude) WHERE latitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS directory_businesses_category_idx ON public.directory_businesses (category_id, subcategory_id);
CREATE INDEX IF NOT EXISTS directory_businesses_active_idx ON public.directory_businesses (is_active, verification_status);
-- Idempotent import: the same external record can only be loaded once.
CREATE UNIQUE INDEX IF NOT EXISTS directory_businesses_source_ref_uniq
  ON public.directory_businesses (data_source, source_ref) WHERE source_ref IS NOT NULL;

-- Contact person is personal data: kept off the table every company can read.
CREATE TABLE IF NOT EXISTS public.directory_business_private (
  directory_business_id uuid PRIMARY KEY REFERENCES public.directory_businesses(id) ON DELETE CASCADE,
  contact_person text,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only history.
CREATE TABLE IF NOT EXISTS public.directory_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  directory_business_id uuid,
  action text NOT NULL,
  actor_id uuid,
  before jsonb,
  after jsonb,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS directory_audit_business_idx ON public.directory_audit (directory_business_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
-- Normalise, stamp, and make verification columns writable only through
-- directory_set_verification (which sets a transaction-local flag).
CREATE OR REPLACE FUNCTION public.directory_businesses_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE via_rpc boolean := coalesce(current_setting('app.directory_verification_rpc', true), '') = '1';
BEGIN
  NEW.name_normalized := public.directory_normalize_name(NEW.name);
  NEW.phone_normalized := public.directory_normalize_phone(NEW.phone);
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := coalesce(auth.uid(), NEW.created_by);
    IF NOT via_rpc THEN
      NEW.verification_status := 'unverified';
      NEW.verified_by := NULL; NEW.verified_at := NULL; NEW.verification_note := NULL;
    END IF;
  ELSIF NOT via_rpc THEN
    NEW.verification_status := OLD.verification_status;
    NEW.verified_by := OLD.verified_by;
    NEW.verified_at := OLD.verified_at;
    NEW.verification_note := OLD.verification_note;
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS directory_businesses_guard ON public.directory_businesses;
CREATE TRIGGER directory_businesses_guard BEFORE INSERT OR UPDATE ON public.directory_businesses
  FOR EACH ROW EXECUTE FUNCTION public.directory_businesses_guard();

CREATE OR REPLACE FUNCTION public.directory_businesses_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.directory_audit (directory_business_id, action, actor_id, after)
      VALUES (NEW.id, 'create', auth.uid(), to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    IF to_jsonb(NEW) - 'updated_at' - 'updated_by' IS DISTINCT FROM to_jsonb(OLD) - 'updated_at' - 'updated_by' THEN
      INSERT INTO public.directory_audit (directory_business_id, action, actor_id, before, after)
        VALUES (NEW.id,
          CASE WHEN NEW.is_active <> OLD.is_active THEN CASE WHEN NEW.is_active THEN 'reactivate' ELSE 'deactivate' END
               WHEN NEW.verification_status <> OLD.verification_status THEN 'verification'
               ELSE 'update' END,
          auth.uid(), to_jsonb(OLD), to_jsonb(NEW));
    END IF;
  ELSE
    INSERT INTO public.directory_audit (directory_business_id, action, actor_id, before)
      VALUES (OLD.id, 'delete', auth.uid(), to_jsonb(OLD));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS directory_businesses_audit ON public.directory_businesses;
CREATE TRIGGER directory_businesses_audit AFTER INSERT OR UPDATE OR DELETE ON public.directory_businesses
  FOR EACH ROW EXECUTE FUNCTION public.directory_businesses_audit();

-- ---------------------------------------------------------------------------
-- Verification RPC: the only way to change verification columns.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.directory_set_verification(p_id uuid, p_status text, p_note text DEFAULT NULL)
RETURNS public.directory_businesses
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r public.directory_businesses;
BEGIN
  IF NOT public.is_directory_admin() THEN
    RAISE EXCEPTION 'Directory administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('unverified','pending','verified','rejected') THEN
    RAISE EXCEPTION 'Invalid verification status %', p_status USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.directory_verification_rpc', '1', true);
  UPDATE public.directory_businesses
     SET verification_status = p_status,
         verified_by = CASE WHEN p_status = 'verified' THEN auth.uid() ELSE NULL END,
         verified_at = CASE WHEN p_status = 'verified' THEN now() ELSE NULL END,
         verification_note = nullif(btrim(p_note), '')
   WHERE id = p_id
   RETURNING * INTO r;
  PERFORM set_config('app.directory_verification_rpc', '', true);
  IF r.id IS NULL THEN RAISE EXCEPTION 'Directory business not found' USING ERRCODE = 'P0002'; END IF;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.directory_set_verification(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.directory_set_verification(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS. Reading: any signed-in user sees ACTIVE rows (company users search the
-- shared directory). Everything else: directory administrators only.
-- ---------------------------------------------------------------------------
ALTER TABLE public.directory_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.directory_businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.directory_business_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.directory_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS directory_categories_read ON public.directory_categories;
CREATE POLICY directory_categories_read ON public.directory_categories FOR SELECT TO authenticated
  USING (is_active OR public.is_directory_admin());
DROP POLICY IF EXISTS directory_categories_admin ON public.directory_categories;
CREATE POLICY directory_categories_admin ON public.directory_categories FOR ALL TO authenticated
  USING (public.is_directory_admin()) WITH CHECK (public.is_directory_admin());

DROP POLICY IF EXISTS directory_businesses_read ON public.directory_businesses;
CREATE POLICY directory_businesses_read ON public.directory_businesses FOR SELECT TO authenticated
  USING (is_active OR public.is_directory_admin());
DROP POLICY IF EXISTS directory_businesses_insert ON public.directory_businesses;
CREATE POLICY directory_businesses_insert ON public.directory_businesses FOR INSERT TO authenticated
  WITH CHECK (public.is_directory_admin());
DROP POLICY IF EXISTS directory_businesses_update ON public.directory_businesses;
CREATE POLICY directory_businesses_update ON public.directory_businesses FOR UPDATE TO authenticated
  USING (public.is_directory_admin()) WITH CHECK (public.is_directory_admin());
-- No DELETE policy: records are deactivated, never removed, so history stays.

DROP POLICY IF EXISTS directory_business_private_admin ON public.directory_business_private;
CREATE POLICY directory_business_private_admin ON public.directory_business_private FOR ALL TO authenticated
  USING (public.is_directory_admin()) WITH CHECK (public.is_directory_admin());

DROP POLICY IF EXISTS directory_audit_read ON public.directory_audit;
CREATE POLICY directory_audit_read ON public.directory_audit FOR SELECT TO authenticated
  USING (public.is_directory_admin());
-- No INSERT/UPDATE/DELETE policy: only the SECURITY DEFINER triggers write it.

REVOKE ALL ON public.directory_categories, public.directory_businesses,
  public.directory_business_private, public.directory_audit FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.directory_categories, public.directory_businesses TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.directory_business_private TO authenticated;
GRANT SELECT ON public.directory_audit TO authenticated;

-- Seed categories (admin-editable afterwards).
INSERT INTO public.directory_categories (slug, name, sort_order) VALUES
  ('pharmacy','Pharmacies',10),('hospital','Hospitals',20),('clinic','Clinics',30),
  ('medical-centre','Medical centres',40),('specialist-hospital','Specialist hospitals',50),
  ('primary-healthcare-centre','Primary healthcare centres',60),('laboratory','Laboratories',70),
  ('diagnostic-imaging','Diagnostic and imaging centres',80),('dental-clinic','Dental clinics',90),
  ('eye-clinic','Eye clinics',100),('pharma-manufacturer','Pharmaceutical manufacturers',110),
  ('pharma-importer','Pharmaceutical importers',120),('pharma-distributor','Pharmaceutical distributors',130),
  ('pharma-wholesaler','Pharmaceutical wholesalers',140),('medical-equipment-company','Medical equipment companies',150),
  ('medical-equipment-supplier','Medical equipment suppliers',160),('cosmetics','Cosmetics businesses',170),
  ('other-healthcare','Other healthcare-related businesses',999)
ON CONFLICT (slug) DO NOTHING;
