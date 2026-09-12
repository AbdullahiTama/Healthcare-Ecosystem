---
title: 'Fix Manufacturer/Importer facility filtering to support all healthcare facility categories'
type: 'bugfix'
created: '2026-09-02'
status: 'in-review'
baseline_commit: 'de362ea07e0d7163acc2d188ab7de27e595c309a'
review_loop_iteration: 0
context:
  - 'docs/PROJECT_OVERVIEW.md'
  - 'knowledge/modules/field-activity.md'
  - 'apps/carehub/src/lib/geo.js'
  - 'apps/carehub/src/lib/places.js'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Live Field Activities facility-selection incorrectly restricts Manufacturer/Importer users to Hospital facilities only, blocking visits to pharmacies, laboratories/diagnostic centres, clinics and other healthcare facilities already configured in CareFind.

**Approach:** Correct the filtering/query/eligibility logic so Manufacturer/Importer users can discover and log any applicable healthcare facility category — without creating a duplicate facility database — by expanding the facility category model, Overpass query and UI filters to cover all CareFind healthcare facility types and removing any business-type-based restriction.

## Boundaries & Constraints

**Always:** Use existing CareFind healthcare-facility records and facility categories; fix filtering/query/eligibility logic only; keep existing GPS/distance rules, verification states (verified/pending/unverified), and facility-category filters functional; preserve RLS and manager review workflow.

**Ask First:** Changing facilities_cache or rep_added_facilities schema beyond adding category values; proxying Overpass through server; altering business_type → module gating for Live Field Activity.

**Never:** Create a separate Manufacturer/Importer facility database or duplicate facility records; restrict facility visibility by user's business_type; weaken authentication/permissions; introduce business-type-specific hard-coded category allow-lists.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| All facilities visible for manufacturer | Manufacturer/Importer GPS near pharmacy, lab, clinic, hospital, aesthetic, spa | nearbyHealthFacilities returns facilities of all categories; FacilityPicker shows them; user can select and log | GPS/distance rules still apply; empty list shows "No facilities in this category nearby" |
| Category filter Pharmacy | Manufacturer user selects Pharmacy filter | Only Pharmacy-category facilities shown; at least pharmacies appear when nearby | Empty state for category with no results |
| Category filter Clinic-Diagnostic | Manufacturer user selects Clinic-Diagnostic | Clinics, labs, medical centres, specialist clinics etc mapped to clinic bucket appear | N/A |
| Existing business types unaffected | Pharmacy/retail/hospital user opens facility selector | Same all-category behavior; no regression | N/A |
| GPS absent | No GPS fix | facilityVerification returns unverified, log still succeeds | Never blocks submit |
| Rep-added pending | Rep-added facility pending_review at GPS | Shown but pendingReview true; verification pending not verified | N/A |

</frozen-after-approval>

## Code Map

- `apps/carehub/src/lib/geo.js:10-28` -- FACILITY_CATEGORY, FACILITY_FILTER_KEYS, FACILITY_VERIFY_THRESHOLD_M — single source of truth for categories; currently 4 buckets; needs expansion to 13+ categories listed in fix instruction.
- `apps/carehub/src/lib/geo.js:81-98` -- categoryFromAmenity — collapses OSM amenity/healthcare tags onto categories; currently maps hospital/pharmacy/clinic variants and defaults to OTHER; needs to cover dental, optical, physiotherapy, aesthetics, spa, lab, etc.
- `apps/carehub/src/lib/geo.js:166-185` -- parseOverpass — parses Overpass nodes/ways, reads amenity/healthcare tags, calls categoryFromAmenity, builds address; must preserve lat/lng fallback to center.
- `apps/carehub/src/lib/geo.js:209-214` -- matchesCategory — filter predicate used by FacilityPicker and places.js; must handle expanded filter keys.
- `apps/carehub/src/lib/places.js:26-28` -- AMENITY_REGEX and OVERPASS_URL — Overpass query filter; currently hospital|pharmacy|clinic|doctors|dentist|health_post|dispensary|birthing_center; must include healthcare=* and shop=* variants for labs, physiotherapy, optometry, beauty/spa, etc.
- `apps/carehub/src/lib/places.js:34-40` -- FACILITY_FILTERS — UI filter pills; currently all/hospital/pharmacy/clinic/other; must expose applicable healthcare facility categories per instruction while keeping "All".
- `apps/carehub/src/lib/places.js:44-50` -- buildOverpassQuery — builds [amenity~"regex"] query for nodes/ways; must be updated to query both amenity and healthcare/shop tags and healthcare-specific Overpass clauses.
- `apps/carehub/src/lib/places.js:276-311` -- nearbyHealthFacilities — main entry used by LiveActivity.jsx:461 and FacilityPicker.jsx:49; reads cache+rep_added, tops up via Overpass when thin, filters by category, ranks nearest-first; must ensure category='all' returns all and specific filters map correctly; must NOT apply business_type restriction.
- `apps/carehub/src/modules/live-activity/FacilityPicker.jsx:9-10,199-210` -- Picker UI controls (FACILITY_FILTERS pill row, list filtering via matchesCategory); must show expanded filters and correctly filter displayed list.
- `apps/carehub/src/modules/live-activity/LiveActivity.jsx:461-463` -- auto-detects facility on GPS capture with category:'all'; must remain category:'all' for manufacturer/importer (no business_type gating).
- `apps/carehub/src/lib/places.test.js` and `apps/carehub/src/lib/geo.test.js` -- existing tests for category mapping, filters, overpass query, ranking; to be extended.
- `apps/carehub/src/lib/__tests__/permissions.test.js` -- nav gating tests, ensures manufacturer_importer not regressed.
- `knowledge/modules/field-activity.md:30-31` -- documents authorization; no change to RLS expected.

## Tasks & Acceptance

**Execution:**
- [x] `apps/carehub/src/lib/geo.js` -- Expand FACILITY_CATEGORY to canonical set covering Hospital, Pharmacy, Medical Laboratory/Diagnostic Centre, Clinic, Medical Centre, Aesthetic Clinic, Cosmetics & Spa, Specialist Clinic, Dental Clinic, Eye Clinic/Optometry Centre, Physiotherapy/Rehabilitation Centre, Primary Health Centre/Community Health Centre, Other Health Facility; update FACILITY_FILTER_KEYS to map filter keys to canonical labels; update categoryFromAmenity to handle expanded OSM tags (healthcare=*, shop=beauty, amenity=dentist, etc.) and healthcare-specific tags (laboratory, physiotherapist, optician, etc.); keep fallback to OTHER.
- [x] `apps/carehub/src/lib/places.js` -- Expand AMENITY_REGEX / buildOverpassQuery to query healthcare=* and shop=* tags alongside amenity (so diagnostic labs, physiotherapy, eye clinics, aesthetic/beauty facilities are discovered); update FACILITY_FILTERS to expose All plus applicable healthcare facility categories (Hospital, Pharmacy, Clinic-Diagnostic, Other) ensuring no business_type restriction, with canonical categories mapped onto filter buckets; ensure nearbyHealthFacilities filtering uses matchesCategory and never gates by business_type; keep MAX_FACILITIES/caching logic unchanged.
- [x] `apps/carehub/src/modules/live-activity/FacilityPicker.jsx` -- Verify filter pill row renders expanded FACILITY_FILTERS and displayed list correctly filters via matchesCategory; ensure accessible filter pills (aria-pressed, keyboard) and empty states.
- [x] `apps/carehub/src/lib/geo.test.js` + `apps/carehub/src/modules/live-activity/places.test.js` -- Add unit tests: categoryFromAmenity for new tags, matchesCategory for new filters, buildOverpassQuery includes healthcare regex, nearbyHealthFacilities returns mixed categories and pharmacy filter returns pharmacies for manufacturer context.

**Acceptance Criteria:**
- Given a Manufacturer/Importer account near a pharmacy, lab, clinic, aesthetic clinic and hospital within GPS radius, when opening Facility Visited with All filter, then all applicable categories appear in nearest-first list and any can be logged successfully.
- Given Manufacturer/Importer selects Pharmacy filter, when GPS near a pharmacy, then nearby pharmacies appear; similarly Clinic-Diagnostic shows labs/clinics/medical centres.
- Given Manufacturer/Importer selects Other Health Facility filter, when GPS near a spa/dental/eye/physio facility, then corresponding facilities appear.
- Given any business_type (retail, hospital, enterprise), when using facility selector, then behavior is identical (no business_type restriction) and existing GPS/distance/verification rules still apply.
- Given buildOverpassQuery, when inspecting generated query, then it includes healthcare=* clauses and covers expanded amenities so non-hospital facilities are discoverable via Overpass.
- Given facilityVerification and pendingReview logic, when a rep-added facility is pending, then it remains pending not verified regardless of distance.

## Spec Change Log

## Design Notes

No new facility tables — reuse facilities_cache and rep_added_facilities; facility.category is free-text so expanded categories are storage-compatible. Overpass remains client-side keyless mirroring existing reverseGeocode pattern. Mapping keeps backward compat: old rows with "Clinic/Diagnostic" or "Other health facility" still match via FACILITY_FILTER_KEYS legacy keys.

## Verification

**Commands:**
- `npm test -- src/lib/geo.test.js src/modules/live-activity/places.test.js` -- expected: all tests pass including new category/filter cases
- `npm run build` -- expected: vite build clean (existing chunk warning only)
- `npm test` -- expected: full CareHub suite passes (no regression for other business types)

**Manual checks (if no CLI):**
- Open Live Field Activities as Manufacturer/Importer, allow GPS, open Facility Visited, confirm nearby Hospitals, Pharmacies, Labs, Clinics and Other facilities can appear; test filters individually; select Pharmacy and confirm it logs as Facility Visited; repeat for another business_type to confirm no regression.
