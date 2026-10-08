import { useState, useEffect, useCallback } from 'react'
import { Search, RefreshCw, Link2, Copy, CheckCircle, Gift } from 'lucide-react'
import { Card, GhostBtn, TealBtn, Loading, Empty, ErrorState, useToast, Toast } from '../../../components/ui'
import { createGrowthRepository } from '../../../modules/growth/repositories'

export default function Campaign({ repository = createGrowthRepository() }) {
  const [agents, setAgents] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [copied, setCopied] = useState('')
  const { msg, type, show: showToast } = useToast()

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const rows = await repository.getAgents({ limit: 100 })
      setAgents(Array.isArray(rows) ? rows : [])
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [repository])
  useEffect(() => { load() }, [load])

  const filtered = (() => {
    const list = Array.isArray(agents) ? agents : []
    if (!search.trim()) return list.slice(0, 20)
    const q = search.trim().toLowerCase()
    return list.filter(a => `${a.full_name} ${a.referral_code} ${a.email}`.toLowerCase().includes(q)).slice(0, 20)
  })()

  const copyLink = async (code) => {
    const link = repository.generateReferralLink(code)
    try {
      await navigator.clipboard.writeText(link)
      setCopied(code)
      showToast('Link copied', { type: 'success' })
      setTimeout(() => setCopied(''), 2000)
    } catch {
      showToast(link, { type: 'info' })
    }
  }

  if (loading && agents == null) return <Loading />
  if (error) return <ErrorState message={error} onRetry={load} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 6 }}><Gift size={14} /> Campaign — Referral Links <span style={{ fontSize: 11, background: 'var(--hairline)', padding: '2px 6px', borderRadius: 6, color: 'var(--muted)' }}>CF-code → /register?ref=</span></div>
        <GhostBtn onClick={load}><RefreshCw size={12} style={{ marginRight: 6 }} />Refresh</GhostBtn>
      </Card>

      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search agent / CF-code" aria-label="Search campaign" style={{ width: '100%', padding: '9px 12px 9px 30px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }} />
        </div>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{filtered.length} agents</span>
      </Card>

      {filtered.length === 0 ? (
        <Card style={{ padding: 32, background: 'var(--panel)', border: '1px solid var(--border)', textAlign: 'center' }}><Empty icon={<Gift size={28} />} message="No agents — referral links appear after agent is created." /></Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(a => {
            const link = a.referral_code ? repository.generateReferralLink(a.referral_code) : ''
            return (
              <Card key={a.id} style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--fg)' }}>{a.full_name || a.name} <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--muted)' }}>• {a.state || '—'} • {a.tier} • {a.referral_code || 'no code'}</span></div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', background: 'var(--hairline)', padding: '4px 8px', borderRadius: 6, marginTop: 6, display: 'inline-block', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link || '— no referral code'}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <TealBtn disabled={!a.referral_code} onClick={() => copyLink(a.referral_code)} style={{ padding: '7px 12px', fontSize: 12 }}>{copied === a.referral_code ? <><CheckCircle size={11} style={{ marginRight: 4 }} />Copied</> : <><Copy size={11} style={{ marginRight: 4 }} />Copy link</>}</TealBtn>
                  <GhostBtn onClick={() => setSelected(a)}><Link2 size={12} style={{ marginRight: 6 }} />Details</GhostBtn>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {selected && (
        <Card style={{ padding: 16, background: 'var(--panel)', border: '1px solid var(--teal)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)' }}>{selected.full_name || selected.name} — Referral</div>
            <GhostBtn onClick={() => setSelected(null)}>Close</GhostBtn>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', background: 'var(--hairline)', padding: 10, borderRadius: 8, fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{selected.referral_code ? repository.generateReferralLink(selected.referral_code) : 'No code'}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>Share this link — `referral_code_used` on `businesses` tracks attribution via `verify-plan-payment.js`, commission via `calculate_agent_earnings` server-side.</div>
        </Card>
      )}

      <Toast msg={msg} type={type} />
    </div>
  )
}
