import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
// Shared PGlite fixture for the debts migration tests: the live auth helpers, current_business_ids(),
// is_business_owner(), is_platform_admin(), pos_actor(), stamp_recorded_by() / keep_recorded_by() (read live
// 2026-11-10, unchanged 2026-11-14) and one business with an Owner, a Manager (may delete) and a Cashier, plus the
// owner of another business.
export const BIZ = 'a0000000-0000-4000-8000-000000000001'
export const OTHER = 'b0000000-0000-4000-8000-000000000001'
export const OWNER = 'owner@pharm.ng', MANAGER = 'manager@pharm.ng', CASHIER = 'cashier@pharm.ng', STRANGER = 'owner@other.ng'
export const UID = { [OWNER]: '10000000-0000-4000-8000-000000000001', [MANAGER]: '10000000-0000-4000-8000-000000000002', [CASHIER]: '10000000-0000-4000-8000-000000000003', [STRANGER]: '10000000-0000-4000-8000-000000000004' }
export const D = (n) => 'd0000000-0000-4000-8000-00000000000' + n
export const C = (n) => 'c0000000-0000-4000-8000-00000000000' + n

export const LIVE_HELPERS_SQL = `
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'sub','')::uuid $$;
    create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true),'')::jsonb ->> 'email' $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create table businesses (id uuid primary key, name text, email text, owner text, owner_name text, parent_business_id uuid, branch_depth_limit integer default 3, is_platform_admin boolean default false);
    create table staff (id uuid primary key default gen_random_uuid(), business_id uuid, full_name text, email text, role text, status text default 'active', auth_user_id uuid);
    create table roles (id uuid primary key default gen_random_uuid(), business_id uuid, name text, permissions jsonb default '{}');
    insert into businesses (id, name, email, owner_name) values ('${BIZ}', 'Pharm', '${OWNER}', 'Tama'), ('${OTHER}', 'Other', '${STRANGER}', 'Zed');
    insert into staff (business_id, full_name, email, role) values ('${BIZ}', 'Musa', '${MANAGER}', 'Manager'), ('${BIZ}', 'Bisi', '${CASHIER}', 'Cashier');
    insert into roles (business_id, name, permissions) values ('${BIZ}', 'Manager', '{"canDelete": true}'), ('${BIZ}', 'Cashier', '{}');

    CREATE OR REPLACE FUNCTION public.current_business_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
      WITH RECURSIVE visible AS (
        SELECT b.id, b.parent_business_id, b.branch_depth_limit, 0 AS depth FROM businesses b WHERE lower(b.email) = lower(auth.email())
        UNION ALL
        SELECT child.id, child.parent_business_id, child.branch_depth_limit, visible.depth + 1
        FROM businesses child INNER JOIN visible ON child.parent_business_id = visible.id WHERE visible.depth < visible.branch_depth_limit
      )
      SELECT id FROM visible
      UNION
      SELECT b.id FROM businesses b INNER JOIN staff s ON s.business_id = b.id WHERE lower(s.email) = lower(auth.email()) AND s.status = 'active'
    $function$;
    CREATE OR REPLACE FUNCTION public.is_business_owner(bid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
      WITH RECURSIVE ancestry AS (
        SELECT b.id, b.parent_business_id, b.email, 0 AS depth FROM public.businesses b WHERE b.id = bid
        UNION ALL
        SELECT p.id, p.parent_business_id, p.email, a.depth + 1 FROM public.businesses p JOIN ancestry a ON p.id = a.parent_business_id WHERE a.depth < 10
      )
      SELECT auth.uid() IS NOT NULL
         AND bid IN (SELECT public.current_business_ids())
         AND (
           EXISTS (SELECT 1 FROM ancestry a WHERE lower(a.email) = lower(auth.email()))
           OR EXISTS (SELECT 1 FROM public.staff s WHERE s.business_id = bid AND s.status = 'active' AND s.role = 'Owner' AND lower(s.email) = lower(auth.email()))
         )
    $function$;
    REVOKE ALL ON FUNCTION public.is_business_owner(uuid) FROM PUBLIC, anon, authenticated;
    CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
      SELECT COALESCE((SELECT is_platform_admin FROM businesses WHERE lower(email) = lower(auth.email())), false)
    $function$;
    CREATE OR REPLACE FUNCTION public.pos_actor(p_business_id uuid) RETURNS TABLE(user_id uuid, staff_id uuid, staff_name text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
    DECLARE
      v_uid uuid := auth.uid();
      v_email text := lower(auth.email());
    BEGIN
      IF v_uid IS NULL OR p_business_id IS NULL OR p_business_id NOT IN (SELECT public.current_business_ids()) THEN RETURN; END IF;
      RETURN QUERY
        WITH RECURSIVE up(id, parent_business_id, depth) AS (
          SELECT b.id, b.parent_business_id, 0 FROM public.businesses b WHERE b.id = p_business_id
          UNION
          SELECT p.id, p.parent_business_id, up.depth + 1 FROM public.businesses p JOIN up ON p.id = up.parent_business_id WHERE up.depth < 10
        )
        SELECT v_uid, s.id, COALESCE(NULLIF(trim(s.full_name), ''), s.email)
          FROM up JOIN public.staff s ON s.business_id = up.id
         WHERE s.status = 'active' AND (s.auth_user_id = v_uid OR lower(s.email) = v_email)
         ORDER BY up.depth, (s.auth_user_id = v_uid) DESC NULLS LAST LIMIT 1;
      IF FOUND THEN RETURN; END IF;
      RETURN QUERY
        WITH RECURSIVE up(id, parent_business_id, depth) AS (
          SELECT b.id, b.parent_business_id, 0 FROM public.businesses b WHERE b.id = p_business_id
          UNION
          SELECT p.id, p.parent_business_id, up.depth + 1 FROM public.businesses p JOIN up ON p.id = up.parent_business_id WHERE up.depth < 10
        )
        SELECT v_uid, NULL::uuid, COALESCE(NULLIF(trim(o.owner_name), ''), NULLIF(trim(o.owner), ''), 'Owner')
          FROM up JOIN public.businesses o ON o.id = up.id WHERE lower(o.email) = v_email ORDER BY up.depth LIMIT 1;
    END $function$;
    CREATE OR REPLACE FUNCTION public.stamp_recorded_by() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
    DECLARE
      v_actor record;
    BEGIN
      IF auth.uid() IS NULL THEN RETURN NEW; END IF;
      NEW.recorded_by := auth.uid();
      NEW.recorded_by_staff_id := NULL;
      NEW.recorded_by_name := NULL;
      SELECT a.staff_id, a.staff_name INTO v_actor FROM public.pos_actor(NEW.business_id) a LIMIT 1;
      IF FOUND THEN
        NEW.recorded_by_staff_id := v_actor.staff_id;
        NEW.recorded_by_name := v_actor.staff_name;
      END IF;
      RETURN NEW;
    END $function$;
    CREATE OR REPLACE FUNCTION public.keep_recorded_by() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $function$
    BEGIN
      NEW.recorded_by := OLD.recorded_by;
      NEW.recorded_by_staff_id := OLD.recorded_by_staff_id;
      NEW.recorded_by_name := OLD.recorded_by_name;
      RETURN NEW;
    END $function$;
`

// ── The debts database as live after carehub_20270117 (shared by the debts migration tests) ──────────────────────
export const read = (name) => readFileSync(fileURLToPath(new URL('../../../../../supabase/migrations/' + name, import.meta.url)), 'utf8')
export const MIGRATION = read('carehub_20270117_debt_and_supplier_accounts.sql')
const SUPPLIER_PAYMENTS = read('carehub_20261212_supplier_payments.sql')
const BULK_DELETE = read('carehub_20270113_debt_bulk_delete.sql')
const MEMBER_CAN_DELETE = read('carehub_20270112_expense_bulk_delete.sql').match(/create or replace function public\.member_can_delete[\s\S]*?\$\$;\nrevoke[^\n]*\n/)[0]

// record_sale_payment and purchases_guard_direct_write exactly as live on 2026-11-14.
const LIVE_SALES_SQL = `
CREATE OR REPLACE FUNCTION public.record_sale_payment(p_sale_id uuid, p_amount numeric, p_method text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_actor record;
  v_shift uuid;
  v_paid numeric;
  v_outstanding numeric;
  v_applied numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF p_method IS NULL OR p_method NOT IN ('Cash', 'Transfer', 'POS') THEN
    RAISE EXCEPTION 'Payment method must be Cash, Transfer or POS' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be more than zero' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.business_id NOT IN (SELECT public.current_business_ids()) THEN
    RAISE EXCEPTION 'Sale not found' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_sale.is_on_hold, false) OR (v_sale.status IS NOT NULL AND v_sale.status <> 'completed') THEN
    RAISE EXCEPTION 'Payments can only be recorded against a completed sale' USING ERRCODE = '22023';
  END IF;
  v_paid := least(COALESCE(v_sale.amount_paid, 0), COALESCE(v_sale.total, 0));
  v_outstanding := greatest(COALESCE(v_sale.total, 0) - v_paid, 0);
  IF v_outstanding <= 0 THEN RAISE EXCEPTION 'Nothing is outstanding on this sale' USING ERRCODE = '22023'; END IF;
  v_applied := least(round(p_amount, 2), v_outstanding);
  SELECT * INTO v_actor FROM public.pos_actor(v_sale.business_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'You are not an active member of this business' USING ERRCODE = '42501'; END IF;
  SELECT sh.id INTO v_shift FROM public.pos_shifts sh
   WHERE sh.business_id = v_sale.business_id AND sh.opened_by = auth.uid() AND sh.closed_at IS NULL LIMIT 1;
  INSERT INTO public.sale_payments (business_id, sale_id, kind, method, amount, received_by, staff_id, staff_name, shift_id)
  VALUES (v_sale.business_id, v_sale.id, 'collection', p_method, v_applied, auth.uid(), v_actor.staff_id, v_actor.staff_name, v_shift);
  UPDATE public.sales SET amount_paid = v_paid + v_applied, balance = v_outstanding - v_applied, is_credit = (v_outstanding - v_applied) > 0
   WHERE id = v_sale.id;
  UPDATE public.debts SET amount_paid = v_paid + v_applied, balance = v_outstanding - v_applied,
         status = CASE WHEN v_outstanding - v_applied <= 0 THEN 'paid' ELSE 'pending' END
   WHERE business_id = v_sale.business_id AND source = 'credit_sale' AND source_ref = v_sale.txn_no AND status IS DISTINCT FROM 'paid';
  RETURN jsonb_build_object('sale_id', v_sale.id, 'applied', v_applied, 'amount_paid', v_paid + v_applied, 'balance', v_outstanding - v_applied);
END $function$;
CREATE OR REPLACE FUNCTION public.purchases_guard_direct_write() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'Purchases are changed with Edit purchase, which keeps stock, payments and debts in step.' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $function$;
create trigger purchases_guard_direct_write before delete or update on purchases for each row execute function purchases_guard_direct_write();
`

export const P = (n) => 'e0000000-0000-4000-8000-00000000000' + n
export const S = (n) => 'f0000000-0000-4000-8000-00000000000' + n

/** A fresh PGlite with the live helpers, the tables, live-like data from before carehub_20270117, and that migration. */
export async function createDebtsDb() {
  const db = new PGlite()
  await db.exec(LIVE_HELPERS_SQL)
  await db.exec(`
    create table clients (id uuid primary key default gen_random_uuid(), business_id uuid, full_name text, phone text, created_at timestamp default now());
    create unique index clients_phone_unique_per_business on clients (business_id, regexp_replace(phone, '[^0-9]', '', 'g')) where phone is not null and btrim(phone) <> '';
    alter table clients enable row level security;
    create policy "clients of own business" on clients for all using ((business_id in (select current_business_ids())) or is_platform_admin());
    create table debts (id uuid primary key default gen_random_uuid(), business_id uuid, direction text, party_name text, amount numeric default 0,
      amount_paid numeric default 0, balance numeric default 0, due_date text, status text default 'pending', description text,
      created_at timestamp default now(), source text default 'manual', source_ref text default '', client_id uuid references clients(id) on delete set null,
      recorded_by uuid, recorded_by_staff_id uuid, recorded_by_name text);
    create trigger stamp_recorded_by_ins before insert on debts for each row execute function stamp_recorded_by();
    create trigger stamp_recorded_by_upd before update on debts for each row execute function keep_recorded_by();
    alter table debts enable row level security;
    create policy "debts of own business" on debts for all using ((business_id in (select current_business_ids())) or is_platform_admin());
    create table purchases (id uuid primary key default gen_random_uuid(), business_id uuid, supplier_name text, product_name text, quantity integer default 0,
      total_cost numeric default 0, amount_paid numeric default 0, balance numeric default 0, supply_date text, due_date text, status text default 'pending',
      notes text, created_at timestamp default now(), items jsonb);
    alter table purchases enable row level security;
    create policy "purchases of own business" on purchases for all using ((business_id in (select current_business_ids())) or is_platform_admin());
    create table sales (id uuid primary key default gen_random_uuid(), business_id uuid, txn_no text, client_name text, client_id uuid, total numeric,
      amount_paid numeric, balance numeric, is_credit boolean, is_on_hold boolean default false, status text, created_at timestamp default now(), deleted_at timestamptz);
    alter table sales enable row level security;
    create policy "sales of own business" on sales for all using (business_id in (select current_business_ids()));
    create table sale_payments (id uuid primary key default gen_random_uuid(), business_id uuid, sale_id uuid, kind text, method text, amount numeric,
      received_at timestamptz default now(), received_by uuid, staff_id uuid, staff_name text, shift_id uuid, note text, backfilled boolean default false);
    create table pos_shifts (id uuid primary key default gen_random_uuid(), business_id uuid, opened_by uuid, closed_at timestamptz);
    grant all on debts, clients, purchases, sales to anon, authenticated, service_role;
    grant select on sale_payments to authenticated;
    create table audit_log (id uuid primary key default gen_random_uuid(), actor_id uuid, actor_type text default 'staff', branch_id uuid, action text,
      target_type text, target_id uuid, metadata jsonb default '{}', created_at timestamptz default now());
  `)
  await db.exec(SUPPLIER_PAYMENTS)
  await db.exec(LIVE_SALES_SQL)
  await db.exec(MEMBER_CAN_DELETE)
  await db.exec(BULK_DELETE)
  // Live-like data from before the migration: a hand-recorded debt part paid, a credit sale and its debt, purchases.
  await db.exec(`
    insert into clients (id, business_id, full_name, phone, created_at) values
      ('${C(1)}', '${BIZ}', 'Ada Obi', '0803 111 2222', '2026-01-01'), ('${C(2)}', '${BIZ}', 'Ben', null, '2026-01-02'),
      ('${C(3)}', '${BIZ}', 'Chi', null, '2026-01-03'), ('${C(4)}', '${BIZ}', 'chi ', null, '2026-01-04');
    insert into debts (id, business_id, direction, party_name, amount, amount_paid, balance, status, description, source, source_ref, client_id, created_at) values
      ('${D(1)}', '${BIZ}', 'owes_us', 'Ada Obi', 5000, 1000, 4000, 'pending', 'Borrowed cash', 'manual', '', '${C(1)}', '2026-03-01'),
      ('${D(2)}', '${BIZ}', 'we_owe', 'Emzor Ltd', 7000, 0, 7000, 'pending', 'Opening balance', 'manual', '', null, '2026-02-01'),
      ('${D(3)}', '${BIZ}', 'owes_us', 'Ben', 3000, 0, 3000, 'pending', 'Credit sale', 'credit_sale', 'TXN-1', '${C(2)}', '2026-03-02'),
      ('${D(4)}', '${BIZ}', 'we_owe', 'Emzor Ltd', 10000, 0, 10000, 'pending', 'Purchase', 'purchase', '${P(1)}', null, '2026-01-10'),
      ('${D(9)}', '${OTHER}', 'owes_us', 'X', 100, 0, 100, 'pending', null, 'manual', '', null, '2026-01-01');
    insert into purchases (id, business_id, supplier_name, product_name, total_cost, amount_paid, balance, status, created_at) values
      ('${P(1)}', '${BIZ}', 'Emzor Ltd', 'Paracetamol', 10000, 0, 10000, 'pending', '2026-01-10'),
      ('${P(2)}', '${BIZ}', ' emzor ltd', 'Amoxicillin', 4000, 1000, 3000, 'partial', '2026-03-05'),
      ('${P(3)}', '${BIZ}', 'Fidson', 'ORS', 2000, 2000, 0, 'paid', '2026-03-06');
    insert into sales (id, business_id, txn_no, client_name, client_id, total, amount_paid, balance, is_credit, status, created_at) values
      ('${S(1)}', '${BIZ}', 'TXN-1', 'Ben', '${C(2)}', 3000, 0, 3000, true, 'completed', '2026-03-02'),
      ('${S(2)}', '${BIZ}', 'TXN-2', 'Ben', '${C(2)}', 2000, 500, 1500, true, 'completed', '2026-03-04'),
      ('${S(3)}', '${OTHER}', 'TXN-9', 'X', null, 900, 0, 900, true, 'completed', '2026-03-04');
  `)
  await db.exec(MIGRATION)
  return db
}
