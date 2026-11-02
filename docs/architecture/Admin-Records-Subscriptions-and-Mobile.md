# CareHub Admin: Mobile Layout, Full Records and Exports, Subscription Management

Platform administrators can use the console on a phone, open any record in full and export it, and manage every
business's subscription (plan, free or complimentary access, extensions, suspension) without a developer.

## 1. Mobile layout

| Width | Navigation | Header |
|---|---|---|
| 1024px and wider | Sticky sidebar, collapsible to a 64px rail (unchanged) | Title, live status with last sync, permission count, ⌘K, Sign out |
| Below 1024px | Off-canvas drawer opened by the header's menu button | As above |
| Below 768px | Drawer | Compact: live/offline dot only, search icon, Sign out; 12px content padding |

- The drawer is a modal dialog: focus moves into it, Tab is trapped, Escape or the backdrop closes it, choosing a
  destination closes it, and focus returns to the menu button. Page scroll is locked while it is open.
- Detail sheets open from the bottom on phones and can now use up to 90% of the screen (they were fixed at 50%), so a
  full record is readable. Footers wrap their buttons.
- Lists switch to cards on phones (Businesses, Subscriptions, ADR Reports); Applications and Payouts are card lists at
  every width. The Ledger's two columns stack on narrow screens.
- Verified in Chromium at 390×844 and 1280×800: no horizontal page scroll on any of the screens above.

## 2. Full records and exports

Every record below opens in a sheet showing all of its stored information, and has a single-record export. Each list
has an export of everything matching the current filters.

| Section | Opens | Shows |
|---|---|---|
| Applications | Any card | Applicant and contact; location and **selected areas**; **every answer on the form** (each `applicant_details` / `details` key, so questions added later appear automatically); review status, dates and notes |
| Businesses | Any row or card | Full profile: business, owner and contact, location (address, area, city, LGA, state, coordinates, map link), subscription, CareFind and service settings, onboarding (referral code, agent) |
| Subscriptions | Any row or card | See section 3 |
| ADR Reports (new) | Any report | Case metadata, the full case (reporter, patient, suspect products, concomitant medications, reactions, module-specific sections, deadline) and evidence photos |
| Payouts | Any card | Amount, requester, bank details, method, timeline, notes |

"Ambassador" applications are the agent applications (`agent_applications`, and `applications` rows of type `agent`);
the console labels them "Ambassador (agent)".

### Export governance

Exports carry personal and clinical data, so every admin export:

1. asks for a reason (at least 3 characters);
2. writes `export_logs` (export type, row count, reason, and a watermark naming the admin and the time) — this table is
   platform-admin only and is visible under Health › Audit log;
3. only then produces the file. If the log cannot be written, nothing is downloaded.

ADR exports also add an `exported` event to each case's own timeline (`adr_log_event`), as exports from the Hub do.

| Export | Format | Notes |
|---|---|---|
| Businesses | CSV | Every business matching the search and status (previously only the visible page of 10) |
| Business / application / payout / subscription history | CSV | Field, value pairs or one row per entry |
| Applications, Subscriptions, Payouts | CSV | Filtered list |
| ADR report | PDF (print), E2B XML, CSV | Same documents the reporting business produces |
| ADR reports | CSV (all filtered), PDF (first 200) | |

CSV cells that begin with `=`, `+`, `-`, `@`, tab or CR are prefixed with an apostrophe so spreadsheets open them as
text (formula injection). Plain numbers are left numeric. This now applies to the existing business, ledger and ADR
CSV builders too.

Account numbers appear in full only inside an open payout request; payout lists and exports carry the last four
digits. Online-store applications show the payout account masked and never show BVN or NIN.

## 3. Subscription management (Money › Subscriptions, also in the sidebar)

### What administrators see

For every main business: plan, state (Active, Expiring soon, Expired — grace, Restricted, Suspended), payment status,
how access was obtained (Paid, Free trial, Complimentary, Partnership, Contribution, Promotion, Other arrangement,
Set by an administrator, Signup period), current period start, expiry date and days left, grace end, payments made,
total paid, last payment, branches. Summary chips filter by state; search, plan and access filters narrow the list.

Opening a business shows the history: payments (renewals, with receipt numbers) and every administrative change, with
the reason and the administrator.

### What administrators can do

| Action | Effect |
|---|---|
| Change plan | New plan; expiry unchanged. Branches follow. |
| Grant free access | Trial or complimentary access (partnership, contribution, promotion, other) for 1, 3, 6, 12 or 24 months or a number of days, optionally on another plan. Added after any time already paid for. |
| Extend | Adds time after the current expiry (or from today if it has passed). |
| Set expiry date | Exact date, access to the end of that day (Lagos time). |
| Suspend | Restricted mode immediately (records readable, POS sells; new staff, branches, products, imports and exports paused). The time left is recorded. |
| Activate | Lifts a suspension and gives back the recorded time from today. |

Every change needs a reason and a confirmation step.

### Database (`supabase/migrations/carehub_20261230_admin_subscription_management.sql`)

- The live plan is `businesses.plan` / `plan_expires_at`, enforced by `plan_state()` and friends
  (`carehub_20261214_plan_enforcement`). `business_subscriptions` is an unused, empty mirror and is left alone.
- `subscription_events`: append-only history (update, delete and truncate refused by trigger); platform admins read it;
  no client can write it. No foreign key to `businesses`, so history outlives a hard delete and does not block it.
- `admin_manage_subscription(business, action, reason, plan, months, days, expires_at, grant_type)`: the only write
  path. Resolves a branch to its main business, locks the row, validates, updates the plan columns, writes
  `subscription_events` and `admin_audit_log` in one transaction, and returns the new plan, expiry and state.
- `admin_subscription_overview()` and `admin_subscription_history(business)`: the list and the timeline.

### Working with the automated payments

- Paystack, the wallet, `renew_business_plan`, the webhook and `verify-plan-payment` are untouched.
- Free access is never a payment: nothing is written to `plan_payments`, so receipts, revenue, reconciliation and
  referral commissions only reflect money actually paid.
- A payment made while suspended renews as normal and lifts the suspension (a suspension is "open" only while the expiry
  it set is still in place).
- Suspension is a plan-level pause. To block all access, suspend the business itself (Businesses › Suspend).
- Until `plan_enforcement_started_at() + 7 days` (2026-11-03 20:44 UTC in production) the go-live grace floor keeps
  every business in grace, so a suspension made before then shows as grace and becomes restricted at that moment.

## Security implications

- Nothing is widened. Every new function refuses (42501) anyone who is not `is_platform_admin()`. Platform admins could
  already PATCH the plan columns directly; the new path adds validation, a reason and an audit trail. The actor is
  always `auth.uid()` / `auth.email()`.
- ADR reports: platform admins could already read every case (`can_access_adr_report_row`). The console renders the
  case from the shared, escaped print fragment inside a sandboxed iframe that cannot run scripts.
- **Fixed:** concomitant medication names and doses were written unescaped into the ADR print document, which opens in
  a window sharing the app's origin. Public reporters can type those fields, so a crafted report could run script in an
  admin's or business user's session when printed. They are now escaped (also the bulk export's organisation name and
  filter label).
- The sidebar permission checks (`Money` for Subscriptions, `Compliance` for ADR Reports, and so on) shape the UI only;
  the database remains the boundary.

## Other fixes made along the way

- `ConfirmDialog` takes `consequence` / `danger`, but most admin screens passed `message` / `variant`, so the dialogs
  showed no explanation. Fixed on every admin screen. This makes the Delete business dialog's Soft/Hard choice visible
  again (it was always soft because the choice could not be seen).
- Sheets sat above confirmation dialogs (z-index 1000 vs 999), hiding any confirmation opened from a sheet, such as
  Delete. Sheets now sit below dialogs, and keys pressed in a dialog are left to it.
- Dashboard: hooks ran after early returns, which React rejects when the list changes from empty to non-empty.
- Businesses: the panel was replaced by a spinner on every search keystroke, dropping focus from the search box.
- Applications: online-store applications from the store flow showed "approved" without changing anything. They are
  now view-only here and point to CareFind Admin › Shop, where they are reviewed. Rejecting an application now needs a
  reason, saved on the application.

## Deployment

**The migration is not applied yet.** Apply `carehub_20261230_admin_subscription_management.sql` before or with the app.

- App first: Subscriptions shows "Subscription management is not switched on yet" with the migration name; everything
  else works.
- Migration first: nothing changes for the current app (new objects only).

## Test plan

- PGlite `apps/carefind/src/test/plan-enforcement/adminSubscriptions.db.test.js` (25): refusals for owners and anon;
  history not writable; validation; plan change with branches following; branch id resolves to the main business;
  grants added after paid time with no payment or commission; trial from today; exact expiry; suspend → restricted and
  activation restoring the remaining time; plan change while suspended; payment lifting a suspension; no-expiry
  suspension; audit rows; append-only; merged history; overview scope.
- Unit and component (CareHub): `subscriptionAdmin.test.js`, money repository RPCs, `Subscriptions.test.jsx`,
  `shared.test.jsx` (record display, reason-gated export, fail-closed), `applicationRecords.test.js`,
  `ApplicationsPanel.test.jsx`, `PayoutsPanel.test.jsx`, `businessRecord.test.js`, `AdrReportsAdmin.test.jsx`, ADR
  repository `getPlatformReports`, ADR export escaping, CSV formula safety, `AdminShell.responsive.test.jsx`.
- Manual, after applying the migration:
  1. On a phone, open the menu, go to Subscriptions, open a business and grant a 1-month trial with a reason. The expiry
     moves, the history shows the grant with your email, and Health › Audit log shows `subscription.grant`.
  2. Suspend a test business; its owner sees restricted mode (after 2026-11-03 20:44 UTC). Activate it; the previous
     expiry (from today) returns.
  3. Renew that business in Paystack test mode while suspended; the overview shows it as Paid and no longer suspended.
  4. Open an ambassador application and an ADR report; export each with a reason; check `export_logs`.
