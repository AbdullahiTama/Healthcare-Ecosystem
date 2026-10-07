// @vitest-environment node
// Phase 14 red-team regression suite. Every test below is an ATTACK that worked against production before carefind_20261019_red_team_fixes
// (see docs/architecture/Red-Team-Audit.md), written as the attacker would run it, against real Postgres (PGlite) with the real migrations.
import { describe, it, expect, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createLegacyStubs } from './fixtures/legacyFunctions.js'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const M = (name) => read(`../../../../../supabase/migrations/${name}.sql`)
let db
let n = 0
const uid = () => `00000000-0000-4000-8000-${(++n + 210000).toString(16).padStart(12, '0')}`
const ref = (p) => `${p}_${++n}_abcdefgh`
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const all = async (sql, p = []) => (await db.query(sql, p)).rows
const as = async (role, who, fn) => {
  await db.exec(`set role ${role}`)
  await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false), set_config('request.jwt.claim.email', $3, false)", [who?.sub || '', role, who?.email || ''])
  try { return await fn() } finally {
    await db.exec('reset role')
    await db.exec("select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false), set_config('request.jwt.claim.email', '', false)")
  }
}
const admin = async (fn) => { await db.exec("select set_config('test.admin', '1', false)"); try { return await fn() } finally { await db.exec("select set_config('test.admin', '', false)") } }

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `)
  await db.exec(read('./fixtures/liveSchemaSubset.sql'))
  await db.exec(`
    alter table public.transactions add constraint transactions_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
    alter table public.wallets add constraint wallets_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
  `)
  for (const m of ['carefind_20261003_payment_intents_foundation', 'carefind_20261004_settle_payment_intent', 'carefind_20261005_coin_ledger']) await db.exec(M(m))
  await createLegacyStubs(db)
  for (const m of ['carefind_20261005_coin_writers_use_ledger', 'carefind_20261005_lock_wallets_to_ledger', 'carefind_20261006_settle_plan_and_carehub_appointments',
    'carefind_20261007_commission_engine', 'carefind_20261008_commission_reconcile_first_payment', 'carefind_20261008_withdrawal_engine', 'carefind_20261009_refund_engine', 'carefind_20261010_central_settlement']) await db.exec(M(m))
  await db.exec(`
    create function public.cancel_shop_order(p_order_id uuid, p_reason text default null) returns text language sql as $$ select 'old'::text $$;
    create function public.process_shop_return(p_return_id uuid, p_action text, p_notes text default null) returns text language sql as $$ select 'old'::text $$;
  `)
  for (const m of ['carefind_20261012_shop_vendor_payouts', 'carefind_20261014_reconciliation', 'carefind_20261015_reconciliation_ops', 'carefind_20261016_reconciliation_scale', 'carefind_20261017_engine_timeouts_and_hot_paths']) await db.exec(M(m))
  // production as it is BEFORE the red-team fixes: the vulnerable bodies, so each attack below is run against what was live
  await db.exec(`
    create or replace function public.is_platform_admin() returns boolean language sql stable as $$ select coalesce(nullif(current_setting('test.admin', true), '') = '1', false) $$;
    create function public.calculate_shop_commission(p_segment text, p_order_total_kobo integer) returns integer language sql as $$ select round(p_order_total_kobo * 0.20)::integer $$;
    -- the live trigger that releases the booking credit when an appointment is completed
    create function public.appointments_after_update() returns trigger language plpgsql security definer set search_path to 'public' as $$
    declare v_amount integer;
    begin
      if NEW.status = 'completed' and NEW.payment_status = 'paid' and NEW.released_at is null and OLD.status is distinct from 'completed' and coalesce(NEW.payment_channel, '') in ('carecoins', 'card') then
        select amount into v_amount from business_wallet_transactions where appointment_id = NEW.id and type = 'booking_credit' limit 1;
        if v_amount is not null then
          update business_wallets set held_balance = held_balance - v_amount, available_balance = available_balance + v_amount, updated_at = now() where business_id = NEW.business_id;
          insert into business_wallet_transactions (business_id, appointment_id, type, amount, reference) values (NEW.business_id, NEW.id, 'release', v_amount, null);
        end if;
        NEW.released_at := now(); NEW.dispute_until := now() + interval '72 hours';
      end if;
      return NEW;
    end $$;
    create trigger appointments_after_update before update on public.appointments for each row execute function public.appointments_after_update();
    create or replace function public.provision_staff_auth(p_business_id uuid, p_email text, p_password text) returns uuid language plpgsql security definer set search_path = public as $$
    declare v_email text := lower(trim(p_email)); v_staff uuid; v_uid uuid;
    begin
      if not (public.is_platform_admin() or p_business_id in (select public.current_business_ids())) then raise exception 'no permission'; end if;
      select id into v_staff from public.staff where business_id = p_business_id and lower(email) = v_email and status = 'active' limit 1;
      if v_staff is null then raise exception 'No active staff member'; end if;
      select id into v_uid from auth.users where lower(email) = v_email;
      if v_uid is null then v_uid := public.mint_confirmed_auth_user(v_email, p_password);
      else update auth.users set encrypted_password = 'hash:' || p_password where id = v_uid; end if;
      update public.staff set auth_user_id = v_uid where id = v_staff;
      return v_uid;
    end $$;
    create function public.update_shop_order_status(p_order_id uuid, p_to_status text, p_changed_by uuid, p_note text) returns void language plpgsql security definer set search_path to 'public' as $$
    declare v_from text; v_customer uuid; v_vendor uuid; v_actor uuid;
    begin
      v_actor := COALESCE(p_changed_by, auth.uid());
      select status, customer_id, vendor_business_id into v_from, v_customer, v_vendor from shop_orders where id = p_order_id for update;
      if v_from is null then raise exception 'Order not found'; end if;
      if p_to_status = v_from then return; end if;
      if v_actor is distinct from auth.uid() and not is_platform_admin() and v_vendor not in (select current_business_ids()) and v_customer is distinct from auth.uid() then raise exception 'Not authorized' using errcode='42501'; end if;
      update shop_orders set status = p_to_status where id = p_order_id;
      insert into shop_order_status_history (order_id, from_status, to_status, changed_by, note) values (p_order_id, v_from, p_to_status, v_actor, p_note);
    end $$;
    create function public.complete_appointment_and_release(p_appointment_id uuid) returns text language plpgsql security definer set search_path to 'public' as $$
    declare v_business_id uuid; v_status text; v_fee integer; v_payment_status text;
    begin
      select business_id, status, coalesce(amount, fee_amount), payment_status into v_business_id, v_status, v_fee, v_payment_status from appointments where id = p_appointment_id for update;
      if v_business_id is null then return 'not_found'; end if;
      if not exists (select 1 where v_business_id = any (select current_business_ids())) and not is_platform_admin() then return 'forbidden'; end if;
      if v_status not in ('confirmed') then return 'not_confirmed'; end if;
      if v_fee is null or v_fee <= 0 then return 'no_fee'; end if;
      update appointments set status = 'completed', completed_at = now() where id = p_appointment_id;
      insert into business_wallets (business_id, held_balance, available_balance) values (v_business_id, 0, 0) on conflict (business_id) do nothing;
      perform 1 from business_wallets where business_id = v_business_id and held_balance >= v_fee for update;
      if found then
        update business_wallets set held_balance = held_balance - v_fee, available_balance = available_balance + v_fee, updated_at = now() where business_id = v_business_id;
        insert into business_wallet_transactions (business_id, appointment_id, type, amount, reference, status) values (v_business_id, p_appointment_id, 'release', v_fee, null, 'confirmed');
      end if;
      return 'ok';
    end $$;
    create function public.get_purchase_totals(p_business_id uuid) returns table (purchase_count bigint, total_paid numeric, total_owed numeric) language plpgsql security definer set search_path = public as $$
    begin return query select count(*)::bigint, coalesce(sum(p.amount_paid), 0)::numeric, coalesce(sum(p.balance), 0)::numeric from purchases p where p.business_id = p_business_id; end $$;
    create function public.validate_promo_code(p_code text, p_user_id uuid, p_order_kobo integer, p_segment text) returns jsonb language sql security definer set search_path = public as $$ select '{"valid":true}'::jsonb $$;
    grant execute on function public.get_purchase_totals(uuid) to anon, authenticated;
  `)
}, 240_000)

// ---- the BEFORE state, proven: each attack works against the vulnerable bodies, then the migration is applied --------------------------
const business = async (email, { status = 'active', admin = false } = {}) => (await one('insert into businesses (name, email, status, is_platform_admin) values ($1,$2,$3,$4) returning id', ['Biz ' + email, email, status, admin])).id
const vendorSetup = async () => {
  const email = `v${++n}@example.com`
  const b = await business(email)
  const customer = uid()
  const o = await one(`insert into shop_orders (order_ref, customer_id, vendor_business_id, status, payment_status, total_kobo, subtotal_kobo, commission_kobo) values ($1,$2,$3,'paid','paid',1050000,1000000,200000) returning id`, [ref('CF'), customer, b])
  return { b, email, customer, order: o.id }
}

describe('BEFORE the fixes (the attacks work)', () => {
  it('F-37: a business member takes over an existing account by adding a staff row with its email', async () => {
    const victim = uid()
    await db.query("insert into auth.users (id, email, encrypted_password) values ($1,'victim@example.com','hash:original')", [victim])
    const b = await business('attacker@example.com')
    await db.query("insert into staff (business_id, email) values ($1,'victim@example.com')", [b])
    await as('authenticated', { sub: uid(), email: 'attacker@example.com' }, () => one("select provision_staff_auth($1,'victim@example.com','attackerknows') r", [b]))
    expect((await one('select encrypted_password p from auth.users where id = $1', [victim])).p).toBe('hash:attackerknows')     // taken over
    await db.query("update auth.users set encrypted_password = 'hash:original' where id = $1", [victim])
  })

  it('F-39: any signed-in user changes any order\'s status by passing their own id', async () => {
    const v = await vendorSetup()
    const stranger = uid()
    await as('authenticated', { sub: stranger, email: 'nobody@example.com' }, () => one(`select update_shop_order_status($1,'delivered',$2,null)`, [v.order, stranger]))
    expect((await one('select status from shop_orders where id = $1', [v.order])).status).toBe('delivered')
    await db.query("update shop_orders set status = 'paid' where id = $1", [v.order])
  })

  it('F-40: completing a dummy appointment releases other customers\' held money', async () => {
    const email = `r${++n}@example.com`
    const b = await business(email)
    await db.query('insert into business_wallets (business_id, held_balance, available_balance) values ($1, 800000, 0)', [b])
    const a = await one(`insert into appointments (business_id, client_name, source, fee_amount, payment_status, payment_reference, payment_channel, status) values ($1,'dummy','carehub',800000,'paid',$2,'cash','confirmed') returning id`, [b, ref('dummy')])
    await as('authenticated', { sub: uid(), email }, () => one('select complete_appointment_and_release($1) r', [a.id]))
    expect(await one('select held_balance::int h, available_balance::int a from business_wallets where business_id = $1', [b])).toEqual({ h: 0, a: 800000 })     // the hold was bypassed
  })

  it('F-41: anyone (anon) reads a business\'s purchase records', async () => {
    const b = await business(`p${++n}@example.com`)
    await db.query(`insert into purchases (business_id, amount_paid, balance) values ($1, 500, 700)`, [b])
    const r = await as('anon', null, () => one('select * from get_purchase_totals($1)', [b]))
    expect(Number(r.total_owed)).toBe(700)
  })
})

describe('apply carefind_20261019_red_team_fixes', () => {
  it('applies', async () => { await db.exec(M('carefind_20261019_red_team_fixes')) }, 60_000)
})

describe('F-37: provision_staff_auth can no longer take over an account', () => {
  it('an existing account keeps its password and confirmation; the staff row links to it', async () => {
    const victim = uid()
    await db.query("insert into auth.users (id, email, encrypted_password) values ($1,'victim2@example.com','hash:original')", [victim])
    const b = await business('attacker2@example.com')
    await db.query("insert into staff (business_id, email) values ($1,'victim2@example.com')", [b])
    const r = await as('authenticated', { sub: uid(), email: 'attacker2@example.com' }, () => one("select provision_staff_auth($1,'victim2@example.com','attackerknows') r", [b]))
    expect(r.r).toBe(victim)
    expect((await one('select encrypted_password p from auth.users where id = $1', [victim])).p).toBe('hash:original')
  })

  it('a NEW address still gets an account with the owner\'s first password', async () => {
    const b = await business('owner3@example.com')
    await db.query("insert into staff (business_id, email) values ($1,'newstaff@example.com')", [b])
    await as('authenticated', { sub: uid(), email: 'owner3@example.com' }, () => one("select provision_staff_auth($1,'newstaff@example.com','firstpass1') r", [b]))
    expect((await one("select encrypted_password p from auth.users where email = 'newstaff@example.com'")).p).toBe('hash:firstpass1')
  })

  it('an UNAPPROVED business (anyone can register one) cannot mint or touch accounts; a non-member cannot; a staff row linked elsewhere is refused', async () => {
    const pending = await business('pending@example.com', { status: 'pending' })
    await db.query("insert into staff (business_id, email) values ($1,'x1@example.com')", [pending])
    await expect(as('authenticated', { sub: uid(), email: 'pending@example.com' }, () => one("select provision_staff_auth($1,'x1@example.com','password1')", [pending]))).rejects.toThrow(/must be approved/)
    const b = await business('owner4@example.com')
    await db.query("insert into staff (business_id, email) values ($1,'x2@example.com')", [b])
    await expect(as('authenticated', { sub: uid(), email: 'stranger@example.com' }, () => one("select provision_staff_auth($1,'x2@example.com','password1')", [b]))).rejects.toThrow(/permission/)
    const other = uid()
    await db.query("insert into auth.users (id, email) values ($1,'x3@example.com')", [other])
    await db.query("insert into staff (business_id, email, auth_user_id) values ($1,'x3@example.com',$2)", [b, uid()])
    await expect(as('authenticated', { sub: uid(), email: 'owner4@example.com' }, () => one("select provision_staff_auth($1,'x3@example.com','password1')", [b]))).rejects.toThrow(/already linked to a different account/)
  })

  it('a short password is still refused', async () => {
    const b = await business('owner5@example.com')
    await db.query("insert into staff (business_id, email) values ($1,'x5@example.com')", [b])
    await expect(as('authenticated', { sub: uid(), email: 'owner5@example.com' }, () => one("select provision_staff_auth($1,'x5@example.com','abc')", [b]))).rejects.toThrow(/at least 6/)
  })
})

describe('F-38: the vendor credit cannot be inflated', () => {
  const seedCatalog = async (vendor) => {
    const product = (await one(`insert into products (name, price, stock, sale_type) values ('Paracetamol', 100, 50, 'retail') returning id`)).id
    const ecom = (await one(`insert into ecommerce_products (business_id, product_id, ecommerce_price_kobo) values ($1,$2,10000) returning id`, [vendor, product])).id
    return ecom
  }
  const order = (customer, vendor, ecom, over = {}) => as('authenticated', { sub: customer, email: 'c@example.com' }, () => one(
    `select create_shop_order($1,$2,$3::jsonb,$4,$5,$6,0,$7,'addr','Lagos','Lagos','0801','c@example.com',null,'pickup',1,true,'Cust',$8,null) id`,
    [customer, vendor, JSON.stringify([{ ecommerce_product_id: ecom, quantity: 2 }]), over.subtotal ?? 20000, over.commission ?? 4000, over.fulfilment ?? 50000, over.total ?? 70000, ref('cfpay')]))

  it('an honest order is created with the items\' own subtotal', async () => {
    const vendor = await business(`shop${++n}@example.com`); const ecom = await seedCatalog(vendor)
    const r = await order(uid(), vendor, ecom)
    const o = await one('select subtotal_kobo::int s, commission_kobo::int c, total_kobo::int t from shop_orders where id = $1', [r.id])
    expect(o).toEqual({ s: 20000, c: 4000, t: 70000 })
    expect((await one('select sum(line_total_kobo)::int s from shop_order_items where order_id = $1', [r.id])).s).toBe(20000)
  })

  it('ATTACK: a subtotal of N10,000,000 for a N200 cart (total and commission "matching the real cart") is refused, and nothing is left behind', async () => {
    const vendor = await business(`shop${++n}@example.com`); const ecom = await seedCatalog(vendor)
    const before = (await one('select count(*)::int c from shop_orders')).c
    await expect(order(uid(), vendor, ecom, { subtotal: 1_000_000_000 })).rejects.toThrow(/Subtotal mismatch: expected 20000, got 1000000000/)
    expect((await one('select count(*)::int c from shop_orders')).c).toBe(before)
  })

  it('DEFENCE IN DEPTH: an order whose subtotal is not backed by its items is parked for refund, never credited to the vendor', async () => {
    const vendor = uid(); const customer = uid()
    const o = await one(`insert into shop_orders (order_ref, customer_id, vendor_business_id, status, total_kobo, subtotal_kobo, commission_kobo) values ($1,$2,$3,'pending_payment',1050000,1000000,200000) returning id`, [ref('CF'), customer, vendor])
    await db.query('update shop_order_items set line_total_kobo = 5000 where order_id = $1', [o.id])      // the items say N50, the subtotal says N10,000
    const reference = ref('cf_shop')
    await db.query(`insert into payment_intents (reference, application, purpose, customer_id, business_id, entity_type, entity_id, expected_amount) values ($1,'carefind','shop_order',$2,$3,'shop_order',$4,1050000)`, [reference, customer, vendor, o.id])
    const r = (await one('select settle_payment_intent($1,$2,$3,$4,$5) r', [reference, 'paystack', 'TX' + reference, 1050000, 'NGN'])).r
    expect(r).toMatchObject({ outcome: 'needs_refund', reason: 'subtotal_mismatch' })
    expect(await one('select count(*)::int c from shop_vendor_credits where order_id = $1', [o.id])).toEqual({ c: 0 })
    expect((await one('select payment_status from shop_orders where id = $1', [o.id])).payment_status).toBe('pending')
  })

  it('an order with NO items cannot be settled either', async () => {
    const vendor = uid(); const customer = uid()
    const o = await one(`insert into shop_orders (order_ref, customer_id, vendor_business_id, status, total_kobo, subtotal_kobo, commission_kobo) values ($1,$2,$3,'pending_payment',1050000,1000000,200000) returning id`, [ref('CF'), customer, vendor])
    await db.query('delete from shop_order_items where order_id = $1', [o.id])
    const reference = ref('cf_shop')
    await db.query(`insert into payment_intents (reference, application, purpose, customer_id, business_id, entity_type, entity_id, expected_amount) values ($1,'carefind','shop_order',$2,$3,'shop_order',$4,1050000)`, [reference, customer, vendor, o.id])
    expect((await one('select settle_payment_intent($1,$2,$3,$4,$5) r', [reference, 'paystack', 'TX' + reference, 1050000, 'NGN'])).r).toMatchObject({ outcome: 'needs_refund', reason: 'subtotal_mismatch' })
  })

  it('the reconciliation flags a credit that exceeds its items (tampering after the fact)', async () => {
    const vendor = uid(); const customer = uid()
    const o = await one(`insert into shop_orders (order_ref, customer_id, vendor_business_id, status, total_kobo, subtotal_kobo, commission_kobo) values ($1,$2,$3,'pending_payment',1050000,1000000,200000) returning id`, [ref('CF'), customer, vendor])
    const reference = ref('cf_shop')
    await db.query(`insert into payment_intents (reference, application, purpose, customer_id, business_id, entity_type, entity_id, expected_amount) values ($1,'carefind','shop_order',$2,$3,'shop_order',$4,1050000)`, [reference, customer, vendor, o.id])
    expect((await one('select settle_payment_intent($1,$2,$3,$4,$5) r', [reference, 'paystack', 'TX' + reference, 1050000, 'NGN'])).r.outcome).toBe('settled')
    expect((await all('select kind from reconcile_shop_vendor_credits() where order_id = $1', [o.id]))).toEqual([])
    await db.query('update shop_order_items set line_total_kobo = 1 where order_id = $1', [o.id])
    expect((await all('select kind from reconcile_shop_vendor_credits() where order_id = $1', [o.id])).map((r) => r.kind)).toContain('credit_not_backed_by_items')
  })
})

describe('F-39: only the vendor (forward, on a paid order) or an admin may change an order\'s status', () => {
  const upd = (who, order, to, changedBy = null) => as('authenticated', who, () => one('select update_shop_order_status($1,$2,$3,null)', [order, to, changedBy]))
  const status = async (id) => (await one('select status from shop_orders where id = $1', [id])).status

  it('a stranger and the order\'s own customer are refused, even naming themselves as the actor', async () => {
    const v = await vendorSetup()
    const stranger = { sub: uid(), email: 'nobody@example.com' }
    await expect(upd(stranger, v.order, 'delivered', stranger.sub)).rejects.toThrow(/Not authorized/)
    await expect(upd({ sub: v.customer, email: 'cust@example.com' }, v.order, 'delivered', v.customer)).rejects.toThrow(/Not authorized/)
    expect(await status(v.order)).toBe('paid')
  })

  it('the vendor moves a paid order forward, and cannot go backwards, skip to payment states, or touch an unpaid order', async () => {
    const v = await vendorSetup(); const me = { sub: uid(), email: v.email }
    await upd(me, v.order, 'accepted'); await upd(me, v.order, 'processing'); await upd(me, v.order, 'in_transit')
    expect(await status(v.order)).toBe('in_transit')
    await expect(upd(me, v.order, 'processing')).rejects.toThrow(/not allowed/)
    for (const bad of ['paid', 'refunded', 'cancelled', 'refund_requested', 'disputed', 'pending_payment']) await expect(upd(me, v.order, bad), bad).rejects.toThrow(/not allowed/)
    await upd(me, v.order, 'delivered')
    expect(await status(v.order)).toBe('delivered')
    // an UNPAID order is never the vendor's to advance
    const unpaid = await one(`insert into shop_orders (order_ref, customer_id, vendor_business_id, status, payment_status, total_kobo, subtotal_kobo, commission_kobo) values ($1,$2,$3,'pending_payment','pending',100,100,20) returning id`, [ref('CF'), uid(), v.b])
    await expect(upd(me, unpaid.id, 'accepted')).rejects.toThrow(/not allowed/)
    await expect(upd(me, unpaid.id, 'paid')).rejects.toThrow(/not allowed/)
  })

  it('the vendor may quote delivery (delivery_quote_pending -> pending_payment) and nothing else from there', async () => {
    const v = await vendorSetup(); const me = { sub: uid(), email: v.email }
    const q = await one(`insert into shop_orders (order_ref, customer_id, vendor_business_id, status, payment_status, total_kobo, subtotal_kobo, commission_kobo) values ($1,$2,$3,'delivery_quote_pending','pending',100,100,20) returning id`, [ref('CF'), uid(), v.b])
    await expect(upd(me, q.id, 'accepted')).rejects.toThrow(/not allowed/)
    await upd(me, q.id, 'pending_payment')
    expect(await status(q.id)).toBe('pending_payment')
  })

  it('an admin / the server can set any status; a non-admin\'s p_changed_by is ignored (the history records the real caller)', async () => {
    const v = await vendorSetup(); const me = { sub: uid(), email: v.email }
    await admin(() => as('authenticated', { sub: uid(), email: 'admin@example.com' }, () => one(`select update_shop_order_status($1,'refunded',null,'ops')`, [v.order])))
    expect(await status(v.order)).toBe('refunded')
    await as('service_role', null, () => one(`select update_shop_order_status($1,'paid',$2,'ops')`, [v.order, uid()]))
    expect(await status(v.order)).toBe('paid')
    const spoof = uid()
    await upd(me, v.order, 'accepted', spoof)
    expect((await one(`select changed_by from shop_order_status_history where order_id = $1 and to_status = 'accepted'`, [v.order])).changed_by).toBe(me.sub)
  })

  it('an unknown order is reported, and a status change to the current status is a no-op', async () => {
    const v = await vendorSetup(); const me = { sub: uid(), email: v.email }
    await expect(upd(me, uid(), 'accepted')).rejects.toThrow(/Order not found/)
    await upd(me, v.order, 'paid')
    expect(await status(v.order)).toBe('paid')
  })
})

describe('F-40: completing an appointment releases ONLY the booking credit it earned, once', () => {
  const paidCardAppointment = async (b, fee = 1000000) => {
    const a = await one(`insert into appointments (business_id, client_name, source, fee_amount, payment_status, payment_reference) values ($1,'Ada','carehub',$2,'unpaid',$3) returning id`, [b, fee, ref('appt')])
    const reference = ref('chapp')
    await db.query(`insert into payment_intents (reference, application, purpose, business_id, entity_type, entity_id, expected_amount, metadata) values ($1,'carehub','appointment',$2,'appointment',$3,$4,'{}'::jsonb)`, [reference, b, a.id, fee])
    expect((await one('select settle_payment_intent($1,$2,$3,$4,$5) r', [reference, 'paystack', `T${reference}`, fee, 'NGN'])).r.outcome).toBe('settled')
    return a.id
  }
  const wallet = async (b) => one('select held_balance::int h, available_balance::int a from business_wallets where business_id = $1', [b])
  const complete = (email, id) => as('authenticated', { sub: uid(), email }, () => one('select complete_appointment_and_release($1) r', [id])).then((x) => x.r)

  it('a paid card appointment: the business share (80%) moves from held to available exactly once', async () => {
    const email = `c${++n}@example.com`; const b = await business(email)
    const a = await paidCardAppointment(b)
    await db.query("update appointments set status = 'confirmed' where id = $1", [a])
    expect(await wallet(b)).toEqual({ h: 800000, a: 0 })
    expect(await complete(email, a)).toBe('ok')
    expect(await wallet(b)).toEqual({ h: 0, a: 800000 })
    expect(await complete(email, a)).toBe('not_confirmed')                          // a second call cannot release again
    expect(await wallet(b)).toEqual({ h: 0, a: 800000 })
    expect((await all(`select amount::int a from business_wallet_transactions where appointment_id = $1 and type = 'release'`, [a])).map((r) => r.a)).toEqual([800000])
  })

  it('ATTACK: dummy appointments (cash, any fee) completed by the business move NO money, so the hold on real customers\' payments stays', async () => {
    const email = `c${++n}@example.com`; const b = await business(email)
    const real = await paidCardAppointment(b)                                          // 800,000 held for a booking not yet delivered
    const dummy = await one(`insert into appointments (business_id, client_name, source, fee_amount, payment_status, payment_reference, payment_channel, status) values ($1,'dummy','carehub',800000,'paid',$2,'cash','confirmed') returning id`, [b, ref('dummy')])
    expect(await complete(email, dummy.id)).toBe('ok')
    expect(await wallet(b)).toEqual({ h: 800000, a: 0 })
    expect((await one('select status from appointments where id = $1', [real])).status).not.toBe('completed')
  })

  it('a stranger cannot complete another business\'s appointment; an unconfirmed or free one is refused', async () => {
    const email = `c${++n}@example.com`; const b = await business(email)
    const a = await paidCardAppointment(b)
    expect(await complete('stranger@example.com', a)).toBe('forbidden')
    await db.query("update appointments set status = 'pending' where id = $1", [a])
    expect(await complete(email, a)).toBe('not_confirmed')
    const free = await one(`insert into appointments (business_id, client_name, source, fee_amount, status) values ($1,'x','carehub',0,'confirmed') returning id`, [b])
    expect(await complete(email, free.id)).toBe('no_fee')
    expect(await complete(email, uid())).toBe('not_found')
  })
})

describe('F-41 / F-42: business and customer data readers check the caller', () => {
  it('purchases: anon is denied at the door, a signed-in non-member is refused, the business and an admin may read', async () => {
    const email = `p${++n}@example.com`; const b = await business(email)
    await db.query(`insert into purchases (business_id, supplier_name, amount_paid, balance) values ($1,'Acme',500,700)`, [b])
    await expect(as('anon', null, () => one('select * from get_purchase_totals($1)', [b]))).rejects.toThrow(/permission denied/)
    await expect(as('anon', null, () => one("select * from get_purchases_page($1,null,null,null,0,10)", [b]))).rejects.toThrow(/permission denied/)
    await expect(as('authenticated', { sub: uid(), email: 'nobody@example.com' }, () => one('select * from get_purchase_totals($1)', [b]))).rejects.toThrow(/Not authorized/)
    expect(Number((await as('authenticated', { sub: uid(), email }, () => one('select * from get_purchase_totals($1)', [b]))).total_owed)).toBe(700)
    expect((await as('authenticated', { sub: uid(), email }, () => all("select supplier_name from get_purchases_page($1,'Ac',null,null,0,10)", [b])))).toEqual([{ supplier_name: 'Acme' }])
    expect(Number((await admin(() => as('authenticated', { sub: uid(), email: 'adm@example.com' }, () => one('select * from get_purchase_totals($1)', [b])))).total_owed)).toBe(700)
  })

  it('expenses: the three readers refuse a non-member and serve a member', async () => {
    const email = `e${++n}@example.com`; const b = await business(email)
    await db.query(`insert into expenses (business_id, category, amount, description) values ($1,'rent',1200,'x')`, [b])
    const stranger = { sub: uid(), email: 'nobody@example.com' }; const me = { sub: uid(), email }
    for (const q of ['select * from get_expense_totals($1, null)', 'select * from get_expense_summary($1, null)', 'select * from get_expenses_page($1, null, 0, 10)']) {
      await expect(as('authenticated', stranger, () => one(q, [b])), q).rejects.toThrow(/Not authorized/)
      expect((await as('authenticated', me, () => all(q, [b]))).length, q).toBeGreaterThan(0)
    }
  })

  it('a customer\'s purchase summary is theirs (or an admin\'s)', async () => {
    const customer = uid()
    await db.query(`insert into shop_orders (order_ref, customer_id, vendor_business_id, status, total_kobo, subtotal_kobo, commission_kobo) values ($1,$2,$3,'delivered',500,500,100)`, [ref('CF'), customer, uid()])
    await expect(as('authenticated', { sub: uid(), email: 'nobody@example.com' }, () => one('select get_customer_purchase_summary($1) r', [customer]))).rejects.toThrow(/Not authorized/)
    expect((await as('authenticated', { sub: customer, email: 'me@example.com' }, () => one('select get_customer_purchase_summary($1) r', [customer]))).r.total_orders).toBe(1)
  })

  it('an order\'s notification history is for its customer, its vendor, or an admin', async () => {
    const v = await vendorSetup()
    await db.query(`insert into shop_order_notifications (order_id, notification_type, message, channel) values ($1,'order_received','hi','in_app')`, [v.order])
    await expect(as('authenticated', { sub: uid(), email: 'nobody@example.com' }, () => all('select * from get_order_notification_history($1)', [v.order]))).rejects.toThrow(/Not authorized/)
    expect((await as('authenticated', { sub: uid(), email: v.email }, () => all('select * from get_order_notification_history($1)', [v.order]))).length).toBe(1)
    expect((await as('authenticated', { sub: v.customer, email: 'c@example.com' }, () => all('select * from get_order_notification_history($1)', [v.order]))).length).toBe(1)
  })
})

describe('F-43 / F-44: client write paths and server-only functions', () => {
  it('customers can no longer insert items or returns directly (the policies are gone)', async () => {
    expect(await all(`select policyname from pg_policies where schemaname = 'public' and policyname in ('shop_order_items system insert', 'shop_returns_customer_insert', 'shop_returns_vendor_update')`)).toEqual([])
  })

  it('record_shop_notification, cleanup_old_sequences and book_appointment_slot are server-only', async () => {
    for (const role of ['anon', 'authenticated']) {
      await expect(as(role, null, () => one("select record_shop_notification($1,'order_received','Payment confirmed!',$2,'in_app')", [uid(), uid()]))).rejects.toThrow(/permission denied/)
      await expect(as(role, null, () => one('select cleanup_old_sequences()'))).rejects.toThrow(/permission denied/)
      await expect(as(role, null, () => one("select book_appointment_slot($1,$2,current_date,'10:00','x','0801',1,'r','physical','c')", [uid(), uid()]))).rejects.toThrow(/permission denied/)
    }
  })

  it('a promo check answers for the CALLER (not a user id they name), and anon is refused', async () => {
    const victim = uid(); const attacker = uid()
    const p = await one(`insert into shop_promo_codes (code, discount_type, discount_value, usage_limit_per_user, min_order_kobo) values ('SAVE10','fixed',1000,1,0) returning id`)
    await db.query('insert into shop_promo_code_usage (promo_code_id, user_id, order_id, discount_kobo) values ($1,$2,$3,1000)', [p.id, victim, uid()])
    const probe = (who, asUser) => as('authenticated', who, () => one("select validate_promo_code('save10', $1, 50000, 'retail') r", [asUser])).then((x) => x.r)
    expect((await probe({ sub: attacker }, victim)).valid).toBe(true)            // naming the victim does not reveal the victim's usage
    expect((await probe({ sub: victim }, victim)).valid).toBe(false)             // the victim themselves: already used
    expect((await as('service_role', null, () => one("select validate_promo_code('save10', $1, 50000, 'retail') r", [victim]))).r.valid).toBe(false)   // the server may name a user
    await expect(as('anon', null, () => one("select validate_promo_code('save10', $1, 50000, 'retail')", [victim]))).rejects.toThrow(/permission denied/)
  })

  it('the engine entry points still have their timeouts after the replacement', async () => {
    const cfg = (await one("select coalesce(proconfig, '{}') c from pg_proc where proname = '_settle_shop_order'")).c
    expect(cfg).toContain('lock_timeout=10s')
  })
})

// ---- shop flow review (carefind_20261020_shop_flow_fixes) ---------------------------------------------------------------------------------
describe('S-1 / S-2: vendor tracking updates and back-in-stock alerts', () => {
  const track = (who, order, status, notes = null) => as('authenticated', who, () => one('select add_tracking_event($1,$2,$3,null)', [order, status, notes]))
  const status = async (id) => (await one('select status from shop_orders where id = $1', [id])).status
  const restockable = async () => {
    const product = (await one(`insert into products (name, price, stock, sale_type) values ('Vitamin C', 100, 0, 'retail') returning id`)).id
    const ecom = (await one(`insert into ecommerce_products (business_id, product_id, ecommerce_price_kobo) values ($1,$2,10000) returning id`, [uid(), product])).id
    const watcher = uid()
    await db.query('insert into shop_stock_alerts (user_id, ecommerce_product_id) values ($1,$2)', [watcher, ecom])
    return { product, ecom, watcher }
  }

  beforeAll(async () => {
    // the live stock-alert table and trigger, as carehub_20260906_shop_stock_alerts created them
    await db.exec(`
      create table public.shop_stock_alerts (id uuid primary key default gen_random_uuid(), user_id uuid not null, ecommerce_product_id uuid not null,
        is_active boolean not null default true, notified_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
      alter table public.ecommerce_products add column if not exists description text;
    `)
    const live = read('../../../../../supabase/migrations/carehub_20260906_shop_stock_alerts.sql')
    await db.exec(live.slice(live.indexOf('CREATE OR REPLACE FUNCTION public.notify_stock_alerts_on_restock'), live.indexOf('-- Grant permissions')))
  })

  it('BEFORE: the vendor cannot record any tracking update (its customer notice names columns notifications does not have)', async () => {
    const v = await vendorSetup()
    await expect(track({ sub: uid(), email: v.email }, v.order, 'accepted')).rejects.toThrow(/column "user_id" of relation "notifications" does not exist/)
    expect(await status(v.order)).toBe('paid')
  })

  it('BEFORE: a restock never alerts the shoppers watching the product', async () => {
    const r = await restockable()
    await db.query('update products set stock = 5 where id = $1', [r.product])
    expect((await one('select count(*)::int c from notifications where recipient_id = $1', [r.watcher])).c).toBe(0)
    expect((await one('select is_active from shop_stock_alerts where user_id = $1', [r.watcher])).is_active).toBe(true)
  })

  it('applies', async () => { await db.exec(M('carefind_20261020_shop_flow_fixes')) })

  it('a tracking update moves the order forward with history, a customer notice and the tracking row', async () => {
    const v = await vendorSetup(); const me = { sub: uid(), email: v.email }
    await track(me, v.order, 'accepted', 'Packing today')
    expect(await status(v.order)).toBe('accepted')
    expect(await one(`select changed_by, note from shop_order_status_history where order_id = $1 and to_status = 'accepted'`, [v.order])).toEqual({ changed_by: me.sub, note: 'Packing today' })
    expect((await one(`select count(*)::int c from notifications where recipient_id = $1 and type = 'shop_order_status'`, [v.customer])).c).toBe(1)
    expect(await all('select status, notes, created_by from shop_order_tracking_events where order_id = $1', [v.order])).toEqual([{ status: 'accepted', notes: 'Packing today', created_by: me.sub }])
  })

  it('an update on the current step (a location or note) is recorded without changing the status', async () => {
    const v = await vendorSetup(); const me = { sub: uid(), email: v.email }
    await track(me, v.order, 'accepted'); await track(me, v.order, 'in_transit'); await track(me, v.order, 'in_transit', 'Left Ikeja hub')
    expect(await status(v.order)).toBe('in_transit')
    expect((await one('select count(*)::int c from shop_order_tracking_events where order_id = $1', [v.order])).c).toBe(3)
    expect((await one(`select count(*)::int c from shop_order_status_history where order_id = $1 and to_status = 'in_transit'`, [v.order])).c).toBe(1)
  })

  it('ATTACK: tracking updates follow the vendor\'s fulfilment rules (no going back, no reviving a cancelled order), and leave nothing behind', async () => {
    const v = await vendorSetup(); const me = { sub: uid(), email: v.email }
    await track(me, v.order, 'in_transit')
    await expect(track(me, v.order, 'accepted')).rejects.toThrow(/not allowed/)
    // a cancelled order keeps payment_status 'paid' (it is refunded): the vendor must not be able to mark it delivered
    await db.query(`update shop_orders set status = 'cancelled' where id = $1`, [v.order])
    await expect(track(me, v.order, 'delivered')).rejects.toThrow(/not allowed/)
    expect(await status(v.order)).toBe('cancelled')
    expect((await one('select count(*)::int c from shop_order_tracking_events where order_id = $1', [v.order])).c).toBe(1)
    await expect(track({ sub: uid(), email: 'stranger@example.com' }, v.order, 'delivered')).rejects.toThrow(/Not authorized/)
  })

  it('a restock alerts each shopper watching the product once, with a link to it', async () => {
    const r = await restockable()
    await db.query('update products set stock = 5 where id = $1', [r.product])
    expect(await all('select type, message, link from notifications where recipient_id = $1', [r.watcher])).toEqual([{ type: 'stock_alert', message: 'Vitamin C is back in stock', link: `/shop/${r.ecom}` }])
    expect((await one('select is_active from shop_stock_alerts where user_id = $1', [r.watcher])).is_active).toBe(false)
    await db.query('update products set stock = 0 where id = $1', [r.product]); await db.query('update products set stock = 3 where id = $1', [r.product])
    expect((await one('select count(*)::int c from notifications where recipient_id = $1', [r.watcher])).c).toBe(1)
  })
})

// ---- shop flow review, part 2 (carefind_20261021_shop_expiry_and_delivery_quotes) ----------------------------------------------------------
describe('SD-1 / SD-3 / SD-7: unpaid orders expire, delivery is quoted before payment, order emails', () => {
  const pending = async ({ status = 'pending_payment', minutesAgo = 0, qty = 2 } = {}) => {
    const email = `q${++n}@example.com`; const vendor = await business(email); const customer = uid()
    const product = (await one(`insert into products (name, price, stock, sale_type) values ('Zinc', 100, 10, 'retail') returning id`)).id
    const ecom = (await one(`insert into ecommerce_products (business_id, product_id, ecommerce_price_kobo) values ($1,$2,10000) returning id`, [vendor, product])).id
    const o = await one(`insert into shop_orders (order_ref, customer_id, vendor_business_id, status, payment_status, subtotal_kobo, commission_kobo, fulfilment_kobo, total_kobo, delivery_email, customer_name, created_at)
                         values ($1,$2,$3,$4,'pending',$5,4000,60000,$6,'buyer@example.com','Ada', now() - make_interval(mins => $7)) returning id`, [ref('CF'), customer, vendor, status, qty * 10000, qty * 10000 + 60000, minutesAgo])
    await db.query('insert into shop_order_items (order_id, ecommerce_product_id, product_id, product_name, quantity, unit_price_kobo, line_total_kobo) values ($1,$2,$3,$4,$5,10000,$6)', [o.id, ecom, product, 'Zinc', qty, qty * 10000])
    await db.query('update products set stock = stock - $2 where id = $1', [product, qty])          // what create_shop_order reserved
    return { id: o.id, vendor, customer, product, email }
  }
  const intent = async (o, { minutesAgo = 0, status = 'pending' } = {}) => {
    const i = await one(`insert into payment_intents (reference, application, purpose, customer_id, business_id, entity_type, entity_id, expected_amount)
                         values ($1,'carefind','shop_order',$2,$3,'shop_order',$4,80000) returning id`, [ref('cf_shop'), o.customer, o.vendor, o.id])
    // backdating an attempt is test-only: the immutability guard is a trigger, so it is bypassed for this one update
    await db.exec('set session_replication_role = replica')
    try {
      await db.query(`update payment_intents set status = $2, created_at = now() - make_interval(mins => $3), verified_at = case when $2 = 'verified' then now() end where id = $1`, [i.id, status, minutesAgo])
    } finally { await db.exec('set session_replication_role = origin') }
  }
  const expire = () => as('service_role', null, () => one('select expire_unpaid_shop_orders(200) r')).then((x) => x.r)
  const order = (id) => one('select status, payment_status, total_kobo, delivery_kobo from shop_orders where id = $1', [id])
  const stock = async (product) => (await one('select stock from products where id = $1', [product])).stock
  const quote = (who, id, kobo) => as('authenticated', who, () => one('select quote_shop_order_delivery($1,$2)', [id, kobo]))

  beforeAll(async () => {
    await db.exec(`
      alter table public.shop_orders add column if not exists discount_kobo integer default 0, add column if not exists promo_code_id uuid;
      create table if not exists public.email_outbox (id uuid primary key default gen_random_uuid(), to_email text, from_email text, subject text, template_key text, payload jsonb, status text, next_retry_at timestamptz);
      -- the live inventory restore (the fixture's is a stub): put each line's quantity back
      create or replace function public.shop_restore_inventory_on_cancel(p_order_id uuid) returns void language sql as $$
        update public.products p set stock = p.stock + i.quantity from public.shop_order_items i where i.order_id = p_order_id and i.product_id = p.id $$;
      create function public.cleanup_pending_shop_orders() returns integer language sql as $$ select 0 $$;
    `)
    await db.exec(M('carefind_20260919_shop_orders_status_email_trigger'))
  })

  it('BEFORE: a vendor "quote" moves the order to payment without any delivery charge', async () => {
    const o = await pending({ status: 'delivery_quote_pending' })
    await as('authenticated', { sub: uid(), email: o.email }, () => one(`select update_shop_order_status($1,'pending_payment',null,'Delivery quoted ₦5000')`, [o.id]))
    expect(await order(o.id)).toMatchObject({ status: 'pending_payment', delivery_kobo: 0, total_kobo: 80000 })
  })

  it('applies', async () => { await db.exec(M('carefind_20261021_shop_expiry_and_delivery_quotes')) })

  it('the expiry is server-only', async () => {
    await expect(as('authenticated', { sub: uid() }, () => one('select expire_unpaid_shop_orders(10)'))).rejects.toThrow(/permission denied/)
  })

  it('an order abandoned at Paystack expires an hour after its last attempt: stock back, attempts closed, history, notice', async () => {
    const o = await pending({ minutesAgo: 120 }); await intent(o, { minutesAgo: 61 })
    const before = await stock(o.product)
    await expire()
    expect(await order(o.id)).toMatchObject({ status: 'cancelled', payment_status: 'failed' })
    expect(await stock(o.product)).toBe(before + 2)
    expect((await one(`select status from payment_intents where entity_id = $1`, [o.id])).status).toBe('expired')
    expect((await one(`select note from shop_order_status_history where order_id = $1 and to_status = 'cancelled'`, [o.id])).note).toMatch(/payment was not completed/)
    expect((await one(`select count(*)::int c from notifications where recipient_id = $1 and type = 'shop_order_cancelled'`, [o.customer])).c).toBe(1)
    // and only once
    const again = await stock(o.product); await expire()
    expect(await stock(o.product)).toBe(again)
  })

  it('keeps an order whose customer is still paying, one that was never sent to checkout (72h), and one being settled', async () => {
    const paying = await pending({ minutesAgo: 120 }); await intent(paying, { minutesAgo: 20 })
    const placed = await pending({ minutesAgo: 600 })                                  // no attempt yet: 72 hours
    const settling = await pending({ minutesAgo: 600 }); await intent(settling, { minutesAgo: 300, status: 'verified' })
    await expire()
    for (const o of [paying, placed, settling]) expect((await order(o.id)).status).toBe('pending_payment')
    const old = await pending({ minutesAgo: 73 * 60 })
    await expire()
    expect((await order(old.id)).status).toBe('cancelled')
  })

  it('an order waiting for a delivery quote expires after 7 days without one; a paid order is never touched', async () => {
    const waiting = await pending({ status: 'delivery_quote_pending', minutesAgo: 6 * 24 * 60 })
    const stale = await pending({ status: 'delivery_quote_pending', minutesAgo: 8 * 24 * 60 })
    const paid = await pending({ minutesAgo: 9 * 24 * 60 }); await db.query(`update shop_orders set status = 'paid', payment_status = 'paid' where id = $1`, [paid.id])
    await expire()
    expect((await order(waiting.id)).status).toBe('delivery_quote_pending')
    expect((await order(stale.id)).status).toBe('cancelled')
    expect((await order(paid.id)).status).toBe('paid')
  })

  it('the vendor quotes delivery: the amount joins the total, the order opens for payment, the customer is told', async () => {
    const o = await pending({ status: 'delivery_quote_pending' }); const me = { sub: uid(), email: o.email }
    await quote(me, o.id, 250000)
    expect(await order(o.id)).toMatchObject({ status: 'pending_payment', delivery_kobo: 250000, total_kobo: 80000 + 250000 })
    expect((await one(`select note from shop_order_status_history where order_id = $1 and to_status = 'pending_payment'`, [o.id])).note).toBe('Delivery quoted: ₦2,500.00')
    expect((await one(`select message from notifications where recipient_id = $1 and type = 'shop_delivery_quoted'`, [o.customer])).message).toBe(`Delivery for order ${(await one('select order_ref from shop_orders where id = $1', [o.id])).order_ref} is ₦2,500.00. Pay ₦3,300.00 to confirm your order.`)
  })

  it('a quote keeps a promo discount, and is refused for a stranger, a bad amount, twice, or through the old status shortcut', async () => {
    const o = await pending({ status: 'delivery_quote_pending' }); const me = { sub: uid(), email: o.email }
    await db.query('update shop_orders set discount_kobo = 10000, total_kobo = total_kobo - 10000 where id = $1', [o.id])
    await expect(quote({ sub: uid(), email: 'stranger@example.com' }, o.id, 1000)).rejects.toThrow(/Not authorized/)
    await expect(quote({ sub: o.customer, email: 'buyer@example.com' }, o.id, 1000)).rejects.toThrow(/Not authorized/)
    for (const bad of [0, -5, 100000001]) await expect(quote(me, o.id, bad), String(bad)).rejects.toThrow(/delivery quote must be/)
    await expect(as('authenticated', me, () => one(`select update_shop_order_status($1,'pending_payment',null,null)`, [o.id]))).rejects.toThrow(/not allowed/)
    await quote(me, o.id, 50000)
    expect(await order(o.id)).toMatchObject({ total_kobo: 80000 - 10000 + 50000, delivery_kobo: 50000 })
    await expect(quote(me, o.id, 60000)).rejects.toThrow(/not waiting for a delivery quote/)
  })

  it('a pickup order outside the approved cities is payable at once (nothing to quote); home delivery there waits for a quote', async () => {
    const vendor = await business(`p${++n}@example.com`); const customer = uid()
    const product = (await one(`insert into products (name, price, stock, sale_type) values ('Iron', 100, 50, 'retail') returning id`)).id
    const ecom = (await one(`insert into ecommerce_products (business_id, product_id, ecommerce_price_kobo) values ($1,$2,10000) returning id`, [vendor, product])).id
    const create = (pref) => as('authenticated', { sub: customer, email: 'c@example.com' }, () => one(
      `select create_shop_order($1,$2,$3::jsonb,20000,4000,50000,0,70000,'addr','Jalingo','Taraba','0801','c@example.com',null,$4,null,false,'Cust',$5,null) id`,
      [customer, vendor, JSON.stringify([{ ecommerce_product_id: ecom, quantity: 2 }]), pref, ref('cfpay')]))
    expect((await order((await create('pickup')).id)).status).toBe('pending_payment')
    expect((await order((await create('home')).id)).status).toBe('delivery_quote_pending')
    expect((await one(`select count(*)::int c from notifications where recipient_id = $1 and message like '%will quote delivery%'`, [customer])).c).toBe(1)
    expect((await one(`select count(*)::int c from staff_notifications where business_id = $1 and body like '%pay at pickup%'`, [vendor])).c).toBe(0)
  })
})

// ---- shop flow review, part 3 (carefind_20261022_shop_vendor_flow): the whole journey, CareFind purchase to CareHub payout --------------
describe('SV: an order from CareFind checkout to the vendor\'s CareHub wallet', () => {
  const live = read('../../../../../supabase/migrations/carehub_20260906_shop_delivery_tracking.sql')
  const fn = (name) => live.slice(live.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`), live.indexOf('$$;', live.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`)) + 3)
  const shop = async () => {
    const email = `sv${++n}@example.com`; const vendor = await business(email); const customer = uid()
    const product = (await one(`insert into products (name, price, stock, sale_type) values ('Amoxicillin', 100, 50, 'retail') returning id`)).id
    const ecom = (await one(`insert into ecommerce_products (business_id, product_id, ecommerce_price_kobo) values ($1,$2,10000) returning id`, [vendor, product])).id
    return { vendor, customer, product, ecom, seller: { sub: uid(), email }, buyer: { sub: customer, email: 'buyer@example.com' } }
  }
  const checkout = (s, pref = 'pickup') => as('authenticated', s.buyer, () => one(
    `select create_shop_order($1,$2,$3::jsonb,20000,4000,50000,0,70000,'12 Allen Ave','Lagos','Lagos','0801','buyer@example.com',null,$4,1,true,'Ada',$5,null) id`,
    [s.customer, s.vendor, JSON.stringify([{ ecommerce_product_id: s.ecom, quantity: 2 }]), pref, ref('cfpay')])).then((r) => r.id)
  // what /api/initiate-shop-payment records, then what the Paystack webhook / redirect verify settles
  const settle = async (reference, amount = 70000) => (await as('service_role', null, () => one('select settle_payment_intent($1,$2,$3,$4,$5) r', [reference, 'paystack', 'TX' + reference, amount, 'NGN']))).r
  const pay = async (s, orderId, amount = 70000) => {
    const reference = ref('cf_shop')
    await db.query(`insert into payment_intents (reference, application, purpose, customer_id, business_id, entity_type, entity_id, expected_amount) values ($1,'carefind','shop_order',$2,$3,'shop_order',$4,$5)`, [reference, s.customer, s.vendor, orderId, amount])
    return { ...(await settle(reference, amount)), reference }
  }
  const move = (s, orderId, to, note = null) => as('authenticated', s.seller, () => one('select update_shop_order_status($1,$2,null,$3)', [orderId, to, note]))
  const wallet = async (b) => (await one('select coalesce(held_balance,0)::int held, coalesce(available_balance,0)::int available from business_wallets where business_id = $1', [b])) || { held: 0, available: 0 }
  const release = () => as('service_role', null, () => one('select release_shop_vendor_credits(200) r')).then((x) => x.r)

  beforeAll(async () => {
    await db.exec(`
      alter table public.shop_order_tracking_events add column if not exists created_at timestamptz not null default now();
      create table if not exists public.shop_tracking_tokens (id uuid primary key default gen_random_uuid(), order_id uuid not null references public.shop_orders(id) on delete cascade,
        token text unique not null, expires_at timestamptz not null default (now() + interval '30 days'), created_at timestamptz not null default now());
      alter table public.shop_tracking_tokens enable row level security;
      create policy "shop_tracking_tokens_select" on public.shop_tracking_tokens for select to anon, authenticated using (true);
      create table if not exists public.shop_order_messages (id uuid primary key default gen_random_uuid(), order_id uuid, sender_id uuid, sender_role text, message text, created_at timestamptz default now());
    `)
    // the live token functions; gen_random_bytes needs pgcrypto, which this database does not have (like a search_path of public on Supabase)
    await db.exec(fn('generate_tracking_token'))
    await db.exec(fn('get_tracking_by_token'))
  })

  it('BEFORE: the vendor cannot create a tracking link, and anyone can list every order\'s tracking token', async () => {
    const s = await shop(); const id = await checkout(s)
    await expect(as('authenticated', s.seller, () => one('select generate_tracking_token($1) t', [id]))).rejects.toThrow(/Not authorized/)
    await db.query(`insert into shop_tracking_tokens (order_id, token) values ($1, $2)`, [id, `TRK-leak${n}`])
    expect((await as('anon', null, () => all('select token from shop_tracking_tokens'))).length).toBeGreaterThan(0)
  })

  it('applies', async () => { await db.exec(M('carefind_20261022_shop_vendor_flow')) })

  it('the whole journey: checkout, payment, the vendor told, fulfilment, the customer told, then the payout', async () => {
    const s = await shop()
    const stockBefore = (await one('select stock from products where id = $1', [s.product])).stock

    // 1. CareFind checkout: the order waits for payment, stock is reserved, the customer is told
    const id = await checkout(s)
    expect(await one('select status, payment_status, subtotal_kobo::int s, commission_kobo::int c, total_kobo::int t from shop_orders where id = $1', [id]))
      .toEqual({ status: 'pending_payment', payment_status: 'pending', s: 20000, c: 4000, t: 70000 })
    expect((await one('select stock from products where id = $1', [s.product])).stock).toBe(stockBefore - 2)
    expect((await one(`select link from notifications where recipient_id = $1 and type = 'shop_order_pending'`, [s.customer])).link).toBe(`/orders/${id}`)

    // 2. the vendor cannot start on an unpaid order
    await expect(move(s, id, 'accepted')).rejects.toThrow(/not allowed/)

    // 3. Paystack confirms: the order is paid and the vendor's share (subtotal - commission) is held
    const paid = await pay(s, id)
    expect(paid.outcome).toBe('settled')
    expect(await one('select status, payment_status from shop_orders where id = $1', [id])).toEqual({ status: 'paid', payment_status: 'paid' })
    expect(await one('select amount_kobo::int a, status from shop_vendor_credits where order_id = $1', [id])).toEqual({ a: 16000, status: 'held' })
    expect(await wallet(s.vendor)).toEqual({ held: 16000, available: 0 })
    // the redirect verify and the webhook both settle the same payment: the second changes nothing
    expect((await settle(paid.reference)).outcome).toBe('already_settled')
    expect(await wallet(s.vendor)).toEqual({ held: 16000, available: 0 })
    expect((await one('select count(*)::int c from staff_notifications where business_id = $1', [s.vendor])).c).toBe(0)   // the paid notice is an effect (API), not SQL

    // 4. CareHub: the vendor sees the order and moves it through fulfilment; a pickup order ends when the customer collects it
    expect((await as('authenticated', s.seller, () => all('select id from shop_orders where id = $1', [id]))).length).toBe(1)
    for (const to of ['accepted', 'processing', 'ready_for_pickup']) await move(s, id, to)
    await move(s, id, 'delivered', 'Collected by customer')
    expect((await all('select to_status from shop_order_status_history where order_id = $1 order by created_at, to_status', [id])).map((h) => h.to_status))
      .toEqual(expect.arrayContaining(['pending_payment', 'paid', 'accepted', 'processing', 'ready_for_pickup', 'delivered']))

    // every vendor notice opens this order in CareHub; every customer notice opens it in CareFind
    const vendorLinks = (await all('select link from staff_notifications where business_id = $1', [s.vendor])).map((r) => r.link)
    expect(vendorLinks.length).toBeGreaterThan(0)
    for (const link of vendorLinks) expect(link).toBe(`/dashboard/ecommerce/orders/${id}`)
    const customerLinks = (await all(`select link from notifications where recipient_id = $1 and type like 'shop_%'`, [s.customer])).map((r) => r.link)
    for (const link of customerLinks) expect(link).toBe(`/orders/${id}`)
    // (status emails go through production's reliable email system, which this suite does not model)

    // 5. the money waits out the return window, then becomes withdrawable
    await release()
    expect(await wallet(s.vendor)).toEqual({ held: 16000, available: 0 })
    await db.query(`update shop_order_status_history set created_at = now() - interval '30 days' where order_id = $1 and to_status = 'delivered'`, [id])
    await release()
    expect(await one('select status, released_kobo::int r from shop_vendor_credits where order_id = $1', [id])).toEqual({ status: 'released', r: 16000 })
    expect(await wallet(s.vendor)).toEqual({ held: 0, available: 16000 })
    expect((await one(`select count(*)::int c from business_wallet_transactions where business_id = $1 and type = 'shop_release'`, [s.vendor])).c).toBe(1)
  })

  it('ATTACK: a vendor cannot shortcut the flow by writing the order tables directly (backdated delivery, status, amounts, items)', async () => {
    const s = await shop(); const id = await checkout(s); await pay(s, id)
    const vendorTries = (sql, p) => as('authenticated', s.seller, () => db.query(sql, p))
    await expect(vendorTries(`insert into shop_order_status_history (order_id, from_status, to_status, created_at) values ($1,'paid','delivered', now() - interval '60 days')`, [id])).rejects.toThrow(/permission denied/)
    await expect(vendorTries(`update shop_orders set status = 'delivered' where id = $1`, [id])).rejects.toThrow(/permission denied/)
    await expect(vendorTries(`update shop_orders set subtotal_kobo = 9999999 where id = $1`, [id])).rejects.toThrow(/permission denied/)
    await expect(vendorTries(`insert into shop_order_items (order_id, product_name, quantity, unit_price_kobo, line_total_kobo) values ($1,'Extra',1,1,1)`, [id])).rejects.toThrow(/permission denied/)
    await expect(vendorTries(`update shop_payments set status = 'success' where order_id = $1`, [id])).rejects.toThrow(/permission denied/)
    await expect(vendorTries(`insert into shop_order_tracking_events (order_id, status) values ($1,'delivered')`, [id])).rejects.toThrow(/permission denied/)
    // nor can the customer mark their own order paid
    await expect(as('authenticated', s.buyer, () => db.query(`update shop_orders set payment_status = 'paid' where id = $1`, [id]))).rejects.toThrow(/permission denied/)
    expect(await one('select status from shop_orders where id = $1', [id])).toEqual({ status: 'paid' })
  })

  it('home delivery: the vendor records tracking, creates the public tracking link, and the link shows the journey to anyone holding it', async () => {
    const s = await shop(); const id = await checkout(s, 'home'); await pay(s, id)
    await as('authenticated', s.seller, () => one(`select add_tracking_event($1,'in_transit','Left the pharmacy','{"lat":6.6,"lng":3.35}'::jsonb)`, [id]))
    const token = (await as('authenticated', s.seller, () => one('select generate_tracking_token($1) t', [id]))).t
    expect(token).toMatch(/^TRK-[0-9a-f]{32}$/)
    expect((await as('authenticated', s.buyer, () => one('select generate_tracking_token($1) t', [id]))).t).toBe(token)   // the same link for both
    const page = (await as('anon', null, () => one('select get_tracking_by_token($1) p', [token]))).p
    expect(page).toMatchObject({ status: 'in_transit', tracking_events: [expect.objectContaining({ status: 'in_transit', notes: 'Left the pharmacy' })] })
    await expect(as('authenticated', { sub: uid(), email: 'stranger@example.com' }, () => one('select generate_tracking_token($1) t', [id]))).rejects.toThrow(/Not authorized/)
  })

  it('ATTACK: tracking tokens cannot be listed (each one opens an order\'s tracking notes and locations)', async () => {
    for (const role of ['anon', 'authenticated']) {
      await expect(as(role, { sub: uid() }, () => all('select token from shop_tracking_tokens')), role).rejects.toThrow(/permission denied/)
      await expect(as(role, { sub: uid() }, () => db.query(`insert into shop_tracking_tokens (order_id, token) select id, 'TRK-forged' from shop_orders limit 1`)), role).rejects.toThrow(/permission denied/)
    }
  })
})
