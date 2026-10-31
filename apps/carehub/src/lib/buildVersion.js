// ── Which build is this device running? ───────────────────────────────────────
// Each production build stamps an id into the bundle (__BUILD_ID__, see
// vite.config.js) and publishes the same id at /version.json. A device that
// keeps a screen open never downloads a new bundle by itself: the old
// `vite:preloadError` reload in main.jsx fires only when a not-yet-loaded route
// chunk is missing. That is how a counter device kept computing "Sales today"
// with a superseded rule for days (docs/audits/2026-10-31-financial-figures-
// consistency-audit.md, F1). Comparing the two ids closes that gap.

/* global __BUILD_ID__ */
export const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : null

export const VERSION_URL = '/version.json'

// The id of the build currently deployed, or null when it cannot be read (no
// connection, an older deployment without the file). Null never triggers a reload.
export async function fetchDeployedBuildId(fetchImpl = (...a) => fetch(...a)) {
  try {
    const res = await fetchImpl(`${VERSION_URL}?t=${Date.now()}`, { cache: 'no-store' })
    if (!res || !res.ok) return null
    const body = await res.json()
    return typeof body?.buildId === 'string' && body.buildId ? body.buildId : null
  } catch (e) {
    return null
  }
}

export function isOutdated(deployedId, currentId = BUILD_ID) {
  return !!deployedId && !!currentId && deployedId !== currentId
}
