import { Building2, MapPin, Star, Download, X, ExternalLink } from 'lucide-react'
import { Card, Button, Empty, StatCard, Input } from '@care-ecosystem/design-system/components/ui'
import { theme } from '../../../styles/theme'
import { AdminPageHeader, AdminFilterBar, FilterPills } from '../ui'

function exportCSV(data, filename) {
  if (!data.length) return
  const keys = Object.keys(data[0])
  const csv = [keys.join(','), ...data.map(row => keys.map(k => JSON.stringify(row[k] ?? '')).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

const TYPE_OPTIONS = ['all', 'pharmacy', 'hospital', 'clinic', 'dental', 'optical', 'wellness', 'skincare']
const STATUS_OPTIONS = [{ value: 'all', label: 'All' }, { value: 'claimed', label: 'Claimed' }, { value: 'unclaimed', label: 'Unclaimed' }]

export default function BusinessesTab({
  businesses, bizSearch, setBizSearch, bizTypeFilter, setBizTypeFilter,
  bizStateFilter, setBizStateFilter, bizStatusFilter, setBizStatusFilter,
  selectedBiz, setSelectedBiz, bizReviews, setBizReviews, bizProducts, setBizProducts,
  supabase,
}) {
  const filtered = businesses.filter(b => {
    const matchSearch = !bizSearch || b.name?.toLowerCase().includes(bizSearch.toLowerCase())
    const matchType = bizTypeFilter === 'all' || b.business_type === bizTypeFilter
    const matchState = !bizStateFilter || (b.state || b.city || '').toLowerCase().includes(bizStateFilter.toLowerCase())
    const matchStatus = bizStatusFilter === 'all' || (bizStatusFilter === 'claimed' ? b.visible_on_carefind : !b.visible_on_carefind)
    return matchSearch && matchType && matchState && matchStatus
  })

  async function selectBiz(b) {
    setSelectedBiz(b)
    const [revRes, prodRes] = await Promise.all([
      supabase.from('reviews').select('*').eq('business_id', b.id),
      supabase.from('products').select('*').eq('business_id', b.id),
    ])
    setBizReviews(revRes.data || [])
    setBizProducts(prodRes.data || [])
  }

  return (
    <div>
      <AdminPageHeader title="Businesses" subtitle={`${businesses.length} companies`} />

      <AdminFilterBar search={bizSearch} onSearch={setBizSearch} searchPlaceholder="Search company name...">
        <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[4] }}>
          <Input value={bizStateFilter} onChange={setBizStateFilter} placeholder="Filter by state/city..." />
          <FilterPills options={TYPE_OPTIONS} value={bizTypeFilter} onChange={setBizTypeFilter} />
          <FilterPills options={STATUS_OPTIONS} value={bizStatusFilter} onChange={setBizStatusFilter} />
          <Button variant="primary" fullWidth onClick={() => exportCSV(filtered, 'filtered_companies.csv')} leftIcon={<Download size={14} />}>
            Export Filtered CSV
          </Button>
        </div>
      </AdminFilterBar>

      {selectedBiz && (
        <Card style={{ padding: theme.space[6], marginBottom: theme.space[6], border: `1px solid ${theme.tealBright}`, background: theme.tealMist }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: theme.space[4] }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: theme.navy }}>{selectedBiz.name}</div>
            <button onClick={() => { setSelectedBiz(null); setBizReviews([]); setBizProducts([]) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.textLight }}>
              <X size={18} />
            </button>
          </div>
          <div style={{ fontSize: 12, color: theme.textLight, textTransform: 'capitalize', marginBottom: theme.space[4] }}>{selectedBiz.business_type} · {selectedBiz.city}, {selectedBiz.state}</div>

          <div style={{ display: 'flex', gap: 8, marginBottom: theme.space[4] }}>
            <StatCard icon={<Star size={15} />} label="Reviews" value={bizReviews.length} />
            <StatCard icon={<Building2 size={15} />} label="Products" value={bizProducts.length} />
            <StatCard icon={<Star size={15} />} label="Avg Rating" value={bizReviews.length ? (bizReviews.reduce((s, r) => s + r.rating, 0) / bizReviews.length).toFixed(1) : 'N/A'} />
          </div>

          <Button variant="primary" fullWidth onClick={() => exportCSV([...bizReviews, ...bizProducts], `${selectedBiz.name}_data.csv`)} leftIcon={<Download size={14} />} style={{ marginBottom: theme.space[4] }}>
            Export Company Data CSV
          </Button>

          {bizReviews.map(r => (
            <div key={r.id} style={{ padding: `${theme.space[3]}px 0`, borderTop: `1px solid ${theme.border}` }}>
              <div style={{ color: '#f59e0b', fontSize: 12 }}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</div>
              {r.comment && <p style={{ margin: 0, fontSize: 12, color: theme.textMid }}>{r.comment}</p>}
            </div>
          ))}
        </Card>
      )}

      <div style={{ fontSize: 12, color: theme.gray500, marginBottom: theme.space[4], fontWeight: 600 }}>
        {filtered.length} compan{filtered.length !== 1 ? 'ies' : 'y'} found
      </div>

      {filtered.length === 0 && <Empty icon={<Building2 size={40} strokeWidth={1.5} />} message="No businesses match your filters" />}

      {filtered.map(b => (
        <Card key={b.id} onClick={() => selectBiz(b)} style={{ padding: theme.space[5], marginBottom: theme.space[4] }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: theme.navy }}>{b.name}</div>
              <div style={{ fontSize: 12, color: theme.textLight, textTransform: 'capitalize', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Building2 size={12} /> {b.business_type} · {b.city}, {b.state}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: theme.radius.full, background: b.visible_on_carefind ? theme.tealMist : theme.amberBg, color: b.visible_on_carefind ? theme.success : theme.amberText }}>
                {b.visible_on_carefind ? 'Claimed' : 'Unclaimed'}
              </span>
              <ExternalLink size={12} color={theme.gray400} />
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
