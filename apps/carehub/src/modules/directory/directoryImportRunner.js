import { isDuplicateError } from '../../lib/dbErrors.js'
import { selectRowsToImport } from './directoryImport.js'

// Executes an import plan in bounded batches. Safe to run twice on the same
// file: every record carries source_ref = <file fingerprint>:<row>, and the
// partial unique index on (data_source, source_ref) rejects a second copy, so a
// re-run reports those rows as `alreadyImported` instead of duplicating them.
//
// A failed batch never touches earlier batches (each is its own request). The
// failed batch is retried row by row so one bad row costs one row, not fifty.
//
// Reviewed merges (`merges`) run after the inserts, one request each, through
// directory_merge_import_row. The database decides what is allowed; this only
// reports what it did. Re-running a file reports each merge as already applied
// and changes nothing. A merge is never inferred: only rows the reviewer
// explicitly turned into a merge appear here.

const DENIED = /\((401|403)\)|permission denied|row-level security|42501|Directory administrator/i

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * @param merges [{ row, targetId, sourceRef, changes }] already reviewed and confirmed
 */
export async function runImport({
  planRows,
  decisions,
  repo,
  merges = [],
  batchSize = 50,
  onProgress = () => {},
  signal = null,
}) {
  const todo = selectRowsToImport(planRows, decisions)
  const result = {
    total: todo.length + merges.length, processed: 0, inserted: 0, alreadyImported: 0, failed: [],
    merged: 0, mergeAlreadyApplied: 0, mergeNothingChanged: 0, mergeSkipped: [], mergeFailed: [],
    cancelled: false, denied: false,
  }
  const report = () => onProgress({ ...result, failed: result.failed.length, mergeFailed: result.mergeFailed.length })

  for (let i = 0; i < todo.length; i += batchSize) {
    if (signal && signal.aborted) { result.cancelled = true; break }
    const batch = todo.slice(i, i + batchSize)
    try {
      await repo.insertBatch(batch.map((r) => r.record))
      result.inserted += batch.length
    } catch (batchError) {
      if (DENIED.test(String(batchError && batchError.message))) { result.denied = true; result.failed.push({ row: batch[0].row, message: 'Not permitted to import into the directory.' }); break }
      // Fall back to single rows to isolate the offender(s).
      for (const r of batch) {
        try {
          await repo.insertOne(r.record)
          result.inserted++
        } catch (rowError) {
          if (isDuplicateError(rowError)) result.alreadyImported++
          else if (DENIED.test(String(rowError && rowError.message))) { result.denied = true; result.failed.push({ row: r.row, message: 'Not permitted to import into the directory.' }); break }
          else result.failed.push({ row: r.row, message: (rowError && rowError.message) || 'Could not save this row.' })
        }
      }
      if (result.denied) break
    }
    result.processed = Math.min(i + batch.length, todo.length)
    report()
    await tick() // let the UI paint between batches
  }

  if (!result.cancelled && !result.denied) {
    for (const m of merges) {
      if (signal && signal.aborted) { result.cancelled = true; break }
      try {
        const out = await repo.mergeImportRow(m.targetId, m.sourceRef, m.changes)
        if (out && out.alreadyMerged) result.mergeAlreadyApplied++
        else if (out && out.applied && Object.keys(out.applied).length) result.merged++
        else result.mergeNothingChanged++
        ;((out && out.skipped) || []).forEach((s) => result.mergeSkipped.push({ row: m.row, field: s.field, reason: s.reason }))
      } catch (e) {
        if (DENIED.test(String(e && e.message))) { result.denied = true; result.mergeFailed.push({ row: m.row, message: 'Not permitted to merge into the directory.' }); break }
        result.mergeFailed.push({ row: m.row, message: (e && e.message) || 'Could not merge this row.' })
      }
      result.processed++
      report()
      await tick()
    }
  }

  if (!result.cancelled && !result.denied) result.processed = result.total
  report()
  return result
}
