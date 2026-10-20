import { describe, it, expect } from 'vitest'
import { createLiveActivityRepository } from './index.js'

// Saving a report in one request through log_field_activity (draft migration
// carehub_20261020_log_field_activity, not applied yet), with the two-request path as the
// fallback so the app works whether or not the function has been deployed.

const NO_RPC = 'Supabase error (404): Could not find the function public.log_field_activity(p_activity, p_viewers) in the schema cache'

const ACT = { business_id: 'b1', staff_id: 's1', rep_name: 'Ada', id: 'fixed-id' }
const V = [{ staff_id: 'm1', viewer_name: 'M1' }, { staff_id: 'm2', viewer_name: 'M2' }]
const isRpc = (c) => c.path.startsWith('rpc/log_field_activity')
const served = (over = {}) => ({ id: 'fixed-id', created: true, viewers_added: 2, alerts: 'server', ...over })

// `answer(attempt)` is what the function returns, or throws, on its nth call.
function backend(answer) {
  const calls = []
  let attempt = 0
  const request = async (path, opts = {}) => {
    calls.push({ path, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null })
    if (path.startsWith('rpc/log_field_activity')) return answer(++attempt)
    return []
  }
  return { calls, repo: createLiveActivityRepository({ request }) }
}

describe('logActivity through log_field_activity', () => {
  it('saves the report and its viewers in a single request and nothing else', async () => {
    const { repo, calls } = backend(() => served())
    const res = await repo.logActivity(ACT, V)
    expect(calls).toHaveLength(1)
    expect(isRpc(calls[0])).toBe(true)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].body).toEqual({ p_activity: ACT, p_viewers: V })
    expect(res).toEqual({ id: 'fixed-id', notification: 'sent' })
  })

  it('makes up the id when the caller gives none, sends it, and returns it', async () => {
    const { repo, calls } = backend(() => served({ id: 'ignored' }))
    const res = await repo.logActivity({ ...ACT, id: undefined }, V)
    expect(calls[0].body.p_activity.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(res.id).toBe(calls[0].body.p_activity.id)
  })

  it('when the database sends the alerts itself, the browser sends none', async () => {
    const { repo, calls } = backend(() => served({ alerts: 'server' }))
    const res = await repo.logActivity(ACT, V)
    expect(calls.some((c) => c.path.startsWith('staff_notifications'))).toBe(false)
    expect(res.notification).toBe('sent')
  })

  it('when the database does not send them yet, the browser still tries, and reports what happened', async () => {
    const { repo, calls } = backend(() => served({ alerts: 'client' }))
    const res = await repo.logActivity(ACT, V)
    const note = calls.find((c) => c.path.startsWith('staff_notifications'))
    expect(note.body).toHaveLength(2)
    expect(res.notification).toBe('sent')
  })

  it('a retry that adds nobody notifies nobody', async () => {
    const { repo, calls } = backend(() => served({ created: false, viewers_added: 0, alerts: 'client' }))
    const res = await repo.logActivity(ACT, V)
    expect(calls.some((c) => c.path.startsWith('staff_notifications'))).toBe(false)
    expect(res.notification).toBe('none')
  })

  it('a report with nobody to share with has nothing to notify', async () => {
    const { repo, calls } = backend(() => served({ viewers_added: 0 }))
    expect((await repo.logActivity(ACT, [])).notification).toBe('none')
    expect(calls.some((c) => c.path.startsWith('staff_notifications'))).toBe(false)
  })

  it('a project without the function falls back to the two-request path, and remembers, so it asks once', async () => {
    const { repo, calls } = backend(() => { throw new Error(NO_RPC) })
    await repo.logActivity(ACT, V)
    expect(calls.filter(isRpc)).toHaveLength(1)
    expect(calls.some((c) => c.path.startsWith('field_activities') && c.method === 'POST')).toBe(true)
    await repo.logActivity({ ...ACT, id: 'second' }, V)
    expect(calls.filter(isRpc)).toHaveLength(1)   // not asked again
  })

  it('any other failure is a failure, not a reason to fall back: a retry must use the same safe path', async () => {
    const refusal = 'Supabase error (403): new row violates row-level security policy for table "field_activities"'
    const { repo, calls } = backend((n) => { if (n === 1) throw new Error(refusal); return served() })
    await expect(repo.logActivity(ACT, V)).rejects.toThrow('row-level security')
    expect(calls.some((c) => c.path.startsWith('field_activities'))).toBe(false)   // no second route was tried
    const res = await repo.logActivity(ACT, V)                                      // and it asks the function again
    expect(res.id).toBe('fixed-id')
    expect(calls.filter(isRpc)).toHaveLength(2)
  })

  it('a dropped connection is a failure too, and the retry goes the same way with the same id', async () => {
    const { repo, calls } = backend((n) => { if (n === 1) throw new TypeError('Failed to fetch'); return served({ created: false, viewers_added: 0 }) })
    await expect(repo.logActivity(ACT, V)).rejects.toThrow('Failed to fetch')
    await repo.logActivity(ACT, V)
    const ids = calls.filter(isRpc).map((c) => c.body.p_activity.id)
    expect(ids).toEqual(['fixed-id', 'fixed-id'])
  })

  it('a database refusal to alert still comes through as refused, not as a failed save', async () => {
    const refused = new Error('Supabase error (403): new row violates row-level security policy for table "staff_notifications"')
    const repo = createLiveActivityRepository({
      request: async (path) => {
        if (path.startsWith('rpc/')) return served({ alerts: 'client' })
        if (path.startsWith('staff_notifications')) throw refused
        return []
      },
    })
    expect(await repo.logActivity(ACT, V)).toEqual({ id: 'fixed-id', notification: 'refused' })
  })
})
