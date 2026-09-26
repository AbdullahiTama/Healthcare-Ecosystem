# 0003. CareHub Business Email

## Summary

This child makes CareHub registration and business review messages part of the same database action as the business change. It adds a protected admin address setting, retry safe registration attempts, durable status transitions, atomic Postgres functions, CareHub templates, and client calls. A failed required email job rolls back the matching business change.

## Requirements

1. **AC-B-1**: A new business registration and its owner and admin messages commit together or all three writes roll back.
2. **AC-B-2**: A repeated registration id returns the original business id and does not create another account, business, attempt, or email job.
3. **AC-B-3**: Platform administrators can review a business through one function that records previous status, new status, reason, actor, transition id, and one email job in the same transaction.
4. **AC-B-4**: Approval, rejection, suspension, reactivation, and revocation have distinct catalog events and correct CareHub copy.
5. **AC-B-5**: Repeated transitions to the same status use separate durable transition ids and event keys.
6. **AC-B-6**: Only a verified platform administrator may review a business through the new function.
7. **AC-B-7**: The CareHub admin recipient comes from a protected database setting and cannot be supplied by the browser.
8. **AC-B-8**: The owner and admin messages use the CareHub domain, sender, wordmark, support details, safe links, HTML, and plain text.
9. **AC-B-9**: Registration and review clients show queued or completed state accurately and never claim inbox delivery.
10. **AC-B-10**: Automated, database, build, and real inbox checks pass before the events are enabled for users.

## Decision

Use Postgres functions for both business actions. `register_business_atomic` owns registration idempotency and creates both outbox rows in its transaction. `review_business_status` owns authorization, the status update, the durable transition, the audit record, and the owner outbox row. The old Vercel notice endpoints are temporary callers and are removed after the client cutover.

## Feature Design

### Data Model

1. `email_system_settings`
   1. Seed `carehub_admin_email` with `admin@carefindhub.com`.
   2. The value is validated as an email address by the settings function.
   3. The browser cannot write this table.
   4. Every update records the platform administrator actor and time.
2. `business_registration_attempts`
   1. `registration_id uuid` primary key and supplied by the client before the first request.
   2. `business_id uuid` required with `ON DELETE RESTRICT`.
   3. `result jsonb` required and limited to safe values such as business id and status.
   4. `created_at timestamptz` required.
   5. No password, raw email, or notification payload is stored in the result.
3. `business_status_transitions`
   1. `id uuid` primary key.
   2. `business_id uuid` required with `ON DELETE CASCADE` to `businesses`.
   3. `from_status text` required.
   4. `to_status text` required.
   5. `reason text` nullable.
   6. `changed_by uuid` nullable with `ON DELETE SET NULL` to `auth.users`.
   7. `request_id uuid` required and unique.
   8. `event_key text` required and unique.
   9. `created_at timestamptz` required.
   10. Status values are `pending`, `active`, `rejected`, `suspended`, and `revoked`.
   11. An existing admin audit record is written in the same transaction.
4. Outbox event keys
   1. Owner registration uses `carehub-registration:<registration_id>:owner`.
   2. Admin registration uses `carehub-registration:<registration_id>:admin`.
   3. Business review uses `carehub-status:<transition_id>`.
   4. The event key includes the transition id, not only the business id and target status.

All tables use RLS with no public policies.

### Registration Function

1. `register_business_atomic(p_registration_id uuid, p_business jsonb, p_password text)` returns safe JSON with business id, status, and whether the result was replayed.
2. The function first checks `business_registration_attempts` by registration id. An existing row returns the original safe result without new writes.
3. The function preserves the existing `register_business` protections. It forces pending status, false platform admin status, null parent, and the basic plan. It rejects unsafe fields and short passwords.
4. The function calls the existing project owned `mint_confirmed_auth_user` primitive to create the confirmed CareHub Auth user. It is the only Auth user write path. The primitive is owner only, has a fixed search path, and is covered by identity, session, and rollback tests. No new raw `auth.users` insert is added.
5. The function records CareHub app membership in the same transaction.
6. The function inserts the business row.
7. The function reads `carehub_admin_email` from `email_system_settings` and rejects registration if the setting is missing or invalid.
8. The function inserts the owner registration event and admin registration event through `enqueue_business_email_event`.
9. It inserts `business_registration_attempts` with the original result before commit.
10. Any failure rolls back the Auth user, membership, business, both outbox rows, and the attempt row.
11. The old client route returns `410` during the controlled cutover. The old `register_business` RPC remains executable only during that window and is revoked after caller searches are clean.

### Review Function

1. `review_business_status(p_request_id uuid, p_business_id uuid, p_to_status text, p_reason text default null)` returns transition id, previous status, new status, and event key.
2. The function requires `auth.uid()` and the existing platform administrator predicate. The authenticated administrator is the transition actor.
3. The function returns the original result when `p_request_id` already exists, without changing the business again.
4. The function locks the business row and reads the previous status.
5. It rejects an unknown target status and rejects a transition that does not change the current status.
6. It writes the status change, transition row, existing admin audit record, and one required owner event through `enqueue_business_email_event` in the same transaction.
7. The event is `business_approved` for pending to active, `business_reactivated` for suspended or revoked to active, `business_rejected` for pending to rejected, `business_suspended` for active to suspended, and `business_revoked` for active or suspended to revoked.
8. The event key is derived from the new transition id.
9. A repeated request with the same `p_request_id` returns the original transition and event key. A new request id for a target that is already current is rejected as a no change.
10. Any required enqueue failure rolls back the status change.

### Catalog Events

1. `registration_owner` uses CareHub app and the `carehub_registration_owner` template.
2. `admin_new_registration` uses CareHub app and the `carehub_admin_registration` template.
3. `business_approved` uses `carehub_business_approved`.
4. `business_rejected` uses `carehub_business_rejected`.
5. `business_suspended` uses `carehub_business_suspended`.
6. `business_reactivated` uses `carehub_business_reactivated`.
7. `business_revoked` uses `carehub_business_revoked`.
8. All six are enabled and required only after the schema, templates, and functions pass local tests.

### Templates

1. Every subject begins with `CareHub`.
2. The owner registration template says the application is under review and does not imply approval.
3. The admin registration template contains business name, owner name, type, state, and the owner email supplied during registration. It contains no password.
4. Approval says the business is approved and links to CareHub login.
5. Rejection says the application was not approved and may include a fixed safe reason code. Free text review reasons stay internal and never enter the external message.
6. Suspension and revocation state the current account state and link to support.
7. Reactivation says the account is active again and links to CareHub login.
8. Every template uses `https://carefindhub.com/logo-wordmark.png`, `CareHub <support@carefindhub.com>`, `support@carefindhub.com`, a proportional 240 pixel wordmark, 600 pixel table layout, inline styles, a hidden preview line, and plain text.
9. Every user supplied value is escaped. Every link is checked against the CareHub origin allowlist.
10. The outbox payload uses a closed schema with a maximum length for every field. Unknown fields and clinical field names are rejected before enqueue.
11. No template contains a password, clinical detail, patient identifier, or free text internal review reason.

### Client Changes

1. `Register.jsx` creates one `registration_id` before the request and keeps it for retries.
2. The client calls `register_business_atomic` and treats a replayed result as success.
3. The client removes the separate `/api/notify-registration` request.
4. The success screen says the request is recorded and a review message is queued. It does not say the inbox received mail.
5. `AdminDashboard.jsx` creates one `request_id` for a review action, keeps it for retries, and calls `review_business_status` for every supported transition, including `revoked`.
6. The client uses the returned transition id for its success state and does not send a second notification request.
7. The client surfaces a safe retry message when the database function returns an error. It does not claim the status changed if the transaction rolled back.

### Removed Code

1. `apps/carehub/api/_handlers/notify-registration.js` is removed after the registration client moves.
2. `apps/carehub/api/_handlers/notify-business-status.js` is removed after the admin client moves.
3. The old CareHub `register_business` RPC and direct status update path are retired after no callers remain.
4. The old status notification templates are removed after the six catalog templates pass tests.

### Value Sourcing

1. Registration id comes from a client generated UUID held for the retry lifetime.
2. Business id comes from `business_registration_attempts.business_id` on replay and the new business id on first success.
3. Owner email comes from the validated registration payload and is used only for the owner message and existing business ownership record.
4. Admin recipient comes from `email_system_settings.carehub_admin_email`, seeded as `admin@carefindhub.com`.
5. Previous status comes from the locked `businesses.status` row.
6. New status comes from the reviewed target input after allowlist validation.
7. Transition id and event key come from the new `business_status_transitions` row.
8. Request id comes from a client generated UUID held for the retry lifetime.
9. Actor comes from `auth.uid()` for the authenticated platform administrator.
10. Internal free text reason comes from the protected `business_status_transitions.reason` column and is never copied to the outbox.
11. External reason code comes from a fixed catalog allowlist selected by the review action. If no safe code is approved, the template uses generic copy.
12. Subject, sender, reply address, closed payload schema, and template key come from `email_event_catalog`.
13. The status allowed list comes from the live `businesses.status` constraint after migration and is checked before the function is deployed.

### Security Model

1. Registration remains public but uses the existing safe business field allowlist and password rules.
2. The admin recipient is never accepted from the browser or a public request body.
3. `review_business_status` uses the existing platform administrator authorization and a locked row.
4. The status trigger that protects privileged columns remains in place.
5. The event payload contains only business name, owner name, business type, state, a fixed reason code when approved, and safe links. It contains no password, free text review reason, patient identifier, or clinical detail.
6. Admin and owner messages are written in the same transaction as the business action.
7. The platform administrator can change the protected setting only through `email-operations`.

### Configuration Required

1. `carehub_admin_email` must be seeded and verified before the registration event is enabled.
2. The live business status constraint must include `rejected` before the review function is enabled.
3. The `carefindhub.com` Resend domain must be verified.
4. The CareHub Auth redirect origin and canonical links must use `https://carefindhub.com`.

### Critical Test Scenarios

1. A valid registration creates one business, one confirmed Auth user, two outbox rows, and one attempt row. Verifies **AC-B-1** and **AC-B-2**.
2. Replaying the same registration id returns the original business id with no new rows. Verifies **AC-B-2**.
3. A failed owner enqueue rolls back every registration write. Verifies **AC-B-1**.
4. A missing admin setting rolls back registration without revealing the setting. Verifies **AC-B-7**.
5. Pending to active produces approval. Suspended to active produces reactivation. Verifies **AC-B-3** and **AC-B-4**.
6. Two later transitions from the same business to the same target have different ids and event keys. Verifies **AC-B-5**.
7. An ordinary business owner cannot call the review function. Verifies **AC-B-6**.
8. CareHub registration, approval, rejection, suspension, reactivation, and revocation render correctly in Gmail and Outlook. Verifies **AC-B-8** and **AC-B-10**.
9. A free text review reason containing a patient name is stored internally but is absent from the outbox, rendered mail, and logs. Verifies **AC-B-8** and **AC-B-10**.
10. A missing or invalid Auth identity primitive rolls back the business and both message jobs without a partial Auth identity. Verifies **AC-B-1** and **AC-B-2**.

## Build Plan

1. Add and apply the protected setting, registration attempt, status transition, catalog seed, and atomic function migration. Satisfies **AC-B-1**, **AC-B-2**, **AC-B-3**, **AC-B-5**, and **AC-B-7**.
2. Build and test the six CareHub templates, brand validation, escaping, and plain text output. Satisfies **AC-B-4** and **AC-B-8**.
3. Move registration and admin review clients to the atomic functions and add client state tests. Satisfies **AC-B-1**, **AC-B-3**, and **AC-B-9**.
4. Remove the old notice routes, old status path, and old templates after caller searches are clean. Satisfies **AC-B-2** and **AC-B-9**.
5. Run database rollback probes, permission probes, app tests and builds, and the real inbox matrix. Satisfies **AC-B-6**, **AC-B-9**, and **AC-B-10**.

## Consequences

1. Registration now fails visibly when required mail cannot be queued, which protects the business and mail invariant but changes the old best effort behavior.
2. Review status changes require one database function and cannot be performed by a direct client patch.
3. The platform admin address becomes a protected operational setting.
4. Repeated transitions are durable and auditable rather than inferred from the current business row.

## Rationale

A database function is the only place that can update a business and create its required message atomically. A registration attempt record makes retries safe. A transition record makes repeated status changes safe and preserves the previous state needed to distinguish approval from reactivation. The protected setting removes the browser and deployment environment from the admin recipient decision.
