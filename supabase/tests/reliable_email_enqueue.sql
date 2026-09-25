begin;

select plan(46);

select results_eq(
  $$
    select column_name, data_type, is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'email_outbox'
      and column_name = 'source_id'
    order by column_name
  $$,
  $$ values
    ('source_id'::text, 'uuid'::text, 'YES'::text)
  $$,
  'email_outbox has a nullable source_id column'
);

select is(
  (
    select count(*)
    from information_schema.key_column_usage
    where table_schema = 'public'
      and table_name = 'email_outbox'
      and constraint_name = 'email_outbox_app_event_source_unique'
  ),
  3::bigint,
  'the unique identity on app, event_key, source_id exists'
);

select results_eq(
  $$
    select pg_get_constraintdef(constraint_record.oid)
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.email_outbox'::regclass
      and constraint_record.conname = 'email_outbox_app_event_source_unique'
      and constraint_record.contype = 'u'
  $$,
  $$ values
    ('UNIQUE (app, event_key, source_id)'::text)
  $$,
  'the unique tuple identity definition is exact'
);

select results_eq(
  $$
    select pg_get_constraintdef(constraint_record.oid)
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.email_outbox'::regclass
      and constraint_record.conname = 'email_outbox_app_event_key_fkey'
      and constraint_record.contype = 'f'
  $$,
  $$ values
    ('FOREIGN KEY (app, event_key) REFERENCES email_event_catalog(app, event_key)'::text)
  $$,
  'the catalog foreign key on app, event_key exists'
);

select is(
  (
    select not prosecdef
    from pg_proc
    where proname = 'email_payload_schema_matches'
      and prorettype = 'boolean'::regtype
  ),
  true,
  'email_payload_schema_matches is SECURITY INVOKER (prosecdef false)'
);

select is(
  (
    select not prosecdef
    from pg_proc
    where proname = 'enqueue_business_email_event'
      and prorettype = 'uuid'::regtype
  ),
  true,
  'enqueue_business_email_event is SECURITY INVOKER (prosecdef false)'
);

select is(
  (
    select pg_get_functiondef('public.enqueue_business_email_event(text,text,text,jsonb,uuid)'::regprocedure)
    like '%SET search_path TO%'
  ),
  true,
  'enqueue_business_email_event has the exact search_path'
);

select is(
  (
    select prosecdef
    from pg_proc
    where proname = 'enqueue_shop_order_status_email'
  ),
  true,
  'enqueue_shop_order_status_email is SECURITY DEFINER (prosecdef true)'
);

select is(
  (
    select has_function_privilege('service_role', 'public.enqueue_business_email_event(text,text,text,jsonb,uuid)', 'EXECUTE')
  ),
  true,
  'service_role has execute on enqueue_business_email_event'
);

select is(
  (
    select not has_function_privilege('anon', 'public.enqueue_business_email_event(text,text,text,jsonb,uuid)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.enqueue_business_email_event(text,text,text,jsonb,uuid)', 'EXECUTE')
  ),
  true,
  'anon and authenticated have no execute on enqueue_business_email_event'
);

select is(
  (
    select public.enqueue_business_email_event(
      'carehub',
      'registration_owner',
      'user@example.com',
      '{"owner_name":"Alice","business_name":"Acme"}'::jsonb,
      gen_random_uuid()
    )
  ) is not null,
  true,
  'enabled non required event inserts an outbox row and returns its id'
);

select is(
  (
    select count(*)
    from public.email_outbox
    where app = 'carehub' and event_key = 'registration_owner'
  ),
  1::bigint,
  'the enabled event created exactly one outbox row'
);

select is(
  (
    select count(*)
    from public.email_logs
    where event_type = 'enqueued'
  ),
  1::bigint,
  'the new row appended exactly one enqueued log'
);

select is(
  (
    select to_email
    from public.email_outbox
    where app = 'carehub' and event_key = 'registration_owner'
  ),
  'user@example.com'::text,
  'the outbox row stores the validated recipient'
);

select is(
  (
    select from_email
    from public.email_outbox
    where app = 'carehub' and event_key = 'registration_owner'
  ),
  'CareHub <support@carefindhub.com>'::text,
  'the outbox row uses the catalog sourced from_email'
);

select is(
  (
    select subject like 'CareHub:%'
    from public.email_outbox
    where app = 'carehub' and event_key = 'registration_owner'
  ),
  true,
  'the outbox subject uses the resolved catalog template'
);

select is(
  (
    select payload_schema_snapshot is not null
    from public.email_outbox
    where app = 'carehub' and event_key = 'registration_owner'
  ),
  true,
  'the outbox row stores the catalog payload schema snapshot'
);

select is(
  (
    select public.enqueue_business_email_event(
      'carehub',
      'registration_owner',
      'other@example.com',
      '{"owner_name":"Bob","business_name":"Globex"}'::jsonb,
      gen_random_uuid()
    )
  ) is not null,
  true,
  'a second source identity creates a distinct outbox row'
);

select is(
  (
    select count(*)
    from public.email_outbox
    where app = 'carehub' and event_key = 'registration_owner'
  ),
  2::bigint,
  'two distinct source identities create two outbox rows'
);

select is(
  (
    select count(*)
    from public.email_logs
    where event_type = 'enqueued'
  ),
  2::bigint,
  'each new row appended one log'
);

select is(
  (
    select count(*)
    from public.email_logs
    where detail like '%user@example.com%'
       or detail like '%{"owner_name"%}%'
  ),
  0::bigint,
  'the enqueued log contains no recipient or payload value'
);

select is(
  (
    select public.enqueue_business_email_event(
      'carehub',
      'registration_owner',
      'user@example.com',
      '{"owner_name":"Alice","business_name":"Acme"}'::jsonb,
      (select source_id from public.email_outbox where app = 'carehub' and event_key = 'registration_owner' limit 1)
    )
  ) is not null,
  true,
  'replay of the same source identity returns the original outbox id'
);

select is(
  (
    select count(*)
    from public.email_outbox
    where app = 'carehub' and event_key = 'registration_owner'
  ),
  2::bigint,
  'replay does not duplicate the outbox row'
);

select is(
  (
    select count(*)
    from public.email_logs
    where event_type = 'enqueued'
  ),
  2::bigint,
  'replay does not append a second log'
);

select throws_ok(
  $$
    select public.enqueue_business_email_event(
      'auth',
      'password_reset',
      'user@example.com',
      '{"display_name":"Alice"}'::jsonb,
      gen_random_uuid()
    )
  $$,
  'P0001',
  'auth catalog events are rejected before the disabled no-op path'
);

select throws_ok(
  $$
    select public.enqueue_business_email_event(
      'carehub',
      'unknown_event',
      'user@example.com',
      '{"name":"Alice"}'::jsonb,
      gen_random_uuid()
    )
  $$,
  'P0001',
  'unknown catalog events fail safely'
);

select throws_ok(
  $$
    select public.enqueue_business_email_event(
      'carehub',
      'registration_owner',
      'user@example.com',
      '{"owner_name":"Alice","business_name":"Acme"}'::jsonb,
      null::uuid
    )
  $$,
  'P0001',
  'null source id is rejected'
);

select throws_ok(
  $$
    select public.enqueue_business_email_event(
      'carehub',
      'registration_owner',
      'invalid-email',
      '{"owner_name":"Alice","business_name":"Acme"}'::jsonb,
      gen_random_uuid()
    )
  $$,
  'P0001',
  'an invalid recipient is rejected'
);

select throws_ok(
  $$
    select public.enqueue_business_email_event(
      'carehub',
      'registration_owner',
      'user@example.com',
      '{"owner_name":"Alice","business_name":123}'::jsonb,
      gen_random_uuid()
    )
  $$,
  'P0001',
  'non string payload property values are rejected'
);

select throws_ok(
  $$
    select public.enqueue_business_email_event(
      'carehub',
      'registration_owner',
      'user@example.com',
      '{"owner_name":"Alice","business_name":"Acme","extra_field":"value"}'::jsonb,
      gen_random_uuid()
    )
  $$,
  'P0001',
  'unknown payload fields are rejected'
);

select throws_ok(
  $$
    select public.enqueue_business_email_event(
      'carehub',
      'registration_owner',
      'user@example.com',
      '{"owner_name":"Alice","business_name":"' || repeat('x', 200) || '"}'::jsonb,
      gen_random_uuid()
    )
  $$,
  'P0001',
  'payload strings above maxLength are rejected'
);

select is(
  (
    select public.email_payload_schema_matches(
      '{"type":"object","additionalProperties":false,"required":["name"],"properties":{"name":{"type":"string","maxLength":10,"enum":["alice","bob"]}}}'::jsonb,
      '{"name":"alice"}'::jsonb
    )
  ),
  true,
  'email_payload_schema_matches accepts a valid enum payload'
);

select is(
  (
    select not public.email_payload_schema_matches(
      '{"type":"object","additionalProperties":false,"required":["name"],"properties":{"name":{"type":"string","maxLength":10,"enum":["alice","bob"]}}}'::jsonb,
      '{"name":"carol"}'::jsonb
    )
  ),
  false,
  'email_payload_schema_matches rejects an enum mismatch'
);

select is(
  (
    select public.email_payload_schema_matches(
      '{"type":"object","additionalProperties":false,"required":["email"],"properties":{"email":{"type":"string","maxLength":320,"format":"email"}}}'::jsonb,
      '{"email":"user@example.com"}'::jsonb
    )
  ),
  true,
  'email_payload_schema_matches accepts a valid email format payload'
);

select is(
  (
    select not public.email_payload_schema_matches(
      '{"type":"object","additionalProperties":false,"required":["email"],"properties":{"email":{"type":"string","maxLength":320,"format":"email"}}}'::jsonb,
      '{"email":"invalid"}'::jsonb
    )
  ),
  false,
  'email_payload_schema_matches rejects a malformed email format payload'
);

select is(
  (
    select public.email_payload_schema_matches(
      '{"type":"object","additionalProperties":false,"required":["code"],"properties":{"code":{"type":"string","maxLength":20,"pattern":"^ABC-[0-9]+$"}}}'::jsonb,
      '{"code":"ABC-123"}'::jsonb
    )
  ),
  true,
  'email_payload_schema_matches accepts a valid pattern payload'
);

select is(
  (
    select not public.email_payload_schema_matches(
      '{"type":"object","additionalProperties":false,"required":["code"],"properties":{"code":{"type":"string","maxLength":20,"pattern":"^ABC-[0-9]+$"}}}'::jsonb,
      '{"code":"XYZ"}'::jsonb
    )
  ),
  false,
  'email_payload_schema_matches rejects a pattern mismatch'
);

select is(
  (
    select public.email_payload_schema_matches(
      '{"type":"object","additionalProperties":false,"required":["name"],"properties":{"name":{"type":"string","maxLength":100}}}'::jsonb,
      '{"name":"hello"}'::jsonb
    )
  ),
  true,
  'email_payload_schema_matches accepts a clean payload'
);

select is(
  (
    select not public.email_payload_schema_matches(
      '{"type":"object","additionalProperties":false,"required":["name"],"properties":{"name":{"type":"string","maxLength":100}}}'::jsonb,
      '{"name":"hello' || chr(10) || 'world"}'::jsonb
    )
  ),
  false,
  'email_payload_schema_matches rejects control characters'
);

select is(
  (
    select not public.email_payload_schema_matches(
      '{"type":"object","additionalProperties":false,"required":["name"],"properties":{"name":{"type":"string","maxLength":100}}}'::jsonb,
      '{"name":"Alice","extra":"value"}'::jsonb
    )
  ),
  false,
  'email_payload_schema_matches rejects unknown payload fields'
);

select is(
  (
    select not public.email_payload_schema_matches(
      '{"type":"object","additionalProperties":false,"required":["name"],"properties":{"name":{"type":"string","maxLength":100}}}'::jsonb,
      '{"age":30}'::jsonb
    )
  ),
  false,
  'email_payload_schema_matches rejects missing required fields'
);

select is(
  (
    select not public.email_payload_schema_matches(
      '{"type":"object","additionalProperties":false,"required":["name"],"properties":{"name":{"type":"string","maxLength":100}}}'::jsonb,
      '{"name":""}'::jsonb
    )
  ),
  false,
  'email_payload_schema_matches rejects empty required values'
);

select is(
  (
    select count(*)
    from pg_trigger
    where tgrelid = 'public.shop_orders'::regclass
      and tgname = 'trg_shop_orders_status_email'
  ),
  0::bigint,
  'the old shop_orders status email trigger is absent'
);

select is(
  (
    select count(*)
    from pg_trigger
    where tgrelid = 'public.shop_order_status_history'::regclass
      and tgname = 'trg_shop_order_status_history_email'
  ),
  1::bigint,
  'the new history insert trigger exists exactly once'
);

select is(
  (
    select tgtype::integer & 2 > 0
    from pg_trigger
    where tgrelid = 'public.shop_order_status_history'::regclass
      and tgname = 'trg_shop_order_status_history_email'
  ),
  true,
  'the history trigger fires after insert'
);

select is(
  (
    select count(*)
    from public.email_outbox
    where event_key = 'order_status_update'
  ),
  0::bigint,
  'the disabled order_status_update event creates no outbox residue'
);

select * from finish();
rollback;
