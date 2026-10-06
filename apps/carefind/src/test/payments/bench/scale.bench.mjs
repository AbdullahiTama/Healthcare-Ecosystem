// Phase 12: how the financial database behaves at ~100x today's volume, on a real Postgres. Not part of the test suite (it takes a
// minute and prints timings); run it by hand when a query, an index or a reconciliation check changes:
//
//   PG_CONCURRENCY_URL=postgres://postgres:pw@127.0.0.1:54999/postgres node src/test/payments/bench/scale.bench.mjs [scale]
//
// scale = number of settled payments to generate (default 100000). It builds a throw-away database with every migration, loads
// synthetic production-shaped data in bulk, runs ANALYZE, and times the things that run on a schedule or on every payment.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createTestDatabase } from '../fixtures/realPostgres.js'
import { createLegacyStubs } from '../fixtures/legacyFunctions.js'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../../supabase/migrations/${name}.sql`)
const SCALE = Number(process.argv[2] || 100000)

const MIGRATIONS = [
  'carefind_20261003_payment_intents_foundation', 'carefind_20261004_settle_payment_intent', 'carefind_20261005_coin_ledger',
  'carefind_20261005_coin_writers_use_ledger', 'carefind_20261005_lock_wallets_to_ledger', 'carefind_20261006_settle_plan_and_carehub_appointments',
  'carefind_20261007_commission_engine', 'carefind_20261008_commission_reconcile_first_payment', 'carefind_20261008_withdrawal_engine',
  'carefind_20261009_refund_engine', 'carefind_20261010_central_settlement', 'carefind_20261012_shop_vendor_payouts',
  'carefind_20261014_reconciliation', 'carefind_20261015_reconciliation_ops', 'carefind_20261016_reconciliation_scale', 'carefind_20261017_engine_timeouts_and_hot_paths', 'carefind_20261019_red_team_fixes',
  ...(process.env.EXTRA_MIGRATIONS ? process.env.EXTRA_MIGRATIONS.split(',') : []),
]
const SQL = [read('../fixtures/liveSchemaSubset.sql'), ...MIGRATIONS.map(M)]

const ms = (t0) => `${(performance.now() - t0).toFixed(0)} ms`
const rows = []
async function timed(label, fn) {
  const t0 = performance.now()
  const out = await fn()
  const took = performance.now() - t0
  rows.push([label, `${took.toFixed(0)} ms`])
  console.log(`  ${label.padEnd(62)} ${took.toFixed(0).padStart(8)} ms`)
  return out
}

console.log(`building database (${MIGRATIONS.length} migrations)...`)
const { pool, drop } = await createTestDatabase(SQL, { beforeFile: async (i, db) => { if (i === 4) await createLegacyStubs(db) } })
const q = (sql, p) => pool.query(sql, p)
// SYNC_OFF=1 turns off the commit fsync (slow on a Windows dev disk) to separate CPU cost from disk waits
if (process.env.SYNC_OFF) { await q('alter system set synchronous_commit = off'); await q('select pg_reload_conf()'); console.log('  (synchronous_commit = off)') }

try {
  console.log(`loading ${SCALE} settled payments and their dependants...`)
  const c = await pool.connect()
  const t0 = performance.now()
  await c.query('set session_replication_role = replica')   // bulk load: the guards protect live writes, the data below is already consistent
  await c.query(`
    -- users and coin wallets: 1 wallet per 5 payments, each with a ledger chain that balances
    insert into auth.users (id) select ('00000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid from generate_series(1, ${Math.ceil(SCALE / 5)}) g;
    insert into wallets (user_id, balance) select id, 0 from auth.users;
    -- ledger: +10 coin top-up then -3 booking payment, per user, repeated 4 times: balances chain exactly
    insert into coin_ledger (user_id, delta, balance_after, kind, reference)
      select u.id, case when s.k % 2 = 1 then 10 else -3 end,
             (s.k + 1) / 2 * 10 - (s.k / 2) * 3,
             case when s.k % 2 = 1 then 'topup' else 'booking_payment' end, 'bench_' || u.id || '_' || s.k
        from auth.users u cross join generate_series(1, 8) s(k);
    update wallets w set balance = l.b from (select user_id, 4 * 10 - 4 * 3 as b from coin_ledger group by user_id) l where l.user_id = w.user_id;

    -- shop orders, appointments
    insert into shop_orders (id, order_ref, customer_id, vendor_business_id, status, payment_status, subtotal_kobo, commission_kobo, total_kobo, payment_reference, created_at, updated_at)
      select gen_random_uuid(), 'CF-' || g, ('00000000-0000-4000-8000-' || lpad(to_hex(1 + g % ${Math.ceil(SCALE / 5)}), 12, '0'))::uuid,
             ('00000000-0000-4000-9000-' || lpad(to_hex(1 + g % 500), 12, '0'))::uuid, 'delivered', 'paid', 1000000, 200000, 1050000, 'bench_shop_' || g,
             now() - (g % 365) * interval '1 day', now() - (g % 365) * interval '1 day'
        from generate_series(1, ${Math.floor(SCALE * 0.4)}) g;
    insert into appointments (id, business_id, client_name, source, fee_amount, payment_status, payment_reference, payment_channel)
      select gen_random_uuid(), ('00000000-0000-4000-9000-' || lpad(to_hex(1 + g % 500), 12, '0'))::uuid, 'Bench', 'carehub', 1000000, 'paid', 'bench_appt_' || g, 'card'
        from generate_series(1, ${Math.floor(SCALE * 0.3)}) g;

    -- settled intents (shop orders, appointments, top-ups), each bound to a provider transaction
    insert into payment_intents (reference, application, purpose, customer_id, entity_type, entity_id, expected_amount, status, provider_transaction_id, verified_at, settled_at, created_at, updated_at)
      select 'bench_shop_' || o.order_ref, 'carefind', 'shop_order', o.customer_id, 'shop_order', o.id, o.total_kobo, 'settled', 'T' || o.order_ref, o.created_at, o.created_at, o.created_at, o.created_at
        from shop_orders o;
    insert into payment_intents (reference, application, purpose, business_id, entity_type, entity_id, expected_amount, status, provider_transaction_id, verified_at, settled_at, created_at, updated_at)
      select 'bench_appt_' || a.id, 'carehub', 'appointment', a.business_id, 'appointment', a.id, 1000000, 'settled', 'TA' || a.id, now(), now(), now() - (random() * 365) * interval '1 day', now()
        from appointments a;
    insert into payment_intents (reference, application, purpose, customer_id, expected_amount, status, provider_transaction_id, verified_at, settled_at, created_at, updated_at)
      select 'bench_topup_' || g, 'carefind', 'wallet_topup', ('00000000-0000-4000-8000-' || lpad(to_hex(1 + g % ${Math.ceil(SCALE / 5)}), 12, '0'))::uuid, 500000, 'settled', 'TT' || g, now(), now(), now() - (random() * 365) * interval '1 day', now()
        from generate_series(1, ${Math.floor(SCALE * 0.3)}) g;
    -- abandoned and in-flight attempts: 4% of volume, some of them inside the 7-day sweep window
    insert into payment_intents (reference, application, purpose, customer_id, expected_amount, status, created_at, updated_at)
      select 'bench_open_' || g, 'carefind', 'wallet_topup', ('00000000-0000-4000-8000-' || lpad(to_hex(1 + g % 1000), 12, '0'))::uuid, 500000, case when g % 3 = 0 then 'created' else 'pending' end,
             now() - (g % 20) * interval '1 day', now() - (g % 20) * interval '1 day'
        from generate_series(1, ${Math.floor(SCALE * 0.04)}) g;

    -- webhook events: ~2 per payment, plus a handful of failures and unmatched charges
    insert into payment_provider_events (provider, event_id, event_type, reference, payload, signature_ok, received_at, processed_at, outcome, attempts)
      select 'paystack', 'charge.success:' || g, 'charge.success', 'bench_shop_CF-' || (1 + g % ${Math.floor(SCALE * 0.4)}), jsonb_build_object('event', 'charge.success', 'data', jsonb_build_object('amount', 1050000, 'reference', 'x' || g, 'pad', repeat('p', 300))),
             true, now() - (g % 365) * interval '1 day', now() - (g % 365) * interval '1 day', 'processed', 1
        from generate_series(1, ${SCALE * 2}) g;
    insert into payment_provider_events (provider, event_id, event_type, reference, payload, signature_ok, received_at, processed_at, outcome, attempts, last_error)
      select 'paystack', 'unmatched:' || g, 'charge.success', 'stranger_' || g, '{"data":{"amount":100000}}', true, now() - interval '3 days', now() - interval '3 days', 'ignored', 1, null from generate_series(1, 20) g;
    insert into payment_provider_events (provider, event_id, event_type, reference, payload, signature_ok, received_at, outcome, attempts, last_error)
      select 'paystack', 'failed:' || g, 'transfer.success', 'tr_' || g, '{}', true, now() - interval '2 hours', 'failed', 2, 'db down' from generate_series(1, 10) g;

    -- business wallets and ledger
    insert into business_wallets (business_id, held_balance, available_balance) select ('00000000-0000-4000-9000-' || lpad(to_hex(g), 12, '0'))::uuid, 1000, 1000 from generate_series(1, 500) g;
    insert into business_wallet_transactions (business_id, appointment_id, type, amount, reference, status)
      select a.business_id, a.id, 'booking_credit', 800000, 'bench_bc_' || a.id, 'confirmed' from appointments a;
    insert into platform_transactions (appointment_id, business_id, type, amount, reference)
      select a.id, a.business_id, 'commission', 200000, 'bench_pc_' || a.id from appointments a;
    -- vendor credits for the delivered shop orders
    insert into shop_vendor_credits (order_id, business_id, amount_kobo, commission_kobo, status, released_kobo, released_at)
      select id, vendor_business_id, 800000, 200000, 'released', 800000, now() from shop_orders;
    insert into shop_order_status_history (order_id, from_status, to_status, created_at) select id, 'in_transit', 'delivered', created_at from shop_orders;
    insert into business_wallet_transactions (business_id, type, amount, reference, status) select vendor_business_id, 'shop_credit', 800000, 'shopcr_' || id, 'confirmed' from shop_orders;
    insert into business_wallet_transactions (business_id, type, amount, reference, status) select vendor_business_id, 'shop_release', 800000, 'shoprl_' || id, 'confirmed' from shop_orders;
    insert into reconciliation_findings (source, kind, subject_type, subject_id, severity, detail, status) select 'bench', 'k', 't', g::text, 'warning', 'd', 'resolved' from generate_series(1, 5000) g;
  `)
  await c.query('set session_replication_role = origin')
  c.release()
  console.log(`loaded in ${ms(t0)}; analyzing...`)
  await q('analyze')
  const counts = (await q(`select (select count(*) from payment_intents) intents, (select count(*) from coin_ledger) ledger, (select count(*) from payment_provider_events) events,
                                 (select count(*) from shop_orders) orders, (select count(*) from appointments) appts, (select count(*) from business_wallet_transactions) bwt`)).rows[0]
  console.log('  rows:', JSON.stringify(counts))

  console.log('\nscheduled work')
  await timed('run_db_reconciliation()  (every 10 minutes)', () => q('select run_db_reconciliation()'))
  await timed('  reconcile_coin_wallets()', () => q('select count(*) from reconcile_coin_wallets()'))
  await timed('  verify_coin_ledger_chain()', () => q('select count(*) from verify_coin_ledger_chain()'))
  await timed('  reconcile_commissions()', () => q('select count(*) from reconcile_commissions()'))
  await timed('  reconcile_withdrawals()', () => q('select count(*) from reconcile_withdrawals()'))
  await timed('  reconcile_refunds()', () => q('select count(*) from reconcile_refunds()'))
  await timed('  reconcile_shop_vendor_credits()', () => q('select count(*) from reconcile_shop_vendor_credits()'))
  await timed('list_open_intents_to_check(15, 50)  (every 5 minutes)', () => q('select * from list_open_intents_to_check(15, 50)'))
  await timed('list_replayable_provider_events()  (every 5 minutes)', () => q('select * from list_replayable_provider_events()'))
  await timed('release_shop_vendor_credits(200)  (every minute)', () => q('select release_shop_vendor_credits(200)'))
  await timed('claim_findings_to_alert()  (every 5 minutes)', () => q('select * from claim_findings_to_alert()'))
  await timed('list_reconciliation_findings()  (admin screen)', () => q('select * from list_reconciliation_findings()'))

  console.log('\nper-payment work')
  const ref = async (i) => {
    const o = (await q(`insert into shop_orders (order_ref, customer_id, vendor_business_id, total_kobo, subtotal_kobo, commission_kobo) values ('B-' || $1::text || '-' || floor(random()*1e9)::text, gen_random_uuid(), '00000000-0000-4000-9000-000000000001', 1050000, 1000000, 200000) returning id, customer_id, vendor_business_id`, [i])).rows[0]
    const reference = `bench_new_${i}_${Math.random().toString(36).slice(2, 8)}`
    await q(`insert into payment_intents (reference, application, purpose, customer_id, business_id, entity_type, entity_id, expected_amount) values ($1,'carefind','shop_order',$2,$3,'shop_order',$4,1050000)`, [reference, o.customer_id, o.vendor_business_id, o.id])
    return { reference, id: o.id }
  }
  const one = await ref(0)
  await timed('settle_payment_intent (shop order), 1 payment', () => q('select settle_payment_intent($1,$2,$3,$4,$5)', [one.reference, 'paystack', 'TB0', 1050000, 'NGN']))
  await timed('request_refund (shop order), 1 refund', () => q(`select request_refund('order_cancelled','shop_order',$1,null,null,false,null)`, [one.id]))

  const N = 200
  const batch = []
  for (let i = 1; i <= N; i++) batch.push(await ref(i))
  const t1 = performance.now()
  const lat = []
  let next = 0
  await Promise.all(Array.from({ length: 20 }, async () => {
    while (next < batch.length) {
      const b = batch[next++]
      const s = performance.now()
      await q('select settle_payment_intent($1,$2,$3,$4,$5)', [b.reference, 'paystack', `TB_${b.reference}`, 1050000, 'NGN'])
      lat.push(performance.now() - s)
    }
  }))
  lat.sort((a, b) => a - b)
  const wall = performance.now() - t1
  console.log(`  ${N} settlements, 20 clients, ONE vendor wallet: ${(N / (wall / 1000)).toFixed(0)}/s, p50 ${lat[Math.floor(N * 0.5)].toFixed(0)} ms, p95 ${lat[Math.floor(N * 0.95)].toFixed(0)} ms, max ${lat.at(-1).toFixed(0)} ms`)
  rows.push([`${N} settlements / 20 clients / one vendor wallet`, `${(N / (wall / 1000)).toFixed(0)}/s p95 ${lat[Math.floor(N * 0.95)].toFixed(0)} ms`])

  // the same 200 payments with one vendor per payment: separates raw cost from contention on one wallet row
  const spread = []
  for (let i = 1; i <= N; i++) {
    const vendor = `00000000-0000-4000-9000-${(1000 + i).toString(16).padStart(12, '0')}`
    const o = (await q(`insert into shop_orders (order_ref, customer_id, vendor_business_id, total_kobo, subtotal_kobo, commission_kobo) values ('S-' || $1::text || '-' || floor(random()*1e9)::text, gen_random_uuid(), $2, 1050000, 1000000, 200000) returning id, customer_id, vendor_business_id`, [i, vendor])).rows[0]
    const reference = `bench_sp_${i}_${Math.random().toString(36).slice(2, 8)}`
    await q(`insert into payment_intents (reference, application, purpose, customer_id, business_id, entity_type, entity_id, expected_amount) values ($1,'carefind','shop_order',$2,$3,'shop_order',$4,1050000)`, [reference, o.customer_id, o.vendor_business_id, o.id])
    spread.push({ reference })
  }
  const lat2 = []
  let next2 = 0
  const t2 = performance.now()
  await Promise.all(Array.from({ length: 20 }, async () => {
    while (next2 < spread.length) {
      const b = spread[next2++]
      const s = performance.now()
      await q('select settle_payment_intent($1,$2,$3,$4,$5)', [b.reference, 'paystack', `TS_${b.reference}`, 1050000, 'NGN'])
      lat2.push(performance.now() - s)
    }
  }))
  lat2.sort((a, b) => a - b)
  const wall2 = performance.now() - t2
  console.log(`  ${N} settlements, 20 clients, a DIFFERENT vendor each: ${(N / (wall2 / 1000)).toFixed(0)}/s, p50 ${lat2[Math.floor(N * 0.5)].toFixed(0)} ms, p95 ${lat2[Math.floor(N * 0.95)].toFixed(0)} ms`)
  rows.push([`${N} settlements / 20 clients / different vendors`, `${(N / (wall2 / 1000)).toFixed(0)}/s p95 ${lat2[Math.floor(N * 0.95)].toFixed(0)} ms`])
  const seq = []
  for (let i = 0; i < 20; i++) {
    const x = await ref(5000 + i)
    const s = performance.now()
    await q('select settle_payment_intent($1,$2,$3,$4,$5)', [x.reference, 'paystack', `TQ_${x.reference}`, 1050000, 'NGN'])
    seq.push(performance.now() - s)
  }
  seq.sort((a, b) => a - b)
  console.log(`  20 settlements one at a time (no contention): p50 ${seq[10].toFixed(0)} ms, max ${seq.at(-1).toFixed(0)} ms`)
  rows.push(['20 settlements, sequential', `p50 ${seq[10].toFixed(0)} ms`])

  console.log('\nquery plans (heaviest first)')
  const plan = async (label, sql) => {
    const t = performance.now()
    const r = await q(`explain (analyze, buffers, format text) ${sql}`)
    const lines = r.rows.map((x) => x['QUERY PLAN'])
    const seq = lines.filter((l) => /Seq Scan/.test(l)).map((l) => l.trim().slice(0, 110))
    console.log(`  ${label}: ${(performance.now() - t).toFixed(0)} ms${seq.length ? `\n      seq scans: ${seq.join('\n                 ')}` : ' (no seq scans)'}`)
  }
  await plan('unmatched charges (events check)', `select 1 from payment_provider_events e where e.event_type = 'charge.success' and e.outcome = 'ignored' and not exists (select 1 from payment_intents i where i.reference = e.reference)`)
  await plan('settled without transaction id', `select 1 from payment_intents i where i.status = 'settled' and i.provider_transaction_id is null`)
  await plan('shop settled but unpaid', `select 1 from payment_intents i left join shop_orders o on o.id = i.entity_id where i.status = 'settled' and i.purpose = 'shop_order' and (o.id is null or o.payment_status not in ('paid','refunded'))`)
  await plan('appointment settled but unpaid', `select 1 from payment_intents i left join appointments a on a.id = i.entity_id where i.status = 'settled' and i.purpose in ('appointment','booking') and i.entity_type = 'appointment' and (a.id is null or a.payment_status not in ('paid','refunded'))`)
  await plan('failed / unprocessed events', `select 1 from payment_provider_events e where (e.outcome = 'failed' and e.processed_at is null and e.received_at < now() - interval '30 minutes') or (e.outcome is null and e.processed_at is null and e.received_at < now() - interval '15 minutes')`)
  await plan('vendor credit without a shop_credit ledger row', `select 1 from shop_vendor_credits c where not exists (select 1 from business_wallet_transactions t where t.type = 'shop_credit' and t.reference = 'shopcr_' || c.order_id)`)
  await plan('released credit without a shop_release ledger row', `select 1 from shop_vendor_credits c where c.status = 'released' and c.released_kobo > 0 and not exists (select 1 from business_wallet_transactions t where t.type = 'shop_release' and t.reference = 'shoprl_' || c.order_id)`)
  await plan('legacy paid order without credit', `select 1 from shop_orders o where o.payment_status = 'paid' and o.status not in ('cancelled','refunded') and not exists (select 1 from shop_vendor_credits c where c.order_id = o.id)`)
  await plan('refund shortfall / approved return', `select 1 from refunds f where f.entity_type = 'shop_order' and f.business_shortfall_kobo > 0 and f.status <> 'failed'`)
  await plan('held below open credits', `select c.business_id from shop_vendor_credits c left join business_wallets w on w.business_id = c.business_id where c.status = 'held' group by c.business_id, w.held_balance having coalesce(w.held_balance, 0) < sum(c.amount_kobo - c.reversed_kobo)`)

  console.log('\nsummary'); for (const [l, t] of rows) console.log(`  ${l.padEnd(62)} ${t}`)
} finally {
  await drop()
}
