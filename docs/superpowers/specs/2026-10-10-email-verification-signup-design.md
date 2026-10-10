# Email verification at signup: design

Status: draft for review. Nothing in this document is implemented.

## 1. Problem

A person must not hold an account on an email address they have not proven they own.

| Path | Today |
|---|---|
| CareFind customer (`AuthContext.signUp`) | Verified. Supabase `signUp` returns no session while "Confirm email" is on; the app then sends the templated `email_verification` mail; `/verify-email` settles the result. Production evidence: all 7 self-signups since August were confirmed via the link, none auto-confirmed. |
| CareHub business owner (`register_business` RPC) | **Not verified.** The RPC calls `mint_confirmed_auth_user`, so the owner gets an already-confirmed account on any address typed. 17 of 17 owners created since the RPC change were confirmed at creation. |

Two facts make a UI-only fix useless:

1. `register_business` is executable by `anon` and `authenticated` (checked on `pg_proc.proacl`), so the wizard can be bypassed by calling PostgREST directly.
2. `staff_setup` in `auth-email.js` already refuses unconfirmed owners ("anyone could claim a business by registering its address"), but that check is vacuous while every owner is minted confirmed.

## 2. Goals and non-goals

Goals

- CareHub owners prove the email before they can sign in or be reviewed.
- After verification the owner is taken to a page where they set their own password (no password is typed before ownership is proven).
- Registration cannot be completed by calling the database directly.
- Expired, used and re-sent links recover cleanly.
- CareFind's existing flow is confirmed and hardened, not rebuilt.

Non-goals

- Phone verification, social login, SSO.
- Re-verifying the 17 owners already confirmed (grandfathered, see section 8).
- Changing CareFind to a post-verification password step (Supabase `signUp` needs the password up front).

## 3. CareHub flow

1. The wizard no longer asks for a password or a confirmation.
2. It posts to a new `POST /api/register-business` handler.
3. The handler validates input, applies an IP and per-address rate limit, then calls a new service-role-only RPC `register_business_unconfirmed(p_business jsonb)`.
4. The RPC, in one transaction, creates the auth user **unconfirmed** with an unusable random password (new helper `mint_unconfirmed_auth_user(p_email)`, sibling of `mint_confirmed_auth_user`, including the pgcrypto fix from `carehub_20261025`) and inserts the `pending` business row.
5. The handler sends the templated `owner_setup` mail in-process through `sendAuthEmail`. The link is a **recovery-type** action link, which confirms the email and opens a recovery session.
6. The link lands on CareHub `/reset-password?welcome=1`. The page shows "Email verified. Choose a password", calls `updateUser({ password })`, signs the recovery session out, and sends the owner to `/login` with a success notice.
7. The owner signs in and sees the existing pending-review state.

Resend uses the existing public `password_reset` action. It is generic, rate-limited and enumeration-safe, and a recovery link confirms an unconfirmed account the same way. The sign-in screen offers it when Supabase returns `email_not_confirmed`.

The wizard's done screen says what happens next: check the inbox, verify, set a password; review starts after that.

## 4. Gating

- **Sign-in:** unconfirmed owners cannot sign in (Supabase `email_not_confirmed`). Login shows a verify-your-email state with resend.
- **Admin queue:** the pending list marks, and excludes from approval, businesses whose owner has `email_confirmed_at is null`, read server-side through an admin RPC (never a client filter). Reviewers see "awaiting email verification".
- **Staff invites:** the existing `email_confirmed_at` check in `authoriseStaffInvite` becomes meaningful.

## 5. Database

New migration, applied as a **tracked migration** (not `execute_sql`):

- `mint_unconfirmed_auth_user(p_email text) returns uuid`: `SECURITY DEFINER`, `service_role` only.
- `register_business_unconfirmed(p_business jsonb) returns uuid`: same validation as `register_business` minus the password; `service_role` only; takes the same advisory lock pattern used by `payout_account_add`.
- `REVOKE EXECUTE ON register_business(jsonb, text) FROM anon, authenticated`. The old function is kept (revoked) so a rollback is a `GRANT`.
- Email event catalog entry and template for `owner_setup`.
- Admin pending-businesses RPC gains an `owner_email_confirmed` column.

After applying: re-read `pg_proc.proacl` for all three functions, check there are no differently-signed siblings, and run the advisors before and after (see the project's Supabase gotchas).

## 6. CareFind hardening

- Add a resend control to the "check your inbox" state in `Login.jsx`, wired to the existing rate-limited `email_verification` action.
- Tests that no session exists, and no authenticated call succeeds, before confirmation.
- Manual: confirm "Confirm email" is on for the production project (a dashboard setting not readable from SQL), and that `https://carefind.app/**` and the CareHub origin are on the redirect allow-list.

## 7. Security

- Closes impersonation and squatting of an address, and the anon-callable registration RPC.
- No new unauthenticated email trigger: first send is server-initiated from the handler; resend reuses the audited `password_reset` path (generic response, padded timing, per-address limits).
- The set-password page never renders URL text; it reads only allow-listed query values, like `LinkExpired`.
- The handler logs error codes only, never tokens or addresses.
- The password is never stored anywhere but Supabase Auth; the unusable placeholder password is random and never disclosed.

Residual risk: the 17 grandfathered owners; unverified rows can linger (see section 9).

## 8. Grandfathering

Owners already confirmed keep access. They are not re-prompted in this change. An optional follow-up can flag them in the admin UI as "created before verification".

## 9. Open questions

1. **Spike S1 (blocks everything):** confirm on a throwaway user that `generateLink({ type: 'recovery' })` works for an *unconfirmed* user and that completing it sets `email_confirmed_at`. If it does not, fall back to `type: 'signup'` with `auth.resend`, or a password-bearing signup link.
2. **Unverified retention:** delete unconfirmed owner users and their pending rows after N days? Destructive, so it needs your decision. Default in this spec: do not auto-delete; surface the list to admins.
3. **Template copy:** `owner_setup` wording, owned by whoever manages email templates.

## 10. Test plan

- Handler: validation, per-address and per-IP limits, generic response for an existing address, no token in logs.
- Database (real Postgres suite): unconfirmed user plus pending business created atomically; rollback leaves no orphan auth user; `anon` cannot execute the old or new RPC; duplicate emails rejected.
- UI: wizard without password fields; set-password page states (valid, expired, used); login unconfirmed state; admin queue marking.
- Manual at 375, 768 and 1280px: register, email, click, set password, sign in; expired link; resend.

## 11. Delivery

Branch, PR, CI, merge: `main` deploys. Separate commits for the migration, the CareHub handler and UI, and the CareFind hardening. Documentation updates: `docs/architecture/Expired-Auth-Links.md` and a new registration section.
