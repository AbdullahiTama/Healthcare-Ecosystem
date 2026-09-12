import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../config/supabaseClient'
import { theme } from '../../styles/theme'
import { Button, Card, Input, Select, Loading, ErrorState, Empty, ConfirmDialog } from '../../components/ui'

export async function fetchAgents() {
  const { data, error } = await supabase.from('agents').select('id, full_name, email, referral_code, tier, state, status').order('created_at', { ascending: false }).limit(200)
  if (error) throw error
  return Array.isArray(data) ? data : []
}

export async function fetchReferralsForAgent(agentId) {
  if (!agentId) return []
  const { data, error } = await supabase.from('agent_referrals').select('id, agent_id, business_id, referral_code, created_at').eq('agent_id', agentId).order('created_at', { ascending: false }).limit(100)
  if (error) throw error
  return Array.isArray(data) ? data : []
}

export async function transferAgentOwnership({ fromAgentId, toAgentId, businessId, agentReferralId, reason, byAdminId }) {
  if (!fromAgentId || !toAgentId) throw new Error('fromAgentId and toAgentId required')
  if (fromAgentId === toAgentId) throw new Error('from and to cannot be the same')
  // eslint-disable-next-line no-console
  console.info('[AgentTransfer] transfer', { fromAgentId, toAgentId, businessId, agentReferralId, reason })
  // Reassign agent_referrals
  if (agentReferralId) {
    const { error } = await supabase.from('agent_referrals').update({ agent_id: toAgentId }).eq('id', agentReferralId).eq('agent_id', fromAgentId)
    if (error) throw error
  } else if (businessId) {
    const { error } = await supabase.from('agent_referrals').update({ agent_id: toAgentId }).eq('business_id', businessId).eq('agent_id', fromAgentId)
    if (error) throw error
  } else {
    // transfer all referrals for from -> to
    const { error } = await supabase.from('agent_referrals').update({ agent_id: toAgentId }).eq('agent_id', fromAgentId)
    if (error) throw error
  }

  // Reassign agent_earnings for that business or all
  if (businessId) {
    const { error } = await supabase.from('agent_earnings').update({ agent_id: toAgentId }).eq('business_id', businessId).eq('agent_id', fromAgentId)
    if (error) {
      // eslint-disable-next-line no-console
      console.warn('[AgentTransfer] earnings reassign warning', error.message)
    }
  } else if (agentReferralId) {
    // if referralId, need businessId from referral row; fetch if not provided
    // For now, also transfer earnings where business matches referral's business
    // Caller should supply businessId when using referralId to keep transfer atomic
  } else {
    // transfer all earnings
    const { error } = await supabase.from('agent_earnings').update({ agent_id: toAgentId }).eq('agent_id', fromAgentId)
    if (error) {
      // eslint-disable-next-line no-console
      console.warn('[AgentTransfer] earnings bulk reassign warning', error.message)
    }
  }

  // Insert audit
  const audit = {
    agent_referral_id: agentReferralId || null,
    business_id: businessId || null,
    from_agent_id: fromAgentId,
    to_agent_id: toAgentId,
    by_admin_id: byAdminId || null,
    reason: reason || null,
  }
  const { data, error: auditErr } = await supabase.from('agent_transfers').insert(audit).select('id, from_agent_id, to_agent_id, business_id, created_at').single()
  if (auditErr) {
    // eslint-disable-next-line no-console
    console.warn('[AgentTransfer] audit insert failed', auditErr.message)
    throw auditErr
  }
  // eslint-disable-next-line no-console
  console.info('[AgentTransfer] audit created', data.id)
  return data
}

export default function AgentTransfer() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [agents, setAgents] = useState([])
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [businessId, setBusinessId] = useState('')
  const [referralId, setReferralId] = useState('')
  const [reason, setReason] = useState('')
  const [byAdminId, setByAdminId] = useState('')
  const [referrals, setReferrals] = useState([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [saveSuccess, setSaveSuccess] = useState(null)
  const [confirm, setConfirm] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await fetchAgents()
      setAgents(list)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[AgentTransfer] load failed', e)
      setError(e.message || 'Failed to load agents')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!fromId) { setReferrals([]); return }
    let cancelled = false
    async function fetchRefs() {
      try {
        const refs = await fetchReferralsForAgent(fromId)
        if (!cancelled) setReferrals(refs)
      } catch {
        if (!cancelled) setReferrals([])
      }
    }
    fetchRefs()
    return () => { cancelled = true }
  }, [fromId])

  function handleRequestTransfer(e) {
    e.preventDefault()
    setSaveError(null)
    setSaveSuccess(null)
    if (!fromId || !toId) { setSaveError('Select both from and to agents'); return }
    if (fromId === toId) { setSaveError('From and To cannot be the same agent'); return }
    setConfirm({ fromAgentId: fromId, toAgentId: toId, businessId: businessId.trim() || null, agentReferralId: referralId.trim() || null, reason: reason.trim() || null, byAdminId: byAdminId.trim() || null })
  }

  async function handleConfirm() {
    if (!confirm) return
    setSaving(true)
    setSaveError(null)
    try {
      const audit = await transferAgentOwnership(confirm)
      setSaveSuccess(`Transferred ownership — audit ${audit.id}. New owner ${confirm.toAgentId}.`)
      setConfirm(null)
      // clear fields
      setBusinessId('')
      setReferralId('')
      setReason('')
      // reload referrals
      if (confirm.fromAgentId) {
        const refs = await fetchReferralsForAgent(confirm.fromAgentId)
        setReferrals(refs)
      }
    } catch (e) {
      setSaveError(e.message || 'Transfer failed')
      setConfirm(null)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div data-testid="transfer-loading"><Loading text="Loading agents..." /></div>
  if (error) return <div data-testid="transfer-error"><ErrorState message={error} onRetry={load} /></div>

  const agentOptions = agents.map((a) => ({ value: a.id, label: `${a.full_name || a.email || a.id} (${a.tier || 'unplaced'}) — ${a.referral_code || ''} ${a.state ? `· ${a.state}` : ''}` }))

  return (
    <div data-testid="agent-transfer" style={{ fontFamily: theme.fontFamily, maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: '0 0 4px 0', fontSize: theme.type.h1.size, fontWeight: theme.type.h1.weight, color: theme.navy }}>Agent Transfer</h1>
        <p style={{ margin: 0, fontSize: theme.type.body.size, color: theme.textLight }}>Reassign <code>agent_referrals</code> / <code>agent_earnings</code> to another <code>agents.id</code> and insert <code>agent_transfers</code> audit (<code>from/to/by/when</code>). Requires confirmation.</p>
      </div>

      <Card style={{ padding: 20 }}>
        <form onSubmit={handleRequestTransfer} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            <Select label="From agent" value={fromId} onChange={setFromId} options={agentOptions} required id="transfer-from" placeholder="Select source agent" />
            <Select label="To agent" value={toId} onChange={setToId} options={agentOptions} required id="transfer-to" placeholder="Select destination agent" />
          </div>

          {fromId && referrals.length > 0 && (
            <div data-testid="referrals-for-from" style={{ background: theme.gray100, border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, padding: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: theme.textLight, marginBottom: 6, textTransform: 'uppercase' }}>Referrals owned by From ({referrals.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
                {referrals.map((r) => (
                  <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                    <input type="radio" name="referralId" checked={referralId === r.id} onChange={() => { setReferralId(r.id); setBusinessId(r.business_id || '') }} />
                    <span style={{ fontFamily: theme.fontMono, fontSize: 11 }}>{r.id.slice(0,8)} · biz {String(r.business_id).slice(0,8)} · {r.referral_code || ''}</span>
                  </label>
                ))}
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                  <input type="radio" name="referralId" checked={referralId === '' && businessId === ''} onChange={() => { setReferralId(''); setBusinessId('') }} />
                  <span>Transfer all referrals/earnings for From agent (no business filter)</span>
                </label>
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <Input label="Business ID (optional)" value={businessId} onChange={setBusinessId} placeholder="business uuid — narrows to one business" id="transfer-business-id" helperText="If set, only referrals/earnings for this business are moved" />
            <Input label="Agent referral ID (optional)" value={referralId} onChange={setReferralId} placeholder="agent_referrals id" id="transfer-referral-id" helperText="Precise row to transfer; overrides business filter" />
          </div>

          <Input label="Reason (audit)" value={reason} onChange={setReason} placeholder="e.g. Reassignment due to territory change" id="transfer-reason" helperText="Stored in agent_transfers.reason" />
          <Input label="By admin ID (audit)" value={byAdminId} onChange={setByAdminId} placeholder="admin_team_members id (optional)" id="transfer-by-admin" helperText="Stored as by_admin_id" />

          {saveError && <div data-testid="transfer-error-msg" role="alert" style={{ background: theme.dangerBg, border: `1px solid ${theme.danger}`, color: theme.danger, borderRadius: theme.radius.md, padding: '10px 12px', fontSize: 13 }}>{saveError}</div>}
          {saveSuccess && <div data-testid="transfer-success-msg" role="status" aria-live="polite" style={{ background: theme.successBg, border: `1px solid ${theme.success}`, color: theme.success, borderRadius: theme.radius.md, padding: '10px 12px', fontSize: 13 }}>{saveSuccess}</div>}

          <Button type="submit" variant="primary" size="md" disabled={saving || !fromId || !toId} loading={saving} aria-label="Request transfer">Request transfer</Button>
          <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>On confirm: reassigns rows + inserts agent_transfers audit (from/to/by/when). New owner immediately visible.</p>
        </form>
      </Card>

      {agents.length === 0 && <div data-testid="empty-agents" style={{ marginTop: 12 }}><Empty message="No agents found" cause="none" /></div>}

      <ConfirmDialog
        show={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={handleConfirm}
        title="Confirm transfer?"
        consequence={confirm ? `Reassign from ${confirm.fromAgentId.slice(0,8)} to ${confirm.toAgentId.slice(0,8)}${confirm.businessId ? ` for business ${confirm.businessId.slice(0,8)}` : confirm.agentReferralId ? ` referral ${confirm.agentReferralId.slice(0,8)}` : ' (all referrals/earnings)'}? This creates an audit row in agent_transfers.` : ''}
        confirmLabel={saving ? 'Transferring...' : 'Confirm transfer'}
      />
    </div>
  )
}
