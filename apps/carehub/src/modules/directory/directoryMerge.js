import { normalizePhone } from '../../lib/facilityDiscovery.js'

// Pure logic for reviewing a merge of an imported row into an existing directory
// business. The database (directory_merge_import_row) is the authority and
// re-checks every rule; this module only decides what to PROPOSE and what to send.
//
// Rules shown to the reviewer, mirrored from the database:
//   * blank existing value        -> can be filled
//   * different existing value    -> kept, unless the reviewer chooses to replace it
//   * verified record             -> existing values are locked (edit it normally instead)
//   * name, verification, source  -> never part of a merge

// Order is display order. 'coordinates' is one unit (latitude + longitude).
export const MERGE_FIELDS = [
  { key: 'category_id', label: 'Category', ids: true },
  { key: 'subcategory_id', label: 'Subcategory', ids: true },
  { key: 'business_type', label: 'Business type' },
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City or town' },
  { key: 'state', label: 'State' },
  { key: 'lga', label: 'LGA' },
  { key: 'coordinates', label: 'Coordinates' },
  { key: 'phone', label: 'Phone', phone: true },
  { key: 'email', label: 'Email' },
  { key: 'website', label: 'Website' },
  { key: 'description', label: 'Description' },
]

const blank = (v) => v === null || v === undefined || String(v).trim() === ''

function pairOf(o) {
  const lat = o && o.latitude, lng = o && o.longitude
  return blank(lat) || blank(lng) ? null : { latitude: Number(lat), longitude: Number(lng) }
}

function sameValue(field, a, b) {
  if (field.phone) return normalizePhone(a) === normalizePhone(b)
  if (field.ids) return String(a) === String(b)
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
}

/**
 * @param record   the planned import record (normalised, as built by the planner)
 * @param existing the directory row it would merge into
 * @returns { locked, fields: [{ key, label, existing, incoming, kind }] }
 *   kind: 'fill' | 'conflict' | 'same'. Fields the import has nothing for are omitted.
 */
export function proposeMerge(record, existing) {
  const locked = !!existing && existing.verification_status === 'verified'
  const fields = []
  for (const f of MERGE_FIELDS) {
    if (f.key === 'coordinates') {
      const inc = pairOf(record), cur = pairOf(existing)
      if (!inc) continue
      if (!cur) fields.push({ key: f.key, label: f.label, existing: null, incoming: inc, kind: 'fill' })
      else if (cur.latitude === inc.latitude && cur.longitude === inc.longitude) fields.push({ key: f.key, label: f.label, existing: cur, incoming: inc, kind: 'same' })
      else fields.push({ key: f.key, label: f.label, existing: cur, incoming: inc, kind: 'conflict' })
      continue
    }
    const inc = record && record[f.key]
    if (blank(inc)) continue
    const cur = existing && existing[f.key]
    if (blank(cur)) fields.push({ key: f.key, label: f.label, existing: null, incoming: inc, kind: 'fill' })
    else if (sameValue(f, cur, inc)) fields.push({ key: f.key, label: f.label, existing: cur, incoming: inc, kind: 'same' })
    else fields.push({ key: f.key, label: f.label, existing: cur, incoming: inc, kind: 'conflict' })
  }
  return { locked, fields }
}

/** Safe default: fill every blank, replace nothing. */
export function defaultSelections(proposal) {
  const sel = {}
  proposal.fields.forEach((f) => { if (f.kind === 'fill') sel[f.key] = 'fill' })
  return sel
}

/**
 * Selections ({ key: 'fill' | 'overwrite' }) -> the p_changes payload.
 * Replacing a value on a verified record is not offered, so it is dropped here
 * (the database would refuse it anyway). Returns null when there is nothing to send.
 */
export function buildMergeChanges(proposal, selections) {
  const changes = {}
  for (const f of proposal.fields) {
    const mode = selections && selections[f.key]
    if (!mode || f.kind === 'same') continue
    if (f.kind === 'fill' && mode !== 'fill' && mode !== 'overwrite') continue
    if (f.kind === 'conflict' && (mode !== 'overwrite' || proposal.locked)) continue
    const m = f.kind === 'fill' ? 'fill' : 'overwrite'
    if (f.key === 'coordinates') {
      changes.latitude = { value: f.incoming.latitude, mode: m }
      changes.longitude = { value: f.incoming.longitude, mode: m }
    } else {
      changes[f.key] = { value: f.incoming, mode: m }
    }
  }
  return Object.keys(changes).length ? changes : null
}

/** One-line description of the effect, for the review list. */
export function summarizeSelections(proposal, selections) {
  const fills = proposal.fields.filter((f) => selections[f.key] && f.kind === 'fill').length
  const repl = proposal.fields.filter((f) => selections[f.key] === 'overwrite' && f.kind === 'conflict' && !proposal.locked).length
  const parts = []
  if (fills) parts.push('fill ' + fills + (fills === 1 ? ' blank' : ' blanks'))
  if (repl) parts.push('replace ' + repl + (repl === 1 ? ' value' : ' values'))
  return parts.length ? parts.join(', ') : 'no changes'
}

export const SKIP_REASON_TEXT = {
  same: 'already the same',
  existing_value_kept: 'existing value kept',
  verified_record: 'record is verified, so existing values are locked',
}
