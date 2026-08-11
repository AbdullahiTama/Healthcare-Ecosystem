# CareHub Architecture

`apps/carehub` — Vite + React 18 + `react-router-dom`. Own nested git repository (remote: `github.com/AbdullahiTama/skincarepro`). No backend of its own beyond the browser talking directly to Supabase.

## Shape of the application

A single-page app with two authenticated surfaces mounted off one top-level router (`App.jsx`): `/admin` (CareHub's own internal back office) and `/dashboard/*` (the business/staff-facing product, owned by `BusinessDashboard.jsx`). Everything downstream of `/dashboard` receives `brand`, `products`, `role`, `perms`, `showToast`, and `loadProducts` as a single `pageProps` bundle spread into every route — the app's one real piece of centralized state ownership.

## Layers

1. **Presentation** — ~30 page components under `pages/dashboard/` (plus `pages/dashboard/hospital/` for the six clinical station screens), each a single large function component with inline `style={}` throughout. No CSS modules, Tailwind, or styled-components.
2. **Shared components** — `components/ui/index.jsx` (19 exports: `Card`, `Modal`, `Inp`, `Sel`, `Toggle`, `Pill`, `StatCard`, buttons, `Toast`/`useToast`, `Loading`, `Empty`, and one dead/broken export, `OfflineBanner`) plus three `components/layout/*` files (`Sidebar`, `TopBar`, `NotificationBell`). Full inventory in `Component-Catalog.md`.
3. **Data access** — `lib/supabase.js`, a single 682-line file exporting ~90 functions across 20 logical domains, all built on one internal `sbFetch()` wrapper around raw `fetch()` calls to Supabase's PostgREST endpoint with a hardcoded anon key. No `supabase-js` query builder is used for CRUD (only for the realtime channel in `lib/realtime.js`). Full inventory in `Service-Catalog.md`.
4. **Cross-cutting logic** — `lib/permissions.js` (role → capability matrix, nav-item filtering by role and business type), `lib/utils.js` (formatters, `BUSINESS_TYPES` registry, constants), `lib/email.js` (HTML email templating).
5. **Three undocumented shadow services** — `Doctor.jsx`, `Lab.jsx`, and `Imaging.jsx` each independently redeclare the anon key and a private `sbFetch`-equivalent for four tables (`lab_requests`, `lab_results`, `imaging_requests`, `patient_messages`) that have no representation in `lib/supabase.js` at all. This is CareHub's single largest architectural inconsistency — three files bypass the pattern every other domain in the app follows.

## Business-type verticals

One codebase, one `businesses.business_type` field, three different sidebar nav arrays (`ALL_NAV_DEFAULT`, `ALL_NAV_HOSPITAL`, `ALL_NAV_ENTERPRISE`) selected by `lib/permissions.js`'s `getNavItems(role, businessType)`. Hospital tenants get a dedicated six-station clinical pipeline (`pages/dashboard/hospital/`); manufacturer/wholesale tenants get a dedicated warehouse/territory/order pipeline; every other business type (pharmacy, skincare, dental, optical, wellness) shares the same generic Inventory/POS/Clients/Reports surface with no vertical-specific functionality of its own, despite each having a distinct entry in `BUSINESS_TYPES`.

**Critical caveat, detailed fully in `Routing.md`:** business-type nav filtering only hides sidebar links — none of the ~25 nested `/dashboard/*` routes are individually access-controlled. Any authenticated staff member of any role or business type can reach any route by URL.

## What holds the whole thing together

A single React Context (`AuthContext`, defined in `App.jsx`), persisted to `localStorage['carehub_auth']`, holding `{ auth, login, logout, isAdmin }`. There is no global state library, no query/cache layer (no React Query/SWR), and — with the exception of one small, genuinely well-built offline-sales queue (`lib/supabase.js`'s `queueOfflineSale`/`syncOfflineSales`, backing the app's one working "Offline First" product principle) — no persistence beyond a fresh fetch on every screen mount. Full detail in `State-Management.md`.

## Origin as a repurposed product

The `skincarepro` git remote, the `'skincare'` fallback business type hardcoded in four separate files, and the stale `skincarepro.vercel.app` branding baked into every staff welcome email are all consistent with CareHub having started as a skincare-spa POS product later generalized into a multi-vertical healthcare platform. The hospital clinical pipeline (Reception → Triage → Doctor → Lab/Imaging → Pharmacy) reads as a substantial, well-intentioned later addition layered onto a retail data model rather than a ground-up clinical design — visible in gaps like the disconnected `clients`/`patients` tables (two different "customer" concepts, both labeled "Patients" in the hospital UI) and the plain `products.stock` integer having no relationship to the separate, properly-audited `stock_batches`/`stock_movements` system built for the enterprise vertical.

## Deep-dive references

Five modules were reviewed in full detail earlier in this engagement and are not reproduced here: **Inventory**, **Patients** (the `clients`/`patients` split), **Hospital** (the business-type-vertical wiring), **Pharmacy** (the "Pharmacy" business type's inability to reach the feature named after it), and **Laboratory** (the Lab/Imaging pipeline dead-end). Their findings are folded into `Technical-Debt.md`, `Security-Risks.md`, and `Performance-Risks.md` where ecosystem-relevant.
