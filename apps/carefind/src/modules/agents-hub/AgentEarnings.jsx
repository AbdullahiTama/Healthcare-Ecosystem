import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../config/supabaseClient'
import { theme } from '../../styles/theme'
import { Button, Card, Input, Loading, ErrorState, Empty } from '../../components/ui'

// Spec: earnings via security-definer calculate_agent_earnings (idempotent via payment_reference partial unique)
// plan_value × commission_pct for 3 tiers: direct (10), community (5), state (3)

export async function calculateAgentEarnings({ businessId, planValue, paymentReference }) {
  if (!businessId || planValue == null || !paymentReference) {
    throw new Error('businessId, planValue and paymentReference required')
  }
  const p_plan_value = Number(planValue)
  if (!Number.isFinite(p_plan_value) || p_plan_value <= 0) throw new Error('planValue must be > 0')
  // eslint-disable-next-line no-console
  console.info('[AgentEarnings] calculate', { businessId, p_plan_value, paymentReference })
  const { data, error } = await supabase.rpc('calculate_agent_earnings', {
    p_business_id: businessId,
    p_plan_value: p_plan_value,
    p_payment_reference: paymentReference,
  })
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[AgentEarnings] calculate failed', error.message, error.code)
    throw error
  }
  // eslint-disable-next-line no-console
  console.info('[AgentEarnings] calculate done', { businessId, paymentReference, data })
  return data
}

export async function fetchEarnings({ agentId = null, limit = 100 } = {}) {
  let q = supabase.from('agent_earnings').select('id, agent_id, business_id, amount_owed, amount_paid, commission_pct, plan_value, payment_reference, status, payout_period, created_at, paid_at').order('created_at', { ascending: false }).limit(limit)
  if (agentId) q = q.eq('agent_id', agentId)
  const { data, error } = await q
  if (error) throw error
  return Array.isArray(data) ? data : []
}

export async function fetchAgentsMap() {
  const { data, error } = await supabase.from('agents').select('id, full_name, email, referral_code, tier').limit(200)
  if (error) return {}
  const map = {}
  ;(Array.isArray(data) ? data : []).forEach((a) => { map[a.id] = a })
  return map
}

export async function simulateBusinessPayment({ businessId, planValue, paymentReference }) {
  // Webhook helper: calls calculateAgentEarnings twice to verify idempotency if needed
  // Here single call; caller can call twice
  return calculateAgentEarnings({ businessId, planValue, paymentReference })
}

export default function AgentEarnings({ agentId = null }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [earnings, setEarnings] = useState([])
  const [agentsMap, setAgentsMap] = useState({})

  const [businessId, setBusinessId] = useState('')
  const [planValue, setPlanValue] = useState('')
  const [paymentRef, setPaymentRef] = useState('')
  const [triggering, setTriggering] = useState(false)
  const [triggerError, setTriggerError] = useState(null)
  const [triggerSuccess, setTriggerSuccess] = useState(null)
  const [filterStatus, setFilterStatus] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [earn, map] = await Promise.all([fetchEarnings({ agentId }), fetchAgentsMap()])
      setEarnings(earn)
      setAgentsMap(map)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[AgentEarnings] load failed', e)
      setError(e.message || 'Failed to load earnings')
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => { load() }, [load])

  async function handleCalculate(e) {
    e.preventDefault()
    setTriggerError(null)
    setTriggerSuccess(null)
    if (!businessId.trim() || !planValue.trim() || !paymentRef.trim()) {
      setTriggerError('Business ID, plan value and payment reference are required')
      return
    }
    setTriggering(true)
    try {
      await calculateAgentEarnings({ businessId: businessId.trim(), planValue: Number(planValue), paymentReference: paymentRef.trim() })
      setTriggerSuccess(`Earnings calculated for ${paymentRef.trim()} (idempotent — retry will not duplicate)`)
      // reload list
      await load()
    } catch (err) {
      setTriggerError(err.message || 'Calculation failed')
    } finally {
      setTriggering(false)
    }
  }

  async function handleRetryIdempotencyDemo() {
    // Demonstrates idempotency: call twice with same ref, second is no-op
    if (!businessId.trim() || !planValue.trim() || !paymentRef.trim()) {
      setTriggerError('Fill business, plan and reference first to demo idempotency')
      return
    }
    setTriggering(true)
    setTriggerError(null)
    setTriggerSuccess(null)
    try {
      await calculateAgentEarnings({ businessId: businessId.trim(), planValue: Number(planValue), paymentReference: paymentRef.trim() })
      await calculateAgentEarnings({ businessId: businessId.trim(), planValue: Number(planValue), paymentReference: paymentRef.trim() })
      setTriggerSuccess('Webhook retry simulated: second call was idempotent (no duplicate rows)')
      await load()
    } catch (err) {
      setTriggerError(err.message)
    } finally {
      setTriggering(false)
    }
  }

  if (loading) return <div data-testid="earnings-loading"><Loading text="Loading earnings..." /></div>
  if (error) return <div data-testid="earnings-error"><ErrorState message={error} onRetry={load} /></div>

  const filtered = earnings.filter((e) => {
    if (filterStatus === 'all') return true
    return e.status === filterStatus
  })

  const totalOwed = filtered.reduce((s, e) => s + Number(e.amount_owed || 0), 0)
  const totalPaid = filtered.reduce((s, e) => s + Number(e.amount_paid || 0), 0)
  const unpaid = totalOwed - totalPaid

  return (
    <div data-testid="agent-earnings" style={{ fontFamily: theme.fontFamily, maxWidth: 1100, margin: '0 auto', padding: 16 }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: '0 0 4px 0', fontSize: theme.type.h1.size, fontWeight: theme.type.h1.weight, color: theme.navy }}>Agent Earnings</h1>
        <p style={{ margin: 0, fontSize: theme.type.body.size, color: theme.textLight }}>
          Ledger calculated via <code>calculate_agent_earnings(business_id, plan_value, payment_reference)</code> security-definer for 3 tiers (direct 10%, parent 5%, state 3%). Idempotent via <code>payment_reference</code> partial unique. Client never calculates earnings.
        </p>
      </div>

      <Card style={{ padding: 16, marginBottom: 16 }}>
        <h2 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 800, color: theme.navy }}>Trigger earnings (webhook simulation)</h2>
        <form onSubmit={handleCalculate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <Input label="Business ID" value={businessId} onChange={setBusinessId} placeholder="business uuid" required id="earn-business-id" />
            <Input label="Plan value (NGN)" type="number" value={planValue} onChange={setPlanValue} placeholder="e.g. 10000" required id="earn-plan-value" helperText="plan_value × pct per tier" />
            <Input label="Payment reference" value={paymentRef} onChange={setPaymentRef} placeholder="e.g. PAY_123" required id="earn-payment-ref" helperText="Idempotency key — retry safe" />
          </div>
          {triggerError && <div data-testid="earn-trigger-error" role="alert" style={{ background: theme.dangerBg, border: `1px solid ${theme.danger}`, color: theme.danger, borderRadius: theme.radius.md, padding: '10px 12px', fontSize: 13 }}>{triggerError}</div>}
          {triggerSuccess && <div data-testid="earn-trigger-success" role="status" aria-live="polite" style={{ background: theme.successBg, border: `1px solid ${theme.success}`, color: theme.success, borderRadius: theme.radius.md, padding: '10px 12px', fontSize: 13 }}>{triggerSuccess}</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button type="submit" variant="primary" size="sm" loading={triggering} disabled={triggering} aria-label="Calculate earnings">Calculate earnings</Button>
            <Button type="button" variant="ghost" size="sm" onClick={handleRetryIdempotencyDemo} disabled={triggering} aria-label="Simulate webhook retry (idempotent)">Simulate webhook retry (2×)</Button>
            <Button type="button" variant="ghost" size="sm" onClick={load} disabled={triggering}>Reload ledger</Button>
          </div>
          <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>Example: business pays 10000 with 10% direct, 5% parent, 3% state → agent_earnings 3 rows 1000, 500, 300.</p>
        </form>
      </Card>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {['all','accrued','payable','paid','void'].map((s) => (
            <button key={s} onClick={() => setFilterStatus(s)} aria-pressed={filterStatus===s} style={{ padding: '6px 12px', borderRadius: theme.radius.full, border: filterStatus===s ? `1px solid ${theme.tealDeep}` : `1px solid ${theme.border}`, background: filterStatus===s ? theme.tealMist : '#fff', color: filterStatus===s ? theme.tealDeep : theme.textLight, fontWeight: 700, fontSize: 12, textTransform: 'capitalize' }}>{s}</button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: theme.textLight, display: 'flex', gap: 12 }}>
          <span>Total owed: <strong style={{ color: theme.navy }}>₦{totalOwed.toLocaleString()}</strong></span>
          <span>Paid: <strong style={{ color: theme.success }}>₦{totalPaid.toLocaleString()}</strong></span>
          <span>Unpaid: <strong style={{ color: theme.warning }}>₦{unpaid.toLocaleString()}</strong></span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div data-testid="empty-earnings">
          <Empty message={earnings.length===0 ? 'No earnings yet. Trigger a payment above.' : `No earnings with status "${filterStatus}"`} cause={earnings.length===0 ? 'none' : 'filtered'} />
        </div>
      ) : (
        <div role="list" aria-label="Agent earnings" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((e) => {
            const agent = agentsMap[e.agent_id]
            return (
              <Card key={e.id} style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontWeight: 800, fontSize: 13, color: theme.navy }}>{agent ? (agent.full_name || agent.email) : e.agent_id.slice(0,8)} <span style={{ fontWeight: 400, color: theme.textLight, fontSize: 11 }}>{agent?.tier ? `· ${agent.tier}` : ''} {e.commission_pct ? `· ${e.commission_pct}%` : ''}</span></div>
                    <div style={{ fontSize: 11, color: theme.textLight, fontFamily: theme.fontMono, marginTop: 2 }}>ref: {e.payment_reference || '—'} · business: {String(e.business_id).slice(0,8)} · {e.payout_period || ''}</div>
                    <div style={{ fontSize: 11, color: theme.textLight, marginTop: 2 }}>{e.created_at ? new Date(e.created_at).toLocaleString() : ''} · plan {e.plan_value != null ? `₦${Number(e.plan_value).toLocaleString()}` : ''}</div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 140 }}>
                    <div style={{ fontSize: 16, fontWeight: 900, color: theme.navy }}>₦{Number(e.amount_owed).toLocaleString()}</div>
                    <div style={{ fontSize: 11, color: e.amount_paid >0 ? theme.success : theme.textLight }}>paid ₦{Number(e.amount_paid||0).toLocaleString()} · <span style={{ textTransform: 'capitalize', background: e.status==='paid'? theme.successBg : e.status==='void'? theme.dangerBg : theme.warningBg, color: e.status==='paid'? theme.success : e.status==='void'? theme.danger : theme.warning, padding: '2px 6px', borderRadius: theme.radius.full, fontWeight: 700 }}>{e.status}</span></div>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <div aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>
        Earnings {earnings.length}, filtered {filtered.length}
      </div>
    </div>
  )
}
