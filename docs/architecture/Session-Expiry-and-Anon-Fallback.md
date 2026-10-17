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

Every data call needs the **second** lane, because `sbFetch` resolves a token:

```js
// services/supabase.js
const { data } = await authClient.auth.getSession()
if (data?.session?.access_token) return data.session.access_token
// ... one refreshSession() attempt ...
return SB_KEY            // ← no session: send the anon key
```

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
**only when `isAnon`**:

```js
if ((res.status === 401 || res.status === 403) && isAnon) {
  authClient.auth.signOut().catch(() => {})
  throw new Error('Session expired. Please log in again.')
}
```

`isAnon` is the safety catch: with a real session the failure is a genuine
permission problem and must keep its original detail — masking it as "expired"
would hide real access bugs. Successful anon reads (public CareFind forms,
pre-login lookups) are untouched because they never fail this way.

Do **not** "fix" this by having `sbFetch` sign out on its own without the
`App.jsx` half: `signOut()` clears the Supabase session but not
`localStorage['carehub_auth']`, so `/login` (`auth && !auth.isAdmin ? Navigate
to '/dashboard' : <Login />`) would bounce straight back into the dashboard.

## Tests

| File | Covers |
| --- | --- |
| `src/App.reconcile.test.jsx` | expired cache cleared; live session preserved; no cache → no sign-out |
| `src/services/__tests__/anonAuthFailures.test.js` | anon 401/403 → sign-in prompt; **real-session failure keeps its detail**; anon success untouched |

## If you hit this in the wild

Sign out and sign back in — that restores a real session and the page loads. No
data is affected: the failure is a read rejection before any row is returned.
