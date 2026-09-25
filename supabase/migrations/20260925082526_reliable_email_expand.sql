begin;

alter table public.email_outbox
  add column if not exists app text,
  add column if not exists event_key text,
  add column if not exists reply_to text,
  add column if not exists claim_token uuid,
  add column if not exists claimed_at timestamptz,
  add column if not exists claim_expires_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists bounced_at timestamptz,
  add column if not exists complained_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists dead_at timestamptz,
  add column if not exists quarantine_reason text,
  add column if not exists payload_schema_snapshot jsonb;

update public.email_outbox
set accepted_at = sent_at
where sent_at is not null
  and accepted_at is null;

create or replace function public.guard_email_outbox_quarantine()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.app is null or new.event_key is null then
    new.quarantine_reason := 'legacy_mapping_unproven';
    new.next_retry_at := 'infinity'::timestamptz;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_email_outbox_quarantine on public.email_outbox;

create trigger trg_email_outbox_quarantine
  before insert or update
  on public.email_outbox
  for each row
  execute function public.guard_email_outbox_quarantine();

update public.email_outbox
set quarantine_reason = 'legacy_mapping_unproven',
    next_retry_at = 'infinity'::timestamptz
where app is null
   or event_key is null;

create index if not exists idx_outbox_status
  on public.email_outbox (status, next_retry_at);

create index if not exists idx_outbox_claim_expires_at
  on public.email_outbox (claim_expires_at)
  where claim_expires_at is not null;

create index if not exists idx_outbox_provider_id
  on public.email_outbox (provider_id)
  where provider_id is not null;

alter table public.email_logs
  drop constraint if exists email_logs_outbox_id_fkey;

alter table public.email_logs
  add constraint email_logs_outbox_id_fkey
  foreign key (outbox_id)
  references public.email_outbox (id)
  on delete set null;

alter table public.email_outbox enable row level security;
alter table public.email_logs enable row level security;

commit;

