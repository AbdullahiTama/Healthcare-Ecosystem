-- ============================================================================
-- C18 — privilege escalation: any business owner could make themselves a
--        platform admin with one PATCH
--
-- STATUS: APPLIED TO PRODUCTION 2026-08-05, on explicit user authorization,
-- as TRACKED migrations:
--   guard_business_privileged_columns
--   fix_guard_business_privileged_columns_array_cast   — see "a bug of my own"
--
-- POST-FIX VERIFICATION (2026-08-05, live, again inside a rolled-back DO block;
-- confirmed afterwards: 2 platform admins unchanged, 0 SELFTEST rows, 0
-- suspended businesses, the owner row back at active/basic)
--   ATTACK owner -> platform admin : 42501 Only a platform administrator can
--                                    change these fields on a business:
--                                    is_platform_admin
--   ATTACK owner -> plan + status  : 42501 ... status, plan
--   ATTACK owner -> free expiry    : 42501 ... plan_expires_at
--   ATTACK owner -> referring agent: 42501 ... referring_agent_id
--   owner is_platform_admin now    : f
--   LEGIT  owner profile save      : ALLOWED   (Settings saveBizDetails)
--   LEGIT  owner booking save      : ALLOWED   (Settings saveBookingSettings)
--   LEGIT  admin sets status       : ALLOWED   (AdminDashboard)
--   LEGIT  service_role expiry     : ALLOWED   (verify-plan-payment.js)
-- Advisors after: identical to the 27-finding baseline; this function does not
-- appear (SECURITY INVOKER, pinned search_path).
--
-- A BUG OF MY OWN, CAUGHT BY THAT VERIFICATION
-- --------------------------------------------
-- The first applied version used `v_changed || 'is_platform_admin'` with no
-- cast. Postgres parses the bare literal on the right of || as an ARRAY
-- literal, so the trigger raised 22P02 "malformed array literal" instead of the
-- intended insufficient_privilege. The escalation was still blocked either way
-- — the UPDATE aborted — so this was never a security regression, but the error
-- reaching the caller was meaningless. Fixed with explicit ::text casts in a
-- follow-up migration. This is exactly why the verification re-runs the real
-- attack instead of trusting the trigger to be written correctly.
--
-- THE VULNERABILITY
-- -----------------
-- `businesses` has exactly one general policy:
--
--   "own business row"   cmd = ALL
--   qual / with_check:   lower(email) = lower(auth.email()) OR is_platform_admin()
--
-- That controls WHICH ROW you may touch. It says nothing about WHICH COLUMNS.
-- And is_platform_admin() — the function every other table's RLS policy ORs
-- into its own qual — is defined as:
--
--   SELECT COALESCE((SELECT is_platform_admin FROM businesses
--                    WHERE lower(email) = lower(auth.email())), false)
--
-- So the flag that grants platform-wide access lives in a column its own
-- holder is permitted to write. Setting it leaves `email` untouched, so the
-- with_check still passes. `authenticated` holds table-level UPDATE plus
-- column-level UPDATE on the sensitive columns, and the only trigger on the
-- table was BEFORE INSERT — nothing stood in the way.
--
-- One request to PATCH /rest/v1/businesses?id=eq.<own id> — the same endpoint
-- the Settings page already calls — escalated an ordinary owner to platform
-- admin with read/write across all 19 businesses' clinical and financial data.
--
-- Note the INSERT policy DOES guard this:
--   with_check: status = 'pending' AND is_platform_admin = false AND parent_business_id IS NULL
-- The signup path was closed and the update path was left open.
--
-- PROVEN, NOT ASSUMED (2026-08-05, live, inside a DO block that raised and
-- rolled back — the account used was restored, verified afterwards):
--   acting as ordinary owner        john71688@gmail.com
--   is_platform_admin() before      f
--   -- after ONE self-PATCH --
--   is_platform_admin column        t
--   status         active -> approved
--   plan                            enterprise
--   other businesses readable       18 of 18
--
-- WHY A TRIGGER AND NOT COLUMN GRANTS
-- -----------------------------------
-- Column-level UPDATE grants would also work, but they invert the default:
-- every column NOT on the allow-list becomes silently un-updatable, including
-- any column added later. On a table this central, that fails closed in a way
-- that would surface as mysterious no-op saves. The trigger names the small set
-- of privileged columns explicitly and leaves everything else alone.
--
-- WHO IS ALLOWED THROUGH
-- ----------------------
--   * service_role / postgres — server endpoints and migrations. Verified
--     callers that legitimately write these columns:
--       apps/carehub/api/verify-plan-payment.js  -> plan_expires_at
--       apps/carefind/api/paystack-webhook.js    -> plan_expires_at
--     Both use SUPABASE_SERVICE_ROLE_KEY, so both bypass this trigger.
--   * platform admins — AdminDashboard.jsx does updateBusiness(id, { status })
--     to approve/suspend businesses. That account already has the flag, so
--     is_platform_admin() short-circuits and the call keeps working.
--
-- Checked and unaffected: CareFind's only client-side write to this table
-- (claims/BusinessDashboard.jsx) sets visible_on_carefind, which is not
-- protected; Settings.jsx's two updateBusiness calls write profile fields and
-- booking config, none of them protected.
--
-- PROTECTED COLUMNS AND WHY EACH
-- ------------------------------
--   is_platform_admin   full cross-tenant compromise (the finding above)
--   status              self-approval of a pending/suspended business
--   plan                free upgrade to a paid tier
--   plan_expires_at     free extension of a paid subscription indefinitely
--   parent_business_id  attach yourself into another business's branch tree
--   referring_agent_id  divert referral commissions (real money)
--
-- `email` is deliberately NOT protected: the policy's with_check re-evaluates
-- lower(email) = lower(auth.email()) after the update, so changing it to
-- someone else's address fails the check by construction.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_business_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_changed text[] := '{}';
BEGIN
  -- Server endpoints, migrations and platform admins are trusted here. Note
  -- is_platform_admin() only SELECTs, so calling it from a BEFORE UPDATE
  -- trigger on this same table cannot recurse.
  IF current_user IN ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin')
     OR public.is_platform_admin() THEN
    RETURN NEW;
  END IF;

  -- The ::text casts are load-bearing. Without them Postgres reads the bare
  -- literal on the right of || as an ARRAY literal and fails with 22P02
  -- "malformed array literal" — which still blocks the update, but with a
  -- meaningless error instead of the intended one. Caught by the post-apply
  -- verification below, which is the reason it runs the real attack rather
  -- than trusting the trigger to be correct.
  IF NEW.is_platform_admin  IS DISTINCT FROM OLD.is_platform_admin  THEN v_changed := v_changed || 'is_platform_admin'::text; END IF;
  IF NEW.status             IS DISTINCT FROM OLD.status             THEN v_changed := v_changed || 'status'::text; END IF;
  IF NEW.plan               IS DISTINCT FROM OLD.plan               THEN v_changed := v_changed || 'plan'::text; END IF;
  IF NEW.plan_expires_at    IS DISTINCT FROM OLD.plan_expires_at    THEN v_changed := v_changed || 'plan_expires_at'::text; END IF;
  IF NEW.parent_business_id IS DISTINCT FROM OLD.parent_business_id THEN v_changed := v_changed || 'parent_business_id'::text; END IF;
  IF NEW.referring_agent_id IS DISTINCT FROM OLD.referring_agent_id THEN v_changed := v_changed || 'referring_agent_id'::text; END IF;

  IF array_length(v_changed, 1) > 0 THEN
    RAISE EXCEPTION
      'Only a platform administrator can change these fields on a business: %',
      array_to_string(v_changed, ', ')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_business_privileged_columns() IS
  'C18: blocks a business owner from editing their own privileged columns '
  '(is_platform_admin, status, plan, plan_expires_at, parent_business_id, '
  'referring_agent_id). The businesses RLS policy scopes by row but not by '
  'column, and is_platform_admin() reads a column its holder could write — so '
  'one self-PATCH granted platform-wide access. Service role and existing '
  'platform admins pass through.';

DROP TRIGGER IF EXISTS guard_business_privileged_columns ON public.businesses;
CREATE TRIGGER guard_business_privileged_columns
  BEFORE UPDATE ON public.businesses
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_business_privileged_columns();
