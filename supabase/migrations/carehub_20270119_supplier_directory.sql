-- ============================================================================
-- Suppliers: a supplier list with contact details, for bulk import and export
--
-- STATUS: APPLIED 2026-11-15 as version 20261115224942, with owner approval.
--   Probed live before committing (the whole migration inside a rolled-back
--   transaction) and after, both rolled back: a staff member adds a supplier
--   (name tidied, key generated), a second spelling of the same name is ignored
--   by the import's upsert, details edit, a rename is refused, DELETE is
--   refused; another business sees none and cannot insert; anon is refused.
--   Security advisor: no finding for suppliers or suppliers_guard.
--
-- PROBLEM (2026-11-15)
-- -------
-- Suppliers had no table: a supplier was only the name typed on its purchases
-- and "we owe" debts, grouped by lower(btrim(name)) (get_supplier_balances,
-- get_supplier_accounts). There was nowhere to keep a supplier's phone, email,
-- address or contact person, so a supplier list could not be imported or
-- exported (requested 2026-11-15).
--
-- FIX
-- ---
-- public.suppliers: one row per supplier per business with its contact
-- details. supplier_key is generated as lower(btrim(name)), the key purchases
-- and supplier accounts already use, and is unique per business. A supplier
-- record therefore attaches to that supplier's existing purchases and supply
-- records by name: nothing is re-keyed, copied or migrated, and a supplier
-- with purchases but no record keeps working exactly as before.
--
-- * A name may be corrected only in capitals or spacing (the key must stay the
--   same): a different name would detach the record from its purchases.
--   Renaming a supplier across its purchases is out of scope.
-- * No DELETE for anyone through the API (not requested; a record only holds
--   contact details, and removing one would lose them without trace).
-- * updated_at is maintained by trigger; created_by defaults to auth.uid().
--
-- SECURITY IMPLICATIONS
-- ---------------------
-- * RLS: members of the business (current_business_ids(), the rule the
--   purchases and debts tables use) read, add and edit their own business's
--   suppliers; platform admins read. Nobody else sees a row; anon has nothing.
-- * Grants: authenticated SELECT, INSERT, UPDATE; no DELETE or TRUNCATE.
-- * Contact details are not cost data; the export (Supplier summary) is still
--   audited through record_export_audit as before (supplier_accounts.*).
-- * No existing table, policy, grant or function is changed.
--
-- ROLLBACK
-- --------
-- DROP TABLE public.suppliers; DROP FUNCTION public.suppliers_guard();
-- (loses the contact details entered since; purchases are untouched).
--
-- TESTS
-- -----
-- apps/carefind/src/test/purchases/supplierDirectory.db.test.js (PGlite, live
-- helpers and grants).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.suppliers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 200),
  supplier_key   text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
  contact_person text NOT NULL DEFAULT '' CHECK (length(contact_person) <= 200),
  phone          text NOT NULL DEFAULT '' CHECK (length(phone) <= 40),
  email          text NOT NULL DEFAULT '' CHECK (length(email) <= 200),
  address        text NOT NULL DEFAULT '' CHECK (length(address) <= 500),
  notes          text NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  created_by     uuid DEFAULT auth.uid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suppliers_business_key_unique UNIQUE (business_id, supplier_key)
);

COMMENT ON TABLE public.suppliers IS
  'Supplier contact details per business. supplier_key = lower(btrim(name)), the key purchases and supplier accounts '
  'group by, so a record attaches to its purchases by name. carehub_20270119_supplier_directory.';

-- Keeps the key stable (a name may change only in capitals or spacing), the
-- business fixed, and updated_at current.
CREATE OR REPLACE FUNCTION public.suppliers_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.name := regexp_replace(btrim(NEW.name), '\s+', ' ', 'g');
  IF TG_OP = 'UPDATE' THEN
    IF NEW.business_id IS DISTINCT FROM OLD.business_id THEN
      RAISE EXCEPTION 'A supplier cannot be moved to another business.' USING ERRCODE = 'check_violation';
    END IF;
    IF lower(NEW.name) IS DISTINCT FROM lower(regexp_replace(btrim(OLD.name), '\s+', ' ', 'g')) THEN
      RAISE EXCEPTION 'A supplier''s name can only be corrected in capitals or spacing: purchases are recorded under it.'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS suppliers_guard ON public.suppliers;
CREATE TRIGGER suppliers_guard
  BEFORE INSERT OR UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.suppliers_guard();

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "suppliers of own business: read" ON public.suppliers;
CREATE POLICY "suppliers of own business: read" ON public.suppliers
  FOR SELECT TO authenticated
  USING (business_id IN (SELECT public.current_business_ids()) OR public.is_platform_admin());

DROP POLICY IF EXISTS "suppliers of own business: add" ON public.suppliers;
CREATE POLICY "suppliers of own business: add" ON public.suppliers
  FOR INSERT TO authenticated
  WITH CHECK (business_id IN (SELECT public.current_business_ids()));

DROP POLICY IF EXISTS "suppliers of own business: edit" ON public.suppliers;
CREATE POLICY "suppliers of own business: edit" ON public.suppliers
  FOR UPDATE TO authenticated
  USING (business_id IN (SELECT public.current_business_ids()))
  WITH CHECK (business_id IN (SELECT public.current_business_ids()));

REVOKE ALL ON public.suppliers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;

REVOKE ALL ON FUNCTION public.suppliers_guard() FROM PUBLIC, anon, authenticated;
