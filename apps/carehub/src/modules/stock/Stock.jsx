import { useState, useEffect } from 'react'
import { Plus, Search } from 'lucide-react'
import { stockRepository } from './repositories'
// Cross-aggregate read: a batch sits in a warehouse, which the warehouses
// module owns.
import { warehouseRepository } from '../warehouses/repositories'
// Cross-aggregate read owned by a module that has not adopted the seam yet
// (the product catalogue behind the receive form).
import { getProducts } from '../../services/supabase'
import { theme } from '../../styles/theme'
import { Card, Inp, TealBtn, GhostBtn, Modal, useToast, Toast, ConfirmDialog, CardSkeleton } from '../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, gray100, gray50, border, danger, dangerBg, warning, warningBg, bg } = theme
const STATUSES = ['available', 'reserved', 'damaged', 'returned', 'expired']

function daysUntil(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  const now = new Date()
  return Math.ceil((d - now) / (1000 * 60 * 60 * 24))
}

function expiryTone(dateStr) {
  const days = daysUntil(dateStr)
  if (days === null) return null
  if (days < 0) return { label: 'EXPIRED', bg: dangerBg, color: danger, border: danger }
  if (days <= 60) return { label: days + ' days left', bg: warningBg, color: warning, border: warning }
  return { label: 'Exp ' + new Date(dateStr).toLocaleDateString('en-NG', { month: 'short', year: 'numeric' }), bg: gray50, color: gray500, border: border }
}

function readAuth() {
  try { return JSON.parse(localStorage.getItem('carehub_auth') || '{}') } catch (e) { return {} }
}

export default function Stock({ brand }) {
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const authData = readAuth()
  const meName = (authData && authData.staff && authData.staff.full_name)
    ? authData.staff.full_name
    : ((authData && authData.brand && authData.brand.owner) ? authData.brand.owner : 'Owner')

  const [batches, setBatches] = useState([])
  const [locations, setLocations] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)

  const [filterLoc, setFilterLoc] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [search, setSearch] = useState('')

  const [receiving, setReceiving] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)

  const [transferring, setTransferring] = useState(null)
  const [transferTo, setTransferTo] = useState('')
  const [transferQty, setTransferQty] = useState('')

  const [adjusting, setAdjusting] = useState(null)
  const [adjustQty, setAdjustQty] = useState('')
  const [adjustReason, setAdjustReason] = useState('')

  const [batchToDelete, setBatchToDelete] = useState(null)

  useEffect(() => { load() }, [brand?.id])

  async function load() {
    if (!brand || !brand.id) return
    setLoading(true)
    try {
      const b = await stockRepository.getBatches(brand.id)
      const l = await warehouseRepository.getAll(brand.id)
      const p = await getProducts(brand.id)
      setBatches(b || [])
      setLocations(l || [])
      setProducts(p || [])
    } catch (e) {
      showToast('Could not load stock: ' + e.message, { type: 'error' })
    }
    setLoading(false)
  }

  const f = (k, v) => setForm(function (prev) { const next = { ...prev }; next[k] = v; return next })

  function locName(id) {
    const l = locations.filter(function (x) { return x.id === id })[0]
    return l ? l.name : 'Unassigned'
  }

  function openReceive() {
    setForm({ date_received: new Date().toISOString().split('T')[0], status: 'available' })
    setReceiving(true)
  }

  async function saveBatch() {
    if (!form.product_name) { showToast('Please enter the product name.', { type: 'warning' }); return }
    if (!form.location_id) { showToast('Please choose which warehouse this stock is going into.', { type: 'warning' }); return }
    if (!form.quantity || Number(form.quantity) <= 0) { showToast('Please enter a quantity greater than zero.', { type: 'warning' }); return }
    setSaving(true)
    try {
      await stockRepository.createBatch(brand.id, {
        location_id: form.location_id,
        product_id: form.product_id || null,
        product_name: form.product_name,
        batch_number: form.batch_number || null,
        quantity: Number(form.quantity),
        expiry_date: form.expiry_date || null,
        date_received: form.date_received || null,
        supplier_source: form.supplier_source || null,
        storage_location: form.storage_location || null,
        status: form.status || 'available',
        notes: form.notes || null,
        received_by: meName,
      })
      showToast('Stock received', { type: 'success' })
      setForm({})
      setReceiving(false)
      load()
    } catch (e) {
      showToast('Could not save: ' + e.message, { type: 'error' })
    }
    setSaving(false)
  }

  async function doTransfer() {
    if (!transferTo) { showToast('Choose a destination warehouse.', { type: 'warning' }); return }
    if (transferTo === transferring.location_id) { showToast('That is the same warehouse it is already in.', { type: 'warning' }); return }
    try {
      await stockRepository.transfer(brand.id, { batch: transferring, toLocationId: transferTo, qty: transferQty, movedBy: meName })
      showToast('Stock transferred', { type: 'success' })
      setTransferring(null)
      setTransferTo('')
      setTransferQty('')
      load()
    } catch (e) {
      showToast('Transfer failed: ' + e.message, { type: 'error' })
    }
  }

  async function doAdjust() {
    if (adjustQty === '') { showToast('Enter the corrected quantity.', { type: 'warning' }); return }
    try {
      await stockRepository.adjust(brand.id, { batch: adjusting, newQty: adjustQty, reason: adjustReason, movedBy: meName })
      showToast('Stock adjusted', { type: 'success' })
      setAdjusting(null)
      setAdjustQty('')
      setAdjustReason('')
      load()
    } catch (e) {
      showToast('Adjustment failed: ' + e.message, { type: 'error' })
    }
  }

  async function setStatus(batch, status) {
    try {
      await stockRepository.updateBatch(batch.id, brand.id, { status: status })
      showToast('Marked as ' + status, { type: 'success' })
      load()
    } catch (e) {
      showToast('Could not update: ' + e.message, { type: 'error' })
    }
  }

  function askRemoveBatch(batch) { setBatchToDelete(batch) }

  async function removeBatch() {
    if (!batchToDelete) return
    try {
      await stockRepository.deleteBatch(batchToDelete.id, brand.id)
      setBatchToDelete(null)
      showToast('Batch deleted', { type: 'success' })
      load()
    } catch (e) {
      showToast('Could not delete: ' + e.message, { type: 'error' })
    }
  }

  const visible = batches.filter(function (b) {
    if (filterLoc !== 'all' && b.location_id !== filterLoc) return false
    if (filterStatus !== 'all' && b.status !== filterStatus) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const inName = (b.product_name || '').toLowerCase().indexOf(q) >= 0
      const inBatch = (b.batch_number || '').toLowerCase().indexOf(q) >= 0
      if (!inName && !inBatch) return false
    }
    return true
  })

  const totalUnits = visible.reduce(function (s, b) { return s + (b.quantity || 0) }, 0)
  const expiringSoon = batches.filter(function (b) {
    const d = daysUntil(b.expiry_date)
    return d !== null && d >= 0 && d <= 60 && b.status === 'available'
  })
  const expired = batches.filter(function (b) {
    const d = daysUntil(b.expiry_date)
    return d !== null && d < 0 && b.status !== 'expired'
  })

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: '900', color: navy }}>Stock & Batches</div>
          <div style={{ fontSize: '13px', color: gray500, marginTop: '2px' }}>Receive stock into a warehouse, track batch numbers and expiry, transfer between locations.</div>
        </div>
        <TealBtn onClick={openReceive} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Plus size={15} /> Receive stock</TealBtn>
      </div>

      {expired.length > 0 && (
        <div style={{ padding: '12px 14px', borderRadius: theme.radius.md, background: dangerBg, border: `1px solid ${danger}`, marginBottom: '10px' }}>
          <div style={{ fontSize: '13px', fontWeight: '800', color: danger }}>{expired.length} batch{expired.length > 1 ? 'es have' : ' has'} expired</div>
          <div style={{ fontSize: '12px', color: gray600, marginTop: '2px' }}>Filter by "expired" below, or mark them so they are not dispatched.</div>
        </div>
      )}

      {expiringSoon.length > 0 && (
        <div style={{ padding: '12px 14px', borderRadius: theme.radius.md, background: warningBg, border: `1px solid ${warning}`, marginBottom: '18px' }}>
          <div style={{ fontSize: '13px', fontWeight: '800', color: warning }}>{expiringSoon.length} batch{expiringSoon.length > 1 ? 'es expire' : ' expires'} within 60 days</div>
          <div style={{ fontSize: '12px', color: gray600, marginTop: '2px' }}>Prioritise these for dispatch.</div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '18px' }}>
        {[['Batches', visible.length], ['Total Units', totalUnits.toLocaleString()], ['Warehouses', locations.length]].map(([label, val]) => (
          <Card key={label} style={{ padding: '14px' }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: gray400, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
            <div style={{ fontSize: '22px', fontWeight: '900', color: navy, marginTop: '4px' }}>{val}</div>
          </Card>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '0 12px' }}>
          <Search size={15} color={gray400} style={{ flexShrink: 0 }} />
          <input value={search} onChange={function (e) { setSearch(e.target.value) }}
            placeholder='Search by product or batch number...'
            style={{ flex: 1, padding: '11px 0', border: 'none', fontSize: '13px', outline: 'none', background: 'transparent', color: navy, minWidth: 0 }} />
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <select value={filterLoc} onChange={function (e) { setFilterLoc(e.target.value) }}
            style={{ flex: 1, minWidth: '150px', padding: '10px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', background: 'white', color: navy }}>
            <option value='all'>All warehouses</option>
            {locations.map(function (l) {
              return <option key={l.id} value={l.id}>{l.name}</option>
            })}
          </select>

          <select value={filterStatus} onChange={function (e) { setFilterStatus(e.target.value) }}
            style={{ flex: 1, minWidth: '150px', padding: '10px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', background: 'white', textTransform: 'capitalize', color: navy }}>
            <option value='all'>All statuses</option>
            {STATUSES.map(function (s) {
              return <option key={s} value={s}>{s}</option>
            })}
          </select>
        </div>
      </div>

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      )}

      {!loading && locations.length === 0 && (
        <Card style={{ padding: '32px', textAlign: 'center' }}>
          <div style={{ fontWeight: '800', color: navy, marginBottom: '6px' }}>No warehouses yet</div>
          <div style={{ fontSize: '13px', color: gray500 }}>Add a warehouse under "Warehouses & Branches" first — stock has to go somewhere.</div>
        </Card>
      )}

      {!loading && locations.length > 0 && visible.length === 0 && (
        <Card style={{ padding: '32px', textAlign: 'center' }}>
          <div style={{ fontWeight: '800', color: navy, marginBottom: '6px' }}>
            {batches.length === 0 ? 'No stock received yet' : 'Nothing matches those filters'}
          </div>
          <div style={{ fontSize: '13px', color: gray500, marginBottom: '16px' }}>
            {batches.length === 0 ? 'Record your first batch into a warehouse.' : 'Try clearing the search or filters.'}
          </div>
          {batches.length === 0 && <TealBtn onClick={openReceive} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Plus size={15} /> Receive stock</TealBtn>}
        </Card>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {visible.map(function (b) {
          const tone = expiryTone(b.expiry_date)
          return (
            <Card key={b.id} style={{ padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: '800', fontSize: '15px', color: navy }}>{b.product_name}</span>
                    {b.batch_number && (
                      <span style={{ fontSize: '10.5px', fontWeight: '700', fontFamily: theme.fontMono, padding: '3px 8px', borderRadius: theme.radius.sm, background: gray100, color: gray600 }}>
                        {b.batch_number}
                      </span>
                    )}
                    <span style={{ fontSize: '10px', fontWeight: '700', padding: '3px 8px', borderRadius: theme.radius.full, textTransform: 'uppercase', letterSpacing: '0.03em',
                      background: b.status === 'available' ? tealMist : b.status === 'damaged' || b.status === 'expired' ? dangerBg : gray100,
                      color: b.status === 'available' ? tealDeep : b.status === 'damaged' || b.status === 'expired' ? danger : gray500 }}>
                      {b.status}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '8px' }}>
                    <span style={{ fontSize: '20px', fontWeight: '900', color: navy }}>{(b.quantity || 0).toLocaleString()}</span>
                    <span style={{ fontSize: '12px', color: gray400, fontWeight: '600' }}>units</span>
                  </div>

                  <div style={{ fontSize: '12px', color: gray500, marginTop: '6px' }}>
                    {locName(b.location_id)}
                    {b.storage_location ? ' · ' + b.storage_location : ''}
                  </div>

                  {b.supplier_source && (
                    <div style={{ fontSize: '11.5px', color: gray400, marginTop: '2px' }}>From: {b.supplier_source}</div>
                  )}

                  {b.date_received && (
                    <div style={{ fontSize: '11.5px', color: gray400, marginTop: '2px' }}>
                      Received {new Date(b.date_received).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })}
                      {b.received_by ? ' by ' + b.received_by : ''}
                    </div>
                  )}

                  {tone && (
                    <div style={{ display: 'inline-block', marginTop: '8px', fontSize: '11px', fontWeight: '700', padding: '4px 10px', borderRadius: theme.radius.full, background: tone.bg, color: tone.color, border: '1px solid ' + tone.border }}>
                      {tone.label}
                    </div>
                  )}

                  {b.notes && (
                    <div style={{ fontSize: '11.5px', color: gray400, marginTop: '6px', fontStyle: 'italic' }}>{b.notes}</div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 }}>
                  <button onClick={function () { setTransferring(b); setTransferQty(String(b.quantity)); setTransferTo('') }}
                    style={{ border: `1px solid ${tealDeep}`, background: tealMist, color: tealDeep, borderRadius: theme.radius.sm, padding: '7px 12px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    Transfer
                  </button>
                  <button onClick={function () { setAdjusting(b); setAdjustQty(String(b.quantity)); setAdjustReason('') }}
                    style={{ border: `1px solid ${border}`, background: 'white', color: navy, borderRadius: theme.radius.sm, padding: '7px 12px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    Adjust
                  </button>
                  <button onClick={function () { askRemoveBatch(b) }}
                    style={{ border: `1px solid ${danger}`, background: dangerBg, color: danger, borderRadius: theme.radius.sm, padding: '7px 12px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    Delete
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${gray100}` }}>
                {STATUSES.map(function (s) {
                  const on = b.status === s
                  return (
                    <button key={s} onClick={function () { if (!on) setStatus(b, s) }}
                      style={{ fontSize: '10.5px', fontWeight: '700', padding: '5px 12px', borderRadius: theme.radius.full, cursor: on ? 'default' : 'pointer', textTransform: 'capitalize',
                        border: `1px solid ${on ? tealDeep : border}`,
                        background: on ? tealDeep : 'white',
                        color: on ? 'white' : gray500 }}>
                      {s}
                    </button>
                  )
                })}
              </div>
            </Card>
          )
        })}
      </div>

      <Modal show={receiving} onClose={function () { setReceiving(false); setForm({}) }} sheet wide title='Receive Stock'
        footer={<>
          <GhostBtn onClick={function () { setReceiving(false); setForm({}) }} style={{ flex: 1, padding: '13px' }}>Cancel</GhostBtn>
          <TealBtn onClick={saveBatch} style={{ flex: 2, padding: '13px' }}>{saving ? 'Saving...' : 'Receive Stock'}</TealBtn>
        </>}>
            <div style={{ fontSize: '11.5px', color: gray500, marginBottom: '16px' }}>Recording as <strong>{meName}</strong></div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '11px', fontWeight: '700', color: gray600, marginBottom: '6px' }}>Product *</div>
                <input list='stock-product-list' value={form.product_name || ''}
                  onChange={function (e) {
                    const val = e.target.value
                    f('product_name', val)
                    const match = products.filter(function (p) { return p.name === val })[0]
                    f('product_id', match ? match.id : null)
                  }}
                  placeholder='Type or pick a product'
                  style={{ width: '100%', minHeight: 44, padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', boxSizing: 'border-box', color: navy, outline: 'none' }} />
                <datalist id='stock-product-list'>
                  {products.map(function (p) { return <option key={p.id} value={p.name} /> })}
                </datalist>
              </div>

              <div>
                <div style={{ fontSize: '11px', fontWeight: '700', color: gray600, marginBottom: '6px' }}>Warehouse *</div>
                <select value={form.location_id || ''} onChange={function (e) { f('location_id', e.target.value) }}
                  style={{ width: '100%', minHeight: 44, padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', background: 'white', color: navy }}>
                  <option value=''>Choose a warehouse</option>
                  {locations.map(function (l) {
                    return <option key={l.id} value={l.id}>{l.name} ({l.location_type})</option>
                  })}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <Inp label='Quantity *' value={form.quantity} onChange={function (v) { f('quantity', v) }} type='number' placeholder='e.g. 2400' />
                <Inp label='Batch Number' value={form.batch_number} onChange={function (v) { f('batch_number', v) }} placeholder='e.g. EX2216' />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: gray600, marginBottom: '6px' }}>Expiry Date</div>
                  <input type='date' value={form.expiry_date || ''} onChange={function (e) { f('expiry_date', e.target.value) }}
                    style={{ width: '100%', minHeight: 44, padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', boxSizing: 'border-box', color: navy, outline: 'none' }} />
                </div>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: gray600, marginBottom: '6px' }}>Date Received</div>
                  <input type='date' value={form.date_received || ''} onChange={function (e) { f('date_received', e.target.value) }}
                    style={{ width: '100%', minHeight: 44, padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', boxSizing: 'border-box', color: navy, outline: 'none' }} />
                </div>
              </div>

              <Inp label='Supplier / Source' value={form.supplier_source} onChange={function (v) { f('supplier_source', v) }} placeholder='Who did this come from?' />
              <Inp label='Storage Location' value={form.storage_location} onChange={function (v) { f('storage_location', v) }} placeholder='e.g. Rack B, Shelf 3' />

              <div>
                <div style={{ fontSize: '11px', fontWeight: '700', color: gray600, marginBottom: '6px' }}>Status</div>
                <select value={form.status || 'available'} onChange={function (e) { f('status', e.target.value) }}
                  style={{ width: '100%', minHeight: 44, padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', background: 'white', textTransform: 'capitalize', color: navy }}>
                  {STATUSES.map(function (s) { return <option key={s} value={s}>{s}</option> })}
                </select>
              </div>

              <Inp label='Notes' value={form.notes} onChange={function (v) { f('notes', v) }} placeholder='Anything worth recording' />
            </div>
      </Modal>

      <Modal show={!!transferring} onClose={function () { setTransferring(null) }} sheet title='Transfer Stock'
        footer={<>
          <GhostBtn onClick={function () { setTransferring(null) }} style={{ flex: 1, padding: '13px' }}>Cancel</GhostBtn>
          <TealBtn onClick={doTransfer} style={{ flex: 2, padding: '13px' }}>Transfer</TealBtn>
        </>}>
            {transferring && (<>
              <div style={{ fontSize: '12px', color: gray500, marginBottom: '16px' }}>
                {transferring.product_name} · {transferring.quantity} units in {locName(transferring.location_id)}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: gray600, marginBottom: '6px' }}>Move to *</div>
                  <select value={transferTo} onChange={function (e) { setTransferTo(e.target.value) }}
                    style={{ width: '100%', minHeight: 44, padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', background: 'white', color: navy }}>
                    <option value=''>Choose destination warehouse</option>
                    {locations.filter(function (l) { return l.id !== transferring.location_id }).map(function (l) {
                      return <option key={l.id} value={l.id}>{l.name} ({l.location_type})</option>
                    })}
                  </select>
                </div>

                <div>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: gray600, marginBottom: '6px' }}>How many units? *</div>
                  <input type='number' value={transferQty} onChange={function (e) { setTransferQty(e.target.value) }}
                    style={{ width: '100%', minHeight: 44, padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', boxSizing: 'border-box', color: navy, outline: 'none' }} />
                  <div style={{ fontSize: '11px', color: gray400, marginTop: '4px' }}>
                    Move all {transferring.quantity} to relocate the whole batch, or fewer to split it.
                  </div>
                </div>
              </div>
            </>)}
      </Modal>

      <Modal show={!!adjusting} onClose={function () { setAdjusting(null) }} sheet title='Adjust Quantity'
        footer={<>
          <GhostBtn onClick={function () { setAdjusting(null) }} style={{ flex: 1, padding: '13px' }}>Cancel</GhostBtn>
          <TealBtn onClick={doAdjust} style={{ flex: 2, padding: '13px' }}>Save Adjustment</TealBtn>
        </>}>
            {adjusting && (<>
              <div style={{ fontSize: '12px', color: gray500, marginBottom: '16px' }}>
                {adjusting.product_name} · currently {adjusting.quantity} units
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: gray600, marginBottom: '6px' }}>Corrected quantity *</div>
                  <input type='number' value={adjustQty} onChange={function (e) { setAdjustQty(e.target.value) }}
                    style={{ width: '100%', minHeight: 44, padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', boxSizing: 'border-box', color: navy, outline: 'none' }} />
                </div>

                <Inp label='Reason' value={adjustReason} onChange={function (v) { setAdjustReason(v) }} placeholder='e.g. Damaged in transit, recount, breakage' />

                <div style={{ fontSize: '11px', color: gray400, lineHeight: '1.5' }}>
                  Every adjustment is logged with the reason, the amount, and who made it.
                </div>
              </div>
            </>)}
      </Modal>

      <ConfirmDialog show={!!batchToDelete} onClose={function () { setBatchToDelete(null) }} onConfirm={removeBatch}
        title={'Delete batch' + (batchToDelete && batchToDelete.batch_number ? ' "' + batchToDelete.batch_number + '"' : '') + '?'}
        consequence={'This permanently removes the record of ' + (batchToDelete ? (batchToDelete.quantity || 0).toLocaleString() + ' units of ' + batchToDelete.product_name : 'this batch') + ' from stock. This cannot be undone.'}
        confirmLabel="Delete" />
    </div>
  )
}
