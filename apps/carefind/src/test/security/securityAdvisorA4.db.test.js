// @vitest-environment node
// carehub_20270204_security_advisor_a4 on PGlite (CODE_AUDIT A4). The functions start as live (bodies and grants read
// 2026-11-23), including the drift: anon holds EXECUTE directly, so `REVOKE ... FROM PUBLIC` never closed them.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.setConfig({ testTimeout: 60000, hookTimeout: 120000 })
const MIGRATION = readFileSync(fileURLToPath(new URL('../../../../../supabase/migrations/carehub_20270204_security_advisor_a4.sql', import.meta.url)), 'utf8')

const ALICE = '10000000-0000-4000-8000-000000000001'
const BOB = '10000000-0000-4000-8000-000000000002'
const ORDER = 'd0000000-0000-4000-8000-000000000001'
const EP1 = 'e0000000-0000-4000-8000-000000000001'
const EP2 = 'e0000000-0000-4000-8000-000000000002'

let db
// `check` runs as superuser after the role's statements, in the same (rolled-back) transaction.
async function as(who, sql, check) {
  await db.exec('begin')
  try {
    if (who === 'anon') await db.exec('set local role anon')
    else if (who === 'service') await db.exec('set local role service_role')
    else {
      await db.query('select set_config($1,$2,true)', ['request.jwt.claims', JSON.stringify({ sub: who, role: 'authenticated' })])
      await db.exec('set local role authenticated')
    }
    // Several statements: all but the last run as is, the last returns the rows.
    const parts = sql.split(/;\s*/).filter(Boolean)
    for (const part of parts.slice(0, -1)) await db.exec(part)
    const rows = (await db.query(parts.at(-1))).rows
    await db.exec('reset role')
    return { rows, checked: check ? (await db.query(check)).rows : undefined }
  } catch (e) {
    return { error: e.message, code: e.code }
  } finally {
    await db.exec('rollback')
  }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub','')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;

    create table ecommerce_products (id uuid primary key, category text, status text, is_restricted boolean default false);
    create table shop_order_items (order_id uuid, ecommerce_product_id uuid);
    create table shop_purchase_patterns (product_id_1 uuid, product_id_2 uuid, purchase_count integer, last_purchased_at timestamptz, primary key (product_id_1, product_id_2));
    create table shop_product_relationships (product_id uuid, related_product_id uuid, relationship_type text, strength numeric, is_manual boolean);
    create table shop_product_views (id uuid primary key default gen_random_uuid(), product_id uuid, user_id uuid, session_id text, viewed_at timestamptz default now());
    grant all on shop_product_views, shop_purchase_patterns, shop_product_relationships to anon, authenticated, service_role;
    alter table shop_product_views enable row level security;
    create policy shop_product_views_insert on shop_product_views for insert to authenticated with check ((user_id = auth.uid()) or (user_id is null));
    create policy shop_product_views_select on shop_product_views for select to authenticated using (true);

    -- Live bodies (2026-11-23).
    create function track_product_view(p_product_id uuid, p_user_id uuid default null, p_session_id text default null) returns void
      language plpgsql security definer set search_path to 'public' as $$
    begin insert into shop_product_views (product_id, user_id, session_id) values (p_product_id, p_user_id, p_session_id); end; $$;
    create function track_purchase_pattern(p_order_id uuid) returns void language plpgsql security definer set search_path to 'public' as $$
    declare v_items uuid[]; v_item1 uuid; v_item2 uuid; v_i integer; v_j integer;
    begin
      select array_agg(ecommerce_product_id) into v_items from shop_order_items where order_id = p_order_id;
      if v_items is null or array_length(v_items, 1) < 2 then return; end if;
      for v_i in 1..array_length(v_items, 1) loop
        for v_j in (v_i + 1)..array_length(v_items, 1) loop
          v_item1 := v_items[v_i]; v_item2 := v_items[v_j];
          if v_item1 > v_item2 then v_item1 := v_items[v_j]; v_item2 := v_items[v_i]; end if;
          insert into shop_purchase_patterns (product_id_1, product_id_2, purchase_count, last_purchased_at) values (v_item1, v_item2, 1, now())
          on conflict (product_id_1, product_id_2) do update set purchase_count = shop_purchase_patterns.purchase_count + 1, last_purchased_at = now();
        end loop;
      end loop;
    end; $$;
    create function auto_generate_recommendations(p_product_id uuid) returns void language plpgsql security definer set search_path to 'public' as $$
    begin insert into shop_product_relationships (product_id, related_product_id, relationship_type, strength, is_manual)
      select p_product_id, ep.id, 'related', 0.7, false from ecommerce_products ep where ep.id <> p_product_id limit 10; end; $$;

    -- The trigger function and its trigger (stand-in body; what matters is that it still fires).
    create table products (id uuid primary key, stock integer);
    create table restock_log (product_id uuid);
    create function notify_stock_alerts_on_restock() returns trigger language plpgsql security definer set search_path to 'public' as $$
    begin if coalesce(old.stock, 0) <= 0 and new.stock > 0 then insert into restock_log values (new.id); end if; return new; end; $$;
    create trigger trg_notify_stock_alerts after update of stock on products for each row execute function notify_stock_alerts_on_restock();
    grant select, update on products to authenticated;

    -- The three functions without a pinned search_path (live shapes).
    create table shop_order_receipts (id int);
    create function shop_order_receipts_guard() returns trigger language plpgsql as $$
    begin raise exception 'shop_order_receipts is append-only (attempted %)', tg_op using errcode = '42501'; end; $$;
    create trigger shop_order_receipts_guard before update or delete on shop_order_receipts for each row execute function shop_order_receipts_guard();
    create function plan_enforcement_started_at() returns timestamptz language sql immutable as $$ select '2026-10-27 20:44:26.396721+00'::timestamptz $$;
    create function create_shop_order(p_customer_id uuid, p_vendor_business_id uuid, p_items jsonb, p_subtotal_kobo integer, p_commission_kobo integer,
      p_fulfilment_kobo integer, p_delivery_kobo integer, p_total_kobo integer, p_delivery_address text, p_delivery_city text, p_delivery_state text,
      p_delivery_phone text, p_delivery_email text, p_delivery_instructions text, p_delivery_preference text, p_distance_km numeric,
      p_is_approved_city boolean, p_customer_name text, p_payment_reference text) returns uuid language sql as $$ select null::uuid $$;

    create table shop_orders (id uuid, total_kobo integer, commission_kobo integer);
    create function get_admin_shop_overview() returns jsonb language plpgsql security definer set search_path to 'public' as $$
    begin return jsonb_build_object('revenue_kobo', (select coalesce(sum(total_kobo), 0) from shop_orders)); end; $$;
    grant execute on function get_admin_shop_overview() to anon, authenticated;

    -- The drift: anon holds EXECUTE directly (as Supabase's default privileges give it).
    grant execute on function track_product_view(uuid, uuid, text), track_purchase_pattern(uuid), auto_generate_recommendations(uuid),
      notify_stock_alerts_on_restock() to anon, authenticated;

    insert into ecommerce_products values ('${EP1}', 'pain', 'Active', false), ('${EP2}', 'pain', 'Active', false);
    insert into shop_order_items values ('${ORDER}', '${EP1}'), ('${ORDER}', '${EP2}');
    insert into products values ('c0000000-0000-4000-8000-000000000001', 0);
    insert into shop_product_views (product_id, user_id) values ('${EP1}', '${ALICE}'), ('${EP2}', '${BOB}');
  `)
})

describe('before', () => {
  it('anyone could inflate "frequently bought together", and record a view under another customer', async () => {
    const r = await as('anon', `select track_purchase_pattern('${ORDER}'); select track_purchase_pattern('${ORDER}'); select purchase_count from shop_purchase_patterns`)
    expect(r.rows).toEqual([{ purchase_count: 2 }])
    expect((await as('anon', `select track_product_view('${EP1}', '${ALICE}')`, `select count(*)::int n from shop_product_views where user_id = '${ALICE}'`)).checked[0].n).toBe(2)
    expect((await as(BOB, `select count(*)::int n from shop_product_views where user_id = '${ALICE}'`)).rows[0].n).toBe(1)
  })
})

describe('after carehub_20270204_security_advisor_a4', () => {
  beforeAll(async () => { await db.exec(MIGRATION) })

  it('purchase patterns and auto recommendations: the server only', async () => {
    for (const who of ['anon', BOB]) {
      expect((await as(who, `select track_purchase_pattern('${ORDER}')`)).code, String(who)).toBe('42501')
      expect((await as(who, `select auto_generate_recommendations('${EP1}')`)).code, String(who)).toBe('42501')
    }
    expect((await as('service', `select track_purchase_pattern('${ORDER}'); select purchase_count from shop_purchase_patterns`)).rows).toEqual([{ purchase_count: 1 }])
  })

  it('a view is recorded under the caller\'s own id whatever id is passed; signed out, under none', async () => {
    const bob = await as(BOB, `select track_product_view('${EP1}', '${ALICE}', 's1'); select user_id from shop_product_views where session_id = 's1'`)
    expect(bob.rows).toEqual([{ user_id: BOB }])
    const anon = await as('anon', `select track_product_view('${EP1}', '${ALICE}', 's2')`)
    expect(anon.error).toBeUndefined()
    await db.exec(`select track_product_view('${EP1}', '${ALICE}', repeat('x', 500))`)
    expect((await db.query(`select length(session_id) n from shop_product_views where session_id like 'xxx%'`)).rows[0].n).toBe(200)
  })

  it('browsing history is private: a signed-in user reads only their own views', async () => {
    expect((await as(BOB, `select user_id from shop_product_views`)).rows.every((r) => r.user_id === BOB)).toBe(true)
    expect((await as(BOB, `select count(*)::int n from shop_product_views where user_id = '${ALICE}'`)).rows[0].n).toBe(0)
    expect((await as(ALICE, `select count(*)::int n from shop_product_views where user_id = '${ALICE}'`)).rows[0].n).toBeGreaterThan(0)
  })

  it('the restock trigger still fires for an ordinary user, although its function is no longer executable by them', async () => {
    const r = await as(BOB, `update products set stock = 5 returning id`, `select count(*)::int n from restock_log`)
    expect(r.checked).toEqual([{ n: 1 }])
    expect((await as(BOB, `select notify_stock_alerts_on_restock()`)).code).toBe('42501')
  })

  it('search_path pinned on the three functions; the append-only guard still guards', async () => {
    const rows = (await db.query(`select proname, proconfig from pg_proc where proname in ('create_shop_order','shop_order_receipts_guard','plan_enforcement_started_at') order by 1`)).rows
    expect(rows.map((r) => r.proconfig)).toEqual([['search_path=public, pg_temp'], ['search_path=public, pg_temp'], ['search_path=public, pg_temp']])
    await db.exec(`insert into shop_order_receipts values (1)`)
    await expect(db.exec(`delete from shop_order_receipts`)).rejects.toThrow(/append-only/)
  })

  it('marketplace revenue and commission totals: the admin server only', async () => {
    for (const who of ['anon', BOB]) expect((await as(who, `select get_admin_shop_overview()`)).code, String(who)).toBe('42501')
    expect((await as('service', `select get_admin_shop_overview() o`)).rows[0].o).toEqual({ revenue_kobo: 0 })
  })

  it('is idempotent', async () => {
    await db.exec(MIGRATION)
    expect((await as('anon', `select track_purchase_pattern('${ORDER}')`)).code).toBe('42501')
  })
})
