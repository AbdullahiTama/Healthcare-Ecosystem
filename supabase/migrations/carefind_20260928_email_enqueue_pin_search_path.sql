-- Pins the search_path on the function this batch authored.
--
-- The Supabase security advisor flags public.enqueue_business_email_event under
-- function_search_path_mutable. The function is SECURITY INVOKER, so a caller
-- cannot escalate through it, but pinning the path is still the standard
-- hardening, and this function sits on the delivery path for every future
-- producer.
--
-- Safe to pin because every object it touches is already schema qualified:
-- public.email_text_is_safe, public.email_event_catalog, public.email_outbox,
-- public.email_logs and public.email_payload_schema_matches. Nothing resolves
-- by bare name, so the path cannot change behaviour.
--
-- The precondition asserts that too, so a future edit cannot reintroduce a bare
-- table reference and silently start depending on the pinned path.

do $$
declare
  v_body text;
begin
  select prosrc into v_body
    from pg_proc where proname = 'enqueue_business_email_event';

  if v_body is null then
    raise exception 'precondition_failed: enqueue_business_email_event missing';
  end if;

  if v_body ~* '(from|join)\s+(email_outbox|email_logs|email_event_catalog)\b' then
    raise exception 'precondition_failed: body has an unqualified email table reference';
  end if;
end $$;

create or replace function public.enqueue_business_email_event(
  p_app text,
  p_event_key text,
  p_to_email text,
  p_payload jsonb,
  p_source_id uuid
) returns uuid
language plpgsql
security invoker
set search_path = public
as $fn$
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

  -- enabled stays a hard block and rollout_mode 'paused' is treated the same
  -- way, so a deliberately disabled event can never be revived by promotion.
  if (not v_catalog_row.enabled) or v_catalog_row.rollout_mode = 'paused' then
    if v_catalog_row.required_for_business then
      raise exception 'required_event_is_disabled';
    end if;

    -- The suppression record. outbox_id is null because nothing was queued, and
    -- the recipient is intentionally absent so this outliving table is not a
    -- place an address accumulates.
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
$fn$;

revoke all on function public.enqueue_business_email_event(text, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.enqueue_business_email_event(text, text, text, jsonb, uuid) to service_role;
