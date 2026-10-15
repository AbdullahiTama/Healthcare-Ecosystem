import { describe, it, expect } from 'vitest'
import { createSafetyReportRepository } from './repository.js'

const USER = { id: 'user-1', email: 'a@example.com' }

function makeClient({ single = null, list = [], rpcData = {}, profile = { display_name: 'Ada' } } = {}) {
  const calls = []
  const builder = (table) => {
    const b = { _table: table, _op: 'select', _payload: null, _filters: [], _order: null }
    b.select = () => b
    b.insert = (payload) => { b._op = 'insert'; b._payload = payload; return b }
    b.update = (payload) => { b._op = 'update'; b._payload = payload; return b }
    b.delete = () => { b._op = 'delete'; return b }
    b.eq = (col, val) => { b._filters.push([col, val]); return b }
    b.order = (col, opts) => { b._order = [col, opts]; return b }
    b.single = async () => {
      calls.push({ table, op: b._op, payload: b._payload, filters: b._filters })
      if (table === 'profiles') return { data: profile, error: null }
      return { data: single, error: null }
    }
    b.then = (resolve) => {
      calls.push({ table, op: b._op, payload: b._payload, filters: b._filters, order: b._order })
      return Promise.resolve({ data: list, error: null }).then(resolve)
    }
    return b
  }
  const storageCalls = []
  return {
    calls,
    storageCalls,
    auth: { getUser: async () => ({ data: { user: USER } }) },
    from: (table) => builder(table),
    rpc: async (name, args) => {
      calls.push({ rpc: name, args })
      return { data: rpcData[name] ?? null, error: null }
    },
    storage: {
      from: (bucket) => ({
        upload: async (path, file, opts) => {
          storageCalls.push({ bucket, op: 'upload', path, contentType: opts?.contentType })
          return { error: null }
        },
        remove: async (paths) => {
          storageCalls.push({ bucket, op: 'remove', paths })
          return { error: null }
        },
        createSignedUrl: async (path, expiresIn) => {
          storageCalls.push({ bucket, op: 'signed', path, expiresIn })
          return { data: { signedUrl: `https://signed/${path}` }, error: null }
        },
      }),
    },
  }
}

const draft = {
  reporter: { name: 'Ada', qualification: 'consumer', phone: '0801', email: '', consentFollowup: true, anonymousConfirmed: false, facilityName: '' },
  patient: { identifier: 'AB', gender: 'female', age: '34', dob: '', ageGroup: '', weightKg: '', medicalHistory: '' },
  extra: { conditions: '', notes: '' },
}

describe('safetyReportRepository', () => {
  it('creates drafts as public, draft, owner-bound rows — never posts', async () => {
    const client = makeClient({ single: { report_id: 'r1' } })
    const repo = createSafetyReportRepository(client)
    await repo.createDraft(draft)
    const call = client.calls.find((c) => c.table === 'adr_reports')
    expect(call.op).toBe('insert')
    expect(call.payload.report_source).toBe('public')
    expect(call.payload.module_type).toBe('public')
    expect(call.payload.status).toBe('draft')
    expect(call.payload.business_id).toBe(null)
    expect(call.payload.reporter_auth_user_id).toBe(USER.id)
    expect(call.payload.reporter_name).toBe('Ada')
    expect(client.calls.some((c) => c.table === 'posts')).toBe(false)
  })

  it('lists only the caller’s own public drafts', async () => {
    const client = makeClient({ list: [] })
    const repo = createSafetyReportRepository(client)
    await repo.getMyDrafts()
    const call = client.calls.find((c) => c.table === 'adr_reports')
    expect(call.filters).toContainEqual(['reporter_auth_user_id', USER.id])
    expect(call.filters).toContainEqual(['report_source', 'public'])
    expect(call.filters).toContainEqual(['status', 'draft'])
  })

  it('maps reaction answers: yes->true, not_sure->false plus unknown entry', async () => {
    const client = makeClient({ single: { reaction_id: 'rx1' } })
    const repo = createSafetyReportRepository(client)
    await repo.saveReaction('r1', {
      description: 'Rash', severity: 'moderate', outcome: 'recovering',
      seriousness: { death: 'no', life_threatening: 'no', hospitalization: 'not_sure', disability: 'no', congenital_anomaly: 'no', other_medically_important: 'yes' },
    })
    const call = client.calls.find((c) => c.table === 'adr_report_reactions')
    expect(call.payload.seriousness_hospitalization).toBe(false)
    expect(call.payload.seriousness_unknown).toEqual(['hospitalization'])
    expect(call.payload.seriousness_other_medically_important).toBe(true)
  })

  it('coerces blank dates to null so CHECK constraints hold', async () => {
    const client = makeClient({ single: { product_id: 'p1' } })
    const repo = createSafetyReportRepository(client)
    await repo.saveProduct('r1', { brandName: 'X', expiryDate: '', startDate: '', dose: '' })
    const call = client.calls.find((c) => c.table === 'adr_report_products')
    expect(call.payload.expiry_date).toBe(null)
    expect(call.payload.dose).toBe(null)
  })

  it('uploads attachments to the private bucket under the owner folder', async () => {
    const client = makeClient({ single: { photo_id: 'ph1', evidence_photo_file: 'p' } })
    const repo = createSafetyReportRepository(client)
    const file = { name: 'rash.jpg', type: 'image/jpeg' }
    await repo.uploadAttachment('r1', file)
    const up = client.storageCalls.find((c) => c.op === 'upload')
    expect(up.bucket).toBe('adr-private')
    expect(up.path.startsWith(`${USER.id}/r1/`)).toBe(true)
    const row = client.calls.find((c) => c.table === 'adr_report_evidence_photos')
    expect(row.op).toBe('insert')
    expect(row.payload.evidence_photo_file).toBe(up.path)
  })

  it('passes route creation straight to the idempotent RPC', async () => {
    const client = makeClient({ rpcData: { create_adr_product_route: { route_id: 'rt1', status: 'pending' } } })
    const repo = createSafetyReportRepository(client)
    const out = await repo.createRoute({ reportId: 'r1', productId: 'p1', kind: 'unknown', idempotencyKey: 'k1' })
    const call = client.calls.find((c) => c.rpc === 'create_adr_product_route')
    expect(call.args.p_report_id).toBe('r1')
    expect(call.args.p_selection_kind).toBe('unknown')
    expect(call.args.p_idempotency_key).toBe('k1')
    expect(out.route_id).toBe('rt1')
  })

  it('submits through the public RPC and unwraps both shapes', async () => {
    const arrayClient = makeClient({ rpcData: { submit_adr_public_report: [{ valid: true }] } })
    expect((await createSafetyReportRepository(arrayClient).submit('r1')).valid).toBe(true)
    const objClient = makeClient({ rpcData: { submit_adr_public_report: { valid: false, missing: ['X'] } } })
    expect((await createSafetyReportRepository(objClient).submit('r1')).valid).toBe(false)
    expect(arrayClient.calls.find((c) => c.rpc === 'submit_adr_public_report').args).toEqual({ p_report_id: 'r1' })
  })

  it('searches companies with query and default limit', async () => {
    const client = makeClient({ rpcData: { search_eligible_product_companies: [] } })
    await createSafetyReportRepository(client).searchCompanies('fidson')
    expect(client.calls.find((c) => c.rpc === 'search_eligible_product_companies').args)
      .toEqual({ p_query: 'fidson', p_limit: 20 })
  })
})
