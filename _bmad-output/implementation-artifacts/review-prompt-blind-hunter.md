Conduct a review of CONTENT.
Look for what's missing, not only what's wrong.
Find at least ten issues to fix or improve.
Output a Markdown list of findings only — no severity, priority, or ranking.
If the content is empty, stop and say so.
If you have zero findings, re-check and keep thinking; do not stop with an empty list.

CONTENT:
diff --git a/apps/carefind/src/modules/account/VerifyEmail.jsx b/apps/carefind/src/modules/account/VerifyEmail.jsx
index 5568a13..24e6eb1 100644
--- a/apps/carefind/src/modules/account/VerifyEmail.jsx
+++ b/apps/carefind/src/modules/account/VerifyEmail.jsx
@@ -1,9 +1,10 @@
-import { useEffect, useState } from 'react'
+import { useEffect, useRef, useState } from 'react'
 import { useNavigate, Link } from 'react-router-dom'
 import { MailCheck, MailX, MailQuestionMark } from 'lucide-react'
 // Capture MUST precede the supabase import: supabase consumes the token from
-// the address bar at boot, so this module snapshot is the only evidence.
-import { capturedVerifyEmailParams } from './verifyEmailParams'
+// the address bar at createClient() boot, so this module snapshot ΓÇö hoisted to
+// the app entry by main.jsx ΓÇö is the only record of the arriving link.
+import { capturedVerifyEmailParams, parseVerifyEmailParams } from './verifyEmailParams'
 import { supabase } from '../../config/supabaseClient'
 import { theme } from '../../styles/theme'
 import { useBreakpoint } from '../../hooks/useBreakpoint'
@@ -17,14 +18,27 @@ export const SETTLE_TIMEOUT_MS = 10000
 const SIGNUP_HASH_TYPES = new Set(['signup'])
 
 const HASH_KEYS_TO_STRIP = new Set(['access_token', 'type', 'error', 'error_description'])
+const QUERY_KEYS_TO_STRIP = new Set(['code', 'error', 'error_description'])
 
-// First settlement wins across mounts. Verified must never be re-litigated
-// into "expired" by a duplicate exchange, a stale event, or a React
-// StrictMode remount ΓÇö matches "settle() is terminal/idempotent".
-let settledVerdict = null
+// URLs this SPA session has already adjudicated from the captured snapshot.
+// React.lazy caches this module for the whole session, so a second visit must
+// not re-judge with the first visit's snapshot (which would replay e.g.
+// "verified" for a now-dead link). A URL that lives here is treated as an
+// already-consumed earlier landing -> the live URL is re-derived instead.
+const judgedSnapshotUrls = new Set()
 
-export function __resetVerifyEmailForTests() {
-  settledVerdict = null
+function stripConsumedFromHref(href) {
+  try {
+    const url = new URL(href)
+    QUERY_KEYS_TO_STRIP.forEach((key) => url.searchParams.delete(key))
+    const hash = new URLSearchParams(url.hash.replace(/^#/, '?'))
+    HASH_KEYS_TO_STRIP.forEach((key) => hash.delete(key))
+    url.hash = Array.from(hash.keys()).length > 0 ? `#${hash.toString()}` : ''
+    return url.href
+  } catch (err) {
+    console.warn('[VerifyEmail] could not parse URL:', err)
+    return href
+  }
 }
 
 // Effect-time consumption check only ΓÇö the token itself was captured at import.
@@ -39,14 +53,7 @@ export function tokenStillInUrl() {
 
 export function stripConsumedTokenFromUrl() {
   try {
-    const url = new URL(window.location.href)
-    url.searchParams.delete('code')
-    url.searchParams.delete('error')
-    url.searchParams.delete('error_description')
-    const hash = new URLSearchParams(url.hash.replace(/^#/, '?'))
-    HASH_KEYS_TO_STRIP.forEach((key) => hash.delete(key))
-    const hashString = Array.from(hash.keys()).length > 0 ? `#${hash.toString()}` : ''
-    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${hashString}`)
+    window.history.replaceState(window.history.state, '', stripConsumedFromHref(window.location.href))
   } catch (err) {
     console.warn('[VerifyEmail] could not strip consumed token:', err)
   }
@@ -56,21 +63,69 @@ function VerifyEmail() {
   const navigate = useNavigate()
   const { isMobileOrTablet } = useBreakpoint()
   const [status, setStatus] = useState('loading')
+  const verdictRef = useRef(null)
+  const resultHeadingRef = useRef(null)
 
   useEffect(() => {
-    const { code, accessToken, type, error, errorDescription } = capturedVerifyEmailParams
+    if (status !== 'loading' && resultHeadingRef.current) {
+      resultHeadingRef.current.focus()
+    }
+  }, [status])
+
+  useEffect(() => {
+    const snapshot = capturedVerifyEmailParams
+    const liveUrl = window.location.href
+
+    // Which link does THIS visit judge? The snapshot is only evidence when it
+    // was captured for the current landing:
+    //  (1) The address bar itself carries auth params -> judge the live URL
+    //      (fresh navigation, hand-edited URL, or a not-yet-consumed boot URL).
+    //  (2) The live URL is the URL the snapshot was captured from -> same visit.
+    //  (3) The snapshot carries token evidence, the live URL is that URL minus
+    //      what supabase-js consumed at boot, and this credential has not been
+    //      judged yet this session -> same visit (boot-consumption race).
+    //  (4) Otherwise -> a NEW visit: re-derive the live (already stripped)
+    //      URL so an earlier "verified" is never replayed for a dead/empty link.
+    const liveParams = parseVerifyEmailParams(liveUrl)
+    const liveHasEvidence = liveParams.code !== null
+      || liveParams.accessToken !== null
+      || liveParams.error !== null
+      || liveParams.errorDescription !== null
+    const snapshotHasEvidence = snapshot.code !== null
+      || snapshot.accessToken !== null
+      || snapshot.error !== null
+      || snapshot.errorDescription !== null
+
+    let params
+    if (liveHasEvidence) {
+      params = liveParams
+    } else if (snapshot.url && liveUrl === snapshot.url && !judgedSnapshotUrls.has(snapshot.url)) {
+      params = snapshot
+    } else if (
+      snapshotHasEvidence &&
+      snapshot.url &&
+      stripConsumedFromHref(snapshot.url) === liveUrl &&
+      !judgedSnapshotUrls.has(snapshot.url)
+    ) {
+      params = snapshot
+    } else {
+      params = liveParams
+    }
+
+    const { code, accessToken, type, error, errorDescription } = params
 
     let timerId = null
     let subscription = null
 
     const settle = (verdict) => {
-      if (settledVerdict) {
-        // Re-litigating a settled page (duplicate exchange, late event,
+      if (verdictRef.current) {
+        // Re-litigating a settled visit (duplicate exchange, late event,
         // StrictMode remount) replays the original verdict instead.
-        if (settledVerdict !== verdict) setStatus(settledVerdict)
+        if (verdictRef.current !== verdict) setStatus(verdictRef.current)
         return
       }
-      settledVerdict = verdict
+      verdictRef.current = verdict
+      if (snapshot.url) judgedSnapshotUrls.add(snapshot.url)
       if (timerId) {
         clearTimeout(timerId)
         timerId = null
@@ -113,9 +168,10 @@ function VerifyEmail() {
       }
     }
 
-    // (3) Supabase itself rejected the token and told us why.
-    if (error) {
-      console.warn(`[VerifyEmail] auth token error${errorDescription ? `: ${errorDescription}` : ''}`)
+    // (3) Supabase itself rejected the token and told us why. Detected by
+    // PRESENCE, not truthiness: an empty `error=` param is still a failure.
+    if (error !== null || errorDescription !== null) {
+      console.warn(`[VerifyEmail] auth token error code=${error ?? ''}${errorDescription ? ` description=${errorDescription}` : ''}`)
       settle('expired')
       return cleanup
     }
@@ -180,14 +236,21 @@ function VerifyEmail() {
       if (timerId) clearTimeout(timerId)
       if (subscription && subscription.unsubscribe) subscription.unsubscribe()
     }
+    // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [])
 
   const cardContent = status === 'loading' ? (
     <Loading text="Verifying your email..." />
   ) : status === 'verified' ? (
-    <div style={{ textAlign: 'center', padding: '12px 0' }}>
+    <div role="status" aria-live="polite" style={{ textAlign: 'center', padding: '12px 0' }}>
       <MailCheck size={40} color={theme.tealDeep} strokeWidth={1.6} style={{ marginBottom: 10 }} />
-      <h2 style={{ margin: '0 0 6px 0', fontSize: 17, fontWeight: 900, color: theme.navy }}>Email verified</h2>
+      <h2
+        ref={resultHeadingRef}
+        tabIndex={-1}
+        style={{ margin: '0 0 6px 0', fontSize: 17, fontWeight: 900, color: theme.navy, outline: 'none' }}
+      >
+        Email verified
+      </h2>
       <p style={{ margin: '0 0 18px 0', fontSize: 13.5, color: theme.textLight, lineHeight: 1.55 }}>
         Your email has been confirmed. You can now continue to your account.
       </p>
@@ -196,16 +259,28 @@ function VerifyEmail() {
   ) : status === 'expired' ? (
     <div role="alert" aria-live="assertive" style={{ textAlign: 'center', padding: '12px 0' }}>
       <MailX size={40} color={theme.alert} strokeWidth={1.6} style={{ marginBottom: 10 }} />
-      <h2 style={{ margin: '0 0 6px 0', fontSize: 17, fontWeight: 900, color: theme.navy }}>Verification link expired</h2>
+      <h2
+        ref={resultHeadingRef}
+        tabIndex={-1}
+        style={{ margin: '0 0 6px 0', fontSize: 17, fontWeight: 900, color: theme.navy, outline: 'none' }}
+      >
+        Verification link expired
+      </h2>
       <p style={{ margin: '0 0 18px 0', fontSize: 13.5, color: theme.textLight, lineHeight: 1.55 }}>
         This link has expired or was already used. Please log in, or contact support if you believe this is an error.
       </p>
       <TealBtn variant="ghost" onClick={() => navigate('/login')}>Back to login</TealBtn>
     </div>
   ) : (
-    <div style={{ textAlign: 'center', padding: '12px 0' }}>
+    <div role="status" aria-live="polite" style={{ textAlign: 'center', padding: '12px 0' }}>
       <MailQuestionMark size={40} color={theme.textLight} strokeWidth={1.6} style={{ marginBottom: 10 }} />
-      <h2 style={{ margin: '0 0 6px 0', fontSize: 17, fontWeight: 900, color: theme.navy }}>Missing verification link</h2>
+      <h2
+        ref={resultHeadingRef}
+        tabIndex={-1}
+        style={{ margin: '0 0 6px 0', fontSize: 17, fontWeight: 900, color: theme.navy, outline: 'none' }}
+      >
+        Missing verification link
+      </h2>
       <p style={{ margin: '0 0 18px 0', fontSize: 13.5, color: theme.textLight, lineHeight: 1.55 }}>
         This page verifies your email using the link in your email. Open the verification link you received to continue.
       </p>
diff --git a/apps/carefind/src/modules/account/__tests__/VerifyEmail.test.jsx b/apps/carefind/src/modules/account/__tests__/VerifyEmail.test.jsx
index f220dd5..902b3e4 100644
--- a/apps/carefind/src/modules/account/__tests__/VerifyEmail.test.jsx
+++ b/apps/carefind/src/modules/account/__tests__/VerifyEmail.test.jsx
@@ -2,7 +2,10 @@ import React from 'react'
 import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
 import { render, screen, fireEvent, act } from '@testing-library/react'
 import { MemoryRouter, Routes, Route } from 'react-router-dom'
-import VerifyEmail, { SETTLE_TIMEOUT_MS, __resetVerifyEmailForTests } from '../VerifyEmail.jsx'
+import { readFileSync } from 'node:fs'
+import { fileURLToPath } from 'node:url'
+import { dirname, join } from 'node:path'
+import { SETTLE_TIMEOUT_MS } from '../VerifyEmail.jsx'
 
 // ΓöÇΓöÇ Supabase client mock ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
 const mocks = vi.hoisted(() => {
@@ -30,18 +33,24 @@ vi.mock('../../../config/supabaseClient', () => ({ supabase: mocks.supabase }))
 // `captureState` is the single object exposed as `capturedVerifyEmailParams`,
 // so the page reads its properties at effect time and per-test mutations are
 // visible through the live binding. `setCapture` rewrites it in beforeEach.
+// The real `parseVerifyEmailParams` is kept (for re-derivation of the live
+// URL on a new visit); only the snapshot binding is stubbed.
 const captureState = vi.hoisted(() => ({
   code: null,
   accessToken: null,
   type: null,
   error: null,
   errorDescription: null,
+  url: null,
 }))
 
-vi.mock('../verifyEmailParams', () => ({
-  parseVerifyEmailParams: () => captureState,
-  capturedVerifyEmailParams: captureState,
-}))
+vi.mock('../verifyEmailParams', async (importOriginal) => {
+  const actual = await importOriginal()
+  return {
+    ...actual,
+    capturedVerifyEmailParams: captureState,
+  }
+})
 
 function setCapture(overrides = {}) {
   Object.assign(captureState, {
@@ -50,6 +59,7 @@ function setCapture(overrides = {}) {
     type: null,
     error: null,
     errorDescription: null,
+    url: window.location.href,
     ...overrides,
   })
 }
@@ -58,11 +68,17 @@ function emit(event, session) {
   mocks.listeners.forEach((cb) => cb(event, session))
 }
 
+// Verdict/visit adjudication lives in the page MODULE, not in the component,
+// so each test gets a fresh module (a fresh SPA page-load) via resetModules;
+// a single test can also render twice WITHOUT resetting to model a true
+// second same-session visit.
+let VerifyEmailPage = null
+
 function renderPage() {
   return render(
     <MemoryRouter initialEntries={['/verify-email']}>
       <Routes>
-        <Route path="/verify-email" element={<VerifyEmail />} />
+        <Route path="/verify-email" element={<VerifyEmailPage.default />} />
         <Route path="/onboarding" element={<div>ONBOARDING</div>} />
         <Route path="/login" element={<div>LOGIN</div>} />
       </Routes>
@@ -71,18 +87,24 @@ function renderPage() {
 }
 
 describe('VerifyEmail', () => {
-  beforeEach(() => {
+  beforeEach(async () => {
     vi.clearAllMocks()
     mocks.listeners.clear()
-    __resetVerifyEmailForTests()
     setCapture()
     window.history.replaceState(null, '', '/verify-email')
+    vi.resetModules()
+    const pageModule = await import('../VerifyEmail.jsx')
+    VerifyEmailPage = pageModule
   })
 
   afterEach(() => {
     vi.useRealTimers()
   })
 
+  it('requires the page module to load (module resolved)', () => {
+    expect(VerifyEmailPage.default).toBeTypeOf('function')
+  })
+
   it('PKCE success settles verified from the exchange result, never a re-getSession', async () => {
     mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
     setCapture({ code: 'abc123' })
@@ -200,9 +222,15 @@ describe('VerifyEmail', () => {
   })
 
   it('settles verified from an arriving session event even when the hash was already cleared at boot', async () => {
-    // Capture holds the token while the URL no longer does (supabase stripped it).
+    // The capture module snapshotted the token-bearing landing URL BEFORE
+    // createClient() consumed it; by effect time supabase-js has cleared the
+    // hash. This is the same visit, so the snapshot stays the evidence.
     mocks.supabase.auth.getSession.mockReturnValue(new Promise(() => {}))
-    setCapture({ accessToken: 'tok', type: 'signup' })
+    setCapture({
+      accessToken: 'tok',
+      type: 'signup',
+      url: `${window.location.origin}/verify-email#access_token=tok&type=signup`,
+    })
     window.history.replaceState(null, '', '/verify-email')
 
     renderPage()
@@ -401,26 +429,6 @@ describe('VerifyEmail', () => {
     unmount()
   })
 
-  it('post-verified: a fresh tokenless page renders info, not expired', async () => {
-    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
-    setCapture({ code: 'abc123' })
-    window.history.replaceState(null, '', '/verify-email?code=abc123')
-
-    const { unmount } = renderPage()
-    await screen.findByText('Email verified')
-    unmount()
-
-    // Fresh page load: capture is empty again and the URL has no token.
-    __resetVerifyEmailForTests()
-    setCapture()
-    window.history.replaceState(null, '', '/verify-email')
-
-    renderPage()
-
-    expect(await screen.findByText('Missing verification link')).toBeInTheDocument()
-    expect(screen.queryByRole('alert')).toBeNull()
-  })
-
   it('StrictMode double-invoke never flips a settled verified to expired', async () => {
     let resolveFirst
     let resolveSecond
@@ -434,7 +442,7 @@ describe('VerifyEmail', () => {
       <React.StrictMode>
         <MemoryRouter initialEntries={['/verify-email']}>
           <Routes>
-            <Route path="/verify-email" element={<VerifyEmail />} />
+            <Route path="/verify-email" element={<VerifyEmailPage.default />} />
           </Routes>
         </MemoryRouter>
       </React.StrictMode>
@@ -450,4 +458,83 @@ describe('VerifyEmail', () => {
     expect(screen.getByText('Email verified')).toBeInTheDocument()
     expect(screen.queryByText('Verification link expired')).toBeNull()
   })
+
+  // ΓöÇΓöÇ Iteration-4: visit boundary (module cached, no injected reset) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
+
+  it('a second same-session visit with a dead code shows expired, never a replay of verified', async () => {
+    mocks.supabase.auth.exchangeCodeForSession
+      .mockResolvedValueOnce({ data: { session: { user: { id: 'u1' } } }, error: null })
+      .mockRejectedValueOnce(new Error('code already used'))
+    setCapture({ code: 'abc123' })
+    window.history.replaceState(null, '', '/verify-email?code=abc123')
+
+    const { unmount } = renderPage()
+    await screen.findByText('Email verified')
+    unmount()
+
+    // Same SPA session: the cached module still holds the FIRST visit's
+    // snapshot, but a fresh land on a used/dead link must re-derive and judge
+    // THIS URL ΓÇö expired ΓÇö not replay the earlier verified.
+    window.history.replaceState(null, '', '/verify-email?code=dead')
+    renderPage()
+
+    expect(await screen.findByRole('alert')).toHaveTextContent('Verification link expired')
+    expect(screen.queryByText('Email verified')).toBeNull()
+  })
+
+  it('a second same-session visit with no token shows info, never a replay of verified', async () => {
+    mocks.supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
+    setCapture({ code: 'abc123' })
+    window.history.replaceState(null, '', '/verify-email?code=abc123')
+
+    const { unmount } = renderPage()
+    await screen.findByText('Email verified')
+    unmount()
+
+    // The verified visit stripped the consumed code, so the live URL is now
+    // bare. A second same-session visit must re-derive the tokenless URL and
+    // show info ΓÇö the cached snapshot is NOT replayed.
+    renderPage()
+
+    expect(await screen.findByText('Missing verification link')).toBeInTheDocument()
+    expect(screen.queryByRole('alert')).toBeNull()
+  })
+
+  // ΓöÇΓöÇ Iteration-4: error params from the query + presence-based detection ΓöÇΓöÇΓöÇ
+
+  it('query error params settle expired (supabase PKCE failure shape)', async () => {
+    setCapture({ code: 'abc' })
+    window.history.replaceState(null, '', '/verify-email?code=abc&error=access_denied&error_description=The%20link%20you%20used%20is%20invalid%20or%20has%20expired.')
+
+    renderPage()
+
+    const alert = await screen.findByRole('alert')
+    expect(alert).toHaveTextContent('Verification link expired')
+    expect(mocks.supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled()
+    expect(mocks.supabase.auth.getSession).not.toHaveBeenCalled()
+  })
+
+  it('an empty-string error param still settles expired (presence-based)', async () => {
+    window.history.replaceState(null, '', '/verify-email#error=')
+
+    renderPage()
+
+    expect(await screen.findByRole('alert')).toHaveTextContent('Verification link expired')
+  })
+
+  // ΓöÇΓöÇ Iteration-4: capture hoisted to the app entry (source order) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
+
+  it('main.jsx imports the capture module before AuthProvider', () => {
+    // `join`/`dirname` instead of `new URL('../../../main.jsx', import.meta.url)`:
+    // Vite's import-analysis transform rewrites that `new URL(..., import.meta.url)`
+    // pattern into an http:// URL, so fileURLToPath would reject it.
+    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../main.jsx'), 'utf8')
+    const captureImport = "import './modules/account/verifyEmailParams'"
+    const authProviderImport = "import { AuthProvider } from './providers/AuthContext.jsx'"
+    const captureIdx = src.indexOf(captureImport)
+    const authIdx = src.indexOf(authProviderImport)
+    expect(captureIdx).toBeGreaterThan(-1)
+    expect(authIdx).toBeGreaterThan(-1)
+    expect(captureIdx).toBeLessThan(authIdx)
+  })
 })
\ No newline at end of file
diff --git a/apps/carefind/src/modules/account/__tests__/verifyEmailParams.test.js b/apps/carefind/src/modules/account/__tests__/verifyEmailParams.test.js
index 0c2a20b..0516c8e 100644
--- a/apps/carefind/src/modules/account/__tests__/verifyEmailParams.test.js
+++ b/apps/carefind/src/modules/account/__tests__/verifyEmailParams.test.js
@@ -1,4 +1,4 @@
-import { describe, it, expect } from 'vitest'
+import { describe, it, expect, vi } from 'vitest'
 import { parseVerifyEmailParams } from '../verifyEmailParams'
 
 describe('parseVerifyEmailParams', () => {
@@ -20,7 +20,7 @@ describe('parseVerifyEmailParams', () => {
 
   it('extracts error and error_description from the hash fragment', () => {
     const p = parseVerifyEmailParams(
-      'http://localhost:3000/verify-email#error=access_denied&error_description=The%20link%20you%20used%20is%20invalid%20or%20has%20expired'
+      'http://localhost:3000/verify-email#error=access_denied&error_description=The%20link%20you%20used%20is%20invalid%20or%20has%20expired.'
     )
     expect(p.error).toBe('access_denied')
     expect(p.errorDescription).toBe('The link you used is invalid or has expired.')
@@ -52,4 +52,48 @@ describe('parseVerifyEmailParams', () => {
     expect(p.accessToken).toBeNull()
     expect(p.type).toBeNull()
   })
+
+  it('query takes precedence over hash for the same param (mirrors parseParametersFromURL)', () => {
+    const p = parseVerifyEmailParams(
+      'http://localhost:3000/verify-email?code=pkce&error=qerr&error_description=qdesc#access_token=tok&type=signup&error=herr&error_description=hdesc'
+    )
+    expect(p.code).toBe('pkce')
+    expect(p.accessToken).toBe('tok')
+    expect(p.type).toBe('signup')
+    expect(p.error).toBe('qerr')
+    expect(p.errorDescription).toBe('qdesc')
+  })
+
+  it('preserves an empty-string error param by presence (never collapses to null)', () => {
+    const p = parseVerifyEmailParams('http://localhost:3000/verify-email?error=&error_description=')
+    expect(p.error).toBe('')
+    expect(p.errorDescription).toBe('')
+  })
+
+  it('preserves an empty-string error in the hash fragment', () => {
+    const p = parseVerifyEmailParams('http://localhost:3000/verify-email#error=')
+    expect(p.error).toBe('')
+    expect(p.errorDescription).toBeNull()
+  })
+
+  it('records the href it parsed on the snapshot', () => {
+    const p = parseVerifyEmailParams('http://localhost:3000/verify-email?code=abc')
+    expect(p.url).toBe('http://localhost:3000/verify-email?code=abc')
+  })
+
+  it('captures the token-bearing URL at import time when window.location carries it', async () => {
+    vi.resetModules()
+    window.history.replaceState(null, '', '/verify-email?code=c123#access_token=tok&type=signup&error_description=bad')
+    try {
+      const mod = await import('../verifyEmailParams')
+      expect(mod.capturedVerifyEmailParams.code).toBe('c123')
+      expect(mod.capturedVerifyEmailParams.accessToken).toBe('tok')
+      expect(mod.capturedVerifyEmailParams.type).toBe('signup')
+      expect(mod.capturedVerifyEmailParams.errorDescription).toBe('bad')
+      expect(mod.capturedVerifyEmailParams.url).toContain('/verify-email?code=c123#access_token=tok&type=signup&error_description=bad')
+    } finally {
+      window.history.replaceState(null, '', '/verify-email')
+      vi.resetModules()
+    }
+  })
 })
\ No newline at end of file
diff --git a/apps/carefind/src/modules/account/verifyEmailParams.js b/apps/carefind/src/modules/account/verifyEmailParams.js
index 615084d..a11841a 100644
--- a/apps/carefind/src/modules/account/verifyEmailParams.js
+++ b/apps/carefind/src/modules/account/verifyEmailParams.js
@@ -1,12 +1,13 @@
 // Import-time capture of this page's verification-token data.
 //
-// Must be imported BEFORE the supabase client (see VerifyEmail.jsx): on a
-// token-bearing landing URL, supabase-js auto-consumes the token from the
-// address bar during `createClient()` at app boot (implicit flow clears the
-// hash; same-browser PKCE strips the `?code=`). By the time any effect runs,
-// the evidence this page needs to judge the link is already gone. Capturing
-// here, synchronously, at module evaluation, is the only place it still
-// exists.
+// Must be imported BEFORE the supabase client: `main.jsx` pulls this module in
+// first as a side-effect import (before `providers/AuthContext.jsx` and the
+// eagerly-constructed `createClient()`), because on a token-bearing landing
+// URL supabase-js auto-consumes the token during `createClient()` at app boot
+// (implicit flow clears the hash; same-browser PKCE strips the `?code=`). By
+// the time any effect runs, the evidence this page needs to judge the link is
+// already gone. Capturing here, synchronously, at module evaluation, is the
+// only place it still exists.
 
 export function parseVerifyEmailParams(href) {
   const params = {
@@ -15,15 +16,20 @@ export function parseVerifyEmailParams(href) {
     type: null,
     error: null,
     errorDescription: null,
+    url: href,
   }
   try {
     const url = new URL(href)
-    params.code = url.searchParams.get('code')
     const hash = new URLSearchParams(url.hash.replace(/^#/, '?'))
-    params.accessToken = hash.get('access_token')
-    params.type = hash.get('type')
-    params.error = hash.get('error')
-    params.errorDescription = hash.get('error_description')
+    // Mirror supabase's parseParametersFromURL: read query AND hash, with the
+    // query winning. Presence-preserving too: an empty `?error=` still parses
+    // to '' (never null), so a bare error param is never dismissed.
+    const read = (key) => url.searchParams.get(key) ?? hash.get(key)
+    params.code = read('code')
+    params.accessToken = read('access_token')
+    params.type = read('type')
+    params.error = read('error')
+    params.errorDescription = read('error_description')
   } catch (err) {
     console.warn('[VerifyEmail] could not parse verify-email params:', err)
   }


---

## CONTEXT (iteration 4 review)

- Spec: _bmad-output/implementation-artifacts/spec-auth-email-links-work.md
- baseline_commit: de4ea9681d623a25ce91ff4e517b1ee8cc79cfa1 (ancestor of HEAD)
- HEAD at review time: 69a58f0 (story core plus earlier feature landed in ec66750)
- Working tree delta below = iteration-4 changes on top of HEAD (the 4 story files).
- Iteration-4 root requirement (Spec Change Log, non-frozen, review_loop_iteration 4): (1) capture of URL auth params HOISTED to the app entry -- a side-effect import of the capture module at the very top of apps/carefind/src/main.jsx, before every other local import, so ESM order guarantees snapshot before createClient() consumes the URL (eager client at boot); VerifyEmail.jsx consumes the same binding. (2) VISIT-SCOPED verdict guard: first-verdict-wins applies to ONE page visit, keyed to the URL the snapshot was captured from; when the effect observes a current URL differing from the snapshot URL, re-derive params from the live URL and re-open the verdict. No production reset hook. (3) error/error_description detected by PRESENCE (null check), parsed from both query and hash with query precedence (mirroring supabase parseParametersFromURL). (4) A11y: result heading receives focus on verdict; assertive/polite live region besides role=alert. (5) Tests: real verifyEmailParams module evaluated at import with token-bearing window.location; main.jsx import-order assertion; visit-boundary (dead link second visit -> expired, no replay); ?code=...&error= query -> expired; empty-string #error= -> expired.


Do not invoke any skill. Return only the review result.
