import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../config/supabaseClient'
import { theme } from '../../styles/theme'
import { Button, Card, Input, Select, Loading, ErrorState, Empty, ConfirmDialog } from '../../components/ui'

const TIER_OPTIONS = [
  { value: 'agent', label: 'Agent (direct)' },
  { value: 'community_coordinator', label: 'Community Coordinator (20 cap)' },
  { value: 'state_coordinator', label: 'State Coordinator' },
]

const TIER_DEFAULT_PCT = { agent: 10, community_coordinator: 5, state_coordinator: 3, unplaced: 0 }

function pctForTier(tier) { return TIER_DEFAULT_PCT[tier] ?? 10 }

export async function fetchPendingAgents() {
  const { data, error } = await supabase
    .from('agents')
    .select('id, full_name, email, state, tier, status, referral_code, parent_agent_id, commission_pct, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return Array.isArray(data) ? data : []
}

export async function fetchPotentialParents() {
  // Parents are approved agents who can have children (all approved, but UI highlights community coordinator cap)
  const { data, error } = await supabase
    .from('agents')
    .select('id, full_name, email, tier, state, referral_code, commission_pct')
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return Array.isArray(data) ? data : []
}

export async function fetchChildrenCounts() {
  // Best-effort counts for 20-cap display; derive from agents table where parent_agent_id not null
  const { data, error } = await supabase
    .from('agents')
    .select('id, parent_agent_id')
  if (error) return {}
  const counts = {}
  ;(Array.isArray(data) ? data : []).forEach((r) => {
    if (r.parent_agent_id) counts[r.parent_agent_id] = (counts[r.parent_agent_id] || 0) + 1
  })
  return counts
}

export async function approveAgent({ agentId, tier, parentAgentId, commissionPct }) {
  const pct = commissionPct != null && commissionPct !== '' ? Number(commissionPct) : pctForTier(tier)
  const payload = {
    tier,
    parent_agent_id: parentAgentId || null,
    commission_pct: pct,
    status: 'approved',
  }
  // eslint-disable-next-line no-console
  console.info('[AgentApproval] approve', { agentId, tier, parentAgentId, pct })
  const { data, error } = await supabase
    .from('agents')
    .update(payload)
    .eq('id', agentId)
    .select('id, tier, parent_agent_id, commission_pct, status')
    .single()
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[AgentApproval] approve failed', error.message, error.code)
    throw error
  }
  return data
}

export default function AgentApproval() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [pending, setPending] = useState([])
  const [parents, setParents] = useState([])
  const [childrenCounts, setChildrenCounts] = useState({})
  const [selected, setSelected] = useState(null) // agent to approve
  const [tier, setTier] = useState('agent')
  const [parentId, setParentId] = useState('')
  const [commission, setCommission] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [pend, pars, counts] = await Promise.all([fetchPendingAgents(), fetchPotentialParents(), fetchChildrenCounts()])
      setPending(pend)
      setParents(pars)
      setChildrenCounts(counts)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[AgentApproval] load failed', e)
      setError(e.message || 'Failed to load pending agents')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (selected) {
      setTier(selected.tier && selected.tier !== 'unplaced' ? selected.tier : 'agent')
      setParentId(selected.parent_agent_id || '')
      setCommission(selected.commission_pct != null ? String(selected.commission_pct) : '')
      setSaveError(null)
    }
  }, [selected])

  function openApprove(agent) {
    setSelected(agent)
    setSaveError(null)
  }

  function handleConfirmClick() {
    if (!selected) return
    const chosenTier = tier
    const chosenParent = parentId || null
    const chosenPct = commission !== '' ? commission : String(pctForTier(chosenTier))
    setConfirm({
      tier: chosenTier,
      parentAgentId: chosenParent,
      commissionPct: chosenPct,
      agentId: selected.id,
    })
  }

  async function handleApprove() {
    if (!confirm) return
    setSaving(true)
    setSaveError(null)
    try {
      await approveAgent({ agentId: confirm.agentId, tier: confirm.tier, parentAgentId: confirm.parentAgentId, commissionPct: confirm.commissionPct })
      setConfirm(null)
      setSelected(null)
      await load()
    } catch (e) {
      if (e.code === '42501' || /max children|reached max/i.test(e.message || '')) {
        setSaveError('This coordinator has reached the 20-agent cap (20/20). Choose a different parent.')
      } else {
        setSaveError(e.message || 'Approval failed')
      }
      setConfirm(null)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div data-testid="approval-loading"><Loading text="Loading pending agents..." /></div>
  if (error) return <div data-testid="approval-error"><ErrorState message={error} onRetry={load} /></div>

  const filtered = pending.filter((a) => {
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return (a.full_name || '').toLowerCase().includes(q) || (a.email || '').toLowerCase().includes(q) || (a.referral_code || '').toLowerCase().includes(q)
  })

  const parentOptions = parents.map((p) => {
    const count = childrenCounts[p.id] || 0
    const max = p.tier === 'community_coordinator' ? 20 : null
    const atCap = max != null && count >= max
    const label = `${p.full_name || p.email || p.id} (${p.tier}) — ${p.state || ''} ${max ? `· ${count}/${max}` : ''}${atCap ? ' · FULL' : ''}`
    return { value: p.id, label, disabled: atCap }
  })

  return (
    <div data-testid="agent-approval" style={{ fontFamily: theme.fontFamily, maxWidth: 1100, margin: '0 auto', padding: 16 }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: '0 0 4px 0', fontSize: theme.type.h1.size, fontWeight: theme.type.h1.weight, color: theme.navy }}>Agent Applications</h1>
        <p style={{ margin: 0, fontSize: theme.type.body.size, color: theme.textLight }}>Review pending agents (status=pending, tier=unplaced). Set tier / parent / commission then approve. 20-cap enforced server-side (42501).</p>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ flex: '1 1 280px', minWidth: 220 }}>
          <Input id="approval-search" label="Search pending" value={search} onChange={setSearch} placeholder="Name, email or CF- code" />
        </div>
        <Button variant="ghost" size="sm" onClick={load} aria-label="Reload pending">Reload</Button>
      </div>

      {filtered.length === 0 ? (
        <div data-testid="empty-pending">
          <Empty message={pending.length === 0 ? 'No pending applications' : 'No pending match your search'} cause={pending.length === 0 ? 'positive' : 'filtered'} />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
          <div>
            <h2 style={{ fontSize: theme.type.h2.size, fontWeight: theme.type.h2.weight, color: theme.navy, margin: '0 0 10px 0' }}>Pending ({filtered.length})</h2>
            <div role="list" aria-label="Pending agents" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filtered.map((a) => (
                <Card key={a.id} style={{ padding: 14 }} data-testid="pending-agent-row">
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 14, color: theme.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.full_name || 'Unnamed'}</div>
                      <div style={{ fontSize: 12, color: theme.textLight }}>{a.email} {a.state ? `· ${a.state}` : ''}</div>
                      <div style={{ fontFamily: theme.fontMono, fontSize: 11, color: theme.tealDeep, marginTop: 4 }}>{a.referral_code || 'CF- pending generation'}</div>
                      <div style={{ fontSize: 11, color: theme.textLight, marginTop: 4 }}>Tier: {a.tier} · Status: {a.status} · {a.created_at ? new Date(a.created_at).toLocaleDateString() : ''}</div>
                    </div>
                    <Button variant="primary" size="sm" onClick={() => openApprove(a)} aria-label={`Review ${a.full_name || a.email}`}>Review</Button>
                  </div>
                </Card>
              ))}
            </div>
          </div>

          <div>
            <Card style={{ padding: 16, position: 'sticky', top: 16 }}>
              {!selected ? (
                <div data-testid="no-selection" style={{ textAlign: 'center', padding: 24, color: theme.textLight }}>
                  <div style={{ fontSize: 13 }}>Select a pending agent to review.</div>
                  <div style={{ fontSize: 11, marginTop: 6 }}>Place into tier, assign parent, set commission, then approve.</div>
                </div>
              ) : (
                <div data-testid="approval-form">
                  <h3 style={{ margin: '0 0 12px 0', fontSize: 15, fontWeight: 800, color: theme.navy }}>Review: {selected.full_name}</h3>
                  <p style={{ margin: '0 0 12px 0', fontSize: 12, color: theme.textLight }}>{selected.email} · {selected.referral_code}</p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <Select
                      label="Tier"
                      value={tier}
                      onChange={setTier}
                      options={TIER_OPTIONS}
                      required
                      id="approval-tier"
                      helperText={tier === 'community_coordinator' ? 'Max 20 children enforced by DB trigger (42501)' : tier === 'agent' ? 'Default 10%' : tier === 'state_coordinator' ? 'Default 3%' : ''}
                    />
                    <div>
                      <Select
                        label="Parent agent"
                        value={parentId}
                        onChange={setParentId}
                        options={parentOptions}
                        id="approval-parent"
                        placeholder="None (top-level)"
                        helperText={parentId ? (() => {
                          const p = parents.find((x) => x.id === parentId)
                          const c = childrenCounts[parentId] || 0
                          if (!p) return ''
                          if (p.tier === 'community_coordinator') return `${c}/20 children · ${c >= 20 ? 'FULL — will reject 42501' : `${20 - c} slots left`}`
                          return `Parent: ${p.tier} · ${p.full_name}`
                        })() : 'Optional hierarchy: direct → community → state'}
                      />
                      {parentId && parents.find((p) => p.id === parentId)?.tier === 'community_coordinator' && (
                        <div data-testid="cap-indicator" style={{ marginTop: 6, fontSize: 11, fontWeight: 700, color: (childrenCounts[parentId] || 0) >= 20 ? theme.danger : theme.success }}>
                          {(childrenCounts[parentId] || 0)}/20 { (childrenCounts[parentId]||0)>=20 ? '— FULL' : '— capacity'}
                        </div>
                      )}
                    </div>
                    <Input
                      label="Commission %"
                      type="number"
                      value={commission}
                      onChange={setCommission}
                      placeholder={String(pctForTier(tier))}
                      id="approval-commission"
                      helperText={`Default for ${tier}: ${pctForTier(tier)}%. Per-agent override.`}
                    />

                    {saveError && (
                      <div data-testid="approval-save-error" role="alert" aria-live="assertive" style={{ background: theme.dangerBg, border: `1px solid ${theme.danger}`, color: theme.danger, borderRadius: theme.radius.md, padding: '10px 12px', fontSize: 13 }}>
                        {saveError}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button variant="ghost" size="sm" onClick={() => setSelected(null)} disabled={saving}>Cancel</Button>
                      <Button variant="primary" size="sm" onClick={handleConfirmClick} disabled={saving} loading={saving} aria-label="Approve agent">Approve → {tier} / {commission || pctForTier(tier)}%</Button>
                    </div>
                    <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>On approve: status=approved, parent set, commission set. 21st to full coordinator rejected 42501.</p>
                  </div>
                </div>
              )}
            </Card>

            <Card style={{ padding: 14, marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: theme.navy, marginBottom: 6 }}>Tier defaults</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, color: theme.textLight }}>
                <span style={{ background: theme.gray100, padding: '4px 8px', borderRadius: theme.radius.full }}>agent: 10%</span>
                <span style={{ background: theme.gray100, padding: '4px 8px', borderRadius: theme.radius.full }}>community_coordinator: 5% + 20 cap</span>
                <span style={{ background: theme.gray100, padding: '4px 8px', borderRadius: theme.radius.full }}>state_coordinator: 3%</span>
              </div>
            </Card>
          </div>
        </div>
      )}

      <ConfirmDialog
        show={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={handleApprove}
        title="Approve agent?"
        consequence={confirm ? `This will set ${confirm.tier} tier, commission ${confirm.commissionPct}%, ${confirm.parentAgentId ? `parent ${confirm.parentAgentId}` : 'no parent'}, and status=approved. Enforces 20-cap via trigger (42501 if full).` : ''}
        confirmLabel={saving ? 'Approving...' : 'Approve'}
      />

      <div aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>
        Pending {pending.length}
      </div>
    </div>
  )
}
