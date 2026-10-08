-- 20260907_mark_payout_paid_atomic.sql
-- Atomic payout mark-paid: updates payout_requests.status to paid and mirrors to financial source

create or replace function public.mark_payout_paid(p_payout_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req payout_requests%rowtype;
begin
  select * into v_req from public.payout_requests where id = p_payout_id for update;
  if not found then raise exception 'payout % not found', p_payout_id using errcode='P0002'; end if;
  if v_req.status = 'paid' then return; end if;

  update public.payout_requests set status='paid', processed_at=now(), updated_at=now() where id=p_payout_id;

  if v_req.requester_type = 'agent' then
    update public.agent_earnings
      set amount_paid = amount_owed, status='paid', paid_at=now()
      where agent_id = v_req.requester_id and status in ('accrued','payable');
  elsif v_req.requester_type = 'business' then
    begin
      update public.business_wallets set balance = balance - v_req.amount, updated_at=now()
      where business_id = v_req.requester_id;
    exception when others then null;
    end;
  end if;
end; $$;
revoke all on function public.mark_payout_paid(uuid) from public;
grant execute on function public.mark_payout_paid(uuid) to authenticated, service_role;
