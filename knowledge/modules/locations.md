# Locations — Business Domain

## Purpose
Multi-branch view for a CareHub business — showing a parent business alongside its registered branches, with aggregated sales/product stats across them, and the ability to add a new branch.

## Files
`apps/carehub/src/pages/dashboard/Locations.jsx` (the entire module).

## Components
Single default-exported component. Uses `useAuth()` directly (one of the few dashboard pages besides layout components to do so) for brand context.

## Services
`lib/supabase.js`: `getAllLocations` (a three-step sequential dependent-query chain — fetch the given business, conditionally fetch its parent, then fetch all branches of that parent), `addBranch`, plus read-only `getSales`/`getTodaySales`/`getProducts` for cross-branch stats.

## Dependencies
`lib/utils.js` (`fmt`, `todayDate`, `businessIcon`, `businessName`, `NIG_STATES`).

## Database Tables
`businesses` (self-referential via `parent_business_id`), plus read-only aggregation across `sales`/`products` scoped to each branch's `business_id`.

## Current State
Viewing branch locations and adding a new branch are implemented. `getAllLocations`'s three-step sequential query chain was not reviewed for correctness/necessity in depth in prior passes; whether the redundant second `getBusinessById` call in the non-branch case is intentional or avoidable was not resolved.

## Missing Documentation
No document describes the intended relationship between this domain and the enterprise-vertical `enterprise_locations` table used by Warehouses — whether "Locations" (branches of a `businesses` row) and "Warehouses" (`enterprise_locations` rows) are meant to be the same concept for different business types, or genuinely separate systems, is not stated anywhere.
