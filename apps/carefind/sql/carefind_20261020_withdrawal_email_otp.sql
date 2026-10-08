-- Email OTP for withdrawal-PIN step-up (Phase 16 candidate).
-- A 6-digit code is emailed to the confirmed account email; the API stores only
-- a hash and burns the row on first successful use. Changing an existing PIN
-- additionally requires the current PIN (closes F-32 in CareFind).

create table if not exists public.withdrawal_email_otps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  purpose text not null default 'withdrawal_pin',
  code_hash text not null,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  attempts integer not null default 0,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists withdrawal_email_otps_user_idx
  on public.withdrawal_email_otps (user_id, created_at desc);

alter table public.withdrawal_email_otps enable row level security;

revoke all on public.withdrawal_email_otps from public, anon, authenticated;
grant select, insert, update on public.withdrawal_email_otps to service_role;
