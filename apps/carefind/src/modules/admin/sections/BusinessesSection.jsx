import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Building2, Download, Star } from 'lucide-react'
import { Button, Input, StatCard } from '@care-ecosystem/design-system/components/ui'
import DirectoryTable from '../ui/DirectoryTable.jsx'
import { useDebounced } from '../ui/useDebounced.js'
import { FilterPills, exportCSV, timeAgo } from '../ui'
import { useBusinessesDirectory } from '../hooks/useBusinessesDirectory'
import { feedConfigRepository } from '../repositories/feedConfigRepository'

const FILTER_DELAY_MS = 300
const NO_FILTERS = { search: '', type: 'all', status: 'all', location: '', page: 0 }
const TYPE_OPTIONS = ['all', 'pharmacy', 'hospital', 'clinic', 'dental', 'optical', 'wellness', 'skincare']
  .map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))
const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'claimed', label: 'Claimed' },
  { value: 'unclaimed', label: 'Unclaimed' },
]

const nameOf = (b) => b.name || 'Unnamed business'
const capitalised = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '—')
const locationOf = (b) => [b.city, b.state].filter(Boolean).join(', ') || '—'
const statusOf = (b) => (b.visible_on_carefind ? 'Claimed' : 'Unclaimed')
const addedDate = (d) => {
  const t = d ? new Date(d) : null
  return t && !isNaN(t) ? t.toLocaleDateString() : '—'
}

const columns = [
  { key: 'name', label: 'Name', render: nameOf },
  { key: 'business_type', label: 'Type', render: b => capitalised(b.business_type) },
  { key: 'location', label: 'Location', render: locationOf },
  { key: 'visible_on_carefind', label: 'Status', render: statusOf },
  { key: 'created_at', label: 'Added', sortable: true, sortValue: b => new Date(b.created_at).getTime(), render: b => timeAgo(b.created_at) },
]

const statGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, margin: '16px 0' }

// A stat is "…" while loading and "Couldn't load" on failure, never 0.
const statValue = (q, render) => (q.isPending ? '…' : q.isError ? "Couldn't load" : render(q.data))
const averageOf = (reviews) => (reviews.length
  ? (reviews.reduce((sum, r) => sum + (Number(r.rating) || 0), 0) / reviews.length).toFixed(1)
  : 'N/A')

function Stars({ rating }) {
  const n = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)))
  return (
    <span role="img" aria-label={`${n} out of 5`} style={{ color: 'var(--color-star)', fontSize: 13 }}>
      {'★'.repeat(n)}{'☆'.repeat(5 - n)}
    </span>
  )
}

// Reviews and products are loaded while the drawer is open, keyed by business so
// opening another business never shows this one's data.
function BusinessBody({ b }) {
  const reviews = useQuery({
    queryKey: ['admin', 'business-reviews', b.id],
    queryFn: () => feedConfigRepository.getBusinessReviews(b.id),
    enabled: !!b.id,
  })
  const products = useQuery({
    queryKey: ['admin', 'business-products', b.id],
    queryFn: () => feedConfigRepository.getBusinessProducts(b.id),
    enabled: !!b.id,
  })
  const loaded = reviews.isSuccess && products.isSuccess

  return (
    <>
      <dl className="adm-drawer-grid">
        <dt>Type</dt><dd>{capitalised(b.business_type)}</dd>
        <dt>Location</dt><dd>{locationOf(b)}</dd>
        {b.whatsapp && (<><dt>WhatsApp</dt><dd>{b.whatsapp}</dd></>)}
        <dt>Added</dt><dd>{addedDate(b.created_at)}</dd>
        <dt>Status</dt><dd>{statusOf(b)}</dd>
      </dl>

      <div style={statGridStyle}>
        <StatCard icon={<Star />} label="Reviews" value={statValue(reviews, d => d.length)} />
        <StatCard icon={<Building2 />} label="Products" value={statValue(products, d => d.length)} />
        <StatCard icon={<Star />} label="Avg rating" value={statValue(reviews, averageOf)} />
      </div>

      <Button variant="primary" fullWidth leftIcon={<Download size={14} />} disabled={!loaded}
        onClick={() => exportCSV([...reviews.data, ...products.data], `${nameOf(b)}_data.csv`)}>
        Export company data CSV
      </Button>

      <section aria-label="Reviews" style={{ marginTop: 16 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>Latest reviews</h3>
        {reviews.isPending ? <p className="adm-note">Loading reviews…</p>
          : reviews.isError ? <p className="adm-note">Couldn't load reviews</p>
            : reviews.data.length === 0 ? <p className="adm-note">No reviews yet</p>
              : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {reviews.data.map(r => (
                    <li key={r.id} style={{ padding: '8px 0', borderTop: '1px solid var(--adm-line-soft)' }}>
                      <Stars rating={r.rating} />
                      {r.comment && <p style={{ margin: '2px 0 0', fontSize: 13, overflowWrap: 'anywhere' }}>{r.comment}</p>}
                    </li>
                  ))}
                </ul>
              )}
      </section>
    </>
  )
}

export default function BusinessesSection() {
  const [filters, setFilters] = useState(NO_FILTERS)
  const { search, type, status, location, page } = filters
  // A filter change always returns to the first page; an unchanged value is a no-op.
  const update = (patch) => setFilters(prev => (
    Object.keys(patch).every(k => prev[k] === patch[k]) ? prev : { ...prev, ...patch, page: 0 }
  ))

  // The State or city box is local text, applied (trimmed) once typing stops. It
  // is applied only when the debounced value has caught up with the box, so after
  // Clear filters a stale debounced value is never re-applied, and retyping the
  // value that was cleared still applies it.
  const [locationText, setLocationText] = useState('')
  const debouncedLocation = useDebounced(locationText, FILTER_DELAY_MS)
  useEffect(() => {
    if (debouncedLocation !== locationText) return
    const next = debouncedLocation.trim()
    setFilters(prev => (prev.location === next ? prev : { ...prev, location: next, page: 0 }))
  }, [debouncedLocation, locationText])

  const clear = () => { setLocationText(''); setFilters(NO_FILTERS) }

  const query = useBusinessesDirectory({ search, type, status, location, page })
  const rows = query.data?.rows || []

  const renderDrawer = (b) => ({
    title: nameOf(b),
    body: <BusinessBody key={b.id} b={b} />,
  })

  return (
    <DirectoryTable
      title="Businesses"
      noun="business"
      plural="businesses"
      query={query}
      columns={columns}
      search={search}
      onSearch={(s) => update({ search: s })}
      searchPlaceholder="Search company name…"
      filters={(
        <>
          <FilterPills label="Business type" options={TYPE_OPTIONS} value={type} onChange={(v) => update({ type: v })} />
          <FilterPills label="Claim status" options={STATUS_OPTIONS} value={status} onChange={(v) => update({ status: v })} />
          <Input id="businesses-location-filter" label="State or city" value={locationText} onChange={setLocationText} placeholder="e.g. Lagos" style={{ minWidth: 180 }} />
        </>
      )}
      filtersActive={!!(search || location || type !== 'all' || status !== 'all')}
      onClear={clear}
      page={page}
      onPage={(p) => setFilters(prev => ({ ...prev, page: p }))}
      renderDrawer={renderDrawer}
      rowLabel={nameOf}
      toolbar={(
        <Button variant="ghost" size="sm" leftIcon={<Download size={14} />}
          disabled={rows.length === 0 || query.isPlaceholderData}
          onClick={() => exportCSV(rows, 'businesses_page.csv')}>
          Export this page (CSV)
        </Button>
      )}
    />
  )
}
