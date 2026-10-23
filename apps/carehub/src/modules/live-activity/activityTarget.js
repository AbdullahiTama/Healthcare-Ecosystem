// What a report says it was about, in one place, so the feed card, the table and
// the export cannot disagree.
import { FACILITY_VERIFICATION, FACILITY_VERIFY_THRESHOLD_M, LOW_ACCURACY_M } from '../../lib/geo'

//
// A new report names AT MOST ONE target, chosen by the rep:
//   directory : a business in the company directory (directory_business_*)
//   facility  : a place from map data or added by a colleague (facility_*)
// Older reports could carry both. The GPS pin (lat/lng) and the distance to the
// place are location EVIDENCE: they say where the phone was, not that a visit or
// an interaction took place.
//
// `location_label` is only a caption. It was historically filled with the
// facility's own name, so it is an area description ("near ...") only when it
// differs from every name the report carries.

// What the feed shows for a saved report's location match. facility_verified stays true only for a solid
// match, so coverage figures do not change; "uncertain" is derived here from the stored distance and the
// stored GPS accuracy, with the same rule as facilityVerification. A row with no accuracy (every report
// saved before accuracy was kept) can only be verified, pending or unverified, as before.
export function storedVerification(a) {
  if (a.facility_verified != null ? a.facility_verified : a.place_verified) return FACILITY_VERIFICATION.VERIFIED
  if (a.facility_pending_review) return FACILITY_VERIFICATION.PENDING
  const accuracy = a.gps_accuracy_m
  const distance = a.facility_distance_m
  if (Number.isFinite(accuracy) && accuracy > LOW_ACCURACY_M && Number.isFinite(distance) &&
      distance <= FACILITY_VERIFY_THRESHOLD_M + accuracy) {
    return FACILITY_VERIFICATION.UNCERTAIN
  }
  return FACILITY_VERIFICATION.UNVERIFIED
}

export function facilityName(a) {
  return a.facility_name || a.place_of_visit || ''
}

export function directoryName(a) {
  return a.directory_business_name || ''
}

// The area caption, or '' when it merely repeats the target's name.
export function areaLabel(a) {
  const label = (a.location_label || '').trim()
  if (!label) return ''
  const names = [facilityName(a), directoryName(a)].map(function (n) { return n.trim().toLowerCase() })
  return names.indexOf(label.toLowerCase()) >= 0 ? '' : label
}

// Text for the table's Location column and the export.
export function targetLabel(a) {
  const facility = facilityName(a)
  const directory = directoryName(a)
  if (directory && facility && directory.toLowerCase() !== facility.toLowerCase()) return directory + ' / ' + facility
  if (directory || facility) return directory || facility
  const area = areaLabel(a)
  return area ? 'Near ' + area : ''
}

// Plain-words source of a facility target.
export const FACILITY_SOURCE_LABEL = {
  detected: 'Map data',
  rep_added: 'Added by a colleague',
  manual: 'Entered by hand',
}

export function facilitySourceLabel(source) {
  return FACILITY_SOURCE_LABEL[source] || 'Map data'
}
