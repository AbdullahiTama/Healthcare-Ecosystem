// Moving between a business's locations (the main business and its branches). Every location is its own business
// row, and auth.brand is the one in use: every repository call is scoped to it. Branches share the owner's email.
//
//   keepReachableLocation  which location a reload keeps (the one the owner chose, if they can still reach it)
//   switchLocation         the ONE way to change location (top-bar switcher and Locations page)
//   registerSwitchBlocker  lets a page with unsaved work (a POS cart) ask before a switch drops it

const MAX_DEPTH = 10

// The location to use after sign-in or a reload. `root` is the owner's main business (resolved from their email);
// `cachedBrand` is the location remembered on this device. It is kept only if it is still active, not deleted, and
// the main business is one of its ancestors; anything else (a shared device, a closed branch, bad data, a failed
// lookup) falls back to the main business.
export async function keepReachableLocation(root, cachedBrand, fetchById) {
  if (!root || !cachedBrand || !cachedBrand.id || cachedBrand.id === root.id) return root
  try {
    const chosen = await fetchById(cachedBrand.id)
    if (!chosen || chosen.status !== 'active' || chosen.deleted_at) return root
    let current = chosen
    for (let depth = 0; depth < MAX_DEPTH && current; depth++) {
      if (!current.parent_business_id) return root
      if (current.parent_business_id === root.id) return chosen
      current = await fetchById(current.parent_business_id)
    }
    return root
  } catch (e) {
    return root
  }
}

// Make `location` the one in use, for the owner. Returns false when it already is (nothing to do). The caller's
// screen remounts because the dashboard's routes are keyed by the business id, so nothing from the previous location
// (a cart, a half-filled form) survives the switch.
export function switchLocation({ auth, setAuth }, location) {
  if (!location || !location.id || (auth && auth.brand && auth.brand.id === location.id)) return false
  const next = { ...auth, brand: location, staff: null, role: 'Owner' }
  setAuth(next)
  try { localStorage.setItem('carehub_auth', JSON.stringify(next)) } catch (e) { /* the switch still applies */ }
  return true
}

const blockers = new Set()

// fn() returns a message when switching now would lose something, or null. Returns the unregister function.
export function registerSwitchBlocker(fn) {
  blockers.add(fn)
  return () => { blockers.delete(fn) }
}

export function switchBlockers() {
  const out = []
  blockers.forEach((fn) => {
    try {
      const msg = fn()
      if (msg) out.push(msg)
    } catch (e) { /* a broken blocker never prevents switching */ }
  })
  return out
}
