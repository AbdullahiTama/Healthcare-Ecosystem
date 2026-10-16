-- ============================================================================
-- ADR Reporting Module - Completion audit gap 2: single-company rule for
-- public reports at the trusted boundary.
--
-- Status: WRITTEN FOR REVIEW — do NOT apply to production without explicit
--         owner authorisation (program constraint: no production migration
--         apply). Covered by PGlite adversarial tests in
--         apps/carefind/src/test/adr/routingAdversarial.db.test.js, which
--         replay this file verbatim.
--
-- Rule: a public-channel report (`report_source = 'public'`) allows at most
-- ONE company-selection row per suspect product, of any kind (verified,
-- unknown and unverified-candidate each count as the one selection — this
-- matches the public wizard, which persists exactly one route per product).
-- Hub/business rows are explicitly exempt: multi-company cardinality for the
-- CareHub workflow stays unresolved by product decision, so the check reads
-- the parent report's recorded channel and returns immediately otherwise.
-- No inference is involved: `report_source` is the recorded channel column,
-- guarded separately by `trg_adr_lock_report_source`.
--
-- Enforcement point: BEFORE INSERT OR UPDATE trigger on
-- `adr_product_company_routes` (partial UNIQUE indexes cannot reference the
-- parent report, so a trigger is the only declarative option that keeps Hub
-- rows exempt). Known limitation, stated honestly: two concurrent inserts
-- for the same public product can both pass the EXISTS check. In practice
-- the wizard writes routes sequentially per product with stable idempotency
-- keys (same key → same row, no duplicate), and verification remains
-- admin-gated — but a future exclusion constraint should replace this if
-- concurrent writers ever exist.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.adr_enforce_public_single_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source text;
BEGIN
  SELECT report_source INTO v_source
    FROM adr_reports
   WHERE report_id = NEW.report_id;
  -- The FK guarantees the parent row; stay permissive if it ever vanishes.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Hub/business/facility/unknown channels: multi-company preserved.
  IF v_source IS DISTINCT FROM 'public' THEN
    RETURN NEW;
  END IF;

  -- Idempotent retries reuse the caller's idempotency key: let them through
  -- so INSERT ... ON CONFLICT can return the existing row instead of raising.
  -- Only genuinely new selections for the product are rejected below.
  IF EXISTS (
    SELECT 1
      FROM adr_product_company_routes
     WHERE idempotency_key = NEW.idempotency_key
  ) THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM adr_product_company_routes
     WHERE product_id = NEW.product_id
       AND route_id IS DISTINCT FROM NEW.route_id
  ) THEN
    RAISE EXCEPTION 'public reports allow at most one company selection per suspect product';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_adr_public_single_company ON adr_product_company_routes;
CREATE TRIGGER trg_adr_public_single_company
  BEFORE INSERT OR UPDATE ON adr_product_company_routes
  FOR EACH ROW
  EXECUTE FUNCTION public.adr_enforce_public_single_company();

COMMENT ON FUNCTION public.adr_enforce_public_single_company() IS
  'Completion audit gap 2: at most one route row per product on public-channel reports; Hub/business rows exempt.';

REVOKE EXECUTE ON FUNCTION public.adr_enforce_public_single_company() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adr_enforce_public_single_company() TO authenticated;
