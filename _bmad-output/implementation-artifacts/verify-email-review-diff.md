# Review diff -- spec-auth-email-links-work (review_loop_iteration 4)

Scope: iteration-4 working tree vs HEAD (`de4ea9681`). Only the verify-email implementation files are diffed. `main.jsx` (source-order capture import) and `AuthContext.jsx` (`redirectTo: /verify-email`) already landed in HEAD (iterations 1-2) -- their diff is unchanged and not restated here. `mainSourceOrder.test.js` is NEW/untracked.

Iteration-4 delta summary:
- `VerifyEmail.jsx`: removed the prod test hook (`__resetVerifyEmailForTests`) entirely (KEEP: no prod test hook); tests now isolate via `vi.resetModules()` + dynamic import (`moduleHolder.mod`); replaced module-level `settledVerdict`/`__resetVerifyEmailForTests` with the visit-scoped `judgedSnapshots` Map keyed by the captured snapshot href + `getVerifyEmailVisitRecord()`; consumed-URL adjudication now mirrors real supabase-js mutation -- WHOLE-hash drop for implicit, `code`(+`sb_flow_id`) strip for PKCE (`consumedUrlFromHref`); `stripConsumedTokenFromUrl(snapshotHref)` derives from the snapshot, not the live URL.
- `verifyEmailParams.js`: NEW `AUTH_QUERY_KEYS=[code]`, `AUTH_HASH_KEYS`, `PKCE_AUX_QUERY_KEYS=[sb_flow_id]`, `consumedUrlFromHref`, `currentUrlHref`; `parseVerifyEmailParams` is presence-based (`has*` flags) -- EMPTY `?code=` / `#access_token=` / `?error=` counts as present -> expired; error params readable from query as well as hash.
- `VerifyEmail.test.jsx`: REAL auth-js callback shapes (xii); implicit + PKCE boot-consumption races (xiii/xiv); a11y verdict-announcement assertions (xv); empty-param presence (xvi); judged-URL bookkeeping (xviii); plus the module-holder refactor so no prod test hook ships.
- `verifyEmailParams.test.js`: presence/empty-param fixtures, key-list single-source-of-truth, consumed-url whole-hash-drop / strip-code-only cases.
- `mainSourceOrder.test.js` (NEW): pins the params module side-effect import as the FIRST import in `main.jsx` (before supabaseClient AND AuthProvider), (xvii).

Verification (iteration 4): vitest 56/56 (VerifyEmail 36, verifyEmailParams 15, mainSourceOrder 2, AuthContext 3); carefind build green 1m28s; `__resetVerifyEmailForTests` NOT present in any `dist/assets/*.js` (tree-shaken); `SUPABASE_SERVICE_ROLE_KEY` / `generateLink` not in app chunks.

## apps\carefind\src\modules\account\VerifyEmail.jsx (diff vs HEAD)

```
diff --git a/apps/carefind/src/modules/account/VerifyEmail.jsx b/apps/carefind/src/modules/account/VerifyEmail.jsx
index 5568a13..8d7ce9c 100644
--- a/apps/carefind/src/modules/account/VerifyEmail.jsx
+++ b/apps/carefind/src/modules/account/VerifyEmail.jsx
@@ -1,9 +1,9 @@
-import { useEffect, useState } from 'react'
+import { useEffect, useLayoutEffect, useRef, useState } from 'react'
 import { useNavigate, Link } from 'react-router-dom'
 import { MailCheck, MailX, MailQuestionMark } from 'lucide-react'
 // Capture MUST precede the supabase import: supabase consumes the token from
 // the address bar at boot, so this module snapshot is the only evidence.
-import { capturedVerifyEmailParams } from './verifyEmailParams'
+import { capturedVerifyEmailParams, consumedUrlFromHref, currentUrlHref } from './verifyEmailParams'
 import { supabase } from '../../config/supabaseClient'
 import { theme } from '../../styles/theme'
 import { useBreakpoint } from '../../hooks/useBreakpoint'
@@ -16,18 +16,21 @@ export const SETTLE_TIMEOUT_MS = 10000
 // invite tokens carry access_tokens too but are not this page's business.
 const SIGNUP_HASH_TYPES = new Set(['signup'])
 
-const HASH_KEYS_TO_STRIP = new Set(['access_token', 'type', 'error', 'error_description'])
+// Visit-scoped judge, wired to the snapshot at capture time: adjudication
+// happens at most once per visited snapshot URL, while a re-run that lands on
+// the same consumed URL (StrictMode remount, duplicate exchange, late event)
+// replays the recorded verdict. A genuinely different token URL adjudicates
+// fresh. `verdict` is terminal per snapshot. Tests isolate this module-level
+// state by re-importing the module (vi.resetModules) -- no prod test hook.
+let judgedSnapshots = new Map()
 
-// First settlement wins across mounts. Verified must never be re-litigated
-// into "expired" by a duplicate exchange, a stale event, or a React
-// StrictMode remount — matches "settle() is terminal/idempotent".
-let settledVerdict = null
-
-export function __resetVerifyEmailForTests() {
-  settledVerdict = null
+export function getVerifyEmailVisitRecord() {
+  const snapshotHref = capturedVerifyEmailParams.href
+  if (!snapshotHref) return null
+  return judgedSnapshots.get(snapshotHref) || null
 }
 
-// Effect-time consumption check only — the token itself was captured at import.
+// Effect-time consumption check only -- the token itself was captured at import.
 export function tokenStillInUrl() {
   try {
     return Boolean(new URL(window.location.href).searchParams.get('code'))
@@ -37,16 +40,16 @@ export function tokenStillInUrl() {
   }
 }
 
-export function stripConsumedTokenFromUrl() {
+// Rewrites the live URL to the consumption shape of the captured snapshot
+// (whole-hash drop for implicit, `code`-strip for PKCE) so a refresh lands on
+// `info`, never a re-exchange of a single-use code, and a StrictMode dev
+// remount cannot double-exchange into a false `expired`.
+export function stripConsumedTokenFromUrl(snapshotHref) {
+  const consumedUrl = consumedUrlFromHref(snapshotHref)
+  if (!consumedUrl) return
   try {
-    const url = new URL(window.location.href)
-    url.searchParams.delete('code')
-    url.searchParams.delete('error')
-    url.searchParams.delete('error_description')
-    const hash = new URLSearchParams(url.hash.replace(/^#/, '?'))
-    HASH_KEYS_TO_STRIP.forEach((key) => hash.delete(key))
-    const hashString = Array.from(hash.keys()).length > 0 ? `#${hash.toString()}` : ''
-    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${hashString}`)
+    const { pathname, search, hash } = new URL(consumedUrl)
+    window.history.replaceState(window.history.state, '', `${pathname}${search}${hash}`)
   } catch (err) {
     console.warn('[VerifyEmail] could not strip consumed token:', err)
   }
@@ -56,123 +59,148 @@ function VerifyEmail() {
   const navigate = useNavigate()
   const { isMobileOrTablet } = useBreakpoint()
   const [status, setStatus] = useState('loading')
+  const verdictHeadingRef = useRef(null)
+  const announcedRef = useRef(false)
+
+  // A11y (iteration-4): announce a verdict exactly once by moving focus to the
+  // result heading, which carries a visible focus indicator. Never stack a
+  // focus move AND a live region on the same verdict; move focus only on the
+  // initial `loading` -> verdict transition, never on later re-runs, and never
+  // for `expired` (whose `role="alert"` is the single announcement).
+  useLayoutEffect(() => {
+    if (status === 'loading') return
+    if (announcedRef.current) return
+    announcedRef.current = true
+    if (status === 'expired') return
+    if (verdictHeadingRef.current) verdictHeadingRef.current.focus()
+  }, [status])
 
   useEffect(() => {
-    const { code, accessToken, type, error, errorDescription } = capturedVerifyEmailParams
+    const snapshot = capturedVerifyEmailParams
+    const { code, accessToken, type, error, errorDescription } = snapshot
+    const snapshotUrl = snapshot.href
 
     let timerId = null
     let subscription = null
 
-    const settle = (verdict) => {
-      if (settledVerdict) {
-        // Re-litigating a settled page (duplicate exchange, late event,
-        // StrictMode remount) replays the original verdict instead.
-        if (settledVerdict !== verdict) setStatus(settledVerdict)
+    const consumedUrl = consumedUrlFromHref(snapshotUrl)
+    const currentUrl = currentUrlHref()
+    const consumedMatch = consumedUrl !== null && currentUrl === consumedUrl
+
+    const settle = (verdict, branch) => {
+      const existing = judgedSnapshots.get(snapshotUrl)
+      if (existing) {
+        // Re-litigating a settled page replays the original verdict instead.
+        console.debug('[VerifyEmail] replaying settled verdict', { branch, verdict, recorded: existing.verdict, snapshotUrl, consumedUrl })
+        if (existing.verdict !== verdict) setStatus(existing.verdict)
         return
       }
-      settledVerdict = verdict
+      judgedSnapshots.set(snapshotUrl, { verdict, snapshotUrl, consumedUrl })
+      console.debug('[VerifyEmail] settling', { branch, verdict, snapshotUrl, consumedUrl, consumedMatch, currentUrl })
       if (timerId) {
         clearTimeout(timerId)
         timerId = null
       }
-      if (verdict === 'verified') stripConsumedTokenFromUrl()
+      if (verdict === 'verified') stripConsumedTokenFromUrl(snapshotUrl)
       setStatus(verdict)
     }
 
     const startBound = () => {
       if (timerId) return
-      timerId = setTimeout(() => settle('expired'), SETTLE_TIMEOUT_MS)
+      timerId = setTimeout(() => settle('expired', 'bounded-timeout'), SETTLE_TIMEOUT_MS)
     }
 
-    const subscribe = () => {
+    const subscribe = (branch) => {
       try {
         const res = supabase.auth.onAuthStateChange((_event, session) => {
-          if (session?.access_token) settle('verified')
+          if (session && session.access_token) settle('verified', branch)
         })
         subscription = (res && res.data && res.data.subscription) || null
+        console.debug('[VerifyEmail] gated auth listener armed', { branch, snapshotUrl })
       } catch (err) {
         console.warn('[VerifyEmail] auth listener failed:', err)
       }
     }
 
-    const checkSession = (counts) => {
+    const checkSession = (counts, branch) => {
       try {
-        supabase.auth.getSession()
-          .then(({ data }) => {
+        const res = supabase.auth.getSession()
+        Promise.resolve(res)
+          .then(({ data } = {}) => {
             const session = data && data.session
-            if (counts(session)) settle('verified')
-            else settle('expired')
+            if (counts(session)) settle('verified', branch)
+            else settle('expired', branch)
           })
           .catch((err) => {
             console.warn('[VerifyEmail] getSession failed:', err)
-            settle('expired')
+            settle('expired', branch)
           })
       } catch (err) {
         console.warn('[VerifyEmail] getSession failed:', err)
-        settle('expired')
+        settle('expired', branch)
       }
     }
 
-    // (3) Supabase itself rejected the token and told us why.
-    if (error) {
-      console.warn(`[VerifyEmail] auth token error${errorDescription ? `: ${errorDescription}` : ''}`)
-      settle('expired')
+    // (1) Supabase rejected the token, or the captured evidence is present but
+    // empty (`?code=`, `#access_token=`, `?error=`): expired.
+    if (snapshot.hasError || (snapshot.hasCode && !code) || (snapshot.hasAccessToken && !accessToken)) {
+      if (error) console.warn(`[VerifyEmail] auth token error${errorDescription ? `: ${errorDescription}` : ''}`)
+      settle('expired', 'error-or-empty-param')
       return cleanup
     }
 
-    // PKCE (`?code=`) links. In the same browser supabase already exchanged
-    // the code at boot, so it has usually vanished from the URL by now —
-    // but a link that bypassed the client (cross-device, direct navigation
-    // before the app loaded) still lands here with the code intact.
-    if (code) {
+    // (2) Consumption-shaped replay (the iteration-4 fix): the live URL equals
+    // the consumption form of the captured snapshot. supabase-js already
+    // validated THIS link (implicit: cleared the whole hash; PKCE: stripped
+    // `code`), so the recorded verdict -- which branch 1 could not reach with a
+    // non-empty token -- replays as verified. Only these two shapes count.
+    if (consumedMatch && ((snapshot.hasCode && code) || (snapshot.hasAccessToken && accessToken && SIGNUP_HASH_TYPES.has(type)))) {
+      settle('verified', 'consumed-form-replay')
+      return cleanup
+    }
+
+    // (3) PKCE (`?code=`) link the client did NOT auto-handle (cross-device,
+    // no stored verifier): the code is still in the URL, our exchange is
+    // authoritative and its result alone settles the verdict. A vanished code
+    // that does not match the consumed form cannot be proven and expires.
+    if (snapshot.hasCode) {
       if (tokenStillInUrl()) {
-        // The client never touched the code: our exchange is authoritative,
-        // verdict comes from its result alone.
         startBound()
         try {
-          supabase.auth.exchangeCodeForSession(window.location.href)
-            .then(({ data, error: exchangeError }) => {
-              if (exchangeError || !data?.session) { settle('expired'); return }
-              settle('verified')
+          const res = supabase.auth.exchangeCodeForSession(window.location.href)
+          Promise.resolve(res)
+            .then(({ data, error: exchangeError } = {}) => {
+              if (exchangeError || !data || !data.session) { settle('expired', 'pkce-exchange'); return }
+              settle('verified', 'pkce-exchange')
             })
             .catch((err) => {
               console.warn('[VerifyEmail] code exchange failed:', err)
-              settle('expired')
+              settle('expired', 'pkce-exchange')
             })
         } catch (err) {
           console.warn('[VerifyEmail] code exchange failed:', err)
-          settle('expired')
+          settle('expired', 'pkce-exchange')
         }
       } else {
-        // Auto-handled at boot: the session supabase just created IS the
-        // code's product — any arriving session event or held session counts.
-        startBound()
-        subscribe()
-        checkSession((session) => Boolean(session))
+        settle('expired', 'pkce-stale')
       }
       return cleanup
     }
 
-    // Implicit (`#access_token=...&type=signup`) links. Verified only when
+    // (4) Implicit (`#access_token=...&type=signup`) link still pending: the
+    // hash is present and the code has not consumed it yet. Verified only when
     // the arriving/matching session's access_token is this link's own token.
-    if (accessToken && SIGNUP_HASH_TYPES.has(type)) {
+    if (snapshot.hasAccessToken && accessToken && SIGNUP_HASH_TYPES.has(type)) {
       startBound()
-      try {
-        const res = supabase.auth.onAuthStateChange((_event, session) => {
-          if (session?.access_token && session.access_token === accessToken) settle('verified')
-        })
-        subscription = (res && res.data && res.data.subscription) || null
-      } catch (err) {
-        console.warn('[VerifyEmail] auth listener failed:', err)
-      }
-      checkSession((session) => session?.access_token === accessToken)
+      subscribe('implicit-pending')
+      checkSession((session) => session && session.access_token === accessToken, 'implicit-pending')
       return cleanup
     }
 
-    // No captured token, or a non-verification link type: nothing to judge.
-    // A held session must never fake success here — the page is a dead end
+    // (5) No captured token, or a non-verification link type: nothing to judge.
+    // A held session must never fake success here -- the page is a dead end
     // until the user opens their actual verification link.
-    settle('info')
+    settle('info', 'no-token-info')
 
     return cleanup
 
@@ -187,25 +215,39 @@ function VerifyEmail() {
   ) : status === 'verified' ? (
     <div style={{ textAlign: 'center', padding: '12px 0' }}>
       <MailCheck size={40} color={theme.tealDeep} strokeWidth={1.6} style={{ marginBottom: 10 }} />
-      <h2 style={{ margin: '0 0 6px 0', fontSize: 17, fontWeight: 900, color: theme.navy }}>Email verified</h2>
+      <h2
+        ref={verdictHeadingRef}
+        tabIndex={-1}
+        style={{ margin: '0 0 6px 0', fontSize: 17, fontWeight: 900, color: theme.navy, outlineStyle: 'solid', outlineWidth: 2, outlineColor: 'var(--teal)', outlineOffset: 2 }}
+      >Email verified</h2>
       <p style={{ margin: '0 0 18px 0', fontSize: 13.5, color: theme.textLight, lineHeight: 1.55 }}>
         Your email has been confirmed. You can now continue to your account.
       </p>
       <TealBtn onClick={() => navigate('/onboarding')}>Continue to onboarding</TealBtn>
     </div>
   ) : status === 'expired' ? (
-    <div role="alert" aria-live="assertive" style={{ textAlign: 'center', padding: '12px 0' }}>
-      <MailX size={40} color={theme.alert} strokeWidth={1.6} style={{ marginBottom: 10 }} />
-      <h2 style={{ margin: '0 0 6px 0', fontSize: 17, fontWeight: 900, color: theme.navy }}>Verification link expired</h2>
-      <p style={{ margin: '0 0 18px 0', fontSize: 13.5, color: theme.textLight, lineHeight: 1.55 }}>
-        This link has expired or was already used. Please log in, or contact support if you believe this is an error.
-      </p>
+    // `expired` is the only verdict that carries a live region. `role="alert"`
+    // announces it (no redundant explicit `aria-live="assertive"`), and the
+    // interactive exit CTA stays OUTSIDE the region -- live regions must not
+    // wrap interactive controls. Focus intentionally does not move here.
+    <div style={{ textAlign: 'center', padding: '12px 0' }}>
+      <div role="alert" style={{ textAlign: 'center' }}>
+        <MailX size={40} color={theme.alert} strokeWidth={1.6} style={{ marginBottom: 10 }} />
+        <h2 style={{ margin: '0 0 6px 0', fontSize: 17, fontWeight: 900, color: theme.navy }}>Verification link expired</h2>
+        <p style={{ margin: '0 0 18px 0', fontSize: 13.5, color: theme.textLight, lineHeight: 1.55 }}>
+          This link has expired or was already used. Please log in, or contact support if you believe this is an error.
+        </p>
+      </div>
       <TealBtn variant="ghost" onClick={() => navigate('/login')}>Back to login</TealBtn>
     </div>
   ) : (
     <div style={{ textAlign: 'center', padding: '12px 0' }}>
       <MailQuestionMark size={40} color={theme.textLight} strokeWidth={1.6} style={{ marginBottom: 10 }} />
-      <h2 style={{ margin: '0 0 6px 0', fontSize: 17, fontWeight: 900, color: theme.navy }}>Missing verification link</h2>
+      <h2
+        ref={verdictHeadingRef}
+        tabIndex={-1}
+        style={{ margin: '0 0 6px 0', fontSize: 17, fontWeight: 900, color: theme.navy, outlineStyle: 'solid', outlineWidth: 2, outlineColor: 'var(--teal)', outlineOffset: 2 }}
+      >Missing verification link</h2>
       <p style={{ margin: '0 0 18px 0', fontSize: 13.5, color: theme.textLight, lineHeight: 1.55 }}>
         This page verifies your email using the link in your email. Open the verification link you received to continue.
       </p>
```

## apps\carefind\src\modules\account\__tests__\VerifyEmail.test.jsx (diff vs HEAD)

```
diff --git a/apps/carefind/src/modules/account/__tests__/VerifyEmail.test.jsx b/apps/carefind/src/modules/account/__tests__/VerifyEmail.test.jsx
index f220dd5..7241ad7 100644
--- a/apps/carefind/src/modules/account/__tests__/VerifyEmail.test.jsx
+++ b/apps/carefind/src/modules/account/__tests__/VerifyEmail.test.jsx
@@ -2,9 +2,25 @@ import React from 'react'
 import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
 import { render, screen, fireEvent, act } from '@testing-library/react'
 import { MemoryRouter, Routes, Route } from 'react-router-dom'
-import VerifyEmail, { SETTLE_TIMEOUT_MS, __resetVerifyEmailForTests } from '../VerifyEmail.jsx'
+// The visit judge (`judgedSnapshots`) lives at module scope inside the page.
+// Tests therefore reload a FRESH module instance per test / visit via
+// `vi.resetModules()` + dynamic import -- the page avoids a production test
+// hook (KEEP: "no prod test hook").
+const moduleHolder = vi.hoisted(() => ({ mod: null }))
+async function loadPageModule() {
+  vi.resetModules()
+  moduleHolder.mod = await import('../VerifyEmail.jsx')
+  return moduleHolder.mod
+}
+
+// Real supabase callback shapes (xii): auth-js REQUIRES all four explicit
+// params in an implicit callback or it throws "No session defined in URL", so
+// a minted signup link always carries them. `#access_token=tok&type=signup`
+// alone is a shape auth-js rejects and must not be the only branch-3 fixture.
+const IMPLICIT_CALLBACK_HASH = '#access_token=tok&expires_in=3600&refresh_token=rt&token_type=bearer&type=signup'
+const ORIGIN = 'http://localhost:3000'
 
-// ── Supabase client mock ────────────────────────────────────────────────────
+	// ---- Supabase client mock ----
 const mocks = vi.hoisted(() => {
   const listeners = new Set()
   const unsub = vi.fn()
@@ -26,25 +42,41 @@ const mocks = vi.hoisted(() => {
 
 vi.mock('../../../config/supabaseClient', () => ({ supabase: mocks.supabase }))
 
-// ── Import-time capture mock ────────────────────────────────────────────────
+	// ---- Import-time capture mock ----
 // `captureState` is the single object exposed as `capturedVerifyEmailParams`,
 // so the page reads its properties at effect time and per-test mutations are
 // visible through the live binding. `setCapture` rewrites it in beforeEach.
+// The mock keeps the module's REAL `consumedUrlFromHref` / `currentUrlHref` so
+// tests exercise the genuine consumption-shape derivation, then overrides only
+// the snapshot object and its parser.
 const captureState = vi.hoisted(() => ({
+  href: null,
   code: null,
+  hasCode: false,
   accessToken: null,
+  hasAccessToken: false,
   type: null,
+  hasType: false,
   error: null,
+  hasError: false,
   errorDescription: null,
+  hasErrorDescription: false,
 }))
 
-vi.mock('../verifyEmailParams', () => ({
-  parseVerifyEmailParams: () => captureState,
-  capturedVerifyEmailParams: captureState,
-}))
+vi.mock('../verifyEmailParams', async (importActual) => {
+  const actual = await importActual()
+  return {
+    ...actual,
+    parseVerifyEmailParams: () => captureState,
+    capturedVerifyEmailParams: captureState,
+  }
+})
 
+// Presence booleans auto-derive from a non-null value, unless overridden
+// (empty-param tests need `present` with a null value).
 function setCapture(overrides = {}) {
   Object.assign(captureState, {
+    href: window.location.href,
     code: null,
     accessToken: null,
     type: null,
@@ -52,6 +84,11 @@ function setCapture(overrides = {}) {
     errorDescription: null,
     ...overrides,
   })
+  if (!Object.prototype.hasOwnProperty.call(overrides, 'hasCode')) captureState.hasCode = captureState.code !== null
+  if (!Object.prototype.hasOwnProperty.call(overrides, 'hasAccessToken')) captureState.hasAccessToken = captureState.accessToken !== null
+  if (!Object.prototype.hasOwnProperty.call(overrides, 'hasType')) captureState.hasType = captureState.type !== null
+  if (!Object.prototype.hasOwnProperty.call(overrides, 'hasError')) captureState.hasError = captureState.error !== null
+  if (!Object.prototype.hasOwnProperty.call(overrides, 'hasErrorDescription')) captureState.hasErrorDescription = captureState.errorDescription !== null
 }
 
 function emit(event, session) {
@@ -59,6 +96,7 @@ function emit(event, session) {
 }
 
 function renderPage() {
+  const VerifyEmail = moduleHolder.mod.default
   return render(
     <MemoryRouter initialEntries={['/verify-email']}>
       <Routes>
@@ -71,12 +109,12 @@ function renderPage() {
 }
 
 describe('VerifyEmail', () => {
-  beforeEach(() => {
+  beforeEach(async () => {
     vi.clearAllMocks()
     mocks.listeners.clear()
-    __resetVerifyEmailForTests()
-    setCapture()
+    await loadPageModule()
     window.history.replaceState(null, '', '/verify-email')
+    setCapture()
   })
 
   afterEach(() => {
@@ -85,8 +123,8 @@ describe('VerifyEmail', () => {
 
   it('PKCE success settles verified from the exchange result, never a re-getSession', async () => {
     mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
-    setCapture({ code: 'abc123' })
     window.history.replaceState(null, '', '/verify-email?code=abc123')
+    setCapture({ code: 'abc123' })
 
     renderPage()
 
@@ -99,8 +137,8 @@ describe('VerifyEmail', () => {
 
   it('exchange error settles expired', async () => {
     mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: { message: 'invalid code' } })
-    setCapture({ code: 'bad' })
     window.history.replaceState(null, '', '/verify-email?code=bad')
+    setCapture({ code: 'bad' })
 
     renderPage()
 
@@ -110,40 +148,43 @@ describe('VerifyEmail', () => {
 
   it('exchange rejection settles expired', async () => {
     mocks.supabase.auth.exchangeCodeForSession.mockRejectedValue(new Error('network'))
-    setCapture({ code: 'bad' })
     window.history.replaceState(null, '', '/verify-email?code=bad')
+    setCapture({ code: 'bad' })
 
     renderPage()
 
     expect(await screen.findByRole('alert')).toHaveTextContent('Verification link expired')
   })
 
-  it('auto-handled PKCE: an arriving session settles verified with no re-exchange', async () => {
-    setCapture({ code: 'handled' })
-    // The client consumed the code at boot — it is gone from the URL.
+  // (xiv) PKCE boot-consumption race (+ xviii): capture with `?code=`, the
+  // client clears it before the effect (models `_getSessionFromURL` stripping
+  // only `code` + `sb_flow_id`), and the page replays the visit record as
+  // verified -- no re-exchange, no `getSession`, no stored session needed.
+  it('boot-consumed PKCE link settles verified from the visit record, no re-exchange', async () => {
+    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
     mocks.supabase.auth.getSession.mockReturnValue(new Promise(() => {}))
+    window.history.replaceState(null, '', '/verify-email?code=handled')
+    setCapture({ code: 'handled' })
+    window.history.replaceState(null, '', '/verify-email')
 
     renderPage()
-    expect(screen.getByText(/Verifying/)).toBeInTheDocument()
-
-    act(() => emit('SIGNED_IN', { access_token: 'whatever' }))
 
     expect(await screen.findByText('Email verified')).toBeInTheDocument()
     expect(mocks.supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled()
-  })
-
-  it('auto-handled PKCE with no stored session expires', async () => {
-    setCapture({ code: 'handled' })
-    mocks.supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
-
-    renderPage()
+    expect(mocks.supabase.auth.getSession).not.toHaveBeenCalled()
 
-    expect(await screen.findByRole('alert')).toHaveTextContent('Verification link expired')
+    const record = moduleHolder.mod.getVerifyEmailVisitRecord()
+    expect(record).not.toBeNull()
+    expect(record.verdict).toBe('verified')
+    expect(new URL(record.snapshotUrl).searchParams.get('code')).toBe('handled')
+    // PKCE consumed form strips ONLY `code` (+ `sb_flow_id`): bare URL recorded.
+    expect(new URL(record.consumedUrl).search).toBe('')
+    expect(record.consumedUrl).toBe(window.location.href)
   })
 
   it('captured error/error_description settles expired without touching supabase', async () => {
-    setCapture({ accessToken: 'tok', type: 'signup', error: 'access_denied', errorDescription: 'The link you used is invalid or has expired.' })
     window.history.replaceState(null, '', '/verify-email#access_token=tok&type=signup&error=access_denied&error_description=bad')
+    setCapture({ accessToken: 'tok', type: 'signup', error: 'access_denied', errorDescription: 'The link you used is invalid or has expired.' })
 
     renderPage()
 
@@ -157,8 +198,8 @@ describe('VerifyEmail', () => {
   it('an already-verified user clicking a fresh valid PKCE link still sees verified (stored session never blocks)', async () => {
     mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
     mocks.supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'stored', user: { id: 'u1' } } }, error: null })
-    setCapture({ code: 'fresh' })
     window.history.replaceState(null, '', '/verify-email?code=fresh')
+    setCapture({ code: 'fresh' })
 
     renderPage()
 
@@ -177,8 +218,8 @@ describe('VerifyEmail', () => {
 
   it('non-signup hash type with an access_token shape does not fake success', async () => {
     mocks.supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'tok', user: { id: 'u1' } } }, error: null })
+    window.history.replaceState(null, '', '/verify-email#access_token=tok&expires_in=3600&type=recovery')
     setCapture({ accessToken: 'tok', type: 'recovery' })
-    window.history.replaceState(null, '', '/verify-email#access_token=tok&type=recovery')
 
     renderPage()
 
@@ -188,8 +229,8 @@ describe('VerifyEmail', () => {
 
   it('implicit success via an arriving matching-session event', async () => {
     mocks.supabase.auth.getSession.mockReturnValue(new Promise(() => {}))
+    window.history.replaceState(null, '', `/verify-email${IMPLICIT_CALLBACK_HASH}`)
     setCapture({ accessToken: 'tok', type: 'signup' })
-    window.history.replaceState(null, '', '/verify-email#access_token=tok&type=signup')
 
     renderPage()
     expect(screen.getByText(/Verifying/)).toBeInTheDocument()
@@ -197,26 +238,40 @@ describe('VerifyEmail', () => {
     act(() => emit('SIGNED_IN', { access_token: 'tok' }))
 
     expect(await screen.findByText('Email verified')).toBeInTheDocument()
+    expect(mocks.supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled()
   })
 
-  it('settles verified from an arriving session event even when the hash was already cleared at boot', async () => {
-    // Capture holds the token while the URL no longer does (supabase stripped it).
+  // (xiii) implicit boot-consumption race -- the iteration-4 bad_spec: capture
+  // the full real callback hash, rewrite the URL to bare BEFORE the effect
+  // runs (models `_initialize` clearing the whole hash), then assert the page
+  // settles verified from the recorded visit -- with NO arriving event and NO
+  // `getSession`. Direct regression for the false "Missing verification link".
+  it('implicit boot-consumption race settles verified from the visit record, never "Missing verification link"', async () => {
     mocks.supabase.auth.getSession.mockReturnValue(new Promise(() => {}))
+    window.history.replaceState(null, '', `/verify-email${IMPLICIT_CALLBACK_HASH}`)
     setCapture({ accessToken: 'tok', type: 'signup' })
     window.history.replaceState(null, '', '/verify-email')
 
     renderPage()
-    expect(screen.getByText(/Verifying/)).toBeInTheDocument()
-
-    act(() => emit('SIGNED_IN', { access_token: 'tok' }))
 
     expect(await screen.findByText('Email verified')).toBeInTheDocument()
+    expect(screen.queryByText('Missing verification link')).toBeNull()
+    expect(screen.queryByText('Verification link expired')).toBeNull()
+    expect(mocks.supabase.auth.getSession).not.toHaveBeenCalled()
+
+    const record = moduleHolder.mod.getVerifyEmailVisitRecord()
+    expect(record).not.toBeNull()
+    expect(record.verdict).toBe('verified')
+    expect(record.snapshotUrl).toContain('#access_token=tok')
+    // Implicit consumed form drops the WHOLE hash: bare URL recorded.
+    expect(new URL(record.consumedUrl).hash).toBe('')
+    expect(record.consumedUrl).toBe(window.location.href)
   })
 
   it('implicit success via the single gated getSession when the token matches', async () => {
     mocks.supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'tok', user: { id: 'u1' } } }, error: null })
+    window.history.replaceState(null, '', `/verify-email${IMPLICIT_CALLBACK_HASH}`)
     setCapture({ accessToken: 'tok', type: 'signup' })
-    window.history.replaceState(null, '', '/verify-email#access_token=tok&type=signup')
 
     renderPage()
 
@@ -226,8 +281,8 @@ describe('VerifyEmail', () => {
 
   it('a non-matching stored session never flips an implicit hash to verified', async () => {
     mocks.supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'other', user: { id: 'u1' } } }, error: null })
+    window.history.replaceState(null, '', `/verify-email${IMPLICIT_CALLBACK_HASH}`)
     setCapture({ accessToken: 'tok', type: 'signup' })
-    window.history.replaceState(null, '', '/verify-email#access_token=tok&type=signup')
 
     renderPage()
 
@@ -247,8 +302,8 @@ describe('VerifyEmail', () => {
 
   it('a listener-emitted session on a failed page stays expired', async () => {
     mocks.supabase.auth.exchangeCodeForSession.mockRejectedValue(new Error('network'))
-    setCapture({ code: 'bad' })
     window.history.replaceState(null, '', '/verify-email?code=bad')
+    setCapture({ code: 'bad' })
 
     renderPage()
     expect(await screen.findByRole('alert')).toHaveTextContent('Verification link expired')
@@ -262,13 +317,13 @@ describe('VerifyEmail', () => {
   it('implicit hash with no session event expires via the bounded timer', () => {
     vi.useFakeTimers()
     mocks.supabase.auth.getSession.mockReturnValue(new Promise(() => {}))
+    window.history.replaceState(null, '', `/verify-email${IMPLICIT_CALLBACK_HASH}`)
     setCapture({ accessToken: 'tok', type: 'signup' })
-    window.history.replaceState(null, '', '/verify-email#access_token=tok&type=signup')
 
     renderPage()
     expect(screen.getByText(/Verifying/)).toBeInTheDocument()
 
-    act(() => { vi.advanceTimersByTime(SETTLE_TIMEOUT_MS) })
+    act(() => { vi.advanceTimersByTime(moduleHolder.mod.SETTLE_TIMEOUT_MS) })
 
     expect(screen.getByRole('alert')).toHaveTextContent('Verification link expired')
   })
@@ -276,21 +331,21 @@ describe('VerifyEmail', () => {
   it('hung exchangeCodeForSession expires via the bounded timer', () => {
     vi.useFakeTimers()
     mocks.supabase.auth.exchangeCodeForSession.mockReturnValue(new Promise(() => {}))
-    setCapture({ code: 'pending' })
     window.history.replaceState(null, '', '/verify-email?code=pending')
+    setCapture({ code: 'pending' })
 
     renderPage()
     expect(screen.getByText(/Verifying/)).toBeInTheDocument()
 
-    act(() => { vi.advanceTimersByTime(SETTLE_TIMEOUT_MS) })
+    act(() => { vi.advanceTimersByTime(moduleHolder.mod.SETTLE_TIMEOUT_MS) })
 
     expect(screen.getByRole('alert')).toHaveTextContent('Verification link expired')
   })
 
   it('implicit-hash null session after resolution settles expired', async () => {
     mocks.supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
+    window.history.replaceState(null, '', `/verify-email${IMPLICIT_CALLBACK_HASH}`)
     setCapture({ accessToken: 'tok', type: 'signup' })
-    window.history.replaceState(null, '', '/verify-email#access_token=tok&type=signup')
 
     renderPage()
 
@@ -300,8 +355,8 @@ describe('VerifyEmail', () => {
   it('unmounting mid-exchange causes no crash and no late settle', async () => {
     let resolveExchange
     mocks.supabase.auth.exchangeCodeForSession.mockReturnValue(new Promise((r) => { resolveExchange = r }))
-    setCapture({ code: 'pending' })
     window.history.replaceState(null, '', '/verify-email?code=pending')
+    setCapture({ code: 'pending' })
 
     const { unmount } = renderPage()
     expect(screen.getByText(/Verifying/)).toBeInTheDocument()
@@ -314,8 +369,8 @@ describe('VerifyEmail', () => {
 
   it('expired copy does not promise a resend path', async () => {
     mocks.supabase.auth.exchangeCodeForSession.mockRejectedValue(new Error('network'))
-    setCapture({ code: 'bad' })
     window.history.replaceState(null, '', '/verify-email?code=bad')
+    setCapture({ code: 'bad' })
 
     renderPage()
 
@@ -328,8 +383,8 @@ describe('VerifyEmail', () => {
 
   it('verified card exposes a single primary CTA to /onboarding', async () => {
     mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
-    setCapture({ code: 'abc123' })
     window.history.replaceState(null, '', '/verify-email?code=abc123')
+    setCapture({ code: 'abc123' })
 
     renderPage()
     await screen.findByText('Email verified')
@@ -341,8 +396,8 @@ describe('VerifyEmail', () => {
 
   it('verified CTA navigates to /onboarding', async () => {
     mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
-    setCapture({ code: 'abc123' })
     window.history.replaceState(null, '', '/verify-email?code=abc123')
+    setCapture({ code: 'abc123' })
 
     renderPage()
     fireEvent.click(await screen.findByText('Continue to onboarding'))
@@ -352,8 +407,8 @@ describe('VerifyEmail', () => {
 
   it('expired CTA navigates to /login', async () => {
     mocks.supabase.auth.exchangeCodeForSession.mockRejectedValue(new Error('network'))
-    setCapture({ code: 'bad' })
     window.history.replaceState(null, '', '/verify-email?code=bad')
+    setCapture({ code: 'bad' })
 
     renderPage()
     fireEvent.click(await screen.findByRole('button', { name: 'Back to login' }))
@@ -369,8 +424,8 @@ describe('VerifyEmail', () => {
   })
 
   it('unmount unsubscribes the auth listener', () => {
+    window.history.replaceState(null, '', `/verify-email${IMPLICIT_CALLBACK_HASH}`)
     setCapture({ accessToken: 'tok', type: 'signup' })
-    window.history.replaceState(null, '', '/verify-email#access_token=tok&type=signup')
 
     const { unmount } = renderPage()
     expect(mocks.listeners.size).toBeGreaterThan(0)
@@ -381,8 +436,8 @@ describe('VerifyEmail', () => {
   })
 
   it('settles to info synchronously for a bare non-signup type', async () => {
-    setCapture({ accessToken: 'tok', type: 'magiclink' })
     window.history.replaceState(null, '', '/verify-email#access_token=tok&type=magiclink')
+    setCapture({ accessToken: 'tok', type: 'magiclink' })
 
     renderPage()
 
@@ -391,8 +446,8 @@ describe('VerifyEmail', () => {
 
   it('strips the consumed code/hash after verified', async () => {
     mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
-    setCapture({ code: 'abc123' })
     window.history.replaceState(null, '', '/verify-email?code=abc123')
+    setCapture({ code: 'abc123' })
 
     const { unmount } = renderPage()
     await screen.findByText('Email verified')
@@ -403,17 +458,17 @@ describe('VerifyEmail', () => {
 
   it('post-verified: a fresh tokenless page renders info, not expired', async () => {
     mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
-    setCapture({ code: 'abc123' })
     window.history.replaceState(null, '', '/verify-email?code=abc123')
+    setCapture({ code: 'abc123' })
 
     const { unmount } = renderPage()
     await screen.findByText('Email verified')
     unmount()
 
     // Fresh page load: capture is empty again and the URL has no token.
-    __resetVerifyEmailForTests()
-    setCapture()
+    await loadPageModule()
     window.history.replaceState(null, '', '/verify-email')
+    setCapture()
 
     renderPage()
 
@@ -427,14 +482,14 @@ describe('VerifyEmail', () => {
     mocks.supabase.auth.exchangeCodeForSession
       .mockReturnValueOnce(new Promise((r) => { resolveFirst = r }))
       .mockReturnValueOnce(new Promise((r) => { resolveSecond = r }))
-    setCapture({ code: 'abc123' })
     window.history.replaceState(null, '', '/verify-email?code=abc123')
+    setCapture({ code: 'abc123' })
 
     render(
       <React.StrictMode>
         <MemoryRouter initialEntries={['/verify-email']}>
           <Routes>
-            <Route path="/verify-email" element={<VerifyEmail />} />
+            <Route path="/verify-email" element={React.createElement(moduleHolder.mod.default)} />
           </Routes>
         </MemoryRouter>
       </React.StrictMode>
@@ -449,5 +504,148 @@ describe('VerifyEmail', () => {
 
     expect(screen.getByText('Email verified')).toBeInTheDocument()
     expect(screen.queryByText('Verification link expired')).toBeNull()
+  })
+
+	  // ---- (xv) a11y ----
+
+  it('a11y: a verified verdict focuses the result heading exactly once, with a visible focus indicator', async () => {
+    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
+    window.history.replaceState(null, '', '/verify-email?code=abc123')
+    setCapture({ code: 'abc123' })
+
+    renderPage()
+    await screen.findByText('Email verified')
+
+    const heading = screen.getByRole('heading', { level: 2, name: 'Email verified' })
+    expect(document.activeElement).toBe(heading)
+    expect(heading).toHaveAttribute('tabindex', '-1')
+    expect(heading.style.outlineStyle).toBe('solid')
+    expect(heading.style.outlineWidth).toBe('2px')
+    expect(heading.style.outlineColor).toBe('var(--teal)')
+
+    // Exactly ONE announce mechanism -- no live region stacked on the focus move.
+    expect(document.querySelector('[aria-live]')).toBeNull()
+    expect(screen.queryByRole('alert')).toBeNull()
+
+    // Simulating a later re-render does not re-announce (focus moved once only).
+    act(() => emit('SIGNED_IN', { access_token: 'other' }))
+    expect(document.activeElement).toBe(heading)
+  })
+
+  it('a11y: an info verdict focuses its own heading and mounts no live region', async () => {
+    renderPage()
+    await screen.findByText('Missing verification link')
+
+    const heading = screen.getByRole('heading', { level: 2, name: 'Missing verification link' })
+    expect(document.activeElement).toBe(heading)
+    expect(heading.style.outlineStyle).toBe('solid')
+    expect(document.querySelector('[aria-live]')).toBeNull()
+    expect(screen.queryByRole('alert')).toBeNull()
+  })
+
+  it('a11y: expired renders role=alert only, focuses nothing, and keeps controls outside the live region', async () => {
+    mocks.supabase.auth.exchangeCodeForSession.mockRejectedValue(new Error('network'))
+    window.history.replaceState(null, '', '/verify-email?code=bad')
+    setCapture({ code: 'bad' })
+
+    renderPage()
+    const alert = await screen.findByRole('alert')
+
+    expect(screen.getByRole('button', { name: 'Back to login' })).toBeInTheDocument()
+    expect(alert).not.toHaveAttribute('aria-live')
+    expect(alert.querySelector('button')).toBeNull()
+    expect(alert.querySelector('a')).toBeNull()
+
+    const expiredHeading = screen.getByRole('heading', { level: 2, name: 'Verification link expired' })
+    expect(document.activeElement).not.toBe(expiredHeading)
+  })
+
+	  // ---- (xvi) empty-param presence ----
+
+  it('an empty ?code= (present but valueless) settles expired, not info', async () => {
+    window.history.replaceState(null, '', '/verify-email?code=')
+    setCapture({ code: null, hasCode: true })
+
+    renderPage()
+
+    expect(await screen.findByRole('alert')).toHaveTextContent('Verification link expired')
+    expect(screen.queryByText('Missing verification link')).toBeNull()
+    expect(mocks.supabase.auth.getSession).not.toHaveBeenCalled()
+    expect(mocks.supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled()
+  })
+
+  it('an empty #access_token= (present but valueless) settles expired, not info', async () => {
+    window.history.replaceState(null, '', '/verify-email#access_token=')
+    setCapture({ accessToken: null, hasAccessToken: true })
+
+    renderPage()
+
+    expect(await screen.findByRole('alert')).toHaveTextContent('Verification link expired')
+    expect(screen.queryByText('Missing verification link')).toBeNull()
+    expect(mocks.supabase.auth.getSession).not.toHaveBeenCalled()
+  })
+
+  it('an empty ?error= (present but valueless) settles expired, not info', async () => {
+    window.history.replaceState(null, '', '/verify-email?error=')
+    setCapture({ error: null, hasError: true })
+
+    renderPage()
+
+    expect(await screen.findByRole('alert')).toHaveTextContent('Verification link expired')
+    expect(screen.queryByText('Missing verification link')).toBeNull()
+    expect(mocks.supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled()
+  })
+
+	  // ---- (xviii) judged-URL bookkeeping ----
+
+  it('a genuinely different token URL adjudicates fresh instead of replaying the last verdict', async () => {
+    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
+
+    // First visit: PKCE token A, consumed at boot (only `code` stripped -> bare).
+    window.history.replaceState(null, '', '/verify-email?code=aaa')
+    setCapture({ code: 'aaa' })
+    window.history.replaceState(null, '', '/verify-email')
+    const { unmount } = renderPage()
+    await screen.findByText('Email verified')
+    expect(moduleHolder.mod.getVerifyEmailVisitRecord().snapshotUrl).toContain('code=aaa')
+    expect(mocks.supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled()
+    unmount()
+
+    // Second visit: a DIFFERENT token B, live in the URL. The A record must
+    // not short-circuit adjudication -- B is judged on its own merits.
+    window.history.replaceState(null, '', '/verify-email?code=bbb')
+    setCapture({ code: 'bbb' })
+
+    renderPage()
+    expect(await screen.findByText('Email verified')).toBeInTheDocument()
+    expect(mocks.supabase.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1)
+    expect(mocks.supabase.auth.exchangeCodeForSession.mock.calls[0][0]).toContain('code=bbb')
+
+    const record = moduleHolder.mod.getVerifyEmailVisitRecord()
+    expect(record).not.toBeNull()
+    expect(record.verdict).toBe('verified')
+    expect(new URL(record.snapshotUrl).searchParams.get('code')).toBe('bbb')
+  })
+
+  it('a bare no-token open with no prior verdict adjudicates fresh as info', async () => {
+    // A prior implicit token visit recorded a verified verdict for the
+    // token-bearing URL. A bare `/verify-email` open is a DIFFERENT URL.
+    mocks.supabase.auth.getSession.mockReturnValue(new Promise(() => {}))
+    window.history.replaceState(null, '', `/verify-email${IMPLICIT_CALLBACK_HASH}`)
+    setCapture({ accessToken: 'tok', type: 'signup' })
+    window.history.replaceState(null, '', '/verify-email')
+    const { unmount } = renderPage()
+    await screen.findByText('Email verified')
+    unmount()
+
+    await loadPageModule()
+    window.history.replaceState(null, '', '/verify-email')
+    setCapture()
+
+    renderPage()
+
+    expect(await screen.findByText('Missing verification link')).toBeInTheDocument()
+    expect(moduleHolder.mod.getVerifyEmailVisitRecord()).not.toBeNull()
+    expect(moduleHolder.mod.getVerifyEmailVisitRecord().verdict).toBe('info')
   })
 })
\ No newline at end of file
```

## apps\carefind\src\modules\account\__tests__\verifyEmailParams.test.js (diff vs HEAD)

```
diff --git a/apps/carefind/src/modules/account/__tests__/verifyEmailParams.test.js b/apps/carefind/src/modules/account/__tests__/verifyEmailParams.test.js
index 6150b66..7e586ad 100644
--- a/apps/carefind/src/modules/account/__tests__/verifyEmailParams.test.js
+++ b/apps/carefind/src/modules/account/__tests__/verifyEmailParams.test.js
@@ -1,21 +1,41 @@
 import { describe, it, expect } from 'vitest'
-import { parseVerifyEmailParams } from '../verifyEmailParams'
+import {
+  parseVerifyEmailParams,
+  consumedUrlFromHref,
+  AUTH_QUERY_KEYS,
+  AUTH_HASH_KEYS,
+  PKCE_AUX_QUERY_KEYS,
+} from '../verifyEmailParams'
+
+describe('auth-param key lists (single source of truth)', () => {
+  it('declares the PKCE query keys and the implicit hash keys', () => {
+    expect(AUTH_QUERY_KEYS).toEqual(['code'])
+    expect(AUTH_HASH_KEYS).toEqual(['access_token', 'type', 'error', 'error_description'])
+    expect(PKCE_AUX_QUERY_KEYS).toEqual(['sb_flow_id'])
+  })
+})
 
 describe('parseVerifyEmailParams', () => {
-  it('extracts the PKCE code from the search string', () => {
+  it('extracts the PKCE code from the search string and records presence', () => {
     const p = parseVerifyEmailParams('http://localhost:3000/verify-email?code=abc123')
     expect(p.code).toBe('abc123')
+    expect(p.hasCode).toBe(true)
     expect(p.accessToken).toBeNull()
+    expect(p.hasAccessToken).toBe(false)
     expect(p.type).toBeNull()
     expect(p.error).toBeNull()
     expect(p.errorDescription).toBeNull()
+    expect(p.href).toBe('http://localhost:3000/verify-email?code=abc123')
   })
 
   it('extracts access_token and type from the hash fragment', () => {
     const p = parseVerifyEmailParams('http://localhost:3000/verify-email#access_token=tok123&type=signup')
     expect(p.accessToken).toBe('tok123')
+    expect(p.hasAccessToken).toBe(true)
     expect(p.type).toBe('signup')
+    expect(p.hasType).toBe(true)
     expect(p.code).toBeNull()
+    expect(p.hasCode).toBe(false)
   })
 
   it('extracts error and error_description from the hash fragment', () => {
@@ -23,7 +43,23 @@ describe('parseVerifyEmailParams', () => {
       'http://localhost:3000/verify-email#error=access_denied&error_description=The%20link%20you%20used%20is%20invalid%20or%20has%20expired'
     )
     expect(p.error).toBe('access_denied')
+    expect(p.hasError).toBe(true)
     expect(p.errorDescription).toBe('The link you used is invalid or has expired')
+    expect(p.hasErrorDescription).toBe(true)
+  })
+
+it('is presence-based, not truthiness-based: empty params still count as present', () => {
+    const emptyCode = parseVerifyEmailParams('http://localhost:3000/verify-email?code=')
+    expect(emptyCode.code).toBe('')
+    expect(emptyCode.hasCode).toBe(true)
+
+    const emptyToken = parseVerifyEmailParams('http://localhost:3000/verify-email#access_token=')
+    expect(emptyToken.accessToken).toBe('')
+    expect(emptyToken.hasAccessToken).toBe(true)
+
+    const emptyError = parseVerifyEmailParams('http://localhost:3000/verify-email?error=')
+    expect(emptyError.error).toBe('')
+    expect(emptyError.hasError).toBe(true)
   })
 
   it('keeps search code and hash params independent', () => {
@@ -37,19 +73,60 @@ describe('parseVerifyEmailParams', () => {
     expect(p.errorDescription).toBe('y')
   })
 
+  it('reads an error param from the query string as well as the hash', () => {
+    const p = parseVerifyEmailParams('http://localhost:3000/verify-email?error=oauth_failed&error_description=Nope')
+    expect(p.error).toBe('oauth_failed')
+    expect(p.hasError).toBe(true)
+    expect(p.errorDescription).toBe('Nope')
+  })
+
   it('returns all-null defaults for a malformed href without throwing', () => {
     const p = parseVerifyEmailParams('not a url at all')
     expect(p.code).toBeNull()
+    expect(p.hasCode).toBe(false)
     expect(p.accessToken).toBeNull()
-    expect(p.type).toBeNull()
+    expect(p.hasAccessToken).toBe(false)
     expect(p.error).toBeNull()
     expect(p.errorDescription).toBeNull()
   })
 
   it('handles an empty href (no window/SSR) without throwing', () => {
     const p = parseVerifyEmailParams('')
+    expect(p.href).toBeNull()
     expect(p.code).toBeNull()
     expect(p.accessToken).toBeNull()
     expect(p.type).toBeNull()
   })
 })
+
+describe('consumedUrlFromHref', () => {
+  it('implicit: drops the ENTIRE hash (matches auth-js `window.location.hash = ""`)', () => {
+    const href = 'http://localhost:3000/verify-email#access_token=tok&expires_in=3600&refresh_token=rt&token_type=bearer&type=signup'
+    expect(consumedUrlFromHref(href)).toBe('http://localhost:3000/verify-email')
+  })
+
+  it('implicit: drops the whole hash even when it holds only auxiliary params', () => {
+    expect(consumedUrlFromHref('http://localhost:3000/verify-email#type=signup')).toBe('http://localhost:3000/verify-email')
+  })
+
+  it('PKCE: strips ONLY code (+ sb_flow_id), keeping unrelated query params', () => {
+    expect(consumedUrlFromHref('http://localhost:3000/verify-email?code=abc&state=xyz')).toBe(
+      'http://localhost:3000/verify-email?state=xyz'
+    )
+    expect(consumedUrlFromHref('http://localhost:3000/verify-email?code=abc&sb_flow_id=f1&state=xyz')).toBe(
+      'http://localhost:3000/verify-email?state=xyz'
+    )
+  })
+
+  it('PKCE: a bare code-only query strips to the bare URL', () => {
+    expect(consumedUrlFromHref('http://localhost:3000/verify-email?code=abc')).toBe('http://localhost:3000/verify-email')
+  })
+
+  it('a tokenless/bare URL is its own consumed form (no-op)', () => {
+    expect(consumedUrlFromHref('http://localhost:3000/verify-email')).toBe('http://localhost:3000/verify-email')
+  })
+
+  it('returns null for a malformed href', () => {
+    expect(consumedUrlFromHref('not a url at all')).toBeNull()
+  })
+})
\ No newline at end of file
```

## apps\carefind\src\modules\account\verifyEmailParams.js (diff vs HEAD)

```
diff --git a/apps/carefind/src/modules/account/verifyEmailParams.js b/apps/carefind/src/modules/account/verifyEmailParams.js
index 615084d..31ff7ae 100644
--- a/apps/carefind/src/modules/account/verifyEmailParams.js
+++ b/apps/carefind/src/modules/account/verifyEmailParams.js
@@ -1,29 +1,89 @@
 // Import-time capture of this page's verification-token data.
 //
-// Must be imported BEFORE the supabase client (see VerifyEmail.jsx): on a
-// token-bearing landing URL, supabase-js auto-consumes the token from the
-// address bar during `createClient()` at app boot (implicit flow clears the
-// hash; same-browser PKCE strips the `?code=`). By the time any effect runs,
-// the evidence this page needs to judge the link is already gone. Capturing
-// here, synchronously, at module evaluation, is the only place it still
-// exists.
+// Must be imported BEFORE the supabase client (see VerifyEmail.jsx and
+// main.jsx): on a token-bearing landing URL, supabase-js auto-consumes the
+// token from the address bar during `createClient()` at app boot (implicit
+// flow clears the WHOLE hash; same-browser PKCE strips `?code=` plus
+// `sb_flow_id`). By the time any effect runs, the evidence this page needs to
+// judge the link is already gone. Capturing here, synchronously, at module
+// evaluation, is the only place it still exists.
 
+// Single-source location for every auth-param key the page cares about, so
+// capture, presence detection, and consumed-URL derivation can never drift
+// apart.
+export const AUTH_QUERY_KEYS = ['code']
+export const AUTH_HASH_KEYS = ['access_token', 'type', 'error', 'error_description']
+export const PKCE_AUX_QUERY_KEYS = ['sb_flow_id']
+
+// How supabase-js ACTUALLY leaves a callback URL after consuming it:
+//  - implicit success -> clears the ENTIRE hash (`window.location.hash = ''`)
+//  - PKCE success      -> strips only `code` (+ the `sb_flow_id` auxiliary)
+// Returns the normalized consumed form so branch-3 can replay the recorded
+// verdict when the live URL equals it. Returns null on any parse error.
+export function consumedUrlFromHref(href) {
+  try {
+    const url = new URL(href)
+    if (url.searchParams.has('code')) {
+      AUTH_QUERY_KEYS.concat(PKCE_AUX_QUERY_KEYS).forEach((key) => url.searchParams.delete(key))
+    } else {
+      url.hash = ''
+    }
+    return url.toString()
+  } catch (err) {
+    console.warn('[VerifyEmail] could not derive consumed URL from snapshot:', err)
+    return null
+  }
+}
+
+export function currentUrlHref() {
+  try {
+    return typeof window !== 'undefined' ? window.location.href : ''
+  } catch (err) {
+    console.warn('[VerifyEmail] could not read current URL:', err)
+    return ''
+  }
+}
+
+// Presence-aware, not truthiness-aware: an EMPTY `?code=`, `#access_token=`
+// or `?error=` still counts as present (see iteration-4 clause) so it lands on
+// `expired` rather than being mistaken for "no token". Each value stays the
+// raw string (or null); the has* siblings record mere presence.
 export function parseVerifyEmailParams(href) {
   const params = {
+    href: null,
     code: null,
+    hasCode: false,
     accessToken: null,
+    hasAccessToken: false,
     type: null,
+    hasType: false,
     error: null,
+    hasError: false,
     errorDescription: null,
+    hasErrorDescription: false,
   }
   try {
     const url = new URL(href)
+    params.href = url.href
+    params.hasCode = url.searchParams.has('code')
     params.code = url.searchParams.get('code')
     const hash = new URLSearchParams(url.hash.replace(/^#/, '?'))
+    params.hasAccessToken = hash.has('access_token')
     params.accessToken = hash.get('access_token')
+    params.hasType = hash.has('type')
     params.type = hash.get('type')
-    params.error = hash.get('error')
-    params.errorDescription = hash.get('error_description')
+    // Error params arrive in the hash for implicit callbacks but can appear in
+    // the query too; presence counts even when the value is empty, and an
+    // empty-but-present value stays '' (never coalesced to null or the other
+    // location's value).
+    params.hasError = url.searchParams.has('error') || hash.has('error')
+    const queryError = url.searchParams.get('error')
+    const hashError = hash.get('error')
+    params.error = queryError !== null ? queryError : hashError
+    params.hasErrorDescription = url.searchParams.has('error_description') || hash.has('error_description')
+    const queryErrorDescription = url.searchParams.get('error_description')
+    const hashErrorDescription = hash.get('error_description')
+    params.errorDescription = queryErrorDescription !== null ? queryErrorDescription : hashErrorDescription
   } catch (err) {
     console.warn('[VerifyEmail] could not parse verify-email params:', err)
   }
@@ -31,7 +91,7 @@ export function parseVerifyEmailParams(href) {
 }
 
 // Snapshots at module evaluation. Safe in SSR/test absence of a browser, too:
-// with no window the href is empty and every field resolves to null.
+// with no window the href is empty and every field resolves to null/false.
 export const capturedVerifyEmailParams = parseVerifyEmailParams(
   typeof window !== 'undefined' ? window.location.href : ''
 )
\ No newline at end of file

```

## apps/carefind/src/mainSourceOrder.test.js (NEW, untracked)

```
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// (xvii) Strengthened main.jsx source-order pin: the verify-email params module
// MUST be the FIRST import statement in the app entry, before supabaseClient
// AND before providers/AuthContext (which constructs the supabase client). ESM
// evaluates imports in source order, so this guarantees the capture snapshot
// precedes supabase-js' boot-time consumption of the callback URL.
const mainSource = readFileSync(path.resolve(process.cwd(), 'src/main.jsx'), 'utf8')

const importStatements = [...mainSource.matchAll(/^import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm)].map((m) => m[1])

describe('main.jsx import source order', () => {
  it('pins the verify-email params side-effect import as the FIRST import statement', () => {
    expect(importStatements.length).toBeGreaterThan(0)
    expect(importStatements[0]).toBe('./modules/account/verifyEmailParams')
  })

  it('the params import precedes the supabase client and the AuthProvider imports', () => {
    const paramsIdx = importStatements.indexOf('./modules/account/verifyEmailParams')
    const authProviderIdx = importStatements.findIndex((s) => s.includes('AuthContext.jsx'))
    const supabaseIdx = importStatements.findIndex((s) => s.includes('supabaseClient'))
    expect(paramsIdx).toBe(0)
    expect(paramsIdx).toBeLessThan(authProviderIdx)
    expect(authProviderIdx).toBeGreaterThan(-1)
    // main.jsx itself does not import the client directly; the pin above (index
    // 0) already guarantees capture precedes whatever AuthContext transitively
    // constructs -- assert the guard for the direct case too.
    expect(supabaseIdx).toBe(-1)
  })
})
```
