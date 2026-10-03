import { useState, useEffect, useCallback } from 'react'
import { Search, RefreshCw, AlertTriangle, Pill, Flag, ExternalLink } from 'lucide-react'
import { Card, GhostBtn, TealBtn, Loading, Empty, ErrorState, useToast, Toast, ConfirmDialog } from '../../../components/ui'
import { createTrustRepository } from '../../../modules/trust/repositories'

const ADVERSE_KEYWORDS = ['rash', 'vomit', 'nausea', 'dizzy', 'adverse', 'reaction', 'side effect', 'hospital', 'emergency']

function isAdverse(text) {
  if (!text) return false
  const low = String(text).toLowerCase()
  return ADVERSE_KEYWORDS.some(k => low.includes(k))
}

export default function DrugIntel({ repository = createTrustRepository() }) {
  const [products, setProducts] = useState(null)
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [selectedProduct, setSelectedProduct] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [confirmQuarantine, setConfirmQuarantine] = useState(null)
  const [confirmAdr, setConfirmAdr] = useState(null)
  const { msg, type, show: showToast } = useToast()

  const loadProducts = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const prods = await repository.getProducts({ limit: 30 }).catch(() => [])
      setProducts(Array.isArray(prods) ? prods : [])
      if (prods && prods[0]) setSelectedProduct(prods[0].id)
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [repository])
  useEffect(() => { loadProducts() }, [loadProducts])

  const loadReviews = useCallback(async () => {
    if (!selectedProduct) { setReviews([]); return }
    try {
      const rows = await repository.getProductReviews({ product_id: selectedProduct, limit: 50 })
      setReviews(Array.isArray(rows) ? rows : [])
    } catch (e) { setReviews([]) }
  }, [repository, selectedProduct])
  useEffect(() => { loadReviews() }, [loadReviews])

  const filtered = (() => {
    let list = Array.isArray(reviews) ? reviews : []
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(r => `${r.comment} ${r.review_text} ${r.rating}`.toLowerCase().includes(q))
    }
    return list
  })()

  const flagged = filtered.filter(r => isAdverse(r.comment || r.review_text || '') || Number(r.rating) <= 2)

  const handleQuarantine = async () => {
    if (!confirmQuarantine) return
    setBusyId(confirmQuarantine.id)
    try {
      await repository.quarantinePost(confirmQuarantine.id, 'drug adverse auto-flag', null).catch(() => {})
      // Also flag review row for audit
      await repository.flagReview(confirmQuarantine.id, { is_flagged: true }).catch(() => {})
      showToast('Quarantined (hidden) + flagged', { type: 'success' })
      setConfirmQuarantine(null)
      loadReviews()
    } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusyId(null)
  }

  const handleAdr = async () => {
    if (!confirmAdr) return
    setBusyId(confirmAdr.id)
    try {
      // For MVP, business_id = first product's business or fallback to first business in system
      // Try to resolve business_id from product row, else skip
      let businessId = null
      try {
        const prod = (products || []).find(p => p.id === selectedProduct)
        businessId = prod?.business_id
        if (!businessId) {
          const { sbFetch } = await import('../../../services/supabase.js')
          const rows = await sbFetch(`products?id=eq.${selectedProduct}&select=business_id`).catch(() => [])
          businessId = rows?.[0]?.business_id
        }
      } catch {}
      if (!businessId) throw new Error('No business_id for product — cannot create ADR draft')
      await repository.createAdrDraft({ business_id: businessId, product_name: (products || []).find(p => p.id === selectedProduct)?.name || 'Product', review_text: confirmAdr.comment || confirmAdr.review_text || '', severity: 'moderate' })
      showToast('ADR draft created (community_pharmacy)', { type: 'success' })
      setConfirmAdr(null)
    } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusyId(null)
  }

  if (loading && products == null) return <Loading />
  if (error) return <ErrorState message={error} onRetry={loadProducts} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 6 }}><Pill size={14} /> Drug Intel → ADR <span style={{ fontSize: 11, background: flagged.length ? 'var(--red-bg)' : 'var(--hairline)', color: flagged.length ? 'var(--red)' : 'var(--muted)', padding: '2px 6px', borderRadius: 6 }}>{flagged.length} flagged / {filtered.length} reviews</span></div>
        <GhostBtn onClick={loadReviews}><RefreshCw size={12} style={{ marginRight: 6 }} />Refresh</GhostBtn>
      </Card>

      <Card style={{ padding: 12, background: 'var(--amber-bg)', border: '1px solid var(--amber)', display: 'flex', gap: 8 }}>
        <AlertTriangle size={14} style={{ color: 'var(--amber)', flexShrink: 0, marginTop: 2 }} />
        <div style={{ fontSize: 12, color: 'var(--amber)' }}><b>Auto-signal:</b> rating ≤2 or keywords {ADVERSE_KEYWORDS.slice(0, 5).join(', ')}… → quarantine + auto ADR draft. Review → `adr_reports` spike by business.</div>
      </Card>

      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={selectedProduct} onChange={e => setSelectedProduct(e.target.value)} aria-label="Select product" style={{ flex: '1 1 200px', maxWidth: 280, padding: '9px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }}>
          <option value="">Select product</option>
          {(products || []).map(p => (
            <option key={p.id} value={p.id}>{p.name} {p.generic_name ? `(${p.generic_name})` : ''}</option>
          ))}
        </select>
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 320 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter review text / rating" aria-label="Search reviews" style={{ width: '100%', padding: '9px 12px 9px 30px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }} />
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card style={{ padding: 32, background: 'var(--panel)', border: '1px solid var(--border)', textAlign: 'center' }}><Empty icon={<Pill size={28} />} message={selectedProduct ? 'No reviews for this product.' : 'Select a product to see reviews.'} /></Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(r => {
            const adverse = isAdverse(r.comment || r.review_text || '')
            const lowRating = Number(r.rating) <= 2
            const flaggedRow = adverse || lowRating
            return (
              <Card key={r.id} style={{ padding: 12, background: flaggedRow ? 'var(--red-bg)' : 'var(--panel)', border: `1px solid ${flaggedRow ? 'var(--red)' : 'var(--border)'}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: flaggedRow ? 'var(--red)' : 'var(--fg)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {flaggedRow ? <AlertTriangle size={12} /> : <Pill size={12} />} Rating {r.rating ?? '—'} <span style={{ fontWeight: 600, fontSize: 11, color: 'var(--muted)' }}>• {new Date(r.created_at).toLocaleString()} {adverse ? '• adverse keyword' : ''} {lowRating ? '• low rating' : ''}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button disabled={busyId === r.id} onClick={() => setConfirmQuarantine(r)} style={{ padding: '5px 10px', borderRadius: 8, border: 'none', background: 'var(--amber)', color: 'white', fontWeight: 700, fontSize: 11, cursor: busyId ? 'not-allowed' : 'pointer' }}><Flag size={11} style={{ marginRight: 4 }} />Quarantine</button>
                    <button disabled={busyId === r.id} onClick={() => setConfirmAdr(r)} style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid var(--teal)', background: 'var(--panel)', color: 'var(--teal)', fontWeight: 700, fontSize: 11, cursor: busyId ? 'not-allowed' : 'pointer' }}><ExternalLink size={11} style={{ marginRight: 4 }} />ADR draft</button>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--fg)', background: 'var(--hairline)', padding: 8, borderRadius: 8, maxHeight: 100, overflow: 'auto' }}>{r.comment || r.review_text || '—'}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Review {r.id.slice(0, 8)} {r.product_id ? `• product ${r.product_id.slice(0, 8)}` : ''} {r.user_id ? `• user ${r.user_id.slice(0, 6)}` : ''}</div>
              </Card>
            )
          })}
        </div>
      )}

      <ConfirmDialog show={!!confirmQuarantine} title="Quarantine this review/post?" onClose={() => setConfirmQuarantine(null)} onConfirm={handleQuarantine} confirmLabel={busyId ? 'Quarantining...' : 'Quarantine'} variant="danger" message={<div style={{ fontSize: 13 }}>Hides from feed/search/index, keeps row + audit. Reversible via Moderation → Restore.</div>} />
      <ConfirmDialog show={!!confirmAdr} title="Create ADR draft from review?" onClose={() => setConfirmAdr(null)} onConfirm={handleAdr} confirmLabel={busyId ? 'Creating...' : 'Create ADR draft'} message={<div style={{ fontSize: 13 }}>Creates draft <code>adr_reports</code> (community_pharmacy) with reaction from review text. Then triage in ADR module.</div>} />
      <Toast msg={msg} type={type} />
    </div>
  )
}
