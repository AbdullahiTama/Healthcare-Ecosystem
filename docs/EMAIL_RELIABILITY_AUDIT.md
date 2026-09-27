# Reliable Email Audit — CareHub & CareFind

**Date:** 2026-09-27
**Scope:** the `reliable_email_*` catalog, enqueue path, and delivery pipeline.
**Production state changed by this work:** sender addresses and template keys only.
No event was enabled, so no customer email could flow as a result of this audit.

---

## 1. What was wrong

The system had never successfully sent a message. `email_outbox`,
`email_worker_runs`, and `email_provider_events` were all empty, and all 25
catalog events were `enabled = false`.

Two independent defects would have caused a failure even if the events had been
enabled.

### 1.1 Every `template_key` matched no renderer (blank email body)

The catalog stored app-prefixed keys:

```
carefind_order_confirmation
carehub_registration_owner
...
```

Shared-email resolves renderers by **unprefixed** snake_case key in
`packages/shared-email/src/templates/index.js` via `getTemplate(template_key, app)`.

Running all 25 stored keys through that function resolved **0 of 25**.
`EmailService.processBatch` then evaluates:

```js
const templateFn = getTemplate(row.template_key, resolveAppFromSender(row.from_email))
const html = templateFn ? templateFn(row.payload) : ''
```

so every event would have been delivered with an **empty body**, silently, with no
error and no failed status. One row was wrong in a second way as well:
`admin_new_registration` had been stored as `carehub_admin_registration`, so even
stripping the prefix would not have matched.

### 1.2 Senders used unverified Resend domains

`from_email` / `reply_to` pointed at `support@carefind.app` and
`support@carefindhub.com`. Resend rejects those with **403** because the domains
are not verified. The verified domains — already used by the direct-send paths —
are `mail.carefind.app` and `mail.carefindhub.com`.

This was not a free fix: `email_event_catalog_brand_check` hard-coded the exact
old addresses, so the constraint had to be dropped and recreated.

---

## 2. What was changed

Migration: `supabase/migrations/carefind_20260927_reliable_email_catalog_template_keys_and_senders.sql`

| Change | Detail |
| --- | --- |
| `template_key := event_key` | For all 25 events the event name and the renderer name are the same string, so this is an exact repair rather than a prefix guess. |
| Senders moved to verified domains | `CareFind <support@mail.carefind.app>` / `CareHub <support@mail.carefindhub.com>`, display names preserved. |
| `email_event_catalog_brand_check` recreated | Same intent as before — one sending identity per app, subjects still prefixed `CareHub:` / `CareFind:` — around the new addresses. |
| `email_event_catalog_template_key_unprefixed_check` added | Blocks `template_key` from ever taking the app-prefixed form again. |
| Table comment added | Records the renderer contract and the known gap in place. |

The migration asserts its preconditions (25 rows, 0 enabled) and aborts if reality
differs, so it cannot silently apply to unexpected data.

### Verification

Rendering every live catalog row through the real code registry, with a payload
built to satisfy each event's own declared `payload_schema`:

```
rows=25  renderer found=23  empty=2  threw=0
```

23 events render real HTML between 1259 and 2541 bytes with no unsubstituted
`{{placeholder}}` tokens. Both database guards were confirmed to reject bad data
(`23514` on each):

- `template_key = 'carefind_order_confirmation'` → rejected by
  `email_event_catalog_template_key_unprefixed_check`
- `from_email = 'CareFind <support@carefind.app>'` → rejected by
  `email_event_catalog_brand_check`

> Note when re-testing: a renderer called with an empty payload `{}` will throw on
> events with required fields. That is not a fault. `enqueue_business_email_event`
> validates the payload against `payload_schema` before the row is ever inserted,
> so the delivery path always supplies the fields. Test with a conforming payload.

---

## 3. What is still open

### 3.1 Two events have no renderer — keep them disabled

`carehub business_reactivated` and `carehub business_revoked` have no template
function in `packages/shared-email`. Their `template_key` now honestly names the
template that needs to be written. **Both remain `enabled = false` and must stay
that way**, or they will deliver an empty body.

### 3.2 No event is enabled — enabling is a separate decision

All 25 remain disabled. Nothing about the pipeline has been exercised against real
recipients. Before enabling, confirm the cron worker actually runs.

### 3.3 The DB template editor does not affect delivery

`apps/carefind/api/_handlers/email-templates.js` reads and writes the
`email_templates` table, but `EmailService.processBatch` renders from the **code**
registry, not the database. The table is empty and nothing consults it during
delivery.

So the admin template editor looks functional while having no effect on what is
actually sent. Two coherent directions:

1. **Code is the source of truth** — retire or clearly label the DB editor, and
   treat `packages/shared-email/src/templates/` as the only place templates live.
2. **DB overrides code** — have `processBatch` prefer an `email_templates` row and
   fall back to the code registry.

Option 2 is the larger change and would ship unexercised until the table is
populated. This audit only records the problem.

### 3.4 Only one enqueue path exists

No application code calls `enqueue_business_email_event`. The only caller is the
`trg_shop_order_status_history_email` trigger on `shop_order_status_history`. So
in practice the catalog affects CareFind order status changes and nothing else.
The other 24 events have no caller at all.

### 3.5 Two order confirmations were lost and are not backfilled

These CareFind `order_confirmation` events were emitted before the event was
disabled, but no outbox row was created:

- `b5e8daac-f9a4-4789-ad30-12473ddf7fb7`
- `51d6b309-5151-4ef0-b270-fbf5a869536a`

They cannot be replayed through `enqueue_business_email_event` while the event is
disabled — the function returns `NULL` for a disabled, non-required event. They
remain un-sent. Recovering them is a deliberate backfill once the event is
enabled, and requires the original order payload, which is no longer in the
database.

### 3.6 Six applied migrations have no source in the repository

These are applied to production but absent from the repo:

```
20260925082526  reliable_email_expand
20260925115923  reliable_email_core
20260925134950  20260925131447_reliable_email_enqueue
20260925141618  20260925131548_reliable_email_fix
20260925141758  20260925131648_reliable_email_fix2
20260925141949  20260925131748_reliable_email_fix3
```

They were **not** reconstructed. Reconstructing them from the final schema would
produce files that do not match what was actually run, and the
`fix` → `fix2` → `fix3` chain means each assumed the state left by the previous
one. Replaying invented history would break a fresh `supabase db reset` in a way
that is harder to diagnose than the missing files.

The forward migration in section 2 is the authoritative, replayable statement of
the current correct state. The gap is recorded here instead.

The `fix` chain is also the likely origin of both defects in section 1: the brand
constraint and the prefixed keys were both introduced or amended during that
same-day iteration.

---

## 4. Enabling, when you are ready

1. Implement `businessReactivated` and `businessRevoked` in
   `packages/shared-email`, or accept that those two stay off.
2. Confirm the outbox worker actually runs — `email_worker_runs` is empty, so
   nothing has ever drained it. `/api/cron/process-email-outbox` is the entry
   point and requires `CRON_SECRET`.
3. Enable one low-volume event first, not all 25:

   ```sql
   update email_event_catalog set enabled = true
    where app = 'carefind' and event_key = 'order_confirmation';
   ```

4. Trigger it, then confirm the row moved `pending → sent` and
   `email_provider_events` recorded a delivery — and read the delivered body to
   confirm it is not blank.
5. Only then enable the rest, in stages.
