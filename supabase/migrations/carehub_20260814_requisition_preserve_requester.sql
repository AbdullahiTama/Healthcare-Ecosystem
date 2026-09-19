-- ============================================================================
-- 20260814 — Requisition: preserve the requester (created_by)
--
-- Problem: `requisitions.created_by` (text) existed but `create_requisition()`
-- never wrote it, so every requisition showed an empty "Raised by" column.
--
-- Fix: the RPC is SECURITY INVOKER, so `auth.uid()` resolves to the logged-in
-- staff member inside the function. Look up that staff row (same business) and
-- store `full_name` in `created_by` while creating the requisition.
--
-- The parent + lines insert stays atomic in the single function call. The
-- lookup is a plain read; RLS on `staff` still scopes it to the caller's own
-- business, and the function's own insert is tenant-checked by RLS on
-- `requisitions` (`business_id in current_business_ids()`).
--
-- VERIFY AFTER APPLYING:
--   select p.proissecdef... (not needed; security invoker is unchanged)
--   -- as any authenticated member of a business:
--   select create_requisition(<own business id>, 'Test Supplier', 'note',
--     '[{"product_name":"A","quantity":"2","cost":100,"unit":"unit"}]');
--   select created_by from requisitions order by created_at desc limit 1;
--     -- expected: the staff member's full_name (not null)
-- ============================================================================

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
  v_requester text;
begin
  select full_name into v_requester
  from staff
  where business_id = p_business_id
    and auth_user_id = auth.uid()
  limit 1;

  insert into requisitions (business_id, supplier_name, note, status, created_by)
  values (p_business_id, p_supplier_name, p_note, 'draft', v_requester)
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
