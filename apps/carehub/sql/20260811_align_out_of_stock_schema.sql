-- ============================================================================
-- 2026-08-11 — Align live out_of_stock (and requisition) schema with the app.
--
-- STATUS: APPLIED TO PRODUCTION 2026-08-11, on explicit user authorization.
-- RE-VERIFIED 2026-08-11 AFTER APPLYING (read from the live REST catalog):
--   * `create_requisition` RPC exists with the app's exact signature
--     (p_business_id, p_supplier_name, p_note, p_items); EXECUTE denied to
--     anon (42501), granted to authenticated — SECURITY INVOKER as written.
--   * `requisitions` exposes business_id, supplier_name, note, status,
--     created_at; `requisition_items` exposes requisition_id, product_name,
--     quantity, cost, unit — every column the RPC writes.
--   * `out_of_stock` exposes product_id, notes, created_by, fulfilled_at,
--     quantity_needed, target_price, supplier_notes.
--   * `out_of_stock.quantity_needed` is TEXT (typed filter probe accepts
--     `eq."20 packs"`).
--   * RLS: `requisition_items` INSERT is governed by the C19 via-parent
--     policy (anonymous junk-id write refused 42501); `requisitions`,
--     `out_of_stock`, `customer_requests` each carry their scoped policy.
--   The Demand flows were previously failing on PGRST202 (no RPC) — that
--   condition no longer exists.
--
-- WHY THIS EXISTS
-- ---------------
-- The live `out_of_stock` table was never created by the tracked migrations.
-- `20260801_customer_and_requisition_modules.sql` defines it with
-- `product_id, notes, created_by, fulfilled_at`; `20260805_requisition_lines_
-- normalized.sql` adds `quantity_needed text, target_price numeric,
-- supplier_notes text`. Both were applied to a database where a hand-rolled
-- `out_of_stock` already existed, so `CREATE TABLE IF NOT EXISTS` silently
-- no-oped and `ADD COLUMN IF NOT EXISTS` no-oped on the wrong-typed columns.
--
-- Verified live (2026-08-11): every insert from Demand.jsx fails with
--   PGRST204: Could not find the '<column>' column of 'out_of_stock'
-- because the app sends `product_id`, `notes`, `created_by` (and writes
-- `fulfilled_at` on fulfil) — none of which exist. The live table also has
-- `quantity_needed` as INTEGER while the migration defines `text` and the app
-- sends free text like "20 packs".
--
-- SCOPE OF THIS FILE
-- ------------------
-- 1. OUT_OF_STOCK: add the four missing columns, fix `quantity_needed` to
--    text. The table is empty live (verified), so the type change is
--    zero-risk. All statements idempotent.
-- 2. REQUISITION_ITEMS: the four normalized line columns already exist live;
--    add the FK (cleanup with parent) and the parent index if absent. The
--    live `requisitions` table already has `note/supplier_name/status/created_by`
--    — exactly what the app and the RPC write — so no column change there.
-- 3. `create_requisition()` — the atomic parent+lines RPC. It does NOT exist
--    live (verified: PGRST202), which is why "Save Requisition" has never
--    worked. The body mirrors `20260805_requisition_lines_normalized.sql`
--    (which was never applied); this file is the single point of apply, so
--    after this runs the older file can be marked applied without re-running.
--    SECURITY INVOKER with pinned search_path — the C15/C17 pattern, never
--    SECURITY DEFINER. RLS applies as the caller, so a caller can only create
--    a requisition (and its lines, via the parent-derived policy) inside
--    their own business.
--
-- Apply once via the Supabase SQL editor; every statement is idempotent.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Out-of-stock — add the missing columns, fix quantity_needed type
-- ---------------------------------------------------------------------------
alter table out_of_stock
  add column if not exists product_id uuid references products(id) on delete set null,
  add column if not exists notes text,
  add column if not exists created_by text,
  add column if not exists fulfilled_at timestamptz;

-- The live column is INTEGER (the app sends free text such as "20 packs",
-- and the tracked migration defines text). Safe: the table is empty.
alter table out_of_stock
  alter column quantity_needed type text using quantity_needed::text;


-- ---------------------------------------------------------------------------
-- 2. Requisition lines — FK + index (columns already live)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requisition_items_requisition_id_fkey'
      and conrelid = 'public.requisition_items'::regclass
  ) then
    alter table requisition_items
      add constraint requisition_items_requisition_id_fkey
      foreign key (requisition_id) references requisitions(id) on delete cascade;
  end if;
end $$;

create index if not exists requisition_items_requisition_id_idx
  on requisition_items(requisition_id);


-- ---------------------------------------------------------------------------
-- 3. create_requisition — atomic parent + lines, SECURITY INVOKER
-- ---------------------------------------------------------------------------
create or replace function public.create_requisition(
  p_business_id uuid,
  p_supplier_name text,
  p_note text default null,
  p_items jsonb default '[]'
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_requisition_id uuid;
  v_item jsonb;
begin
  insert into requisitions (business_id, supplier_name, note, status)
  values (p_business_id, p_supplier_name, p_note, 'draft')
  returning id into v_requisition_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    continue when coalesce(v_item->>'product_name', '') = '';
    insert into requisition_items (requisition_id, product_name, quantity, cost, unit)
    values (
      v_requisition_id,
      v_item->>'product_name',
      nullif(v_item->>'quantity', ''),
      nullif(v_item->>'cost', '')::numeric,
      coalesce(v_item->>'unit', 'unit')
    );
  end loop;

  return v_requisition_id;
end $$;

revoke execute on function public.create_requisition from public, anon;
grant execute on function public.create_requisition to authenticated;


-- ============================================================================
-- VERIFY AFTER APPLYING — re-read the live catalog, do not trust the DDL:
--
--   1. out_of_stock columns now complete:
--        select column_name from information_schema.columns
--        where table_name = 'out_of_stock' order by ordinal_position;
--      Expect id, business_id, product_id, product_name, notes, status,
--      created_by, created_at, fulfilled_at, quantity_needed (text),
--      target_price, supplier_notes.
--   2. quantity_needed is text (not integer):
--        select data_type from information_schema.columns
--        where table_name = 'out_of_stock' and column_name = 'quantity_needed';
--   3. requisition_items FK + index present:
--        select conname from pg_constraint
--        where conrelid = 'public.requisition_items'::regclass
--          and conname = 'requisition_items_requisition_id_fkey';
--        select indexname from pg_indexes
--        where tablename = 'requisition_items'
--          and indexname = 'requisition_items_requisition_id_idx';
--   4. RPC exists with the right shape (also re-read proacl — Supabase re-grants
--      EXECUTE to anon after creation, so the revoke above must have stuck):
--        select proname, prosecdef, proconfig, proacl from pg_proc
--        where proname = 'create_requisition';
--      Expect prosecdef = false (SECURITY INVOKER), search_path pinned, and
--      proacl granting only postgres | authenticated | service_role.
--   5. Behavioural probe (owner session, inside a rolled-back block):
--      select create_requisition(<own business id>, 'Test Supplier', 'note',
--        '[{"product_name":"Paracetamol","quantity":"10","cost":500,"unit":"pack"}]');
--      then read back requisitions + requisition_items and confirm the line is
--      attached; another business's id must be refused by RLS.
--   6. The Demand.jsx flows now work end-to-end: log an out-of-stock item
--      (with a quantity like "20 packs"), generate from inventory, fulfil it,
--      and save a requisition.
-- ============================================================================
