# Rationale

## Context

The current repository has an email package, Supabase outbox tables, Vercel handlers, Supabase Auth mail code, and many templates. The live outbox has zero rows. The CareHub worker has a broken import and rejects the method used by its schedule. The Auth path starts a flush without waiting and reports success before delivery. Resend webhook verification and event correlation do not match the current provider. Several public routes expose service role backed email data. App selection depends on sender text, so a CareHub message processed by CareFind can use CareFind branding.

The approved design in `docs/superpowers/specs/2026-09-24-reliable-cross-platform-email-design.md` established the product goal: one traceable system for Auth, registration, business review, and later important activity. It also chose `carefindhub.com` for CareHub and `carefind.app` for CareFind, required real inbox checks, and excluded social mail and clinical details.

The design left five implementation boundaries open. The engineer chose Supabase Cron, a private app membership table, a database settings value, a database event catalog, durable status transitions, a private Deno worker, a Supabase Resend webhook, a protected CareFind signup bridge, database signup limits, and a protected operations API.

> Premise note: this topic spans four independently testable concerns. A single implementation plan would hide review boundaries and make a large live migration harder to recover. The umbrella spec therefore separates the shared delivery foundation, CareFind Auth mail, and CareHub business mail. The shared contract remains in `index.md`, and each child can be implemented and checked on its own.

## Options Considered

### Option 1: Supabase owned delivery with a database catalog

Use Supabase Postgres for the outbox, catalog, claims, provider events, settings, and business transitions. Use private Deno Edge Functions for Auth mail, minute sending, Resend events, and operations. Use Supabase Cron through `pg_net` and Vault for one minute scheduling.

**Pros**:

1. Business writes and email jobs can share one database transaction.
2. One minute scheduling does not depend on a Vercel plan.
3. Auth, sending, provider events, and operations share one server runtime.
4. The database is the single authority across SQL, Deno, and Vercel producers.
5. A database claim makes concurrent workers safe.

**Cons**:

1. The migration is large and introduces five Edge Functions.
2. Deno templates replace the current Node template runtime.
3. Supabase usage and operational knowledge increase.
4. The database catalog adds a deployment step for event changes.

### Option 2: Vercel worker with Supabase Cron as the clock

Keep the Node package and Vercel worker, but invoke it from Supabase Cron.

**Pros**:

1. The current Node templates stay in place.
2. The Vercel plan no longer limits the schedule.
3. The first code change is smaller.

**Cons**:

1. Scheduled delivery depends on both Supabase and Vercel.
2. Auth hooks, provider events, sending, and operations remain split across runtimes.
3. The Node package and Deno Auth hook need separate template contracts.
4. The database and deployment surfaces are harder to reason about.

### Option 3: Supabase Auth mail and a separate Resend outbox

Let Supabase SMTP deliver Auth messages and use Resend for activity messages.

**Pros**:

1. Supabase owns Auth mail templates.
2. No Auth hook is required for basic verification or recovery.
3. The activity worker can remain simple.

**Cons**:

1. One shared Supabase project cannot naturally provide separate CareHub and CareFind sender identities and logos for every Auth action.
2. Custom link generation and Auth state handling would be split.
3. The system has two delivery paths and two sets of provider events.
4. The approved one path invariant would be lost.

### Option 4: Separate email systems for CareHub and CareFind

Give each app its own queue, templates, worker, and provider configuration.

**Pros**:

1. Each app has clear ownership.
2. A CareHub outage does not affect CareFind mail.

**Cons**:

1. It duplicates the queue, worker, webhook, monitoring, and retention code.
2. Shared business events can choose the wrong system.
3. The two systems drift in branding and retry behavior.
4. It adds operational work without evidence that the shared database needs separation.

## Identity Decision

The Auth hook needs a trusted app value. The engineer chose a private membership table. This supports one user in both products and gives security notices a source that does not depend on a redirect.

Normal browser signup can only write `user_metadata`, which Supabase documents as editable. A Before User Created Hook can allow or reject signup but cannot return modified Auth metadata. A Custom Access Token Hook changes a JWT but does not change the Auth user object delivered to the Send Email hook. The first CareFind message therefore needs a short lived trusted signup intent.

The selected flow is a public, rate limited `carefind-signup` Edge Function. It records a pending intent, calls normal Supabase Auth signup with the publishable key, and lets the Send Email hook consume the intent. The hook creates a private membership and queues the message. Existing users are backfilled only from exact trusted business, staff, or approved claim ownership. Ambiguous ownership fails visibly.

## Scheduler Decision

The engineer chose Supabase scheduling. `pg_cron`, `pg_net`, and Vault are supported by Supabase and can invoke a private Edge Function each minute. The scheduled request uses a named secret key, and the function validates that key even though the gateway setting disables user JWT checks. A direct runner is sufficient because the outbox is the durable queue and the next minute safely retries pending rows. A second queue is not needed.

## Catalog Decision

The engineer chose a database catalog. A code catalog would need generation for SQL and Deno. Small copied maps would drift. The database catalog holds the cross runtime contract: app, event, template, subject, sender, required fields, enabled state, and required state. Deno owns rendering functions keyed by template. SQL and server producers ask the database to enqueue, so an unknown or cross app event fails before a row is written.

## Business Transition Decision

The engineer chose durable transition records. An event key made from only business id and target status would collide when a business is approved, suspended, and approved again. A random browser key could also change on retry. A transition row gives every decision a stable id, previous status, actor, reason, and unique event key. The function writes the business change, transition, audit record, and email job in one transaction.

## Worker And Provider Decision

The worker and Resend webhook run as private Supabase Edge Functions. The Send Email hook and worker share Deno modules under `supabase/functions/_shared/email`. The Node package remains only as an enqueue adapter while Vercel producers move. Direct Resend calls, Vercel cron, public previews, and public test sends are removed after the new path is proven.

## Rationale

The live failure is caused by a missing durable boundary, not by a lack of templates. Postgres is the only existing component that can atomically record a business change and its email job. Supabase Cron gives the required one minute schedule without adding a Vercel plan dependency. A private Deno worker keeps Auth mail, Resend sending, and provider events in one runtime. The database catalog and private membership table remove sender text and editable metadata as sources of truth. These choices add migration work and operational surface, but they make the delivery path observable, recoverable, and safe for a healthcare ecosystem.

## Cross Check Resolutions

An independent review found ten gaps. The final design resolves them as follows:

1. CareHub recovery has its own child because CareHub accounts are confirmed during provisioning.
2. Auth event keys use a server HMAC over the Auth user's updated time and token hash when available. Raw token material is never stored.
3. The public CareFind signup bridge has no service role key. It uses a narrow rate limited database function.
4. Business and Auth enqueue functions are separate, and the generic adapter cannot enqueue Auth events.
5. Worker leases are reclaimed after expiry. Configuration checks run before claims and do not consume attempts.
6. Resend webhook deployment uses Svix verification with JWT checking disabled and has an explicit event state matrix.
7. Catalog payload schemas are closed and reject unknown, oversized, and clinical fields. Free text review reasons remain internal.
8. The outbox migration expands, maps, validates, and contracts. Unclear rows are quarantined.
9. Membership backfill uses reviewed explicit user ids. It does not infer CareFind ownership from a missing relationship.
10. Rollback pauses dispatch through a global setting and leaves required events enabled.

These changes make the implementation more complete, but they add migration gates and a fourth child spec. They are worth the cost because the first version handles Auth, business changes, provider delivery, and healthcare privacy together.

## References

**Project sources**:

1. `AGENTS.md`, enterprise quality, security, planning, documentation, and test requirements.
2. `README.md`, the shared Supabase and shared package architecture.
3. `docs/superpowers/specs/2026-09-24-reliable-cross-platform-email-design.md`, approved product and security design.
4. `planning/CODE_AUDIT.md`, recorded email integration and deployment gaps.
5. `knowledge/modules/notifications.md`, current in app notification behavior and domain boundaries.

**Practices and standards**:

1. Transactional outbox, which records a business change and its message job in one database transaction.
2. Idempotency keys, which make retries safe for external side effects.
3. Row level security with service role only tables for privileged email data.
4. Standard Webhooks signature verification for Supabase Auth hooks.
5. Svix signature verification for Resend webhook requests.
6. Data minimization and no clinical details in third party email content.

**Links**:

1. [Supabase Send Email Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook)
2. [Supabase Auth email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
3. [Supabase Auth redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
4. [Supabase scheduled Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
5. [Supabase Edge Function security](https://supabase.com/docs/guides/functions/auth)
6. [Supabase Vault](https://supabase.com/docs/guides/database/vault)
7. [Supabase Cron](https://supabase.com/docs/guides/cron)
8. [Supabase pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)
9. [Supabase Queues](https://supabase.com/docs/guides/queues)
10. [Resend webhook verification](https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests)
11. [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)
12. [Resend send email](https://resend.com/docs/api-reference/emails/send-email)
