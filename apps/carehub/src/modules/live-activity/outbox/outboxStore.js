// Durable storage for field reports that could not be sent yet.
//
// An entry is { id (the report's own id), businessId, staffId, activity, viewers, voiceBlob, voiceUrl,
// state: 'pending' | 'failed_permanent', attempts, nextAttemptAt, lastError, createdAt }.
//
// The store is a thin layer over a `backend` ({ getAll, get, put, delete, clear }) so the rules (scope,
// ordering, errors) are tested without a browser. The IndexedDB backend is the real one; the memory backend
// is for tests. Every failure is reported as an OutboxStoreError so the page can tell the person plainly
// that a report was NOT kept, instead of failing silently:
//   'unavailable'  the browser has no usable storage (private window, blocked site data)
//   'quota'        storage is full
//   'invalid'      the entry could not have been sent anyway (no id or business)
//   'missing'      update of an entry that is not there

export class OutboxStoreError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'OutboxStoreError'
    this.code = code
  }
}

function fail(e) {
  if (e instanceof OutboxStoreError) return e
  const quota = e && (e.name === 'QuotaExceededError' || /quota/i.test(String(e.message)))
  return new OutboxStoreError(quota ? 'quota' : 'unavailable', String(e && e.message ? e.message : e))
}

export function createMemoryBackend({ failWith = null } = {}) {
  const rows = new Map()
  const guard = () => { if (failWith) throw failWith }
  return {
    async getAll() { guard(); return [...rows.values()].map((r) => ({ ...r })) },
    async get(id) { guard(); const r = rows.get(id); return r ? { ...r } : null },
    async put(entry) { guard(); rows.set(entry.id, { ...entry }) },
    async delete(id) { guard(); rows.delete(id) },
    async clear() { guard(); rows.clear() },
  }
}

const STORE = 'outbox'

export function createIndexedDbBackend({ indexedDB, dbName = 'carehub-live-activity' } = {}) {
  let opening = null
  function open() {
    if (opening) return opening
    opening = new Promise((resolve, reject) => {
      if (!indexedDB) { reject(new Error('IndexedDB is not available in this browser')); return }
      const req = indexedDB.open(dbName, 1)
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }) }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error || new Error('IndexedDB could not be opened'))
      req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'))
    })
    opening.catch(() => { opening = null }) // a later call may succeed (the other tab closed)
    return opening
  }
  // Runs one request in its own transaction and resolves when the transaction has COMMITTED, not merely
  // when the request succeeded: a write that is later rolled back (quota) must reject.
  async function run(mode, make) {
    const db = await open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      let result
      try { const req = make(tx.objectStore(STORE)); req.onsuccess = () => { result = req.result } } catch (e) { reject(e); return }
      tx.oncomplete = () => resolve(result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'))
    })
  }
  return {
    getAll: () => run('readonly', (s) => s.getAll()),
    get: async (id) => (await run('readonly', (s) => s.get(id))) || null,
    put: (entry) => run('readwrite', (s) => s.put(entry)),
    delete: (id) => run('readwrite', (s) => s.delete(id)),
    clear: () => run('readwrite', (s) => s.clear()),
  }
}

// `staffId` is null for the company owner, who has no staff row; null only matches null.
const sameScope = (e, scope) => e.businessId === scope.businessId && (e.staffId || null) === (scope.staffId || null)

export function createOutboxStore(options = {}) {
  const backend = options.backend || createIndexedDbBackend({
    indexedDB: 'indexedDB' in options ? options.indexedDB : globalThis.indexedDB,
    dbName: options.dbName,
  })
  async function guarded(fn) {
    try { return await fn() } catch (e) { throw fail(e) }
  }
  return {
    put(entry) {
      if (!entry || !entry.id || !entry.businessId) {
        return Promise.reject(new OutboxStoreError('invalid', 'An outbox entry needs an id and a business'))
      }
      return guarded(() => backend.put(entry))
    },
    get(id) { return guarded(() => backend.get(id)) },
    list(scope) {
      return guarded(async () => (await backend.getAll()).filter((e) => sameScope(e, scope)).sort((a, b) => a.createdAt - b.createdAt))
    },
    update(id, patch) {
      return guarded(async () => {
        const current = await backend.get(id)
        if (!current) throw new OutboxStoreError('missing', 'No queued report ' + id)
        await backend.put({ ...current, ...patch, id })
      })
    },
    remove(id) { return guarded(() => backend.delete(id)) },
    clearAll() { return guarded(() => backend.clear()) },
  }
}
