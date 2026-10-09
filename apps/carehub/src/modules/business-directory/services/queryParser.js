// ── Natural-language discovery query -> structured parameters ─────────────────
// "Show me 20 cosmetic businesses around Surulere"
//    -> { category: 'Cosmetics Business', quantity: 20, location: { kind: 'named', name: 'Surulere' } }
//
// Deliberately rule-based, not an LLM call: it is deterministic, free, works
// offline, never sends a rep's GPS position or search terms to a third party,
// and the user always sees (and can edit) the interpretation before results
// are trusted. Anything it cannot interpret is returned as absent, never guessed.

import { lookupKey } from './normalize'

const MILES_TO_KM = 1.609344

// Built-in vocabulary: category name -> phrases (singular, lower-case, accent-free).
// Admin-created categories are matched by their own name in addition to these.
const CATEGORY_ALIASES = {
  'Pharmacy': ['pharmacy', 'chemist', 'drugstore', 'drug store', 'medicine shop'],
  'Hospital': ['hospital'],
  'Clinic': ['clinic'],
  'Medical Centre': ['medical centre', 'health centre', 'medical facility'],
  'Specialist Hospital': ['specialist hospital', 'specialty hospital'],
  'Primary Healthcare Centre': ['primary healthcare centre', 'primary health centre', 'primary health care centre', 'phc'],
  'Maternity': ['maternity', 'maternity home', 'maternity centre'],
  'Paediatric Centre': ['paediatric centre', 'pediatric centre', 'paediatric', 'pediatric', 'childrens hospital'],
  'Cardiology Centre': ['cardiology centre', 'cardiology', 'heart centre', 'cardiac centre'],
  'Fertility/IVF Centre': ['fertility centre', 'fertility clinic', 'ivf centre', 'ivf clinic', 'ivf', 'fertility'],
  'Gynecology Centre': ['gynecology centre', 'gynaecology centre', 'gynecology', 'gynaecology', 'gynecologist'],
  'Physiotherapy/Rehabilitation': ['physiotherapy', 'physiotherapy centre', 'physiotherapy clinic', 'rehabilitation centre', 'rehabilitation', 'rehab centre', 'rehab'],
  'Dermatology': ['dermatology', 'dermatology clinic', 'dermatologist', 'skin clinic'],
  'Dental Clinic': ['dental clinic', 'dental centre', 'dental', 'dentist'],
  'Eye Clinic/Optometry': ['eye clinic', 'eye hospital', 'eye centre', 'optometry', 'optometrist', 'optician', 'optical', 'ophthalmology'],
  'Diagnostic Centre': ['diagnostic centre', 'diagnostic', 'diagnostics'],
  'Medical Laboratory': ['medical laboratory', 'medical lab', 'laboratory', 'lab'],
  'Imaging/Radiology Centre': ['imaging centre', 'radiology centre', 'imaging', 'radiology', 'xray', 'x ray', 'mri', 'scan centre'],
  'Aesthetic/Cosmetic Centre': ['aesthetic centre', 'aesthetic clinic', 'aesthetic', 'cosmetic centre', 'cosmetic clinic', 'cosmetic surgery'],
  'Pharmaceutical Manufacturer': ['pharmaceutical manufacturer', 'drug manufacturer', 'pharma manufacturer'],
  'Pharmaceutical Importer': ['pharmaceutical importer', 'drug importer', 'pharma importer'],
  'Pharmaceutical Distributor': ['pharmaceutical distributor', 'drug distributor', 'pharma distributor'],
  'Pharmaceutical Wholesaler': ['pharmaceutical wholesaler', 'drug wholesaler', 'pharma wholesaler'],
  'Medical Equipment Company': ['medical equipment company'],
  'Medical Equipment Supplier': ['medical equipment supplier', 'medical equipment', 'equipment supplier'],
  'Healthcare Supplier': ['healthcare supplier', 'health care supplier', 'medical supplier', 'medical supply'],
  'Cosmetics Business': ['cosmetics business', 'cosmetic business', 'cosmetics', 'cosmetic', 'beauty business', 'beauty shop'],
  'Other Healthcare-related Business': ['healthcare business', 'health business', 'other healthcare'],
}

function singularToken(t) {
  if (t.length <= 3) return t
  if (t.endsWith('ies')) return t.slice(0, -3) + 'y'
  if (/(ches|shes|sses|xes)$/.test(t)) return t.slice(0, -2)
  if (t.endsWith('ses') && t.length > 5) return t.slice(0, -2) // businesses -> business
  if (t.endsWith('ss') || t.endsWith('us') || t.endsWith('is')) return t
  if (t.endsWith('s')) return t.slice(0, -1)
  return t
}

export function canonicalise(text) {
  return lookupKey(text)
    .split(' ')
    .filter(Boolean)
    .map((t) => (t === 'center' ? 'centre' : t === 'centers' ? 'centres' : t))
    .map(singularToken)
    .join(' ')
}

function buildAliasList(categories) {
  const list = []
  const seen = new Set()
  const add = (phrase, name) => {
    const key = canonicalise(phrase)
    if (!key || seen.has(key + '|' + name)) return
    seen.add(key + '|' + name)
    list.push({ phrase: key, name })
  }
  const names = (categories || []).map((c) => (typeof c === 'string' ? c : c.name))
  const known = new Set(names)
  // Built-in vocabulary only attaches to categories that actually exist for this tenant
  // (a deactivated built-in must not be returned as an interpretation).
  Object.entries(CATEGORY_ALIASES).forEach(([name, phrases]) => {
    if (!categories || known.has(name)) phrases.forEach((p) => add(p, name))
  })
  names.forEach((n) => add(n, n))
  // Longest phrase first so "specialist hospital" wins over "hospital".
  return list.sort((a, b) => b.phrase.length - a.phrase.length)
}

const CURRENT_LOCATION = /\b(?:around|near|close to|nearby|beside|by)\s+(?:me|my location|my current location|here|my area)\b|\bnear\s*by\b|\b(?:my|current)\s+(?:location|position)\b|\bin\s+my\s+area\b|\baround\s+here\b/i

/**
 * @param text       what the user typed
 * @param categories the tenant's active categories ({name} or strings); optional
 * @returns {{ category: string|null, quantity: number|null, radiusKm: number|null,
 *             location: {kind:'current'}|{kind:'named', name:string}|null,
 *             understood: boolean }}
 */
export function parseDiscoveryQuery(text, categories) {
  const original = String(text ?? '').replace(/\s+/g, ' ').trim()
  const result = { category: null, quantity: null, radiusKm: null, location: null, understood: false }
  if (!original) return result
  let rest = original

  // 1. Radius — remove it so its number is not mistaken for a quantity.
  const km = rest.match(/(?:within|inside|under|in a|in)?\s*(\d+(?:\.\d+)?)\s*(km|kms|kilomet(?:er|re)s?)\b/i)
  const mi = !km && rest.match(/(?:within|inside|under|in a|in)?\s*(\d+(?:\.\d+)?)\s*(miles?|mi)\b/i)
  const m = !km && !mi && rest.match(/(?:within|inside|under|in a|in)?\s*(\d+(?:\.\d+)?)\s*(m|metres?|meters?)\b/i)
  if (km) { result.radiusKm = parseFloat(km[1]); rest = rest.replace(km[0], ' ') }
  else if (mi) { result.radiusKm = +(parseFloat(mi[1]) * MILES_TO_KM).toFixed(2); rest = rest.replace(mi[0], ' ') }
  else if (m) { result.radiusKm = +(parseFloat(m[1]) / 1000).toFixed(3); rest = rest.replace(m[0], ' ') }
  if (result.radiusKm !== null && !(result.radiusKm > 0)) result.radiusKm = null

  // 2. Quantity — a bare number, optionally after top/first/show/find.
  const qty = rest.match(/\b(?:top|first|show(?:\s+me)?|find(?:\s+me)?|list|give\s+me|get(?:\s+me)?)?\s*(\d{1,4})\b/i)
  if (qty) {
    const n = parseInt(qty[1], 10)
    if (n > 0) { result.quantity = Math.min(n, 1000); rest = rest.replace(qty[0], ' ') }
  }

  // 3. Location — "me" forms first, then "around/in/at/near <place>".
  if (CURRENT_LOCATION.test(rest)) {
    result.location = { kind: 'current' }
    rest = rest.replace(CURRENT_LOCATION, ' ')
  } else {
    // "of" only follows a radius ("within 10 km of Ikeja"); elsewhere it is too
    // ambiguous ("a list of pharmacies").
    const preposition = result.radiusKm !== null
      ? /\b(?:around|in|at|near|close to|within|surrounding|across|of)\s+(?:the\s+)?/
      : /\b(?:around|in|at|near|close to|within|surrounding|across)\s+(?:the\s+)?/
    const placeName = /([A-Za-z][A-Za-z0-9'’.\- ]*?)(?=\s*(?:[,.?!;]|$|\bwith\b|\bwithin\b|\bthat\b|\bwhich\b|\bfor\b|\band\b))/
    const named = rest.match(new RegExp(preposition.source + placeName.source, 'i'))
    if (named) {
      const name = named[1].replace(/\s+/g, ' ').trim()
      if (name && !/^(me|my|here|area)$/i.test(name)) {
        result.location = { kind: 'named', name }
        rest = rest.replace(named[0], ' ')
      }
    }
  }

  // 4. Category — longest known phrase contained in what is left.
  const canon = ' ' + canonicalise(rest) + ' '
  const hit = buildAliasList(categories).find((a) => canon.includes(' ' + a.phrase + ' '))
  if (hit) result.category = hit.name

  result.understood = !!(result.category || result.location || result.radiusKm !== null)
  return result
}

/**
 * Resolve free text ("pharmacies", "Eye Clinic", "chemist") to one of the
 * tenant's categories. Used by the importer so a spreadsheet may say
 * "Pharmacies" without failing validation. Returns the category object or null.
 */
export function matchCategory(text, categories) {
  const key = canonicalise(text)
  if (!key) return null
  const list = categories || []
  const byName = list.find((c) => canonicalise(c.name) === key)
  if (byName) return byName
  const alias = buildAliasList(list).find((a) => a.phrase === key)
  return alias ? list.find((c) => c.name === alias.name) || null : null
}
