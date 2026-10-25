# Team map — design

Date: 2026-10-25. Owner: "go ahead with the team map", after choosing a map that updates as things happen over
continuous tracking. Product calls below are the author's unless marked as the owner's.

## Intent

Make the field team's day visible at a glance: where each rep last checked in, where today's visits happened, and
which customers have gone quiet, on a map that updates while the manager watches.

## Scope

Field team section (owner and field managers) at manufacturers and wholesalers. Not on the rep's own page (a
"My day" map is a later option).

## Not continuous tracking (owner's choice, 2026-10-25)

The app records a position only when a rep checks in or logs a visit; nothing watches the phone afterwards. The map
shows those events and never implies a rep is "here now". Continuous tracking would need a native app, a lawful
basis under the NDPA and a retention decision, none of which exist.

## Facts this rests on (live, 2026-10-25)

- Check-ins (`staff_checkins`) are readable by managers only through `manager_checkin_overview`, which writes each
  look to `location_access_log`. The table is not in the realtime publication and has an own-rows-only policy.
- Visits (`field_activities`) are in the realtime publication; managers read them under existing RLS.
- `leaflet` is already a CareHub dependency; OpenStreetMap tiles are used (and credited) elsewhere in the apps.

## What it shows

- **Rep pins**: each rep's last check-in **today**, coloured: checked in within 60 minutes / earlier today / checked
  out. Reps with no check-in today have no pin; the list names them ("not checked in today").
- **Visit pins**: every visit in the chosen range (Today / This week), at the place visited when the report names one
  with a position, otherwise at the phone's GPS position (labelled as such). Visits with neither have no pin and
  appear only in the list.
- **Quiet customers** (a layer, off by default): customers not visited in 30 days that have a position.
- Tapping a pin shows who, what, when, the place and, for a visit, its location-match badge text.
- A list under the map shows the same items (the accessible way to read the map, and the phone-friendly one).
- Filters: range (Today / This week), rep, territory (applies to visits; reps have no territory of their own).

## Live

- Visits: new reports arrive through the existing realtime subscription on `field_activities` and drop onto the map
  and list without a refresh. A line says whether the map is live ("Live", or "Not live: new visits show on refresh").
- Check-ins: refreshed through `manager_checkin_overview` every 5 minutes while the page is visible, and on a
  Refresh button; the page says "Positions as of HH:MM". Each refresh is one logged look, the same as opening Team
  check-ins. Opening raw check-in rows to managers to push them live was rejected: it would bypass the access log.

## Security

No new data access and no database change. Popups are built with DOM text nodes, never HTML strings (names and
places are user-entered). Tiles come from tile.openstreetmap.org with attribution.

## Non-goals

Continuous tracking; routes or trails between points; directory listings the team has not visited; the rep's own map;
clustering (revisit if pins crowd).

## Anti-goals

- A pin that reads as "the rep is here now" when it is an old event.
- Any position a manager could not already see on Team check-ins or Team reports.
- Raw HTML from user data in a popup.

## Builder notes

- Pure model (`teamMapModel.js`) builds pins and list rows from the overview rows, visits and customers; the Leaflet
  wrapper is thin and loaded on demand (`import('leaflet')`, as CareFind's ResultsMap does).
- Use circle markers (no image assets). Fit the view to the pins; default to Lagos.
- Every state: loading, per-source errors with retry, empty ("Nothing to show on the map yet"), responsive height.
