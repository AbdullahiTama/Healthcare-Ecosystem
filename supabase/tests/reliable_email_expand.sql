begin;

select plan(24);

insert into public.email_outbox (
  id,
  to_email,
  from_email,
  subject,
  template_key,
  payload,
  status,
  next_retry_at
)
values
  (
    '00000000-0000-0000-0000-000000000101'::uuid,
    'legacy-pending@example.invalid',
    'legacy-pending@example.invalid',
    'legacy pending fixture',
    'legacy_pending_fixture',
    '{}'::jsonb,
    'pending',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000102'::uuid,
    'legacy-sent@example.invalid',
    'legacy-sent@example.invalid',
    'legacy sent fixture',
    'legacy_sent_fixture',
    '{}'::jsonb,
    'sent',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000103'::uuid,
    'legacy-failed@example.invalid',
    'legacy-failed@example.invalid',
    'legacy failed fixture',
    'legacy_failed_fixture',
    '{}'::jsonb,
    'failed',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000104'::uuid,
    'legacy-bounced@example.invalid',
    'legacy-bounced@example.invalid',
    'legacy bounced fixture',
    'legacy_bounced_fixture',
    '{}'::jsonb,
    'bounced',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000105'::uuid,
    'legacy-complained@example.invalid',
    'legacy-complained@example.invalid',
    'legacy complained fixture',
    'legacy_complained_fixture',
    '{}'::jsonb,
    'complained',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000106'::uuid,
    'legacy-dead@example.invalid',
    'legacy-dead@example.invalid',
    'legacy dead fixture',
    'legacy_dead_fixture',
    '{}'::jsonb,
    'dead',
    now()
  );

create temporary table test_email_outbox_post_migration_snapshot
on commit drop
as
select id, status, sent_at
from public.email_outbox;

select results_eq(
  $$
    select id, status
    from public.email_outbox
    where id in (
      '00000000-0000-0000-0000-000000000101'::uuid,
      '00000000-0000-0000-0000-000000000102'::uuid,
      '00000000-0000-0000-0000-000000000103'::uuid,
      '00000000-0000-0000-0000-000000000104'::uuid,
      '00000000-0000-0000-0000-000000000105'::uuid,
      '00000000-0000-0000-0000-000000000106'::uuid
    )
    order by id
  $$,
  $$ values
    ('00000000-0000-0000-0000-000000000101'::uuid, 'pending'::text),
    ('00000000-0000-0000-0000-000000000102'::uuid, 'sent'::text),
    ('00000000-0000-0000-0000-000000000103'::uuid, 'failed'::text),
    ('00000000-0000-0000-0000-000000000104'::uuid, 'bounced'::text),
    ('00000000-0000-0000-0000-000000000105'::uuid, 'complained'::text),
    ('00000000-0000-0000-0000-000000000106'::uuid, 'dead'::text)
  $$,
  'all six deterministic legacy status fixtures are present and unchanged'
);

select results_eq(
  $$
    select column_name, data_type, is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'email_outbox'
      and column_name in (
        'app',
        'event_key',
        'reply_to',
        'claim_token',
        'claimed_at',
        'claim_expires_at',
        'accepted_at',
        'delivered_at',
        'bounced_at',
        'complained_at',
        'failed_at',
        'dead_at',
        'quarantine_reason',
        'payload_schema_snapshot'
      )
    order by column_name
  $$,
  $$ values
    ('accepted_at'::text, 'timestamp with time zone'::text, 'YES'::text),
    ('app'::text, 'text'::text, 'YES'::text),
    ('bounced_at'::text, 'timestamp with time zone'::text, 'YES'::text),
    ('claim_expires_at'::text, 'timestamp with time zone'::text, 'YES'::text),
    ('claim_token'::text, 'uuid'::text, 'YES'::text),
    ('claimed_at'::text, 'timestamp with time zone'::text, 'YES'::text),
    ('complained_at'::text, 'timestamp with time zone'::text, 'YES'::text),
    ('dead_at'::text, 'timestamp with time zone'::text, 'YES'::text),
    ('delivered_at'::text, 'timestamp with time zone'::text, 'YES'::text),
    ('event_key'::text, 'text'::text, 'YES'::text),
    ('failed_at'::text, 'timestamp with time zone'::text, 'YES'::text),
    ('payload_schema_snapshot'::text, 'jsonb'::text, 'YES'::text),
    ('quarantine_reason'::text, 'text'::text, 'YES'::text),
    ('reply_to'::text, 'text'::text, 'YES'::text)
  $$,
  'email_outbox has every nullable reliable-email column with the expected type'
);

select is(
  (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.email_outbox'::regclass
      and conname = 'email_outbox_status_check'
      and contype = 'c'
  ),
  'CHECK ((status = ANY (ARRAY[''pending''::text, ''sent''::text, ''failed''::text, ''bounced''::text, ''complained''::text, ''dead''::text])))'::text,
  'the exact six-value legacy status check remains present'
);

select is(
  (
    select convalidated
    from pg_constraint
    where conrelid = 'public.email_outbox'::regclass
      and conname = 'email_outbox_status_check'
      and contype = 'c'
  ),
  true,
  'the exact legacy status check remains validated'
);

select is_empty(
  $$
    select conname
    from pg_constraint
    where conrelid = 'public.email_outbox'::regclass
      and conname = 'email_outbox_status_check'
      and pg_get_constraintdef(oid) ~* '(accepted|processing|delivered|quarantined)'
  $$,
  'the legacy status check excludes every new status value'
);

select is(
  (
    select indexdef
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'email_outbox'
      and indexname = 'idx_outbox_status'
  ),
  'CREATE INDEX idx_outbox_status ON public.email_outbox USING btree (status, next_retry_at)'::text,
  'status and next_retry_at retain their supporting index'
);

select is(
  (
    select indexdef
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'email_outbox'
      and indexname = 'idx_outbox_claim_expires_at'
  ),
  'CREATE INDEX idx_outbox_claim_expires_at ON public.email_outbox USING btree (claim_expires_at) WHERE (claim_expires_at IS NOT NULL)'::text,
  'claim expiry has a partial supporting index'
);

select is(
  (
    select indexdef
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'email_outbox'
      and indexname = 'idx_outbox_provider_id'
  ),
  'CREATE INDEX idx_outbox_provider_id ON public.email_outbox USING btree (provider_id) WHERE (provider_id IS NOT NULL)'::text,
  'non-null provider ids have a partial supporting index'
);

select results_eq(
  $$
    select conname, confdeltype::text, convalidated
    from pg_constraint
    where conrelid = 'public.email_logs'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (outbox_id)%'
  $$,
  $$ values ('email_logs_outbox_id_fkey'::text, 'n'::text, true)
  $$,
  'email_logs.outbox_id uses ON DELETE SET NULL'
);

select results_eq(
  $$
    select c.relname, c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('email_outbox', 'email_logs')
    order by c.relname
  $$,
  $$ values
    ('email_logs'::text, true),
    ('email_outbox'::text, true)
  $$,
  'RLS remains enabled on both email tables'
);

select is(
  (select count(*) from public.email_outbox),
  (select count(*) from test_email_outbox_post_migration_snapshot),
  'the post-migration snapshot contains six deterministic legacy fixtures and the current rows; a pre-migration count requires controller capture'
);

select set_eq(
  'select id from public.email_outbox',
  'select id from test_email_outbox_post_migration_snapshot',
  'the post-migration snapshot contains every current row ID including the six deterministic fixtures; pre-migration ID preservation requires controller capture'
);

select is_empty(
  $$
    select b.id
    from test_email_outbox_post_migration_snapshot b
    left join public.email_outbox o on o.id = b.id
    where o.id is null
       or b.status is distinct from o.status
       or b.sent_at is distinct from o.sent_at
  $$,
  'fixture and existing status and sent_at values remain stable during the post-migration regression transaction'
);

select is_empty(
  $$
    select id
    from public.email_outbox
    where sent_at is not null
      and accepted_at is distinct from sent_at
  $$,
  'sent_at is mapped to accepted_at'
);

select is_empty(
  $$
    select id
    from public.email_outbox
    where (app is null or event_key is null)
      and quarantine_reason is null
  $$,
  'rows without proven app and event identity have a quarantine reason'
);

select is_empty(
  $$
    select id
    from public.email_outbox
    where (app is null or event_key is null)
      and next_retry_at is distinct from 'infinity'::timestamptz
  $$,
  'rows without proven app and event identity have a non-dispatchable retry time'
);

select is(
  (
    select count(*)
    from public.email_outbox
    where (app is null or event_key is null)
      and quarantine_reason = 'legacy_mapping_unproven'
  ),
  (
    select count(*)
    from public.email_outbox
    where app is null
       or event_key is null
  ),
  'unknown legacy identity uses the safe mapping marker'
);

select is_empty(
  $$
    select id
    from public.email_outbox
    where quarantine_reason = 'legacy_mapping_unproven'
      and (app is not null or event_key is not null)
  $$,
  'legacy rows are not assigned an app or event from sender text'
);

select is_empty(
  $$
    select id
    from public.email_outbox
    where id in (
      '00000000-0000-0000-0000-000000000101'::uuid,
      '00000000-0000-0000-0000-000000000102'::uuid,
      '00000000-0000-0000-0000-000000000103'::uuid,
      '00000000-0000-0000-0000-000000000104'::uuid,
      '00000000-0000-0000-0000-000000000105'::uuid,
      '00000000-0000-0000-0000-000000000106'::uuid
    )
      and (
        quarantine_reason is distinct from 'legacy_mapping_unproven'
        or next_retry_at is distinct from 'infinity'::timestamptz
      )
  $$,
  'all six legacy fixtures receive the reason and infinity retry invariant'
);

select is_empty(
  $$
    select id
    from public.email_outbox
    where id in (
      '00000000-0000-0000-0000-000000000101'::uuid,
      '00000000-0000-0000-0000-000000000103'::uuid
    )
      and status in ('pending', 'failed')
      and next_retry_at <= now()
  $$,
  'the pending and failed legacy fixtures are excluded from the due selection'
);

update public.email_outbox
set quarantine_reason = null,
    next_retry_at = now()
where id = '00000000-0000-0000-0000-000000000101'::uuid;

select is(
  (
    select status
    from public.email_outbox
    where id = '00000000-0000-0000-0000-000000000101'::uuid
  ),
  'pending'::text,
  'the quarantine trigger does not change the pending fixture status'
);

select is(
  (
    select quarantine_reason
    from public.email_outbox
    where id = '00000000-0000-0000-0000-000000000101'::uuid
  ),
  'legacy_mapping_unproven'::text,
  'the quarantine trigger restores the reason on update'
);

select is(
  (
    select next_retry_at = 'infinity'::timestamptz
    from public.email_outbox
    where id = '00000000-0000-0000-0000-000000000101'::uuid
  ),
  true,
  'the quarantine trigger restores the infinity retry time on update'
);

select is_empty(
  $$
    select id
    from public.email_outbox
    where id = '00000000-0000-0000-0000-000000000101'::uuid
      and status in ('pending', 'failed')
      and next_retry_at <= now()
  $$,
  'the updated pending fixture remains outside the due selection'
);

select * from finish();
rollback;
