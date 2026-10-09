# Staff Management — Business Domain

## Purpose
Team membership for a CareHub tenant: inviting people, assigning roles, activating/deactivating members, defining custom roles, and (for CareFind-connected businesses) approving staff members' claims to their public CareFind position.

## Model (since C21, 2026-10-09)
Standard organisation-membership practice:

- **Owner** — the business account itself (`businesses.email`). Not a staff role: it cannot be assigned, demoted or removed from the Staff page. Shown at the top of the team list as the account holder.
- **Staff join by invitation.** The inviter enters name, email and role. The server generates a single-use, 256-bit token, stores only its sha256 hash, and emails the link (valid 7 days). The invitee sets **their own** password on `/accept-invite`. Nobody else ever chooses or sees it.
- **One email = one identity.** An invitation is refused for an email that is a business owner's login, already a member of (or invited to) this business, or active staff elsewhere.
- **Existing accounts are never overwritten.** If the invited email already has a confirmed login (e.g. a CareFind user), the invitee signs in with that password to accept. An unconfirmed (never-verified) account is claimed by the inbox owner via the token.
- **Who manages staff:** the Owner, platform admins, and active staff whose role grants `canManageStaff` ("staff admins").
- **Least privilege:** only the Owner may grant `canManageStaff` (assign or author such a role) or act on someone who holds it; nobody can change or remove their own membership; email/business/login of a member are immutable (remove and re-invite instead).
- **Seats:** active members + pending invitations count against the plan's `maxStaff` (`lib/planLimits.js`); deactivated members do not.

All rules are enforced in the database (triggers + RPCs), so they hold for any client; the UI mirrors them to only offer actions that will succeed.

## Files
- `apps/carehub/src/modules/staff/Staff.jsx` — the page (team list, invite modal, role edit, Roles & Permissions editor, CareFind claims).
- `apps/carehub/src/modules/staff/services/staffPolicy.js` — client mirror of the governance rules (assignable roles, who can act on whom, seats, validation).
- `apps/carehub/src/modules/staff/services/invitations.js` — invite/resend (via the API) and lookup/accept (RPCs).
- `apps/carehub/src/modules/staff/repositories/index.js` — `staff` / `roles` / `staff_claims` reads and scoped updates/deletes. No direct `create`: staff are never inserted from the client.
- `apps/carehub/src/pages/auth/AcceptInvite.jsx` — public `/accept-invite?token=…` page.
- `apps/carehub/api/staff-invitations.js` — server endpoint: verifies the caller's JWT, generates the token, calls the service-role RPC, sends the email.
- `apps/carehub/src/lib/email.js` — `emailStaffInvitation` (server-side only; HTML-escaped; no password).
- `apps/carehub/src/lib/permissions.js` — preset roles (`ROLES_FOR_TYPE`, no `Owner`), `isReservedRoleName`, `getPerms`.
- `apps/carehub/sql/20261009_staff_invitations_and_role_governance.sql` — schema, triggers, RPCs, verification.

## Database
`staff` gains `invited_at, invited_by_email, invite_token_hash, invite_expires_at, accepted_at`; `status ∈ {active, inactive, invited}`; unique `(business_id, lower(email))`.

| Function | Callable by | Purpose |
|---|---|---|
| `create_staff_invitation(actor_email, …, token_hash, expires_at, max_staff)` | service_role | Authorize actor, validate, check conflicts + seats, insert `invited` row |
| `reissue_staff_invitation(actor_email, staff_id, token_hash, expires_at)` | service_role | Rotate token (old link dies), extend expiry |
| `get_staff_invitation(token)` | anon, authenticated | What the accept page shows; `state` valid/expired/invalid |
| `accept_staff_invitation(token, password?)` | anon, authenticated | Create account or require sign-in; activate membership |
| `can_manage_staff(business_id)` | authenticated | Does the signed-in user manage staff here |
| `guard_staff_writes` / `guard_role_writes` (triggers) | — | Police every direct PostgREST write to `staff` / `roles` |

`provision_staff_auth` was dropped: it linked a staff row to *any* existing account with that email — the root cause of the incident below.

## Incident that motivated C21
An owner added a staff member and "when the new staff added his password it changed the password of the business owner". Supabase Auth has one account per email; the old flow attached the staff row to an existing account (the owner's own email), mailed a password that was never applied, and the subsequent password reset changed that single shared account. See the migration header for the full analysis.

## Test plan
- Unit: `staffPolicy.test.js`, `invitations.test.js`, `api/staff-invitations.test.js`, `permissions.test.js`.
- Database: the migration's §8 verification (attacks as Cashier / staff admin / Owner; existing-account and expiry paths). Run against a scratch Postgres with a Supabase-like stub on 2026-10-09 — all cases behaved as specified.
- Manual (after deploy): invite a new email → accept → sign in; invite your own email → refused; invite an existing CareFind user → must sign in, password unchanged; staff admin cannot grant "Manage staff"; resend → old link invalid; revoke → link invalid.

## Known gaps / follow-ups
- One business per identity: a person cannot be staff at two businesses with one email (login resolves a single business). Multi-membership with an organisation switcher is the next step if needed.
- Ownership transfer is not supported from the UI.
- Other emails in `lib/email.js` (approvals, registration) are still sent from the browser, where they cannot work (no key, Resend rejects browser calls). They should move server-side like the invitation.
