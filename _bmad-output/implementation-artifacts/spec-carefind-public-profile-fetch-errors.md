---
title: 'CareFind Public Profile Fetch Error Handling'
type: 'bugfix'
created: '2026-09-26'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'c3c5005bbebf8e51c1b553aacb95a9a3daf521f1'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** CareFind's public profile page renders “Profile not found” whenever its profile query finishes without data, including when the query failed because of a network, schema, or access error. This makes a service/data-access failure indistinguishable from a successful lookup proving that no profile row exists.

**Approach:** Use the existing React Query error and retry state to show a clear recoverable error when profile loading fails, and reserve “Profile not found” for a successful query that returns no row. This is a UI/error-reporting correction, not a data-recovery operation.

## Boundaries & Constraints

**Always:** Keep existing loading and successful profile behavior; show accessible, responsive error feedback and a retry action; do not mislabel query failures as deleted/missing profiles; do not log or expose credentials or tokens.

**Ask First:** Any direct database access, migration, policy change, data repair, or profile-row creation.

**Never:** Modify or delete profile data; infer missing profile fields; alter the database or attempt to restore records without a separately approved, verified recovery plan.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Profile query succeeds with a row | `data` is a profile | Render the existing public profile | No change |
| Profile query succeeds without a row | `data` is `null`, no query error | Render “Profile not found” | Existing return-to-feed action remains |
| Profile query fails | Query `error`, no profile data | Render a recoverable profile-load error, not “Profile not found” | Retry invokes the query's `refetch` |
| Retry succeeds | Previously failed query returns a profile | Render the profile | Clear the error state through query state |

</frozen-after-approval>

## Code Map

- `apps/carefind/src/PublicProfile.jsx` -- `useProfile(id)` already provides `error` and `refetch`; the page currently consumes only `data` and `isLoading`, then treats every empty result as a missing account. Separate the fetch-error branch from the genuine empty-result branch while preserving mobile and desktop shells.
- `apps/carefind/src/PublicProfile.test.jsx` -- public-profile integration-style tests mock the query hooks; extend the mock/state to cover query failure, retry, and successful null results without relying on the database.
- `apps/carefind/src/hooks/queries.js` -- `useProfile` throws Supabase query errors and uses React Query, which supplies the error/refetch state; reuse this contract rather than adding another data path.
- `packages/design-system/src/components/ui` -- existing shared `ErrorState` is re-exported from `apps/carefind/src/components/ui/index.jsx`; reuse its established accessible error presentation if its API fits.

## Tasks & Acceptance

**Execution:**
- [x] `apps/carefind/src/PublicProfile.jsx` -- render query failures as an explicit retryable error state and render “Profile not found” only after a successful empty query.
- [x] `apps/carefind/src/PublicProfile.test.jsx` -- verify profile fetch errors are not reported as missing, retry requests a refetch, successful empty results still show the not-found state, and successful profiles remain unchanged.

**Acceptance Criteria:**
- Given the profile query fails, when the request settles without profile data, then the page shows a retryable load error and does not say the profile is missing or deleted.
- Given a failed profile request, when the visitor activates Retry, then the page refetches the same profile and renders the profile if the retry succeeds.
- Given a successful profile query returns no row, when the page settles, then it continues to show the existing not-found state.
- Given a successful profile query returns a row, when the page renders, then profile content and actions behave as before.
- Given this code change, when it is implemented and tested, then no database connection, data mutation, schema change, or migration is performed.

## Spec Change Log

## Verification

**Commands:**
- `npm test -- --run src/PublicProfile.test.jsx` from `apps/carefind` -- passed: 8 tests.
- `npm run build` from `apps/carefind` -- passed: 2,906 modules transformed; Vite emitted existing CJS API and dynamic-import warnings.

## Suggested Review Order

**Profile fetch state**

- Keep cached profile content, but distinguish failed fetches from a confirmed missing row.
  [`PublicProfile.jsx:58`](../../apps/carefind/src/PublicProfile.jsx#L58)

- Retry the profile lookup only when no cached profile is available and the query failed.
  [`PublicProfile.jsx:268`](../../apps/carefind/src/PublicProfile.jsx#L268)

**Regression coverage**

- Verify retry, backend-error, confirmed-empty, and cached-profile behaviors.
  [`PublicProfile.test.jsx:135`](../../apps/carefind/src/PublicProfile.test.jsx#L135)
