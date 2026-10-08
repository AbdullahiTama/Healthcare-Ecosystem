-- Reliable-email catalog: repair template keys and move to verified sending domains.
--
-- Context
--   The catalog shipped 25 events (10 carefind / 15 carehub) that could never
--   have delivered a correct email. Two independent defects:
--
--   1. template_key did not match any renderer.
--      The catalog stored app-prefixed keys (carefind_order_confirmation,
--      carehub_registration_owner, ...) plus one row whose suffix was also
--      wrong (admin_new_registration -> carehub_admin_registration).
--      Shared-email resolves renderers by UNPREFIXED snake_case key via
--      getTemplate(template_key, app) in
--      packages/shared-email/src/templates/index.js.
--      Verified against the code registry: 0 of 25 stored keys resolved, so
--      EmailService.processBatch would have taken the
--      `html = templateFn ? templateFn(payload) : ''` branch and sent an
--      EMPTY BODY for every event.
--
--   2. from_email / reply_to pointed at unverified Resend domains.
--      support@carefind.app and support@carefindhub.com return Resend 403
--      (domain not verified). The verified domains are mail.carefind.app and
--      mail.carefindhub.com, which is what the direct-send paths already use.
--      email_event_catalog_brand_check hard-codes the old addresses, so the
--      constraint has to be dropped and recreated around the new ones.
--
-- Fix
--   * template_key := event_key. For all 25 events the event name and the
--     renderer name are the same string, so this is the exact repair rather
--     than a prefix guess. Verified: 23 of 25 then resolve to a renderer.
--   * from_email / reply_to moved to the verified mail.* subdomains.
--   * The brand check is recreated, still pinning one from/reply_to pair per
--     app and the 'CareHub:' / 'CareFind:' subject prefix.
--   * A guard is added so the app-prefixed key form cannot be reintroduced.
--
-- Deliberately NOT done here
--   * No event is enabled. All 25 stay enabled = false, so this migration
--     cannot cause mail to flow. Enabling is a separate, deliberate step.
--   * carehub business_reactivated and business_revoked still have no
--     renderer in shared-email. They are annotated below and must stay
--     disabled until those templates are written, or they will send a blank
--     body. Their template_key is now honestly named after the template that
--     needs to exist; see the table comment at the end of this file.
--   * The two lost CareFind order confirmations are not backfilled; the
--     enqueue function returns NULL while the event is disabled. The manual
--     procedure is documented in docs/EMAIL_RELIABILITY_AUDIT.md.

begin;

-- Preconditions: fail loudly rather than silently migrating unexpected data.
do $$
declare
  v_total    integer;
  v_enabled  integer;
  v_disabled integer;
begin
  select count(*),
         count(*) filter (where enabled),
         count(*) filter (where not enabled)
    into v_total, v_enabled, v_disabled
    from public.email_event_catalog;

  if v_total <> 25 then
    raise exception 'expected 25 catalog events, found %', v_total;
  end if;
  if v_enabled <> 0 then
    raise exception 'expected 0 enabled events before this migration, found %', v_enabled;
  end if;
  if v_disabled <> 25 then
    raise exception 'expected 25 disabled events, found %', v_disabled;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Brand constraint pins the sending addresses, so it must yield first.
-- ---------------------------------------------------------------------------
alter table public.email_event_catalog
  drop constraint if exists email_event_catalog_brand_check;

-- ---------------------------------------------------------------------------
-- 2. Point every event at the verified sending domain.
--    Display names are preserved so CareHub/CareFind branding is unchanged.
-- ---------------------------------------------------------------------------
update public.email_event_catalog
   set from_email = case app
                      when 'carehub'  then 'CareHub <support@mail.carefindhub.com>'
                      when 'carefind' then 'CareFind <support@mail.carefind.app>'
                    end,
       reply_to   = case app
                      when 'carehub'  then 'support@mail.carefindhub.com'
                      when 'carefind' then 'support@mail.carefind.app'
                    end,
       updated_at = now()
 where app in ('carehub', 'carefind');

-- ---------------------------------------------------------------------------
-- 3. Repair template_key to the unprefixed renderer name.
--    event_key already satisfies email_event_catalog_template_key_check
--    (^[a-z][a-z0-9_]{1,127}$), so no constraint change is needed here.
-- ---------------------------------------------------------------------------
update public.email_event_catalog
   set template_key = event_key,
       updated_at   = now()
 where template_key is distinct from event_key;

-- ---------------------------------------------------------------------------
-- 4. Reinstate the brand guard against the verified addresses.
--    Keeps the original intent: one sending identity per app, and every
--    subject prefixed with the owning brand.
-- ---------------------------------------------------------------------------
alter table public.email_event_catalog
  add constraint email_event_catalog_brand_check check (
    (app = 'carehub'
       and from_email = 'CareHub <support@mail.carefindhub.com>'
       and reply_to   = 'support@mail.carefindhub.com'
       and subject_template like 'CareHub:%')
    or
    (app = 'carefind'
       and from_email = 'CareFind <support@mail.carefind.app>'
       and reply_to   = 'support@mail.carefind.app'
       and subject_template like 'CareFind:%')
  );

-- ---------------------------------------------------------------------------
-- 5. Guard against reintroducing the app-prefixed key form that caused the
--    blank-body failure. The renderer registry lives in code, so the database
--    cannot fully validate a key, but it can block this specific regression.
-- ---------------------------------------------------------------------------
alter table public.email_event_catalog
  drop constraint if exists email_event_catalog_template_key_unprefixed_check;

alter table public.email_event_catalog
  add constraint email_event_catalog_template_key_unprefixed_check check (
    template_key !~ '^(carehub|carefind)_'
  );

-- ---------------------------------------------------------------------------
-- 6. Record the renderer contract on the table.
-- ---------------------------------------------------------------------------
comment on table public.email_event_catalog is
  'Per-app business email catalog. template_key must be the unprefixed snake_case '
  'renderer name exported by packages/shared-email/src/templates/index.js '
  '(getTemplate(template_key, app)); it must not be app-prefixed. from_email/reply_to '
  'must use a Resend-verified domain. Auth-category events are rejected by '
  'enqueue_business_email_event and use a separate path. Known gap: carehub '
  'business_reactivated and business_revoked have no renderer in shared-email; keep '
  'both disabled until implemented or they will deliver an empty body. '
  'See docs/EMAIL_RELIABILITY_AUDIT.md.';

commit;
