// Edit the address bar's query string WITHOUT a router navigation.
//
// main.jsx keys <Routes> on location.key, so ANY router navigation — a
// `replace` included, even one that produces an identical URL — remounts the
// page and throws away its state. Pages that mirror state into the URL
// (?tab=, ?q=) or consume a landing param (?create=1, ?tab=video) therefore
// must not use setSearchParams: it remounted the feed straight after it had
// opened the create selector, landed ?tab=video on the wrong tab, and sent
// bare /search into an endless remount loop.
//
// history.replaceState alone changes only the URL. Passing the current
// history.state through keeps react-router's own entry (key / idx / usr)
// intact, which `{}` used to wipe. This reads window.location rather than the
// router's searchParams, so the router's copy is left as it was at mount;
// nothing should read it after that, and real navigations and Back/Forward
// give the router a fresh location from the address bar.

// `mutate` receives a URLSearchParams to edit in place.
export function replaceUrlParams(mutate) {
  const params = new URLSearchParams(window.location.search)
  mutate(params)
  const qs = params.toString()
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
}

export function dropUrlParam(name) {
  replaceUrlParams((params) => params.delete(name))
}
