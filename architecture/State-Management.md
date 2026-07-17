# State Management — Care Ecosystem

Neither product uses a global state library (no Redux, Zustand, Jotai, etc.). Both rely on React Context for exactly one concern (auth) and local `useState` for everything else, refetched on every screen mount.

## CareHub

- **`AuthContext`** (`App.jsx`) — the only context provider in the app. Holds `{ auth, login, logout, isAdmin }`, persisted to `localStorage['carehub_auth']` as a raw JSON blob (business + staff object + role). `BusinessDashboard.jsx` reads it once and threads the derived `role`/`perms`/`products` down as `pageProps` to every route — the closest thing CareHub has to a real state-management layer.
- **Everything else is local `useState` per page**, fetched fresh via `useEffect` on mount. No caching, no request deduplication, no optimistic updates — navigating away and back always re-fetches.
- **One bypass of the context pattern:** `NotificationBell.jsx` reads the logged-in user via a private `readAuth()` → direct `localStorage.getItem('carehub_auth')` parse, rather than `useAuth()`. This is the one place in the component tree where auth state can be read two different ways and could theoretically drift (see `Dependency-Map.md` §6 for the full coupling analysis).
- **`useToast`** (`components/ui/index.jsx`) is a local convenience hook, not a context — every one of its 19 call sites creates an independent toast state. A toast fired inside a nested modal only reaches the screen if that exact modal also renders its own `<Toast/>`. Full detail and the recommended `ToastProvider` fix are in `Component-Catalog.md`.
- **The one genuinely well-built piece of state persistence in either product:** the offline-sales queue (`lib/supabase.js`'s `cacheData`/`getCached`/`queueOfflineSale`/`getOfflineQueue`/`syncOfflineSales`), a real `localStorage`-backed implementation of the "Offline First" product principle, with graceful degradation when a fetch fails.

## CareFind

- **`AuthContext`** (`lib/AuthContext.jsx`) — wraps real Supabase Auth session state (`user`, `loading`, `signUp`, `signIn`, `signOut`), correctly kept in sync via `onAuthStateChange`. Structurally the same "one context for auth, nothing else" pattern as CareHub, but built on a real session rather than a client-trusted cache.
- **`lib/activeIdentity.js`** is CareFind's second meaningful piece of client state — a `localStorage`-backed "which identity am I posting as" switcher (personal / claimed business / claimed staff position), propagated via a custom `window.dispatchEvent(new Event('identity-changed'))` rather than React context. Any component that needs to react to an identity change must remember to subscribe to this event manually — a hand-rolled pub/sub mechanism doing a job React Context or a small state library would do more discoverably.
- **Every other screen** (Feed, Search, Profile, Wallet, AdminPanel, ...) is local `useState` per component, fetched on mount — the same pattern as CareHub, at roughly 4x the number of screens.
- **`AdminPanel.jsx`'s `loadAll()`** fans a single mount-time load out to ~12 parallel Supabase queries populating ~12 separate `useState` slices — functionally fine, but a single 1,868-line component owning that much simultaneous state is a maintainability concern in its own right (see `Technical-Debt.md`).

## Ecosystem-level observation

Both products independently arrived at the same shape: one auth context, no other global state, aggressive re-fetching over caching. Neither team appears to have looked at the other's approach — the auth contexts have different names, different shapes, and (per `Authentication.md`) wildly different levels of correctness, despite solving the identical problem. Nothing in either app's state layer is aware the other product exists; the only place ecosystem-level "state" is shared at all is through the database tables documented in `Shared-Services.md`, not through any client-side mechanism.

## What would help, ecosystem-wide

1. CareHub: promote `useToast`/`Toast` to a real context (`Component-Catalog.md`'s top recommendation).
2. CareHub: fix `NotificationBell.jsx`'s auth-context bypass.
3. Either product: introduce a thin query/cache layer (even a minimal one) to stop every navigation from re-fetching data that hasn't changed — neither app has this today, and it's the most consistent gap between the two.
4. CareFind: consider whether `lib/activeIdentity.js`'s custom-event pattern should become a proper context now that it has real cross-component consumers, before more screens start depending on remembering to subscribe to `'identity-changed'` manually.
