-- 2026-08-05 — Demand module: normalized requisition lines + automation fields.
--
-- Three changes, all idempotent:
--
-- 1. REQUISITION LINES. Demand's requisition save never worked: `addRequisition()`
--    posted `items`/`total`/`notes` to the live `requisitions` table, which has
--    none of those columns (its text column is `note`, singular) — every save
--    failed with `42703 column "items" of relation "requisitions" does not exist`.
--    The lines belong in `requisition_items` (the table this project created for
--    exactly that, with RLS derived through the parent requisition). This adds
--    the line columns if missing, a real FK so a requisition's lines are cleaned
--    up with it, and an index for the parent lookup. `create_requisition()`
--    (below) inserts parent + lines atomically in one transaction, which
--    two client-issued inserts could not guarantee.
--
-- 2. OUT-OF-STOCK AUTOMATION FIELDS. The module now generates out-of-stock
--    entries straight from inventory (stock <= 0) with a quantity needed, an
--    optional target price and supplier notes. The table gets the three
--    columns to hold them. All nullable, so existing rows are untouched.
--
-- 3. `create_requisition()` — SECURITY INVOKER with pinned search_path (the
--    same shape as the atomic stock transfer/adjust RPCs). RLS applies as the
--    invoking user, so a caller can only create a requisition (and its lines,
--    via the parent-derived policy) inside their own business. Lines with an
--    empty product_name are skipped rather than stored.

alter table requisition_items
  add column if not exists product_name text,
  add column if not exists quantity text,
  add column if not exists cost numeric default 0,
  add column if not exists unit text default 'unit';

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

alter table out_of_stock
  add column if not exists quantity_needed text,
  add column if not exists target_price numeric,
  add column if not exists supplier_notes text;

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

-- Verify after applying:
--   1. \d requisition_items — four line columns present, FK + index present.
--   2. select proname, prosecdef, proconfig from pg_proc
--      where proname = 'create_requisition';
--      Expect security-invoker (prosecdef = false) with search_path pinned.
--   3. Behavioural probe (as an owner, inside a rolled-back block):
--      select create_requisition(<own business id>, 'Test Supplier', 'note',
--        '[{"product_name":"Paracetamol","quantity":"10","cost":500,"unit":"pack"}]');
--      then read back requisitions + requisition_items and confirm the line is
--      attached; another business's id must be refused by RLS.
