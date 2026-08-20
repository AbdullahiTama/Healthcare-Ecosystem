import { useState, useEffect } from 'react'
import { CalendarClock, AlertTriangle } from 'lucide-react'
import { stockRepository } from '../stock/repositories'
import { warehouseRepository } from '../warehouses/repositories'
import { getProducts } from '../../services/supabase'
import { deriveExpiryRows, filterExpiryRows } from './expiryAlertsHelper'
import { theme } from '../../styles/theme'
import { Card, StatCard, DataTable, Loading, Empty } from '../../components/ui'
import { fmt, fmtDate } from '../../lib/utils'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, gray100, border, danger, dangerBg, warning, warningBg } = theme

const HORIZONS = [
  { value: 30, label: '30 days' },
  { value: 15, label: '15 days' },
  { value: 7, label: '7 days' },
  { value: 0, label: 'Expired' },
  { value: 'all', label: 'All' },
]

function todayStr() {
  const d = new Date()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

export default function ExpiryAlerts({ brand }) {
  const [batches, setBatches] = useState([])
  const [locations, setLocations] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [horizon, setHorizon] = useState(30)
  const [warehouseId, setWarehouseId] = useState('all')
  const [page, setPage] = useState(0)
  useEffect(() => { setPage(0) }, [horizon, warehouseId])

  async function load() {
    if (!brand || !brand.id) { setLoading(false); return }
    const brandId = brand.id
    setLoading(true)
    setError(null)
    try {
      const [b, l, p] = await Promise.all([
        stockRepository.getBatches(brandId),
        warehouseRepository.getAll(brandId),
        getProducts(brandId),
      ])
      // Ignore a stale response if the business changed while the request was in flight.
      if (brandId !== brand.id) return
      setBatches(b || [])
      setLocations(l || [])
      setProducts(p || [])
    } catch (e) {
      if (brandId !== brand.id) return
      setError(e && e.message ? e.message : 'Could not load expiry data.')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [brand?.id])

  function locName(id) {
    if (id == null) return 'Unassigned'
    const l = locations.filter(x => x.id === id)[0]
    return l ? l.name : 'Unassigned'
  }

  const rows = deriveExpiryRows(batches, products, { today: todayStr() })
  const { rows: visible, summary } = filterExpiryRows(rows, { horizon, warehouseId })

  function expiryTone(daysLeft) {
    if (!Number.isFinite(daysLeft)) return { bg: gray100, color: gray500, label: 'Unclear date' }
    if (daysLeft <= 0) return { bg: dangerBg, color: danger, label: 'Expired' }
    if (daysLeft <= 7) return { bg: warningBg, color: warning, label: daysLeft + 'd left' }
    if (daysLeft <= 30) return { bg: tealMist, color: tealDeep, label: daysLeft + 'd left' }
    return { bg: gray100, color: gray500, label: daysLeft + 'd left' }
  }

  const columns = [
    { key: 'batchNumber', label: 'Batch', render: r => (
      <div style={{ fontSize: 12.5, fontWeight: 700, color: navy }}>{r.batchNumber || '—'}</div>
    )},
    { key: 'productName', label: 'Product', sortable: true, render: r => (
      <div style={{ fontSize: 12.5, fontWeight: 600, color: gray600 }}>{r.productName}</div>
    )},
    { key: 'quantity', label: 'Qty', sortable: true, sortValue: r => r.quantity, render: r => (
      <div style={{ fontSize: 12.5, fontWeight: 700, color: navy }}>{(r.quantity || 0).toLocaleString()}</div>
    )},
    { key: 'warehouse', label: 'Warehouse', render: r => (
      <div style={{ fontSize: 12.5, fontWeight: 600, color: gray600 }}>{locName(r.locationId)}</div>
    )},
    { key: 'expiryDate', label: 'Expiry date', sortable: true, sortValue: r => r.expiryDate, render: r => (
      <div style={{ fontSize: 12.5, fontWeight: 600, color: gray600 }}>{fmtDate(r.expiryDate)}</div>
    )},
    { key: 'daysLeft', label: 'Status', sortable: true, sortValue: r => r.daysLeft, render: r => {
      const tone = expiryTone(r.daysLeft)
      return (
        <span style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: theme.radius.full, textTransform: 'uppercase', letterSpacing: '0.03em', background: tone.bg, color: tone.color, whiteSpace: 'nowrap' }}>
          {tone.label}
        </span>
      )
    }},
    { key: 'expectedLoss', label: 'Expected loss', sortable: true, sortValue: r => r.expectedLoss, render: r => (
      <div style={{ fontSize: 12.5, fontWeight: 800, color: r.daysLeft <= 0 ? danger : warning }}>{fmt(r.expectedLoss)}</div>
    )},
  ]

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
        {HORIZONS.map(h => {
          const on = horizon === h.value
          return (
            <button key={String(h.value)} type="button" aria-pressed={on} onClick={() => setHorizon(h.value)}
              style={{ padding: '8px 14px', borderRadius: theme.radius.full, border: `1px solid ${on ? tealDeep : border}`, cursor: 'pointer', fontSize: '12px', fontWeight: '700', background: on ? tealDeep : 'white', color: on ? 'white' : gray600 }}>
              {h.label}
            </button>
          )
        })}
        <select aria-label="Filter by warehouse" value={warehouseId} onChange={e => setWarehouseId(e.target.value)}
          style={{ marginLeft: 'auto', padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '12.5px', background: 'white', color: navy, fontWeight: 600 }}>
          <option value='all'>All warehouses</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          <option value='unassigned'>Unassigned</option>
        </select>
      </div>

      {loading ? <Loading text="Loading expiry data..." /> : error ? (
        <Card style={{ padding: '20px' }}>
          <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: '10px', color: danger, fontWeight: 700, fontSize: '13.5px' }}>
            <AlertTriangle size={16} /> {error}
          </div>
          <button type="button" onClick={load} style={{ marginTop: '14px', padding: '9px 18px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: navy, fontWeight: 700, fontSize: '12.5px', cursor: 'pointer' }}>
            Retry
          </button>
        </Card>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px', marginBottom: '20px' }}>
            <StatCard
              icon={<CalendarClock size={16} />}
              label="Batches in view"
              value={String(summary.count)}
              sub={horizon === 'all' ? 'All horizons' : `${horizon === 0 ? 'already expired' : `expiring within ${horizon} days`}`}
              tone="teal"
            />
            <StatCard
              icon={<AlertTriangle size={16} />}
              label="Expected loss"
              value={fmt(summary.expectedLoss)}
              sub="quantity × unit cost"
              tone={summary.expectedLoss > 0 ? 'warning' : 'teal'}
            />
            <StatCard
              icon={<AlertTriangle size={16} />}
              label="Already expired"
              value={String(summary.expiredCount)}
              sub="definite loss in view"
              tone={summary.expiredCount > 0 ? 'danger' : 'teal'}
            />
          </div>

          <DataTable
            variant="table"
            rows={visible}
            columns={columns}
            page={page}
            setPage={setPage}
            pageSize={25}
            total={visible.length}
            count={`${visible.length} batch${visible.length !== 1 ? 'es' : ''}`}
            empty={batches.length === 0 ? (
              <Empty icon={<CalendarClock size={40} strokeWidth={1.5} color={theme.gray300} />}
                message="No batches recorded yet. Add stock with an expiry date and it will appear here as it nears expiry." cause="none" />
            ) : (
              <Empty icon={<CalendarClock size={40} strokeWidth={1.5} color={theme.gray300} />}
                message="Nothing matches these filters. Try widening the horizon or choosing another warehouse." cause="filtered" />
            )}
          />
        </>
      )}
    </div>
  )
}