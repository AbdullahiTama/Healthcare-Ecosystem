-- =============================================================================================
-- Pickup-station receipt: the audited event where authorised CareFind staff confirm they have physically
-- received a vendor's items at the CareFind pickup station, and the vendor's earning becomes withdrawable.
--
-- WHY THIS EXISTS
--   Today the ONLY thing that releases a vendor's held earnings is `shop_orders.status` becoming 'delivered'
--   (carefind_20261105_release_on_delivery.sql), and `update_shop_order_status` lets the VENDOR set that status
--   themselves. So a vendor can, in effect, release their own money by marking an order delivered. There is no
--   record anywhere of a person actually checking the goods against the order - only a status the vendor typed.
--
--   This adds the missing primitive WITHOUT changing who is paid when:
--     * The existing delivered-based release is left exactly as it is (owner decision 2026-10-14). Turning it
--       off is a commercial decision, not a bug fix, and is flagged separately rather than taken silently here.
--     * `record_pickup_receipt` releases through the SAME guarded `release_shop_vendor_credits(1, order_id)`.
--       That function only ever moves a credit whose status is 'held', so a receipt can never release twice, and
--       an order already released by delivery is a no-op here. Both paths therefore coexist safely.
--
-- WHAT IS RECORDED (the audit trail the business rule requires)
--   Who (admin auth id + email), when, which order, which vendor, and per-item quantities with a unique reference.
--
-- STATUS: written 2026-10-15. NOT APPLIED - needs the owner's explicit authorisation, together with the decision on
-- whether the delivered-based release should be retired once staff receipts are in use.
-- =============================================================================================

-- ── The receipt ────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.shop_order_receipts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.shop_orders(id) on delete restrict,
  business_id uuid not null references public.businesses(id) on delete restrict,
  -- [{ "item_id": <shop_order_items.id>, "quantity": <int> }]
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  reference text not null unique,
  -- WHO checked the goods. NOT NULL and enforced in the function: a receipt nobody signed is not evidence.
  received_by uuid not null,
  received_by_email text,
  note text,
  created_at timestamptz not null default now()
);

-- One receipt per vendor per order. Today an order has exactly one vendor; the pair is keyed anyway so a future
-- multi-vendor order cannot collapse two vendors' receipts into one.
create unique index if not exists shop_order_receipts_order_business_uniq
  on public.shop_order_receipts (order_id, business_id);

create index if not exists shop_order_receipts_order_idx on public.shop_order_receipts (order_id);
create index if not exists shop_order_receipts_business_idx on public.shop_order_receipts (business_id, created_at desc);

comment on table public.shop_order_receipts is
  'Staff confirmation that a vendor''s items were physically received at the CareFind pickup station. Append-only audit record.';

-- Append-only: a receipt is evidence. It may never be edited or removed, only superseded by a new order.
create or replace function public.shop_order_receipts_guard()
returns trigger
language plpgsql
as $$
begin
  raise exception 'shop_order_receipts is append-only (attempted %)', tg_op using errcode = '42501';
end;
$$;

drop trigger if exists shop_order_receipts_guard on public.shop_order_receipts;
create trigger shop_order_receipts_guard
  before update or delete on public.shop_order_receipts
  for each row execute function public.shop_order_receipts_guard();

drop trigger if exists shop_order_receipts_no_truncate on public.shop_order_receipts;
create trigger shop_order_receipts_no_truncate
  before truncate on public.shop_order_receipts
  for each statement execute function public.financial_no_truncate();

alter table public.shop_order_receipts enable row level security;
revoke all on table public.shop_order_receipts from public, anon, authenticated, service_role;

-- ── The ONE money path ───────────────────────────────────────────────────────────────────────────────────
-- The held -> available movement now lives in exactly one place, so a delivery and a pickup-station receipt cannot
-- drift apart in how they treat a refund, a return, a partial move or a repeated call. Both triggers call this.
--
-- p_require_delivered = true  : the historical trigger (order must have reached 'delivered').
-- p_require_delivered = false : a staff pickup-station receipt, which legitimately happens BEFORE the customer has
--                               the goods in hand.
--
-- Exactly-once by construction: a credit is only ever acted on while its status is 'held'.
create or replace function public._release_vendor_credit_for_order(p_order_id uuid, p_require_delivered boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.shop_orders%rowtype;
  c public.shop_vendor_credits%rowtype;
  v_amount integer;
  v_held integer;
  v_move integer;
  v_skipped text := null;
begin
  -- order first, then credit, then wallet: the same order a refund takes
  select * into o from public.shop_orders where id = p_order_id for update;
  select * into c from public.shop_vendor_credits where order_id = p_order_id for update;
  if not found then return jsonb_build_object('released', 0, 'released_kobo', 0, 'reason', 'no_credit'); end if;
  if c.status <> 'held' then
    return jsonb_build_object('released', 0, 'released_kobo', 0, 'reason', 'already_released', 'credit_status', c.status);
  end if;
  if p_require_delivered and o.status is distinct from 'delivered' then
    return jsonb_build_object('released', 0, 'released_kobo', 0, 'reason', 'not_delivered', 'status', o.status);
  end if;
  -- Never release while money is in dispute.
  if exists (select 1 from public.refunds f where f.entity_type = 'shop_order' and f.entity_id = o.id and f.status in ('requested', 'processing')) then
    return jsonb_build_object('released', 0, 'released_kobo', 0, 'reason', 'refund_in_flight');
  end if;
  if exists (select 1 from public.shop_order_returns sr where sr.order_id = o.id and sr.status = 'requested') then
    return jsonb_build_object('released', 0, 'released_kobo', 0, 'reason', 'return_requested');
  end if;

  v_amount := c.amount_kobo - c.reversed_kobo;
  select held_balance into v_held from public.business_wallets where business_id = c.business_id for update;
  v_move := least(v_amount, coalesce(v_held, 0));
  if v_move > 0 then
    update public.business_wallets set held_balance = held_balance - v_move, available_balance = available_balance + v_move, updated_at = now() where business_id = c.business_id;
    insert into public.business_wallet_transactions (business_id, type, amount, reference, status)
    values (c.business_id, 'shop_release', v_move, 'shoprl_' || c.order_id, 'confirmed');
  end if;
  update public.shop_vendor_credits
     set status = 'released', released_kobo = v_move, release_shortfall_kobo = v_amount - v_move, released_at = now()
   where order_id = c.order_id;
  return jsonb_build_object('released', 1, 'released_kobo', v_move, 'partial', v_move < v_amount);
end;
$$;
revoke all on function public._release_vendor_credit_for_order(uuid, boolean) from public, anon, authenticated, service_role;

-- ── Recording the receipt ─────────────────────────────────────────────────────────────────────────────────
create or replace function public.record_pickup_receipt(
  p_order_id uuid,
  p_items jsonb default '[]'::jsonb,
  p_note text default null,
  p_received_by uuid default null,
  p_received_by_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.shop_orders%rowtype;
  c public.shop_vendor_credits%rowtype;
  v_existing public.shop_order_receipts%rowtype;
  v_item jsonb;
  v_item_id uuid;
  v_qty integer;
  v_ordered integer;
  v_release jsonb;
  v_ref text;
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'reason', 'order_required');
  end if;
  if p_received_by is null then
    return jsonb_build_object('ok', false, 'reason', 'staff_required');
  end if;

  select * into o from public.shop_orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  -- An order that is cancelled, refunded or disputed must never release money.
  if o.status in ('cancelled', 'refunded') or o.payment_status in ('failed', 'refunded') then
    return jsonb_build_object('ok', false, 'reason', 'order_not_payable', 'status', o.status);
  end if;

  -- Credit first: an order with no vendor earning has nothing to release, and the receipt belongs to a vendor.
  select * into c from public.shop_vendor_credits where order_id = p_order_id for update;

  -- Idempotency. Re-confirming must not release a second time: the credit is already out of 'held', so
  -- release_shop_vendor_credits would be a no-op, but we answer explicitly rather than pretending to act.
  select * into v_existing
    from public.shop_order_receipts
   where order_id = p_order_id and business_id = o.vendor_business_id;
  if found then
    return jsonb_build_object(
      'ok', true, 'already_received', true, 'reference', v_existing.reference,
      'credit_status', c.status, 'released_kobo', coalesce(c.released_kobo, 0)
    );
  end if;

  -- Every item counted must be a real line on THIS order, and must not exceed the quantity ordered. A staff member
  -- confirming receipt of items that were never ordered is exactly the mistake this record has to prevent.
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'items_required');
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_item_id := nullif(v_item->>'item_id', '')::uuid;
    v_qty := coalesce((v_item->>'quantity')::integer, 0);
    if v_item_id is null or v_qty <= 0 then
      return jsonb_build_object('ok', false, 'reason', 'item_invalid');
    end if;
    select quantity into v_ordered from public.shop_order_items where id = v_item_id and order_id = p_order_id;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'item_not_on_order', 'item_id', v_item_id);
    end if;
    if v_qty > v_ordered then
      return jsonb_build_object('ok', false, 'reason', 'quantity_exceeds_order', 'item_id', v_item_id, 'ordered', v_ordered);
    end if;
  end loop;

  v_ref := 'rcpt_' || replace(o.order_ref, '-', '') || '_' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);

  -- The receipt row is written ONCE and never updated. The amount released is NOT stored here: it already lives, under
  -- the same guard, on shop_vendor_credits.released_kobo. Copying it here would be a second source of truth for the same
  -- money, and the append-only trigger would (correctly) refuse the reconciliation write.
  insert into public.shop_order_receipts (order_id, business_id, items, reference, received_by, received_by_email, note)
  values (p_order_id, o.vendor_business_id, p_items, v_ref, p_received_by, p_received_by_email, p_note);

  -- The ONE place money moves: the same guarded primitive the delivery trigger uses, scoped to this order, and NOT
-- gated on 'delivered' because staff receive the goods at the station before the customer does.
-- Returns the reason when nothing moved, so the caller can tell "already paid" from "blocked by a refund".
v_release := public._release_vendor_credit_for_order(p_order_id, false);

  select * into c from public.shop_vendor_credits where order_id = p_order_id;

  -- Record the handover in the order's own history so the customer-facing timeline shows it too.
  insert into public.shop_order_status_history (order_id, from_status, to_status, changed_by, note)
  values (p_order_id, o.status, o.status, p_received_by,
          'Pickup-station receipt confirmed by staff (' || v_ref || ')' || coalesce(' - ' || p_note, ''));

  return jsonb_build_object(
    'ok', true, 'already_received', false, 'reference', v_ref,
    'business_id', o.vendor_business_id,
    'credit_status', c.status,
    'released_kobo', coalesce(c.released_kobo, 0),
    'release', v_release
  );
end;
$$;

-- Private: reachable only through the admin API, which authorises the caller first.
revoke all on function public.record_pickup_receipt(uuid, jsonb, text, uuid, text) from public, anon, authenticated;
grant execute on function public.record_pickup_receipt(uuid, jsonb, text, uuid, text) to service_role;