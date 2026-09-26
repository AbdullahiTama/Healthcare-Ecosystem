---
title: 'CareFind Vercel Hobby cron compliance'
type: 'bugfix'
created: '2026-09-26'
status: 'done'
review_loop_iteration: 1
baseline_commit: 'c3c5005bbebf8e51c1b553aacb95a9a3daf521f1'
context: ['docs/specs/_root/0001-reliable-email-system/0001-delivery-foundation.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `apps/carefind/vercel.json` declares the outbox cron as `*/5 * * * *`. Vercel Hobby allows at most two crons and only once-daily schedules, so every CareFind deploy fails build validation. Commit `95ca162` changed a working daily `0 0 * * *` to `*/5 * * * *` so email retry backoff would fire; `DEPLOYMENT.md:48` still documents the daily schedule, so the code silently drifted from its own contract with nothing to catch it.

**Approach:** Return the outbox cron to a daily schedule so the build validates, then make an illegal schedule impossible to reintroduce by asserting the Hobby cron contract in the test suite. The retry latency `95ca162` reached for is already owned by an approved but unbuilt spec, so it is recorded as deferred rather than re-solved here.

## Boundaries & Constraints

**Always:**
- Every `schedule` in every `vercel.json` fires at most once per day, and no app declares more than two crons. Both are hard Hobby limits; both fail the build.
- CareFind keeps exactly two crons. The outbox drain must stay earlier in the day than the `0 8 * * *` expiry scan so expiry mail enqueued that morning gets a second drain the same day.
- The router stays the only serverless function. Never add a non-underscore file under `apps/carefind/api/` — the 12-function cap is why the router exists.
- `CRON_SECRET` gating on both cron handlers is unchanged; its fail-open behaviour when unset is pre-existing and deliberate.

**Ask First:**
- Any other sub-daily trigger — Supabase `pg_cron`, an external scheduler, a queue consumer, or a Vercel Pro assumption. State which the human accepts before proceeding.
- Any edit to `packages/shared-email`; the shared outbox engine belongs to the email-system spec.

**Never:**
- No opportunistic `processBatch()` drain on the router or any request hot path — see Design Notes for why this is a correctness bar, not a preference.
- No Vercel plan upgrade and no Pro assumption. CareFind is deliberately shaped around Hobby limits today.
- No reordering, renaming, or deletion of `crons` entries, and no change to the `headers` or `rewrites` blocks. Leave `apps/carehub/vercel.json` alone; it is already compliant.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Deploy validation | A `*/5 * * * *` schedule in a `vercel.json` | Vercel rejects the build | Guard test fails first, naming file, cron path, and schedule |
| Deploy validation | Two daily crons declared | Build proceeds | Guard test passes |
| Cron capacity | A third cron added to either app | Build would be rejected | Guard test fails on count, naming the app |
| Existing config | `headers`, `rewrites`, `subscription-expiry` | Byte-for-byte unchanged | `git diff` shows exactly one altered line |

</frozen-after-approval>

## Code Map

- `apps/carefind/vercel.json:5` -- **the defect.** `"schedule": "*/5 * * * *"` for `/api/cron/process-email-outbox`. The whole fix is this one string.
- `apps/carefind/vercel.json:2-11` -- the `crons` array: two entries, exactly the Hobby maximum. Line 9 is `0 8 * * *` for `subscription-expiry` and must stay later in the day than the drain.
- `apps/carefind/vercel.json:12-64` -- read-only `headers` and `rewrites`; the `/api/(.*)` rewrite to `/api/router` is load-bearing for the function cap.
- `apps/carefind/DEPLOYMENT.md:48` -- already documents `0 0 * * *`, so the doc was right and the code had drifted. Evidence for the intended value.
- `apps/carefind/api/router.js:3-7` -- read-only. Explains the single-function design and the 12-function Hobby cap; cite it in the guard test.
- `apps/carefind/api/cron/process-email-outbox.js:1-25` -- read-only drained endpoint. Already accepts `GET` and gates on `CRON_SECRET`. Not modified.
- `apps/carefind/api/cron/check-subscription-expiry.js:83` and `packages/shared-email/src/authEmail.js:104` -- read-only enqueue-then-immediate-flush, repeated across nine payment and booking handlers. Why a daily cron is an acceptable trade: first attempts never wait on cron.
- `packages/shared-email/src/EmailService.js:69-105` -- read-only, and the constraint behind the first Never. Selects `status in (pending, failed)` with no claim token or lease, so two concurrent calls can send one row twice. `_markFailed` sets `next_retry_at` to `now + 60s * 2^(attempts-1)`, so retries are driven purely by how often `processBatch` runs.
- `docs/specs/_root/0001-reliable-email-system/0001-delivery-foundation.md:85,126,134,158` -- read-only. The approved answer: `claim_email_batch` with `SKIP LOCKED` and a claim token, driven by Supabase `pg_cron` at `* * * * *` with a 1/5/15/60-minute retry ladder, after which Vercel cron entries are removed. Exempt from plan limits.
- `apps/carehub/vercel.json:6-11` -- read-only, one compliant daily cron. The guard test must cover it too.
- `apps/carefind/vitest.config.js` and `apps/carefind/package.json:6-11` -- `include` covers `api/**/*.test.{js,jsx}` and `test` is `vitest run`, so a new test under `api/` needs no config change. There is no root `package.json` and no workspace protocol.

## Tasks & Acceptance

**Execution:**
- [x] `apps/carefind/vercel.json` -- change only the `/api/cron/process-email-outbox` schedule from `*/5 * * * *` to `0 2 * * *` -- daily, so the plan accepts it, and ahead of the 08:00 expiry scan. No other key, entry, or ordering may change.
- [x] `apps/carefind/src/lib/vercel-cron-hobby-limit.test.js` -- new test asserting, for every `vercel.json` in the repo, that no app declares more than two crons and every `schedule` fires at most once per day. Detect a sub-daily schedule structurally (a non-zero or wildcard minute field, including `*`, ranges, lists, and step values) rather than by string equality, so `*/1`, `0 */2 * * *`, and `0 8 * * *` are all judged correctly. Name the offending file, cron path, and schedule in the failure message. It lives in `src/lib/`, never in `api/`, because every non-underscore `.js` under `api/` occupies one of the twelve Hobby function slots.
- [x] `apps/carefind/src/lib/vercel-cron-hobby-limit.test.js` -- also pin the CareFind drain entry exactly with `toEqual` (a weekly or monthly narrowing is legal on Vercel and would otherwise pass a frequency cap), assert the drain is scheduled *strictly* before the expiry scan, and assert the two expected cron paths at the Hobby maximum. Also add `apps/carehub/vercel.json` to the `paths` filters in `.github/workflows/carefind-ci.yml`; without it the repo-wide claim is false, because no CI job would run this guard for a CareHub config change.
- [x] `apps/carefind/DEPLOYMENT.md` -- in the Vercel configuration section, record the two Hobby limits, that breaching either fails the build, and the reason a request-path outbox drain is forbidden. Mark the cron times as UTC, note the guard's CI dependency, and note that the drain contract block must be deleted when the Supabase Cron migration retires these entries. Link the email-system spec that owns the eventual migration.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- append one entry for moving the outbox drain to the Supabase Cron minute worker and removing the Vercel crons, so the reliability work `95ca162` reached for is not lost.

**Acceptance Criteria:**
- Given the CareFind project on the Hobby plan, when a deployment is triggered, then the build completes without a cron schedule validation error.
- Given a full `git diff`, when reviewed, then the only altered line in `apps/carefind/vercel.json` is the outbox schedule, and no production file under `apps/carefind/api/`, `apps/carehub/`, or `packages/` changed.
- Given any future edit introducing a sub-daily schedule or a third cron, when the carefind suite runs, then the guard test fails and names the file, path, and schedule.
- Given the outbox cron is daily, when a send fails, then its row stays `failed` with `next_retry_at` in the future and retries no later than the next daily drain. This interval is a known residual, recorded in the Spec Change Log and the deferred-work entry.
- Given a reader asks why the drain is not called from the router, then `DEPLOYMENT.md` states the missing-claim reason.

## Spec Change Log

### 2026-09-26 — review round 1

- **Triggering finding (verification-gap, proven by running the suite):** the guard asserted only cron *paths* and drain-before-expiry *ordering* for the drain, never its frequency. Setting the drain to `0 2 1 * *` (monthly) or `0 2 * * 1` (weekly) left all 32 tests green, so the cadence `DEPLOYMENT.md` and the deferred-work entry both promise was unenforced — the Hobby check only caps frequency from above, and narrowing below daily is legal on Vercel. Amended the second guard task to pin the whole drain entry with `toEqual`, the same shape the neighbouring expiry assertion already used. Verified by mutation: monthly, weekly, same-minute and the original `*/5` all now fail.
- **Triggering finding (verification-gap):** the drain-before-expiry assertion used `toBeLessThanOrEqual`, so setting the drain to `0 8 * * *` — the same minute as the expiry scan — also passed. Equality is the one arrangement with no second drain that day, which is the exact property the assertion's name and `DEPLOYMENT.md` claim to protect. Amended to `toBeLessThan`. Verified by mutation.
- **Triggering finding (blind hunter, confirmed against the tree):** the spec contradicted itself. A task directed a new test into `apps/carefind/api/`, while an Always-constraint forbade adding a non-underscore file there. `api/` holds 9 non-underscore `.js` files against the Hobby 12-function cap, and the added test made 10 — spending a function slot on a test that is not a function. Resolved in favour of the constraint: the guard moved to `apps/carefind/src/lib/vercel-cron-hobby-limit.test.js`, which `vitest.config.js` already includes via `src/**/*.test.{js,jsx}`, restoring the count to 9. The task path and the constraint now agree.
- **Triggering finding (verification-gap, confirmed against the workflow):** the guard's repository-wide claim was false in CI. `.github/workflows/carefind-ci.yml` triggered only on `apps/carefind/**`, `packages/**` and itself, and `carehub-ci.yml` collects only `src/**` under `apps/carehub`, so a sub-daily schedule merged into `apps/carehub/vercel.json` would never run this guard. Added `apps/carehub/vercel.json` to both `paths` filters so the job that runs the guard is triggered by the config it polices. The guard's header comment and `DEPLOYMENT.md` now state this dependency rather than assuming it.
- **Triggering finding (edge-case hunter):** `expandField` accepted several malformed fields as legal single values, because `Number('')` is `0`, `Number('0x0')` is `0`, `Number('1e1')` is `10`, and `1-2-3` silently kept only its first two bounds. Each is now rejected by a decimal-and-bounds-shape check. Also hardened: a `crons` key that is present but not an array is reported rather than treated as absent; a `vercel.json` that is not valid JSON is reported by filename instead of throwing during module evaluation; an unreadable directory no longer aborts the whole walk; a duplicated cron path is a violation in its own right; and the carefind contract block reads `crons` defensively so a renamed cron is a clear assertion failure rather than a collection-time `TypeError`. All covered by new cases in the same file.
- **Triggering finding (blind hunter):** `DEPLOYMENT.md` described `02:00` and `08:00` in a way that reads as local time, but Vercel cron schedules are always UTC. Both are now marked UTC. The same edit records that the `carefind cron contract` block must be deleted when the Supabase Cron migration retires these entries, so the guard's forward incompatibility is documented rather than discovered.
- **Known-bad state avoided:** a green suite that permits a monthly, weekly or same-minute drain, a cron path typed as `0x0`, a duplicated cron path, a `crons` key that is an object, an unparseable `vercel.json`, a test file occupying one of the twelve Hobby function slots, and a repo-wide guarantee that no CI job actually enforces.
- **KEEP instructions (must survive any re-derivation):** keep the guard outside `api/`; keep the drain entry pinned with `toEqual` rather than a frequency predicate, and keep the ordering assertion strict; keep the `apps/carehub/vercel.json` path filter in `carefind-ci.yml` — the guard is only repo-wide while that filter exists; keep the mutation checks (illegal schedule, monthly, weekly, same-minute) as standing evidence the guard fires rather than merely passing; keep the `DEPLOYMENT.md` prohibition on draining the outbox from a request path, and keep the explicit UTC marking.
- **Not actioned, deliberately:** the guard encodes this team's model of the Hobby rule rather than calling Vercel's own validator, so only the manual preview deploy can confirm the model matches the platform. That check is recorded in `## Verification` and remains human-only.

### 2026-09-26 — implementation

- **Accepted residual (required by AC 4).** With the drain on a daily `0 2 * * *` schedule, a row that has already failed a transient provider error stays `failed` with `next_retry_at` in the future and is retried no later than the next daily drain — worst case roughly 24h, not the minutes `95ca162` reached for. First attempts are unaffected: every producer enqueues and then flushes on the same request, so only an already-failed row waits. Recorded in `_bmad-output/implementation-artifacts/deferred-work.md` and closed by the Supabase Cron minute worker migration in `docs/specs/_root/0001-reliable-email-system/0001-delivery-foundation.md`.
- **Guard scope.** The sub-daily check judges the minute and hour fields, because those alone determine whether an expression can fire more than once per day. An expression that narrows the day-of-month, month, or day-of-week fields (for example `0 0 1 * *`) fires *less* often than daily and is therefore accepted — the Hobby contract is an upper bound on frequency, not a requirement that every cron be daily. A schedule that is not a well-formed five-field expression is reported as a violation.
- **Fixed blocks pinned.** The guard test deep-equals CareFind's `headers` and `rewrites` against their current values, which is the only test-level encoding of the I/O matrix row requiring them byte-for-byte unchanged. Changing either now requires a deliberate test update.

## Design Notes

The residual is deliberate. First attempts were never cron-dependent — every producer enqueues then flushes on the same request — so a user-visible email is sent by the request that creates it. Only a row that already failed a transient provider error waits for the next drain.

Rejecting the request-path drain is a correctness bar, not a preference. `processBatch` selects without a claim token, so a drain on the hot path would let two invocations send one row twice, and no in-process guard prevents that on Vercel. Doing it properly means `claim_email_batch` with `SKIP LOCKED`, which spec 0001 already specifies and whose one-minute Supabase Cron is exempt from plan limits — so that change also removes this class of outage instead of re-scheduling around it.

## Verification

**Commands:**
- `npx vitest run src/lib/vercel-cron-hobby-limit.test.js` (from `apps/carefind`) -- expected: SUCCESS. Result after review round 1: **41 passed**.
- `npm --prefix apps/carefind run build` -- expected: SUCCESS. Result: `built in 3m 13s`, no errors. The pre-existing Sentry dynamic-import chunk warning is unrelated.
- `git diff -- apps/carefind/vercel.json` -- expected: exactly one changed line. Result: one insertion, one deletion, `*/5 * * * *` to `0 2 * * *`.
- `git status --short -- apps/carefind/api` -- expected: no modified production file. Result: `apps/carefind/api` is untouched; the guard lives in `apps/carefind/src/lib/`. `apps/carehub/api/_lib/email.js` shows as modified but was already dirty at `baseline_commit` and is not part of this change.

**Guard mutation evidence** (standing proof the guard fires rather than merely passes). Each schedule was written into `apps/carefind/vercel.json` in turn, the guard was run, and the file was restored. All four must fail, and all four do:

| Injected schedule | Guard result |
|---|---|
| `*/5 * * * *` (the original defect) | fails: sub-daily, minute field matches 12 values |
| `0 2 1 * *` (monthly) | fails: drain entry no longer equals `0 2 * * *` |
| `0 2 * * 1` (weekly) | fails: drain entry no longer equals `0 2 * * *` |
| `0 8 * * *` (same minute as expiry) | fails: ordering is now strictly before the scan |

**Known suite caveat:** the full `npm --prefix apps/carefind test` run is flaky under load. Three separate full runs each failed exactly one *different* test: `GiftPanel.test.jsx`, then `VerifyEmail.test.jsx > PKCE success`, then `VerifyEmail.test.jsx > the visit log stays bounded`. Each breached the 15s `testTimeout` in `vitest.config.js` and each passed in isolation (`4/4`, `47/47`, `47/47`). A concurrent session in this same worktree compounds the load. The cron guard passed in every run. Treat a single full-suite timeout in these UI files as noise unless it reproduces in isolation.

**Manual checks (if no CLI):**
- Trigger a CareFind preview deploy on the Hobby project; confirm the build clears cron validation and the Vercel cron list shows exactly two daily entries. **Not yet run.** No Vercel CLI or credentials are available here, so the central acceptance criterion rests on static reasoning (two crons, each with a single minute and hour value) plus the guard, not on a live deploy. This stays open.
- Confirm that editing `apps/carehub/vercel.json` now triggers the `CareFind CI` job so the repo-wide guard actually runs for it. Statically confirmed via the `paths` filters; not yet observed on a real pull.

## Suggested Review Order

**The fix**

- The whole repair: a sub-daily Hobby-illegal schedule becomes a legal daily one.
  [`vercel.json:5`](../../apps/carefind/vercel.json#L5)

**Why the guard is not a request-path drain**

- `processBatch` selects with no claim or lease, so concurrent calls can double-send. Read this before "improving" the schedule.
  [`EmailService.js:69`](../../packages/shared-email/src/EmailService.js#L69)

- The prohibition, stated where a future editor will hit it.
  [`DEPLOYMENT.md:67`](../../apps/carefind/DEPLOYMENT.md#L67)

**Hobby contract enforcement**

- Entry point: walks every `vercel.json`, caps count, expands each cron field.
  [`vercel-cron-hobby-limit.test.js:26`](../../apps/carefind/src/lib/vercel-cron-hobby-limit.test.js#L26)

- Structural field parser, not string matching; rejects `0x0`, `1e1`, `/5`, `1-2-3`.
  [`vercel-cron-hobby-limit.test.js:91`](../../apps/carefind/src/lib/vercel-cron-hobby-limit.test.js#L91)

- The frequency judgement and its human-readable failure reasons.
  [`vercel-cron-hobby-limit.test.js:141`](../../apps/carefind/src/lib/vercel-cron-hobby-limit.test.js#L141)

- Violations for count, duplicates, non-array `crons`, and unparseable JSON.
  [`vercel-cron-hobby-limit.test.js:190`](../../apps/carefind/src/lib/vercel-cron-hobby-limit.test.js#L190)

**Cadence contract**

- Pins the drain to exactly `0 2 * * *`, so weekly or monthly cannot pass.
  [`vercel-cron-hobby-limit.test.js:390`](../../apps/carefind/src/lib/vercel-cron-hobby-limit.test.js#L390)

- Strict ordering, so the drain cannot share a minute with the expiry scan.
  [`vercel-cron-hobby-limit.test.js:401`](../../apps/carefind/src/lib/vercel-cron-hobby-limit.test.js#L401)

**Operational contract**

- The repo-wide claim only holds because of these path filters.
  [`carefind-ci.yml:7`](../../.github/workflows/carefind-ci.yml#L7)

- The written Hobby limits, UTC marking, and the test's location rationale.
  [`DEPLOYMENT.md:56`](../../apps/carefind/DEPLOYMENT.md#L56)
