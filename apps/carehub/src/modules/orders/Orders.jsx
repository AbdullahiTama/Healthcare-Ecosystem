import { useState, useEffect } from 'react'
import { X, Check } from 'lucide-react'
import { orderRepository } from './repositories'
import { productRepository } from '../inventory/repositories'
// Cross-aggregate reads, each through the module that owns it: an order is
// raised for a location and a territory, and is raised/approved/watched by
// staff. Orders now imports nothing from services/supabase.
import { warehouseRepository } from '../warehouses/repositories'
import { territoryRepository } from '../territories/repositories'
import { staffRepository } from '../staff/repositories'
import { Card, Inp, TealBtn, GhostBtn, Modal, Empty, DataTable, useToast, Toast } from '../../components/ui'
import { theme } from '../../styles/theme'
const { tealDeep, tealMist, tealBright, navy, gray600, gray500, gray400, gray200, gray100, gray50, border, danger, dangerBg, success, successBg, warning, warningBg, info, infoBg, purple, bg } = theme

const PIPELINE = ['submitted', 'approved', 'processing', 'dispatched', 'delivered']

const PAGE_SIZE = 25

const STAGE_LABEL = {
  submitted: 'Awaiting Approval',
  approved: 'Approved',
  processing: 'Warehouse Processing',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
  rejected: 'Rejected',
}

const STAGE_TONE = {
  submitted: { bg: warningBg, color: warning, border: warning },
  approved: { bg: infoBg, color: info, border: info },
  processing: { bg: infoBg, color: purple, border: purple },
  dispatched: { bg: infoBg, color: info, border: info },
  delivered: { bg: tealMist, color: tealDeep, border: tealDeep },
  rejected: { bg: dangerBg, color: danger, border: danger },
}

function money(n) {
  return '₦' + Number(n || 0).toLocaleString()
}

function fmtStamp(d) {
  if (!d) return ''
  return new Date(d).toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function readAuth() {
  try { return JSON.parse(localStorage.getItem('carehub_auth') || '{}') } catch (e) { return {} }
}

export default function Orders({ brand }) {
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const authData = readAuth()
  const meStaffId = (authData && authData.staff && authData.staff.id) ? authData.staff.id : null
  const meName = (authData && authData.staff && authData.staff.full_name)
    ? authData.staff.full_name
    : ((authData && authData.brand && authData.brand.owner) ? authData.brand.owner : 'Owner')
  const meTitle = (authData && authData.staff)
    ? (authData.staff.public_title || authData.staff.role || 'Staff')
    : 'Owner'
  const isOwner = meStaffId === null

  const [orders, setOrders] = useState([])
  const [itemsByOrder, setItemsByOrder] = useState({})
  const [watchersByOrder, setWatchersByOrder] = useState({})
  const [filesByOrder, setFilesByOrder] = useState({})
  const [staffList, setStaffList] = useState([])
  const [products, setProducts] = useState([])
  const [territories, setTerritories] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterStage, setFilterStage] = useState('all')
  const [page, setPage] = useState(0)
  useEffect(() => { setPage(0) }, [filterStage, orders.length])

  const [openOrder, setOpenOrder] = useState(null)
  const [events, setEvents] = useState([])
  const [actionNote, setActionNote] = useState('')
  const [acting, setActing] = useState(false)

  const [composing, setComposing] = useState(false)
  const [form, setForm] = useState({})
  const [lines, setLines] = useState([{ product_name: '', quantity: '', unit_price: '' }])
  const [approverId, setApproverId] = useState('')
  const [watcherIds, setWatcherIds] = useState([])
  const [attachments, setAttachments] = useState([])
  const [sending, setSending] = useState(false)
  const [uploadStatus, setUploadStatus] = useState('')

  useEffect(() => { load() }, [brand?.id])

  async function load() {
    if (!brand || !brand.id) return
    setLoading(true)
    try {
      const o = await orderRepository.getAll(brand.id)
      const s = await staffRepository.getAll(brand.id)
      const p = await productRepository.getAll(brand.id)
      const t = await territoryRepository.getAll(brand.id)
      const l = await warehouseRepository.getAll(brand.id)
      setOrders(o || [])
      setStaffList(s || [])
      setProducts(p || [])
      setTerritories(t || [])
      setLocations(l || [])

      const ids = (o || []).map(function (x) { return x.id })
      const its = await orderRepository.getItems(ids)
      const imap = {}
      ;(its || []).forEach(function (i) {
        if (!imap[i.order_id]) imap[i.order_id] = []
        imap[i.order_id].push(i)
      })
      setItemsByOrder(imap)

      const ws = await orderRepository.getWatchers(ids)
      const wmap = {}
      ;(ws || []).forEach(function (w) {
        if (!wmap[w.order_id]) wmap[w.order_id] = []
        wmap[w.order_id].push(w)
      })
      setWatchersByOrder(wmap)

      const fs = await orderRepository.getFiles(ids)
      const fmap = {}
      ;(fs || []).forEach(function (f) {
        if (!fmap[f.order_id]) fmap[f.order_id] = []
        fmap[f.order_id].push(f)
      })
      setFilesByOrder(fmap)
    } catch (e) {
      showToast('Could not load orders: ' + e.message, { type: 'error' })
    }
    setLoading(false)
  }

  const f = (k, v) => setForm(function (prev) { const next = { ...prev }; next[k] = v; return next })

  // Anyone in the company except me can be tagged as approver or copied.
  const people = [{ id: 'OWNER', name: (brand && brand.owner ? brand.owner : 'Owner') + ' (Owner)' }]
    .concat(staffList.map(function (s) {
      return { id: s.id, name: s.full_name + (s.public_title ? ' · ' + s.public_title : '') }
    }))
    .filter(function (p) {
      if (isOwner) return p.id !== 'OWNER'
      return p.id !== meStaffId
    })

  function nameFor(id) {
    const found = people.filter(function (p) { return p.id === id })[0]
    return found ? found.name : 'Unknown'
  }

  function staffIdFor(id) {
    return id === 'OWNER' ? null : id
  }

  function toggleWatcher(id) {
    if (id === approverId) return
    setWatcherIds(function (prev) {
      return prev.indexOf(id) >= 0 ? prev.filter(function (x) { return x !== id }) : prev.concat([id])
    })
  }

  function chooseApprover(id) {
    setApproverId(id)
    setWatcherIds(function (prev) { return prev.filter(function (x) { return x !== id }) })
  }

  function setLine(i, key, val) {
    setLines(function (prev) {
      const next = prev.map(function (l, idx) {
        if (idx !== i) return l
        const copy = { ...l }
        copy[key] = val
        return copy
      })
      return next
    })
  }

  function addLine() {
    setLines(function (prev) { return prev.concat([{ product_name: '', quantity: '', unit_price: '' }]) })
  }

  function removeLine(i) {
    setLines(function (prev) { return prev.filter(function (l, idx) { return idx !== i }) })
  }

  const orderTotal = lines.reduce(function (sum, l) {
    return sum + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0)
  }, 0)

  function pickFiles(e) {
    const picked = Array.from(e.target.files || [])
    if (picked.length === 0) return
    const ok = picked.filter(function (x) { return x.size <= 20 * 1024 * 1024 })
    if (ok.length !== picked.length) showToast('Some files were over 20MB and were skipped.', { type: 'warning' })
    setAttachments(function (prev) { return prev.concat(ok) })
    e.target.value = ''
  }

  function removeFile(i) {
    setAttachments(function (prev) { return prev.filter(function (x, idx) { return idx !== i }) })
  }

  function openNew() {
    setForm({})
    setLines([{ product_name: '', quantity: '', unit_price: '' }])
    setApproverId('')
    setWatcherIds([])
    setAttachments([])
    setComposing(true)
  }

  async function submitOrder() {
    if (!form.customer_name) { showToast('Please enter the customer name.', { type: 'warning' }); return }
    if (!approverId) { showToast('Please tag the manager who should approve this order.', { type: 'warning' }); return }
    const validLines = lines.filter(function (l) { return l.product_name && Number(l.quantity) > 0 })
    if (validLines.length === 0) { showToast('Add at least one product with a quantity.', { type: 'warning' }); return }

    setSending(true)
    try {
      const uploaded = []
      for (let i = 0; i < attachments.length; i++) {
        const file = attachments[i]
        setUploadStatus('Uploading ' + (i + 1) + ' of ' + attachments.length + ' — ' + file.name)
        const url = await orderRepository.uploadFile(file)
        uploaded.push({
          file_name: file.name,
          file_url: url,
          file_type: file.type || null,
          file_size: file.size || null,
          kind: 'lpo',
        })
      }
      setUploadStatus('')

      const ref = 'ORD-' + Date.now().toString().slice(-8)

      const items = validLines.map(function (l) {
        const match = products.filter(function (p) { return p.name === l.product_name })[0]
        return {
          product_id: match ? match.id : null,
          product_name: l.product_name,
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price) || 0,
        }
      })

      const total = items.reduce(function (s, i) { return s + i.quantity * i.unit_price }, 0)

      const watchers = watcherIds.map(function (id) {
        return { staff_id: staffIdFor(id), watcher_name: nameFor(id) }
      })

      await orderRepository.create({
        business_id: brand.id,
        order_ref: ref,
        customer_name: form.customer_name,
        customer_contact: form.customer_contact || null,
        customer_address: form.customer_address || null,
        territory_id: form.territory_id || null,
        location_id: form.location_id || null,
        status: 'submitted',
        total_value: total,
        notes: form.notes || null,
        created_by_staff_id: meStaffId,
        created_by_name: meName,
        created_by_title: meTitle,
        approver_staff_id: staffIdFor(approverId),
        approver_name: nameFor(approverId),
      }, items, watchers, uploaded)

      showToast('Order submitted for approval', { type: 'success' })
      setComposing(false)
      load()
    } catch (e) {
      showToast('Could not submit order: ' + e.message, { type: 'error' })
    }
    setUploadStatus('')
    setSending(false)
  }

  async function openOrderView(o) {
    setOpenOrder(o)
    setActionNote('')
    try {
      const ev = await orderRepository.getEvents(o.id)
      setEvents(ev || [])
    } catch (e) {
      showToast('Could not load order history: ' + e.message, { type: 'error' })
    }
  }

  // Only the tagged approver (or the Owner) can approve or reject.
  function canApprove(o) {
    if (o.status !== 'submitted') return false
    if (isOwner) return true
    return o.approver_staff_id === meStaffId
  }

  async function act(o, status, extra) {
    setActing(true)
    try {
      await orderRepository.advance(o.id, brand.id, status, extra, meName, actionNote)
      showToast('Order ' + status, { type: 'success' })
      setOpenOrder(null)
      setActionNote('')
      load()
    } catch (e) {
      showToast('Could not update order: ' + e.message, { type: 'error' })
    }
    setActing(false)
  }

  const visible = orders.filter(function (o) {
    if (filterStage === 'all') return true
    return o.status === filterStage
  })

  const awaitingMe = orders.filter(function (o) {
    return o.status === 'submitted' && (isOwner || o.approver_staff_id === meStaffId)
  })

  function terrName(id) {
    const t = territories.filter(function (x) { return x.id === id })[0]
    return t ? t.name : null
  }

  function locName(id) {
    const l = locations.filter(function (x) { return x.id === id })[0]
    return l ? l.name : null
  }

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '18px', fontWeight: '900', color: navy }}>Orders & LPO</div>
          <div style={{ fontSize: '13px', color: gray500, marginTop: '2px' }}>Submit an order, tag the manager who approves it, copy anyone else who should see it.</div>
        </div>
        <TealBtn onClick={openNew}>+ New Order</TealBtn>
      </div>

      {awaitingMe.length > 0 && (
        <div style={{ padding: '12px 14px', borderRadius: '10px', background: warningBg, border: `1px solid ${warning}`, marginBottom: '18px' }}>
          <div style={{ fontSize: '13px', fontWeight: '800', color: warning }}>
            {awaitingMe.length} order{awaitingMe.length > 1 ? 's are' : ' is'} waiting for your approval
          </div>
          <div style={{ fontSize: '12px', color: warning, marginTop: '2px' }}>Open one below to approve or reject it.</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '18px' }}>
        {['all'].concat(PIPELINE).concat(['rejected']).map(function (s) {
          const on = filterStage === s
          const count = s === 'all' ? orders.length : orders.filter(function (o) { return o.status === s }).length
          return (
            <button key={s} onClick={function () { setFilterStage(s) }}
              style={{ fontSize: '11.5px', fontWeight: '700', padding: '7px 12px', borderRadius: '20px', cursor: 'pointer', textTransform: 'capitalize',
                border: `1px solid ${on ? tealDeep : border}`,
                background: on ? navy : 'white',
                color: on ? 'white' : gray500 }}>
              {s === 'all' ? 'All' : (STAGE_LABEL[s] || s)} ({count})
            </button>
          )
        })}
      </div>

      <DataTable
        variant="cards"
        rows={visible}
        page={page}
        setPage={setPage}
        pageSize={PAGE_SIZE}
        total={visible.length}
        loading={loading}
        empty={
          <Card style={{ padding: '32px', textAlign: 'center' }}>
            <div style={{ fontWeight: '800', color: navy, marginBottom: '6px' }}>
              {orders.length === 0 ? 'No orders yet' : 'Nothing at this stage'}
            </div>
            <div style={{ fontSize: '13px', color: gray500, marginBottom: '16px' }}>
              {orders.length === 0 ? 'Submit your first order and tag a manager to approve it.' : 'Try another filter.'}
            </div>
            {orders.length === 0 && <TealBtn onClick={openNew}>+ New Order</TealBtn>}
          </Card>
        }
        count={`${visible.length} order${visible.length !== 1 ? 's' : ''}`}
        rowStyle={function (o) {
          const mine = o.status === 'submitted' && (isOwner || o.approver_staff_id === meStaffId)
          return { borderLeft: mine ? `3px solid ${warning}` : '3px solid transparent' }
        }}
        renderCard={function (o) {
          const tone = STAGE_TONE[o.status] || STAGE_TONE.submitted
          const items = itemsByOrder[o.id] || []
          const watchers = watchersByOrder[o.id] || []
          const files = filesByOrder[o.id] || []
          return (
            <button onClick={function () { openOrderView(o) }}
              style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '16px', cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '15px', fontWeight: '800', color: navy }}>{o.customer_name}</span>
                    <span style={{ fontSize: '10px', fontWeight: '700', padding: '3px 9px', borderRadius: '20px', textTransform: 'uppercase', letterSpacing: '0.03em',
                      background: tone.bg, color: tone.color, border: '1px solid ' + tone.border }}>
                      {STAGE_LABEL[o.status] || o.status}
                    </span>
                  </div>

                  <div style={{ fontSize: '10px', color: gray400, fontFamily: 'monospace', marginTop: '4px' }}>{o.order_ref}</div>

                  <div style={{ fontSize: '12px', color: gray600, marginTop: '8px' }}>
                    <strong>Raised by:</strong> {o.created_by_name}{o.created_by_title ? ' · ' + o.created_by_title : ''}
                  </div>
                  <div style={{ fontSize: '12px', color: gray600, marginTop: '2px' }}>
                    <strong>Approver:</strong> {o.approver_name || 'Not set'}
                  </div>
                  {watchers.length > 0 && (
                    <div style={{ fontSize: '11.5px', color: gray400, marginTop: '2px' }}>
                      <strong>Copied:</strong> {watchers.map(function (w) { return w.watcher_name }).join(', ')}
                    </div>
                  )}

                  <div style={{ fontSize: '11.5px', color: gray400, marginTop: '6px' }}>
                    {items.length} line item{items.length !== 1 ? 's' : ''}
                    {files.length > 0 ? ' · ' + files.length + ' document' + (files.length > 1 ? 's' : '') : ''}
                    {terrName(o.territory_id) ? ' · ' + terrName(o.territory_id) : ''}
                  </div>
                </div>

                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: '17px', fontWeight: '900', color: tealDeep }}>{money(o.total_value)}</div>
                  <div style={{ fontSize: '10.5px', color: gray400, fontWeight: '600', marginTop: '4px' }}>{fmtStamp(o.created_at)}</div>
                </div>
              </div>
            </button>
          )
        }}
      />

      <Modal show={composing} onClose={function () { setComposing(false) }} sheet wide title='New Order'
        footer={<>
          <GhostBtn onClick={function () { setComposing(false) }} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
          <TealBtn onClick={submitOrder} style={{ flex: 2, padding: '12px' }}>{sending ? 'Submitting...' : 'Submit for Approval'}</TealBtn>
        </>}>
            <div style={{ fontSize: '11.5px', color: gray500, marginBottom: '16px' }}>Raised by <strong>{meName}</strong>{meTitle ? ' · ' + meTitle : ''}</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <Inp label='Customer Name *' value={form.customer_name} onChange={function (v) { f('customer_name', v) }} placeholder='e.g. St. Kizito Hospital Pharmacy' />
              <Inp label='Customer Contact' value={form.customer_contact} onChange={function (v) { f('customer_contact', v) }} placeholder='Phone or email' />
              <Inp label='Delivery Address' value={form.customer_address} onChange={function (v) { f('customer_address', v) }} placeholder='Where it is going' />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: gray600, marginBottom: '6px' }}>Territory</div>
                  <select value={form.territory_id || ''} onChange={function (e) { f('territory_id', e.target.value) }}
                    style={{ width: '100%', padding: '12px 12px', borderRadius: '10px', border: `1px solid ${border}`, fontSize: '13px', background: 'white' }}>
                    <option value=''>Not set</option>
                    {territories.map(function (t) { return <option key={t.id} value={t.id}>{t.name}</option> })}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: gray600, marginBottom: '6px' }}>Fulfil from</div>
                  <select value={form.location_id || ''} onChange={function (e) { f('location_id', e.target.value) }}
                    style={{ width: '100%', padding: '12px 12px', borderRadius: '10px', border: `1px solid ${border}`, fontSize: '13px', background: 'white' }}>
                    <option value=''>Not set</option>
                    {locations.map(function (l) { return <option key={l.id} value={l.id}>{l.name}</option> })}
                  </select>
                </div>
              </div>

              <div>
                <div style={{ fontSize: '12px', fontWeight: '700', color: gray600, marginBottom: '2px' }}>Approver *</div>
                <div style={{ fontSize: '11px', color: gray400, marginBottom: '6px' }}>Tag the one manager responsible for approving this order.</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {people.map(function (p) {
                    const on = approverId === p.id
                    return (
                      <button key={'ap' + String(p.id)} type='button' onClick={function () { chooseApprover(p.id) }}
                        style={{ fontSize: '11.5px', fontWeight: '600', padding: '7px 11px', borderRadius: '8px', cursor: 'pointer',
                          border: `1px solid ${on ? tealDeep : border}`,
                          background: on ? warning : 'white',
                          color: on ? 'white' : gray600 }}>
                        {p.name}
                      </button>
                    )
                  })}
                </div>
                {people.length === 0 && <div style={{ fontSize: '11.5px', color: gray400, marginTop: '4px' }}>No one to tag yet — add staff first.</div>}
              </div>

              <div>
                <div style={{ fontSize: '12px', fontWeight: '700', color: gray600, marginBottom: '2px' }}>Copy others</div>
                <div style={{ fontSize: '11px', color: gray400, marginBottom: '6px' }}>They can see the order and its progress, but do not approve it.</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {people.map(function (p) {
                    const on = watcherIds.indexOf(p.id) >= 0
                    const isApprover = approverId === p.id
                    return (
                      <button key={'cc' + String(p.id)} type='button' disabled={isApprover} onClick={function () { toggleWatcher(p.id) }}
                        style={{ fontSize: '11.5px', fontWeight: '600', padding: '7px 11px', borderRadius: '8px',
                          cursor: isApprover ? 'not-allowed' : 'pointer',
                          opacity: isApprover ? 0.4 : 1,
                          border: `1px solid ${on ? tealDeep : border}`,
                          background: on ? gray600 : 'white',
                          color: on ? 'white' : gray600 }}>
                        {p.name}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '12px', fontWeight: '700', color: gray600, marginBottom: '8px' }}>Products *</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {lines.map(function (l, i) {
                    return (
                      <div key={i} style={{ border: `1px solid ${border}`, borderRadius: '10px', padding: '10px' }}>
                        <input list='order-product-list' value={l.product_name}
                          onChange={function (e) { setLine(i, 'product_name', e.target.value) }}
                          placeholder='Product name'
                          style={{ width: '100%', padding: '9px 10px', borderRadius: '8px', border: `1px solid ${border}`, fontSize: '13px', boxSizing: 'border-box', marginBottom: '8px' }} />

                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <input type='number' value={l.quantity}
                            onChange={function (e) { setLine(i, 'quantity', e.target.value) }}
                            placeholder='Qty'
                            style={{ flex: 1, padding: '9px 10px', borderRadius: '8px', border: `1px solid ${border}`, fontSize: '13px', boxSizing: 'border-box' }} />
                          <input type='number' value={l.unit_price}
                            onChange={function (e) { setLine(i, 'unit_price', e.target.value) }}
                            placeholder='Unit price'
                            style={{ flex: 1, padding: '9px 10px', borderRadius: '8px', border: `1px solid ${border}`, fontSize: '13px', boxSizing: 'border-box' }} />
                          {lines.length > 1 && (
                            <button type='button' onClick={function () { removeLine(i) }}
                              style={{ flexShrink: 0, display: 'flex', border: `1px solid ${danger}`, background: dangerBg, color: danger, borderRadius: '8px', padding: '9px 11px', cursor: 'pointer' }}>
                              <X size={14} />
                            </button>
                          )}
                        </div>

                        {(Number(l.quantity) > 0 && Number(l.unit_price) > 0) && (
                          <div style={{ fontSize: '11px', color: tealDeep, fontWeight: '700', marginTop: '6px', textAlign: 'right' }}>
                            {money(Number(l.quantity) * Number(l.unit_price))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                <datalist id='order-product-list'>
                  {products.map(function (p) { return <option key={p.id} value={p.name} /> })}
                </datalist>

                <button type='button' onClick={addLine}
                  style={{ width: '100%', marginTop: '8px', border: `1px dashed ${tealDeep}`, background: bg, color: tealDeep, borderRadius: '10px', padding: '12px', fontSize: '12.5px', fontWeight: '700', cursor: 'pointer' }}>
                  + Add another product
                </button>

                {orderTotal > 0 && (
                  <div style={{ marginTop: '10px', padding: '12px 14px', borderRadius: '10px', background: tealMist, border: `1px solid ${tealMist}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: tealDeep }}>Order total</span>
                    <span style={{ fontSize: '17px', fontWeight: '900', color: tealDeep }}>{money(orderTotal)}</span>
                  </div>
                )}
              </div>

              <div>
                <div style={{ fontSize: '12px', fontWeight: '700', color: gray600, marginBottom: '2px' }}>LPO & Documents</div>
                <div style={{ fontSize: '11px', color: gray400, marginBottom: '8px' }}>Attach the LPO, photos, or any supporting document. Max 20MB each.</div>

                <label style={{ display: 'block', border: `2px dashed ${border}`, borderRadius: '10px', padding: '14px', textAlign: 'center', cursor: 'pointer', background: bg }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: tealDeep }}>+ Attach LPO / documents</div>
                  <input type='file' multiple onChange={pickFiles} style={{ display: 'none' }} />
                </label>

                {attachments.length > 0 && (
                  <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {attachments.map(function (file, i) {
                      return (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', padding: '9px 11px', borderRadius: '8px', border: `1px solid ${border}` }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: '12.5px', fontWeight: '700', color: navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
                            <div style={{ fontSize: '10.5px', color: gray400 }}>{fmtSize(file.size)}</div>
                          </div>
                          <button type='button' onClick={function () { removeFile(i) }}
                            style={{ flexShrink: 0, border: `1px solid ${danger}`, background: dangerBg, color: danger, borderRadius: '7px', padding: '5px 9px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}>
                            Remove
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              <Inp label='Notes' value={form.notes} onChange={function (v) { f('notes', v) }} placeholder='Anything the approver should know' />
            </div>

            {uploadStatus && (
              <div style={{ marginTop: '14px', padding: '9px 11px', borderRadius: '8px', background: tealMist, border: `1px solid ${tealMist}`, fontSize: '12px', color: tealDeep, fontWeight: '600' }}>
                {uploadStatus}
              </div>
            )}
      </Modal>

      <Modal show={!!openOrder} onClose={function () { setOpenOrder(null) }} sheet wide title={openOrder ? (<>
          <div>{openOrder.customer_name}</div>
          <div style={{ fontSize: '10.5px', color: gray400, fontFamily: 'monospace', fontWeight: '600', marginTop: '2px' }}>{openOrder.order_ref}</div>
        </>) : null}>
          {openOrder && (
            <div style={{ margin: '-20px -24px', background: bg, padding: '18px 20px' }}>

              <div style={{ background: 'white', border: `1px solid ${border}`, borderRadius: '10px', padding: '14px', marginBottom: '12px' }}>
                <div style={{ fontSize: '10.5px', fontWeight: '800', color: gray500, letterSpacing: '0.04em', marginBottom: '10px' }}>PIPELINE</div>
                {PIPELINE.map(function (stage, i) {
                  const currentIdx = PIPELINE.indexOf(openOrder.status)
                  const done = currentIdx > i
                  const active = openOrder.status === stage
                  const rejected = openOrder.status === 'rejected'
                  return (
                    <div key={stage} style={{ display: 'flex', gap: '12px', paddingBottom: i === PIPELINE.length - 1 ? 0 : '16px', position: 'relative' }}>
                      {i < PIPELINE.length - 1 && (
                        <div style={{ position: 'absolute', left: '13px', top: '28px', bottom: '0', width: '2px', background: done ? tealDeep : gray100 }} />
                      )}
                      <div style={{ width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0, zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '800',
                        background: rejected ? gray100 : done ? tealDeep : active ? warning : gray100,
                        color: (done || active) && !rejected ? 'white' : gray400 }}>
                        {done ? <Check size={14} /> : String(i + 1)}
                      </div>
                      <div style={{ flex: 1, paddingTop: '3px' }}>
                        <div style={{ fontSize: '13px', fontWeight: '800', color: active ? navy : gray400 }}>{STAGE_LABEL[stage]}</div>
                        {active && <div style={{ fontSize: '11px', color: warning, fontWeight: '700', marginTop: '2px' }}>Current stage</div>}
                      </div>
                    </div>
                  )
                })}
                {openOrder.status === 'rejected' && (
                  <div style={{ marginTop: '10px', padding: '10px 12px', borderRadius: '8px', background: dangerBg, border: `1px solid ${danger}`, fontSize: '12px', fontWeight: '700', color: danger }}>
                    This order was rejected.
                  </div>
                )}
              </div>

              <div style={{ background: 'white', border: `1px solid ${border}`, borderRadius: '10px', padding: '14px', marginBottom: '12px' }}>
                <div style={{ fontSize: '10.5px', fontWeight: '800', color: gray500, letterSpacing: '0.04em', marginBottom: '10px' }}>ORDER</div>
                <div style={{ fontSize: '12.5px', color: gray600, lineHeight: '1.8' }}>
                  <div><strong>Raised by:</strong> {openOrder.created_by_name}{openOrder.created_by_title ? ' · ' + openOrder.created_by_title : ''}</div>
                  <div><strong>Approver:</strong> {openOrder.approver_name || 'Not set'}</div>
                  {(watchersByOrder[openOrder.id] || []).length > 0 && (
                    <div><strong>Copied:</strong> {(watchersByOrder[openOrder.id] || []).map(function (w) { return w.watcher_name }).join(', ')}</div>
                  )}
                  {openOrder.customer_contact && <div><strong>Contact:</strong> {openOrder.customer_contact}</div>}
                  {openOrder.customer_address && <div><strong>Deliver to:</strong> {openOrder.customer_address}</div>}
                  {terrName(openOrder.territory_id) && <div><strong>Territory:</strong> {terrName(openOrder.territory_id)}</div>}
                  {locName(openOrder.location_id) && <div><strong>Fulfil from:</strong> {locName(openOrder.location_id)}</div>}
                </div>
                {openOrder.notes && (
                  <div style={{ marginTop: '10px', padding: '10px 12px', borderRadius: '8px', background: bg, fontSize: '12.5px', color: gray600, lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                    {openOrder.notes}
                  </div>
                )}
              </div>

              <div style={{ background: 'white', border: `1px solid ${border}`, borderRadius: '10px', padding: '14px', marginBottom: '12px' }}>
                <div style={{ fontSize: '10.5px', fontWeight: '800', color: gray500, letterSpacing: '0.04em', marginBottom: '10px' }}>LINE ITEMS</div>
                {(itemsByOrder[openOrder.id] || []).map(function (i) {
                  return (
                    <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', padding: '9px 0', borderBottom: `1px solid ${gray100}` }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: navy }}>{i.product_name}</div>
                        <div style={{ fontSize: '11.5px', color: gray400 }}>{i.quantity} × {money(i.unit_price)}</div>
                      </div>
                      <div style={{ fontSize: '13px', fontWeight: '800', color: navy, flexShrink: 0 }}>
                        {money(i.quantity * i.unit_price)}
                      </div>
                    </div>
                  )
                })}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '12px' }}>
                  <span style={{ fontSize: '12.5px', fontWeight: '800', color: gray500 }}>TOTAL</span>
                  <span style={{ fontSize: '19px', fontWeight: '900', color: tealDeep }}>{money(openOrder.total_value)}</span>
                </div>
              </div>

              {(filesByOrder[openOrder.id] || []).length > 0 && (
                <div style={{ background: 'white', border: `1px solid ${border}`, borderRadius: '10px', padding: '14px', marginBottom: '12px' }}>
                  <div style={{ fontSize: '10.5px', fontWeight: '800', color: gray500, letterSpacing: '0.04em', marginBottom: '10px' }}>
                    LPO & DOCUMENTS ({(filesByOrder[openOrder.id] || []).length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {(filesByOrder[openOrder.id] || []).map(function (file) {
                      const isImage = file.file_type && file.file_type.indexOf('image/') === 0
                      return (
                        <a key={file.id} href={file.file_url} target='_blank' rel='noreferrer'
                          style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 11px', borderRadius: '8px', border: `1px solid ${border}`, background: bg, textDecoration: 'none' }}>
                          {isImage ? (
                            <div style={{ width: '38px', height: '38px', borderRadius: '6px', flexShrink: 0, background: 'url(' + file.file_url + ') center/cover', border: `1px solid ${border}` }} />
                          ) : (
                            <div style={{ width: '38px', height: '38px', borderRadius: '6px', flexShrink: 0, background: navy, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: '800' }}>
                              LPO
                            </div>
                          )}
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: '12.5px', fontWeight: '700', color: navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.file_name}</div>
                            <div style={{ fontSize: '10.5px', color: gray400 }}>{fmtSize(file.file_size)} · Tap to open</div>
                          </div>
                        </a>
                      )
                    })}
                  </div>
                </div>
              )}

              {events.length > 0 && (
                <div style={{ background: 'white', border: `1px solid ${border}`, borderRadius: '10px', padding: '14px', marginBottom: '12px' }}>
                  <div style={{ fontSize: '10.5px', fontWeight: '800', color: gray500, letterSpacing: '0.04em', marginBottom: '10px' }}>AUDIT TRAIL</div>
                  {events.map(function (ev) {
                    return (
                      <div key={ev.id} style={{ padding: '8px 0', borderBottom: `1px solid ${gray100}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                          <span style={{ fontSize: '12.5px', fontWeight: '700', color: navy, textTransform: 'capitalize' }}>
                            {STAGE_LABEL[ev.event_type] || ev.event_type}
                          </span>
                          <span style={{ fontSize: '10.5px', color: gray400, flexShrink: 0 }}>{fmtStamp(ev.created_at)}</span>
                        </div>
                        <div style={{ fontSize: '11.5px', color: gray500, marginTop: '2px' }}>by {ev.actor_name}</div>
                        {ev.note && <div style={{ fontSize: '12px', color: gray600, marginTop: '4px', fontStyle: 'italic' }}>{ev.note}</div>}
                      </div>
                    )
                  })}
                </div>
              )}

              {openOrder.status !== 'delivered' && openOrder.status !== 'rejected' && (
                <div style={{ background: 'white', border: `1px solid ${border}`, borderRadius: '10px', padding: '14px' }}>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: gray600, marginBottom: '8px' }}>Add a note (optional)</div>
                  <textarea value={actionNote} onChange={function (e) { setActionNote(e.target.value) }} rows={2}
                    placeholder='Recorded against whatever you do next...'
                    style={{ width: '100%', padding: '12px', borderRadius: '8px', border: `1px solid ${border}`, fontSize: '13px', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', marginBottom: '10px' }} />

                  {canApprove(openOrder) && (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={function () { act(openOrder, 'rejected', { approval_note: actionNote || null }) }} disabled={acting}
                        style={{ flex: 1, padding: '12px', borderRadius: '10px', border: 'none', background: dangerBg, color: danger, fontSize: '13px', fontWeight: '800', cursor: 'pointer' }}>
                        Reject
                      </button>
                      <button onClick={function () { act(openOrder, 'approved', { approved_at: new Date().toISOString(), approval_note: actionNote || null }) }} disabled={acting}
                        style={{ flex: 2, padding: '12px', borderRadius: '10px', border: 'none', background: tealDeep, color: 'white', fontSize: '13px', fontWeight: '800', cursor: 'pointer' }}>
                        {acting ? 'Working...' : 'Approve Order'}
                      </button>
                    </div>
                  )}

                  {openOrder.status === 'submitted' && !canApprove(openOrder) && (
                    <div style={{ padding: '12px 14px', borderRadius: '8px', background: bg, fontSize: '12px', color: gray500, textAlign: 'center' }}>
                      Waiting on <strong>{openOrder.approver_name}</strong> to approve.
                    </div>
                  )}

                  {openOrder.status === 'approved' && (
                    <TealBtn onClick={function () { act(openOrder, 'processing', null) }} style={{ width: '100%', padding: '12px' }}>
                      {acting ? 'Working...' : 'Send to Warehouse'}
                    </TealBtn>
                  )}

                  {openOrder.status === 'processing' && (
                    <TealBtn onClick={function () { act(openOrder, 'dispatched', { dispatched_at: new Date().toISOString() }) }} style={{ width: '100%', padding: '12px' }}>
                      {acting ? 'Working...' : 'Mark Dispatched'}
                    </TealBtn>
                  )}

                  {openOrder.status === 'dispatched' && (
                    <TealBtn onClick={function () { act(openOrder, 'delivered', { delivered_at: new Date().toISOString() }) }} style={{ width: '100%', padding: '12px' }}>
                      {acting ? 'Working...' : 'Mark Delivered'}
                    </TealBtn>
                  )}
                </div>
              )}

              {openOrder.status === 'delivered' && (
                <div style={{ padding: '14px', borderRadius: '10px', background: tealMist, border: `1px solid ${tealMist}`, textAlign: 'center' }}>
                  <div style={{ fontSize: '13px', fontWeight: '800', color: tealDeep }}>Delivered</div>
                  <div style={{ fontSize: '11.5px', color: tealDeep, marginTop: '2px' }}>{fmtStamp(openOrder.delivered_at)}</div>
                </div>
              )}

              <div style={{ marginTop: '14px', fontSize: '10.5px', color: gray400, textAlign: 'center', lineHeight: '1.6' }}>
                Every action on this order is permanently logged with who did it and when.
              </div>
            </div>
          )}
      </Modal>
    </div>
  )
}
