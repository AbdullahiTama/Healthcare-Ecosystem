-- ============================================================================
-- Data fix (CODE_AUDIT A32): link credit-sale debts to the client of their sale
--
-- STATUS: APPLIED 2026-11-16 as version 20261116102618, with owner approval.
--   Dry run inside a rolled-back transaction first, then applied. Linked 3:
--     TXN568634 = ab864abd-c2dd-4041-9705-0aa7b62a271b
--     TXN657611 = b1f82296-586d-45ad-ad37-62422146ee96
--     TXN804886 = d377755c-bd1f-46bf-9270-96860ce8199f
--   No other column of any debt changed (md5 of all other columns identical).
--   After: no credit-sale debt lacks its sale's client; 5 remain without a
--   client (nothing to link: 3 walk-ins, 2 customers with no client record);
--   every client's account balance equals Debt Management's by link (0 of 39
--   differ, was 1).
--
-- PROBLEM (read live 2026-11-16)
-- -------
-- 8 credit-sale debts (source 'credit_sale') have no client_id. For 3 of them
-- the sale they mirror (same business, txn_no = source_ref) IS linked to a
-- client, so the client's position and account depended on an exact name match
-- (a rename, or two clients with the same name, would lose them):
--   TXN657611 ₦17,800 and TXN804886 ₦4,800 (one client, both open)
--   TXN568634 ₦0 (paid)
-- The other 5 have nothing to link to: 3 walk-ins, and 2 named customers
-- ("Musa", ₦3,200 open; a clinic, paid) sold to without a client record. They
-- are left as they are; this fix creates and guesses nothing.
--
-- CAUSE: historic. Credit-sale debts are written by the till
-- (debtRepository.recordUnderpayment, which passes the sale's client) and by
-- edit_sale (which keeps the debt's client in step with the sale). Live, every
-- credit-sale debt created after 2026-10-26 10:37 carries its sale's client
-- (42 of 42); the last unlinked one is from that morning. No code change.
--
-- FIX
-- ---
-- Set debts.client_id from the sale where ALL hold:
--   * the debt is a credit-sale debt with no client;
--   * exactly one sale in the same business has that txn_no (sales has no
--     unique key on txn_no, so an ambiguous reference is never guessed);
--   * that sale has a client, and the client belongs to the same business.
-- Only client_id changes. party_name stays as recorded (screens show the
-- client's current name; lib/clientNames.js). Amounts, status and payments are
-- untouched (debt_manual_guard applies to hand-recorded debts only; these are
-- credit-sale debts, moved by their sale). Re-running links nothing more.
--
-- SECURITY IMPLICATIONS
-- ---------------------
-- None. A data update run by the migration role; no table, policy, grant or
-- function changes. Each link stays within one business.
--
-- ROLLBACK
-- --------
-- The ids linked are listed in the NOTICE and in the status line above once
-- applied: UPDATE public.debts SET client_id = NULL WHERE id IN (...).
-- ============================================================================

DO $fix$
DECLARE
  v_ids text;
  v_count int;
BEGIN
  WITH candidates AS (
    SELECT d.id AS debt_id, min(s.client_id::text)::uuid AS client_id
      FROM public.debts d
      JOIN public.sales s ON s.business_id = d.business_id AND s.txn_no = d.source_ref
     WHERE d.source = 'credit_sale' AND d.client_id IS NULL AND coalesce(d.source_ref, '') <> ''
     GROUP BY d.id
    HAVING count(*) = 1 AND min(s.client_id::text) IS NOT NULL
  ), linked AS (
    UPDATE public.debts d
       SET client_id = c.client_id
      FROM candidates c
      JOIN public.clients cl ON cl.id = c.client_id
     WHERE d.id = c.debt_id AND cl.business_id = d.business_id
    RETURNING d.id, d.source_ref
  )
  SELECT count(*), string_agg(source_ref || '=' || id, ', ' ORDER BY source_ref) INTO v_count, v_ids FROM linked;
  RAISE NOTICE 'carehub_20270121: linked % credit-sale debt(s) to their sale''s client: %', v_count, coalesce(v_ids, 'none');
END
$fix$;
