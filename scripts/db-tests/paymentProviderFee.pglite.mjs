// Provider-fee recording on payment_intents. See _harness.mjs for scope and limits.
//   node scripts/db-tests/paymentProviderFee.pglite.mjs
import { ok, expectError, finish, as, sup, db, applyMigrations } from './_harness.mjs'

// payment_intents and its guard, as read live on 2026-11-04 (columns, defaults and the guard's transition rules).
await db.exec(`
  create table public.payment_intents (
    id uuid primary key default gen_random_uuid(),
    reference text not null unique,
    provider text not null default 'paystack',
    provider_transaction_id text,
    application text not null,
    purpose text not null,
    customer_id uuid, business_id uuid, entity_type text, entity_id uuid,
    expected_amount bigint not null check (expected_amount > 0),
    currency text not null default 'NGN',
    status text not null default 'created',
    metadata jsonb not null default '{}'::jsonb,
    expires_at timestamptz default now() + interval '24 hours',
    verified_at timestamptz, settled_at timestamptz,
    created_at timestamptz default now(), updated_at timestamptz default now()
  );
  revoke all on public.payment_intents from anon, authenticated;
  grant select, insert, update on public.payment_intents to service_role;

  create or replace function public.payment_intents_guard() returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $f$
  declare
    allowed text[] := array['created>pending','created>verified','created>failed','created>expired','pending>verified','pending>failed',
      'pending>expired','expired>verified','failed>verified','verified>settled','verified>needs_refund','needs_refund>refunded','settled>refunded'];
  begin
    if tg_op = 'DELETE' then raise exception 'payment_intents rows are never deleted' using errcode = '42501'; end if;
    if tg_op = 'INSERT' then
      if new.status <> 'created' or new.verified_at is not null or new.settled_at is not null or new.provider_transaction_id is not null then
        raise exception 'a payment intent must be inserted as a fresh, unverified "created" row' using errcode = '23514';
      end if;
      return new;
    end if;
    if new.expected_amount is distinct from old.expected_amount or new.reference is distinct from old.reference then
      raise exception 'payment_intents identity columns are immutable' using errcode = '23514';
    end if;
    if old.provider_transaction_id is not null and new.provider_transaction_id is distinct from old.provider_transaction_id then
      raise exception 'payment_intents.provider_transaction_id cannot be changed once set' using errcode = '23514';
    end if;
    if new.status is distinct from old.status then
      if (old.status || '>' || new.status) <> all (allowed) then
        raise exception 'illegal payment intent transition % -> %', old.status, new.status using errcode = '23514';
      end if;
      if new.status = 'verified' then new.verified_at := coalesce(new.verified_at, now()); end if;
      if new.status = 'settled' then new.settled_at := coalesce(new.settled_at, now()); end if;
    end if;
    new.updated_at := now();
    return new;
  end; $f$;
  create trigger payment_intents_guard before insert or update or delete on public.payment_intents
    for each row execute function public.payment_intents_guard();
`)

// One intent per status, walked through the guard's legal transitions.
async function intent(ref, amount, path, txn = 'T-' + ref) {
  await sup(`insert into payment_intents (reference, application, purpose, expected_amount) values ($1,'carefind','wallet_topup',$2)`, [ref, amount])
  for (const [i, st] of path.entries()) {
    await sup(`update payment_intents set status=$2${i === 0 ? ', provider_transaction_id=$3' : ''} where reference=$1`, i === 0 ? [ref, st, txn] : [ref, st])
  }
}
await intent('ref_settled_01', 95000, ['verified', 'settled'])
await intent('ref_settled_02', 850000, ['verified', 'settled'])
await intent('ref_refunded_1', 80000, ['verified', 'settled', 'refunded'])
await intent('ref_needsref_1', 80000, ['verified', 'needs_refund'])
await sup(`insert into payment_intents (reference, application, purpose, expected_amount, status) values ('ref_pending_01','carefind','wallet_topup',50000,'created')`)
await sup(`update payment_intents set status='pending' where reference='ref_pending_01'`)

await applyMigrations(['carefind_20270103_payment_provider_fee.sql'])

const rec = (ref, fee, { provider = 'paystack', txn = 'T-' + ref, amount } = {}) =>
  sup(`select record_payment_provider_fee($1,$2,$3,$4,$5) as o`, [ref, provider, txn, amount ?? null, fee]).then((r) => r.rows[0].o)
const row = (ref) => sup('select * from payment_intents where reference=$1', [ref]).then((r) => r.rows[0])

// ---- recording ---------------------------------------------------------------------------------
ok('existing rows start with no fee', (await row('ref_settled_01')).provider_fee_kobo === null)
ok('records the fee for a settled payment', (await rec('ref_settled_01', 1425, { amount: 95000 })) === 'recorded')
const r1 = await row('ref_settled_01')
ok('net = charged - fee (N950 charged, N14.25 fee, N935.75 to the bank)', Number(r1.provider_fee_kobo) === 1425 && Number(r1.provider_net_kobo) === 93575, JSON.stringify(r1))
ok('recorded_at is stamped', r1.provider_fee_recorded_at !== null)
ok('status, amount and settled_at are untouched', r1.status === 'settled' && Number(r1.expected_amount) === 95000 && r1.settled_at !== null)
ok('records for a refunded payment (the fee was still taken)', (await rec('ref_refunded_1', 1200, { amount: 80000 })) === 'recorded')
ok('records for a needs_refund payment', (await rec('ref_needsref_1', 1200, { amount: 80000 })) === 'recorded')
ok('a zero fee is a valid fee', (await rec('ref_settled_02', 0, { amount: 850000 })) === 'recorded' && Number((await row('ref_settled_02')).provider_net_kobo) === 850000)

// ---- idempotent, never overwritten ---------------------------------------------------------------
ok('the same fee again is already_recorded', (await rec('ref_settled_01', 1425, { amount: 95000 })) === 'already_recorded')
ok('a different fee is fee_conflict and changes nothing', (await rec('ref_settled_01', 9999, { amount: 95000 })) === 'fee_conflict' && Number((await row('ref_settled_01')).provider_fee_kobo) === 1425)

// ---- refusals (answered, never raised) -----------------------------------------------------------
ok('unknown reference', (await rec('ref_nobody_001', 100, { amount: 100 })) === 'unknown_reference')
ok('a payment not taken yet is not_taken', (await rec('ref_pending_01', 750, { amount: 50000 })) === 'not_taken' && (await row('ref_pending_01')).provider_fee_kobo === null)
await intent('ref_fresh_0001', 100000, ['verified', 'settled'])
ok('a different provider is refused', (await rec('ref_fresh_0001', 1500, { amount: 100000, provider: 'flutterwave' })) === 'provider_mismatch')
ok('a different provider transaction id is refused', (await rec('ref_fresh_0001', 1500, { amount: 100000, txn: 'T-other' })) === 'transaction_mismatch')
ok('an amount that differs from the intent is refused', (await rec('ref_fresh_0001', 1500, { amount: 99000 })) === 'amount_mismatch')
ok('a negative fee is refused', (await rec('ref_fresh_0001', -1, { amount: 100000 })) === 'invalid_fee')
ok('a fee above the amount is refused', (await rec('ref_fresh_0001', 100001, { amount: 100000 })) === 'invalid_fee')
ok('a missing fee is refused', (await rec('ref_fresh_0001', null, { amount: 100000 })) === 'invalid_fee')
ok('after every refusal the row still has no fee', (await row('ref_fresh_0001')).provider_fee_kobo === null)

// ---- the columns themselves ---------------------------------------------------------------------
await expectError('a stored fee cannot be changed directly', () => sup(`update payment_intents set provider_fee_kobo = 1 where reference='ref_settled_01'`), 'cannot be changed once set')
await expectError('a stored fee cannot be cleared directly', () => sup(`update payment_intents set provider_fee_kobo = null, provider_fee_recorded_at = null where reference='ref_settled_01'`), 'cannot be changed once set')
await expectError('a new intent cannot carry a fee', () => sup(`insert into payment_intents (reference, application, purpose, expected_amount, provider_fee_kobo, provider_fee_recorded_at) values ('ref_withfee_01','carefind','wallet_topup',100,1,now())`), 'cannot be inserted with a provider fee')
await expectError('net cannot be written', () => sup(`update payment_intents set provider_net_kobo = 1 where reference='ref_fresh_0001'`))
ok('other updates on a row with a fee still work (settled -> refunded)', await sup(`update payment_intents set status='refunded' where reference='ref_settled_01'`).then(() => true, () => false))

// ---- the backfill's work list --------------------------------------------------------------------
await intent('ref_nofee_old1', 20000, ['verified', 'settled'])
await intent('ref_nofee_ref1', 30000, ['verified', 'settled', 'refunded'])
await intent('ref_nofee_need', 40000, ['verified', 'needs_refund'])
await sup(`insert into payment_intents (reference, application, purpose, expected_amount) values ('ref_wallet_001','carefind','booking_wallet',10000)`)
await sup(`update payment_intents set status='verified', provider_transaction_id='W-1' where reference='ref_wallet_001'`)
await sup(`update payment_intents set status='settled' where reference='ref_wallet_001'`)
await intent('ref_otherprov1', 20000, ['verified', 'settled'])
await sup(`alter table payment_intents disable trigger payment_intents_guard`)
await sup(`update payment_intents set provider='flutterwave' where reference='ref_otherprov1'`)
await sup(`alter table payment_intents enable trigger payment_intents_guard`)
const listed = (await sup(`select reference from list_intents_missing_provider_fee('paystack', 25)`)).rows.map((r) => r.reference).sort()
ok('lists settled and refunded payments that have no fee', listed.includes('ref_nofee_old1') && listed.includes('ref_nofee_ref1'), JSON.stringify(listed))
ok('never lists a payment whose fee is stored', !['ref_settled_01', 'ref_settled_02', 'ref_refunded_1'].some((r) => listed.includes(r)), JSON.stringify(listed))
ok('never lists needs_refund, pending, wallet-funded or another provider\'s payments',
  !['ref_nofee_need', 'ref_pending_01', 'ref_wallet_001', 'ref_otherprov1'].some((r) => listed.includes(r)), JSON.stringify(listed))
ok('respects the limit', (await sup(`select * from list_intents_missing_provider_fee('paystack', 1)`)).rows.length === 1)
ok('a silly limit is clamped, not an error', (await sup(`select * from list_intents_missing_provider_fee('paystack', -5)`)).rows.length === 1)
await expectError('a signed-in user cannot read the list', () => as('a', `select * from list_intents_missing_provider_fee('paystack', 25)`), '42501')

// ---- access ---------------------------------------------------------------------------------------
await expectError('a signed-in user cannot call it', () => as('a', `select record_payment_provider_fee('ref_fresh_0001','paystack','T-ref_fresh_0001',100000,1500)`), '42501')
await expectError('anon cannot call it', () => as('anon', `select record_payment_provider_fee('ref_fresh_0001','paystack','T-ref_fresh_0001',100000,1500)`), '42501')
await db.exec('SET ROLE service_role')
try {
  ok('service_role can call it', (await db.query(`select record_payment_provider_fee('ref_fresh_0001','paystack','T-ref_fresh_0001',100000,1600) o`)).rows[0].o === 'recorded')
} finally { await db.exec('RESET ROLE') }

finish()
