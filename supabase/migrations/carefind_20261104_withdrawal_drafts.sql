-- 2026-11-04 - server-backed pre-reservation withdrawal drafts (Phase 1). No money moves here.
create table if not exists public.withdrawal_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  app text not null check (app in ('carefind','carehub')),
  amount numeric not null check (amount > 0),
  unit text not null check (unit in ('coins','kobo')),
  destination_fp text not null,
  destination_mask text not null,
  purpose text not null default 'withdrawal',
  otp_issued_at timestamptz not null default now(),
  draft_expires_at timestamptz not null default now() + interval '10 minutes',
  voided_at timestamptz, void_reason text,
  created_at timestamptz not null default now()
);
create index if not exists withdrawal_drafts_live on public.withdrawal_drafts (user_id, purpose, draft_expires_at) where voided_at is null;
alter table public.withdrawal_drafts enable row level security;
revoke all on table public.withdrawal_drafts from public, anon, authenticated;
create or replace function public.create_withdrawal_draft(p_user_id uuid, p_app text, p_amount numeric, p_unit text, p_destination_fp text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if p_app not in ('carefind','carehub') then raise exception 'unknown app'; end if;
  if p_unit not in ('coins','kobo') then raise exception 'unknown unit'; end if;
  if exists (select 1 from public.withdrawal_drafts where user_id=p_user_id and purpose='withdrawal' and voided_at is null and draft_expires_at > now()) then
    return jsonb_build_object('ok', false, 'outcome', 'draft_active');
  end if;
  update public.withdrawal_drafts set voided_at=now(), void_reason='superseded' where user_id=p_user_id and purpose='withdrawal' and voided_at is null;
  insert into public.withdrawal_drafts (user_id, app, amount, unit, destination_fp, destination_mask)
  values (p_user_id, p_app, p_amount, p_unit, p_destination_fp, '••••' || right(p_destination_fp, 4))
  returning jsonb_build_object('ok', true, 'draft_id', id, 'draft_expires_at', draft_expires_at, 'otp_issued_at', otp_issued_at) into v;
  return v;
end; $$;
create or replace function public.void_withdrawal_draft(p_user_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.withdrawal_drafts set voided_at=now(), void_reason=p_reason
   where user_id=p_user_id and purpose='withdrawal' and voided_at is null;
end; $$;
revoke execute on function public.create_withdrawal_draft(uuid,text,numeric,text,text) from public, anon, authenticated;
grant execute on function public.create_withdrawal_draft(uuid,text,numeric,text,text) to service_role;
revoke execute on function public.void_withdrawal_draft(uuid,text) from public, anon, authenticated;
grant execute on function public.void_withdrawal_draft(uuid,text) to service_role;
