// Nigeria's 36 states and the FCT — used to normalise and sanity-check the
// `state` column. Display names are the ones used across CareHub territories.
export const NIGERIA_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River',
  'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'Federal Capital Territory', 'Gombe', 'Imo', 'Jigawa',
  'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo',
  'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
]

const STATE_ALIASES = {
  fct: 'Federal Capital Territory',
  abuja: 'Federal Capital Territory',
  'fct abuja': 'Federal Capital Territory',
  'abuja fct': 'Federal Capital Territory',
  'federal capital territory abuja': 'Federal Capital Territory',
  'akwa-ibom': 'Akwa Ibom',
  'cross-river': 'Cross River',
}

/**
 * "Lagos State" / "lagos" / "FCT" -> canonical state name, or null when the
 * text is not a known Nigerian state (callers keep the original and warn).
 */
export function canonicalState(text) {
  const k = String(text ?? '').toLowerCase().replace(/\bstate\b/g, '').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!k) return null
  if (STATE_ALIASES[k]) return STATE_ALIASES[k]
  return NIGERIA_STATES.find((s) => s.toLowerCase() === k) || null
}

export const VERIFICATION_STATUS = {
  unverified: { label: 'Unverified', tone: 'gray' },
  verified: { label: 'Verified', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
}

export const DATA_SOURCE = {
  manual: { label: 'Manual entry' },
  import: { label: 'Imported' },
  external: { label: 'External source' },
  demo: { label: 'DEMO DATA' },
}

export const RADIUS_PRESETS_KM = [1, 3, 5, 10, 25]
