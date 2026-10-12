// A Moderation item for a reported post is keyed by the POST id (several
// reports on one post collapse into one item), but resolve_report takes a
// REPORT id. Resolve every pending report on the post, by its own id.
export function reportsToResolve(item, reports = []) {
  if (!item.target_id) return item.raw?.status === 'pending' ? [item.raw] : []
  return reports.filter(r => r.post_id === item.target_id && r.status === 'pending')
}

const note = (list, item, why) => list.push({ id: item.id, title: item.title, why })

// Run one bulk action over Moderation items. Each item is handled by its real
// type with the right id; anything that does not fit the action is skipped and
// named, and a failure on one item never stops the rest.
// `call(name, payload)` is callAdminAuth (it throws on failure); `audit` must
// never block moderation, so its failures are swallowed here as well.
export async function runBulk(action, items, { reports = [], call, audit }) {
  const result = { done: 0, skipped: [], failed: [] }
  const safeAudit = async (...args) => { try { await audit(...args) } catch { /* never blocks moderation */ } }

  for (const item of items) {
    try {
      if (action === 'approve_verifications' || action === 'reject_verifications') {
        if (item.source !== 'verification') { note(result.skipped, item, 'not a verification'); continue }
        if (action === 'approve_verifications') {
          await call('approve_verification', { id: item.id, userId: item.target_id, profession: item.raw?.profession })
          await safeAudit('approve', 'verification', item.id, { userId: item.target_id })
        } else {
          await call('reject_verification', { id: item.id })
          await safeAudit('reject', 'verification', item.id, {})
        }
      } else if (action === 'dismiss_reports') {
        if (item.source !== 'report') { note(result.skipped, item, 'not a report'); continue }
        const toResolve = reportsToResolve(item, reports)
        if (toResolve.length === 0) { note(result.skipped, item, 'nothing left to dismiss'); continue }
        for (const rep of toResolve) {
          await call('resolve_report', { id: rep.id })
          await safeAudit('resolve', 'report', rep.id, {})
        }
      } else if (action === 'delete_posts') {
        if (item.source !== 'report' && item.source !== 'post') { note(result.skipped, item, 'not a post'); continue }
        await call('delete_post', { id: item.target_id })
        await safeAudit('delete', 'post', item.target_id, { reason: item.source === 'report' ? 'reported content' : 'flagged content' })
      } else {
        throw new Error(`Unknown bulk action ${action}`)
      }
      result.done++
    } catch (err) {
      note(result.failed, item, err?.message || 'Unknown error')
    }
  }
  return result
}

// The result toast: how many were done, then every skipped and failed item by
// name with its reason. A failure makes it an error, a skip a warning.
export function summarizeBulk(result, verb) {
  const name = (x) => `${x.title || x.id} (${x.why})`
  let message = `${verb} ${result.done}`
  if (result.skipped.length) message += `. Skipped: ${result.skipped.map(name).join(', ')}`
  if (result.failed.length) message += `. Failed: ${result.failed.map(name).join(', ')}`
  const type = result.failed.length ? 'error' : result.skipped.length ? 'warning' : 'success'
  return { message, type }
}
