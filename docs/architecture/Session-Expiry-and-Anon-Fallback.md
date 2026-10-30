# Session expiry and the anon fallback

CareHub keeps two independent records of "who is signed in", and most auth-shaped
bugs in this app come from the gap between them:

| Lane | Where it lives | What it proves |
| --- | --- | --- |
| UI identity | `localStorage['carehub_auth']` (read in `App.jsx`, written by `login()`/`logout()`) | someone authenticated once on this device |
| Real session | Supabase Auth session (`authClient.auth.getSession()`) | a bearer token that Postgres will accept as `authenticated` |

The dashboard is guarded on the **first** lane:

```js
// App.jsx
<Route path='/dashboard/*' element={auth && !auth.isAdmin ? <BusinessDashboard /> : <Navigate to='/login' />} />
```

Every data call needs the **second** lane. Since 2026-10-30 `sbFetch`, `sbFetchWithCount`, `sbUpload` and `sbSignUrl` resolve the token through `lib/sessionFetch.js` (`fetchWithSession`): the anon key only when nobody is signed in, never as a fallback for a signed-in user. See "Idle sessions on a slow device clock" below. (Before that, `sbFetch` fell back to the anon key whenever `getSession()` came back empty, which is the state this document's original incident describes.)

## Why both can disagree

`App.jsx` reconciles with Supabase on load, but a **missing** session used to be
treated as "nothing to do":

```js
const session = data?.session
if (!session || cancelled) return      // ← stale cache silently survived
```

So an expired session left `localStorage` intact: the dashboard kept rendering,
and every `sbFetch` went out as **`anon`**.

That state is *never* legitimate. `pages/auth/Login.jsx` routes every sign-in
through `signInWithPassword` and refuses to continue without a session, and
legacy accounts were backfilled to confirmed auth users — so "cache present +
no session" can only mean the session expired.

## Observed symptom

```
We couldn't load your ADR reports: Supabase error (401): permission denied for function can_access_adr_report_row
```

Chain:

1. No session → `sbFetch` sends `Authorization: Bearer <anon key>` → PostgREST runs as `anon`.
2. The RLS policy on `adr_reports` calls `can_access_adr_report_row(business_id, created_by_user_id)`.
3. That function grants `EXECUTE` to `postgres`, `service_role` and `authenticated` **only**
   (`supabase/migrations/carehub_20260819_adr_fix_returning_rls.sql` revokes `PUBLIC`/`anon`) → SQLSTATE `42501`.
4. PostgREST reports that as **401**, not 403.

Step 4 is the part that hid the cause: `sbFetch`'s recovery branch matched only
`403`, so it never fired and the raw database error reached the UI instead of
"Session expired. Please log in again."

This is *not* caused by the ADR migrations — `can_access_adr_report_row`'s grants
are unchanged from their original migration.

## The fix

**Root (`App.jsx`).** When the reconciliation finds no session but a cached
business identity, call `logout()` — it clears `localStorage`, clears the ADR
draft backups, and suppresses the `SIGNED_OUT` bounce via the `loggingOut` guard.
Guarded on `auth` so the separate Referral-Agent lane (`carehub_agent_auth`),
which has no Supabase session, is never touched.

**Symptom (`services/supabase.js`).** The recovery branch matches `401 || 403`,
**only when nobody is signed in**:

```js
if ((res.status === 401 || res.status === 403) && !(await getAccessToken().catch(() => true))) {
  authClient.auth.signOut({ scope: 'local' }).catch(() => {})
  throw new Error('Session expired. Please log in again.')
}
```

The signed-out check is the safety catch: with a real session the failure is a genuine
permission problem and must keep its original detail — masking it as "expired"
would hide real access bugs. Successful anon reads (public CareFind forms,
pre-login lookups) are untouched because they never fail this way.

Do **not** "fix" this by having `sbFetch` sign out on its own without the
`App.jsx` half: `signOut()` clears the Supabase session but not
`localStorage['carehub_auth']`, so `/login` (`auth && !auth.isAdmin ? Navigate
to '/dashboard' : <Login />`) would bounce straight back into the dashboard.

## Idle sessions on a slow device clock (2026-10-30)

Reported: CareHub left open 30 minutes to hours "goes to sleep"; on return it is slow, stops responding, and needs a fresh login.

**What production showed (2026-10-29, one pharmacy account, one shop IP).** All 392 CareHub 401s that day were `authenticated` requests carrying an access token the server had expired 5 minutes to 17.8 hours earlier, including 12 failed `POST /sales`. Healthy sessions in the same shop rotated their token 10–12 times; each of the five broken sessions used **exactly one token for its whole life**. supabase-js judges expiry by the device clock, so on a till whose clock runs behind it never refreshes, and `getSession()` keeps returning the expired token. The laptop stale-session fix above never ran because it only tried a refresh when `getSession()` came back empty. An hour after sign-in everything 401'd until staff signed out and in again, buying one more hour; the logs show that cycle five times in one day.

Two smaller causes showed up in the same logs:
- **Global sign-out cascade.** `logout()` called `signOut()` with its default `scope: 'global'`, revoking every session of the account. Shops share one login across tills, so one cashier signing out ended the others at their next refresh (`refresh_token_not_found` ×4 within 7 minutes of a global sign-out, then re-logins).
- **No recovery from SIGNED_OUT.** The handler redirected to `/login` but left `carehub_auth` in place, so `/login` bounced back to the dashboard until the boot reconciliation caught up.

**What changed.**
- `lib/sessionFetch.js` (`fetchWithSession`). The server decides expiry: a refused token (PostgREST 401; Storage's InvalidJWT 400/403) gets one forced `refreshSession()` and one retry, single-flight across concurrent requests. A signed-in user's request never goes out as anon: a session that cannot be refreshed throws `SessionUnavailableError`. A refresh the server refuses signs this device out locally, which fires SIGNED_OUT. Used by `sbFetch`, `sbFetchWithCount`, `sbUpload`, `sbSignUrl`, the plan renewal and appointment payment calls, and the staff-invitation service.
- Sign-outs use `scope: 'local'` (`logout`, `logoutAgent`, AcceptInvite, the anon-401 branch). That still revokes this device's session server-side; it no longer revokes other devices'. `ResetPassword` keeps its deliberate global sign-out.
- `App.jsx` SIGNED_OUT handler clears `carehub_auth`/`carehub_agent_auth` (and ADR draft backups) before redirecting. When a cache was still present, so the session ended on its own, Login/AgentLogin show "Your session has ended. Please sign in again." The boot reconciliation shows the same notice. The flag travels in `sessionStorage['carehub_session_ended']` across the full-page redirect.
- `components/layout/ClockSkewBanner.jsx` warns when the device clock is behind, read from each fresh token's `iat`. Only a clock running behind is reported, because an old stored token can only make the clock look ahead.
- `main.jsx` reloads once on `vite:preloadError`, for a tab left open across a deploy whose lazy route chunks no longer exist.

**Security.** Nothing is weakened. RLS decides every row as before. Local sign-out still revokes this device's refresh token. A 401 for a signed-in user is retried at most once with a freshly issued token, never with the anon key.

**Wallet and payment calls (2026-10-30, follow-up).** Every wallet and payment `/api` call now goes through the session fetch. The wallet module uses one helper, `modules/wallet/walletRequest.js` (`postWithSession`), which returns `{ ok, status, data, sessionExpired?, networkError? }` with a readable `data.error`. It covers top-up (initiate, verify, fee quote), withdrawal, the withdrawal PIN and OTP endpoints, and bank-account lookup on the Wallet and Appointments screens. Before this, seven copies of the same fetch block read `getSession().access_token` directly. The shared payout client (`@care-ecosystem/shared-payout-ui`) gained an optional `fetchImpl`; CareHub passes `fetchWithSessionResponse` through `payoutClientOptions`, which turns an unusable session into the 401/503 answer the client already shows. CareFind passes nothing and is unchanged. `confirmPlanPayment` takes `auth` like the staff-invitation service.

Retrying these calls is safe because every handler involved answers 401 only when the token itself is refused (`verifyBusiness`: no token, or no business for it), before any PIN or code check and before any money moves. A wrong PIN is 403 and a wrong code 400, so a retry never replays a PIN or code attempt; `walletRequest.test.js` pins this.

**Still on the old pattern.** `lib/email.js`, `useSalesReportData`, StockValidation and AdminDashboard (notify-business-status) still read `getSession().access_token` directly. On a slow clock they can be refused until another request renews the session.

## Tests

| File | Covers |
| --- | --- |
| `src/App.reconcile.test.jsx` | expired cache cleared; live session preserved; no cache → no sign-out |
| `src/services/__tests__/anonAuthFailures.test.js` | anon 401/403 → sign-in prompt; **real-session failure keeps its detail** (after one renewal); anon success untouched |
| `src/lib/__tests__/sessionFetch.test.js` | renew-and-retry on a refused token, single flight, never anon for a signed-in user, local sign-out on a refused refresh, clock-skew reading |
| `src/services/__tests__/sessionRenewal.test.js` | `sbFetch`/`sbUpload` complete after renewing an expired token; ordinary errors are not retried |
| `src/modules/wallet/walletRequest.test.js` | a withdrawal completes after one renewal with the same body; **a wrong PIN (403) is never retried**; ended session and no connection read distinctly; the shared payout client renews through `payoutClientOptions` |
| `packages/shared-payout-ui/src/stores.test.js` | a supplied `fetchImpl` carries every payout call; the global fetch is untouched |

## If you hit this in the wild

Sign out and sign back in — that restores a real session and the page loads. No
data is affected: the failure is a read rejection before any row is returned.
