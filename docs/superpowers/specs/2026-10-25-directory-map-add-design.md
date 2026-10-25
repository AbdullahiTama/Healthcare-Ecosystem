# Add businesses to the directory from a map — design

Date: 2026-10-25. Owner request: "a feature that adds businesses directly from the map; the map should show the
businesses so users can click and add them to the business directory".

## Decisions

- **Who (owner):** the platform admin only, in the admin console's Directory. Companies still never see the
  directory (owner decision 2026-10-22).
- **Which businesses (owner):** only the kinds the platform directory manages: its active platform categories
  (28 on 2026-10-25: 19 healthcare facility kinds, 9 supplier kinds). Anything else is not shown.
- **Source (owner, on the author's recommendation):** OpenStreetMap through the Overpass API. Free, no key, already
  used by CareHub, and the only source whose data may be kept in the directory (Google's terms forbid storing
  Places data). Licence (ODbL): the directory credits OpenStreetMap wherever a listing from it is shown; if the
  directory is ever published as a dataset, that dataset stays under the same open licence.
- **Status (author's default, unanswered):** a business added from the map comes in **unverified**. The admin
  verifies it with the existing Verify action once the phone and address are confirmed. Reps only ever see verified
  listings (nearby_directory_businesses).

## What the admin gets

Directory (platform mode) → new tab **Map**:

1. A map (OpenStreetMap tiles). The admin moves to an area and presses **Show businesses here**. Nothing is fetched
   while panning: one Overpass request per press, and only when zoomed in enough (about a neighbourhood or a small
   town, zoom 13+), so requests stay small and within Overpass's fair-use policy.
2. The businesses found are pinned and listed, each with its suggested directory category, coloured:
   - **New**: not in the directory, can be added;
   - **Already listed**: the same OpenStreetMap place was added before, or a platform listing with a matching name
     sits within 100 m;
   - **Possible duplicate**: the directory's duplicate engine finds a likely match. It can still be added, after a
     warning.
3. Filters: category (the platform categories found), and "Hide already listed".
4. Clicking a pin or a list row shows the details (name, suggested category, address, phone, website, opening hours,
   OpenStreetMap link). **Add to directory** opens the existing business form, pre-filled:
   - name, category (the suggested one), address, state/LGA/city when OpenStreetMap has them, position, phone,
     website, opening hours;
   - recorded as data source `external`, source detail `OpenStreetMap <type>/<id>`.

   The admin completes what the form requires (for example the state) and saves. The pin turns to "Already listed".
5. Empty, loading, error (Overpass busy or unreachable, with retry), "zoom in to search" and "nothing of the managed
   kinds here" states. On a phone the list sits under the map.

The listing's profile shows "Data from OpenStreetMap contributors (ODbL)" with a link, when its source detail is
OpenStreetMap.

## Category mapping

OpenStreetMap tags → platform category names, for example: amenity=pharmacy / shop=chemist → Pharmacy;
amenity=hospital → Hospital; amenity=clinic / amenity=doctors → Clinic; amenity=dentist / healthcare=dentist →
Dental Clinic; healthcare=laboratory → Medical Laboratory; healthcare=optometrist / shop=optician → Eye
Clinic/Optometry; healthcare=physiotherapist → Physiotherapy/Rehabilitation; healthcare=centre → Medical Centre;
amenity=health_post / healthcare=primary → Primary Healthcare Centre; amenity=birthing_center /
healthcare=birthing_centre → Maternity; shop=medical_supply → Medical Equipment Supplier; shop=cosmetics →
Cosmetics Business. A mapping whose category is not an active platform category is dropped, so the map can never
show a kind the platform does not manage. The full table lives in one module and is unit-tested.

## Security

No database change and no new access: the admin console and the directory writes are already platform-admin only
(RLS). Data from OpenStreetMap is user-contributed, so it is treated as untrusted text: popups and details are built
from text nodes; website values are only linked if they are http(s). The Overpass request goes from the admin's
browser straight to overpass-api.de, as the field facility lookup already does.

## Non-goals

Bulk import of a whole area (one business at a time, reviewed); Google or other paid sources; editing OpenStreetMap;
showing this map to companies or reps; automatic verification.

## Anti-goals

- A business added twice because the admin could not see it was already listed.
- A kind of business the platform does not manage appearing on the map.
- An admin panning around firing a request per movement.
- OpenStreetMap text rendered as HTML.

## Builder notes

- Move the Team map's LeafletMap to a shared `components/maps/` (a refactor), and give it optional `onPinClick`,
  `onViewChange(bounds, zoom)` and `fit` props; the Team map keeps its behaviour.
- `BusinessDirectory.jsx` already opens BusinessForm pre-filled (the Suggestions flow); the new tab uses the same
  path. `saveBusiness` must carry `source_detail` through (the form does not have that field).
- Duplicate checks: existing listings near the searched area via `repo.searchWithinBox`; the engine's `classify`.
