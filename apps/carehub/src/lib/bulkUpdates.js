// Saving the same kind of change to many records (bulk edit on Inventory and Clients). Pure: the request function is
// passed in, so the rules are pinned by tests (lib/bulkUpdates.test.js, and each page's own bulk-edit tests).

// Records that get exactly the same updates go in one request; a per-record value (a percentage price change) gives
// each its own. `plan` is [{ id, updates }].
export function groupBulkUpdates(plan) {
  const groups = new Map()
  for (const item of plan || []) {
    const key = JSON.stringify(Object.keys(item.updates).sort().map((k) => [k, item.updates[k]]))
    if (!groups.has(key)) groups.set(key, { updates: item.updates, ids: [] })
    groups.get(key).ids.push(item.id)
  }
  return [...groups.values()]
}

// Sends the groups through `updateMany(ids, updates)` (which resolves to the saved rows), a few at a time. Never
// throws: returns the saved rows and the failures ({ ids, updates, message }) so the page can apply what worked and
// offer to retry the rest. `onProgress(done, total)` counts records.
export async function runBulkUpdates(groups, updateMany, { concurrency = 4, onProgress } = {}) {
  const queue = [...(groups || [])]
  const total = queue.reduce((n, g) => n + g.ids.length, 0)
  const saved = []
  const failed = []
  let done = 0
  async function worker() {
    for (let g = queue.shift(); g; g = queue.shift()) {
      try {
        const rows = await updateMany(g.ids, g.updates)
        saved.push(...(Array.isArray(rows) ? rows : []))
      } catch (e) {
        failed.push({ ids: g.ids, updates: g.updates, message: e?.message || 'Could not save' })
      }
      done += g.ids.length
      onProgress?.(done, total)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length || 1)) }, worker))
  return { saved, failed, total }
}
