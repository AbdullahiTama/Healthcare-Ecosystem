---
title: 'CareFind Smart Facility Discovery & Live Field Intelligence Engine'
type: 'feature'
created: '2026-09-04'
status: 'in-progress'
baseline_commit: 'ed76e37320e14bec16401765ee96d1f4811fa79b'
review_loop_iteration: 0
context:
  - 'docs/PROJECT_OVERVIEW.md'
  - 'knowledge/modules/field-activity.md'
  - 'apps/carehub/src/lib/geo.js'
  - 'apps/carehub/src/lib/places.js'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Live Field Activity is a 200 m hospital-biased finder (hard-coded `places.js:36`/`LiveActivity.jsx:461`/`FacilityPicker.jsx:49`), narrow Overpass types, no cross-State/LGA/city/area/Nigeria search, no boundary-aware area mode, no multi-source merge/dedupe/rank/confidence/verification, no export — cannot answer "what health businesses exist in this State/LGA/city/Nigeria?"

**Approach:** Build one reusable Facility Discovery engine (GPS + reverse-geocode + boundary + multi-source merge/dedupe/rank/paginate) shared by upgraded Live Field Activity (remove 200 m cap, progressive/area modes, correct categories) and new Smart Facility Discovery tab (location-first filters + paginated exportable results).

## Boundaries & Constraints

**Always:** CareFind `businesses` primary internal source; keep `business_id`+RLS (`is_business_manager` `permissions.js:197`); keep 3-state verification `geo.js:231` (≤150 m verified, pending rep-added never verifies, unverified) distance-only never blocks submit; keep manager review + `facilities_cache` UNIQUE; respect provider limits/billing/attribution; normalize→dedupe→score before display.

**Ask First:** Storing/exporting Google Places beyond allowed caching; adding `lga`/`area` columns or cache tables; proxying Overpass/Google via Edge Function; ingesting PCN/MLSCN/NAFDAC as primary directory vs enrichment.

**Never:** Second disconnected facility DB; present external discovery as officially verified; reimpose 200 m or 20-result caps; gate visibility by `business_type` or physical location; weaken auth/RLS; bypass provider terms.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Nearby | GPS fix | Closest first, distance, rank distance×confidence×verification; no hidden cap | Provider fail → degrade to cache + internal |
| Cross-State | User in Ogun, State=Lagos | Lagos-boundary results, paginated, distance from Lagos centre | No GPS required; boundary else geocoded centre+state filter |
| LGA/City/Area | State+LGA / city / area | LGA/boundary or geocoded centre search | Unknown → geocode fallback + empty state |
| Nigeria-wide | Mode=Nigeria | State-by-state partitioned, merged, deduped, paginated | Infinite scroll; large export as background job |
| Category | All/Hospital/Pharmacy/Clinic/MedCentre/Lab/Dental/Eye/Physio/PHC/Aesthetic/Cosmetics/Spa/Manufacturer/Importer/Distributor/Other | Bucket via `matchesCategory` families; All=every | Unknown→All (fail-open) |
| Dedup | Same in CareFind+Google+OSM | One merged record, retains source refs, highest confidence | Ambiguous→separate + low confidence |
| No GPS/empty | Denied / zero rows | Empty state + "Add this facility" | Never blocks Log submit; verification=unverified |
| Export | Filtered >1k rows | CSV + PDF (criteria/date/count/table); background job with progress | Respect provider export restrictions |

</frozen-after-approval>

## Code Map

- `apps/carehub/src/lib/geo.js:19-38,45-72,131-212,343-355` -- FACILITY_CATEGORY + families + categoryFromAmenity + matchesCategory; expand to 16, keep legacy aliases.
- `apps/carehub/src/lib/places.js:25-38,60-70,87-103,108-151,303-338` -- Overpass regexes, buildOverpassQuery, dedupeKey/merge, readCachedNearby (JS haversine, rep_added no address), nearbyHealthFacilities (cache→Overpass, 5/150) — remove 200 m hard default, add expandable/area modes + source aggregation.
- `apps/carehub/src/services/supabase.js:557-606,72-83` -- reverseGeocode/geocodePlace (Nominatim) + BUSINESS_PUBLIC_COLUMNS (no lga/area); facility_* preserved.
- `apps/carehub/src/modules/live-activity/LiveActivity.jsx:445-475,511-545` -- openLogger 200 m hard-code, verification compute — wire shared engine, add Nearby/Expanded/Area controls.
- `apps/carehub/src/modules/live-activity/FacilityPicker.jsx:44-70,114-240` -- picker 200 m hard-code, FACILITY_FILTERS pills, 150 banner — generalize to engine props + source/verification badge.
- `apps/carehub/src/lib/permissions.js:213-216,219-256,281-285` + `apps/carehub/src/pages/dashboard/BusinessDashboard.jsx:88-95,218-223` -- ENTERPRISE_TYPES gate + NAV_ORDER.enterprise — add sibling `discovery` module after activity (`/dashboard/discovery`).
- `apps/carehub/sql/20260822_field_activity_facility_location.sql + 20260823_facility_review_authorization.sql + 20260823_field_activity_pending_review.sql` -- facilities_cache/rep_added_facilities + RLS — reuse, add businesses lga/area + indexes.
- `apps/carefind/src/modules/healthcare-discovery/Search.jsx:25-30,125-196` + `apps/carehub/src/config/constants.js:4-20` -- NG_STATES vs NIG_STATES duplicate, range 0-39 — unify single source.
- New: `apps/carehub/src/lib/nigeriaGeo.js` -- 37 States + 774 LGAs, getLgasForState, normalizeState, resolveLocation (centre/boundary/label).
- New: `apps/carehub/src/lib/facilityDiscovery.js` -- shared engine: resolveLocation→fetchSources (CareFind+Overpass+optional Google Places New via Edge Function tiled)→normalize→dedupe (~50 m+name/phone/domain)→score→rank→paginate/export.
- New: `apps/carehub/src/modules/facility-discovery/*` -- Smart Facility Discovery: filter bar + result list (distance/source/verification/confidence) + pagination + export.

## Tasks & Acceptance

**Execution:**
- [x] `apps/carehub/src/config/constants.js + lib/nigeriaGeo.js` (new) -- single NG_STATES source + 774 LGAs JSON; `getLgasForState`, `normalizeState`, `resolveLocation({mode,state,lga,city,coords})→{centre,boundary,lga,state,label}` via Nominatim fallback.
- [x] `apps/carehub/src/lib/geo.js` -- expand FACILITY_CATEGORY to 16 (Hospital, Pharmacy, Clinic/Medical Centre, Specialist Clinic, Lab/Diagnostic, Dental, Eye/Optometry, Physio/Rehab, PHC/Community, Aesthetic, Cosmetics/Beauty, Spa, Manufacturer, Importer, Distributor, Other); map OSM amenity|healthcare|shop synonyms; keep OTHER fallback + legacy aliases.
- [x] `apps/carehub/src/lib/places.js + lib/facilityDiscovery.js` (new) -- remove hard 200 m (Nearby default 500-1000 m progressive; Area/State/LGA/Nigeria boundary-driven not point-radius); add source layer (CareFind paged `(state,lga,city)` + Overpass + optional Google Places New via Edge Function, partition large areas per provider limits, attribution); keep cache-then-live, dedupeKey 5-dec, rank nearest-first, pagination via cursor not fixed 150 UI cap; extend matchesCategory families to 16 buckets.
- [x] `apps/carehub/src/lib/facilityDiscovery.js` -- dedupe (coord tolerance + normalized name + phone/address/domain, AI stub), confidence (source agreement, coord quality, category, verification, freshness), verification 6-level → verificationStatus+confidence, source transparency (`source`, `sourceRef/url` where allowed).
- [x] `apps/carehub/sql/*` -- migration: `businesses.lga` + `area` text nullable + indexes `businesses(state,lga,city)`, `facilities_cache(business_id)`, `rep_added_facilities(business_id,status)`; note PCN/MLSCN/NAFDAC as enrichment.
- [x] `apps/carehub/src/modules/live-activity/LiveActivity.jsx + FacilityPicker.jsx` -- capture accuracy+timestamp; reverseGeocode → address/LGA/State; wire shared engine; replace 200 m with Nearby/Expanded/Area controls; correct category (never default Other when known); keep Add-only-when-missing; preserve 3-state badges, hide distance when pending.
- [x] `apps/carehub/src/lib/permissions.js + pages/dashboard/BusinessDashboard.jsx` -- add MODULES.discovery (ENTERPRISE_TYPES, ecosystem, after activity) + NAV_ORDER ordering + bareGuard route `/dashboard/discovery`.
- [x] `apps/carehub/src/modules/facility-discovery/FacilityDiscovery.jsx` + components -- filter bar (Mode Current|Selected|State|LGA|City-Area|Nigeria; State 37 searchable; LGA dynamic; City/Area searchable; Category 16; Distance optional for point search; Verification 6; Source All/CareFind/Google/OSM/Regulatory/Other; Keyword; Sort Distance|Name|Category|Verification|Updated) + cards (name/category/address/LGA/State/phone/lat-lng/distance/source/verification/confidence) + server pagination + infinite loading + loading/error/empty/a11y responsive.
- [x] `apps/carehub/src/modules/facility-discovery/export.js` -- filter-aware CSV (+Excel) and PDF (criteria/date/count/table name/category/address/LGA/State/phone/distance/source); large as background job with progress; comply with provider export terms.
- [x] `apps/carehub/src/lib/geo.test.js + modules/live-activity/places.test.js + modules/facility-discovery/*.test.*` -- tests: nigeriaGeo State→LGAs, 16-category mapping, Overpass healthcare/shop, dedupe/confidence/verification, engine modes (Nearby vs State vs Nigeria partitioning), filter→query wiring; no 200 m cap regression.

**Acceptance Criteria:**
- Given rep at GPS with nearby pharmacy/lab/clinic/spa/hospital, when opening Live Nearby, then multiple categories appear nearest-first and any logs with correct category (not Other when known)
- Given facility just beyond 200 m, when Expanded/Area mode, then it is discoverable (no 200 m code or UX cap remains)
- Given user in Ogun selecting State=Lagos or LGA/city "Lagos", when searching, then Lagos-bound facilities appear (distance from selected centre) without moving GPS
- Given State/LGA search with provider limits, when querying, then backend partitions, merges, dedupes and paginates (no 20-result cap; cursor/infinite; export covers full filtered set)
- Given duplicate across CareFind+OSM+Google, when rendered, then single merged record with retained sourceRefs, source badges, confidence and 6-level verification (external never shows officially verified unless verified)
- Given filtered results, when exporting, then PDF has criteria/date/count/table and CSV has name/category/address/LGA/State/phone/distance/source; large sets background job with status; provider restrictions respected
- Given test coordinates from screenshots, when searching, then facilities across categories appear (not only Hospital) with distance when reference exists
- Given both surfaces, when inspecting code/network, then both call same shared discovery service (no duplicate DB, no business_type category gate)

## Spec Change Log

## Design Notes

Pipeline: `resolveLocation`→`fetchSources` (CareFind `(state,lga,city)` + Overpass tiled + optional Google Places New per tile via Edge Function)→`normalize`→`dedupe`→`score`→`rank`→`paginate`/`export`. `places.js` stays transport+cache; intelligence in `facilityDiscovery.js`. Nigeria: `states:[{name,lgas:[...]}]` 774 LGAs.

## Verification

**Commands:**
- `npm test -- src/lib/geo.test.js src/modules/live-activity/places.test.js` -- 16 cats, Overpass healthcare/shop, dedupe/confidence green
- `npm test -- src/modules/facility-discovery` -- State→LGA, Search Modes, dedupe, no 200 m cap
- `npm run build` -- vite build clean
- `npm test` -- full suite passes (447+; no regression)
