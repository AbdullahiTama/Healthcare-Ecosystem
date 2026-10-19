# CareHub Location and Privacy

Status: **applied to production 2026-10-19** (`carehub_20261130_staff_checkins`, `carehub_20261133_pin_search_path_location_tables_append_only`). Verified before applying by a rolled-back run against the live schema, and after applying by a rolled-back smoke test and a catalog check (function ACLs, table privileges, RLS, triggers). The screens that call it (`CheckInPanel`, `TeamLocations` in Live Field Activity) are in the `feat/enterprise-directory` branch and are **not deployed** until that branch merges. Business-link confirmation on field reports (Phase 7) is not built yet.

## Policy implemented

- **Events, not tracking.** A position is stored only because the person pressed Check in, Check out or Share location. There is no background or continuous capture, no timer, no watch.
- **Location is requested only on a button press**, once. Business Discovery asks only when the user presses "Use my location" (or asks for "around me"). Merely opening a screen asks for nothing.
- **Separate events.** Login (Supabase Auth), check-in/out/share (`staff_checkins`), field visit and submitted activity (`field_activities`) are different things in different tables. A login never creates a location, and a nearby position never creates a visit. Event types are limited to `workday_checkin`, `workday_checkout`, `location_capture`.
- **Honest failures.** If the browser refuses, times out or is unsupported, the attempt is stored as `status='failed'` with a reason and **no coordinates** (enforced by CHECK constraints). The rep is told that nothing was saved. A failure can never appear as a successful check-in.
- **Reporting is never blocked by location.** Check-in is optional and independent of logging activity or searching the directory.

## Data (`staff_checkins`, migration `carehub_20261123_staff_checkins.sql`)

| Field | Notes |
|---|---|
| `user_id` | Always `auth.uid()`; never accepted from the client |
| `business_id`, `staff_id` | Business must be one the caller owns or is an *active* staff member of, decided in the database. `staff_id` is NULL for an owner |
| `event_type`, `status` | As above |
| `latitude`, `longitude`, `accuracy_m`, `location_source` | Present only when captured; ranges enforced |
| `failure_reason` | `denied`, `unavailable`, `timeout`, `unsupported`, `invalid` |
| `client_captured_at` | Advisory only; discarded if more than 1 day old or more than 5 minutes ahead |
| `created_at` | Database clock |

Append-only: no UPDATE/DELETE grant, and a trigger refuses both even for the table owner. A repeat of the same event by the same person within 5 seconds returns the existing row (double-tap safe); anything later is a new row. There is no direct INSERT grant: writes go through `record_checkin()`.

## Who can see locations

- **The person**: their own rows (RLS `user_id = auth.uid()`).
- **Managers and the owner**: through `manager_checkin_overview(business_id)` only. It requires `is_business_manager()` (a role containing "manager", or the business owner) and **writes a row to `location_access_log` on every successful call**. The log is readable by the person who made the access and by platform admins, and is append-only.
- **Platform admins**: `is_business_manager()` is true for them, so they can call the overview and are logged. This is the existing platform-admin model; whether it should be narrower is an open decision.
- **Everyone else, other companies, anonymous**: nothing.
- Revoking staff (`status` no longer `active`) stops them writing and removes them from the overview immediately.

## Freshness

The overview labels each person's latest *successful* event: `current` (60 minutes old or less), `stale` (older; always shown as an old position, with its age, never as live) or `unavailable` (no successful event). A failed attempt newer than the last success is reported next to it. The 60-minute window is a constant in the function and is a product decision. The wording never says a person "is at" a place, and the screen states that proximity to a business does not mean a visit.

## Not done / open decisions

- **Retention.** No retention or deletion job exists. Append-only history grows indefinitely. Needs a decision (for example 90 days) and a purge path that respects the access log.
- **Consent and notice.** The screen explains what is shared and that nothing is tracked afterwards. Employer notice, consent wording and any legal review for your jurisdiction (including Nigerian data-protection law) are not done and are not something this code can settle.
- **Location label.** The column exists, but no reverse geocoding is performed (it would send coordinates to a third party). Coordinates are shown as a map link.
- **Platform-admin visibility** of employee locations (above).
- **Continuous tracking** is deliberately not implemented. If ever required it needs its own approved policy: purpose, start and stop conditions, notice and consent, visibility, retention, access control, battery and data cost.
- The `activity` side of the overview (`last_activity_at`) reads `field_activities.business_id/staff_id/created_at`, which the repository's migration files do not define. Verify those columns against the live schema before applying.
