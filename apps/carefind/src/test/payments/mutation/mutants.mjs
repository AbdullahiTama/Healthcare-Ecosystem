// Financial mutation testing: each mutant is ONE deliberate defect in money code (a check removed, a number changed, a lock dropped, an
// idempotency guard disabled). The runner applies it, runs the tests that are supposed to catch it, and expects them to FAIL. A mutant
// that survives is a hole in the test suite: either a behaviour nobody tests, or a test that asserts too little.
//
// Every `find` must occur exactly once in its file (the runner refuses otherwise, so a mutant cannot silently stop applying when the
// code moves). Paths are relative to the repository root. `run.cwd` is where vitest runs (the app or the package).
//
//   node src/test/payments/mutation/run.mjs            all mutants
//   node src/test/payments/mutation/run.mjs M03 M07    some of them

const APP = 'apps/carefind'
const PKG = 'packages/shared-payments'
const MIG = 'supabase/migrations/'
const T = 'src/test/payments/'

const vendor = { cwd: APP, files: [`${T}vendorPayouts.db.test.js`] }
const invariants = { cwd: APP, files: [`${T}financialInvariants.db.test.js`], args: ['-t', 'seed 11'] }

export const MUTANTS = [
  // ---------------------------------------------------------------- the settlement engine
  { id: 'M01', what: 'the engine stops checking the paid amount against the expected amount', file: `${MIG}carefind_20261010_central_settlement.sql`,
    find: "when p_amount_kobo is distinct from i.expected_amount then 'amount_mismatch'", replace: "when false then 'amount_mismatch'", run: { cwd: APP, files: [`${T}centralSettlement.db.test.js`] } },
  { id: 'M02', what: 'the vendor is credited the whole subtotal instead of subtotal minus commission', file: `${MIG}carefind_20261019_red_team_fixes.sql`,
    find: 'v_credit := o.subtotal_kobo - o.commission_kobo;', replace: 'v_credit := o.subtotal_kobo;', run: vendor, alsoRun: invariants },
  { id: 'M03', what: 'the booking credit credits the wallet again for a reference it already recorded', file: `${MIG}carefind_20261017_engine_timeouts_and_hot_paths.sql`,
    find: 'if v_new > 0 then', replace: 'if true then', run: vendor },
  // ---------------------------------------------------------------- refunds
  { id: 'M04', what: 'a FAILED refund no longer restores the vendor\'s recovered share', file: `${MIG}carefind_20261012_shop_vendor_payouts.sql`,
    find: 'set held_balance = held_balance + r.business_recovered_held_kobo, available_balance = available_balance + r.business_recovered_available_kobo, updated_at = now()',
    replace: 'set held_balance = held_balance, available_balance = available_balance, updated_at = now()', run: vendor, alsoRun: invariants },
  { id: 'M05', what: 'a completed refund of a whole shop order no longer marks the order refunded', file: `${MIG}carefind_20261012_shop_vendor_payouts.sql`,
    find: "update public.shop_orders set payment_status = 'refunded', status = case when status = 'cancelled' then 'cancelled' else 'refunded' end, updated_at = now() where id = o.id;",
    replace: 'update public.shop_orders set updated_at = now() where id = o.id;', run: vendor },
  { id: 'M06', what: 'settle_refund accepts a provider amount that differs from the refund', file: `${MIG}carefind_20261012_shop_vendor_payouts.sql`,
    find: 'if p_amount_kobo is not null and r.amount_kobo is not null and p_amount_kobo <> r.amount_kobo then', replace: 'if false then', run: { cwd: APP, files: [`${T}refundEngine.db.test.js`] } },
  { id: 'M07', what: 'cancelling a paid shop order no longer starts a refund', file: `${MIG}carefind_20261012_shop_vendor_payouts.sql`,
    find: "v_refund := public.request_refund('order_cancelled', 'shop_order', p_order_id, auth.uid(), coalesce(p_reason, 'Order cancelled'), false, null);",
    replace: `v_refund := '{"outcome":"requested"}'::jsonb;`, run: vendor },
  { id: 'M08', what: 'an approved return may refund more than the customer paid', file: `${MIG}carefind_20261012_shop_vendor_payouts.sql`,
    find: 'least(v_return.refund_amount_kobo, v_order.total_kobo)::bigint);', replace: 'v_return.refund_amount_kobo::bigint);', run: vendor },
  { id: 'M09', what: 'a customer may request a return larger than the order', file: `${MIG}carefind_20261018_shop_return_service_caller.sql`,
    find: 'if p_refund_amount_kobo <= 0 or p_refund_amount_kobo > v_order.total_kobo then', replace: 'if false then', run: vendor },
  { id: 'M18', what: 'a service-role return request is no longer tied to the customer it names (anyone can return another customer order)', file: `${MIG}carefind_20261018_shop_return_service_caller.sql`,
    find: "if v_order.customer_id is distinct from v_actor then raise exception 'Not authorized'; end if;", replace: '', run: vendor },
  // ---------------------------------------------------------------- vendor release
  { id: 'M10', what: 'the release sweep ignores a live refund and releases money that is being refunded', file: `${MIG}carefind_20261012_shop_vendor_payouts.sql`,
    find: "if exists (select 1 from public.refunds f where f.entity_type = 'shop_order' and f.entity_id = o.id and f.status in ('requested', 'processing')) then continue; end if;",
    replace: 'if false then continue; end if;', run: vendor },
  // ---------------------------------------------------------------- withdrawals, commissions, config
  { id: 'M11', what: 'the rolling 24 hour withdrawal cap is not enforced', file: `${MIG}carefind_20261008_withdrawal_engine.sql`,
    find: "if v_recent + p_coins > p_daily_cap_coins then return jsonb_build_object('outcome', 'daily_limit'); end if;", replace: 'if false then return null; end if;', run: { cwd: APP, files: [`${T}withdrawalEngine.db.test.js`] } },
  { id: 'M12', what: 'the referral first-payment rate is 45% instead of 40%', file: `${MIG}carefind_20261003_payment_intents_foundation.sql`,
    find: "('referral_first_payment_rate',   0.40,", replace: "('referral_first_payment_rate',   0.45,", run: { cwd: APP, files: [`${T}commissionEngine.db.test.js`] } },
  { id: 'M13', what: 'the shop commission rate is 10% instead of 20%', file: `${MIG}carefind_20261011_shop_commission_flat.sql`,
    find: "('shop_commission_rate', 0.20,", replace: "('shop_commission_rate', 0.10,", run: { cwd: APP, files: [`${T}shopCommission.db.test.js`] } },
  // ---------------------------------------------------------------- reconciliation
  { id: 'M14', what: 'a finding that stops being true is never auto-resolved', file: `${MIG}carefind_20261016_reconciliation_scale.sql`,
    find: 'and (v_scope is null or r.subject_id = any (v_scope));', replace: 'and false;', run: { cwd: APP, files: [`${T}reconciliation.db.test.js`] } },
  { id: 'M15', what: 'the job gate is always open (every instance runs every step)', file: `${MIG}carefind_20261015_reconciliation_ops.sql`,
    find: 'where public.job_slots.last_started_at <= now() - make_interval(mins => p_min_minutes)', replace: 'where true', run: { cwd: APP, files: [`${T}reconciliation.db.test.js`] } },
  { id: 'M16', what: 'an acknowledged finding is alerted again', file: `${MIG}carefind_20261015_reconciliation_ops.sql`,
    find: "where f.severity = 'critical' and f.status = 'open'", replace: "where f.severity = 'critical'", run: { cwd: APP, files: [`${T}reconciliation.db.test.js`] } },
  { id: 'M17', what: 'the vendor-credit reconciliation stops comparing the credit with subtotal minus commission', file: `${MIG}carefind_20261019_red_team_fixes.sql`,
    find: 'where c.amount_kobo <> o.subtotal_kobo - o.commission_kobo', replace: 'where false', run: vendor },
  // ---------------------------------------------------------------- Node: the shared payments package
  { id: 'N01', what: 'every database error is treated as transient and retried (including business refusals)', file: `${PKG}/src/rpcRetry.js`,
    find: "return TRANSIENT_MESSAGE.test(String(error.message || ''))", replace: 'return true', run: { cwd: PKG, files: ['src/__tests__/rpcRetry.test.js'] } },
  { id: 'N02', what: 'the circuit breaker never opens', file: `${PKG}/src/scheduler.js`,
    find: 'consecutive >= maxConsecutiveProviderFailures', replace: 'consecutive >= 100000', run: { cwd: PKG, files: ['src/__tests__/scheduler.test.js'] } },
  { id: 'N03', what: 'the circuit breaker counts answers about single transactions as an outage', file: `${PKG}/src/scheduler.js`,
    find: 'consecutive = isProviderInfraError(err) ? consecutive + 1 : 0', replace: 'consecutive = consecutive + 1', run: { cwd: PKG, files: ['src/__tests__/scheduler.test.js'] } },
  { id: 'N04', what: 'a charge whose amount differs from the intent is no longer reported', file: `${PKG}/src/reconciliation.js`,
    find: 'if (Number(intent.expected_amount) !== tx.amountKobo) {', replace: 'if (false) {', run: { cwd: PKG, files: ['src/__tests__/reconciliation.test.js'] } },
  { id: 'N05', what: 'a failed alert keeps its claim (the finding is never alerted again)', file: `${PKG}/src/reconciliation.js`,
    find: "await rpc(supabase, 'release_finding_alerts', { p_ids: findings.map((f) => f.id) }).catch(() => {})", replace: '', run: { cwd: PKG, files: ['src/__tests__/reconciliation.test.js'] } },
  { id: 'N06', what: 'a settled intent is verified with the provider again instead of answered from the database', file: `${PKG}/src/settlement.js`,
    find: "if (intent.status === 'settled' || intent.status === 'refunded') {", replace: 'if (false) {', run: { cwd: PKG, files: ['src/__tests__/settlement.test.js', 'src/__tests__/reconciliation.test.js'] } },
  { id: 'N07', what: 'a webhook event that FAILED is treated as handled (so its retry is dropped)', file: `${PKG}/src/events.js`,
    find: "const handled = existing.processed_at != null && ['processed', 'ignored', 'duplicate'].includes(existing.outcome)", replace: 'const handled = existing.outcome != null', run: { cwd: PKG, files: ['src/__tests__/events.test.js'] } },
  // ---------------------------------------------------------------- Phase 14 red-team fixes
  { id: 'M26', what: 'create_shop_order stops comparing the client subtotal with the items', file: `${MIG}carefind_20261019_red_team_fixes.sql`,
    find: 'IF p_subtotal_kobo IS DISTINCT FROM v_subtotal_calc THEN', replace: 'IF false THEN', run: { cwd: APP, files: [`${T}redTeam.db.test.js`] } },
  { id: 'M27', what: 'a vendor may move an order backwards or set payment states (the forward-only rule is off)', file: `${MIG}carefind_20261019_red_team_fixes.sql`,
    find: 'or v_rank_from is null or v_rank_to is null or v_rank_to <= v_rank_from then', replace: 'then', run: { cwd: APP, files: [`${T}redTeam.db.test.js`] } },
  { id: 'M28', what: 'a non-admin caller may name the actor of a status change', file: `${MIG}carefind_20261019_red_team_fixes.sql`,
    find: 'v_actor := case when v_admin then coalesce(p_changed_by, auth.uid()) else auth.uid() end;', replace: 'v_actor := coalesce(p_changed_by, auth.uid());', run: { cwd: APP, files: [`${T}redTeam.db.test.js`] } },
  { id: 'M29', what: 'settlement stops checking that the items back the subtotal', file: `${MIG}carefind_20261019_red_team_fixes.sql`,
    find: 'if v_items_n = 0 or v_items_total <> o.subtotal_kobo then', replace: 'if false then', run: { cwd: APP, files: [`${T}redTeam.db.test.js`] } },
  { id: 'M30', what: 'complete_appointment_and_release is not limited to its own business', file: `${MIG}carefind_20261019_red_team_fixes.sql`,
    find: "if not (v_business_id in (select current_business_ids()) or is_platform_admin()) then return 'forbidden'; end if;", replace: '', run: { cwd: APP, files: [`${T}redTeam.db.test.js`] } },
]
