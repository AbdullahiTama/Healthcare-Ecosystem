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

function keyOf(reportId) {
  return KEY_PREFIX + reportId
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
    save(reportId, payload) {
      try {
        backing.setItem(keyOf(reportId), JSON.stringify({ ...payload, savedAt: Date.now() }))
        return true
      } catch (e) {
        return false
      }
    },
    load(reportId) {
      try {
        const raw = backing.getItem(keyOf(reportId))
        if (!raw) return null
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' ? parsed : null
      } catch (e) {
        return null
      }
    },
    clear(reportId) {
      try {
        backing.removeItem(keyOf(reportId))
        return true
      } catch (e) {
        return false
      }
    },
  }
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
