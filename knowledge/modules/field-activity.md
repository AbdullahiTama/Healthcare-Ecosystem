# Field Activity — Business Domain

## Purpose
Live field-representative activity tracking for the manufacturer/wholesale vertical — reps log check-ins with custom business-defined fields, GPS-derived location labels, and optional voice notes; assigned viewers can react and comment in near-real-time.

## Files
`apps/carehub/src/pages/dashboard/LiveActivity.jsx` (the entire module — the largest single service-import surface of any CareHub page, 13 functions).

## Components
Single default-exported component; no `TopBar` (same inconsistency as the other enterprise routes); no sub-component decomposition despite covering field-configuration, activity logging, and a reaction/comment feed within one file.

## Services
`lib/supabase.js`: `getActivityFields`, `addActivityField`, `updateActivityField`, `deleteActivityField` (custom field configuration), `getDefaultViewers`, `setDefaultViewers`, `getFieldActivities` (the only other enterprise list query with a `limit` — 100 rows), `getActivityViewers`, `getActivityReactions`, `getActivityComments`, `logActivity`, `reactToActivity`, `unreactToActivity`, `commentOnActivity`, `uploadActivityVoice`, `reverseGeocode` (calls OpenStreetMap's Nominatim service directly from the client, no caching). Also uses `lib/realtime.js`'s `watchTable('field_activities', ...)` — one of only two places in the entire codebase using the live-subscription mechanism.

## Dependencies
`getStaff`, `getTerritories`, Storage bucket `activity-voice`, `lib/realtime.js`.

## Database Tables
`activity_fields`, `activity_default_viewers`, `field_activities`, `activity_viewers`, `activity_reactions`, `activity_comments`, Storage bucket `activity-voice`.

## Current State
Custom-field configuration, activity logging with GPS reverse-geocoding, voice notes, and a live reaction/comment feed are all implemented — this is the one CareHub domain (alongside Notifications) that uses real-time updates rather than manual refresh. `reverseGeocode` calls a third-party geocoding service on every logged activity with no caching, risking usage-policy limits under volume.

## Missing Documentation
No document specifies rate limits or caching expectations for the third-party geocoding dependency — this domain's reliance on it was discovered by reading the code, not documented as an external dependency anywhere in the project's stated architecture.
