# Branch Switching Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make switching between a business's locations safe: the chosen location survives reloads, sign-in lands on the main business, offline sales and carts never cross locations, branches follow the parent's plan, and the Locations page reports what goes wrong.

**Architecture:** One `switchLocation` helper used by both switchers (top bar, Locations page) that swaps `auth.brand`, persists it, and lets the dashboard remount every module (routes keyed by the business id); a small registry lets the POS ask before a switch drops a non-empty cart. App start-up keeps a cached location the signed-in owner can still reach. A database trigger copies a root business's plan and expiry to its descendants.

**Tech Stack:** React 18, vitest, Supabase (draft migration + PGlite test).

**Spec:** the review in conversation on 2026-10-25 (findings 1–7 and minors); owner approved "go ahead".

## Decisions made while executing (2026-10-25)

- businesses.email turned out to be NOT NULL and UNIQUE live: adding a branch with the owner's email was always
  refused, which is why no business has branches. The owner chose **option A**: a branch has no sign-in email; the
  owner of a branch is the owner of its main business (draft carehub_20261212_branches_without_email). Because email
  is an identity column, branches carry no email at all (no "contact email" field).
- Task 1 (sign-in prefers the main business) is dropped: with unique emails and email-less branches an email matches
  one business. The is_platform_admin() draft written on the way is dropped for the same reason.

## Global Constraints

- No business has branches in production (checked 2026-10-25); behaviour for single-location businesses must not change.
- A location is reachable by an owner when it is their root business (parent_business_id is null, email = theirs) or a descendant of it (walk parent_business_id, max depth 10).
- Staff never switch: they always work in their own staff.business_id.
- DB changes are drafts in docs/architecture/pending-migrations/, applied only with the owner's approval.
- One commit per task, explicit paths, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. An owner whose cached location was deleted, deactivated, or belongs to someone else (shared device) must land on their own main business, not the cached one.
2. A queued offline sale with no business_id (queued by an older app version) still syncs under the current location, as before.
3. Switching to the location already active does nothing (no remount, no prompt).
4. A staff member's sign-in and reload never pick a branch other than their own.
5. A branch's plan change by a platform admin is not overwritten by the propagation (only root changes propagate).

---

### Task 1: Sign-in resolves an owner to their main business
`services/supabase.js getBusinessByEmail(email)`: ask for `parent_business_id=is.null` first (ordered by created_at), and fall back to any row with that email only if there is no root. Test: with a branch row returned first by the server stub, the root is chosen; with only a root, unchanged.

### Task 2: A reload keeps the chosen location
`App.jsx` start-up reconcile: when the account is an owner (no staff) and the cached `auth.brand.id` differs from the root, load that business (`getBusinessById`) and keep it only if it is reachable (Global Constraints), active and not deleted; otherwise use the root. Staff unchanged. Tests in `App.reconcile.test.jsx`: cached branch kept (fresh row used); cached business of another owner dropped; cached deleted/inactive branch dropped; staff unchanged.

### Task 3: Offline sales keep their own location
`modules/pos/repositories syncQueued(businessId)`: each queued sale posts with its own `business_id`; only a sale without one uses `businessId`. Test: a queue with sales for A and B synced while B is active posts A's under A and B's under B; a legacy sale without business_id posts under the current location.

### Task 4: One switch, a clean remount, and no lost cart
`lib/locationSwitch.js`: `switchLocation({ auth, setAuth }, location)` (no-op for the active one; sets brand, staff null, role Owner; persists `carehub_auth`), `registerSwitchBlocker(fn)` → unregister, `switchBlockers()` → messages. `BranchSwitcher` and `Locations` use it; before switching, if blockers report work, a ConfirmDialog asks ("Your POS cart has 3 items. Switching location clears it."). `BusinessDashboard` keys its routes by `brand.id` so every module remounts. `POS` registers a blocker while its cart has items. Fix the BranchSwitcher comment (direct branches only). Tests: helper (no-op, persists, staff cleared); BranchSwitcher asks when a blocker reports, switches on confirm, not on cancel; Locations uses the helper; dashboard remounts a module on brand change; POS blocker reports cart size and unregisters on unmount.

### Task 5: Locations page reports what goes wrong
Error state with retry instead of "no branches" on a failed load; the database's reason when adding a branch fails; a warning toast when copying the catalogue or roles fails; stats loaded in parallel; no sorting of state in render; branch `plan` taken from the current business without the 'growth' default. Tests for each.

### Task 6: Branches follow the parent's plan (DB draft)
`docs/architecture/pending-migrations/carehub_20261210_branch_plan_follows_parent.sql`: AFTER UPDATE OF plan, plan_expires_at ON businesses, when the row is a root (parent_business_id is null) and either changed, update its descendants (recursive, depth ≤ 10) to the same plan and expiry; SECURITY DEFINER, trigger function not callable; the privileged-columns guard already exempts definer contexts. One-off backfill of existing branches. PGlite test (root renewal reaches branches and grand-branches; a branch's own update does not cascade; other businesses untouched). The subscription-expiry reminder cron (`apps/carefind/api/cron/check-subscription-expiry.js`) selects root businesses only (test).

### Task 7: Verification
Full suite, build, lint, PGlite; self-review.
