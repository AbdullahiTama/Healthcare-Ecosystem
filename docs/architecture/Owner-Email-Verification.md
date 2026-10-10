# Owner email verification (CareHub)

A business owner must prove they own the email address before they can sign in or be reviewed. Until this change `register_business` minted an already-confirmed auth user for any address typed into the wizard (17 of 17 owners created since the RPC change were confirmed at creation), and the RPC was callable by `anon`, so the wizard could be bypassed through PostgREST.

Design: `docs/superpowers/specs/2026-10-10-email-verification-signup-design.md`. Plan: `docs/superpowers/plans/2026-10-10-email-verification-signup.md`.

> **Rollout status.** The code is on branch `feat/owner-email-verification`. Nothing has been merged, applied to a database, or deployed. **Spike S1 has not been run.** Nobody has yet proven on the live project that a recovery-type link confirms an unconfirmed user. Read [Rollout runbook](#rollout-runbook) before touching anything: S1 is a hard gate.

## The flow

1. **Register.** The wizard (`apps/carehub/src/pages/auth/Register.jsx`) no longer asks for a password. It calls `registerBusiness()` in `apps/carehub/src/services/supabase.js`, which posts the wizard fields (minus any password) to `POST /api/register-business`.
2. **Handler** (`apps/carehub/api/_handlers/register-business.js`, routed in `apps/carehub/api/router.js`):
   - forwards only the whitelisted columns (`BUSINESS_FIELDS`), so a caller cannot set status, plan or admin flags;
   - validates email, business name and owner name (400 with a readable message);
   - calls the service-role-only RPC `register_business_unconfirmed(p_business jsonb)`;
   - a `P0001` error from the RPC (a `raise exception` written for the owner, for example "An account with this email already exists") is returned as 400; any other database error is logged as an error code only and answered with a generic 500;
   - then sends the `owner_setup` email through `sendAuthEmail` (`app: 'carehub'`, `redirectTo` = `${CAREHUB_APP_URL || APP_URL}/reset-password?welcome=1`). The email is best effort: if it fails, registration still returns 200 and the owner recovers through "Forgot password".
3. **Database** (one transaction, inside `register_business_unconfirmed`): creates the auth user **unconfirmed** with a random password that is never disclosed, then inserts the `pending` business row.
4. **Link.** `sendAuthEmail` with action `owner_setup` mints a **recovery-type** action link (`generateLink({ type: 'recovery' })`). Following it is expected to confirm the address and open a recovery session (this is what spike S1 must prove).
5. **Set password.** The link lands on `/reset-password?welcome=1` (`apps/carehub/src/pages/auth/ResetPassword.jsx`). With `welcome=1` the page shows "Email verified" and "Save password"; the session and `updateUser({ password })` logic is the same as a normal reset. Afterwards the owner is sent to sign in.
6. **Sign in.** The owner signs in and sees the existing pending-review state.
7. **Review.** An admin approves the business. The database refuses approval while the owner's email is unconfirmed (see the trigger below).

### Signing in before verifying, and resend

Supabase answers `email_not_confirmed` for an unconfirmed owner. `apps/carehub/src/pages/auth/Login.jsx` surfaces that as "Verify your email to continue" with a "Send a new link" control, instead of a wrong-password error. The notice clears when the email field changes or a new sign-in is attempted.

Resend uses the existing public `password_reset` action of `/api/auth-email`. It is generic (the same response whatever the outcome), padded and rate limited per address (3 per hour for `password_reset`). A recovery link confirms an unconfirmed account the same way `owner_setup` does, so no new unauthenticated email trigger exists. Each minted link invalidates the previous one.

`owner_setup` itself is **server-initiated only**: `authEmail.js` trusts the caller-supplied `fullName` and `businessName` for it (like `staff_setup`), so it must never be reachable from a public endpoint. It is not in the public handler's action list. Its rate limit is 5 per hour per address.

### CareFind

CareFind customers were already verified (Supabase `signUp` returns no session while "Confirm email" is on). The only code change is a "Resend verification email" control on the "check your inbox" state of `apps/carefind/src/modules/account/Login.jsx`, wired to the existing rate-limited `email_verification` action, with a 60 second client-side cooldown. "Confirm email" itself is a dashboard setting that cannot be read from SQL; it is a manual check in the runbook.

## Database objects

Defined in `supabase/migrations/carehub_20261029_owner_email_verification.sql`.

| Object | Purpose | Execute rights |
|---|---|---|
| `mint_unconfirmed_auth_user(p_email text) returns uuid` | Creates an auth user with a random, undisclosed password and then un-confirms it (`email_confirmed_at = null`, `email_verified: false` on user and identity metadata) in the same transaction, so no confirmed intermediate state is visible. Refuses any address that already has an auth user, because the underlying `mint_confirmed_auth_user` would otherwise silently confirm an existing unconfirmed user. | `service_role` only |
| `register_business_unconfirmed(p_business jsonb) returns uuid` | Same validation and columns as `register_business`, minus the password. Takes an advisory lock on the address, mints the unconfirmed user, inserts the business with `status = 'pending'`, `plan = 'basic'`. | `service_role` only |
| `guard_business_owner_email_confirmed()` (trigger function) | See next section. | none (`revoke all` from `public`, `anon`, `authenticated`; invoked only by the trigger) |
| `admin_unverified_owner_business_ids() returns setof uuid` | Ids of `pending` businesses whose owner has `email_confirmed_at is null`, for the admin console. `SECURITY DEFINER` because the client cannot read `auth.users`. Raises `not authorised` unless `public.is_platform_admin()`. Display-only: it enforces nothing. | `authenticated` and `service_role` (revoked from `public`, `anon`) |
| `email_event_catalog` row `(carehub, owner_setup)` | `email_outbox` has a foreign key on `(app, event_key)`, so the event needs a catalog row. Copied from `staff_welcome` (sender, rollout mode, flags), category `auth`. | n/a |

The `owner_setup` template lives in `packages/shared-email/src/templates/CareHub/index.js` (key `owner_setup`, subject "CareHub: verify your email and set your password").

### Payload keys

The `owner_setup` payload is `{ fullName, businessName, setupLink }` (camelCase), which is what `sendAuthEmail` enqueues. The catalog `payload_schema` is written to match. The schema is **not enforced at send time**: on live data, 13 sent `password_reset` outbox rows carry camelCase payload keys and non-matching links against a snake_case, `carefindhub.com`-pinned schema.

### The trigger and what it refuses

`businesses_require_verified_owner` is a `BEFORE UPDATE OF status` trigger on `public.businesses`.

Real business statuses are `pending`, `active`, `suspended`, `revoked` (`businesses_status_check`). The guard fires when `old.status = 'pending'` and the new status is different and **not** `suspended` or `revoked`. In that case it raises `The owner has not verified their email address yet.` if any `auth.users` row whose email matches the old **or** new business email (case-insensitive) has `email_confirmed_at is null`.

Consequences:

- An unverified owner's business cannot be moved from `pending` to `active`, whether through the console, a bulk approve, or a direct PATCH.
- An admin can still dispose of an unverified registration by moving it to `suspended` or `revoked`.
- Both emails are checked so a status change made together with an email change cannot slip past.
- A business whose owner email has no auth user (legacy rows) is not blocked.
- It does not fire for any other transition (for example `active` to `suspended`).

It is a trigger rather than a UI filter because approval is a direct PATCH from the admin client; a client-side filter would be bypassable.

### Admin console

`apps/carehub/src/pages/admin/AdminDashboard.jsx` calls `getUnverifiedOwnerBusinessIds()` on load. Pending businesses in that set show an "Awaiting email verification" badge, their Approve buttons are disabled, and bulk approve skips them and reports the count ("Skipped N: owner has not verified their email"). If the RPC call fails the set is empty and the console stays usable; the trigger remains the enforcement. The set does not update in realtime (verification changes `auth.users`, which the console does not subscribe to): use Refresh.

## Why two migrations

| Migration | Contents | Safe while the old frontend is live? |
|---|---|---|
| `carehub_20261029_owner_email_verification.sql` | Additive only: new functions, trigger, catalog row, admin RPC. | Yes. The old frontend still calls `register_business`. |
| `carehub_20261030_revoke_register_business.sql` | `revoke all on function public.register_business(jsonb, text) from public, anon, authenticated; grant execute ... to service_role;` | No. It breaks any frontend that still registers through the RPC. Apply only after the new frontend is live and verified. |

Keeping them separate lets the additive migration go first, so the deploy never ships a frontend that depends on functions that do not exist yet. The old function is revoked, not dropped, so rollback of the cutover is one `GRANT` (see the runbook).

## Grandfathered owners

17 owners were created confirmed under the old RPC and keep access. They are not re-prompted. Their addresses were never proven. An optional follow-up can flag them in the admin UI as "created before verification".

## Troubleshooting

**The owner never received the email.**
1. Ask them to check spam, then to use "Forgot password" on the CareHub sign-in page, or to sign in and press "Send a new link". Both use `password_reset`, are rate limited (3 per hour per address) and confirm the address the same way.
2. In `email_outbox`, look for the row for that address with `template_key = 'owner_setup'`: its status shows whether it was queued, sent or failed. No row at all means the send in the handler failed (the handler logs `[register-business] setup email failed:`) or the per-address limit of 5 per hour was hit.
3. Every minted link invalidates the previous one. If the owner clicked an older email after requesting a new one, they land on the link-expired page and must use the newest email.
4. Registration succeeded even if the email failed, so there is no need to re-register; re-registering is refused because the address already exists.

**Approval is refused ("The owner has not verified their email address yet").**
The owner has not confirmed the address. The console shows "Awaiting email verification" for these. Ask the owner to use the link (or resend, as above), then press Refresh in the console. If the owner cannot verify, the admin can set the business to `suspended` or `revoked`.

**The owner opened the link and landed on the home page or "link expired".**
Either the link was already used or superseded, or the redirect URL is not on the Supabase Auth allow-list (Supabase then falls back to the Site URL). See [Expired auth links](Expired-Auth-Links.md).

**An owner sees "Verify your email" at sign-in but says they already did.**
Check `auth.users.email_confirmed_at` for that address. If it is set, the owner is typing a different address from the one on the business. If it is null, the link was never completed.

## Rollout runbook

This is text for a human to execute. Nothing here has been run. Each step is a gate: do not continue past a step that did not pass.

### Hard order

1. **S1 passes** (section 1 below). Nothing is applied or merged before this.
2. Run the pre-rollout checks (section 2).
3. Apply the additive migration (section 3). It is safe while the old frontend is live.
4. Add the redirect URL to the Supabase Auth allow-list (section 4).
5. Merge the PR and deploy, **only when told** (section 5). Merging deploys `main`, so steps 3 and 4 must already be done: a frontend deployed before the migration would call `register_business_unconfirmed` before it exists and break registration.
6. Manual QA on production with a real inbox (section 6).
7. **Only then** apply the cutover migration (section 7).
8. Confirm "Confirm email" is enabled for CareFind (section 8).

### 1. Spike S1 (hard gate)

Question: does a recovery-type action link confirm an unconfirmed user on the live project?

Needs the production service-role key. A human runs it, or explicitly approves use of the key. The key must never be written to a file: export `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the running shell session only, save the script in a scratch directory **outside the repository** and run it from there, and unset both variables afterwards. It creates one throwaway `@example.com` user and deletes it. `generateLink` does not send mail.

```js
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const email = `s1-spike-${Date.now()}@example.com`
const redirectTo = 'https://carefindhub.com/reset-password?welcome=1'

const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, password: randomUUID(), email_confirm: false })
if (createErr) throw createErr
const id = created.user.id
try {
  const before = (await admin.auth.admin.getUserById(id)).data.user.email_confirmed_at
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } })
  const res = await fetch(link.properties.action_link, { redirect: 'manual' })
  const after = (await admin.auth.admin.getUserById(id)).data.user.email_confirmed_at
  console.log(JSON.stringify({
    before, after, linkError: linkErr?.message ?? null, status: res.status,
    location: (res.headers.get('location') || '').replace(/(access_token|refresh_token|code|token_hash)=[^&#]+/g, '$1=<redacted>'),
  }, null, 2))
} finally {
  await admin.auth.admin.deleteUser(id)
}
```

Run, from the scratch directory outside the repository, in the same shell session where the two variables were exported:

```
node s1-recovery-confirms.mjs
```

Afterwards: `unset SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY` (PowerShell: `Remove-Item Env:SUPABASE_URL, Env:SUPABASE_SERVICE_ROLE_KEY`) and delete the script. Do not create a `.env` file and do not pass `--env-file`.

**Pass criteria:** `before` is `null`, `after` is a timestamp, `status` is 302 or 303, and `location` begins with the `redirectTo`.

If `redirectTo` is not yet on the allow-list, `location` will be the Site URL. That is not an S1 failure: record it and rely on step 4 (the allow-list). The confirmation (`after` is a timestamp) is the part that gates the rollout.

**If S1 fails** (`after` is still null, or the link errors): do not merge. Fall back to `auth.resend` with `type: 'signup'`, or a password-bearing signup link. The tasks that would change are **Task 3** (the `owner_setup` action in `packages/shared-email/src/authEmail.js`, which currently mints `type: 'recovery'`) and **Task 6** (the `?welcome=1` landing and the sign-in resend in `ResetPassword.jsx` and `Login.jsx`, which assume the link both confirms and opens a session in which `updateUser({ password })` works). The migrations, trigger, handler and admin console are unaffected.

### 2. Pre-rollout checks (read-only, on live)

Use the Supabase project ref recorded in the project's Supabase gotchas notes; confirm you are on the live project.

1. **`businesses.status` is NOT NULL.** The trigger's `new.status not in (...)` is NULL-unsafe if the column is nullable (a NULL new status would pass the guard).
   ```sql
   select is_nullable, column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'businesses' and column_name = 'status';
   ```
   Expect `is_nullable = NO`. If `YES`, stop and fix the trigger before applying.
2. **Admin guard exists with the expected ACL.** The admin RPC calls `public.is_platform_admin()`.
   ```sql
   select p.oid::regprocedure, p.proacl from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_platform_admin';
   ```
   Expect one function. If it is missing the admin RPC raises on every call.
3. **`businesses_status_check` vocabulary.** Confirm it allows exactly `pending`, `active`, `suspended`, `revoked`.
   ```sql
   select pg_get_constraintdef(oid) from pg_constraint where conname = 'businesses_status_check';
   ```
4. **`staff_welcome` catalog row exists** (the migration copies from it and silently inserts nothing if it is absent).
   ```sql
   select app, event_key from email_event_catalog where app = 'carehub' and event_key = 'staff_welcome';
   ```
5. **Security advisors, baseline.** Run the security advisors and save the output.

### 3. Apply the additive migration (before the merge and deploy)

Apply `carehub_20261029_owner_email_verification` as a **tracked migration** (`apply_migration`, not `execute_sql`). Then verify:

1. **Execute rights.**
   ```sql
   select p.oid::regprocedure, p.proacl
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('mint_unconfirmed_auth_user', 'register_business_unconfirmed',
                        'guard_business_owner_email_confirmed', 'admin_unverified_owner_business_ids');
   ```
   - `mint_unconfirmed_auth_user`, `register_business_unconfirmed`: `postgres` and `service_role` only.
   - `guard_business_owner_email_confirmed`: no `anon` or `authenticated`.
   - `admin_unverified_owner_business_ids`: `authenticated` and `service_role` (and `postgres`); no `anon`.
   If `anon` or `authenticated` appears where it should not, apply a follow-up migration with `revoke ... from anon, authenticated`. Default privileges can add grants that an in-migration `revoke` does not remove, which is why `proacl` is re-read rather than assumed.
2. **No differently-signed siblings.**
   ```sql
   select proname, count(*), array_agg(oid::regprocedure)
     from pg_proc where pronamespace = 'public'::regnamespace
      and proname in ('mint_unconfirmed_auth_user', 'register_business_unconfirmed',
                      'guard_business_owner_email_confirmed', 'admin_unverified_owner_business_ids')
    group by proname;
   ```
   Each returns count 1.
3. **Catalog row.**
   ```sql
   select event_key from email_event_catalog where app = 'carehub' and event_key = 'owner_setup';
   ```
   One row.
4. **Trigger present.**
   ```sql
   select tgname, tgenabled from pg_trigger where tgname = 'businesses_require_verified_owner';
   ```
5. **Security advisors, after.** Compare with the baseline: no new findings.
6. **Old frontend still registers.** `register_business(jsonb, text)` must still be executable by `anon` at this point (the cutover has not run).

### 4. Supabase Auth redirect allow-list

Supabase dashboard, Authentication, URL Configuration, Redirect URLs: add `https://carefindhub.com/reset-password` (a `/**` wildcard for the origin also works, as recommended in [Expired auth links](Expired-Auth-Links.md)). If the `?welcome=1` URL is not honoured, Supabase redirects to the Site URL instead and the owner will not see the set-password page.

### 5. Merge and deploy

Merge only when told; this deploys `main`. Steps 1 to 4 must be complete first.

### 6. Manual QA on production

With a real inbox, and at 375, 768 and 1280px:

- **Register** a new business: the done screen tells the owner to check their inbox; the email arrives; the link opens "Email verified"; set a password; you are redirected to sign in; sign in; you see the pending-review state.
- **Sign in before clicking:** you see "Verify your email to continue" and the resend control. Resend delivers a new link and the old link no longer works (each minted link invalidates the previous one).
- **Open the link a second time**, and an expired link: you land on `LinkExpired`.
- **Admin console:** the new business shows "Awaiting email verification" and bulk approve skips it with a count; approval works after the owner verifies (after Refresh).
- **Trigger:** with the business still unverified, a direct `PATCH businesses?id=eq.<id>` setting `status=active` as a platform admin is refused with "The owner has not verified their email address yet."
- **CareFind:** the "check your inbox" state shows "Resend verification email"; one click delivers a link and then disables for 60 seconds.

Responsive checks have **not** been performed for any UI change in this work (Register, Login, ResetPassword welcome, admin console, CareFind resend). They are part of step 6, not optional.

### 7. Cutover

Only after step 6 passes: apply `carehub_20261030_revoke_register_business` as a tracked migration. Then:

```sql
select p.oid::regprocedure, p.proacl from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.proname = 'register_business';
```

Expect no `anon` or `authenticated`. Then call `rpc/register_business` directly with the anon key: expect `401` or `403` (permission denied). Run the security advisors again.

### 8. CareFind "Confirm email"

In the Supabase dashboard (Authentication, Providers, Email) confirm "Confirm email" is enabled. It is not readable from SQL. Confirm the CareFind and CareHub origins are on the redirect allow-list.

### Rollback

- **Cutover** (single statement): `grant execute on function public.register_business(jsonb, text) to anon, authenticated;`
- **Additive migration:** the old frontend does not depend on it. To disable the gate without dropping anything, `drop trigger businesses_require_verified_owner on public.businesses;`.
- If the emailed link turns out not to confirm owners after deploy (S1 was wrong or skipped), owners cannot complete setup. Roll back the frontend deploy and, if already applied, the cutover grant above, then follow the S1 fallback.

## Known residual risks

- **17 grandfathered owners** keep access with addresses that were never proven.
- **Unverified rows linger.** There is no automatic deletion of unconfirmed owner users or their pending rows. Whether to delete after N days is a decision still pending (destructive, so it needs an explicit owner).
- **No per-IP throttle on registration.** The design called for one; CareHub has no IP limiter in its handlers and registration was already unauthenticated, so only per-address limits apply (`owner_setup` 5 per hour, `password_reset` 3 per hour). Each unverified registration creates an auth user and a pending row.
- **Possible duplicate emails.** `/api/notify-registration` is still called by the wizard and sends its own confirmation, so the owner may receive two emails.
- **Responsive layout unverified** at 375, 768 and 1280px for Register, Login, ResetPassword (welcome), the admin console and the CareFind resend control.
- **Concurrent old-path and new-path registration** before the cutover can surface a raw unique-violation error (`23505`) instead of the friendly message.
- **Handler input is not type- or length-checked** beyond email and name presence; the response waits for the email send.
- **S1 is unproven** until it is run (see the gate above).
