import { Routes, useLocation } from 'react-router-dom'

// One URL, two surfaces.
//
// A post has a single canonical address (/post/:id). How it renders depends
// on how the reader arrived:
//
//   * Tapped from inside the feed — the navigation carries the feed's own
//     location in `state.background`. The first <Routes> is told to match
//     that remembered location, so the page underneath (the feed, with its
//     scroll position, its loaded list and its realtime subscriptions) stays
//     mounted untouched, and the second <Routes> renders the overlay on top.
//
//   * Cold load / refresh / a shared link — no `background` in history state,
//     so only the first <Routes> renders, and it matches /post/:id itself:
//     the reader gets the full standalone page.
//
// Two things worth knowing before debugging anything here:
//
//   1. `<Routes location={background}>` overrides LocationContext for its
//      WHOLE subtree. A component rendered behind an overlay therefore sees
//      the background location from `useLocation()` — the feed behind an open
//      post reads `/feed`, never `/post/:id`. That is why the overlay cannot
//      be hosted from inside the page underneath by sniffing the location,
//      and why it gets its own route element instead.
//   2. The overlay <Routes> deliberately has NO `location` prop, so it
//      matches the real URL. Closing the overlay is `navigate(-1)`: popping
//      the entry drops `background` with it and the page underneath is simply
//      revealed again.
//
// `modalRoutes` is a <Route> (or fragment of them) rendered only in the
// overlay pass; `children` is the app's ordinary route table.
export default function BackgroundRoutes({ children, modalRoutes = null }) {
  const location = useLocation()
  const background = location.state?.background

  return (
    <>
      <Routes location={background || location}>{children}</Routes>
      {background ? <Routes>{modalRoutes}</Routes> : null}
    </>
  )
}
