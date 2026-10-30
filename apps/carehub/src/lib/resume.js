// Resume, don't reload.
//
// Staff leave CareHub open at the counter for hours. When they come back the
// screen should be usable at once, with what it showed before, and bring
// itself up to date in the background: renew the session first, then refetch
// what each open screen shows. Nothing is reloaded and nothing in progress (a
// cart, a held sale, a half-filled form) is touched.
//
// Two plain pieces, so both are testable without React:
//   watchForResume     — notices that the user is back
//   createRefreshCycle — what "bring it up to date" means, and its status
// providers/RefreshProvider.jsx wires them into the dashboard shell.

// Away for less than this and nothing on screen is worth refetching.
export const RESUME_AFTER_MS = 5 * 60 * 1000

// Calls onResume(reason) when the user is plausibly back after a while:
//   'returned'    — the tab became visible after being hidden >= awayMs
//   'woke'        — the device slept with the tab visible (laptop lid, some
//                   lock screens): no visibility event fires, the timers just
//                   stop, so a tick arriving >= awayMs late gives it away
//   'reconnected' — the browser regained its network connection
// Returns a function that stops watching.
export function watchForResume(onResume, {
  awayMs = RESUME_AFTER_MS,
  tickMs = 30 * 1000,
  doc = document,
  win = window,
  now = () => Date.now(),
} = {}) {
  let hiddenAt = doc.visibilityState === 'hidden' ? now() : null
  let lastTick = now()

  function onVisibility() {
    if (doc.visibilityState === 'hidden') {
      hiddenAt = now()
      return
    }
    const away = hiddenAt === null ? 0 : now() - hiddenAt
    hiddenAt = null
    lastTick = now()
    if (away >= awayMs) onResume('returned')
  }

  function onOnline() {
    onResume('reconnected')
  }

  const timer = win.setInterval(() => {
    const t = now()
    const gap = t - lastTick
    lastTick = t
    // Hidden tabs are throttled to a tick a minute or less; the return to
    // visible is handled above, so only a visible tab's gap means sleep.
    if (doc.visibilityState === 'visible' && gap >= awayMs) onResume('woke')
  }, tickMs)

  doc.addEventListener('visibilitychange', onVisibility)
  win.addEventListener('online', onOnline)
  return () => {
    win.clearInterval(timer)
    doc.removeEventListener('visibilitychange', onVisibility)
    win.removeEventListener('online', onOnline)
  }
}

// Coming back usually fires more than one signal (visible, then online a few
// seconds later as Wi-Fi rejoins). A refresh that succeeded this recently
// covers them all.
const DEDUPE_MS = 15 * 1000

// Status, for the indicator:
//   { state: 'idle' }                 nothing to say
//   { state: 'updating' }             renewing the session and refetching
//   { state: 'updated', at }          done; the screen is current as of `at`
//   { state: 'failed', error }        could not reach CareHub; the screen still
//                                     shows what it had, and Retry is offered
//   { state: 'offline' }              no connection; the offline banner already
//                                     says so, and 'reconnected' retries
export function createRefreshCycle({
  renewSession,
  isOnline = () => navigator.onLine,
  now = () => Date.now(),
}) {
  const refreshers = new Set()
  const listeners = new Set()
  let status = { state: 'idle' }
  let running = null
  let signalledWhileRunning = false
  let lastSuccessAt = 0

  function setStatus(next) {
    status = next
    listeners.forEach((listener) => listener(status))
  }

  async function runOnce() {
    if (!isOnline()) {
      setStatus({ state: 'offline' })
      return false
    }
    setStatus({ state: 'updating' })

    // Session first, so the refetches below don't all hit an expired token at
    // once. Forced, because the device clock cannot be trusted to say whether
    // the token is still good (lib/sessionFetch.js).
    try {
      await renewSession()
    } catch (e) {
      if (e?.ended) {
        // The session is over; App.jsx is already sending the user to sign
        // in, so there is nothing to refresh and nothing to report here.
        setStatus({ state: 'idle' })
        return true
      }
      console.warn('[resume] could not renew the session', e?.message || e)
      setStatus({ state: 'failed', error: e })
      return false
    }

    const results = await Promise.allSettled([...refreshers].map((refresh) => refresh()))
    const failed = results.find((r) => r.status === 'rejected')
    if (failed) {
      console.warn('[resume] a screen could not refresh', failed.reason?.message || failed.reason)
      setStatus({ state: 'failed', error: failed.reason })
      return false
    }
    lastSuccessAt = now()
    setStatus({ state: 'updated', at: lastSuccessAt })
    return true
  }

  // force: run even if a refresh just succeeded (the Retry button).
  function refresh({ force = false } = {}) {
    if (running) {
      signalledWhileRunning = true
      return running
    }
    if (!force && now() - lastSuccessAt < DEDUPE_MS) return Promise.resolve(true)
    running = runOnce().then((ok) => {
      running = null
      const retry = signalledWhileRunning && !ok
      signalledWhileRunning = false
      // A signal that arrived mid-run (typically 'reconnected' after a run
      // that started before Wi-Fi rejoined) gets one more attempt if this
      // run failed; a successful run already covered it.
      return retry ? refresh({ force: true }) : ok
    })
    return running
  }

  return {
    refresh,
    // Adds a screen's refetch; returns the function that removes it. A
    // refresher should keep its current data on failure and throw, so the
    // indicator can say the screen is out of date.
    register(refresher) {
      refreshers.add(refresher)
      return () => { refreshers.delete(refresher) }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getStatus: () => status,
    // Back to idle: after "Updated" has shown long enough, or when the user
    // dismisses a failure (the screen keeps its earlier data either way).
    settle() {
      if (status.state === 'updated' || status.state === 'failed') setStatus({ state: 'idle' })
    },
  }
}
