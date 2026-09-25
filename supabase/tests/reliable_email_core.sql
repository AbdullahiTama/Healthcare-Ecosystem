begin;

select plan(83);

select results_eq(
  $$
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'email_event_catalog',
        'email_provider_events',
        'email_worker_runs',
        'email_system_settings'
      )
    order by table_name
  $$,
  $$ values
    ('email_event_catalog'::text),
    ('email_provider_events'::text),
    ('email_system_settings'::text),
    ('email_worker_runs'::text)
  $$,
  'the four core email tables exist'
);

select results_eq(
  $$
    select column_name, data_type, is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'email_event_catalog'
    order by column_name
  $$,
  $$ values
    ('app'::text, 'text'::text, 'NO'::text),
    ('category'::text, 'text'::text, 'NO'::text),
    ('created_at'::text, 'timestamp with time zone'::text, 'NO'::text),
    ('enabled'::text, 'boolean'::text, 'NO'::text),
    ('event_key'::text, 'text'::text, 'NO'::text),
    ('from_email'::text, 'text'::text, 'NO'::text),
    ('id'::text, 'uuid'::text, 'NO'::text),
    ('payload_schema'::text, 'jsonb'::text, 'NO'::text),
    ('reply_to'::text, 'text'::text, 'NO'::text),
    ('required_for_business'::text, 'boolean'::text, 'NO'::text),
    ('subject_template'::text, 'text'::text, 'NO'::text),
    ('template_key'::text, 'text'::text, 'NO'::text),
    ('updated_at'::text, 'timestamp with time zone'::text, 'NO'::text)
  $$,
  'email_event_catalog has the required columns and nullability'
);

select results_eq(
  $$
    select column_name, data_type, is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'email_provider_events'
    order by column_name
  $$,
  $$ values
    ('applied_at'::text, 'timestamp with time zone'::text, 'YES'::text),
    ('apply_error'::text, 'text'::text, 'YES'::text),
    ('created_at'::text, 'timestamp with time zone'::text, 'NO'::text),
    ('event_type'::text, 'text'::text, 'NO'::text),
    ('id'::text, 'uuid'::text, 'NO'::text),
    ('outbox_id'::text, 'uuid'::text, 'YES'::text),
    ('provider_event_id'::text, 'text'::text, 'NO'::text),
    ('provider_message_id'::text, 'text'::text, 'NO'::text),
    ('received_at'::text, 'timestamp with time zone'::text, 'NO'::text),
    ('safe_metadata'::text, 'jsonb'::text, 'NO'::text)
  $$,
  'email_provider_events has the required columns and nullability'
);

select results_eq(
  $$
    select column_name, data_type, is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'email_worker_runs'
    order by column_name
  $$,
  $$ values
    ('accepted_count'::text, 'integer'::text, 'NO'::text),
    ('claimed_count'::text, 'integer'::text, 'NO'::text),
    ('completed_at'::text, 'timestamp with time zone'::text, 'YES'::text),
    ('dead_count'::text, 'integer'::text, 'NO'::text),
    ('duration_ms'::text, 'integer'::text, 'YES'::text),
    ('error_summary'::text, 'text'::text, 'YES'::text),
    ('failed_count'::text, 'integer'::text, 'NO'::text),
    ('id'::text, 'uuid'::text, 'NO'::text),
    ('started_at'::text, 'timestamp with time zone'::text, 'NO'::text),
    ('status'::text, 'text'::text, 'NO'::text),
    ('worker_name'::text, 'text'::text, 'NO'::text)
  $$,
  'email_worker_runs has the required columns and nullability'
);

select results_eq(
  $$
    select column_name, data_type, is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'email_system_settings'
    order by column_name
  $$,
  $$ values
    ('key'::text, 'text'::text, 'NO'::text),
    ('updated_at'::text, 'timestamp with time zone'::text, 'NO'::text),
    ('updated_by'::text, 'uuid'::text, 'YES'::text),
    ('value'::text, 'jsonb'::text, 'NO'::text)
  $$,
  'email_system_settings has the required columns and nullability'
);

select results_eq(
  $$
    select c.relname, a.attname
    from pg_constraint constraint_record
    join pg_class c on c.oid = constraint_record.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join unnest(constraint_record.conkey) with ordinality as key_column(attnum, position) on true
    join pg_attribute a on a.attrelid = c.oid and a.attnum = key_column.attnum
    where constraint_record.contype = 'p'
      and array_length(constraint_record.conkey, 1) = 1
      and n.nspname = 'public'
      and c.relname in (
        'email_event_catalog',
        'email_provider_events',
        'email_worker_runs',
        'email_system_settings'
      )
    order by c.relname
  $$,
  $$ values
    ('email_event_catalog'::text, 'id'::text),
    ('email_provider_events'::text, 'id'::text),
    ('email_system_settings'::text, 'key'::text),
    ('email_worker_runs'::text, 'id'::text)
  $$,
  'all four core tables use the required single-column primary key'
);

select results_eq(
  $$
    select c.relname, pg_get_constraintdef(constraint_record.oid)
    from pg_constraint constraint_record
    join pg_class c on c.oid = constraint_record.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where constraint_record.contype = 'u'
      and n.nspname = 'public'
      and c.relname in ('email_event_catalog', 'email_provider_events')
    order by c.relname
  $$,
  $$ values
    ('email_event_catalog'::text, 'UNIQUE (app, event_key)'::text),
    ('email_provider_events'::text, 'UNIQUE (provider_event_id)'::text)
  $$,
  'catalog app plus event and provider event ids are unique'
);

select results_eq(
  $$
    select c.relname, constraint_record.conname, constraint_record.confdeltype::text, constraint_record.convalidated
    from pg_constraint constraint_record
    join pg_class c on c.oid = constraint_record.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where constraint_record.contype = 'f'
      and n.nspname = 'public'
      and c.relname in ('email_provider_events', 'email_system_settings')
    order by c.relname
  $$,
  $$ values
    ('email_provider_events'::text, 'email_provider_events_outbox_id_fkey'::text, 'n'::text, true),
    ('email_system_settings'::text, 'email_system_settings_updated_by_fkey'::text, 'n'::text, true)
  $$,
  'provider links and setting actors use validated ON DELETE SET NULL rules'
);

select is_empty(
  $$
    select expected.constraint_name
    from (
      values
        ('email_event_catalog_app_check'),
        ('email_event_catalog_brand_check'),
        ('email_event_catalog_event_key_check'),
        ('email_event_catalog_template_key_check'),
        ('email_event_catalog_subject_template_check'),
        ('email_event_catalog_from_email_check'),
        ('email_event_catalog_reply_to_check'),
        ('email_event_catalog_payload_schema_check'),
        ('email_event_catalog_category_check'),
        ('email_provider_events_provider_event_id_check'),
        ('email_provider_events_provider_message_id_check'),
        ('email_provider_events_event_type_check'),
        ('email_provider_events_safe_metadata_check'),
        ('email_provider_events_apply_error_check'),
        ('email_worker_runs_worker_name_check'),
        ('email_worker_runs_status_check'),
        ('email_worker_runs_counts_check'),
        ('email_worker_runs_duration_check'),
        ('email_worker_runs_completion_check'),
        ('email_worker_runs_error_summary_check'),
        ('email_system_settings_key_check'),
        ('email_system_settings_value_type_check')
    ) as expected(constraint_name)
    where not exists (
      select 1
      from pg_constraint constraint_record
      join pg_class c on c.oid = constraint_record.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and constraint_record.conname = expected.constraint_name
        and constraint_record.contype = 'c'
        and constraint_record.convalidated
    )
  $$,
  'all required validated check constraints exist'
);

select is_empty(
  $$
    select c.relname || '.' || column_record.column_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join lateral jsonb_each_object(
      jsonb_build_object(
        'email_event_catalog', jsonb_build_object(
          'id', true,
          'enabled', true,
          'required_for_business', true,
          'created_at', true,
          'updated_at', true
        ),
        'email_provider_events', jsonb_build_object(
          'id', true,
          'safe_metadata', true,
          'received_at', true,
          'created_at', true
        ),
        'email_worker_runs', jsonb_build_object(
          'id', true,
          'claimed_count', true,
          'accepted_count', true,
          'failed_count', true,
          'dead_count', true,
          'started_at', true
        ),
        'email_system_settings', jsonb_build_object(
          'updated_at', true
        )
      )
    ) as expected_table(columns) on true
    join lateral jsonb_object_keys(expected_table.columns) as expected_column(column_name) on true
    join information_schema.columns column_record
      on column_record.table_schema = n.nspname
     and column_record.table_name = c.relname
     and column_record.column_name = expected_column.column_name
    where n.nspname = 'public'
      and c.relname in (
        'email_event_catalog',
        'email_provider_events',
        'email_worker_runs',
        'email_system_settings'
      )
      and column_record.column_default is null
  $$,
  'every required generated or state default is present'
);

select results_eq(
  $$
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'idx_email_provider_events_provider_message_applied',
        'idx_email_provider_events_outbox_id',
        'idx_email_worker_runs_started_at',
        'idx_email_system_settings_updated_by',
        'idx_outbox_provider_id',
        'uq_email_outbox_provider_id'
      )
    order by indexname
  $$,
  $$ values
    ('idx_email_provider_events_outbox_id'::text),
    ('idx_email_provider_events_provider_message_applied'::text),
    ('idx_email_system_settings_updated_by'::text),
    ('idx_email_worker_runs_started_at'::text),
    ('idx_outbox_provider_id'::text),
    ('uq_email_outbox_provider_id'::text)
  $$,
  'provider, worker, setting actor, and outbox provider indexes exist'
);

select is(
  (
    select indexdef
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'email_outbox'
      and indexname = 'uq_email_outbox_provider_id'
  ),
  'CREATE UNIQUE INDEX uq_email_outbox_provider_id ON public.email_outbox USING btree (provider_id) WHERE (provider_id IS NOT NULL)'::text,
  'the partial provider-id index has the exact unique provider_id definition'
);

select results_eq(
  $$
    select c.relname, c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'email_outbox',
        'email_logs',
        'email_provider_events',
        'email_worker_runs',
        'email_event_catalog',
        'email_system_settings'
      )
    order by c.relname
  $$,
  $$ values
    ('email_event_catalog'::text, true),
    ('email_logs'::text, true),
    ('email_outbox'::text, true),
    ('email_provider_events'::text, true),
    ('email_system_settings'::text, true),
    ('email_worker_runs'::text, true)
  $$,
  'RLS is enabled on all six protected email tables'
);

select is_empty(
  $$
    select schemaname || '.' || tablename || '.' || policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'email_outbox',
        'email_logs',
        'email_provider_events',
        'email_worker_runs',
        'email_event_catalog',
        'email_system_settings'
      )
  $$,
  'the six protected email tables have zero policies'
);

select is_empty(
  $$
    select table_name || ':' || grantee || ':' || privilege_type
    from information_schema.table_privileges
    where table_schema = 'public'
      and table_name in (
        'email_outbox',
        'email_logs',
        'email_provider_events',
        'email_worker_runs',
        'email_event_catalog',
        'email_system_settings'
      )
      and grantee in ('PUBLIC', 'anon', 'authenticated')
  $$,
  'PUBLIC, anon, and authenticated have no explicit table grants on protected email tables'
);

select is_empty(
  $$
    select protected_table.table_name || ':' || role_record.role_name
    from (values
      ('email_outbox'::text),
      ('email_logs'::text),
      ('email_provider_events'::text),
      ('email_worker_runs'::text),
      ('email_event_catalog'::text),
      ('email_system_settings'::text)
    ) as protected_table(table_name)
    cross join (values
      ('anon'::text),
      ('authenticated'::text)
    ) as role_record(role_name)
    where has_table_privilege(role_record.role_name::name, 'public.' || protected_table.table_name, 'select')
       or has_table_privilege(role_record.role_name::name, 'public.' || protected_table.table_name, 'insert')
       or has_table_privilege(role_record.role_name::name, 'public.' || protected_table.table_name, 'update')
       or has_table_privilege(role_record.role_name::name, 'public.' || protected_table.table_name, 'delete')
  $$,
  'anon and authenticated have no DML privileges on protected email tables'
);

select is_empty(
  $$
    select protected_table.table_name
    from (values
      ('email_outbox'::text),
      ('email_logs'::text),
      ('email_provider_events'::text),
      ('email_worker_runs'::text),
      ('email_event_catalog'::text),
      ('email_system_settings'::text)
    ) as protected_table(table_name)
    where not has_table_privilege('service_role'::name, 'public.' || protected_table.table_name, 'select')
       or not has_table_privilege('service_role'::name, 'public.' || protected_table.table_name, 'insert')
       or not has_table_privilege('service_role'::name, 'public.' || protected_table.table_name, 'update')
       or not has_table_privilege('service_role'::name, 'public.' || protected_table.table_name, 'delete')
  $$,
  'service_role has all required DML privileges on protected email tables'
);

select is_empty(
  $$
    select protected_table.table_name || ':' || role_record.role_name
    from (values
      ('email_outbox'::text),
      ('email_logs'::text),
      ('email_provider_events'::text),
      ('email_worker_runs'::text),
      ('email_event_catalog'::text),
      ('email_system_settings'::text)
    ) as protected_table(table_name)
    cross join (values
      ('anon'::text),
      ('authenticated'::text),
      ('service_role'::text)
    ) as role_record(role_name)
    where has_table_privilege(role_record.role_name::name, 'public.' || protected_table.table_name, 'truncate')
       or has_table_privilege(role_record.role_name::name, 'public.' || protected_table.table_name, 'references')
       or has_table_privilege(role_record.role_name::name, 'public.' || protected_table.table_name, 'trigger')
  $$,
  'protected email tables grant no truncate, references, or trigger privileges to the three tested roles'
);

select is(
  (
    select pg_get_constraintdef(constraint_record.oid)
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.email_outbox'::regclass
      and constraint_record.conname = 'email_outbox_status_check'
      and constraint_record.contype = 'c'
  ),
  'CHECK ((status = ANY (ARRAY[''pending''::text, ''sent''::text, ''failed''::text, ''bounced''::text, ''complained''::text, ''dead''::text])))'::text,
  'the unchanged six-value legacy outbox status constraint remains exact'
);

insert into public.email_provider_events (
  provider_event_id,
  provider_message_id,
  event_type,
  safe_metadata,
  apply_error
)
values (
  'evt_core_safe_metadata_probe',
  'msg_core_safe_metadata_probe',
  'email.delivered',
  '{"source":"reliable_email_core_test","status":"delivered","attempt":1}'::jsonb,
  'provider_timeout'
);

select is(
  (
    select safe_metadata
    from public.email_provider_events
    where provider_event_id = 'evt_core_safe_metadata_probe'
  ),
  '{"source":"reliable_email_core_test","status":"delivered","attempt":1}'::jsonb,
  'safe primitive provider metadata is accepted'
);

select is(
  (
    select apply_error
    from public.email_provider_events
    where provider_event_id = 'evt_core_safe_metadata_probe'
  ),
  'provider_timeout'::text,
  'a bounded safe provider error summary is accepted'
);

insert into public.email_worker_runs (
  worker_name,
  started_at,
  status,
  error_summary
)
values (
  'reliable-email-core-test',
  now(),
  'running',
  'configuration_retry'
);

select is(
  (
    select error_summary
    from public.email_worker_runs
    where worker_name = 'reliable-email-core-test'
  ),
  'configuration_retry'::text,
  'a bounded safe worker error summary is accepted'
);

select set_eq(
  $$
    select app || ':' || event_key
    from public.email_event_catalog
  $$,
  $$ values
    ('carehub:registration_owner'::text),
    ('carehub:admin_new_registration'::text),
    ('carehub:business_approved'::text),
    ('carehub:business_rejected'::text),
    ('carehub:business_suspended'::text),
    ('carehub:business_reactivated'::text),
    ('carehub:business_revoked'::text),
    ('carehub:appointment_confirmed'::text),
    ('carehub:subscription_created'::text),
    ('carehub:subscription_expiry'::text),
    ('carehub:purchase_confirmed'::text),
    ('carehub:order_status_update'::text),
    ('carehub:password_reset'::text),
    ('carehub:email_verification'::text),
    ('carehub:staff_welcome'::text),
    ('carefind:customer_registration'::text),
    ('carefind:order_confirmation'::text),
    ('carefind:booking_confirmed'::text),
    ('carefind:order_status_update'::text),
    ('carefind:appointment_confirmed'::text),
    ('carefind:subscription_created'::text),
    ('carefind:subscription_expiry'::text),
    ('carefind:purchase_confirmed'::text),
    ('carefind:password_reset'::text),
    ('carefind:email_verification'::text)
  $$,
  'the complete planned 25-event catalog is seeded exactly once'
);

select is(
  (select count(*) from public.email_event_catalog),
  25::bigint,
  'the foundation catalog contains exactly 25 events'
);

select results_eq(
  $$
    select app, count(*)
    from public.email_event_catalog
    group by app
    order by app
  $$,
  $$ values
    ('carefind'::text, 10::bigint),
    ('carehub'::text, 15::bigint)
  $$,
  'the catalog contains 15 CareHub and 10 CareFind events'
);

select is(
  (
    select count(*)
    from public.email_event_catalog
    where enabled or required_for_business
  ),
  0::bigint,
  'every foundation catalog event is disabled and non required'
);

select is_empty(
  $$
    select app, event_key
    from public.email_event_catalog
    where from_email <> case app
      when 'carehub' then 'CareHub <support@carefindhub.com>'
      when 'carefind' then 'CareFind <support@carefind.app>'
    end
       or reply_to <> case app
         when 'carehub' then 'support@carefindhub.com'
         when 'carefind' then 'support@carefind.app'
       end
       or subject_template not like case app
         when 'carehub' then 'CareHub:%'
         when 'carefind' then 'CareFind:%'
       end
  $$,
  'every seed uses its approved sender, reply address, and subject prefix'
);

select is_empty(
  $$
    select app, event_key
    from public.email_event_catalog
    where btrim(template_key) = ''
       or btrim(category) = ''
       or btrim(subject_template) = ''
  $$,
  'every seed has a non-empty template, category, and subject'
);

select is_empty(
  $$
    select app, event_key
    from public.email_event_catalog
    where coalesce(
      (payload_schema ? 'type') is true
      and payload_schema->'type' = '"object"'::jsonb
      and (payload_schema ? 'additionalProperties') is true
      and payload_schema->'additionalProperties' = 'false'::jsonb
      and (payload_schema ? 'properties') is true
      and jsonb_typeof(payload_schema->'properties') = 'object'
      and (payload_schema ? 'required') is true
      and jsonb_typeof(payload_schema->'required') = 'array',
      false
    ) is not true
  $$,
  'every payload schema has explicit closed-schema structure'
);

select is_empty(
  $$
    select catalog.app, catalog.event_key, property_entry.key
    from public.email_event_catalog catalog
    cross join lateral jsonb_each(catalog.payload_schema->'properties') as property_entry(key, value)
    where coalesce(
      jsonb_typeof(property_entry.value) = 'object'
      and property_entry.value->>'type' = 'string'
      and (property_entry.value ? 'maxLength') is true
      and jsonb_typeof(property_entry.value->'maxLength') = 'number'
      and (property_entry.value->>'maxLength') ~ '^[0-9]+([.]0+)?$'
      and property_entry.value->'maxLength' > '0'::jsonb
      and property_entry.value->'maxLength' <= '4096'::jsonb,
      false
    ) is not true
  $$,
  'every payload property is a bounded string with a positive integer maxLength'
);

select is_empty(
  $$
    select catalog.app, catalog.event_key, required_entry.value
    from public.email_event_catalog catalog
    cross join lateral jsonb_array_elements(catalog.payload_schema->'required') as required_entry(value)
    where jsonb_typeof(required_entry.value) is distinct from 'string'
       or (required_entry.value #>> '{}') !~ '^[a-z][a-z0-9_]{0,79}$'
       or ((catalog.payload_schema->'properties') ? (required_entry.value #>> '{}')) is not true
  $$,
  'every required payload field is a declared property'
);

select is_empty(
  $$
    select catalog.app, catalog.event_key
    from public.email_event_catalog catalog
    where (
      select count(*)
      from jsonb_array_elements(catalog.payload_schema->'required')
    ) <> (
      select count(distinct required_entry.value #>> '{}')
      from jsonb_array_elements(catalog.payload_schema->'required') as required_entry(value)
    )
  $$,
  'payload required entries are unique'
);

select is_empty(
  $$
    select catalog.app, catalog.event_key, placeholder.match[1]
    from public.email_event_catalog catalog
    cross join lateral regexp_matches(
      catalog.subject_template,
      '\{\{([a-z][a-z0-9_]*)\}\}',
      'g'
    ) as placeholder(match)
    where ((catalog.payload_schema->'properties') ? placeholder.match[1]) is not true
       or not exists (
         select 1
         from jsonb_array_elements_text(catalog.payload_schema->'required') as required_entry(required_field)
         where required_entry.required_field = placeholder.match[1]
       )
  $$,
  'every subject placeholder is declared and required'
);

select is_empty(
  $$
    select catalog.app, catalog.event_key
    from public.email_event_catalog catalog
    where regexp_replace(
      catalog.subject_template,
      '\{\{[a-z][a-z0-9_]*\}\}',
      '',
      'g'
    ) ~ '[\{\}]'
  $$,
  'subject templates reject malformed placeholder syntax'
);

select is_empty(
  $$
    select catalog.app, catalog.event_key, property_entry.key
    from public.email_event_catalog catalog
    cross join lateral jsonb_object_keys(catalog.payload_schema->'properties') as property_entry(key)
    where property_entry.key ~* '(patient|diagnos|clinical|prescription|medical|test[_-]?result|review|feedback|comment|reason[_-]?text|password|passwd|token|secret|auth|api[_-]?key|credential)'
  $$,
  'catalog payload properties contain no clinical, auth, patient, review, password, or token fields'
);

select results_eq(
  $$
    select key, value, updated_by
    from public.email_system_settings
    order by key
  $$,
  $$ values
    ('carehub_admin_email'::text, '"admin@carefindhub.com"'::jsonb, null::uuid),
    ('dispatch_paused'::text, 'false'::jsonb, null::uuid)
  $$,
  'safe settings contain only the approved seed values'
);

select is(
  (select count(*) from public.email_system_settings),
  2::bigint,
  'the settings table contains exactly the two approved seed keys'
);

select throws_ok(
  $$
    insert into public.email_event_catalog (
      app,
      event_key,
      template_key,
      subject_template,
      from_email,
      reply_to,
      payload_schema,
      category
    ) values (
      'carehub',
      'probe_missing_type',
      'probe_missing_type',
      'CareHub: missing type',
      'CareHub <support@carefindhub.com>',
      'support@carefindhub.com',
      '{"additionalProperties":false,"required":[],"properties":{}}'::jsonb,
      'business'
    )
  $$,
  '23514',
  'catalog writes reject a missing type key'
);

select throws_ok(
  $$
    insert into public.email_event_catalog (
      app,
      event_key,
      template_key,
      subject_template,
      from_email,
      reply_to,
      payload_schema,
      category
    ) values (
      'carehub',
      'probe_missing_additional_properties',
      'probe_missing_additional_properties',
      'CareHub: missing additional properties',
      'CareHub <support@carefindhub.com>',
      'support@carefindhub.com',
      '{"type":"object","required":[],"properties":{}}'::jsonb,
      'business'
    )
  $$,
  '23514',
  'catalog writes reject a missing additionalProperties key'
);

select throws_ok(
  $$
    insert into public.email_event_catalog (
      app,
      event_key,
      template_key,
      subject_template,
      from_email,
      reply_to,
      payload_schema,
      category
    ) values (
      'carehub',
      'probe_missing_properties',
      'probe_missing_properties',
      'CareHub: missing properties',
      'CareHub <support@carefindhub.com>',
      'support@carefindhub.com',
      '{"type":"object","additionalProperties":false,"required":[]}'::jsonb,
      'business'
    )
  $$,
  '23514',
  'catalog writes reject a missing properties key'
);

select throws_ok(
  $$
    insert into public.email_event_catalog (
      app,
      event_key,
      template_key,
      subject_template,
      from_email,
      reply_to,
      payload_schema,
      category
    ) values (
      'carehub',
      'probe_missing_required',
      'probe_missing_required',
      'CareHub: missing required',
      'CareHub <support@carefindhub.com>',
      'support@carefindhub.com',
      '{"type":"object","additionalProperties":false,"properties":{}}'::jsonb,
      'business'
    )
  $$,
  '23514',
  'catalog writes reject a missing required key'
);

select throws_ok(
  $$
    insert into public.email_event_catalog (
      app,
      event_key,
      template_key,
      subject_template,
      from_email,
      reply_to,
      payload_schema,
      category
    ) values (
      'carehub',
      'probe_null_required',
      'probe_null_required',
      'CareHub: null required',
      'CareHub <support@carefindhub.com>',
      'support@carefindhub.com',
      '{"type":"object","additionalProperties":false,"required":null,"properties":{}}'::jsonb,
      'business'
    )
  $$,
  '23514',
  'catalog writes reject a null required key'
);

select throws_ok(
  $$
    insert into public.email_event_catalog (
      app,
      event_key,
      template_key,
      subject_template,
      from_email,
      reply_to,
      payload_schema,
      category
    ) values (
      'carehub',
      'probe_missing_max_length',
      'probe_missing_max_length',
      'CareHub: missing max length',
      'CareHub <support@carefindhub.com>',
      'support@carefindhub.com',
      '{"type":"object","additionalProperties":false,"required":["name"],"properties":{"name":{"type":"string"}}}'::jsonb,
      'business'
    )
  $$,
  '23514',
  'catalog writes reject a string property without maxLength'
);

select throws_ok(
  $$
    insert into public.email_event_catalog (
      app,
      event_key,
      template_key,
      subject_template,
      from_email,
      reply_to,
      payload_schema,
      category
    ) values (
      'carehub',
      'probe_zero_max_length',
      'probe_zero_max_length',
      'CareHub: zero max length',
      'CareHub <support@carefindhub.com>',
      'support@carefindhub.com',
      '{"type":"object","additionalProperties":false,"required":["name"],"properties":{"name":{"type":"string","maxLength":0}}}'::jsonb,
      'business'
    )
  $$,
  '23514',
  'catalog writes reject a zero maxLength'
);

select throws_ok(
  $$
    insert into public.email_event_catalog (
      app,
      event_key,
      template_key,
      subject_template,
      from_email,
      reply_to,
      payload_schema,
      category
    ) values (
      'carehub',
      'probe_fractional_max_length',
      'probe_fractional_max_length',
      'CareHub: fractional max length',
      'CareHub <support@carefindhub.com>',
      'support@carefindhub.com',
      '{"type":"object","additionalProperties":false,"required":["name"],"properties":{"name":{"type":"string","maxLength":4.5}}}'::jsonb,
      'business'
    )
  $$,
  '23514',
  'catalog writes reject a fractional maxLength'
);

select throws_ok(
  $$
    insert into public.email_event_catalog (
      app,
      event_key,
      template_key,
      subject_template,
      from_email,
      reply_to,
      payload_schema,
      category
    ) values (
      'carehub',
      'probe_non_string_property',
      'probe_non_string_property',
      'CareHub: non string property',
      'CareHub <support@carefindhub.com>',
      'support@carefindhub.com',
      '{"type":"object","additionalProperties":false,"required":["count"],"properties":{"count":{"type":"integer","maxLength":10}}}'::jsonb,
      'business'
    )
  $$,
  '23514',
  'catalog writes reject non-string payload properties'
);

select throws_ok(
  $$
    insert into public.email_event_catalog (
      app,
      event_key,
      template_key,
      subject_template,
      from_email,
      reply_to,
      payload_schema,
      category
    ) values (
      'carehub',
      'probe_forbidden_field',
      'probe_forbidden_field',
      'CareHub: forbidden field',
      'CareHub <support@carefindhub.com>',
      'support@carefindhub.com',
      '{"type":"object","additionalProperties":false,"required":["review_reason"],"properties":{"review_reason":{"type":"string","maxLength":100}}}'::jsonb,
      'business'
    )
  $$,
  '23514',
  'catalog writes reject forbidden free-text review fields'
);

select throws_ok(
  $$
    insert into public.email_event_catalog (
      app,
      event_key,
      template_key,
      subject_template,
      from_email,
      reply_to,
      payload_schema,
      category
    ) values (
      'carehub',
      'probe_placeholder_undeclared',
      'probe_placeholder_undeclared',
      'CareHub: Hello {{missing}}',
      'CareHub <support@carefindhub.com>',
      'support@carefindhub.com',
      '{"type":"object","additionalProperties":false,"required":[],"properties":{}}'::jsonb,
      'business'
    )
  $$,
  '23514',
  'catalog writes reject subject placeholders that are not declared'
);

select throws_ok(
  $$
    insert into public.email_event_catalog (
      app,
      event_key,
      template_key,
      subject_template,
      from_email,
      reply_to,
      payload_schema,
      category
    ) values (
      'carehub',
      'probe_placeholder_not_required',
      'probe_placeholder_not_required',
      'CareHub: Hello {{name}}',
      'CareHub <support@carefindhub.com>',
      'support@carefindhub.com',
      '{"type":"object","additionalProperties":false,"required":[],"properties":{"name":{"type":"string","maxLength":100}}}'::jsonb,
      'business'
    )
  $$,
  '23514',
  'catalog writes reject subject placeholders that are not required'
);

select throws_ok(
  $$
    insert into public.email_event_catalog (
      app,
      event_key,
      template_key,
      subject_template,
      from_email,
      reply_to,
      payload_schema,
      category
    ) values (
      'carehub',
      'probe_duplicate_required',
      'probe_duplicate_required',
      'CareHub: duplicate required',
      'CareHub <support@carefindhub.com>',
      'support@carefindhub.com',
      '{"type":"object","additionalProperties":false,"required":["name","name"],"properties":{"name":{"type":"string","maxLength":100}}}'::jsonb,
      'business'
    )
  $$,
  '23514',
  'catalog writes reject duplicate required entries'
);

select throws_ok(
  $$
    insert into public.email_event_catalog (
      app,
      event_key,
      template_key,
      subject_template,
      from_email,
      reply_to,
      payload_schema,
      category
    ) values (
      'carehub',
      'probe_malformed_placeholder',
      'probe_malformed_placeholder',
      'CareHub: Hello {{name',
      'CareHub <support@carefindhub.com>',
      'support@carefindhub.com',
      '{"type":"object","additionalProperties":false,"required":[],"properties":{}}'::jsonb,
      'business'
    )
  $$,
  '23514',
  'catalog writes reject malformed subject placeholders'
);

select throws_ok(
  $$
    insert into public.email_event_catalog (
      app,
      event_key,
      template_key,
      subject_template,
      from_email,
      reply_to,
      payload_schema,
      category
    ) values (
      'carehub',
      'probe_open_schema',
      'probe_open_schema',
      'CareHub: open schema',
      'CareHub <support@carefindhub.com>',
      'support@carefindhub.com',
      '{"type":"object","additionalProperties":true,"required":[],"properties":{}}'::jsonb,
      'business'
    )
  $$,
  '23514',
  'catalog rows reject payload schemas that allow additional properties'
);

select throws_ok(
  $$
    insert into public.email_event_catalog (
      app,
      event_key,
      template_key,
      subject_template,
      from_email,
      reply_to,
      payload_schema,
      category
    ) values (
      'unknown',
      'probe_invalid_app',
      'probe_invalid_app',
      'CareHub: invalid app',
      'CareHub <support@carefindhub.com>',
      'support@carefindhub.com',
      '{"type":"object","additionalProperties":false,"required":[],"properties":{}}'::jsonb,
      'business'
    )
  $$,
  '23514',
  'catalog rows reject apps outside CareHub and CareFind'
);

select throws_ok(
  $$
    insert into public.email_event_catalog (
      app,
      event_key,
      template_key,
      subject_template,
      from_email,
      reply_to,
      payload_schema,
      category
    ) values (
      'carehub',
      'probe_wrong_sender',
      'probe_wrong_sender',
      'CareHub: wrong sender',
      'Other <support@example.com>',
      'support@carefindhub.com',
      '{"type":"object","additionalProperties":false,"required":[],"properties":{}}'::jsonb,
      'business'
    )
  $$,
  '23514',
  'catalog rows reject an unapproved app sender'
);

select throws_ok(
  $$
    insert into public.email_event_catalog (
      app,
      event_key,
      template_key,
      subject_template,
      from_email,
      reply_to,
      payload_schema,
      category
    ) values (
      'carehub',
      'probe_wrong_reply',
      'probe_wrong_reply',
      'CareHub: wrong reply',
      'CareHub <support@carefindhub.com>',
      'other@example.com',
      '{"type":"object","additionalProperties":false,"required":[],"properties":{}}'::jsonb,
      'business'
    )
  $$,
  '23514',
  'catalog rows reject an unapproved reply address'
);

select throws_ok(
  $$
    insert into public.email_event_catalog (
      app,
      event_key,
      template_key,
      subject_template,
      from_email,
      reply_to,
      payload_schema,
      category
    ) values (
      'carehub',
      'probe_wrong_subject_prefix',
      'probe_wrong_subject_prefix',
      'Other: wrong prefix',
      'CareHub <support@carefindhub.com>',
      'support@carefindhub.com',
      '{"type":"object","additionalProperties":false,"required":[],"properties":{}}'::jsonb,
      'business'
    )
  $$,
  '23514',
  'catalog rows reject a subject outside the approved app prefix'
);

select throws_ok(
  $$
    insert into public.email_event_catalog (
      app,
      event_key,
      template_key,
      subject_template,
      from_email,
      reply_to,
      payload_schema,
      category
    ) values (
      'carehub',
      'probe_subject_control_character',
      'probe_subject_control_character',
      concat('CareHub: unsafe', chr(10), 'subject'),
      'CareHub <support@carefindhub.com>',
      'support@carefindhub.com',
      '{"type":"object","additionalProperties":false,"required":[],"properties":{}}'::jsonb,
      'business'
    )
  $$,
  '23514',
  'catalog rows reject control characters in subject text'
);

select throws_ok(
  $$
    insert into public.email_event_catalog (
      app,
      event_key,
      template_key,
      subject_template,
      from_email,
      reply_to,
      payload_schema,
      category
    ) values (
      'carehub',
      'probe_category_control_character',
      'probe_category_control_character',
      'CareHub: unsafe category',
      'CareHub <support@carefindhub.com>',
      'support@carefindhub.com',
      '{"type":"object","additionalProperties":false,"required":[],"properties":{}}'::jsonb,
      concat('business', chr(13), 'category')
    )
  $$,
  '23514',
  'catalog rows reject control characters in category text'
);

select throws_ok(
  $$
    insert into public.email_event_catalog (
      app,
      event_key,
      template_key,
      subject_template,
      from_email,
      reply_to,
      payload_schema,
      category
    ) values (
      'carehub',
      concat('probe_event_control', chr(9)),
      'probe_event_control_character',
      'CareHub: unsafe event key',
      'CareHub <support@carefindhub.com>',
      'support@carefindhub.com',
      '{"type":"object","additionalProperties":false,"required":[],"properties":{}}'::jsonb,
      'business'
    )
  $$,
  '23514',
  'catalog rows reject control characters in event keys'
);

select throws_ok(
  $$
    insert into public.email_provider_events (
      provider_event_id,
      provider_message_id,
      event_type,
      safe_metadata
    ) values (
      'evt_metadata_nested_object_probe',
      'msg_metadata_nested_object_probe',
      'email.delivered',
      '{"detail":{"status":"delivered"}}'::jsonb
    )
  $$,
  '23514',
  'provider metadata rejects nested objects'
);

select throws_ok(
  $$
    insert into public.email_provider_events (
      provider_event_id,
      provider_message_id,
      event_type,
      safe_metadata
    ) values (
      'evt_metadata_array_probe',
      'msg_metadata_array_probe',
      'email.delivered',
      '{"tags":["delivered"]}'::jsonb
    )
  $$,
  '23514',
  'provider metadata rejects arrays'
);

select throws_ok(
  $$
    insert into public.email_provider_events (
      provider_event_id,
      provider_message_id,
      event_type,
      safe_metadata
    ) values (
      'evt_metadata_oversized_value_probe',
      'msg_metadata_oversized_value_probe',
      'email.delivered',
      jsonb_build_object('value', repeat('x', 257))
    )
  $$,
  '23514',
  'provider metadata rejects oversized string values'
);

select throws_ok(
  $$
    insert into public.email_provider_events (
      provider_event_id,
      provider_message_id,
      event_type,
      safe_metadata
    ) values (
      'evt_metadata_email_value_probe',
      'msg_metadata_email_value_probe',
      'email.delivered',
      '{"value":"person@example.com"}'::jsonb
    )
  $$,
  '23514',
  'provider metadata rejects full-email-like values'
);

select throws_ok(
  $$
    insert into public.email_provider_events (
      provider_event_id,
      provider_message_id,
      event_type,
      safe_metadata
    ) values (
      'evt_metadata_url_value_probe',
      'msg_metadata_url_value_probe',
      'email.delivered',
      '{"source":"https://example.test/action"}'::jsonb
    )
  $$,
  '23514',
  'provider metadata rejects URL and action-link values'
);

select throws_ok(
  $$
    insert into public.email_provider_events (
      provider_event_id,
      provider_message_id,
      event_type,
      safe_metadata
    ) values (
      'evt_metadata_secret_key_probe',
      'msg_metadata_secret_key_probe',
      'email.delivered',
      '{"api_key":"not-a-secret"}'::jsonb
    )
  $$,
  '23514',
  'provider metadata rejects secret key names'
);

select throws_ok(
  $$
    insert into public.email_provider_events (
      provider_event_id,
      provider_message_id,
      event_type,
      safe_metadata
    ) values (
      'evt_metadata_password_value_probe',
      'msg_metadata_password_value_probe',
      'email.delivered',
      '{"value":"password reset"}'::jsonb
    )
  $$,
  '23514',
  'provider metadata rejects password and token values'
);

select throws_ok(
  $$
    insert into public.email_provider_events (
      provider_event_id,
      provider_message_id,
      event_type,
      safe_metadata
    ) values (
      'evt_metadata_patient_key_probe',
      'msg_metadata_patient_key_probe',
      'email.delivered',
      '{"patient_id":"patient-1"}'::jsonb
    )
  $$,
  '23514',
  'provider metadata rejects patient and clinical identifiers'
);

select throws_ok(
  $$
    insert into public.email_provider_events (
      provider_event_id,
      provider_message_id,
      event_type,
      apply_error
    ) values (
      'evt_apply_error_email_probe',
      'msg_apply_error_email_probe',
      'email.failed',
      'person@example.com'
    )
  $$,
  '23514',
  'provider error summaries reject full email addresses'
);

select throws_ok(
  $$
    insert into public.email_provider_events (
      provider_event_id,
      provider_message_id,
      event_type,
      apply_error
    ) values (
      'evt_apply_error_url_probe',
      'msg_apply_error_url_probe',
      'email.failed',
      'retry at https://example.test/action'
    )
  $$,
  '23514',
  'provider error summaries reject URLs'
);

select throws_ok(
  $$
    insert into public.email_provider_events (
      provider_event_id,
      provider_message_id,
      event_type,
      apply_error
    ) values (
      'evt_apply_error_token_probe',
      'msg_apply_error_token_probe',
      'email.failed',
      'access_token expired'
    )
  $$,
  '23514',
  'provider error summaries reject tokens and passwords'
);

select throws_ok(
  $$
    insert into public.email_provider_events (
      provider_event_id,
      provider_message_id,
      event_type,
      apply_error
    ) values (
      'evt_apply_error_control_probe',
      'msg_apply_error_control_probe',
      'email.failed',
      concat('provider', chr(10), 'timeout')
    )
  $$,
  '23514',
  'provider error summaries reject control characters'
);

select throws_ok(
  $$
    insert into public.email_provider_events (
      provider_event_id,
      provider_message_id,
      event_type,
      apply_error
    ) values (
      'evt_apply_error_oversize_probe',
      'msg_apply_error_oversize_probe',
      'email.failed',
      repeat('x', 501)
    )
  $$,
  '23514',
  'provider error summaries reject oversized content'
);

select throws_ok(
  $$
    insert into public.email_worker_runs (
      worker_name,
      started_at,
      status,
      error_summary
    ) values (
      'reliable-email-invalid-summary',
      now(),
      'failed',
      'patient_id patient-1'
    )
  $$,
  '23514',
  'worker error summaries reject patient and clinical identifiers'
);

select throws_ok(
  $$
    insert into public.email_worker_runs (
      worker_name,
      started_at,
      status,
      error_summary
    ) values (
      'reliable-email-invalid-password',
      now(),
      'failed',
      'password reset'
    )
  $$,
  '23514',
  'worker error summaries reject passwords and tokens'
);

select throws_ok(
  $$
    insert into public.email_worker_runs (
      worker_name,
      started_at,
      status,
      error_summary
    ) values (
      'reliable-email-invalid-url',
      now(),
      'failed',
      'https://example.test/action'
    )
  $$,
  '23514',
  'worker error summaries reject URLs'
);

select throws_ok(
  $$
    insert into public.email_event_catalog (
      app,
      event_key,
      template_key,
      subject_template,
      from_email,
      reply_to,
      payload_schema,
      category
    ) values (
      'carehub',
      'registration_owner',
      'carehub_registration_owner',
      'CareHub: duplicate',
      'CareHub <support@carefindhub.com>',
      'support@carefindhub.com',
      '{"type":"object","additionalProperties":false,"required":[],"properties":{}}'::jsonb,
      'business'
    )
  $$,
  '23505',
  'duplicate app plus event catalog rows are rejected'
);

select throws_ok(
  $$
    insert into public.email_provider_events (
      provider_event_id,
      provider_message_id,
      event_type,
      safe_metadata
    ) values (
      'evt_core_safe_metadata_probe',
      'msg_core_duplicate_probe',
      'email.delivered',
      '{"source":"duplicate_probe"}'::jsonb
    )
  $$,
  '23505',
  'duplicate provider event ids are rejected'
);

select throws_ok(
  $$
    insert into public.email_worker_runs (
      worker_name,
      started_at,
      status,
      claimed_count
    ) values (
      'minute-email-worker',
      now(),
      'running',
      -1
    )
  $$,
  '23514',
  'worker run counts cannot be negative'
);

select throws_ok(
  $$
    insert into public.email_system_settings (key, value)
    values ('unapproved_setting', '"unsafe"'::jsonb)
  $$,
  '23514',
  'settings reject every key outside the approved allowlist'
);

insert into public.email_event_catalog (
  app,
  event_key,
  template_key,
  subject_template,
  from_email,
  reply_to,
  payload_schema,
  category
)
select
  'carehub',
  'boundary_catalog_64',
  'boundary_catalog_64',
  'CareHub: boundary catalog',
  'CareHub <support@carefindhub.com>',
  'support@carefindhub.com',
  jsonb_build_object(
    'type',
    'object',
    'additionalProperties',
    false,
    'required',
    '[]'::jsonb,
    'properties',
    (
      select jsonb_object_agg(
        format('field_%s', property_number),
        jsonb_build_object('type', 'string', 'maxLength', 16)
      )
      from generate_series(1, 64) as properties(property_number)
    )
  ),
  'business';

select is(
  (
    select count(*)
    from jsonb_object_keys(
      (
        select payload_schema->'properties'
        from public.email_event_catalog
        where event_key = 'boundary_catalog_64'
      )
    )
  ),
  64::bigint,
  'catalog accepts exactly 64 properties'
);

select throws_ok(
  $$
    insert into public.email_event_catalog (
      app,
      event_key,
      template_key,
      subject_template,
      from_email,
      reply_to,
      payload_schema,
      category
    )
    select
      'carehub',
      'boundary_catalog_65',
      'boundary_catalog_65',
      'CareHub: boundary catalog overflow',
      'CareHub <support@carefindhub.com>',
      'support@carefindhub.com',
      jsonb_build_object(
        'type',
        'object',
        'additionalProperties',
        false,
        'required',
        '[]'::jsonb,
        'properties',
        (
          select jsonb_object_agg(
            format('field_%s', property_number),
            jsonb_build_object('type', 'string', 'maxLength', 16)
          )
          from generate_series(1, 65) as properties(property_number)
        )
      ),
      'business'
  $$,
  '23514',
  'catalog rejects exactly 65 properties'
);

insert into public.email_provider_events (
  provider_event_id,
  provider_message_id,
  event_type,
  safe_metadata
)
select
  'evt_metadata_boundary_20',
  'msg_metadata_boundary_20',
  'email.delivered',
  jsonb_object_agg(
    format('metadata_%s', metadata_number),
    'ok'::jsonb
  )
from generate_series(1, 20) as metadata_entries(metadata_number);

select is(
  (
    select count(*)
    from jsonb_object_keys(
      (
        select safe_metadata
        from public.email_provider_events
        where provider_event_id = 'evt_metadata_boundary_20'
      )
    )
  ),
  20::bigint,
  'provider metadata accepts exactly 20 keys'
);

select throws_ok(
  $$
    insert into public.email_provider_events (
      provider_event_id,
      provider_message_id,
      event_type,
      safe_metadata
    )
    select
      'evt_metadata_boundary_21',
      'msg_metadata_boundary_21',
      'email.delivered',
      jsonb_object_agg(
        format('metadata_%s', metadata_number),
        'ok'::jsonb
      )
    from generate_series(1, 21) as metadata_entries(metadata_number)
  $$,
  '23514',
  'provider metadata rejects exactly 21 keys'
);

select * from finish();
rollback;

