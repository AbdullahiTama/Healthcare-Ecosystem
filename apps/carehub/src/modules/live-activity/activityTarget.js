// What a report says it was about, in one place, so the feed card, the table and
// the export cannot disagree.
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
