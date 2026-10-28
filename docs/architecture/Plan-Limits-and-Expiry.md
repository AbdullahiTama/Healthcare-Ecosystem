# CareHub Plan Limits and Expiry

## Review findings (2026-10-27)

| Finding | Before | Now |
|---|---|---|
| Plan limits (staff, locations, products) | Checked only in the browser; the database accepted anything | Enforced by the database too (`carehub_20261214_plan_enforcement`) |
| Expired plan | Nothing changed: a banner from 7 days before expiry, never restricted | 7-day grace, then restricted mode (below) |
| Expiry emails | Only for plans expiring in the next 7 days, never after expiry; none had ever been sent | 14/7/3/1 days before, on expiry, during grace, then weekly while restricted |
| Email brand | The CareFind cron sent with CareFind's sender, so the CareHub reminder would render as CareFind | Sent as CareHub (`app: 'carehub'`, CareHub sender) |
| Email "Renew" link | `/billing`, which CareHub does not have | `/dashboard/settings` |
| Live data | 25 of 31 businesses past their expiry, most since 17–18 Aug 2026 | They get a fresh 7-day grace from the day the migration is applied |

**Separate finding (fixed):** adding staff failed in production because `Staff.jsx` inserted the staff row directly,
which the live `guard_staff_writes` trigger refuses ("Staff members are added by invitation"). Staff.jsx now calls the
live invitation flow: `POST /api/staff-invitations` (`api/_handlers/staff-invitations.js`) runs `create_staff_invitation`
and emails a single-use, 7-day link; the invitee sets their own password on `/accept-invite`. Pending invitations show
as "Invited" with a "Resend invite" action and count toward the plan's staff limit. Requires `SUPABASE_SERVICE_ROLE_KEY`,
the email provider keys, and optionally `CAREHUB_APP_URL` (the invite link base) in the server environment.
The plan check below applies to that flow too.

## Policy (owner's decisions)

| State | When | What works |
|---|---|---|
| active | More than 14 days left (or no expiry) | Everything |
| expiring | 14 days or fewer left | Everything; banner for owner and managers; daily popup in the last 7 days |
| grace | Expired, for 7 days | Everything; red banner and daily popup |
| restricted | After the grace period | Records stay readable and the **POS keeps selling**. Paused: adding staff, branches and products (so product imports, and purchases that would create new products), and exports |

- The grace period ends 7 days after `max(plan_expires_at, enforcement start)`. Businesses already expired when the
  migration is applied therefore get the full 7 days, and nobody is restricted without warning.
- Plan limits apply in every state:

  | Plan | Staff | Locations | Products |
  |---|---|---|---|
  | Basic | 5 | 2 | 5,000 |
  | Growth / Hospital | unlimited | 5 | unlimited |
  | Premium | unlimited | 10 | unlimited |
  | Enterprise | unlimited | 30 | unlimited |
  | Custom | unlimited | unlimited | unlimited |

  Locations count the main business plus every branch.
- Renewing (Settings → Renew) always works and lifts everything at once.

## Database (`supabase/migrations/carehub_20261214_plan_enforcement.sql`)

- `plan_enforcement_started_at()` is fixed at first apply; re-running keeps it.
- The rules live in one place: `plan_limit(plan, what)`, `plan_grace_ends_at(expiry)` and `plan_state(expiry)`. The
  limits match `lib/planLimits.js`, and a test fails if they ever differ.
- `business_plan_status(business_id)` returns JSON with the state, dates and limits. It is members only.
- Enforcement:
  - **Products:** a statement-level check after insert, so a bulk import is checked as a whole. It runs as the
    caller (SECURITY INVOKER), so server code and platform admins are not limited.
  - **Staff:** a check before insert. It applies to every caller, including the SECURITY DEFINER invitation
    function, except a platform admin.
  - **Branches:** `guard_business_insert` is re-created from its live definition, plus the restricted and location
    checks.

## App

| File | Role |
|---|---|
| `lib/planStatus.js` | States, banner wording, who sees alerts (owner and managers), the "paused" message |
| `hooks/usePlanStatus.jsx` | `PlanStatusProvider` in `BusinessDashboard` loads the status once for every screen; before the migration it estimates from the expiry date and never restricts |
| `hooks/usePlanGate.js` | `allow(what)` checked before each paused action, which shows why and stops it |
| `components/layout/PlanExpiryBanner.jsx` | Banner on every page for the owner and managers |
| `components/layout/PlanNotice.jsx` | Once-a-day popup (remembered per business per day in this browser) |

The following actions are gated:
- Staff → Add staff.
- Locations → Add branch.
- Inventory → Add product, Import, and Export.
- Purchases → lines that would create new products. Restocking existing products still works.
- Sales & Accounts → Export.
- Reports → Export.

## Emails (`apps/carefind/api/cron/check-subscription-expiry.js`, daily at 08:00 UTC)

- `_lib/planReminders.js` picks the stage:

  | Stage | When |
  |---|---|
  | `before_14`, `before_7`, `before_3`, `before_1` | Before expiry |
  | `expired`, `grace_mid`, `grace_last` | During grace |
  | `restricted_wN` | Weekly while restricted, then monthly after eight weeks |
  | `lapsed_*` | Before the migration: plain expiry reminders that say nothing about restrictions |

- Each stage is sent once per plan period. Its `idempotency_key` (`plan_reminder:<business>:<expiry date>:<stage>`) is
  unique in `email_outbox`, so a re-run cannot send it twice.
- One template, `subscription_expiry`, takes a `stage`.
- Emails go to the owner of each active main business. Branches follow their main business.
- Delivery depends on the email provider configuration (`RESEND_*` / Vault secrets), which was reported missing
  earlier. If those are not set, reminders queue in `email_outbox` without being delivered.

## Security implications

- No permission is widened. All checks only refuse writes.
- `business_plan_status` is SECURITY DEFINER only to read the business row. It returns nothing for a business the
  caller cannot see.
- The trigger functions cannot be called directly.
- The browser checks are for clear messages. The database is the boundary.
- Platform admins and server code bypass the product and branch checks, as they already bypass the business guards.
  Staff checks bypass only for platform admins.

## Deployment

Safe in either order:
- **App before the migration:** alerts estimate from the expiry date, nothing is restricted, and reminders use the
  `lapsed` wording.
- **Migration before the app:** the database enforces, and the old app shows its own limit messages plus the
  database's refusal text.

## Test plan

- **PGlite** `apps/carefind/src/test/plan-enforcement` (14 tests):
  - the limits match `planLimits.js`;
  - the states, and the fresh grace at go-live;
  - re-running keeps the start date;
  - status is members only;
  - products: restricted, a 5,000 bulk insert refused as a whole, and the service-role bypass;
  - staff: limit, restricted, and the admin bypass;
  - branches: the Basic and Growth limits, a deleted branch freeing a place, restricted, and the existing ownership
    guard;
  - grants.
- **Unit tests:**
  - `lib/planStatus.test.js`;
  - `PlanExpiryBanner.test.jsx`: restricted, grace and once-a-day, cashier hidden, before the migration;
  - the Locations paused-branch test;
  - `_lib/__tests__/planReminders.test.js` and `checkSubscriptionExpiry.test.js`: CareHub sender, idempotency,
    grace and restricted;
  - `shared-email subscriptionReminders.test.js`.
- **Manual, after applying the migration:**
  1. Set a test business's `plan_expires_at` to 3 days ago and confirm the grace banner and popup.
  2. Move `plan_enforcement_started_at` back 8 days and confirm restricted: adding a product is refused while selling
     still works.
  3. Run the cron with `CRON_SECRET` and check `email_outbox`.
