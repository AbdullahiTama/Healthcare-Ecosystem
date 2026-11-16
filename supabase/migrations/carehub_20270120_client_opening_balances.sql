-- ============================================================================
-- Clients: what each client owes, or is owed, and opening balances
--
-- STATUS: APPLIED 2026-11-16 as version 20261116092716, with owner approval.
--   Probed before committing (the whole migration inside a rolled-back
--   transaction) and after, both rolled back: every business's supplier
--   accounts identical before and after (md5 of all rows); a member adds a
--   "we owe" opening balance for a client; it is not listed as a supplier and
--   record_supplier_payment refuses it ("Nothing is owed"); a second opening
--   balance for the client is refused by the index. Predicates fixed 1/2/3;
--   grants and SECURITY settings of the functions unchanged.
--
-- WHY (requested 2026-11-15, items 4 and 5)
-- ---
-- A client's position is read from their linked debts: "owes_us" debts (credit
-- sales, opening balances) are what the client owes; "we_owe" debts linked to
-- the client are what the business owes them. Opening balances imported with
-- clients are recorded as hand-recorded debts (source 'manual', so the existing
-- amount checks, payment history and edit guard apply), linked by client_id,
-- with source_ref 'opening_balance' and dated on the opening date.
--
-- Two database changes are needed for that to be safe:
--
-- 1. Supplier accounts must not take a client's balance for a supplier.
--    get_supplier_accounts, get_supplier_activity and record_supplier_payment
--    (carehub_20270117) treat EVERY manual "we_owe" debt as a supplier's supply
--    record. A "We owe client" balance would have appeared as a supplier named
--    after the client, and a supplier payment could have been applied to it.
--    Each of them now also requires client_id IS NULL. Live data on 2026-11-16:
--    no manual we_owe debt has a client_id, so no existing account changes.
--    The edit is made to the LIVE definitions (two of them differ from the
--    20270117 file in comments only) by appending the condition after each
--    "coalesce(d.source, 'manual') = 'manual'" predicate; the expected number of
--    predicates per function (1, 2 and 3) is checked first and the migration
--    aborts if any differs or the condition is already there.
--    import_debts is not changed: its supplier-name lookup only reuses an
--    existing spelling; a payables row naming a client exactly is shown as
--    "existing supplier", and a payment on it is refused ("Nothing is owed").
--
-- 2. One opening balance per client: a partial unique index on debts(client_id)
--    where source_ref = 'opening_balance'. Uploading the same client file twice,
--    or adding an opening balance from the profile after an import, cannot
--    record it twice; the app shows "already has an opening balance".
--
-- SECURITY IMPLICATIONS
-- ---------------------
-- None widened. The three functions keep their signatures, SECURITY settings,
-- search_path, grants and business checks; they only see fewer rows. The index
-- adds a constraint. Opening balances are inserted through the existing debts
-- policy (members of the business), as Record Debt already does.
--
-- ROLLBACK
-- --------
-- DROP INDEX public.debts_one_opening_balance_per_client; re-run the three
-- function bodies from carehub_20270117_debt_and_supplier_accounts.sql.
--
-- TESTS
-- -----
-- apps/carefind/src/test/debts/clientOpeningBalances.db.test.js (PGlite, over
-- carehub_20270117 with the live helpers).
-- ============================================================================

DO $mig$
DECLARE
  v_fn   text;
  v_def  text;
  v_want int;
  v_have int;
  v_from constant text := 'coalesce(d.source, ''manual'') = ''manual''';
  v_to   constant text := 'coalesce(d.source, ''manual'') = ''manual'' and d.client_id is null';
BEGIN
  FOR v_fn, v_want IN VALUES ('get_supplier_accounts', 1), ('get_supplier_activity', 2), ('record_supplier_payment', 3)
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_fn;
    IF v_def IS NULL THEN
      RAISE EXCEPTION 'carehub_20270120: %() is missing; apply carehub_20270117 first', v_fn;
    END IF;
    IF position('d.client_id is null' in v_def) > 0 THEN
      RAISE EXCEPTION 'carehub_20270120: %() already excludes client debts', v_fn;
    END IF;
    v_have := (length(v_def) - length(replace(v_def, v_from, ''))) / length(v_from);
    IF v_have <> v_want THEN
      RAISE EXCEPTION 'carehub_20270120: %() has % manual we_owe predicates, expected %; review it by hand', v_fn, v_have, v_want;
    END IF;
    EXECUTE replace(v_def, v_from, v_to);
  END LOOP;
END
$mig$;

CREATE UNIQUE INDEX IF NOT EXISTS debts_one_opening_balance_per_client
  ON public.debts (client_id)
  WHERE source_ref = 'opening_balance' AND client_id IS NOT NULL;

COMMENT ON INDEX public.debts_one_opening_balance_per_client IS
  'One opening balance per client (Clients import / profile). carehub_20270120_client_opening_balances.';
