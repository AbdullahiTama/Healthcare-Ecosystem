import { useState, useEffect, useRef, useCallback } from 'react'

// State that survives a page reload. Long forms (a 20-line purchase) are typed
// on phones and tablets whose browsers discard backgrounded tabs; on return the
// page reloads from scratch and in-memory React state is gone. This mirrors the
// value to localStorage on every change and restores it on mount.
//
// - `key` must scope the draft to the tenant (and user, on shared devices).
//   When it changes the hook re-reads, so a branch or staff switch never carries
//   one business's draft into another.
// - `isEmpty(value)` decides when there is nothing worth keeping; an empty
//   draft is removed from storage instead of written.
// - Every storage access is guarded: private mode, a full quota or blocked
//   site data must never break the form itself — the draft is a convenience.
// - The stored envelope is versioned. Bump DRAFT_VERSION if a caller's value
//   shape changes incompatibly and old drafts are dropped instead of misread.
// - Drafts expire after DRAFT_TTL_MS, the same seven days as the ADR draft
//   backup (modules/adr/draftBackup.js): long enough to survive a weekend,
//   short enough that a shared device does not keep business data forever.
//
// Why not modules/adr/draftBackup.js: that module is keyed by report and its
// drafts are all deleted at logout because they hold patient data. A form
// like a purchase must survive a forced sign-out — that is the moment its
// draft is most needed — so it lives under its own prefix.
const DRAFT_VERSION = 1
const PREFIX = 'carehub_draft_'
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000

function readDraft(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.version !== DRAFT_VERSION || !('value' in parsed)) return null
    if (typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      removeDraft(key)
      return null
    }
    return parsed
  } catch (e) {
    return null
  }
}

function writeDraft(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ version: DRAFT_VERSION, savedAt: Date.now(), value }))
  } catch (e) {
    // Quota or blocked storage: keep working in memory.
  }
}

function removeDraft(key) {
  try { localStorage.removeItem(PREFIX + key) } catch (e) {}
}

export function usePersistentDraft(key, makeInitial, { isEmpty = () => false } = {}) {
  const initialRef = useRef(makeInitial)
  initialRef.current = makeInitial
  const isEmptyRef = useRef(isEmpty)
  isEmptyRef.current = isEmpty

  const [state, setState] = useState(() => {
    const stored = key ? readDraft(key) : null
    return { key, value: stored ? stored.value : makeInitial(), restoredAt: stored ? stored.savedAt : null }
  })

  // Key changed (different business/staff): load that key's draft, never keep
  // the previous one. Done during render so no frame shows the old draft.
  let current = state
  if (state.key !== key) {
    const stored = key ? readDraft(key) : null
    current = { key, value: stored ? stored.value : initialRef.current(), restoredAt: stored ? stored.savedAt : null }
    setState(current)
  }

  useEffect(() => {
    if (!current.key) return
    if (isEmptyRef.current(current.value)) removeDraft(current.key)
    else writeDraft(current.key, current.value)
  }, [current.key, current.value])

  const setValue = useCallback((next) => {
    setState(s => ({ ...s, value: typeof next === 'function' ? next(s.value) : next }))
  }, [])

  const clear = useCallback(() => {
    setState(s => {
      if (s.key) removeDraft(s.key)
      return { ...s, value: initialRef.current(), restoredAt: null }
    })
  }, [])

  return [current.value, setValue, { clear, restoredAt: current.restoredAt }]
}
