-- The e-mail system as production has it, reduced to what the catalog-governed enqueue path touches.
-- The three functions are copied verbatim from production (pg_get_functiondef, 2026-10-21); the tables carry production's
-- constraints that matter here (strict payload schema, brand check, unprefixed template key, once-per-source uniqueness).
create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_email text not null, from_email text not null, subject text not null, template_key text not null,
  payload jsonb not null, status text not null default 'pending', attempts integer not null default 0, max_attempts integer not null default 5,
  next_retry_at timestamptz not null default now(), app text, event_key text, source_id uuid, payload_schema_snapshot jsonb,
  reply_to text, is_canary boolean not null default false, created_at timestamptz not null default now()
);
create unique index email_outbox_app_event_source_unique on public.email_outbox (app, event_key, source_id);
create table public.email_logs (id uuid primary key default gen_random_uuid(), outbox_id uuid, event_type text, detail text, metadata jsonb, created_at timestamptz default now());
create table public.email_event_catalog (
  app text not null, event_key text not null, template_key text not null, subject_template text not null, from_email text not null,
  reply_to text, payload_schema jsonb not null default '{"type":"object","required":[],"properties":{},"additionalProperties":false}'::jsonb,
  enabled boolean not null default false, required_for_business boolean not null default false, category text not null default 'transactional',
  rollout_mode text not null default 'live',
  primary key (app, event_key),
  constraint email_event_catalog_payload_schema_check check (payload_schema->'type' = '"object"'::jsonb and payload_schema->'additionalProperties' = 'false'::jsonb and payload_schema ? 'properties' and payload_schema ? 'required'),
  constraint email_event_catalog_brand_check check ((app = 'carehub' and from_email = 'CareHub <support@mail.carefindhub.com>' and reply_to = 'support@mail.carefindhub.com' and subject_template like 'CareHub:%') or (app = 'carefind' and from_email = 'CareFind <support@mail.carefind.app>' and reply_to = 'support@mail.carefind.app' and subject_template like 'CareFind:%')),
  constraint email_event_catalog_template_key_unprefixed_check check (template_key !~ '^(carehub|carefind)_')
);

CREATE OR REPLACE FUNCTION public.email_text_is_safe(p_value text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  select p_value is not null
    and coalesce(p_value !~ '[[:cntrl:]]', false);
$function$;

CREATE OR REPLACE FUNCTION public.email_payload_schema_matches(p_schema jsonb, p_payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  prop_name text;
  prop_def jsonb;
  value_text text;
  v_max_length numeric;
  v_format text;
  v_pattern text;
begin
  if p_payload is null
     or jsonb_typeof(p_payload) is distinct from 'object'
     or p_schema is null
     or jsonb_typeof(p_schema) is distinct from 'object' then
    return false;
  end if;

  for prop_name in
    select jsonb_array_elements_text(p_schema->'required')
  loop
    value_text := p_payload->>prop_name;
    if value_text is null or value_text = '' then
      return false;
    end if;
  end loop;

  for prop_name in
    select jsonb_object_keys(p_payload)
  loop
    if (p_schema->'properties' ? prop_name) is not true then
      return false;
    end if;

    prop_def := p_schema->'properties'->prop_name;

    if jsonb_typeof(p_payload->prop_name) is distinct from 'string' then
      return false;
    end if;

    value_text := p_payload->>prop_name;

    v_max_length := (prop_def->>'maxLength')::numeric;
    if v_max_length is null
       or char_length(value_text) > v_max_length then
      return false;
    end if;

    if prop_def ? 'enum' then
      if not exists (
        select 1
        from jsonb_array_elements_text(prop_def->'enum') as ev
        where ev = value_text
      ) then
        return false;
      end if;
    end if;

    if prop_def ? 'format' then
      v_format := prop_def->>'format';
      if v_format = 'email'
         and value_text !~ '^[^@]+@[^@]+\.[^@]+$' then
        return false;
      end if;
      if v_format = 'uri'
         and value_text !~ '^https?://' then
        return false;
      end if;
    end if;

    if prop_def ? 'pattern' then
      v_pattern := prop_def->>'pattern';
      if v_pattern is not null
         and value_text !~ v_pattern then
        return false;
      end if;
    end if;

    if not public.email_text_is_safe(value_text) then
      return false;
    end if;
  end loop;

  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_business_email_event(p_app text, p_event_key text, p_to_email text, p_payload jsonb, p_source_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_catalog_row record;
  v_subject     text;
  v_outbox_id   uuid;
  v_placeholder text;
  v_is_canary   boolean := false;
begin
  if p_app is null
     or btrim(p_app) = ''
     or public.email_text_is_safe(p_app) is not true
     or p_event_key is null
     or btrim(p_event_key) = ''
     or public.email_text_is_safe(p_event_key) is not true
     or p_to_email is null
     or btrim(p_to_email) = ''
     or public.email_text_is_safe(p_to_email) is not true
     or position('@' in p_to_email) = 0
     or p_source_id is null
  then
    raise exception 'invalid_enqueue_parameters';
  end if;

  select * into v_catalog_row
    from public.email_event_catalog
   where app = p_app and event_key = p_event_key
   limit 1;

  if v_catalog_row is null then
    raise exception 'unknown_catalog_event';
  end if;

  if v_catalog_row.category = 'auth' then
    raise exception 'auth_events_require_separate_path';
  end if;

  if (not v_catalog_row.enabled) or v_catalog_row.rollout_mode = 'paused' then
    if v_catalog_row.required_for_business then
      raise exception 'required_event_is_disabled';
    end if;

    insert into public.email_logs (outbox_id, event_type, detail, metadata)
    values (
      null,
      'suppressed',
      format(
        'Suppressed %s:%s (enabled=%s, rollout_mode=%s, required=%s)',
        p_app, p_event_key, v_catalog_row.enabled,
        v_catalog_row.rollout_mode, v_catalog_row.required_for_business
      ),
      jsonb_build_object(
        'app', p_app,
        'event_key', p_event_key,
        'source_id', p_source_id,
        'enabled', v_catalog_row.enabled,
        'rollout_mode', v_catalog_row.rollout_mode,
        'required_for_business', v_catalog_row.required_for_business
      )
    );

    return null;
  end if;

  if not public.email_payload_schema_matches(v_catalog_row.payload_schema, p_payload) then
    raise exception 'payload_schema_mismatch';
  end if;

  v_subject := v_catalog_row.subject_template;
  while v_subject ~ '\{\{[a-z][a-z0-9_]*\}\}' loop
    v_placeholder := coalesce((regexp_match(v_subject, '\{\{([a-z][a-z0-9_]*)\}\}'))[1], '');
    if v_placeholder is null or v_placeholder = '' then
      v_subject := regexp_replace(v_subject, '\{\{[a-z][a-z0-9_]*\}\}', '{{missing}}', 'g');
      exit;
    end if;
    v_subject := replace(
      v_subject,
      '{{' || v_placeholder || '}}',
      coalesce(p_payload ->> v_placeholder, '{{missing}}')
    );
  end loop;

  v_is_canary := (v_catalog_row.rollout_mode = 'canary');

  insert into public.email_outbox (
    to_email, from_email, subject, template_key, payload, status, attempts,
    max_attempts, next_retry_at, app, event_key, source_id,
    payload_schema_snapshot, reply_to, is_canary
  )
  values (
    p_to_email, v_catalog_row.from_email, v_subject, v_catalog_row.template_key,
    p_payload, 'pending', 0, 5, now(), p_app, p_event_key, p_source_id,
    v_catalog_row.payload_schema, v_catalog_row.reply_to, v_is_canary
  )
  on conflict (app, event_key, source_id) do nothing
  returning id into v_outbox_id;

  if v_outbox_id is null then
    select id into v_outbox_id
      from public.email_outbox
     where app = p_app and event_key = p_event_key and source_id = p_source_id
     limit 1;
  else
    insert into public.email_logs (outbox_id, event_type, detail, metadata)
    values (
      v_outbox_id,
      'enqueued',
      format('Queued %s:%s%s', p_app, p_event_key,
             case when v_is_canary then ' (canary)' else '' end),
      jsonb_build_object('source_id', p_source_id, 'is_canary', v_is_canary)
    );
  end if;

  return v_outbox_id;
end;
$function$;
