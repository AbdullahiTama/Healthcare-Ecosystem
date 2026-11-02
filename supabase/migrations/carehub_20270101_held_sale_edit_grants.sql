-- carehub_20270101_held_sale_edit_grants
--
-- Status: APPLIED TO PRODUCTION 2026-11-02 with the owner's approval (Supabase migration version 20261102135828). Its
-- self-check passed. Tested first on PGlite (apps/carefind/src/test/held-sales/heldSaleEditGrants.db.test.js) with the
-- live sales_guard_direct_update trigger and the live grants, which were re-read unchanged just before applying.
-- Live behavioural probe afterwards, as the owner of a real business under RLS, inside a DO block that raised and
-- rolled back (no probe rows or notes remained; the held sale used was unchanged, still held, total 500):
--   1 re-hold an edited held sale (the updateHeld columns): ALLOWED, 1 row   (refused with 42501 before)
--   2 release a held sale (is_on_hold = false):            refused, permission denied
--   3 set status on a held sale:                           refused, permission denied
--   4 set amount_paid on a held sale:                      refused, permission denied
--   5 change a completed sale's total:                     refused, "A completed sale can only be changed by the Owner"
--   6 change a completed sale's client_name:               refused, same message
--   7 change a completed sale's amount_paid:               refused, permission denied
--   8 charge the edited held sale (insert, resumed_from):  allowed; held row converted
--   9 a non-Owner staff member re-holds an edited sale:    ALLOWED, 1 row
--  10 that staff member changes a completed sale's total:  refused, "A completed sale can only be changed by the Owner"
-- Security advisor afterwards: the same 8 finding groups as the 2026-11-02 baseline (CODE_AUDIT A4); none mentions sales.
--
-- PROBLEM (POS: "the system sometimes refuses to re-hold edited sales")
-- ---------------------------------------------------------------------
-- At the till a held sale is opened, changed (products added or removed, customer, discount, note) and saved back
-- with Hold. The app saves it in place with one PATCH (modules/pos/repositories updateHeld):
--   items, subtotal, discount, total, balance, client_id, client_name, notes   WHERE is_on_hold
-- carehub_20261211_sales_write_hardening (applied live 2026-10-27, version 20261027012946) left signed-in users UPDATE
-- on only status, is_on_hold and notes. So every re-hold of an edited sale is refused with
-- "42501 permission denied for table sales".
--
-- Evidence (live, 2026-11-02):
--   * information_schema.column_privileges: authenticated UPDATE = is_on_hold, notes, status. Nothing else.
--   * Edge logs, last 24 hours: every PATCH /rest/v1/sales (6 of 6) answered 403.
--   * Rolled-back probe as a business owner on a real held sale: the updateHeld PATCH is refused (permission denied);
--     a notes-only update succeeds; releasing the held sale is refused by sales_guard_direct_update.
-- Docs/architecture/Sales-Corrections.md ("Known limits") had already said the hardening migration must be reconciled
-- before it was applied, believing it unapplied: grant the held-content columns and drop status / is_on_hold. It was
-- applied as drafted. This migration is that reconciliation.
--
-- FIX (grants only; the row policy and every trigger are unchanged)
-- -----------------------------------------------------------------
--   1. REVOKE UPDATE on sales from authenticated and anon (a table-level revoke also removes every column grant).
--   2. GRANT UPDATE (items, subtotal, discount, total, balance, client_id, client_name, notes) to authenticated.
-- status and is_on_hold are no longer granted: no client changes them (holding inserts a held row; completing inserts
-- a new sale with resumed_from, and the SECURITY DEFINER trigger sales_close_resumed_hold closes the held row; owner
-- corrections go through edit_sale / delete_sale). sales_guard_direct_update already refused those changes; now the
-- grant refuses them too.
--
-- SECURITY IMPLICATIONS
-- ---------------------
-- Widened: authenticated may UPDATE the eight held-content columns. What that allows is bounded by what was already
-- live and is not changed here:
--   * Tenancy: the row policy "sales of own business" (business_id IN current_business_ids()) decides which rows a
--     member can touch at all. Unchanged.
--   * sales_guard_direct_update (carehub_20261216_sales_owner_corrections), BEFORE UPDATE, for authenticated/anon:
--       - on a HELD row: refuses any change to is_on_hold, status, txn_no, business_id, created_at or resumed_from.
--         Contents may change, which is the feature.
--       - on any other row (completed, converted, deleted): refuses any change to items, subtotal, discount, total,
--         amount_paid, balance, is_credit, payment_method, payment_split, status, is_on_hold, refunded_amount,
--         client_id, client_name, txn_no, created_at or business_id. So a completed sale's money and customer stay
--         changeable only by the Owner through edit_sale / delete_sale (audited, SECURITY DEFINER).
--   * A held row is not money: it is never counted as takings (salesReport.isCompletedSale, the COMPLETED filter in
--     the sale repository, refresh_client_totals all exclude it), it has no payment rows and moves no stock. When it is
--     charged, the NEW sale is inserted and validated in full by the BEFORE INSERT guards (guard_sale_item_prices: an
--     unauthorised price override is refused; guard_sale_batch_expiry; sales_require_credit_customer), and the held
--     row's balance is zeroed by sales_close_resumed_hold. Editing a held row's prices therefore cannot change what
--     is recorded as sold or paid.
--   * client_id on a held row: the same freedom INSERT already gives (INSERT on client_id is granted). Client visit
--     and spend totals count completed sales only, so a held row's client link changes no figure.
--   * Still not granted: amount_paid, payment_method, payment_split, is_credit, refunded_amount, deleted_at,
--     edited_at, txn_no, business_id, created_at, resumed_from, dispense_ref, cashier_*, shift_id, staff_name, id.
-- Narrowed: status and is_on_hold UPDATE are removed from authenticated. anon keeps no privilege on sales.
-- No function, policy or trigger is added or changed. service_role and SECURITY DEFINER functions are unaffected.
--
-- ROLLBACK (restores the exact pre-migration grants)
--   REVOKE UPDATE ON public.sales FROM authenticated;
--   GRANT UPDATE (status, is_on_hold, notes) ON public.sales TO authenticated;
--
-- VERIFY AFTER APPLYING (rolled-back probe, as a business owner and as a non-Owner staff member):
--   * PATCH a held sale's items/total/customer: 1 row updated.
--   * PATCH a held sale's is_on_hold or status: refused.
--   * PATCH a completed sale's total or client_name: refused ("A completed sale can only be changed by the Owner").
--   * PATCH a completed sale's amount_paid: refused (permission denied).
--   * Charge the edited held sale (insert with resumed_from): one completed sale, the held row converted.

REVOKE UPDATE ON public.sales FROM authenticated;
REVOKE UPDATE ON public.sales FROM anon;
GRANT UPDATE (items, subtotal, discount, total, balance, client_id, client_name, notes) ON public.sales TO authenticated;

-- Self-check: the grants are exactly as intended, or the migration fails and nothing is committed with it.
DO $$
DECLARE
  c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['items', 'subtotal', 'discount', 'total', 'balance', 'client_id', 'client_name', 'notes'] LOOP
    IF NOT has_column_privilege('authenticated', 'public.sales', c, 'UPDATE') THEN
      RAISE EXCEPTION 'held_sale_edit_grants: authenticated is missing UPDATE on sales.%', c;
    END IF;
  END LOOP;
  FOREACH c IN ARRAY ARRAY['status', 'is_on_hold', 'amount_paid', 'payment_method', 'payment_split', 'is_credit',
                           'refunded_amount', 'deleted_at', 'txn_no', 'business_id', 'created_at', 'resumed_from'] LOOP
    IF has_column_privilege('authenticated', 'public.sales', c, 'UPDATE') THEN
      RAISE EXCEPTION 'held_sale_edit_grants: authenticated must not hold UPDATE on sales.%', c;
    END IF;
  END LOOP;
  IF has_table_privilege('anon', 'public.sales', 'UPDATE') THEN
    RAISE EXCEPTION 'held_sale_edit_grants: anon must not hold UPDATE on sales';
  END IF;
END $$;
