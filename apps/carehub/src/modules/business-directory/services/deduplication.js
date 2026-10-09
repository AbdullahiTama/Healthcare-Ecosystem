// ── BusinessDeduplication ─────────────────────────────────────────────────────
// Exact-name matching is not enough: the same business turns up as "Alpha
// Pharmacy Ltd", "ALPHA PHARMACY LIMITED" and "Alpha Pharmcy" with a
// different address spelling. This engine compares normalised name, phone,
// address, coordinates, website and category, and classifies a candidate as
//
//   new                 safe to import
//   possible_duplicate  an administrator must review
//   confirmed_duplicate do not import (offered: Keep existing / Skip)
//
// Comparing every candidate with every existing record is O(n·m) — a
// 5,000-row file against a 20,000-record directory would be 100M comparisons.
// A blocking index narrows each candidate to the handful of records that share
// a phone, a website, a rare name token, or a ~1 km map cell with it.

import { haversineKm } from './distance'
import { similarity } from './similarity'

export const DUP_STATUS = {
  NEW: 'new',
  POSSIBLE: 'possible_duplicate',
  CONFIRMED: 'confirmed_duplicate',
}

export const RESOLUTION = {
  KEEP_EXISTING: 'keep_existing',
  IMPORT_NEW: 'import_new',
  MERGE: 'merge',
  SKIP: 'skip',
}

// Social/link-in-bio hosts identify a platform, not a business.
const GENERIC_HOSTS = new Set([
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com', 'wa.me',
  'linktr.ee', 'youtube.com', 'tiktok.com', 'google.com', 'sites.google.com',
  'wixsite.com', 'business.site', 'blogspot.com', 'wordpress.com',
])

const MAX_BUCKET = 150 // a name token shared by more records than this ("pharmacy") blocks nothing useful
const CELL = 100 // 1/100 degree ≈ 1.1 km

const cellKey = (lat, lng) => Math.floor(lat * CELL) + '_' + Math.floor(lng * CELL)
const tokensOf = (n) => String(n || '').split(' ').filter((t) => t.length >= 3)

function push(map, key, rec) {
  let arr = map.get(key)
  if (!arr) { arr = []; map.set(key, arr) }
  arr.push(rec)
}

export function createDedupIndex(records = []) {
  const index = { byPhone: new Map(), byHost: new Map(), byToken: new Map(), byCell: new Map(), size: 0 }
  records.forEach((r) => addToIndex(index, r))
  return index
}

export function addToIndex(index, rec) {
  index.size++
  if (rec.phone_normalized) push(index.byPhone, rec.phone_normalized, rec)
  if (rec.website_host && !GENERIC_HOSTS.has(rec.website_host)) push(index.byHost, rec.website_host, rec)
  tokensOf(rec.name_normalized).forEach((t) => push(index.byToken, t, rec))
  if (rec.latitude != null && rec.longitude != null) push(index.byCell, cellKey(Number(rec.latitude), Number(rec.longitude)), rec)
}

function candidatesFor(index, c) {
  const seen = new Set()
  const out = []
  const take = (arr) => {
    if (!arr) return
    for (const r of arr) {
      const k = r.id ?? r
      if (!seen.has(k)) { seen.add(k); out.push(r) }
    }
  }
  if (c.phone_normalized) take(index.byPhone.get(c.phone_normalized))
  if (c.website_host && !GENERIC_HOSTS.has(c.website_host)) take(index.byHost.get(c.website_host))
  // Distinctive tokens first: skip the over-common ones unless nothing else is left.
  const toks = tokensOf(c.name_normalized)
  const useful = toks.filter((t) => (index.byToken.get(t)?.length || 0) <= MAX_BUCKET)
  ;(useful.length ? useful : toks).forEach((t) => take(index.byToken.get(t)))
  if (c.latitude != null && c.longitude != null) {
    const la = Math.floor(Number(c.latitude) * CELL)
    const ln = Math.floor(Number(c.longitude) * CELL)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) take(index.byCell.get((la + dy) + '_' + (ln + dx)))
  }
  return out
}

/** Compare two records. Exposed for tests and for showing "why" in the review UI. */
export function compareRecords(c, e) {
  const nameSim = similarity(c.name_normalized, e.name_normalized)
  const addrSim = c.address_normalized && e.address_normalized ? similarity(c.address_normalized, e.address_normalized) : null
  const hasGeo = c.latitude != null && c.longitude != null && e.latitude != null && e.longitude != null
  const distKm = hasGeo ? haversineKm(Number(c.latitude), Number(c.longitude), Number(e.latitude), Number(e.longitude)) : null
  const phoneEq = !!c.phone_normalized && c.phone_normalized === e.phone_normalized
  const hostEq = !!c.website_host && !GENERIC_HOSTS.has(c.website_host) && c.website_host === e.website_host
  const sameCategory = !!c.category_id && c.category_id === e.category_id
  const near = distKm !== null && distKm <= 0.15
  const apart = distKm !== null && distKm > 1

  const reasons = []
  let level = 0 // 0 none, 1 possible, 2 confirmed
  const raise = (lv, why) => { if (lv > level) level = lv; reasons.push(why) }

  if (nameSim >= 0.97) reasons.push('same name')
  else if (nameSim >= 0.85) reasons.push('very similar name')
  if (phoneEq) reasons.push('same phone')
  if (hostEq) reasons.push('same website')
  if (addrSim !== null && addrSim >= 0.9) reasons.push('same address')
  else if (addrSim !== null && addrSim >= 0.6) reasons.push('similar address')
  if (near) reasons.push('within 150 m')

  const sameAddress = addrSim !== null && addrSim >= 0.9
  if (phoneEq && nameSim >= 0.85) raise(2, 'phone')
  else if (phoneEq) raise(1, 'phone')
  if (hostEq && nameSim >= 0.85) raise(2, 'website')
  else if (hostEq) raise(1, 'website')
  if (nameSim >= 0.97 && (sameAddress || near)) raise(2, 'name+place')
  // Coordinates trump address text: "Plot 4 … Avenue" exists in every city, a 1 km+ gap is decisive.
  if (nameSim >= 0.85 && !apart && ((addrSim !== null && addrSim >= 0.6) || (distKm !== null && distKm <= 0.5))) raise(1, 'name~place')
  if (nameSim >= 0.92 && sameCategory && !apart) raise(1, 'name~category')
  if (nameSim >= 0.7 && near) raise(1, 'name~near')
  if (sameAddress && !apart && nameSim >= 0.6) raise(1, 'address')

  // Same chain, different branch: identical contact details cannot make two
  // places 1 km+ apart the same business — send them to a human instead.
  if (level === 2 && apart) level = 1

  const score = Math.min(1,
    nameSim * 0.5 + (phoneEq ? 0.3 : 0) + (hostEq ? 0.15 : 0) + (addrSim || 0) * 0.15 + (near ? 0.1 : 0) + (sameCategory ? 0.05 : 0))
  return { level, score, nameSim, addrSim, distKm, reasons: [...new Set(reasons)] }
}

/** Classify one candidate against the index. */
export function classify(candidate, index) {
  let best = null
  for (const e of candidatesFor(index, candidate)) {
    const r = compareRecords(candidate, e)
    if (r.level === 0) continue
    if (!best || r.level > best.level || (r.level === best.level && r.score > best.score)) best = { ...r, match: e }
  }
  if (!best) return { status: DUP_STATUS.NEW, match: null, score: 0, reasons: [] }
  return {
    status: best.level === 2 ? DUP_STATUS.CONFIRMED : DUP_STATUS.POSSIBLE,
    match: best.match,
    score: best.score,
    reasons: best.reasons,
  }
}

const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Classify many candidates without freezing the tab: work is done in slices and
 * control is handed back to the event loop between them.
 *
 * Candidates that are not duplicates of an existing record are added to the
 * index as they are processed, so the second copy of a business inside the same
 * file is caught against the first (`in_file: true`).
 */
export async function classifyBatch(candidates, index, { chunkSize = 200, onProgress, shouldCancel } = {}) {
  const out = new Array(candidates.length)
  const fileIds = new Set()
  for (let i = 0; i < candidates.length; i++) {
    if (shouldCancel && shouldCancel()) throw new Error('cancelled')
    const c = candidates[i]
    // Tag file rows so a match can be told apart from a database record.
    c.id = c.id ?? 'file:' + i
    const res = classify(c, index)
    res.in_file = !!(res.match && fileIds.has(res.match.id))
    out[i] = res
    if (res.status === DUP_STATUS.NEW || res.status === DUP_STATUS.POSSIBLE) {
      addToIndex(index, c)
      fileIds.add(c.id)
    }
    if ((i + 1) % chunkSize === 0) {
      if (onProgress) onProgress(i + 1, candidates.length)
      await yieldToUi()
    }
  }
  if (onProgress) onProgress(candidates.length, candidates.length)
  return out
}

export const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a)

/**
 * Find duplicate pairs inside an existing directory (the admin "review
 * duplicates" screen). Each record is compared with those before it; the
 * earlier record is `keep`, the later one `other`. Pairs in `dismissed`
 * (Set of pairKey) are not reported again.
 */
export async function findDuplicatePairs(records, { dismissed = new Set(), chunkSize = 300, onProgress, shouldCancel } = {}) {
  const index = createDedupIndex([])
  const pairs = []
  for (let i = 0; i < records.length; i++) {
    if (shouldCancel && shouldCancel()) throw new Error('cancelled')
    const r = records[i]
    const res = classify(r, index)
    if (res.status !== DUP_STATUS.NEW && !dismissed.has(pairKey(res.match.id, r.id))) {
      pairs.push({ keep: res.match, other: r, status: res.status, score: res.score, reasons: res.reasons })
    }
    addToIndex(index, r)
    if ((i + 1) % chunkSize === 0) {
      if (onProgress) onProgress(i + 1, records.length)
      await yieldToUi()
    }
  }
  if (onProgress) onProgress(records.length, records.length)
  return pairs.sort((a, b) => b.score - a.score)
}

const MERGEABLE = [
  'category_id', 'subcategory_id', 'business_type', 'address', 'state', 'lga', 'city',
  'latitude', 'longitude', 'phone', 'email', 'website', 'contact_person', 'opening_hours', 'description',
]

/**
 * Merge = fill the gaps. Fields the existing record already has are never
 * overwritten (the existing record may be verified); only blanks are filled.
 * Returns the patch to apply, or null when the incoming row adds nothing.
 */
export function buildMergePatch(existing, incoming) {
  const patch = {}
  const blank = (v) => v === null || v === undefined || String(v).trim() === ''
  MERGEABLE.forEach((f) => {
    if (blank(existing[f]) && !blank(incoming[f])) patch[f] = incoming[f]
  })
  // lat/lng only travel as a pair.
  if (('latitude' in patch) !== ('longitude' in patch)) { delete patch.latitude; delete patch.longitude }
  if (!Object.keys(patch).length) return null
  // Keep the derived columns in step with the fields that actually changed.
  if ('address' in patch) patch.address_normalized = incoming.address_normalized || null
  if ('phone' in patch) patch.phone_normalized = incoming.phone_normalized || null
  if ('website' in patch) patch.website_host = incoming.website_host || null
  return patch
}
