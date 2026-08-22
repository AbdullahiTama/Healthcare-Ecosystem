# Field Activity — Business Domain

## Purpose
Live field-representative activity tracking for the manufacturer/wholesale vertical — reps log check-ins with custom business-defined fields, GPS-derived location labels, and optional voice notes; assigned viewers can react and comment in near-real-time.

## Files
- `apps/carehub/src/modules/live-activity/LiveActivity.jsx` — module shell (field config, activity log list, reaction/comment feed, GPS-driven facility picker, manager facility-review queue).
- `apps/carehub/src/modules/live-activity/FacilityPicker.jsx` — location capture component (auto-detect nearby, manager verify, rep "add this facility").
- `apps/carehub/src/lib/places.js` — facility lookup/lookup cache and rep-added facility review workflow.
- `apps/carehub/src/lib/geo.js` — pure geo helpers (distance, category mapping, Overpass parsing/ranking, GPS-bounded verification).

## Components
`LiveActivity` is now a shell that composes `FacilityPicker` for the Location field. `FacilityPicker` holds all location-capture logic. The reaction/comment feed and field configuration remain inline in `LiveActivity`.

## Services
`lib/places.js`: `buildOverpassQuery`, `fetchOverpass` (OpenStreetMap Overpass API — keyless, client-side, with `MAX_FACILITIES` = 150 nearest-first cap), `getCachedFacilities` (internal `facilities_cache`), `addRepAddedFacility` (saves a rep-added place as `pending_review` and flags managers/owner via `notify` with `kind: 'facility_review'`), `getRepAddedFacilities`, `confirmRepAddedFacility` (flips to `confirmed` and promotes into `facilities_cache`), `dismissRepAddedFacility`. `lib/supabase.js`: `captureFieldActivity`, `getActivityFields`, `addActivityField`, `updateActivityField`, `deleteActivityField`, `getDefaultViewers`, `setDefaultViewers`, `getFieldActivities` (limit 100), `getActivityViewers`, `getActivityReactions`, `getActivityComments`, `logActivity`, `reactToActivity`, `unreactToActivity`, `commentOnActivity`, `uploadActivityVoice`, `reverseGeocode` (Nominatim, retained for historical rows). Uses `lib/realtime.js`'s `watchTable('field_activities', ...)`.

## Dependencies
`getStaff`, `getTerritories`, Storage bucket `activity-voice`, `lib/realtime.js`, OpenStreetMap Overpass API (keyless), OpenStreetMap Nominatim (legacy reverse-geocode only).

## Database Tables
`activity_fields`, `activity_default_viewers`, `field_activities` (added columns: `facility_name`, `facility_address`, `facility_category`, `facility_lat`, `facility_lng`, `facility_distance_m`, `facility_source`, `facility_verified`), `activity_viewers`, `activity_reactions`, `activity_comments`, `facilities_cache` (business-scoped internal map, unique on `business_id,name,lat,lng`, source `overpass` or `rep_added`), `rep_added_facilities` (`pending_review`/`confirmed`, business-scoped RLS), Storage bucket `activity-voice`.

## Current State
Custom-field configuration, activity logging with GPS-driven facility capture, voice notes, and a live reaction/comment feed are implemented. The old free-text "Place of Visit" field is replaced by automatic GPS-to-facility matching (Overpass, nearest-first, category-filterable) plus a manager "Verify logged location" picker. Reps who can't find a place add it (`pending_review`); managers/owners get a notification and a "Review facilities (N)" queue to confirm (promote to `facilities_cache`) or dismiss. Verification is **distance-only** (GPS within `FACILITY_VERIFY_THRESHOLD_M` = 150 m) — never name-matching. This domain (alongside Notifications) uses real-time updates.

## Missing Documentation
Rate-limit/caching expectations for the Overpass and Nominatim third-party dependencies are not formally specified; `facilities_cache` is the internal mitigation. The "reused a few times" auto-promotion alternative from the spec is intentionally not built — confirmation is a manager/owner audit step, and rep-added facilities are already visible to nearby reps regardless.
