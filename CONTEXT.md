# CareHub Context

## Glossary

### Branch

A separate `businesses` row linked to its parent via `parent_business_id`. Each branch has fully isolated inventory, sales, staff, and appointments. The owner sees all branches via the recursive `current_business_ids()` RLS function.

### Location

A physical place within one branch, stored in `enterprise_locations`. Separate from branches — branches are business entities, locations are places (warehouse, showroom, headquarters). The two systems do not interact.

### Master Catalog

The owner's canonical product list (`master_products` table). Branches "activate" products from it (`branch_products` table) to add them to their own inventory. The owner pushes updates; branches can override prices.

### Owner Overview

The cross-branch dashboard showing aggregated stats across all branches: total sales, appointments, low-stock alerts, staff headcount, and pending tasks. Accessible only to the Owner role.

### Global Client

A person who may visit multiple branches. Each branch has its own `clients` row (for data isolation), but they share a `global_client_id` linking them to one canonical identity. Debts are global to the client — visible and payable at any branch.

### Branch Switcher

The persistent header dropdown showing the active branch. The owner clicks it to switch `auth.brand` to a different branch, which re-scopes every repository call to that branch's data.

### Stock Transfer

An owner-initiated move of stock between two branches. Starts as `pending`; the source branch manager must `approve` before stock actually moves. Both branches see the movement in their history.

### Clone from Template

When a new branch is created, it inherits the parent's master-product activations and custom roles. Stock starts at zero. Each activation runs through `activate_branch_product`, which also materialises the branch's own sellable `products` row — a branch_products link without one would be an orphan the POS could not sell. This lets a new branch open ready to operate.

### Master Catalog UI

The owner-side screen (`modules/master-catalog`) listing `master_products` with a per-branch activation matrix. Add/edit/delete run through the repository; activate/deactivate/push run as database RPCs (`activate_branch_product`, `deactivate_branch_product`, `push_master_product`) so the branch's `products` row and the `branch_products` link can never drift apart. Requires migrations `20260810_master_catalog.sql` + `20260811_master_catalog_ops.sql` (NOT YET APPLIED).
