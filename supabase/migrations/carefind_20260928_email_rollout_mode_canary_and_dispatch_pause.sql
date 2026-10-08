-- Reliable-email rollout control: per-event rollout state, canary addressing,
-- and enforced dispatch pause.
--
-- Context
--   Batch 1 of docs/specs/_root/0001-reliable-email-system/0005-full-coverage-rollout.md.
--   The audit behind that spec found three safety gaps that are all fixable
--   without changing what mail is delivered today:
--
--   1. There is no off switch. email_system_settings.dispatch_paused exists
--      in the schema and is described in three specifications, but no code
--      reads it. If a bad template reached the ~44 real accounts there was
--      nothing to stop it.
--
--   2. There is no way to build new mail without mailing real customers. The
--      catalog is the natural place for that, but it only has a boolean
--      `enabled`, and 24 of the 25 events have no producer at all, so
--      flipping it changes nothing while writing producers for 10 previously
--      silent operations would.
--
--   3. A canary needs a recipient, and needs to fail closed. If a canary row
--      were ever delivered to its real recipient the canary would be worse
--      than no canary.
--
-- Fix
--   * email_event_catalog.rollout_mode: 'live' | 'canary' | 'paused'.
--     `enabled` is RETAINED as a separate hard block, so rollout_mode can
--     never re-enable an event somebody deliberately switched off. The
--     effective gate is: enabled AND rollout_mode <> 'paused'.
--   * Existing 25 events are marked 'live'. This is a statement of intent
--     for the producers that already deliver to real users today, and it is
--     inert right now because every event still has enabled = false.
--   * email_outbox.is_canary marks a row that must never reach its real
--     recipient. The real recipient is retained on the row so the audit
--     trail stays truthful.
--   * email_system_settings gains canary_recipient, unset by default. An
--     unset canary_recipient makes canary rows fail closed at the worker.
--   * enqueue_business_email_event is extended to honour rollout_mode and to
--     stamp is_canary. It keeps the same signature, volatility and
--     privilege (SECURITY INVOKER, so still service_role only).
--
-- Deliberately NOT done here
--   * No event is enabled and no event is un-paused, so this migration
--     cannot cause mail to flow. All 25 remain enabled = false.
--   * The worker does not read dispatch_paused or is_canary yet. That is the
--     application half, landed in the same batch before this is relied on.
--     Until then canary rows are inert and dispatch_paused is still ignored.
--   * Atomic claiming, per-row max_attempts, and the one minute Supabase Cron
--     cadence are batch 2. Raising cadence before claiming exists would make
--     double sends more likely, not less.
--   * Moving the 10 direct producers onto this function is batch 3. Until
--     then they still bypass the catalog, so rollout_mode does not govern
--     them yet. This migration is deliberately the safe half first.

begin;

-- Preconditions: fail loudly rather than silently migrating unexpected data.
do $$
declare
  v_total   integer;
  v_enabled integer;
begin
  select count(*), count(*) filter (where enabled)
    into v_total, v_enabled
    from public.email_event_catalog;

  if v_total <> 25 then
    raise exception 'expected 25 catalog events, found %', v_total;
  end if;

  -- Still 0 enabled, so this migration provably cannot cause mail to flow.
  if v_enabled <> 0 then
    raise exception 'expected 0 enabled events before this migration, found %', v_enabled;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Per-event rollout state.
--    Default is 'paused' so an event added later is dark until deliberately
--    promoted. Existing rows are then marked 'live' in step 2.
-- ---------------------------------------------------------------------------
alter table public.email_event_catalog
  add column if not exists rollout_mode text not null default 'paused';

alter table public.email_event_catalog
  drop constraint if exists email_event_catalog_rollout_mode_check;

alter table public.email_event_catalog
  add constraint email_event_catalog_rollout_mode_check check (
    rollout_mode in ('live', 'canary', 'paused')
  );

-- ---------------------------------------------------------------------------
-- 2. The 25 shipped events are declared 'live'.
--    Inert today: all 25 still have enabled = false, so the effective gate
--    keeps every one of them blocked. This only stops batch 3 from having to
--    re-decide, for the producers that already deliver to real users.
-- ---------------------------------------------------------------------------
update public.email_event_catalog
   set rollout_mode = 'live',
       updated_at   = now()
 where rollout_mode is distinct from 'live';

-- ---------------------------------------------------------------------------
-- 3. Canary marker on the outbox.
--    The real recipient stays on the row. Only the dispatch step is redirected.
-- ---------------------------------------------------------------------------
alter table public.email_outbox
  add column if not exists is_canary boolean not null default false;

-- ---------------------------------------------------------------------------
-- 4. Canary recipient setting.
--    Unset by default, which is the fail-closed state. The key allowlist and
--    the value type check are both widened to admit it, and the value must
--    look like an address and pass the same safety check as catalog text so
--    a canary row can never carry injected content into a header.
-- ---------------------------------------------------------------------------
alter table public.email_system_settings
  drop constraint if exists email_system_settings_key_check;

alter table public.email_system_settings
  add constraint email_system_settings_key_check check (
    key in ('carehub_admin_email', 'dispatch_paused', 'canary_recipient')
  );

alter table public.email_system_settings
  drop constraint if exists email_system_settings_value_type_check;

alter table public.email_system_settings
  add constraint email_system_settings_value_type_check check (
       (key = 'carehub_admin_email' and jsonb_typeof(value) = 'string')
    or (key = 'dispatch_paused'    and jsonb_typeof(value) = 'boolean')
    or (key = 'canary_recipient'
        and jsonb_typeof(value) = 'string'
        and (value #>> '{}') ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        and public.email_text_is_safe(value #>> '{}'))
  );

-- ---------------------------------------------------------------------------
-- 5. Enqueue honours rollout_mode and marks canary rows.
--    Signature, volatility and privilege are unchanged, so existing callers
--    and the anon/authenticated revocations are untouched.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_business_email_event(
  p_app       text,
  p_event_key text,
  p_to_email  text,
  p_payload   jsonb,
  p_source_id uuid
)
returns uuid
language plpgsql
volatile
as $$
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
$$;

-- ---------------------------------------------------------------------------
-- 6. Record the rollout contract on the tables.
-- ---------------------------------------------------------------------------
comment on column public.email_event_catalog.rollout_mode is
  'Rollout state for this event. live = deliver to the real recipient. canary = '
  'render and deliver to email_system_settings.canary_recipient with sensitive '
  'payload values redacted; fails closed if that setting is unset. paused = '
  'produce no mail, same as enabled = false. The effective gate is '
  'enabled AND rollout_mode <> ''paused'', so promotion can never revive an '
  'event somebody deliberately disabled. The 25 shipped events are ''live'' but '
  'remain enabled = false, so no mail flows until an event is deliberately '
  'enabled.';

comment on column public.email_outbox.is_canary is
  'True when the row must never reach its real recipient. to_email is retained '
  'for audit and is overridden at dispatch. A canary row whose canary_recipient '
  'is unset is marked failed, never delivered to to_email.';

comment on table public.email_system_settings is
  'Protected non-secret operator settings. dispatch_paused stops the worker '
  'claiming and sending while business writes keep enqueueing. canary_recipient '
  'is the single address canary events are delivered to; leaving it unset is the '
  'fail-closed state. No secret belongs in this table.';

commit;
