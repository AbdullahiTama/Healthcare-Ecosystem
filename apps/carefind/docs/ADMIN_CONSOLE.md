# CareFind admin console

The admin lives at `/admin/*`. Design: `docs/superpowers/specs/2026-10-05-carefind-admin-console-design.md`.

## How it is put together

- `src/main.jsx` renders `AdminApp` for any path where `isAdminPath()` is true. The console has its own
  un-keyed router, so its sidebar, filters and open record survive navigation. Pages under the public
  router remount on every navigation; the console does not.
- `AdminGate` runs the server `verify` call before anything renders and provides `useAdmin()`
  (`adminUser`, `permissions`, `signOut`). It is for experience only: the admin API and the database
  policies decide what an admin may actually do.
- `navigation.js` is the single list of screens. The sidebar, routes, command palette and role editor
  all read it.
- `AdminFeedbackProvider` owns the one toast, the one confirm dialog and the activity trail:
  `useAdminToast()`, `useAdminConfirm()`, `useAdminActivity()`, `useAuditLog()`.
- `data/queues.js` owns the work queues and the pending counts shown in the sidebar and on Home.
- `legacy/LegacyScreens.jsx` renders screens that have not been rebuilt yet. It shrinks as screens
  move out and is deleted when the last one has.

## Adding or rebuilding a screen

1. Add (or keep) its entry in `SCREENS` in `navigation.js`. Reuse the existing permission key if the
   screen already existed. A brand-new key must be `explicit: true`, which denies it to every role
   except `super_admin` until it is granted.
2. Create `screens/<group>/<Name>Screen.jsx`. It takes no props. It fetches its own data with TanStack
   Query under a key starting `['admin', …]`, and renders loading, error-with-retry and empty states.
   Query functions must not swallow errors.
3. Keep search text, filters and the open record id in the URL with `useUrlFilters(DEFAULTS)`
   (`DEFAULTS` must be a module-level constant).
4. Build the list with the shared `DataTable`. Make the first column `primaryCell(...)` so a record
   can be opened from the keyboard. Open the record in `DetailDrawer`; use a full page only for
   records with a lot of related data (businesses, users).
5. Register the component in `SCREEN_COMPONENTS` in `AdminApp.jsx`.
6. If you are replacing a legacy tab, delete its `{tab === '…'}` line, handlers and state from
   `LegacyScreens.jsx` and delete the old tab file, in the same commit.
7. After any action that changes data, call `queryClient.invalidateQueries({ queryKey: ['admin'] })`.
8. Destructive actions go through `useAdminConfirm()` with a `consequence` sentence.

## Checks before committing a screen

- `npm test -- src/modules/admin`
- `node_modules/.bin/vite build` (not `npx vite build`)
- At 375, 768 and 1280px: `document.documentElement.scrollWidth === window.innerWidth`, with the
  drawer open and closed.
- Every component used in JSX is imported. CareFind's ESLint has no React plugin and will not tell you.

## Interim screens

"Business hub" and "Directory manager" in the Directory group are the old standalone pages mounted
unchanged. They are merged with "Businesses" into one screen in Plan 2.
