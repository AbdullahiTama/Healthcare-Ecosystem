# Warehouses — Business Domain

## Purpose
Warehouse/branch-location management for the manufacturer/wholesale ("Enterprise") business-type vertical — a separate multi-location concept from the generic `businesses.parent_business_id` branch model used by the Locations domain.

## Files
`apps/carehub/src/pages/dashboard/Warehouses.jsx` (the entire module).

## Components
Single default-exported component; no sub-file decomposition. Notably renders **without** a `TopBar` — unlike 19 of CareHub's 25 dashboard routes, the six enterprise-vertical routes (this one included) have no page-title header.

## Services
`lib/supabase.js`: `getEnterpriseLocations`, `addEnterpriseLocation`, `updateEnterpriseLocation`, `deleteEnterpriseLocation`, plus `getStaff` (read-only, for a location manager picker).

## Dependencies
`components/ui/index.jsx`. Reachable only via `ALL_NAV_ENTERPRISE`, selected when `business_type` is `manufacturer_importer` or `wholesale`.

## Database Tables
`enterprise_locations` — also consumed read-only by the Stock & Batches and Orders domains, with no shared location-picker component between the three.

## Current State
CRUD for enterprise locations is implemented and functional. The domain has no `TopBar` page-title header, an inconsistency shared with the other five enterprise-vertical routes.

## Missing Documentation
No document explains the relationship (or lack thereof) between `enterprise_locations` (this domain) and the generic `businesses.parent_business_id` branch model (the Locations domain) — both represent "a business has multiple physical locations" for different business types, with no stated reasoning for maintaining two separate table structures.
