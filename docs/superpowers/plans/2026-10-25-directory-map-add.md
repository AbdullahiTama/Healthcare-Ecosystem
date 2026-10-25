# Directory Map Add Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Map tab in the admin Directory that shows OpenStreetMap businesses of the platform's categories and adds one to the directory through the existing form.

**Architecture:** A pure OpenStreetMap module (query by bounding box, parse with tags kept, map tags to platform category names); a pure matcher against existing listings (OSM id or the duplicate engine); the shared Leaflet wrapper with click and view callbacks; a MapTab component wired into BusinessDirectory's existing prefill → BusinessForm → saveBusiness path. No database change.

**Tech Stack:** React 18, Leaflet 1.9, vitest.

**Spec:** `docs/superpowers/specs/2026-10-25-directory-map-add-design.md`

## Global Constraints

- Platform admin only (BusinessDirectory `platformMode`); the tab is not offered to companies.
- One Overpass request per "Show businesses here" press; only at zoom ≥ 13; results capped at 300.
- Added rows: `data_source: 'external'`, `source_detail: 'OpenStreetMap <type>/<id>'`, verification left to the DB default (unverified).
- Only OpenStreetMap businesses whose mapped category is an active platform category are shown.
- OpenStreetMap text is untrusted: text nodes only; websites linked only when http(s).
- One commit per task; explicit paths; `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A business added from the map, searched again, shows as "Already listed" (OSM id match), even if renamed in the directory.
2. An OSM element without a name is not offered (an unnamed pharmacy cannot be listed sensibly).
3. A website like `javascript:alert(1)` is shown as text, never as a link.
4. Pressing search while a previous search is still running does not let the older answer overwrite the newer.
5. A mapped category that is inactive or missing on the platform hides those businesses.

---

### Task 1: Shared map component (refactor + callbacks)

Move `modules/live-activity/teamMap/LeafletMap.jsx` to `components/maps/LeafletMap.jsx` (refactor commit; the Team map imports the new path, its tests unchanged). Then add optional props `onPinClick(pin)`, `onViewChange({ south, west, north, east }, zoom)` (on load and on moveend) and `fit = true`, plus tones `new`, `listed`, `duplicate`. Test with a fake Leaflet module: clicking a marker calls `onPinClick` with the pin; moveend calls `onViewChange` with bounds and zoom; `fit={false}` never calls `fitBounds`.

### Task 2: OpenStreetMap module

`modules/business-directory/mapAdd/osmBusinesses.js`:
- `buildBboxQuery({ south, west, north, east })` (amenity, healthcare, shop with the tag lists below; `out center 300`).
- `parseOsmBusinesses(data)` → `[{ ref: 'node/123', name, lat, lng, tags, address, state, lga, city, phone, website, openingHours }]`, skipping unnamed elements and duplicates of the same ref.
- `OSM_CATEGORY_RULES` and `suggestCategory(tags, categories)` → the active platform category (by name, case-insensitive) or null.
- `fetchOsmBusinesses(bounds, { fetchImpl = fetch })` → parsed list; throws `Error('OpenStreetMap is busy or unreachable. Try again in a moment.')` on HTTP or network failure.
- `safeWebsite(url)` → the URL if http(s), else null.

### Task 3: Matcher

`mapAdd/matchListings.js`: `matchToDirectory(osmBusinesses, existingListings, categories)` → each business plus `{ category, status: 'new'|'listed'|'duplicate', match }`; drops businesses with no category. `listed` when an existing listing's `source_detail` is `OpenStreetMap <ref>` or the duplicate engine says confirmed; `duplicate` when it says possible.

### Task 4: Map tab, form prefill, credit

`mapAdd/MapTab.jsx` + BusinessDirectory wiring (`TABS` gains Map in platform mode; prefill `{ fromMap: ref, name, category_id, address, state, lga, city, latitude, longitude, phone, website, opening_hours, data_source: 'external', source_detail }`; `saveBusiness` carries `source_detail`; after saving, the tab re-matches). BusinessProfile shows the OpenStreetMap credit for such rows. Tests: zoom-in prompt below 13; search loads and pins with statuses; filters; details panel with safe website; add opens the form pre-filled; a later answer cannot overwrite a newer search; error with retry; empty state; credit on the profile.

### Task 5: Verification

Full suite, build, lint; self-review.
