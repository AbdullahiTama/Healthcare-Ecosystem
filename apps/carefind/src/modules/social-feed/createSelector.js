// The "what do you want to create?" selector, as a seam.
//
// The rule this module exists to enforce: **tapping create always shows the
// selector first.** It is not only a router — it is how someone discovers that
// CareFind does questions, reviews, voice cards, articles, stories, series,
// product listings and live shows at all. A tap that silently lands in the
// Text Post composer teaches the user the platform only does text posts.
//
// It regressed because BottomNav treated the selector as a *fallback*: it
// looked for `#post-composer` in the DOM, scrolled/focused it when found, and
// only called `onCompose()` when it was missing. On the feed the composer is
// always in the DOM, so the fallback never fired and the selector stopped
// appearing — and every other page rendered `<BottomNav />` with no
// `onCompose` at all, so their create button just navigated to /feed. The
// "sometimes it shows" phase was those two paths disagreeing.
//
// Compose is reached from three places (BottomNav on mobile, LeftSidebar on
// desktop, and any page's AppShell), and only the feed can open the modal
// itself. So the cross-page signal is a query parameter: everyone else
// navigates to `/feed?create=1`, the feed opens the selector on arrival and
// strips the parameter so a refresh or a Back tap does not re-open it.

export const CREATE_PARAM = 'create'
export const FEED_PATH = '/feed'

// Where a create tap should navigate when the current screen cannot open the
// selector itself.
export const CREATE_PATH = `${FEED_PATH}?${CREATE_PARAM}=1`

// Does this location's query string ask the feed to open the selector?
// Accepts a `?a=b` string, a URLSearchParams, or a react-router location.
export function shouldOpenCreateSelector(search) {
  if (!search) return false
  const params = typeof search === 'string'
    ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    : (search instanceof URLSearchParams ? search : new URLSearchParams(search.search || ''))
  return params.get(CREATE_PARAM) === '1'
}

// The same query string with the create flag removed, so the feed can replace
// the URL once the selector is open. Returns '' when nothing is left, which is
// what react-router wants for "no query string".
export function withoutCreateParam(search) {
  const raw = typeof search === 'string' ? search : (search?.search || '')
  const params = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw)
  params.delete(CREATE_PARAM)
  const rest = params.toString()
  return rest ? `?${rest}` : ''
}

// Telemetry for the create flow (issue #2, solution step 5).
//
// Two separate events, deliberately. An earlier version logged a single event
// with `opened: true` hardcoded at both tap sites — including the branch that
// only NAVIGATES, where the selector has not opened yet and might not. That
// made the failure path unreachable, so the instrumentation added to catch a
// recurrence of this exact bug could never have caught it.
//
// Now the tap records what it DID (`route`), and the feed records the selector
// actually rendering. A tap with `route: 'navigate'` that is not followed by a
// `[create] selector rendered` is the regression signal, and it is visible.
//
// `sink` is injected so tests can assert without touching the console.

// A user tapped create. `route` is 'in-place' (this screen opens the selector
// itself) or 'navigate' (this screen sends them to the feed to open it).
export function logCreateTap({ source, route, path }, sink = console) {
  const detail = { source, route, path }
  sink.info?.('[create] tap', detail)
  return detail
}

// The selector is on screen. This is the event that proves the tap worked.
export function logCreateSelectorRendered({ source }, sink = console) {
  const detail = { source }
  sink.info?.('[create] selector rendered', detail)
  return detail
}

// The selector was asked for and could not be shown. Nothing in the current
// code can reach this — the tap handlers have no failure branch left — but it
// is the shape a future regression would take, and it must be loud rather
// than silent.
export function logCreateSelectorFailed({ source, reason }, sink = console) {
  const detail = { source, reason }
  sink.warn?.('[create] selector did NOT open', detail)
  return detail
}
