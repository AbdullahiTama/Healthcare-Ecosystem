# Maps: Google Maps with an OpenStreetMap fallback

Last updated 2026-11-18. Owner decision (2026-11-18): the map **display** switches to Google Maps; place **data**
(nearby facilities, address lookup) stays on OpenStreetMap services for now (Overpass, Nominatim).

## What uses it

| Screen | Component |
|---|---|
| CareHub › Field team › Team map | `apps/carehub/src/components/maps/MapView.jsx` (label "Team map") |
| CareHub › Admin › Directory › Map | the same component (label "Directory map") |
| CareFind › Business discovery (map view) | `apps/carefind/src/modules/business-discovery/components/ResultsMap.jsx` |
| CareFind › Shop order and public tracking | `apps/carefind/src/components/shop/DeliveryTrackingMap.jsx` |

All four draw through one engine: `packages/design-system/src/components/maps/mapEngine.js`
(`openMap(element, options)` → `setMarkers`, `fitTo`, `onViewChange`, `destroy`).

## Choosing the provider

1. **Google Maps** (Maps JavaScript API) when the build has `VITE_GOOGLE_MAPS_BROWSER_KEY` (or the alias
   `VITE_GOOGLE_MAPS_API_KEY`). The script is loaded once per page, only when a map is shown.
2. **OpenStreetMap through Leaflet** when there is no key, the script fails or takes over 12 s, or Google rejects the
   key after loading (`gm_authFailure`: site not allowed, API not enabled, billing off). A rejected key switches the
   open maps to OpenStreetMap and redraws the same markers and view; the browser console says why.
3. If the fallback cannot load either, the screen says "The map could not be loaded" and the list beside it keeps
   working.

The apps read the key (`components/maps/mapProvider.js` in each app) and hand the engine their own Leaflet loader;
the shared package has no dependencies.

## Rules every map follows

- **Popups are DOM nodes built from text**, never HTML strings: names and addresses are typed by people.
  (`DeliveryTrackingMap` used to interpolate the pickup station's name and the address into HTML; fixed here.)
- Markers are coloured circles on both providers (no image assets).
- Each map has an accessible name (`role="region"`, `aria-label`), a loading state and a failure message.
- Maps that sit inside a scrolling page (delivery tracking) do not capture the mouse wheel: Google uses cooperative
  gestures (two fingers / ctrl + wheel).

## The key (security and cost)

- A `VITE_` variable is compiled into the page, so the key is **public**. Protect it in Google Cloud: application
  restriction **HTTP referrers** (the production domains of both apps, plus Vercel preview domains if previews should
  show Google), API restriction **Maps JavaScript API** only. No server key exists or is needed for display.
- Each page view that shows a map is a Google map load, billed above Google's monthly free allowance. Set a budget alert.
- Vercel inlines the key at build time: after adding or changing it, redeploy.
- Uses the classic `google.maps.Marker` (deprecated by Google in favour of Advanced Markers, which need a Map ID;
  still supported). Moving to Advanced Markers is a later, contained change in `mapEngine.js`.

## Attribution

Google draws its own attribution. The OpenStreetMap fallback shows "© OpenStreetMap contributors". Screens that show
OpenStreetMap **data** (Directory › Map, directory profiles of OSM-sourced listings) keep their ODbL credit whatever
the base map is.

## Not changed

Place data and geocoding (Overpass, Nominatim, `VITE_GOOGLE_PLACES_PROXY`). The directory profile's shared location
link and directions now open Google Maps (no key needed).

## Tests

`apps/carehub/src/components/maps/__tests__/mapEngine.test.js` (provider choice, fallbacks including a rejected key,
Google drawing, popups, fit, view events, script loading and timeout), `MapView.test.jsx`, `popupContent.test.js`;
`apps/carefind/src/components/maps/__tests__/maps.test.jsx` (both CareFind maps, text-only popups, loading and failure).
**Not verified here:** rendering with the production key in a browser (the key is only in Vercel).
