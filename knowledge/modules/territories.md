# Territories — Business Domain

## Purpose
Sales-territory definition and field-representative assignment for the manufacturer/wholesale ("Enterprise") vertical — lets an enterprise tenant carve up a sales area into territories and assign staff reps to them.

## Files
`apps/carehub/src/pages/dashboard/Territories.jsx` (the entire module).

## Components
Single default-exported component; no `TopBar` (same inconsistency as the other five enterprise routes).

## Services
`lib/supabase.js`: `getTerritories`, `addTerritory`, `updateTerritory`, `deleteTerritory`, `getRepAssignments` (one of only two places in the entire codebase using PostgREST embedded-resource joins — `staff:staff_id(...)`, proving a real foreign key exists between `rep_territories` and `staff`), `assignRepToTerritory`, `removeRepFromTerritory`.

## Dependencies
`getStaff` (read-only, Staff Management domain) for the rep picker.

## Database Tables
`territories`, `rep_territories` (`id, staff_id, territory_id` — a proven, embedded-join-verified foreign key to `staff.id`).

## Current State
Territory CRUD and rep assignment are implemented. There is no conflict check preventing the same rep from being assigned to overlapping or duplicate territories.

## Missing Documentation
No document defines what "territory" means geographically or organizationally for this business type — no boundary/region data model beyond a name was found, so how a territory is meant to map to actual sales coverage is not specified anywhere.
