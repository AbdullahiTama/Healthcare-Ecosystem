# Routing Layer — Care Ecosystem

Complete documentation of both products' routers, read directly from `apps/carehub/src/App.jsx`, `apps/carehub/src/pages/dashboard/BusinessDashboard.jsx`, and `apps/carefind/carefind-main/src/main.jsx`. This supersedes the prior version of this document, reorganized around Public Routes / Protected Routes / Role Requirements / Authentication Flow / Navigation / Dependencies as requested; all previously-verified per-route detail is preserved below.

**Framework:** both products use `react-router-dom` — CareHub `^6.22.0`, CareFind `^6.26.0` — as the only routing mechanism; neither uses a meta-framework (no Next.js/Remix), so every route is a plain client-side `<Route>` entry with no server-side rendering or file-based routing convention.

---

## 1. Public Routes

### CareHub (`App.jsx`) — genuinely public
| Route | Component | Notes |
|---|---|---|
| `/` | `Landing` | Marketing page; pricing tiers are static copy with no backend wiring at all |
| `/login` | `Login` | Redirects an already-authenticated non-admin to `/dashboard` |
| `/register` | `Register` | 5-step signup wizard |
| `*` (top-level) | → `Navigate to='/'` | Catch-all fallback |

Four routes total are reachable with no authentication of any kind.

### CareFind (`main.jsx`) — genuinely public, deliberately

**Updated this engagement**: CareFind's router previously declared all 27 non-admin routes in a single flat `<Routes>` table with no guard component anywhere. 16 of them now go through a new `RequireAuth.jsx` wrapper — see §2 for those. The 11 below are public on purpose: each was individually checked (not assumed) to confirm it's meant to work without a login before being left out of the guard.

| Path | Component | Router-level guard | Why public |
|---|---|---|---|
| `/` | `Feed` | None | Public content feed; `user`-gated actions (like/follow/save) checked internally per-action |
| `/search` | `Search` | None | Public business/medication search |
| `/business/:id` | `BusinessProfile` | None | Public business listing; only review submission requires login |
| `/login` | `Login` | None | The login page itself |
| `/u/:id` | `PublicProfile` | None | Viewing someone else's public profile |
| `/drug/:name` | `DrugProfile` | None | Public drug information page |
| `/news`, `/news/:id` | `News`, `NewsArticle` | None | Public news feed/article; like/save/comment gated internally |
| `/live/:id` | `LiveSession` | None | Watching a livestream is public; chat/gifts require `user`, checked internally with a proper `if (!user)` guard (confirmed by direct read — no crash risk here, unlike the two below) |
| `/live-show/:id` | `LiveShow` | None | Same pattern as `/live/:id` |
| `/playlist/:id` | `PlaylistView` | None | Viewing a playlist is public; owner-only edit controls gated by `user && playlist.owner_id === user.id` |

`App.jsx` (a second, unused router-adjacent file containing its own full search implementation) is confirmed dead code — not imported by `main.jsx` or anything else, so it contributes no routes at all despite existing in the repository.

**Admin routes (`/admin`, `/admin-login`, `/admin-panel`) are neither in this public table nor the `RequireAuth`-protected one in §2** — they run on an entirely separate mechanism (`admin_token` in `localStorage`, unrelated to the consumer `user` session `RequireAuth` checks), covered in full under §2's CareFind admin entry and `Security-Risks.md` Finding #2.

---

## 2. Protected Routes

### CareHub — protected at two coarse gates, nowhere else
CareHub has exactly two route-level guards, both in `App.jsx`, both a simple ternary in the `element` prop:

```
/admin        → auth?.isAdmin ? <AdminDashboard/> : <Navigate to='/login'/>
/dashboard/*  → auth && !auth.isAdmin ? <BusinessDashboard/> : <Navigate to='/login'/>
```

`/admin` is CareHub's only route with a real, single-purpose guard — reachable only by an account whose cached auth object has `isAdmin: true`.

`/dashboard/*` gates entry into the entire business application as one block. **Fixed**: all 26 child routes declared in `BusinessDashboard.jsx`'s own `<Routes>` are now individually guarded — each route's `element` is wrapped in a `guard(routeKey, element)` call that checks `getNavItems(role, businessType)` (the same function `Sidebar.jsx` already used to decide what to *show*) and redirects to `dashboard` if the route isn't in the resulting list:

| Route | Component | Individually guarded? |
|---|---|---|
| `dashboard`, `pos`, `inventory`, `clients`, `appointments`, `consultation`, `expenses`, `debts`, `purchases`, `staff`, `reports`, `settings`, `carefind`, `locations` | Core retail pages | **Yes** — role and business-type checked before render |
| `warehouses`, `territories`, `messages`, `stock`, `orders`, `activity` | Enterprise vertical | **Yes** — blocked for non-`manufacturer_importer`/`wholesale` business types |
| `reception`, `triage`, `doctor`, `rx_inbox`, `lab`, `imaging` | Hospital clinical pipeline | **Yes** — blocked for non-`hospital` business types |
| `*` (nested) | → `Navigate to='dashboard'` | N/A, fallback |

Previously: a Cashier who typed `/dashboard/staff` into the address bar would see the full staff roster (only the add/remove *buttons* were hidden, per `Staff.jsx`'s internal check); a pharmacy tenant's staff could reach `/dashboard/doctor`; a hospital tenant's staff could reach `/dashboard/warehouses`. All three of those specific examples are now blocked at the route level, redirecting to `dashboard` instead of rendering. **What this fix does not change**: it's still client-side routing enforcement, not server-side authorization — the underlying `lib/supabase.js` functions those pages call still have no permission check of their own (see `Security-Risks.md` §1, still Critical/C1 until real RLS lands). A blocked route can no longer be reached by typing a URL, but a motivated user could still call the same `lib/supabase.js` functions directly from the browser console. This closes the "obvious, easy" gap, not the underlying one.

### CareFind — route-level protection added; component-level checks still vary underneath it
**Fixed this engagement**: `main.jsx` now wraps 16 of its 27 non-admin routes in a new `RequireAuth.jsx` component (`Navigate to="/login"` if `useAuth()`'s `user` is null) — `/onboarding`, `/profile`, `/saved`, `/verify`, `/claim-business`, `/claim-staff-position`, `/dashboard`, `/business-dashboard`, `/professional-dashboard`, `/wallet`, `/earn`, `/notifications`, `/playlist/create`, `/playlist/:id/add`, `/playlist/:id/edit/:partId`, `/live-dashboard/:id`. The other 11 (Feed, Search, BusinessProfile, Login, PublicProfile, DrugProfile, News, NewsArticle, LiveSession, LiveShow, PlaylistView) are left unguarded deliberately — each was checked for whether it's meant to be publicly viewable (yes, in all 11 cases) before being excluded, not skipped by assumption.

Before this fix, "protected" could only mean a component's own internal behavior once mounted — which is worth recording since it explains *why* the route guard mattered differently per page:

- **12 of the 16 now-guarded pages already redirected/blocked internally when logged out** (`Dashboard.jsx`, `Profile.jsx`, `ClaimBusiness.jsx`, `ClaimStaffPosition.jsx`, `BusinessDashboard.jsx`, `ProfessionalDashboard.jsx`, `Wallet.jsx`, `SavedPosts.jsx`, `VerifyProfessional.jsx`, `Notifications.jsx`, `Onboarding.jsx`, `LiveDashboard.jsx`) — the route guard is consistency/defense-in-depth for these, not a new fix.
- **`PlaylistCreate.jsx` and `ProfessionalMonetization.jsx` (`/earn`) had no internal check at all** and used `user.id` directly in their save functions with no null guard — an unauthenticated visitor reaching either page and submitting the form would have thrown a runtime error, not just seen data they shouldn't. The route guard is an actual bug fix for these two, confirmed by reading both files' save functions directly, not inferred from the pattern of the other 12.
- **`BusinessProfile.jsx`** — deliberately left public; only the review-submission form is conditionally hidden behind `user ? <form/> : <p>Log in to review</p>`.
- **`AdminPanel.jsx`** — still has its own separate, still-forgeable `admin_token`/`localStorage` check (unchanged by this fix — `RequireAuth` checks the consumer `user` session, a different mechanism entirely, and was deliberately not applied to `/admin-panel`). See `Security-Risks.md` Finding #2 for that check's known weakness.
- Every route's internal auth behavior beyond what's listed above was not individually re-verified this session (see `architecture/Component-Catalog.md` §5 for the confidence breakdown) — the route guard covers the URL-typing gap regardless of what each page does internally, so this residual uncertainty matters less than it did before the fix.

---

## 3. Role Requirements

Role enforcement in this ecosystem exists in exactly one place: CareHub's `lib/permissions.js`. CareFind has no equivalent role-matrix service at all.

### CareHub
`getNavItems(role, businessType)` is the sole mechanism that ties a role to what's reachable — and, critically, it only filters what the **`Sidebar`** renders, not what the **router** allows (§2). The role matrix (`ROLES` in `lib/permissions.js`) defines nine roles — `Owner`, `Manager`, `Pharmacist`, `Therapist`, `Receptionist`, `Cashier`, `Nurse`, `Doctor`, `Lab Technician` — each with its own `nav` array of allowed route ids plus boolean capability flags (`canEditPrice`, `canEditStock`, `canDelete`, `canViewReports`, `canExportReports`, `canManageStaff`, `canViewFinance`, `canMakeSales`, `canViewSettings`).

**The confirmed defect in this model:** several roles' `nav` arrays reference ids (`rx_inbox`, `doctor`, `triage`, `lab`, `imaging`) that exist only in `ALL_NAV_HOSPITAL` — for any `business_type` other than `'hospital'`, `getNavItems` filters against `ALL_NAV_DEFAULT` (or `ALL_NAV_ENTERPRISE`), which contains none of those ids, so the grant is silently inert. A `Pharmacist` role literally cannot see "Rx Inbox" in the sidebar at any business type except `hospital`, despite `ROLES.Pharmacist.nav` explicitly listing it. Full detail in `knowledge/modules/pharmacy.md`.

Three role-requirement enforcement styles coexist inconsistently across CareHub pages:
1. **Full-page block** — `Settings.jsx` returns a lockscreen entirely for non-Owner roles (`if (!isOwner) return <lockscreen/>`) — the strongest pattern in the codebase.
2. **Partial hide** — `Staff.jsx` shows the entire staff roster to any role but hides only the add/remove buttons for non-Owners — a materially weaker pattern that still exposes data.
3. **No check at all** — most pages (`Appointments.jsx`, `Debts.jsx`, `Expenses.jsx`, all six hospital stations) perform no role check whatsoever beyond what `perms` happens to hide in the sidebar.

None of these three styles is enforced anywhere beyond the React render tree — every one is bypassable by a direct API call, since (per `architecture/Security-Risks.md`) no service re-validates a `perms` value before executing a write.

### CareFind
No role concept exists in the CareHub sense. The closest equivalents are: (a) the binary `user` present/absent check described in §2, and (b) whatever internal role logic `AdminPanel.jsx` may have for its own `admin_users`/`admin_teams` distinction, which was not confirmed in source this session.

---

## 4. Authentication Flow

Four independent authentication systems feed into routing, each connecting to the router differently. Full mechanism-level detail lives in `architecture/Authentication.md`; this section covers specifically how each one drives navigation.

1. **CareHub business/staff login** (`Login.jsx` → `lib/supabase.js`'s `loginBusiness`/`loginStaff`) — on a successful plaintext-equality match, `App.jsx`'s `login(brand, staff)` writes `{ brand, staff, role, loginTime }` to `localStorage['carehub_auth']` and to the in-memory `AuthContext`, then the calling component (`Login.jsx`) manually calls `navigate('/dashboard/dashboard')`. No token is issued; the router's `/dashboard/*` guard checks only whether this cached object is truthy and non-admin on every subsequent render.
2. **CareHub admin login** — the same `Login.jsx` form, but a hardcoded email/password match sets `{ isAdmin: true }` in the same cached object and navigates to `/admin` instead. One form, two divergent auth paths, distinguished only by whether the typed credentials happen to match a literal string in source.
3. **CareFind consumer login** (`Login.jsx`, CareFind) — routes through real Supabase Auth via `lib/AuthContext.jsx`; a session is established by Supabase itself, and `useAuth()`'s `user` becomes non-null reactively via `onAuthStateChange`, with no manual cache-writing by the component. This is the only one of the four flows where "authenticated" reflects a real, verifiable server-issued session rather than a client-trusted local cache.
4. **CareFind admin login** (`AdminLogin.jsx` → `api/admin-auth.js`) — issues an unsigned base64 token client code presumably stores (mechanism not fully re-verified this session) and treats as a session; per `architecture/Authentication.md`, this token can be forged without ever calling the endpoint, meaning "authenticated as admin" in this flow is not a meaningful statement about who the caller actually is.

**Logout:** CareHub's `logout()` (in `App.jsx`) clears both the context and `localStorage['carehub_auth']`, and `AdminDashboard.jsx` additionally has its own direct `localStorage.removeItem('carehub_auth')` call rather than going through the shared `logout()` — a minor duplicate implementation of the same one-line operation. CareFind's logout is presumably `supabase.auth.signOut()` via `AuthContext.jsx`, consistent with its otherwise-correct session handling.

**Session persistence across reloads:** CareHub's is a plain `localStorage` read on `App.jsx` mount (`useState(() => JSON.parse(localStorage.getItem('carehub_auth')))`) — indistinguishable, from the router's perspective, from a real session, since nothing re-validates it against the server. CareFind's is Supabase Auth's own persisted-session mechanism, which does re-validate.

---

## 5. Navigation

### CareHub — `Sidebar.jsx` + `TopBar.jsx`
`Sidebar` is the single navigation surface, built from `getNavItems(role, businessType)` (§3). It is mounted once, inside `BusinessDashboard.jsx`, alongside an embedded `NotificationBell`. Active-route highlighting is done by comparing `location.pathname`'s last segment against each nav item's id — a simple, correct approach for a flat route structure.

`TopBar` provides the per-page title and is **inconsistently applied**: 19 of the 25 nested routes wrap their element in `<><TopBar title='X'.../><div style={{padding:'24px'}}>...</></>`, repeated inline 19 times in `BusinessDashboard.jsx`'s route table; the 6 enterprise-vertical routes (`warehouses`, `territories`, `messages`, `stock`, `orders`, `activity`) render with no `TopBar` at all, confirmed by direct read of all six components in the component-catalogue pass — none of them import it.

There is no breadcrumb system, no route-change page-title (`document.title`) management, and no deep-link-aware back-navigation beyond the browser's own history — confirmed absent across every CareHub page read this engagement.

### CareFind — `BottomNav.jsx`
A fixed mobile bottom tab bar (Home / MedMarket / Compose / News / Profile), mounted per-screen rather than globally (confirmed present on `Search.jsx`; not confirmed as universally mounted across all 29 routes). Active-tab highlighting compares `location.pathname` directly against five hardcoded paths — a flat, correct approach, but one that silently shows no active tab at all for any of the other ~24 routes not in that list (e.g. `/wallet`, `/business/:id`, `/admin-panel` all render `BottomNav` with no tab highlighted, if `BottomNav` is mounted on those screens at all).

`BottomNav` additionally carries a live unread-news badge (`profiles.news_last_seen` vs. `news.published_at`), a small piece of real navigation-adjacent business logic not present anywhere in CareHub's `Sidebar`.

Neither product's navigation component has any awareness of the other product — there is no cross-product nav link anywhere in either codebase (e.g., nothing in CareHub's `Sidebar` links out to a CareFind URL, and nothing in CareFind's `BottomNav` links back to CareHub), despite the `carefind` route inside CareHub's own dashboard existing specifically to manage a business's CareFind presence.

---

## 6. Dependencies

| Layer | Depends on |
|---|---|
| CareHub top-level router | `react-router-dom` (`Routes`, `Route`, `Navigate`), `App.jsx`'s `AuthContext` (`useAuth`) |
| CareHub nested router (`BusinessDashboard.jsx`) | `react-router-dom`, `lib/permissions.js` (`getNavItems`, `getPerms`), `lib/supabase.js` (`getProducts`, offline-cache functions), `Sidebar`, `TopBar` |
| CareHub `Sidebar` | `lib/permissions.js`, `lib/utils.js` (`businessIcon`/`businessName`), `useAuth()` (for `logout`), `NotificationBell` |
| CareHub `TopBar` | `useAuth()` (for the displayed staff name), `lib/utils.js` |
| CareFind router (`main.jsx`) | `react-router-dom`, `lib/AuthContext.jsx` (`AuthProvider` wraps the whole tree), `React.lazy`/`Suspense` (for `AdminPanel` only — the only code-split route in either product) |
| CareFind `BottomNav` | `lib/supabaseClient.js`, `lib/AuthContext.jsx`, `lib/theme.js` |

**No route-level code splitting exists anywhere in either product except CareFind's single `AdminPanel` lazy import.** Every other route in both applications — including CareHub's 25-page dashboard and CareFind's ~28 non-admin routes — is bundled eagerly into the main JS payload, which will affect initial load time as either application's page count grows further.

**No route-guard abstraction exists in either codebase.** Both products' entire access-control surface at the routing layer is the pair of ternaries in CareHub's `App.jsx` (§2) — there is no `<RequireAuth>`, `<RequireRole>`, or `<RequireBusinessType>` component anywhere, meaning any future route added to either product inherits none of the (already thin) protection the two existing gates provide unless a developer remembers to add an equivalent check by hand.
