// Active posting identity — stored per device in the browser.
// null / no value  => posting as yourself (personal)
// { id, name }     => posting as that business (existing behavior, unchanged)
// staff identity   => posting as an approved CareFind rep position (new)

const BUSINESS_KEY = 'carefind_active_business'
const STAFF_KEY = 'carefind_active_staff'

export function getActiveBusiness() {
  try {
    const raw = localStorage.getItem(BUSINESS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function setActiveBusiness(business) {
  try {
    if (business) {
      localStorage.setItem(BUSINESS_KEY, JSON.stringify({ id: business.id, name: business.name }))
      // Only one identity can be active at a time
      localStorage.removeItem(STAFF_KEY)
    } else {
      localStorage.removeItem(BUSINESS_KEY)
    }
    window.dispatchEvent(new Event('identity-changed'))
  } catch {
    // ignore storage errors
  }
}

export function clearActiveBusiness() {
  setActiveBusiness(null)
}

// Staff identity — an approved claim: { staffId, fullName, publicTitle, businessId, businessName }
export function getActiveStaffIdentity() {
  try {
    const raw = localStorage.getItem(STAFF_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function setActiveStaffIdentity(identity) {
  try {
    if (identity) {
      localStorage.setItem(STAFF_KEY, JSON.stringify({
        staffId: identity.staffId,
        fullName: identity.fullName,
        publicTitle: identity.publicTitle,
        businessId: identity.businessId,
        businessName: identity.businessName,
      }))
      // Only one identity can be active at a time
      localStorage.removeItem(BUSINESS_KEY)
    } else {
      localStorage.removeItem(STAFF_KEY)
    }
    window.dispatchEvent(new Event('identity-changed'))
  } catch {
    // ignore storage errors
  }
}

export function clearActiveStaffIdentity() {
  setActiveStaffIdentity(null)
}

// Convenience: whichever identity is active right now, tagged with its type.
// Returns null if posting as yourself.
export function getActiveIdentity() {
  const staff = getActiveStaffIdentity()
  if (staff) return { type: 'staff', ...staff }
  const biz = getActiveBusiness()
  if (biz) return { type: 'business', ...biz }
  return null
}
