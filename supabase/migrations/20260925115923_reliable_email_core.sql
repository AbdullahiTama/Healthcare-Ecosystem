begin;

create function public.email_text_is_safe(p_value text)
returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select p_value is not null
    and coalesce(p_value !~ '[[:cntrl:]]', false);
$$;

create function public.email_catalog_schema_is_valid(
  p_schema jsonb,
  p_subject_template text
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  max_length_text text;
  placeholder text;
  property_entry record;
  required_count bigint;
begin
  if p_schema is null
     or jsonb_typeof(p_schema) is distinct from 'object'
     or octet_length(p_schema::text) > 32768 then
    return false;
  end if;

  if (p_schema ? 'type') is not true
     or p_schema->'type' is distinct from '"object"'::jsonb
     or (p_schema ? 'additionalProperties') is not true
     or p_schema->'additionalProperties' is distinct from 'false'::jsonb
     or (p_schema ? 'properties') is not true
     or jsonb_typeof(p_schema->'properties') is distinct from 'object'
     or (p_schema ? 'required') is not true
     or jsonb_typeof(p_schema->'required') is distinct from 'array' then
    return false;
  end if;

  if (
    select count(*)
    from jsonb_object_keys(p_schema->'properties')
  ) > 64
     or jsonb_array_length(p_schema->'required') > 64 then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_schema->'required') as required_entry(value)
    where jsonb_typeof(required_entry.value) is distinct from 'string'
       or (required_entry.value #>> '{}') !~ '^[a-z][a-z0-9_]{0,79}$'
       or ((p_schema->'properties') ? (required_entry.value #>> '{}')) is not true
  ) then
    return false;
  end if;

  select count(*)
  into required_count
  from jsonb_array_elements(p_schema->'required') as required_entry(value);

  if required_count <> (
    select count(distinct required_entry.value #>> '{}')
    from jsonb_array_elements(p_schema->'required') as required_entry(value)
  ) then
    return false;
  end if;

  for property_entry in
    select property_record.key, property_record.value
    from jsonb_each(p_schema->'properties') as property_record(key, value)
  loop
    if property_entry.key !~ '^[a-z][a-z0-9_]{0,79}$'
       or property_entry.key ~* '(patient|diagnos|clinical|prescription|medical|test[_-]?result|mrn|dob|date[_-]?of[_-]?birth|review|feedback|comment|reason[_-]?text|password|passwd|token|secret|auth|api[_-]?key|credential)' then
      return false;
    end if;

    if jsonb_typeof(property_entry.value) is distinct from 'object'
       or property_entry.value->>'type' is distinct from 'string'
       or (property_entry.value ? 'maxLength') is not true
       or jsonb_typeof(property_entry.value->'maxLength') is distinct from 'number' then
      return false;
    end if;

    max_length_text := property_entry.value->>'maxLength';
    if max_length_text !~ '^[0-9]+([.]0+)?$'
       or property_entry.value->'maxLength' <= '0'::jsonb
       or property_entry.value->'maxLength' > '4096'::jsonb then
      return false;
    end if;
  end loop;

  if p_subject_template is null
     or not public.email_text_is_safe(p_subject_template)
     or regexp_replace(
       p_subject_template,
       '\{\{[a-z][a-z0-9_]*\}\}',
       '',
       'g'
     ) ~ '[\{\}]' then
    return false;
  end if;

  for placeholder in
    select placeholder_record.match[1]
    from regexp_matches(
      p_subject_template,
      '\{\{([a-z][a-z0-9_]*)\}\}',
      'g'
    ) as placeholder_record(match)
  loop
    if ((p_schema->'properties') ? placeholder) is not true
       or not exists (
         select 1
         from jsonb_array_elements_text(p_schema->'required') as required_entry(required_field)
         where required_entry.required_field = placeholder
       ) then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create function public.email_safe_metadata_is_valid(p_metadata jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  metadata_entry record;
  value_text text;
begin
  if p_metadata is null
     or jsonb_typeof(p_metadata) is distinct from 'object' then
    return false;
  end if;

  if (
    select count(*)
    from jsonb_object_keys(p_metadata)
  ) > 20
     or octet_length(p_metadata::text) > 2048 then
    return false;
  end if;

  for metadata_entry in
    select metadata_record.key, metadata_record.value
    from jsonb_each(p_metadata) as metadata_record(key, value)
  loop
    if metadata_entry.key !~ '^[a-z][a-z0-9_]{0,63}$'
       or metadata_entry.key ~* '(patient|diagnos|clinical|prescription|medical|test[_-]?result|mrn|dob|date[_-]?of[_-]?birth|review|feedback|comment|reason[_-]?text|password|passwd|token|secret|auth|api[_-]?key|credential|email|recipient|address|body|html|action[_-]?(link|url)|redirect|raw|full)' then
      return false;
    end if;

    if jsonb_typeof(metadata_entry.value) not in ('string', 'number', 'boolean', 'null') then
      return false;
    end if;

    value_text := metadata_entry.value #>> '{}';

    if jsonb_typeof(metadata_entry.value) = 'string' then
      if char_length(value_text) > 256
         or coalesce(value_text ~ '[[:cntrl:]]', false)
         or coalesce(value_text ~* '[-A-Za-z0-9._%+~]+@[-A-Za-z0-9]+([.][-A-Za-z0-9]+)*', false)
         or coalesce(value_text ~* '(https?://|ftp://|mailto:|data:|www[.]|//[a-z0-9-]|[a-z][a-z0-9+.-]*://|[a-z0-9-]+([.][a-z0-9-]+)+[/:?])', false)
         or coalesce(value_text ~* '(patient|diagnos|clinical|prescription|medical|test[_-]?result|mrn|dob|date[_-]?of[_-]?birth|review[_-]?(reason|text|note)|reason[_-]?text|password|passwd|token|secret|api[_-]?key|auth[_-]?(proof|secret|token)|authorization|bearer|credential|sk_(live|test)_|xox[baprs]-|gh[pousr]_|eyJ[-A-Za-z0-9_]+[.][-A-Za-z0-9_]+[.][-A-Za-z0-9_]+)', false) then
        return false;
      end if;
    elsif jsonb_typeof(metadata_entry.value) = 'number' then
      if metadata_entry.value < '-1000000000'::jsonb
         or metadata_entry.value > '1000000000'::jsonb then
        return false;
      end if;
    end if;
  end loop;

  return true;
end;
$$;

create function public.email_safe_summary_is_valid(p_summary text)
returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select p_summary is null
    or (
      char_length(p_summary) between 1 and 500
      and btrim(p_summary) <> ''
      and coalesce(p_summary !~ '[[:cntrl:]]', false)
      and coalesce(p_summary !~* '[-A-Za-z0-9._%+~]+@[-A-Za-z0-9]+([.][-A-Za-z0-9]+)*', false)
      and coalesce(p_summary !~* '(https?://|ftp://|mailto:|data:|www[.]|//[a-z0-9-]|[a-z][a-z0-9+.-]*://|[a-z0-9-]+([.][a-z0-9-]+)+[/:?])', false)
      and coalesce(p_summary !~* '(patient|diagnos|clinical|prescription|medical|test[_-]?result|mrn|dob|date[_-]?of[_-]?birth|review[_-]?(reason|text|note)|reason[_-]?text|password|passwd|token|secret|api[_-]?key|auth[_-]?(proof|secret|token)|authorization|bearer|credential|sk_(live|test)_|xox[baprs]-|gh[pousr]_|eyJ[-A-Za-z0-9_]+[.][-A-Za-z0-9_]+[.][-A-Za-z0-9_]+)', false)
    );
$$;

revoke all on function public.email_text_is_safe(text) from public, anon, authenticated;
grant execute on function public.email_text_is_safe(text) to service_role;

revoke all on function public.email_catalog_schema_is_valid(jsonb, text) from public, anon, authenticated;
grant execute on function public.email_catalog_schema_is_valid(jsonb, text) to service_role;

revoke all on function public.email_safe_metadata_is_valid(jsonb) from public, anon, authenticated;
grant execute on function public.email_safe_metadata_is_valid(jsonb) to service_role;

revoke all on function public.email_safe_summary_is_valid(text) from public, anon, authenticated;
grant execute on function public.email_safe_summary_is_valid(text) to service_role;

create table public.email_event_catalog (
  id uuid primary key default gen_random_uuid(),
  app text not null,
  event_key text not null,
  template_key text not null,
  subject_template text not null,
  from_email text not null,
  reply_to text not null,
  payload_schema jsonb not null,
  enabled boolean not null default false,
  required_for_business boolean not null default false,
  category text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_event_catalog_app_event_key_key unique (app, event_key),
  constraint email_event_catalog_app_check check (
    app in ('carehub', 'carefind')
    and public.email_text_is_safe(app)
  ),
  constraint email_event_catalog_brand_check check (
    (app = 'carehub'
      and from_email = 'CareHub <support@carefindhub.com>'
      and reply_to = 'support@carefindhub.com'
      and subject_template like 'CareHub:%')
    or (app = 'carefind'
      and from_email = 'CareFind <support@carefind.app>'
      and reply_to = 'support@carefind.app'
      and subject_template like 'CareFind:%')
  ),
  constraint email_event_catalog_event_key_check check (
    event_key ~ '^[a-z][a-z0-9_]{1,79}$'
    and public.email_text_is_safe(event_key)
  ),
  constraint email_event_catalog_template_key_check check (
    template_key ~ '^[a-z][a-z0-9_]{1,127}$'
    and public.email_text_is_safe(template_key)
  ),
  constraint email_event_catalog_subject_template_check check (
    char_length(subject_template) between 1 and 998
    and public.email_text_is_safe(subject_template)
  ),
  constraint email_event_catalog_from_email_check check (
    char_length(from_email) between 3 and 320
    and btrim(from_email) <> ''
    and public.email_text_is_safe(from_email)
  ),
  constraint email_event_catalog_reply_to_check check (
    char_length(reply_to) between 3 and 320
    and btrim(reply_to) <> ''
    and public.email_text_is_safe(reply_to)
  ),
  constraint email_event_catalog_payload_schema_check check (
    public.email_catalog_schema_is_valid(payload_schema, subject_template)
  ),
  constraint email_event_catalog_category_check check (
    char_length(category) between 1 and 64
    and btrim(category) <> ''
    and public.email_text_is_safe(category)
  )
);

create table public.email_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null,
  provider_message_id text not null,
  event_type text not null,
  outbox_id uuid references public.email_outbox (id) on delete set null,
  safe_metadata jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  applied_at timestamptz,
  apply_error text,
  created_at timestamptz not null default now(),
  constraint email_provider_events_provider_event_id_key unique (provider_event_id),
  constraint email_provider_events_provider_event_id_check check (
    char_length(provider_event_id) between 1 and 255
    and btrim(provider_event_id) <> ''
    and public.email_text_is_safe(provider_event_id)
  ),
  constraint email_provider_events_provider_message_id_check check (
    char_length(provider_message_id) between 1 and 255
    and btrim(provider_message_id) <> ''
    and public.email_text_is_safe(provider_message_id)
  ),
  constraint email_provider_events_event_type_check check (
    char_length(event_type) between 1 and 128
    and btrim(event_type) <> ''
    and public.email_text_is_safe(event_type)
  ),
  constraint email_provider_events_safe_metadata_check check (
    public.email_safe_metadata_is_valid(safe_metadata)
  ),
  constraint email_provider_events_apply_error_check check (
    public.email_safe_summary_is_valid(apply_error)
  )
);

create table public.email_worker_runs (
  id uuid primary key default gen_random_uuid(),
  worker_name text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null,
  claimed_count integer not null default 0,
  accepted_count integer not null default 0,
  failed_count integer not null default 0,
  dead_count integer not null default 0,
  duration_ms integer,
  error_summary text,
  constraint email_worker_runs_worker_name_check check (
    char_length(worker_name) between 1 and 128
    and btrim(worker_name) <> ''
    and public.email_text_is_safe(worker_name)
  ),
  constraint email_worker_runs_status_check check (
    char_length(status) between 1 and 64
    and btrim(status) <> ''
    and public.email_text_is_safe(status)
  ),
  constraint email_worker_runs_counts_check check (
    claimed_count >= 0
    and accepted_count >= 0
    and failed_count >= 0
    and dead_count >= 0
  ),
  constraint email_worker_runs_duration_check check (
    duration_ms is null or duration_ms >= 0
  ),
  constraint email_worker_runs_completion_check check (
    completed_at is null or completed_at >= started_at
  ),
  constraint email_worker_runs_error_summary_check check (
    public.email_safe_summary_is_valid(error_summary)
  )
);

create table public.email_system_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint email_system_settings_key_check check (
    key in ('carehub_admin_email', 'dispatch_paused')
  ),
  constraint email_system_settings_value_type_check check (
    (key = 'carehub_admin_email' and jsonb_typeof(value) = 'string')
    or (key = 'dispatch_paused' and jsonb_typeof(value) = 'boolean')
  )
);

revoke all privileges on table public.email_outbox from public, anon, authenticated;
revoke all privileges on table public.email_logs from public, anon, authenticated;
revoke all privileges on table public.email_event_catalog from public, anon, authenticated;
revoke all privileges on table public.email_provider_events from public, anon, authenticated;
revoke all privileges on table public.email_worker_runs from public, anon, authenticated;
revoke all privileges on table public.email_system_settings from public, anon, authenticated;

revoke all privileges on table public.email_outbox from service_role;
revoke all privileges on table public.email_logs from service_role;
revoke all privileges on table public.email_event_catalog from service_role;
revoke all privileges on table public.email_provider_events from service_role;
revoke all privileges on table public.email_worker_runs from service_role;
revoke all privileges on table public.email_system_settings from service_role;

grant select, insert, update, delete on table public.email_outbox to service_role;
grant select, insert, update, delete on table public.email_logs to service_role;
grant select, insert, update, delete on table public.email_event_catalog to service_role;
grant select, insert, update, delete on table public.email_provider_events to service_role;
grant select, insert, update, delete on table public.email_worker_runs to service_role;
grant select, insert, update, delete on table public.email_system_settings to service_role;

create unique index uq_email_outbox_provider_id
  on public.email_outbox (provider_id)
  where provider_id is not null;

create index idx_email_provider_events_provider_message_applied
  on public.email_provider_events (provider_message_id, applied_at);

create index idx_email_provider_events_outbox_id
  on public.email_provider_events (outbox_id)
  where outbox_id is not null;

create index idx_email_worker_runs_started_at
  on public.email_worker_runs (started_at desc);

create index idx_email_system_settings_updated_by
  on public.email_system_settings (updated_by)
  where updated_by is not null;

with catalog_seed (
  app,
  event_key,
  template_key,
  subject_template,
  category,
  payload_schema
) as (
  values
    (
      'carehub',
      'registration_owner',
      'carehub_registration_owner',
      'CareHub: Registration received',
      'business',
      $schema${"type":"object","additionalProperties":false,"required":["owner_name","business_name"],"properties":{"owner_name":{"type":"string","maxLength":120},"business_name":{"type":"string","maxLength":160}}}$schema$::jsonb
    ),
    (
      'carehub',
      'admin_new_registration',
      'carehub_admin_registration',
      'CareHub: New business registration',
      'business',
      $schema${"type":"object","additionalProperties":false,"required":["business_name","owner_name","business_type","state","owner_email"],"properties":{"business_name":{"type":"string","maxLength":160},"owner_name":{"type":"string","maxLength":120},"business_type":{"type":"string","maxLength":120},"state":{"type":"string","maxLength":120},"owner_email":{"type":"string","format":"email","maxLength":320}}}$schema$::jsonb
    ),
    (
      'carehub',
      'business_approved',
      'carehub_business_approved',
      'CareHub: {{business_name}} is approved',
      'business',
      $schema${"type":"object","additionalProperties":false,"required":["business_name","owner_name"],"properties":{"business_name":{"type":"string","maxLength":160},"owner_name":{"type":"string","maxLength":120}}}$schema$::jsonb
    ),
    (
      'carehub',
      'business_rejected',
      'carehub_business_rejected',
      'CareHub: Business application update',
      'business',
      $schema${"type":"object","additionalProperties":false,"required":["business_name","owner_name"],"properties":{"business_name":{"type":"string","maxLength":160},"owner_name":{"type":"string","maxLength":120}}}$schema$::jsonb
    ),
    (
      'carehub',
      'business_suspended',
      'carehub_business_suspended',
      'CareHub: Your business account is suspended',
      'business',
      $schema${"type":"object","additionalProperties":false,"required":["business_name","owner_name"],"properties":{"business_name":{"type":"string","maxLength":160},"owner_name":{"type":"string","maxLength":120}}}$schema$::jsonb
    ),
    (
      'carehub',
      'business_reactivated',
      'carehub_business_reactivated',
      'CareHub: Your business account is active again',
      'business',
      $schema${"type":"object","additionalProperties":false,"required":["business_name","owner_name"],"properties":{"business_name":{"type":"string","maxLength":160},"owner_name":{"type":"string","maxLength":120}}}$schema$::jsonb
    ),
    (
      'carehub',
      'business_revoked',
      'carehub_business_revoked',
      'CareHub: Your business access has been revoked',
      'business',
      $schema${"type":"object","additionalProperties":false,"required":["business_name","owner_name"],"properties":{"business_name":{"type":"string","maxLength":160},"owner_name":{"type":"string","maxLength":120}}}$schema$::jsonb
    ),
    (
      'carehub',
      'appointment_confirmed',
      'carehub_appointment_confirmed',
      'CareHub: Your appointment is confirmed',
      'transactional',
      $schema${"type":"object","additionalProperties":false,"required":["recipient_name","business_name","appointment_date","appointment_time"],"properties":{"recipient_name":{"type":"string","maxLength":120},"business_name":{"type":"string","maxLength":160},"appointment_date":{"type":"string","maxLength":64},"appointment_time":{"type":"string","maxLength":64},"service_label":{"type":"string","maxLength":120},"staff_name":{"type":"string","maxLength":120}}}$schema$::jsonb
    ),
    (
      'carehub',
      'subscription_created',
      'carehub_subscription_created',
      'CareHub: Your {{plan_name}} subscription is active',
      'transactional',
      $schema${"type":"object","additionalProperties":false,"required":["recipient_name","business_name","plan_name","expiry_date"],"properties":{"recipient_name":{"type":"string","maxLength":120},"business_name":{"type":"string","maxLength":160},"plan_name":{"type":"string","maxLength":120},"expiry_date":{"type":"string","maxLength":64}}}$schema$::jsonb
    ),
    (
      'carehub',
      'subscription_expiry',
      'carehub_subscription_expiry',
      'CareHub: Subscription expiring soon',
      'transactional',
      $schema${"type":"object","additionalProperties":false,"required":["recipient_name","business_name","plan_name","expiry_date"],"properties":{"recipient_name":{"type":"string","maxLength":120},"business_name":{"type":"string","maxLength":160},"plan_name":{"type":"string","maxLength":120},"expiry_date":{"type":"string","maxLength":64}}}$schema$::jsonb
    ),
    (
      'carehub',
      'purchase_confirmed',
      'carehub_purchase_confirmed',
      'CareHub: Purchase {{purchase_reference}} confirmed',
      'transactional',
      $schema${"type":"object","additionalProperties":false,"required":["recipient_name","business_name","purchase_reference","total_amount"],"properties":{"recipient_name":{"type":"string","maxLength":120},"business_name":{"type":"string","maxLength":160},"purchase_reference":{"type":"string","maxLength":80},"total_amount":{"type":"string","maxLength":64}}}$schema$::jsonb
    ),
    (
      'carehub',
      'order_status_update',
      'carehub_order_status_update',
      'CareHub: Order {{order_reference}} status updated',
      'transactional',
      $schema${"type":"object","additionalProperties":false,"required":["recipient_name","business_name","order_reference","status"],"properties":{"recipient_name":{"type":"string","maxLength":120},"business_name":{"type":"string","maxLength":160},"order_reference":{"type":"string","maxLength":80},"status":{"type":"string","enum":["processing","packed","shipped","delivered","cancelled"],"maxLength":32}}}$schema$::jsonb
    ),
    (
      'carehub',
      'password_reset',
      'carehub_password_reset',
      'CareHub: Reset your password',
      'auth',
      $schema${"type":"object","additionalProperties":false,"required":["display_name","action_link","action_label"],"properties":{"display_name":{"type":"string","maxLength":120},"action_link":{"type":"string","format":"uri","pattern":"^https://carefindhub\\.com/","maxLength":2048},"action_label":{"type":"string","enum":["Reset password"],"maxLength":32}}}$schema$::jsonb
    ),
    (
      'carehub',
      'email_verification',
      'carehub_email_verification',
      'CareHub: Verify your email',
      'auth',
      $schema${"type":"object","additionalProperties":false,"required":["display_name","action_link","action_label"],"properties":{"display_name":{"type":"string","maxLength":120},"action_link":{"type":"string","format":"uri","pattern":"^https://carefindhub\\.com/","maxLength":2048},"action_label":{"type":"string","enum":["Verify email"],"maxLength":32}}}$schema$::jsonb
    ),
    (
      'carehub',
      'staff_welcome',
      'carehub_staff_welcome',
      'CareHub: Welcome to {{business_name}}',
      'staff',
      $schema${"type":"object","additionalProperties":false,"required":["recipient_name","business_name","role_label","setup_link"],"properties":{"recipient_name":{"type":"string","maxLength":120},"business_name":{"type":"string","maxLength":160},"role_label":{"type":"string","maxLength":120},"setup_link":{"type":"string","format":"uri","pattern":"^https://carefindhub\\.com/","maxLength":2048},"expires_at":{"type":"string","maxLength":64}}}$schema$::jsonb
    ),
    (
      'carefind',
      'customer_registration',
      'carefind_customer_registration',
      'CareFind: Verify your email and get started',
      'auth',
      $schema${"type":"object","additionalProperties":false,"required":["display_name","action_link","action_label"],"properties":{"display_name":{"type":"string","maxLength":120},"action_link":{"type":"string","format":"uri","pattern":"^https://carefind\\.app/","maxLength":2048},"action_label":{"type":"string","enum":["Verify email and get started"],"maxLength":64}}}$schema$::jsonb
    ),
    (
      'carefind',
      'order_confirmation',
      'carefind_order_confirmation',
      'CareFind: Order {{order_reference}} confirmed',
      'transactional',
      $schema${"type":"object","additionalProperties":false,"required":["recipient_name","business_name","order_reference","item_summary","total_amount"],"properties":{"recipient_name":{"type":"string","maxLength":120},"business_name":{"type":"string","maxLength":160},"order_reference":{"type":"string","maxLength":80},"item_summary":{"type":"string","maxLength":1000},"total_amount":{"type":"string","maxLength":64},"delivery_region":{"type":"string","maxLength":160}}}$schema$::jsonb
    ),
    (
      'carefind',
      'booking_confirmed',
      'carefind_booking_confirmed',
      'CareFind: Booking {{booking_reference}} confirmed',
      'transactional',
      $schema${"type":"object","additionalProperties":false,"required":["recipient_name","business_name","booking_reference","appointment_date","appointment_time"],"properties":{"recipient_name":{"type":"string","maxLength":120},"business_name":{"type":"string","maxLength":160},"booking_reference":{"type":"string","maxLength":80},"appointment_date":{"type":"string","maxLength":64},"appointment_time":{"type":"string","maxLength":64},"service_label":{"type":"string","maxLength":120}}}$schema$::jsonb
    ),
    (
      'carefind',
      'order_status_update',
      'carefind_order_status_update',
      'CareFind: Order {{order_reference}} status updated',
      'transactional',
      $schema${"type":"object","additionalProperties":false,"required":["recipient_name","business_name","order_reference","status"],"properties":{"recipient_name":{"type":"string","maxLength":120},"business_name":{"type":"string","maxLength":160},"order_reference":{"type":"string","maxLength":80},"status":{"type":"string","enum":["processing","packed","shipped","delivered","cancelled"],"maxLength":32}}}$schema$::jsonb
    ),
    (
      'carefind',
      'appointment_confirmed',
      'carefind_appointment_confirmed',
      'CareFind: Your appointment is confirmed',
      'transactional',
      $schema${"type":"object","additionalProperties":false,"required":["recipient_name","business_name","appointment_date","appointment_time"],"properties":{"recipient_name":{"type":"string","maxLength":120},"business_name":{"type":"string","maxLength":160},"appointment_date":{"type":"string","maxLength":64},"appointment_time":{"type":"string","maxLength":64},"service_label":{"type":"string","maxLength":120},"staff_name":{"type":"string","maxLength":120}}}$schema$::jsonb
    ),
    (
      'carefind',
      'subscription_created',
      'carefind_subscription_created',
      'CareFind: Subscription to {{business_name}} is active',
      'transactional',
      $schema${"type":"object","additionalProperties":false,"required":["recipient_name","business_name","plan_name","expiry_date"],"properties":{"recipient_name":{"type":"string","maxLength":120},"business_name":{"type":"string","maxLength":160},"plan_name":{"type":"string","maxLength":120},"expiry_date":{"type":"string","maxLength":64}}}$schema$::jsonb
    ),
    (
      'carefind',
      'subscription_expiry',
      'carefind_subscription_expiry',
      'CareFind: Subscription expiring soon',
      'transactional',
      $schema${"type":"object","additionalProperties":false,"required":["recipient_name","business_name","plan_name","expiry_date"],"properties":{"recipient_name":{"type":"string","maxLength":120},"business_name":{"type":"string","maxLength":160},"plan_name":{"type":"string","maxLength":120},"expiry_date":{"type":"string","maxLength":64}}}$schema$::jsonb
    ),
    (
      'carefind',
      'purchase_confirmed',
      'carefind_purchase_confirmed',
      'CareFind: Purchase {{purchase_reference}} confirmed',
      'transactional',
      $schema${"type":"object","additionalProperties":false,"required":["recipient_name","business_name","purchase_reference","total_amount"],"properties":{"recipient_name":{"type":"string","maxLength":120},"business_name":{"type":"string","maxLength":160},"purchase_reference":{"type":"string","maxLength":80},"total_amount":{"type":"string","maxLength":64}}}$schema$::jsonb
    ),
    (
      'carefind',
      'password_reset',
      'carefind_password_reset',
      'CareFind: Reset your password',
      'auth',
      $schema${"type":"object","additionalProperties":false,"required":["display_name","action_link","action_label"],"properties":{"display_name":{"type":"string","maxLength":120},"action_link":{"type":"string","format":"uri","pattern":"^https://carefind\\.app/","maxLength":2048},"action_label":{"type":"string","enum":["Reset password"],"maxLength":32}}}$schema$::jsonb
    ),
    (
      'carefind',
      'email_verification',
      'carefind_email_verification',
      'CareFind: Verify your email',
      'auth',
      $schema${"type":"object","additionalProperties":false,"required":["display_name","action_link","action_label"],"properties":{"display_name":{"type":"string","maxLength":120},"action_link":{"type":"string","format":"uri","pattern":"^https://carefind\\.app/","maxLength":2048},"action_label":{"type":"string","enum":["Verify email"],"maxLength":32}}}$schema$::jsonb
    )
)
insert into public.email_event_catalog (
  app,
  event_key,
  template_key,
  subject_template,
  from_email,
  reply_to,
  payload_schema,
  enabled,
  required_for_business,
  category
)
select
  catalog_seed.app,
  catalog_seed.event_key,
  catalog_seed.template_key,
  catalog_seed.subject_template,
  case catalog_seed.app
    when 'carehub' then 'CareHub <support@carefindhub.com>'
    when 'carefind' then 'CareFind <support@carefind.app>'
  end,
  case catalog_seed.app
    when 'carehub' then 'support@carefindhub.com'
    when 'carefind' then 'support@carefind.app'
  end,
  catalog_seed.payload_schema,
  false,
  false,
  catalog_seed.category
from catalog_seed;

insert into public.email_system_settings (key, value)
values
  ('carehub_admin_email', '"admin@carefindhub.com"'::jsonb),
  ('dispatch_paused', 'false'::jsonb)
on conflict (key) do nothing;

alter table public.email_outbox enable row level security;
alter table public.email_logs enable row level security;
alter table public.email_event_catalog enable row level security;
alter table public.email_provider_events enable row level security;
alter table public.email_worker_runs enable row level security;
alter table public.email_system_settings enable row level security;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'email_outbox',
        'email_logs',
        'email_event_catalog',
        'email_provider_events',
        'email_worker_runs',
        'email_system_settings'
      )
  loop
    execute format(
      'drop policy %I on public.%I',
      policy_record.policyname,
      policy_record.tablename
    );
  end loop;
end;
$$;

commit;

