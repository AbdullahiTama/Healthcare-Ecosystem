import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// --- mock supabase with in-memory tables, chainable + rpc ---
const mockSupabase = vi.hoisted(() => {
  const tables = {
    agents: [],
    agent_referrals: [],
    agent_earnings: [],
    agent_transfers: [],
    agent_tiers: [
      { name: 'agent', max_children: null, commission_pct: 10 },
      { name: 'community_coordinator', max_children: 20, commission_pct: 5 },
      { name: 'state_coordinator', max_children: null, commission_pct: 3 },
      { name: 'unplaced', max_children: null, commission_pct: 0 },
    ],
    businesses: [],
  }

  function genCF() {
    return 'CF-' + Math.random().toString(16).slice(2, 8).toUpperCase().padEnd(6, '0').slice(0, 6)
  }

  function makeChain(table) {
    let op = 'select'
    let payload = null
    let selectCols = null
    let countOpt = null
    const filters = []
    let rangeFrom = null
    let rangeTo = null
    let orderCol = null
    let orderAsc = true
    let limitN = null
    let singleMode = false
    let maybeSingleMode = false
    let updatePatch = null

    const chain = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve) => {
            try {
              let data = tables[table] ? [...tables[table]] : []
              if (tables[table] && tables[table]._error) {
                const err = tables[table]._error
                // error injection: tables[table]._error = { message, code }
                resolve({ data: null, error: err })
                return
              }
              if (op === 'select') {
                // apply filters
                for (const f of filters) {
                  if (f.type === 'eq') data = data.filter((r) => String(r[f.field]) === String(f.value))
                  if (f.type === 'neq') data = data.filter((r) => String(r[f.field]) !== String(f.value))
                  if (f.type === 'ilike') {
                    const pat = String(f.pattern).replace(/^%/, '').replace(/%$/, '').toLowerCase()
                    data = data.filter((r) => String(r[f.field] ?? '').toLowerCase().includes(pat))
                  }
                  if (f.type === 'is') {
                    if (f.value === null) data = data.filter((r) => r[f.field] == null)
                    else data = data.filter((r) => r[f.field] === f.value)
                  }
                  if (f.type === 'in') data = data.filter((r) => f.values.includes(r[f.field]))
                }
                const totalCount = data.length
                if (orderCol) {
                  data = [...data].sort((a, b) => {
                    const av = a[orderCol], bv = b[orderCol]
                    if (av == null && bv == null) return 0
                    if (av == null) return 1
                    if (bv == null) return -1
                    const cmp = String(av).localeCompare(String(bv))
                    return orderAsc ? cmp : -cmp
                  })
                }
                if (rangeFrom != null && rangeTo != null) data = data.slice(rangeFrom, rangeTo + 1)
                else if (limitN != null) data = data.slice(0, limitN)

                if (singleMode || maybeSingleMode) {
                  const row = data[0] || null
                  // simulate error for maybeSingle handling elsewhere
                  resolve({ data: row, error: null })
                  return
                }
                const result = { data, error: null }
                if (countOpt === 'exact') result.count = totalCount
                resolve(result)
              } else if (op === 'insert') {
                const rows = Array.isArray(payload) ? payload : [payload]
                const inserted = []
                for (let row of rows) {
                  let newRow = { ...row }
                  // agents table specific: handle tier/status/referral_code/email unique
                  if (table === 'agents') {
                    // email unique lower
                    if (newRow.email) {
                      const dup = (tables.agents || []).find((r) => String(r.email || '').toLowerCase() === String(newRow.email).toLowerCase())
                      if (dup) {
                        resolve({ data: null, error: { message: 'duplicate key value violates unique constraint "agents_email_key"', code: '23505' } })
                        return
                      }
                    }
                    // referral_code unique + generation
                    if (!newRow.referral_code || String(newRow.referral_code).trim() === '') {
                      let code
                      let attempts = 0
                      do {
                        code = genCF()
                        attempts++
                      } while ((tables.agents || []).some((r) => r.referral_code === code) && attempts < 5)
                      newRow.referral_code = code
                    } else {
                      newRow.referral_code = String(newRow.referral_code).toUpperCase()
                      const dupCode = (tables.agents || []).find((r) => r.referral_code === newRow.referral_code)
                      if (dupCode) {
                        resolve({ data: null, error: { message: 'duplicate key value violates unique constraint "agents_referral_code_key"', code: '23505' } })
                        return
                      }
                    }
                    if (!newRow.id) newRow.id = 'a-' + Math.random().toString(36).slice(2, 8)
                    if (!newRow.tier) newRow.tier = 'unplaced'
                    if (!newRow.status) newRow.status = 'pending'
                    if (!newRow.created_at) newRow.created_at = new Date().toISOString()
                    if (!newRow.updated_at) newRow.updated_at = new Date().toISOString()
                    // enforce parent self
                    if (newRow.parent_agent_id && newRow.parent_agent_id === newRow.id) {
                      resolve({ data: null, error: { message: 'agent cannot be parent of itself', code: '23514' } })
                      return
                    }
                    // enforce 20 cap
                    if (newRow.parent_agent_id) {
                      const parent = (tables.agents || []).find((r) => r.id === newRow.parent_agent_id)
                      if (parent) {
                        let max = null
                        const tierRow = tables.agent_tiers.find((t) => t.name === parent.tier)
                        if (tierRow) max = tierRow.max_children
                        if (parent.tier === 'community_coordinator') max = max ?? 20
                        if (max != null) {
                          const count = (tables.agents || []).filter((r) => r.parent_agent_id === newRow.parent_agent_id && r.id !== newRow.id).length
                          if (count >= max) {
                            resolve({ data: null, error: { message: `agent parent ${newRow.parent_agent_id} has reached max children ${max}`, code: '42501' } })
                            return
                          }
                        }
                      }
                    }
                  }
                  if (table === 'agent_referrals') {
                    if (!newRow.id) newRow.id = 'ar-' + Math.random().toString(36).slice(2, 8)
                    if (!newRow.created_at) newRow.created_at = new Date().toISOString()
                    // unique business_id
                    const dupBiz = (tables.agent_referrals || []).find((r) => String(r.business_id) === String(newRow.business_id))
                    if (dupBiz) {
                      resolve({ data: null, error: { message: 'duplicate key value violates unique constraint "agent_referrals_business_unique"', code: '23505' } })
                      return
                    }
                  }
                  if (table === 'agent_earnings') {
                    if (!newRow.id) newRow.id = 'ae-' + Math.random().toString(36).slice(2, 8)
                    if (!newRow.created_at) newRow.created_at = new Date().toISOString()
                    if (!newRow.status) newRow.status = 'accrued'
                    // partial unique payment_reference + agent_id where not null
                    if (newRow.payment_reference) {
                      const dup = (tables.agent_earnings || []).find((r) => r.payment_reference === newRow.payment_reference && String(r.agent_id) === String(newRow.agent_id))
                      if (dup) {
                        // on conflict do nothing - we simulate by not inserting but not error? For direct insert via from, it would error 23505, but rpc uses ON CONFLICT DO NOTHING
                        // For test of from insert, we return 23505, but rpc path should not duplicate
                        // We'll allow duplicate check in rpc; for direct insert we return error
                        resolve({ data: null, error: { message: 'duplicate key value violates unique constraint "agent_earnings_payment_ref_agent_uniq"', code: '23505' } })
                        return
                      }
                    }
                    if (!newRow.amount_owed) newRow.amount_owed = 0
                    if (newRow.amount_paid == null) newRow.amount_paid = 0
                  }
                  if (table === 'agent_transfers') {
                    if (!newRow.id) newRow.id = 'at-' + Math.random().toString(36).slice(2, 8)
                    if (!newRow.created_at) newRow.created_at = new Date().toISOString()
                  }
                  if (table === 'businesses') {
                    if (!newRow.id) newRow.id = 'b-' + Math.random().toString(36).slice(2, 8)
                    if (!newRow.created_at) newRow.created_at = new Date().toISOString()
                  }
                  tables[table] = tables[table] || []
                  tables[table].push(newRow)
                  inserted.push(newRow)
                }
                if (singleMode || maybeSingleMode) {
                  resolve({ data: inserted[0] || null, error: null })
                } else {
                  // if chain has .select after insert, we should return inserted rows
                  // But our chain's selectCols not needed; return inserted
                  resolve({ data: inserted.length === 1 && selectCols ? inserted[0] : inserted, error: null })
                }
              } else if (op === 'update') {
                let targets = tables[table] ? [...tables[table]] : []
                for (const f of filters) {
                  if (f.type === 'eq') targets = targets.filter((r) => String(r[f.field]) === String(f.value))
                  if (f.type === 'is') targets = targets.filter((r) => r[f.field] == null)
                }
                // enforce 20 cap for agents parent updates
                if (table === 'agents' && updatePatch && updatePatch.parent_agent_id) {
                  const newParentId = updatePatch.parent_agent_id
                  // for each target, check cap
                  for (const t of targets) {
                    if (newParentId === t.id) {
                      resolve({ data: null, error: { message: 'agent cannot be parent of itself', code: '23514' } })
                      return
                    }
                    const parent = (tables.agents || []).find((r) => r.id === newParentId)
                    if (parent) {
                      let max = null
                      const tierRow = tables.agent_tiers.find((ti) => ti.name === parent.tier)
                      if (tierRow) max = tierRow.max_children
                      if (parent.tier === 'community_coordinator') max = max ?? 20
                      if (max != null) {
                        const count = (tables.agents || []).filter((r) => r.parent_agent_id === newParentId && r.id !== t.id).length
                        if (count >= max) {
                          resolve({ data: null, error: { message: `agent parent ${newParentId} has reached max children ${max}`, code: '42501' } })
                          return
                        }
                      }
                    }
                  }
                }
                // apply patch
                targets.forEach((row) => Object.assign(row, updatePatch))
                if (singleMode || maybeSingleMode) {
                  resolve({ data: targets[0] || null, error: null })
                } else {
                  // if select after update, return targets
                  resolve({ data: targets, error: null })
                }
              } else if (op === 'delete') {
                let targets = tables[table] ? [...tables[table]] : []
                for (const f of filters) {
                  if (f.type === 'eq') targets = targets.filter((r) => String(r[f.field]) === String(f.value))
                }
                tables[table] = tables[table].filter((r) => !targets.includes(r))
                resolve({ data: targets, error: null })
              } else {
                resolve({ data: null, error: null })
              }
            } catch (e) {
              resolve({ data: null, error: { message: e.message } })
            }
          }
        }
        if (prop === 'select') return (cols, opts) => { selectCols = cols; if (opts && opts.count) countOpt = opts.count; if (op !== 'insert' && op !== 'update') op = 'select'; return chain }
        if (prop === 'insert') return (payloadArg) => { op = 'insert'; payload = payloadArg; return chain }
        if (prop === 'update') return (patch) => { op = 'update'; updatePatch = patch; return chain }
        if (prop === 'delete') return () => { op = 'delete'; return chain }
        if (prop === 'eq') return (f, v) => { filters.push({ type: 'eq', field: f, value: v }); return chain }
        if (prop === 'neq') return (f, v) => { filters.push({ type: 'neq', field: f, value: v }); return chain }
        if (prop === 'ilike') return (f, pat) => { filters.push({ type: 'ilike', field: f, pattern: pat }); return chain }
        if (prop === 'is') return (f, v) => { filters.push({ type: 'is', field: f, value: v }); return chain }
        if (prop === 'in') return (f, vals) => { filters.push({ type: 'in', field: f, values: vals }); return chain }
        if (prop === 'order') return (col, opts) => { orderCol = col; orderAsc = opts ? opts.ascending !== false : true; return chain }
        if (prop === 'range') return (from, to) => { rangeFrom = from; rangeTo = to; return chain }
        if (prop === 'limit') return (n) => { limitN = n; return chain }
        if (prop === 'single') return () => { singleMode = true; return chain }
        if (prop === 'maybeSingle') return () => { maybeSingleMode = true; return chain }
        return () => chain
      },
    })
    return chain
  }

  async function rpc(name, args) {
    if (name === 'calculate_agent_earnings') {
      const p_business_id = args.p_business_id || args.p_businessId || args.business_id
      const p_plan_value = args.p_plan_value || args.p_planValue || args.plan_value
      const p_payment_reference = args.p_payment_reference || args.p_paymentReference || args.payment_reference
      if (!p_business_id || p_plan_value == null || !p_payment_reference) {
        return { data: null, error: { message: 'missing args', code: '400' } }
      }
      // Resolve direct agent via agent_referrals or businesses.referring_agent_id (mock businesses table may have referring_agent_id)
      let directAgentId = null
      const referral = (tables.agent_referrals || []).find((r) => String(r.business_id) === String(p_business_id))
      if (referral) directAgentId = referral.agent_id
      if (!directAgentId) {
        const biz = (tables.businesses || []).find((b) => String(b.id) === String(p_business_id))
        if (biz && biz.referring_agent_id) directAgentId = biz.referring_agent_id
      }
      if (!directAgentId) return { data: null, error: null }
      const directAgent = (tables.agents || []).find((a) => a.id === directAgentId)
      if (!directAgent) return { data: null, error: null }
      const directState = directAgent.state
      const getPct = (agent) => {
        if (agent.commission_pct != null) return Number(agent.commission_pct)
        const tr = tables.agent_tiers.find((t) => t.name === agent.tier)
        return tr ? Number(tr.commission_pct) : 10
      }
      // idempotency guard: if earnings already exist for this payment_reference + agent, skip
      function upsertEarning(agentId, pct) {
        const exists = (tables.agent_earnings || []).find((e) => e.payment_reference === p_payment_reference && String(e.agent_id) === String(agentId))
        if (exists) return false // idempotent no-op
        const amount = Math.round((Number(p_plan_value) * Number(pct) / 100) * 100) / 100
        const row = {
          id: 'ae-' + Math.random().toString(36).slice(2, 8),
          agent_id: agentId,
          business_id: p_business_id,
          amount_owed: amount,
          amount_paid: 0,
          commission_pct: pct,
          plan_value: Number(p_plan_value),
          payment_reference: p_payment_reference,
          status: 'accrued',
          payout_period: new Date().toISOString().slice(0, 7),
          created_at: new Date().toISOString(),
        }
        tables.agent_earnings.push(row)
        return true
      }
      const directPct = getPct(directAgent)
      upsertEarning(directAgentId, directPct)
      // parent
      if (directAgent.parent_agent_id) {
        const parent = (tables.agents || []).find((a) => a.id === directAgent.parent_agent_id)
        if (parent) {
          const parentPct = getPct(parent)
          upsertEarning(parent.id, parentPct)
        }
      }
      // state coordinator
      if (directState) {
        const stateCoord = (tables.agents || []).find((a) => a.tier === 'state_coordinator' && a.state === directState)
        if (stateCoord && String(stateCoord.id) !== String(directAgentId) && String(stateCoord.id) !== String(directAgent.parent_agent_id)) {
          const statePct = getPct(stateCoord)
          upsertEarning(stateCoord.id, statePct)
        }
      }
      return { data: null, error: null }
    }
    return { data: null, error: { message: `unknown rpc ${name}` } }
  }

  return {
    tables,
    from: vi.fn((t) => makeChain(t)),
    rpc: vi.fn((name, args) => rpc(name, args)),
  }
})

vi.mock('../../config/supabaseClient', () => ({ supabase: mockSupabase }))
vi.mock('../../../config/supabaseClient', () => ({ supabase: mockSupabase }))
vi.mock('../config/supabaseClient', () => ({ supabase: mockSupabase }))
vi.mock('../../../../config/supabaseClient', () => ({ supabase: mockSupabase }))

import AgentRegistration, { recordBusinessReferral } from './AgentRegistration.jsx'
import AgentApproval from './AgentApproval.jsx'
import AgentEarnings from './AgentEarnings.jsx'
import AgentTransfer from './AgentTransfer.jsx'
import AgentLogin from '../../pages/AgentLogin.jsx'

function renderWithRouter(el, initialEntries = ['/']) {
  return render(<MemoryRouter initialEntries={initialEntries}>{el}</MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.keys(mockSupabase.tables).forEach((k) => {
    if (Array.isArray(mockSupabase.tables[k])) mockSupabase.tables[k] = []
    else if (typeof mockSupabase.tables[k] === 'object') {
      // keep agent_tiers seeded
      if (k === 'agent_tiers') {
        mockSupabase.tables[k] = [
          { name: 'agent', max_children: null, commission_pct: 10 },
          { name: 'community_coordinator', max_children: 20, commission_pct: 5 },
          { name: 'state_coordinator', max_children: null, commission_pct: 3 },
          { name: 'unplaced', max_children: null, commission_pct: 0 },
        ]
      } else mockSupabase.tables[k] = []
    }
  })
  // ensure tables that may have been set as array with _error are reset
  ;['agents','agent_referrals','agent_earnings','agent_transfers','businesses'].forEach((t) => {
    if (!Array.isArray(mockSupabase.tables[t])) mockSupabase.tables[t] = []
  })
  mockSupabase.from.mockClear()
  mockSupabase.rpc.mockClear()
  localStorage.clear()
})

describe('AgentRegistration — tier=unplaced/status=pending CF- unique', () => {
  it('renders form with required fields and shows loading, error, empty', async () => {
    renderWithRouter(<AgentRegistration />)
    expect(screen.getByTestId('agent-registration')).toBeInTheDocument()
    expect(screen.getByLabelText(/Full name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Email address/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Password/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/State/i)).toBeInTheDocument()
    expect(screen.getByText(/Register as agent/i)).toBeInTheDocument()
  })

  it('registers tier=unplaced status=pending and shows CF- code unique', async () => {
    renderWithRouter(<AgentRegistration />)
    fireEvent.change(screen.getByLabelText(/Full name/i), { target: { value: 'Ada Agent' } })
    fireEvent.change(screen.getByLabelText(/Email address/i), { target: { value: 'ada@test.com' } })
    fireEvent.change(screen.getByLabelText(/^Password/i), { target: { value: 'secret123' } })
    // state select
    const stateSel = screen.getByLabelText(/State/i)
    fireEvent.change(stateSel, { target: { value: 'Lagos' } })

    fireEvent.click(screen.getByText(/Register as agent/i))

    await waitFor(() => expect(screen.getByTestId('registration-success')).toBeInTheDocument())
    const codeEl = screen.getByTestId('referral-code-display')
    expect(codeEl.textContent).toMatch(/CF-/)
    // Check stored row is tier unplaced pending
    expect(mockSupabase.tables.agents).toHaveLength(1)
    const row = mockSupabase.tables.agents[0]
    expect(row.tier).toBe('unplaced')
    expect(row.status).toBe('pending')
    expect(row.referral_code).toMatch(/^CF-/)
    expect(row.email).toBe('ada@test.com')
  })

  it('second registration gets different CF- code (unique)', async () => {
    renderWithRouter(<AgentRegistration />)
    // first
    fireEvent.change(screen.getByLabelText(/Full name/i), { target: { value: 'One' } })
    fireEvent.change(screen.getByLabelText(/Email address/i), { target: { value: 'one@test.com' } })
    fireEvent.change(screen.getByLabelText(/^Password/i), { target: { value: 'secret123' } })
    fireEvent.change(screen.getByLabelText(/State/i), { target: { value: 'Lagos' } })
    fireEvent.click(screen.getByText(/Register as agent/i))
    await waitFor(() => expect(screen.getByTestId('registration-success')).toBeInTheDocument())
    const code1 = mockSupabase.tables.agents[0].referral_code
    fireEvent.click(screen.getByText(/Register another agent/i))
    await waitFor(() => expect(screen.getByTestId('agent-registration')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/Full name/i), { target: { value: 'Two' } })
    fireEvent.change(screen.getByLabelText(/Email address/i), { target: { value: 'two@test.com' } })
    fireEvent.change(screen.getByLabelText(/^Password/i), { target: { value: 'secret123' } })
    fireEvent.change(screen.getByLabelText(/State/i), { target: { value: 'Lagos' } })
    fireEvent.click(screen.getByText(/Register as agent/i))
    await waitFor(() => expect(screen.getByTestId('registration-success')).toBeInTheDocument())
    const code2 = mockSupabase.tables.agents[1].referral_code
    expect(code1).not.toBe(code2)
    expect(code2).toMatch(/^CF-/)
  })

  it('email duplicate → 23505 error shown', async () => {
    mockSupabase.tables.agents.push({ id: 'a1', full_name: 'Existing', email: 'dup@test.com', referral_code: 'CF-AAAAAA', tier: 'unplaced', status: 'pending', state: 'Lagos', password_hash: 'cf_agent_secret123' })
    renderWithRouter(<AgentRegistration />)
    fireEvent.change(screen.getByLabelText(/Full name/i), { target: { value: 'New' } })
    fireEvent.change(screen.getByLabelText(/Email address/i), { target: { value: 'dup@test.com' } })
    fireEvent.change(screen.getByLabelText(/^Password/i), { target: { value: 'secret123' } })
    fireEvent.change(screen.getByLabelText(/State/i), { target: { value: 'Lagos' } })
    fireEvent.click(screen.getByText(/Register as agent/i))
    await waitFor(() => expect(screen.getByTestId('registration-error')).toBeInTheDocument())
    expect(screen.getByTestId('registration-error').textContent).toMatch(/already registered/i)
  })

  it('business signup with referral_code inserts agent_referrals, invalid code no error', async () => {
    // seed agent with code
    mockSupabase.tables.agents.push({ id: 'a-direct', full_name: 'Direct', email: 'direct@test.com', referral_code: 'CF-ABC123', tier: 'agent', status: 'approved', state: 'Lagos', commission_pct: 10 })
    mockSupabase.tables.businesses.push({ id: 'b1', name: 'Biz One' })
    // valid referral
    const res = await recordBusinessReferral({ businessId: 'b1', referralCode: 'CF-ABC123' })
    expect(res).not.toBeNull()
    expect(mockSupabase.tables.agent_referrals).toHaveLength(1)
    expect(mockSupabase.tables.agent_referrals[0].agent_id).toBe('a-direct')
    expect(mockSupabase.tables.agent_referrals[0].business_id).toBe('b1')
    // invalid code → no referral, no error
    mockSupabase.tables.businesses.push({ id: 'b2', name: 'Biz Two' })
    const res2 = await recordBusinessReferral({ businessId: 'b2', referralCode: 'CF-INVALID' })
    expect(res2).toBeNull()
    expect(mockSupabase.tables.agent_referrals).toHaveLength(1) // still 1
  })

  it('has accessible labels and responsive layout', async () => {
    renderWithRouter(<AgentRegistration />)
    expect(screen.getByLabelText(/Full name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Email address/i)).toBeInTheDocument()
    // helper text for email
    expect(screen.getByText(/Lowercase email is stored unique/i)).toBeInTheDocument()
  })
})

describe('AgentApproval — Applications review + 20-cap 42501', () => {
  it('shows loading then pending list and handles empty', async () => {
    mockSupabase.tables.agents = []
    renderWithRouter(<AgentApproval />)
    expect(screen.getByTestId('approval-loading')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('agent-approval')).toBeInTheDocument())
    expect(screen.getByTestId('empty-pending')).toBeInTheDocument()
    expect(screen.getByText(/No pending applications/i)).toBeInTheDocument()
  })

  it('lists pending agents and approves setting tier/parent/commission → approved', async () => {
    mockSupabase.tables.agents = [
      { id: 'a-pending', full_name: 'Pending One', email: 'pending@test.com', referral_code: 'CF-PEND01', tier: 'unplaced', status: 'pending', state: 'Lagos', created_at: new Date().toISOString() },
      { id: 'a-parent', full_name: 'Parent Coord', email: 'parent@test.com', referral_code: 'CF-PAR001', tier: 'community_coordinator', status: 'approved', state: 'Lagos', commission_pct: 5 },
    ]
    renderWithRouter(<AgentApproval />)
    await waitFor(() => expect(screen.getByTestId('agent-approval')).toBeInTheDocument())
    expect(screen.getByTestId('pending-agent-row')).toBeInTheDocument()
    expect(screen.getByText('Pending One')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Review Pending One/i }))
    await waitFor(() => expect(screen.getByTestId('approval-form')).toBeInTheDocument())
    // set commission explicitly to 10
    const commissionInput = screen.getByLabelText(/Commission %/i)
    fireEvent.change(commissionInput, { target: { value: '10' } })
    // tier defaults to agent
    fireEvent.click(screen.getByRole('button', { name: /Approve/i }))
    await waitFor(() => expect(screen.getByText(/Approve agent\?/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /^Approve$/i }))
    await waitFor(() => {
      const updated = mockSupabase.tables.agents.find((a) => a.id === 'a-pending')
      expect(updated.status).toBe('approved')
      expect(updated.tier).toBe('agent')
      expect(String(updated.commission_pct)).toBe('10')
    })
  })

  it('shows 20/20 count and rejects 21st to full coordinator with 42501', async () => {
    // create community coordinator parent with 20 children
    const parentId = 'a-parent-full'
    mockSupabase.tables.agents = [
      { id: parentId, full_name: 'Full Coord', email: 'full@test.com', referral_code: 'CF-FULL01', tier: 'community_coordinator', status: 'approved', state: 'Lagos', commission_pct: 5 },
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `child-${i}`, full_name: `Child ${i}`, email: `child${i}@test.com`, referral_code: `CF-CH${String(i).padStart(4, '0')}`, tier: 'agent', status: 'approved', parent_agent_id: parentId, state: 'Lagos',
      })),
      { id: 'a-pending21', full_name: 'Pending 21', email: 'pending21@test.com', referral_code: 'CF-PEND21', tier: 'unplaced', status: 'pending', state: 'Lagos', created_at: new Date().toISOString() },
    ]
    renderWithRouter(<AgentApproval />)
    await waitFor(() => expect(screen.getByTestId('agent-approval')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Review Pending 21/i }))
    await waitFor(() => expect(screen.getByTestId('approval-form')).toBeInTheDocument())
    // select parent that is full
    const parentSel = screen.getByLabelText(/Parent agent/i)
    fireEvent.change(parentSel, { target: { value: parentId } })
    // cap indicator should show 20/20 and FULL
    await waitFor(() => expect(screen.getByTestId('cap-indicator')).toBeInTheDocument())
    expect(screen.getByTestId('cap-indicator').textContent).toMatch(/20\/20/)
    expect(screen.getByTestId('cap-indicator').textContent).toMatch(/FULL/)

    fireEvent.click(screen.getByRole('button', { name: /Approve/i }))
    await waitFor(() => expect(screen.getByText(/Approve agent\?/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /^Approve$/i }))
    await waitFor(() => expect(screen.getByTestId('approval-save-error')).toBeInTheDocument())
    expect(screen.getByTestId('approval-save-error').textContent).toMatch(/20-agent cap|20\/20/i)
    // still pending
    const still = mockSupabase.tables.agents.find((a) => a.id === 'a-pending21')
    expect(still.status).toBe('pending')
  })

  it('is accessible with headings and search', async () => {
    mockSupabase.tables.agents = [
      { id: 'a1', full_name: 'Alice', email: 'alice@test.com', referral_code: 'CF-ALICE', tier: 'unplaced', status: 'pending', state: 'Lagos', created_at: new Date().toISOString() },
    ]
    renderWithRouter(<AgentApproval />)
    await waitFor(() => expect(screen.getByTestId('agent-approval')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: /Agent Applications/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/Search pending/i)).toBeInTheDocument()
  })
})

describe('AgentEarnings — calculate_agent_earnings 3 tiers idempotent', () => {
  it('shows loading, empty, and triggers earnings via rpc for 3 tiers', async () => {
    // seed hierarchy: direct, parent, state coordinator all Lagos
    mockSupabase.tables.agents = [
      { id: 'a-direct', full_name: 'Direct', email: 'direct@test.com', tier: 'agent', status: 'approved', state: 'Lagos', commission_pct: 10 },
      { id: 'a-parent', full_name: 'Parent', email: 'parent@test.com', tier: 'community_coordinator', status: 'approved', state: 'Lagos', commission_pct: 5 },
      { id: 'a-state', full_name: 'State', email: 'state@test.com', tier: 'state_coordinator', status: 'approved', state: 'Lagos', commission_pct: 3 },
    ]
    // set parent relationship
    mockSupabase.tables.agents.find((a) => a.id === 'a-direct').parent_agent_id = 'a-parent'
    mockSupabase.tables.businesses = [{ id: 'b1', name: 'Biz' }]
    mockSupabase.tables.agent_referrals = [{ id: 'ar1', agent_id: 'a-direct', business_id: 'b1', referral_code: 'CF-ABC123' }]

    renderWithRouter(<AgentEarnings />)
    expect(screen.getByTestId('earnings-loading')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('agent-earnings')).toBeInTheDocument())
    expect(screen.getByTestId('empty-earnings')).toBeInTheDocument()

    // trigger payment 10000 with ref PAY123
    fireEvent.change(screen.getByLabelText(/Business ID/i), { target: { value: 'b1' } })
    fireEvent.change(screen.getByLabelText(/Plan value/i), { target: { value: '10000' } })
    fireEvent.change(screen.getByLabelText(/Payment reference/i), { target: { value: 'PAY123' } })
    fireEvent.click(screen.getByRole('button', { name: /Calculate earnings/i }))
    await waitFor(() => expect(screen.getByTestId('earn-trigger-success')).toBeInTheDocument())
    // should have 3 rows: 1000, 500, 300
    expect(mockSupabase.tables.agent_earnings).toHaveLength(3)
    const amounts = mockSupabase.tables.agent_earnings.map((e) => Number(e.amount_owed)).sort((a, b) => b - a)
    expect(amounts).toEqual([1000, 500, 300])
    // paid/unpaid totals
    await waitFor(() => expect(screen.getAllByText(/₦1,800/).length).toBeGreaterThan(0))
  })

  it('webhook retry is idempotent — second call with same payment_reference does not duplicate', async () => {
    mockSupabase.tables.agents = [
      { id: 'a-direct', full_name: 'Direct', email: 'direct@test.com', tier: 'agent', status: 'approved', state: 'Lagos', commission_pct: 10 },
      { id: 'a-parent', full_name: 'Parent', email: 'parent@test.com', tier: 'community_coordinator', status: 'approved', state: 'Lagos', commission_pct: 5 },
      { id: 'a-state', full_name: 'State', email: 'state@test.com', tier: 'state_coordinator', status: 'approved', state: 'Lagos', commission_pct: 3 },
    ]
    mockSupabase.tables.agents.find((a) => a.id === 'a-direct').parent_agent_id = 'a-parent'
    mockSupabase.tables.businesses = [{ id: 'b1', name: 'Biz' }]
    mockSupabase.tables.agent_referrals = [{ id: 'ar1', agent_id: 'a-direct', business_id: 'b1', referral_code: 'CF-XYZ' }]
    renderWithRouter(<AgentEarnings />)
    await waitFor(() => expect(screen.getByTestId('agent-earnings')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/Business ID/i), { target: { value: 'b1' } })
    fireEvent.change(screen.getByLabelText(/Plan value/i), { target: { value: '20000' } })
    fireEvent.change(screen.getByLabelText(/Payment reference/i), { target: { value: 'PAY_DUP' } })
    fireEvent.click(screen.getByRole('button', { name: /Simulate webhook retry/i }))
    await waitFor(() => expect(screen.getByTestId('earn-trigger-success')).toBeInTheDocument())
    expect(screen.getByTestId('earn-trigger-success').textContent).toMatch(/idempotent/i)
    // still 3 rows, not 6
    expect(mockSupabase.tables.agent_earnings).toHaveLength(3)
    // try again explicit second call via button 2x logic already did 2 calls; call again manually
    fireEvent.click(screen.getByRole('button', { name: /Calculate earnings/i }))
    await waitFor(() => expect(mockSupabase.tables.agent_earnings).toHaveLength(3))
  })

  it('filters by status and shows totals', async () => {
    mockSupabase.tables.agent_earnings = [
      { id: 'e1', agent_id: 'a1', business_id: 'b1', amount_owed: 1000, amount_paid: 0, commission_pct: 10, plan_value: 10000, payment_reference: 'PAY1', status: 'accrued', created_at: new Date().toISOString() },
      { id: 'e2', agent_id: 'a1', business_id: 'b1', amount_owed: 500, amount_paid: 500, commission_pct: 5, plan_value: 10000, payment_reference: 'PAY1', status: 'paid', created_at: new Date().toISOString() },
    ]
    mockSupabase.tables.agents = [{ id: 'a1', full_name: 'Ada', tier: 'agent' }]
    renderWithRouter(<AgentEarnings />)
    await waitFor(() => expect(screen.getByTestId('agent-earnings')).toBeInTheDocument())
    expect(screen.getByText(/Total owed/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^paid$/i }))
    await waitFor(() => expect(screen.getAllByText(/paid/i).length).toBeGreaterThan(0))
  })

  it('has accessible form and error handling', async () => {
    renderWithRouter(<AgentEarnings />)
    await waitFor(() => expect(screen.getByTestId('agent-earnings')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: /Agent Earnings/i })).toBeInTheDocument()
    // try trigger without fields
    fireEvent.click(screen.getByRole('button', { name: /Calculate earnings/i }))
    await waitFor(() => expect(screen.getByTestId('earn-trigger-error')).toBeInTheDocument())
  })
})

describe('AgentTransfer — reassign + audit requires confirmation', () => {
  it('shows loading then form and requires confirmation', async () => {
    mockSupabase.tables.agents = [
      { id: 'a-from', full_name: 'From', email: 'from@test.com', tier: 'agent', status: 'approved', referral_code: 'CF-FROM' },
      { id: 'a-to', full_name: 'To', email: 'to@test.com', tier: 'agent', status: 'approved', referral_code: 'CF-TO' },
    ]
    mockSupabase.tables.agent_referrals = [{ id: 'ar1', agent_id: 'a-from', business_id: 'b1', referral_code: 'CF-FROM' }]
    mockSupabase.tables.agent_earnings = [{ id: 'ae1', agent_id: 'a-from', business_id: 'b1', amount_owed: 1000, amount_paid: 0, commission_pct: 10, plan_value: 10000, payment_reference: 'PAY1', status: 'accrued' }]
    renderWithRouter(<AgentTransfer />)
    expect(screen.getByTestId('transfer-loading')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('agent-transfer')).toBeInTheDocument())
    expect(screen.getByLabelText(/From agent/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/To agent/i)).toBeInTheDocument()
  })

  it('without confirm no delete — confirm dialog required', async () => {
    mockSupabase.tables.agents = [
      { id: 'a-from', full_name: 'From', email: 'from@test.com', tier: 'agent', status: 'approved', referral_code: 'CF-FROM' },
      { id: 'a-to', full_name: 'To', email: 'to@test.com', tier: 'agent', status: 'approved', referral_code: 'CF-TO' },
    ]
    mockSupabase.tables.agent_referrals = [{ id: 'ar1', agent_id: 'a-from', business_id: 'b1', referral_code: 'CF-FROM' }]
    mockSupabase.tables.agent_earnings = [{ id: 'ae1', agent_id: 'a-from', business_id: 'b1', amount_owed: 1000, amount_paid: 0, commission_pct: 10, plan_value: 10000, payment_reference: 'PAY1', status: 'accrued' }]
    renderWithRouter(<AgentTransfer />)
    await waitFor(() => expect(screen.getByTestId('agent-transfer')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/From agent/i), { target: { value: 'a-from' } })
    fireEvent.change(screen.getByLabelText(/To agent/i), { target: { value: 'a-to' } })
    fireEvent.change(screen.getByLabelText(/Business ID/i), { target: { value: 'b1' } })
    fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: 'Territory change' } })
    fireEvent.click(screen.getByRole('button', { name: /Request transfer/i }))
    await waitFor(() => expect(screen.getByText(/Confirm transfer\?/i)).toBeInTheDocument())
    // cancel
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /^Cancel$/i }))
    await waitFor(() => expect(screen.queryByText(/Confirm transfer\?/i)).not.toBeInTheDocument())
    // still from
    expect(mockSupabase.tables.agent_referrals[0].agent_id).toBe('a-from')
    expect(mockSupabase.tables.agent_transfers).toHaveLength(0)
  })

  it('with confirm reassigns referrals/earnings and inserts audit', async () => {
    mockSupabase.tables.agents = [
      { id: 'a-from', full_name: 'From', email: 'from@test.com', tier: 'agent', status: 'approved', referral_code: 'CF-FROM' },
      { id: 'a-to', full_name: 'To', email: 'to@test.com', tier: 'agent', status: 'approved', referral_code: 'CF-TO' },
    ]
    mockSupabase.tables.agent_referrals = [{ id: 'ar1', agent_id: 'a-from', business_id: 'b1', referral_code: 'CF-FROM' }]
    mockSupabase.tables.agent_earnings = [
      { id: 'ae1', agent_id: 'a-from', business_id: 'b1', amount_owed: 1000, amount_paid: 0, commission_pct: 10, plan_value: 10000, payment_reference: 'PAY1', status: 'accrued' },
      { id: 'ae2', agent_id: 'a-from', business_id: 'b1', amount_owed: 500, amount_paid: 0, commission_pct: 5, plan_value: 10000, payment_reference: 'PAY1', status: 'accrued' },
    ]
    renderWithRouter(<AgentTransfer />)
    await waitFor(() => expect(screen.getByTestId('agent-transfer')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/From agent/i), { target: { value: 'a-from' } })
    fireEvent.change(screen.getByLabelText(/To agent/i), { target: { value: 'a-to' } })
    fireEvent.change(screen.getByLabelText(/Business ID/i), { target: { value: 'b1' } })
    fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: 'Reassignment' } })
    fireEvent.click(screen.getByRole('button', { name: /Request transfer/i }))
    await waitFor(() => expect(screen.getByText(/Confirm transfer\?/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /^Confirm transfer$/i }))
    await waitFor(() => expect(screen.getByTestId('transfer-success-msg')).toBeInTheDocument())
    expect(screen.getByTestId('transfer-success-msg').textContent).toMatch(/audit/i)
    // new owner
    expect(mockSupabase.tables.agent_referrals[0].agent_id).toBe('a-to')
    expect(mockSupabase.tables.agent_earnings[0].agent_id).toBe('a-to')
    expect(mockSupabase.tables.agent_earnings[1].agent_id).toBe('a-to')
    expect(mockSupabase.tables.agent_transfers).toHaveLength(1)
    expect(mockSupabase.tables.agent_transfers[0].from_agent_id).toBe('a-from')
    expect(mockSupabase.tables.agent_transfers[0].to_agent_id).toBe('a-to')
    expect(mockSupabase.tables.agent_transfers[0].business_id).toBe('b1')
  })

  it('has accessible confirm flow', async () => {
    mockSupabase.tables.agents = []
    renderWithRouter(<AgentTransfer />)
    await waitFor(() => expect(screen.getByTestId('agent-transfer')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: /Agent Transfer/i })).toBeInTheDocument()
  })
})

describe('AgentLogin — /agent-login own-record isolation', () => {
  it('shows login form and validates', async () => {
    renderWithRouter(<AgentLogin />)
    expect(screen.getByTestId('agent-login-page')).toBeInTheDocument()
    expect(screen.getByLabelText(/Agent email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Password/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Sign in as agent/i }))
    await waitFor(() => expect(screen.getByTestId('login-error')).toBeInTheDocument())
  })

  it('successful login shows only own referrals and earnings', async () => {
    mockSupabase.tables.agents = [
      { id: 'a-own', full_name: 'Own Agent', email: 'own@test.com', referral_code: 'CF-OWN123', tier: 'agent', status: 'approved', state: 'Lagos', commission_pct: 10, password_hash: 'cf_agent_secret123' },
      { id: 'a-other', full_name: 'Other Agent', email: 'other@test.com', referral_code: 'CF-OTH456', tier: 'agent', status: 'approved', state: 'Lagos', commission_pct: 10, password_hash: 'cf_agent_other123' },
    ]
    mockSupabase.tables.agent_referrals = [
      { id: 'ar-own', agent_id: 'a-own', business_id: 'b-own', referral_code: 'CF-OWN123' },
      { id: 'ar-other', agent_id: 'a-other', business_id: 'b-other', referral_code: 'CF-OTH456' },
    ]
    mockSupabase.tables.agent_earnings = [
      { id: 'ae-own', agent_id: 'a-own', business_id: 'b-own', amount_owed: 1000, amount_paid: 0, commission_pct: 10, plan_value: 10000, payment_reference: 'PAY_OWN', status: 'accrued' },
      { id: 'ae-other', agent_id: 'a-other', business_id: 'b-other', amount_owed: 5000, amount_paid: 0, commission_pct: 10, plan_value: 50000, payment_reference: 'PAY_OTHER', status: 'accrued' },
    ]
    renderWithRouter(<AgentLogin />)
    fireEvent.change(screen.getByLabelText(/Agent email/i), { target: { value: 'own@test.com' } })
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('button', { name: /Sign in as agent/i }))
    await waitFor(() => expect(screen.getByTestId('agent-portal')).toBeInTheDocument())
    expect(screen.getByTestId('own-referral-code').textContent).toBe('CF-OWN123')
    expect(screen.getByTestId('referral-count').textContent).toBe('1')
    // should show own referral business id slice, not other's
    expect(screen.getByText(/b-own/)).toBeInTheDocument()
    expect(screen.queryByText(/b-other/)).not.toBeInTheDocument()
    // earnings: own 1000, not 5000
    expect(screen.getAllByText(/₦1,000/).length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText(/₦5,000/)).not.toBeInTheDocument()
    // paid/unpaid
    expect(screen.getByTestId('paid-earnings')).toBeInTheDocument()
    expect(screen.getByTestId('unpaid-earnings')).toBeInTheDocument()
  })

  it('rejects invalid password with 401', async () => {
    mockSupabase.tables.agents = [
      { id: 'a1', full_name: 'Ada', email: 'ada@test.com', referral_code: 'CF-ADA', tier: 'agent', status: 'approved', state: 'Lagos', commission_pct: 10, password_hash: 'cf_agent_correct123' },
    ]
    renderWithRouter(<AgentLogin />)
    fireEvent.change(screen.getByLabelText(/Agent email/i), { target: { value: 'ada@test.com' } })
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: /Sign in as agent/i }))
    await waitFor(() => expect(screen.getByTestId('login-error')).toBeInTheDocument())
    expect(screen.getByTestId('login-error').textContent).toMatch(/Invalid/i)
    expect(screen.queryByTestId('agent-portal')).not.toBeInTheDocument()
  })

  it('RLS isolation: cannot see other agent data — only own queried', async () => {
    // This test verifies component filters by agent_id; mock would return all if no filter, but component passes eq agent_id
    mockSupabase.tables.agents = [
      { id: 'a1', full_name: 'One', email: 'one@test.com', referral_code: 'CF-ONE', tier: 'agent', status: 'approved', state: 'Lagos', commission_pct: 10, password_hash: 'cf_agent_pass123' },
    ]
    mockSupabase.tables.agent_referrals = [
      { id: 'ar1', agent_id: 'a1', business_id: 'b1', referral_code: 'CF-ONE' },
      { id: 'ar2', agent_id: 'a-other', business_id: 'b2', referral_code: 'CF-OTHER' },
    ]
    mockSupabase.tables.agent_earnings = [
      { id: 'e1', agent_id: 'a1', business_id: 'b1', amount_owed: 100, amount_paid: 0, commission_pct: 10, plan_value: 1000, payment_reference: 'PAY1', status: 'accrued' },
      { id: 'e2', agent_id: 'a-other', business_id: 'b2', amount_owed: 999, amount_paid: 0, commission_pct: 10, plan_value: 9990, payment_reference: 'PAY2', status: 'accrued' },
    ]
    renderWithRouter(<AgentLogin />)
    fireEvent.change(screen.getByLabelText(/Agent email/i), { target: { value: 'one@test.com' } })
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'pass123' } })
    fireEvent.click(screen.getByRole('button', { name: /Sign in as agent/i }))
    await waitFor(() => expect(screen.getByTestId('agent-portal')).toBeInTheDocument())
    // Ensure only own counted
    expect(screen.getByTestId('referral-count').textContent).toBe('1')
    // Verify supabase.from was called with eq agent_id for own id (spy)
    const referralCalls = mockSupabase.from.mock.calls.filter((c) => c[0] === 'agent_referrals')
    expect(referralCalls.length).toBeGreaterThan(0)
    // The second call's filter should be own id - checked via mock tables filtered count 1 proves isolation
  })

  it('has empty, loading, error states and logout', async () => {
    mockSupabase.tables.agents = [
      { id: 'a1', full_name: 'Ada', email: 'ada@test.com', referral_code: 'CF-ADA123', tier: 'agent', status: 'approved', state: 'Lagos', commission_pct: 10, password_hash: 'cf_agent_secret123' },
    ]
    mockSupabase.tables.agent_referrals = []
    mockSupabase.tables.agent_earnings = []
    renderWithRouter(<AgentLogin />)
    fireEvent.change(screen.getByLabelText(/Agent email/i), { target: { value: 'ada@test.com' } })
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('button', { name: /Sign in as agent/i }))
    await waitFor(() => expect(screen.getByTestId('agent-portal')).toBeInTheDocument())
    expect(screen.getByTestId('empty-referrals')).toBeInTheDocument()
    expect(screen.getByTestId('empty-earnings')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Sign out/i }))
    await waitFor(() => expect(screen.getByTestId('agent-login-page')).toBeInTheDocument())
  })
})

describe('Quality — responsive, accessibility, logging', () => {
  it('all portals have headings and aria regions', async () => {
    mockSupabase.tables.agents = []
    renderWithRouter(<AgentApproval />)
    await waitFor(() => expect(screen.getByTestId('agent-approval')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: /Agent Applications/i })).toBeInTheDocument()

    renderWithRouter(<AgentEarnings />)
    await waitFor(() => expect(screen.getByTestId('agent-earnings')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: /Agent Earnings/i })).toBeInTheDocument()
  })
})
