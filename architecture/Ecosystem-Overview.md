# Ecosystem Overview — Care Ecosystem

Index and executive summary for the `architecture/` document set. No code was modified to produce any document in this folder — all findings are read-only inspection of `apps/carehub` and `apps/carefind/carefind-main`.

## What the Care Ecosystem is

Two independently-built React SPAs sharing what appears to be one physical Supabase project:

- **CareHub** (`apps/carehub`) — an internal SaaS operations platform for healthcare businesses (pharmacies, hospitals, clinics, labs, imaging centres, wellness centres). Inventory, POS, billing, staff, hospital clinical workflow, multi-location/enterprise management.
- **CareFind** (`apps/carefind/carefind-main`) — publicly described as a healthcare discovery platform, but implemented overwhelmingly as a **social feed / live-streaming / creator-monetization platform** (~48 files, ~15,400 lines) with a comparatively small genuine healthcare-search surface (`Search.jsx`, `BusinessProfile.jsx`, `DrugProfile.jsx`).

Both were, in different ways, built on top of or alongside a prior "skincare" product identity — CareHub's own git remote is `github.com/AbdullahiTama/skincarepro`, its default business type and staff-welcome-email domain still say "skincare"/"skincarepro.vercel.app."

## Document Index

| Document | Covers |
|---|---|
| `Ecosystem-Overview.md` | This file |
| `CareHub-Architecture.md` | CareHub's architecture in depth |
| `CareFind-Architecture.md` | CareFind's architecture in depth, including the docs-vs-implementation scope gap |
| `Shared-Services.md` | The real CareHub↔CareFind relationship — shared tables, working bridges, gaps |
| `Folder-Structure.md` | Both apps' directory layout |
| `Routing.md` | Every CareHub route + CareFind's route table (originally CareHub-only; CareFind addendum added) |
| `Authentication.md` | All auth systems across both products (four distinct implementations) |
| `Database.md` | Every table in both products, shared vs. product-owned, the `consultations` name-collision risk |
| `State-Management.md` | Client-side state patterns in both apps |
| `Component-Catalog.md` | CareHub's 22-component UI kit inventory + CareFind's much thinner component surface (originally CareHub-only; CareFind addendum added) |
| `Service-Catalog.md` | CareHub's 24-service inventory + CareFind's service layer (originally CareHub-only; CareFind addendum added) |
| `Technical-Debt.md` | Ecosystem-wide technical debt, prioritized |
| `Security-Risks.md` | Ecosystem-wide security findings, prioritized — read this one first |
| `Performance-Risks.md` | Ecosystem-wide performance findings |
| `Missing-Documentation.md` | What documentation gaps block a new engineer from working safely |
| `Current-Architecture.md` *(legacy)* | The original whole-ecosystem onboarding pass; superseded in structure by the documents above but kept and improved rather than deleted, per instruction |
| `Dependency-Map.md` *(supplementary)* | CareHub-internal import/dependency graph — components→services, hooks→providers, module→module coupling |

## The Single Most Important Finding

Every table, route, and service in both products is reachable through one hardcoded, publicly-embedded Supabase anon key with **no server-side authorization verified anywhere in either codebase.** `business_id` (CareHub) and `user_id` (CareFind) are client-supplied values trusted at face value. This affects all ~76 tables across both products simultaneously, including CareHub's clinical patient data and CareFind's payment/wallet data. See `Security-Risks.md` for the full breakdown — every other finding in this folder is secondary to this one.

## How to Use This Folder

Start with this file, then `Security-Risks.md`, then the architecture document for whichever product you're about to touch. `Shared-Services.md` is required reading before touching anything that looks like it might cross the CareHub/CareFind boundary (`businesses`, `products`, `staff_claims`, `business_claims`, `visible_on_carefind`, `list_on_carefind`) — the two products' teams have historically not coordinated on these, and the `consultations` naming collision (`Database.md`) is a live example of what happens when that coordination doesn't happen.
