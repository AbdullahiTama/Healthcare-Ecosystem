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

// Telemetry for the create tap (issue #2, solution step 5): record every tap
// and whether the selector actually rendered, so a future regression of this
// exact shape is visible in the logs instead of only in user reports.
//
// `sink` is injected so tests can assert without touching the console; in the
// app it is the console, which is what the existing feed instrumentation uses.
export function logCreateTap({ source, opened, path }, sink = console) {
  const detail = { source, opened, path }
  if (opened) {
    sink.info?.('[create] selector opened', detail)
  } else {
    // Not a warning we can recover from automatically, but it must never be
    // silent: this is precisely the failure the issue describes.
    sink.warn?.('[create] selector did NOT open', detail)
  }
  return detail
}
