// Phase 2, Item 5: offline draft backup.
//
// A reporter may lose connectivity (or fat-finger a refresh) while a draft is
// in progress. The report row itself is only written to the server on an
// explicit save, so we mirror the live form state to localStorage as the user
// types and offer a one-tap restore when they come back to the same report.
//
// Storage key is per-report so drafts never bleed across reports or tenants.
// The payload is the same scalar projection the server save uses, plus the
// child rows, so a restore reconstructs the form exactly as it was.
//
// This is a pragmatic offline story: local draft backup + restore banner. A
// full PWA offline sync (queueing writes and replaying them) is explicitly
// deferred pending product decisions on conflict handling.

const KEY_PREFIX = 'carehub_adr_draft_'

// Backups older than this are treated as missing and pruned. Seven days:
// long enough to survive a lost weekend offline, short enough that a shared
// device does not accumulate patient data indefinitely.
export const DRAFT_BACKUP_TTL_MS = 7 * 24 * 60 * 60 * 1000

function keyOf(reportId, scope) {
  return `${KEY_PREFIX}${scope || 'default'}:${reportId}`
}

// Scope binds a backup to the tenant + reporter that wrote it, so drafts
// never bleed across businesses or staff on a shared device. Owners have no
// staff row (created_by_user_id is null), hence the 'owner' fallback.
export function scopeFor(report) {
  if (!report) return 'none:owner'
  const business = report.business_id || 'none'
  const creator = report.created_by_user_id || 'owner'
  return `${business}:${creator}`
}

function isExpired(savedAt, now = Date.now()) {
  return typeof savedAt !== 'number' || (now - savedAt) > DRAFT_BACKUP_TTL_MS
}

function listKeys(storage) {
  try {
    if (!storage || typeof storage.length !== 'number' || typeof storage.key !== 'function') return []
    const keys = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (typeof key === 'string' && key.startsWith(KEY_PREFIX)) keys.push(key)
    }
    return keys
  } catch (e) {
    return []
  }
}

function makeStorage(storage) {
  const backing = storage || (typeof localStorage !== 'undefined' ? localStorage : null)
  if (!backing) {
    return {
      save: () => false,
      load: () => null,
      clear: () => false,
    }
  }
  return {
    save(reportId, scope, payload) {
      try {
        backing.setItem(keyOf(reportId, scope), JSON.stringify({ ...payload, savedAt: Date.now() }))
        return true
      } catch (e) {
        return false
      }
    },
    load(reportId, scope) {
      try {
        const raw = backing.getItem(keyOf(reportId, scope))
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object') return null
        // Expired backups self-clean: stale patient data must not linger.
        if (isExpired(parsed.savedAt)) {
          try { backing.removeItem(keyOf(reportId, scope)) } catch (e) {}
          return null
        }
        return parsed
      } catch (e) {
        return null
      }
    },
    clear(reportId, scope) {
      try {
        backing.removeItem(keyOf(reportId, scope))
        return true
      } catch (e) {
        return false
      }
    },
  }
}

// Removes every draft backup regardless of scope. Call on logout (both
// lanes): a shared device must not retain patient data after sign-out.
export function clearAllDraftBackups(storage) {
  const backing = storage || (typeof localStorage !== 'undefined' ? localStorage : null)
  if (!backing) return 0
  let removed = 0
  for (const key of listKeys(backing)) {
    try {
      backing.removeItem(key)
      removed += 1
    } catch (e) {}
  }
  return removed
}

// Removes expired backups; returns the count removed. Safe to call
// opportunistically (e.g. when a report page loads).
export function pruneExpired(storage, now = Date.now()) {
  const backing = storage || (typeof localStorage !== 'undefined' ? localStorage : null)
  if (!backing) return 0
  let removed = 0
  for (const key of listKeys(backing)) {
    try {
      const parsed = JSON.parse(backing.getItem(key))
      if (!parsed || typeof parsed !== 'object' || isExpired(parsed.savedAt, now)) {
        backing.removeItem(key)
        removed += 1
      }
    } catch (e) {
      try {
        backing.removeItem(key)
        removed += 1
      } catch (ignored) {}
    }
  }
  return removed
}

// Builds the full snapshot the restore path needs. childRows covers
// products / meds / reactions; photos are server-stored objects and are not
// re-uploaded from a backup.
export function buildDraftSnapshot({ report, products, meds, reactions, reactionExpected, newSafetySignal }) {
  return {
    report: { ...report },
    products: products || [],
    meds: meds || [],
    reactions: reactions || [],
    reactionExpected: reactionExpected ?? null,
    newSafetySignal: !!newSafetySignal,
  }
}

// A backup is only worth restoring if it was written after the report's last
// server update — otherwise the server copy is already newer.
export function isStale(draft, reportUpdatedAt) {
  if (!draft || !draft.savedAt || !reportUpdatedAt) return false
  return new Date(draft.savedAt).getTime() < new Date(reportUpdatedAt).getTime()
}

export function createDraftBackup(storageImpl) {
  const storage = makeStorage(storageImpl)
  return {
    save: storage.save,
    load: storage.load,
    clear: storage.clear,
  }
}

export const draftBackup = createDraftBackup()
