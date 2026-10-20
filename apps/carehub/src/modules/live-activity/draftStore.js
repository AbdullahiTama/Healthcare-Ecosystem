// An unsent Log Activity form, kept in this browser so a reload, a dropped network
// or an accidental close does not lose what the rep typed.
//
// Only the typed answers and the territory are kept: not the voice note, the GPS
// pin or the chosen place, which are captured fresh when the form is opened. It is
// keyed to the business and the person, never leaves the device, expires after a
// week, and is removed as soon as the report is sent or the rep discards it.
// localStorage can be missing or throw (private windows, blocked storage), so
// every call is guarded and the form works the same without it.

export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function draftKey(businessId, staffId) {
  return 'carehub_activity_draft:' + businessId + ':' + (staffId || 'owner')
}

export function hasContent(draft) {
  if (!draft) return false
  const anyText = Object.keys(draft.values || {}).some(function (k) {
    return String(draft.values[k] == null ? '' : draft.values[k]).trim() !== ''
  })
  return anyText || !!draft.terrId
}

export function clearDraft(businessId, staffId) {
  try { localStorage.removeItem(draftKey(businessId, staffId)) } catch (e) { /* storage unavailable: nothing to clear */ }
}

// `at` is for tests. An empty form removes the draft instead of storing a blank one.
export function saveDraft(businessId, staffId, draft, at = Date.now()) {
  try {
    if (!hasContent(draft)) { clearDraft(businessId, staffId); return }
    localStorage.setItem(draftKey(businessId, staffId), JSON.stringify({ values: draft.values, terrId: draft.terrId || '', savedAt: at }))
  } catch (e) { /* storage full or unavailable: the form still works, it just is not remembered */ }
}

export function loadDraft(businessId, staffId) {
  try {
    const raw = localStorage.getItem(draftKey(businessId, staffId))
    if (!raw) return null
    const d = JSON.parse(raw)
    if (!d || typeof d.values !== 'object' || d.values === null || Array.isArray(d.values) || typeof d.savedAt !== 'number') return null
    if (Date.now() - d.savedAt > DRAFT_MAX_AGE_MS) { clearDraft(businessId, staffId); return null }
    return { values: d.values, terrId: d.terrId || '', savedAt: d.savedAt }
  } catch (e) {
    return null
  }
}
