# 02 — Architecture

## Actual Architecture (verified) vs. Aspirational Architecture (documented, not built)

The existing `docs/CARE_ECOSYSTEM_OPERATING_MANUAL/BOOK-02-SOFTWARE/00-System-Architecture.md` describes a five-layer architecture:

```
Presentation Layer → Application Layer → Domain Layer → Infrastructure Layer → Database Layer
```

**This does not exist in the codebase.** What actually exists, verified by reading every page and service file in both products:

```
Presentation Layer (React components — pages own most business logic directly)
        │
        ▼
Thin data-access functions (lib/supabase.js in CareHub; direct supabase-js
calls scattered across page components in CareFind — NOT a domain layer)
        │
        ▼
Postgres, via PostgREST (CareHub) or supabase-js (CareFind), using one
publicly-embedded anon key, no per-request server-side authorization
```

There is no Application Layer coordinating workflows independent of a specific screen. There is no Domain Layer — business rules (duplicate-detection, state machines, reconciliation logic, authorization decisions) live inside page components, not in a separate layer, and are frequently reimplemented per calling component rather than centralized. Full detail on where business logic actually lives, service by service, is in `architecture/Service-Catalog.md`.

## Technology Stack

| | CareHub | CareFind |
|---|---|---|
| Build tool | Vite ^5.0.0 | Vite ^5.4.0 |
| Framework | React ^18.2.0 | React ^18.3.1 |
| Routing | react-router-dom ^6.22.0 | react-router-dom ^6.26.0 |
| Data | @supabase/supabase-js ^2.45.0 (used only for realtime — CRUD is raw `fetch()`) | @supabase/supabase-js ^2.45.0 (used properly throughout) |
| Backend compute | None | 3 Vercel serverless functions |
| Deployment | Vercel (static build) | Vercel (static build + functions) |
| Type safety | None — plain JS/JSX, no TypeScript, no PropTypes | Same |
| Tests | None found | None found |
| Linter/formatter | None found | None found |

## Ecosystem-Level Diagram

```
┌─────────────────────────┐        ┌─────────────────────────┐
│   CareHub (apps/carehub) │        │  CareFind (apps/carefind) │
│   React SPA, Vite         │        │   React SPA, Vite          │
│   ~30 page components     │        │   ~48 page components      │
│   own git repo             │        │   no git repo found         │
└───────────┬───────────────┘        └───────────┬───────────────┘
            │  raw fetch() + PostgREST            │  supabase-js
            │  (anon key hardcoded, 5+ copies —    │  (anon key hardcoded once,
            │   duplication is a maintainability    │   correctly centralized)
            │   issue; the key itself being public  │
            │   is expected Supabase behavior)       │
            ▼                                      ▼
      ┌─────────────────────────────────────────────────┐
      │        One shared Supabase / Postgres project     │
      │  CONFIRMED — identical project URL and anon key    │
      │  found in both lib/supabase.js and                 │
      │  lib/supabaseClient.js (not just inferred from      │
      │  matching table names)                              │
      │                                                     │
      │  Shared tables: businesses, products,               │
      │  staff_claims, business_claims                      │
      │  CareHub-only: ~30 tables (patients, sales, ...)    │
      │  CareFind-only: ~40 tables (posts, wallets, ...)    │
      │  ⚠ consultations: name collision, unresolved         │
      └─────────────────────────────────────────────────┘
                          │
                          ▼
      ┌─────────────────────────────────────────────────┐
      │  3 Vercel Functions (CareFind only):               │
      │  admin-auth (broken), admin-setup (live exposure), │
      │  initiate-payment (correct)                         │
      │  + paystack-webhook.js (location anomaly, may be    │
      │    unreachable — see 07-api.md)                     │
      └─────────────────────────────────────────────────┘
```

Full detail on exactly which tables are shared and how: `06-database.md` and `architecture/Shared-Services.md`.

## Routing Strategy

Both products use `react-router-dom` with a flat client-side router — no meta-framework, no file-based routing, no server-side rendering. CareHub has two coarse route-level guards (`/admin`, `/dashboard/*`); everything nested inside `/dashboard/*` (25 routes) inherits only that one check. CareFind has **zero route-level guards** across all 29 of its routes. Full detail: `05-authentication.md` and `architecture/Routing.md`.

## Authentication Flow

Four independent authentication systems across the two products, only one of which (CareFind's consumer login, via real Supabase Auth) meets a normal production baseline. Full detail, including a direct contrast against the aspirational Identity Domain document's claims: `05-authentication.md`.

## Authorization Strategy

Exists only in CareHub, via `lib/permissions.js` — a role → capability matrix (`ROLES`) plus business-type-aware nav filtering (`getNavItems`). This is **UI-only authorization**: it determines what the sidebar shows, not what the underlying data layer permits. Nothing in either product's service layer re-validates a permission before executing a write. CareFind has no equivalent authorization model at all.

## State Management

Neither product uses a global state library. Both rely on exactly one React Context (auth) plus local `useState` per screen, refetched on every mount — no query/cache layer (no React Query/SWR) in either product. CareHub additionally has three distinct `localStorage`-only persistence patterns not backed by any database table (the offline-sales queue — legitimate use; the Expenses budget tracker — likely a gap, since the UI implies it's shared across staff when it isn't; and the cached auth object itself). Full detail: `architecture/State-Management.md`.

## API Layer

See `07-api.md` for the complete treatment — PostgREST-via-fetch (CareHub), `supabase-js` (CareFind), the four Vercel functions, Supabase Storage usage, and third-party integrations (Anthropic, Paystack, OpenStreetMap, a CDN-loaded PDF.js).

## Database Interactions

No schema, migration, or ERD exists for either product in either repository. Every table, column, and relationship in `06-database.md` was reconstructed by reading query strings. Full detail: `architecture/Database.md`.

## Shared Services

There is no shared code package, shared type definitions, or shared service layer between the two products — the only connection is at the database level (four tables: `businesses`, `products`, `staff_claims`, `business_claims`). One of these (`staff_claims`) is a genuinely well-built two-way workflow; the others show signs of incomplete coordination. Full detail: `architecture/Shared-Services.md`.

## Shared Utilities

None shared *between* the two products. Within CareHub, `lib/utils.js` centralizes formatting/constants reasonably well. Within CareFind, utilities are scattered at the `src/` root rather than in a `lib/` folder, consistent with its flat file structure (see `03-folder-structure.md`).
