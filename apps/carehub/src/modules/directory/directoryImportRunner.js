import { isDuplicateError } from '../../lib/dbErrors.js'
import { selectRowsToImport } from './directoryImport.js'

// Executes an import plan in bounded batches. Safe to run twice on the same
// file: every record carries source_ref = <file fingerprint>:<row>, and the
// partial unique index on (data_source, source_ref) rejects a second copy, so a
// re-run reports those rows as `alreadyImported` instead of duplicating them.
//
// A failed batch never touches earlier batches (each is its own request). The
// failed batch is retried row by row so one bad row costs one row, not fifty.

const DENIED = /\((401|403)\)|permission denied|row-level security|42501|Directory administrator/i

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

export async function runImport({
  planRows,
  decisions,
  repo,
  batchSize = 50,
  onProgress = () => {},
  signal = null,
}) {
  const todo = selectRowsToImport(planRows, decisions)
  const result = { total: todo.length, processed: 0, inserted: 0, alreadyImported: 0, failed: [], cancelled: false, denied: false }
  const report = () => onProgress({ ...result, failed: result.failed.length })

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
  if (!result.cancelled && !result.denied) result.processed = todo.length
  report()
  return result
}
