begin;

alter table public.email_outbox
  add column if not exists source_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_outbox'::regclass
      and conname = 'email_outbox_app_event_source_unique'
  ) then
    alter table public.email_outbox
      add constraint email_outbox_app_event_source_unique
      unique (app, event_key, source_id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_outbox'::regclass
      and conname = 'email_outbox_app_event_key_fkey'
  ) then
    alter table public.email_outbox
      add constraint email_outbox_app_event_key_fkey
      foreign key (app, event_key)
      references public.email_event_catalog (app, event_key);
  end if;
end;
$$;

create or replace function public.email_payload_schema_matches(
  p_schema jsonb,
  p_payload jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
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
$$;

create function public.enqueue_business_email_event(
  p_app text,
  p_event_key text,
  p_to_email text,
  p_payload jsonb,
  p_source_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_catalog_row record;
  v_subject text;
  v_outbox_id uuid;
  v_placeholder text;
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
     or p_source_id is null then
    raise exception 'invalid_enqueue_parameters';
  end if;

  select *
    into v_catalog_row
    from public.email_event_catalog
    where app = p_app
      and event_key = p_event_key
    limit 1;

  if v_catalog_row is null then
    raise exception 'unknown_catalog_event';
  end if;

  if v_catalog_row.category = 'auth' then
    raise exception 'auth_events_require_separate_path';
  end if;

  if not v_catalog_row.enabled then
    if v_catalog_row.required_for_business then
      raise exception 'required_event_is_disabled';
    end if;
    return null;
  end if;

  if not public.email_payload_schema_matches(
    v_catalog_row.payload_schema,
    p_payload
  ) then
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
      coalesce(p_payload->>v_placeholder, '{{missing}}')
    );
  end loop;

  insert into public.email_outbox (
    to_email,
    from_email,
    subject,
    template_key,
    payload,
    status,
    attempts,
    max_attempts,
    next_retry_at,
    app,
    event_key,
    source_id,
    payload_schema_snapshot,
    reply_to
  )
  values (
    p_to_email,
    v_catalog_row.from_email,
    v_subject,
    v_catalog_row.template_key,
    p_payload,
    'pending',
    0,
    5,
    now(),
    p_app,
    p_event_key,
    p_source_id,
    v_catalog_row.payload_schema,
    v_catalog_row.reply_to
  )
  on conflict (app, event_key, source_id)
  do nothing
  returning id into v_outbox_id;

  if v_outbox_id is null then
    select id into v_outbox_id
    from public.email_outbox
    where app = p_app
      and event_key = p_event_key
      and source_id = p_source_id
    limit 1;
  else
    insert into public.email_logs (
      outbox_id,
      event_type,
      detail,
      metadata
    )
    values (
      v_outbox_id,
      'enqueued',
      format('Queued %s:%s', p_app, p_event_key),
      jsonb_build_object('source_id', p_source_id)
    );
  end if;

  return v_outbox_id;
end;
$$;

drop trigger if exists trg_shop_orders_status_email on public.shop_orders;

create or replace function public.enqueue_shop_order_status_email()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_order record;
  v_business_name text;
  v_template_status text;
  v_source_id uuid;
begin
  if new.to_status is null then
    return new;
  end if;

  v_template_status := case new.to_status
    when 'packed' then 'packed'
    when 'in_transit' then 'shipped'
    when 'delivered' then 'delivered'
    when 'cancelled' then 'cancelled'
    when 'rejected' then 'cancelled'
    when 'accepted' then 'processing'
    when 'processing' then 'processing'
    when 'at_pickup_station' then 'processing'
    when 'ready_for_pickup' then 'processing'
    else null
  end;

  if v_template_status is null then
    return new;
  end if;

  select o.* into v_order
  from public.shop_orders o
  where o.id = new.order_id;

  if v_order is null then
    return new;
  end if;

  if v_order.delivery_email is null
     or position('@' in v_order.delivery_email) = 0 then
    return new;
  end if;

  select b.name into v_business_name
  from public.businesses b
  where b.id = v_order.vendor_business_id;

  v_source_id := new.id;

  perform public.enqueue_business_email_event(
    'carefind',
    'order_status_update',
    v_order.delivery_email,
    jsonb_build_object(
      'recipient_name', coalesce(v_order.customer_name, 'Valued Customer'),
      'business_name', coalesce(v_business_name, 'CareFind'),
      'order_reference', v_order.order_ref,
      'status', v_template_status
    ),
    v_source_id
  );

  return new;
end;
$$;

create trigger trg_shop_order_status_history_email
  after insert
  on public.shop_order_status_history
  for each row
  execute function public.enqueue_shop_order_status_email();

revoke all on function public.email_payload_schema_matches(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.email_payload_schema_matches(jsonb, jsonb) to service_role;

revoke all on function public.enqueue_business_email_event(text, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.enqueue_business_email_event(text, text, text, jsonb, uuid) to service_role;

revoke all on function public.enqueue_shop_order_status_email() from public, anon, authenticated;
grant execute on function public.enqueue_shop_order_status_email() to service_role;

commit;
