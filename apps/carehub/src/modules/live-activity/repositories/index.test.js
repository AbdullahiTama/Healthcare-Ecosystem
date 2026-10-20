import { describe, it, expect } from 'vitest'
import { createLiveActivityRepository, buildActivityQuery } from './index.js'

// What a project that has not deployed log_field_activity answers. The tests of the two-request path
// below run against it on purpose: that is the path used until the function exists.
const NO_RPC = 'Supabase error (404): Could not find the function public.log_field_activity(p_activity, p_viewers) in the schema cache'

const recording = () => {
  const calls = []
  const counts = []
  const repo = createLiveActivityRepository({
    request: async (path) => { calls.push(path); return [] },
    requestWithCount: async (path, opts) => { counts.push({ path, opts }); return { total: 4321 } },
  })
  return { calls, counts, repo }
}

describe('liveActivityRepository.getFieldActivities', () => {
  it('defaults to the newest 100, ordered by time then id so ties have a fixed order', async () => {
    const { repo, calls } = recording()
    await repo.getFieldActivities('b1')
    expect(calls[0]).toBe('field_activities?business_id=eq.b1&order=created_at.desc,id.desc&select=*&limit=100')
  })

  it('pages strictly after the cursor row: older time, or the same time with a smaller id', async () => {
    const { repo, calls } = recording()
    await repo.getFieldActivities('b1', { limit: 50, cursor: { created_at: '2026-10-19T12:00:00+00:00', id: 'row-9' } })
    expect(calls[0]).toBe(
      'field_activities?business_id=eq.b1'
      + '&or=(created_at.lt.2026-10-19T12%3A00%3A00%2B00%3A00,and(created_at.eq.2026-10-19T12%3A00%3A00%2B00%3A00,id.lt.row-9))'
      + '&order=created_at.desc,id.desc&select=*&limit=50')
  })
})

describe('buildActivityQuery scopes', () => {
  it('own reports of a staff member', () => {
    expect(buildActivityQuery('b1', { staffId: 's1' })).toContain('&staff_id=eq.s1')
  })
  it('own reports of the owner are the ones with no staff author', () => {
    expect(buildActivityQuery('b1', { ownerOnly: true })).toContain('&staff_id=is.null')
  })
  it('shared-with-me excludes the person\'s own reports but keeps the owner\'s', () => {
    expect(buildActivityQuery('b1', { excludeStaffId: 's1' })).toContain('&or=(staff_id.is.null,staff_id.neq.s1)')
  })
  it('combines two OR conditions with and=() instead of repeating or=', () => {
    const q = buildActivityQuery('b1', { excludeStaffId: 's1', cursor: { created_at: 'T', id: 'i' } })
    expect(q.match(/[&?]or=/g)).toBeNull()
    expect(q).toContain('&and=(or(staff_id.is.null,staff_id.neq.s1),or(created_at.lt.T,and(created_at.eq.T,id.lt.i)))')
  })
  it('date window and territory', () => {
    const q = buildActivityQuery('b1', { since: '2026-10-01T00:00:00.000Z', until: '2026-10-31T23:59:59.999Z', territoryId: 't1' })
    expect(q).toContain('&created_at=gte.2026-10-01T00%3A00%3A00.000Z')
    expect(q).toContain('&created_at=lte.2026-10-31T23%3A59%3A59.999Z')
    expect(q).toContain('&territory_id=eq.t1')
  })
})

describe('liveActivityRepository.countFieldActivities', () => {
  it('asks the server for an exact count with no rows, so it is not capped at 1000', async () => {
    const { repo, counts } = recording()
    const n = await repo.countFieldActivities('b1', { staffId: 's1' })
    expect(n).toBe(4321)
    expect(counts[0].path).toBe('field_activities?business_id=eq.b1&staff_id=eq.s1&select=id')
    expect(counts[0].opts).toEqual({ head: true })
  })
})

describe('liveActivityRepository.getAllFieldActivities', () => {
  const rowsOf = (from, n) => Array.from({ length: n }, (_, i) => ({ id: 'r' + (from + i), created_at: 'T' + (from + i) }))
  const withPages = (pages) => {
    const paths = []
    const repo = createLiveActivityRepository({ request: async (p) => { paths.push(p); return pages.shift() || [] } })
    return { repo, paths }
  }

  it('follows the cursor across pages and stops on a short page', async () => {
    const { repo, paths } = withPages([rowsOf(0, 3), rowsOf(3, 3), rowsOf(6, 1)])
    const res = await repo.getAllFieldActivities('b1', {}, { pageSize: 3 })
    expect(res.rows.map((r) => r.id)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6'])
    expect(res.truncated).toBe(false)
    expect(paths[1]).toContain('id.lt.r2')
    expect(paths[2]).toContain('id.lt.r5')
  })

  it('reports truncation when the cap is hit with more left', async () => {
    const { repo } = withPages([rowsOf(0, 3), rowsOf(3, 3)])
    const res = await repo.getAllFieldActivities('b1', {}, { pageSize: 3, max: 6 })
    expect(res.rows).toHaveLength(6)
    expect(res.truncated).toBe(true)
  })

  it('an exact multiple of the page size ends on the following empty page, not as truncated', async () => {
    const { repo } = withPages([rowsOf(0, 3), []])
    const res = await repo.getAllFieldActivities('b1', {}, { pageSize: 3 })
    expect(res.rows).toHaveLength(3)
    expect(res.truncated).toBe(false)
  })
})

describe('liveActivityRepository.logActivity: retry-safe save', () => {
  // A scripted backend: records every call, lets a test fail a chosen step, and
  // remembers rows so a retry sees what the first attempt already wrote.
  const backend = ({ failOn = {} } = {}) => {
    const calls = []
    const viewers = []
    const request = async (path, opts = {}) => {
      calls.push({ path, method: opts.method || 'GET', prefer: opts.prefer, body: opts.body ? JSON.parse(opts.body) : null })
      if (path.startsWith('rpc/')) throw new Error(NO_RPC)
      const step = path.startsWith('field_activities') ? 'activity' : path.startsWith('activity_viewers') ? ((opts.method || 'GET') === 'GET' ? 'readViewers' : 'addViewers') : 'notify'
      if (failOn[step] && failOn[step]-- > 0) throw new Error(step + ' failed')
      if (step === 'readViewers') return viewers.map((staff_id) => ({ staff_id }))
      if (step === 'addViewers') JSON.parse(opts.body).forEach((v) => viewers.push(v.staff_id))
      return []
    }
    return { calls, viewers, repo: createLiveActivityRepository({ request }) }
  }
  const ACT = { business_id: 'b1', staff_id: 's1', rep_name: 'Ada', id: 'fixed-id' }
  const V = [{ staff_id: 'm1', viewer_name: 'M1' }, { staff_id: 'm2', viewer_name: 'M2' }]
  const inserts = (calls) => calls.filter((c) => c.method === 'POST' && c.path.startsWith('field_activities'))

  it('inserts with the caller\'s id and ignores a duplicate, so a repeat cannot create a second report', async () => {
    const { repo, calls } = backend()
    await repo.logActivity(ACT, [])
    expect(inserts(calls)[0].body.id).toBe('fixed-id')
    expect(inserts(calls)[0].prefer).toContain('resolution=ignore-duplicates')
  })

  it('makes up an id when the caller gives none, and returns it', async () => {
    const { repo, calls } = backend()
    const res = await repo.logActivity({ ...ACT, id: undefined }, [])
    expect(res.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(inserts(calls)[0].body.id).toBe(res.id)
  })

  it('a viewer-write failure leaves the report saved; the retry adds only the viewers still missing', async () => {
    const { repo, calls, viewers } = backend({ failOn: { addViewers: 1 } })
    await expect(repo.logActivity(ACT, V)).rejects.toThrow('addViewers failed')
    expect(inserts(calls)).toHaveLength(1)
    await repo.logActivity(ACT, V) // retry, same id
    expect(viewers.sort()).toEqual(['m1', 'm2']) // exactly once each
  })

  it('a retry after everything was written adds no viewers twice and does not notify again', async () => {
    const { repo, calls, viewers } = backend()
    const first = await repo.logActivity(ACT, V)
    expect(first.notification).toBe('sent')
    const notifiesBefore = calls.filter((c) => c.path.startsWith('staff_notifications')).length
    const again = await repo.logActivity(ACT, V)
    expect(viewers).toHaveLength(2)
    expect(again.notification).toBe('none')
    expect(calls.filter((c) => c.path.startsWith('staff_notifications')).length).toBe(notifiesBefore)
  })

  it('a notification failure does not fail the save and is reported, not swallowed', async () => {
    const { repo } = backend({ failOn: { notify: 1 } })
    const res = await repo.logActivity(ACT, V)
    expect(res.id).toBe('fixed-id')
    expect(res.notification).toBe('failed')
  })

  it('a database refusal is told apart from a network failure, because retrying a refusal cannot help', async () => {
    const refusals = [
      'Supabase error (403): new row violates row-level security policy for table "staff_notifications"',
      'Supabase error (401): permission denied for table staff_notifications',
      'Supabase error (400): {"code":"42501"}',
    ]
    for (const message of refusals) {
      const calls = []
      const repo = createLiveActivityRepository({
        request: async (path, opts = {}) => {
          calls.push(path)
          if (path.startsWith('rpc/')) throw new Error(NO_RPC)
          if (path.startsWith('staff_notifications')) throw new Error(message)
          return []
        },
      })
      expect(await repo.notifyViewers(ACT, V)).toBe('refused')
      expect((await repo.logActivity(ACT, V)).notification).toBe('refused')
    }
    const down = createLiveActivityRepository({ request: async (path) => { if (path.startsWith('staff_notifications')) throw new TypeError('Failed to fetch'); return [] } })
    expect(await down.notifyViewers(ACT, V)).toBe('failed')   // network trouble: worth retrying
    const busy = createLiveActivityRepository({ request: async (path) => { if (path.startsWith('staff_notifications')) throw new Error('Supabase error (503): upstream'); return [] } })
    expect(await busy.notifyViewers(ACT, V)).toBe('failed')
  })

  it('notifying nobody is a success, not a failure', async () => {
    const { repo } = backend()
    expect(await repo.notifyViewers(ACT, [])).toBe('sent')
  })

  it('notifyViewers can be retried on its own', async () => {
    const { repo, calls } = backend()
    const ok = await repo.notifyViewers(ACT, V)
    expect(ok).toBe('sent')
    const note = calls.find((c) => c.path.startsWith('staff_notifications'))
    expect(note.body).toHaveLength(2)
  })
})

describe('liveActivityRepository: voice notes', () => {
  const PUBLIC = 'https://proj.supabase.co/storage/v1/object/public/activity-voice/'
  const make = (over = {}) => {
    const uploads = []
    const signs = []
    const repo = createLiveActivityRepository({
      request: async () => [],
      upload: async (bucket, path, blob, type, label) => { uploads.push({ bucket, path, type, label }); return PUBLIC + path },
      signUrl: async (bucket, path, seconds) => { signs.push({ bucket, path, seconds }); return 'https://proj.supabase.co/storage/v1/object/sign/' + bucket + '/' + path + '?token=t' + signs.length },
      randomSuffix: () => 'k1',
      now: () => 1_000_000,
      ...over,
    })
    return { repo, uploads, signs }
  }

  it('uploads into the company folder with a bare audio type and returns the stored URL', async () => {
    const { repo, uploads } = make()
    const url = await repo.uploadActivityVoice({ type: 'audio/webm;codecs=opus' }, { businessId: 'biz-1', activityId: 'act-9' })
    expect(uploads).toEqual([{ bucket: 'activity-voice', path: 'biz-1/act-9-k1.webm', type: 'audio/webm', label: 'Voice upload failed' }])
    expect(url).toBe(PUBLIC + 'biz-1/act-9-k1.webm')
  })

  it('will not upload without a company and a report', async () => {
    const { repo, uploads } = make()
    await expect(repo.uploadActivityVoice({ type: 'audio/webm' }, {})).rejects.toThrow()
    expect(uploads).toHaveLength(0)
  })

  it('plays an existing public-URL note through a signed link for its path', async () => {
    const { repo, signs } = make()
    const link = await repo.signedVoiceUrl(PUBLIC + 'voice-1782-123.webm')
    expect(signs).toEqual([{ bucket: 'activity-voice', path: 'voice-1782-123.webm', seconds: 3600 }])
    expect(link).toContain('/object/sign/activity-voice/voice-1782-123.webm')
  })

  it('reuses a link while it is still good, and asks again once it is nearly expired', async () => {
    let t = 1_000_000
    const { repo, signs } = make({ now: () => t })
    await repo.signedVoiceUrl(PUBLIC + 'a.webm')
    t += 10 * 60 * 1000
    await repo.signedVoiceUrl(PUBLIC + 'a.webm')
    expect(signs).toHaveLength(1)
    t += 45 * 60 * 1000          // 55 minutes in: inside the safety margin of a 60-minute link
    await repo.signedVoiceUrl(PUBLIC + 'a.webm')
    expect(signs).toHaveLength(2)
  })

  it('two requests for the same note at once share one signing call', async () => {
    const { repo, signs } = make()
    const [a, b] = await Promise.all([repo.signedVoiceUrl(PUBLIC + 'a.webm'), repo.signedVoiceUrl(PUBLIC + 'a.webm')])
    expect(a).toBe(b)
    expect(signs).toHaveLength(1)
  })

  it('falls back to the stored URL when signing fails, so a still-public bucket keeps working', async () => {
    const { repo } = make({ signUrl: async () => { throw new Error('Could not open the file (400)') } })
    expect(await repo.signedVoiceUrl(PUBLIC + 'a.webm')).toBe(PUBLIC + 'a.webm')
  })

  it('does not remember a failure: the next try signs again', async () => {
    let fail = true
    const { repo } = make({ signUrl: async (b, p) => { if (fail) throw new Error('x'); return 'signed:' + p } })
    expect(await repo.signedVoiceUrl(PUBLIC + 'a.webm')).toBe(PUBLIC + 'a.webm')
    fail = false
    expect(await repo.signedVoiceUrl(PUBLIC + 'a.webm')).toBe('signed:a.webm')
  })

  it('leaves a URL that is not a voice note alone, without calling anything', async () => {
    const { repo, signs } = make()
    expect(await repo.signedVoiceUrl('https://example.com/song.mp3')).toBe('https://example.com/song.mp3')
    expect(await repo.signedVoiceUrl(null)).toBeNull()
    expect(signs).toHaveLength(0)
  })
})
