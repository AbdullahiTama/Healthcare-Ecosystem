import { useState, useEffect } from 'react'
import {
  ClipboardList, PackageX, MessageSquare, FileText, Plus, Printer, CheckCircle, Search, X,
} from 'lucide-react'
import {
  getOutOfStock, addOutOfStock, updateOutOfStock,
  getCustomerRequests, addCustomerRequest, updateCustomerRequest,
  getRequisitions, addRequisition, updateRequisition,
  getClients,
} from '../../services/supabase'
import { fmt, todayDate, nowStr } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { Card, StatCard, Modal, Pill, Inp, Textarea, GhostBtn, TealBtn, Loading, Empty, useToast, Toast } from '../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, gray100, border, danger, success, bg } = theme

const blankItem = () => ({ product_name: '', quantity: '', cost: '', unit: 'unit' })

const TABS = [
  ['out', PackageX, 'Out of Stock'],
  ['requests', MessageSquare, 'Customer Requests'],
  ['reqs', FileText, 'Requisitions'],
]

export default function Demand({ brand, role, perms, products }) {
  const [tab, setTab] = useState('out')
  const [loading, setLoading] = useState(true)
  const [outItems, setOutItems] = useState([])
  const [requests, setRequests] = useState([])
  const [requisitions, setRequisitions] = useState([])
  const [clients, setClients] = useState([])

  // Out-of-stock form
  const [showOut, setShowOut] = useState(false)
  const [outForm, setOutForm] = useState({ product_name: '' })
  const [savingOut, setSavingOut] = useState(false)

  // Customer request form
  const [showReq, setShowReq] = useState(false)
  const [reqForm, setReqForm] = useState({})
  const [savingReq, setSavingReq] = useState(false)

  // Requisition form
  const [showReqs, setShowReqs] = useState(false)
  const [reqsForm, setReqsForm] = useState({ items: [blankItem()] })
  const [savingReqs, setSavingReqs] = useState(false)

  const { msg, type, actionLabel, onAction, show: showToast } = useToast()

  useEffect(() => { load() }, [brand?.id])
  useEffect(() => {
    let live = true
    getClients(brand.id).then(c => { if (live) setClients(c || []) }).catch(() => {})
    getOutOfStock(brand.id).then(list => { if (live) setOutItems(list || []) }).catch(() => {})
    return () => { live = false }
  }, [brand?.id])

  async function load() {
    setLoading(true)
    try {
      const [o, r, q] = await Promise.all([
        getOutOfStock(brand.id),
        getCustomerRequests(brand.id),
        getRequisitions(brand.id),
      ])
      setOutItems(o || []); setRequests(r || []); setRequisitions(q || [])
    } catch (e) {}
    setLoading(false)
  }

  // ---- Out of stock ----
  async function saveOut() {
    if (!outForm.product_name.trim()) { showToast('Enter the product name.', { type: 'warning' }); return }
    setSavingOut(true)
    try {
      const match = products.find(p => p.name.toLowerCase() === outForm.product_name.trim().toLowerCase())
      await addOutOfStock({
        business_id: brand.id,
        product_id: match?.id || null,
        product_name: outForm.product_name.trim(),
        notes: outForm.notes || '',
        created_by: role || null,
      })
      showToast('Logged in the out-of-stock book!', { type: 'success' })
      setOutForm({ product_name: '' }); setShowOut(false); load()
    } catch (e) { showToast('Could not save. Please try again.', { type: 'error' }) }
    setSavingOut(false)
  }

  async function fulfillOut(item) {
    try {
      await updateOutOfStock(item.id, { status: 'fulfilled', fulfilled_at: new Date().toISOString() })
      showToast(item.product_name + ' marked as fulfilled', { type: 'success' })
      load()
    } catch (e) { showToast('Could not update. Please try again.', { type: 'error' }) }
  }

  // ---- Customer requests ----
  function pickClient(name) {
    const c = clients.find(x => x.full_name === name)
    setReqForm(p => ({ ...p, client_name: name, client_id: c?.id || null, phone: c?.phone || p.phone || '' }))
  }

  async function saveReq() {
    if (!reqForm.product_name?.trim()) { showToast('Enter the product the customer asked for.', { type: 'warning' }); return }
    setSavingReq(true)
    try {
      await addCustomerRequest({
        business_id: brand.id,
        client_id: reqForm.client_id || null,
        client_name: reqForm.client_name || '',
        phone: reqForm.phone || '',
        product_name: reqForm.product_name.trim(),
        quantity: reqForm.quantity || '',
        notes: reqForm.notes || '',
      })
      showToast('Request logged! Fulfil it when stock arrives.', { type: 'success' })
      setReqForm({}); setShowReq(false); load()
    } catch (e) { showToast('Could not save. Please try again.', { type: 'error' }) }
    setSavingReq(false)
  }

  async function fulfillReq(r) {
    try {
      await updateCustomerRequest(r.id, { status: 'fulfilled' })
      showToast('Request marked as fulfilled!', { type: 'success' })
      load()
    } catch (e) { showToast('Could not update. Please try again.', { type: 'error' }) }
  }

  // ---- Requisitions ----
  const validReqItems = reqsForm.items.filter(i => i.product_name.trim() && (parseFloat(i.cost) > 0))
  const reqTotal = validReqItems.reduce((s, i) => s + (parseFloat(i.quantity) || 0) * parseFloat(i.cost), 0)

  async function saveReqs() {
    if (!reqsForm.supplier?.trim()) { showToast('Enter the supplier name.', { type: 'warning' }); return }
    if (validReqItems.length === 0) { showToast('Add at least one item with a name and cost.', { type: 'warning' }); return }
    setSavingReqs(true)
    try {
      await addRequisition({
        business_id: brand.id,
        supplier_name: reqsForm.supplier.trim(),
        items: JSON.stringify(validReqItems.map(i => ({ product_name: i.product_name.trim(), quantity: i.quantity, cost: i.cost, unit: i.unit || 'unit' }))),
        total: reqTotal,
        notes: reqsForm.notes || '',
      })
      showToast('Requisition saved! Print or mark as sent when ready.', { type: 'success' })
      setReqsForm({ items: [blankItem()] }); setShowReqs(false); load()
    } catch (e) { showToast('Could not save requisition. Please try again.', { type: 'error' }) }
    setSavingReqs(false)
  }

  async function markSent(r) {
    try {
      await updateRequisition(r.id, { status: 'sent' })
      showToast('Requisition marked as sent to ' + r.supplier_name, { type: 'success' })
      load()
    } catch (e) { showToast('Could not update. Please try again.', { type: 'error' }) }
  }

  function printRequisition(r) {
    let items = []
    try { items = JSON.parse(r.items || '[]') } catch (e) {}
    const rows = items.map((i, idx) => (
      '<tr>' +
      '<td>' + (idx + 1) + '</td>' +
      '<td>' + (i.product_name || '') + '</td>' +
      '<td>' + (i.quantity || '') + ' ' + (i.unit || '') + '</td>' +
      '<td align="right">' + fmt(i.cost || 0) + '</td>' +
      '<td align="right">' + fmt((parseFloat(i.quantity) || 0) * (parseFloat(i.cost) || 0)) + '</td>' +
      '</tr>'
    )).join('')
    const w = window.open('', '_blank', 'width=760,height=600')
    w.document.write(
      '<html><head><title>Requisition ' + r.supplier_name + '</title>' +
      '<style>body{font-family:Arial,Helvetica,sans-serif;padding:32px;color:#0f172a}' +
      'h1{font-size:22px;margin:0}h2{font-size:16px;color:#555;font-weight:600;margin:4px 0 0}' +
      '.meta{margin:20px 0;font-size:13px;color:#555}' +
      'table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}' +
      'th{background:#f1f5f9;text-align:left;padding:9px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;color:#64748b}' +
      'td{padding:8px 10px;border-bottom:1px solid #e2e8f0}' +
      '.total{font-size:14px;font-weight:700;margin-top:14px}' +
      '.notes{margin-top:18px;font-size:12px;color:#555}' +
      '.print{margin-top:26px;text-align:right}' +
      '</style></head><body>' +
      '<h1>Requisition</h1><h2>' + (brand?.name || '') + '</h2>' +
      '<div class="meta">Supplier: <strong>' + (r.supplier_name || '') + '</strong><br/>Date: ' + (r.created_at ? new Date(r.created_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) : nowStr()) + '<br/>Status: ' + r.status + '</div>' +
      '<table><thead><tr><th>#</th><th>Product</th><th>Quantity</th><th align="right">Unit Cost</th><th align="right">Total</th></tr></thead><tbody>' +
      rows +
      '</tbody></table>' +
      '<div class="total">Grand Total: ' + fmt(r.total || 0) + '</div>' +
      (r.notes ? '<div class="notes">Notes: ' + r.notes + '</div>' : '') +
      '<div class="print"><em>Generated by CareHub</em></div>' +
      '<script>window.onload = function(){ window.print() }</script>' +
      '</body></html>'
    )
    w.document.close()
    setTimeout(() => { w.focus(); w.print() }, 500)
  }

  const openOut = outItems.filter(i => i.status !== 'fulfilled').length
  const openReq = requests.filter(r => r.status !== 'fulfilled').length
  const draftReqs = requisitions.filter(r => r.status !== 'sent').length

  return (
    <div>
      <SectionHead title='Demand' sub='Out-of-stock book, customer requests and supplier requisitions' btn={tab === 'reqs' ? '+ New Requisition' : tab === 'requests' ? '+ Log Request' : '+ Log Item'} onBtn={() => { if (tab === 'reqs') setShowReqs(true); else if (tab === 'requests') setShowReq(true); else setShowOut(true) }} />

      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {TABS.map(([key, Icon, label]) => {
          const on = tab === key
          return (
            <button key={key} onClick={() => setTab(key)}
              style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 16px', borderRadius: theme.radius.full, border: `1px solid ${on ? tealDeep : border}`, cursor: 'pointer', fontSize: '13px', fontWeight: '700', background: on ? tealDeep : 'white', color: on ? 'white' : gray600 }}>
              <Icon size={15} /> {label}
            </button>
          )
        })}
      </div>

      {tab === 'out' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px', marginBottom: '20px' }}>
            <StatCard icon={<PackageX />} label='Open Items' value={openOut} alert={openOut > 0} />
            <StatCard icon={<CheckCircle />} label='Fulfilled' value={outItems.length - openOut} />
          </div>
          {loading ? <Loading /> : outItems.length === 0 ? (
            <Empty icon={<PackageX size={40} />} message='No out-of-stock items logged' action='+ Log Item' onAction={() => setShowOut(true)} />
          ) : (
            <Card>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${border}`, background: theme.gray50 }}>
                      {['Product', 'Notes', 'Logged By', 'Logged', 'Status', 'Action'].map(h => (
                        <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: gray400, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {outItems.map(i => (
                      <tr key={i.id} style={{ borderBottom: `1px solid ${gray100}`, background: i.status !== 'fulfilled' ? '#fff8f3' : 'white' }}>
                        <td style={{ padding: '12px 14px', fontWeight: '700', fontSize: '13px', color: navy }}>{i.product_name}</td>
                        <td style={{ padding: '12px 14px', fontSize: '12px', color: gray500 }}>{i.notes || '—'}</td>
                        <td style={{ padding: '12px 14px', fontSize: '12px', color: gray500 }}>{i.created_by || '—'}</td>
                        <td style={{ padding: '12px 14px', fontSize: '12px', color: gray400 }}>{i.created_at?.slice(0, 10) || '—'}</td>
                        <td style={{ padding: '12px 14px' }}><Pill label={i.status} type={i.status === 'fulfilled' ? 'green' : 'red'} /></td>
                        <td style={{ padding: '12px 14px' }}>
                          {i.status !== 'fulfilled' && <button onClick={() => fulfillOut(i)} style={{ padding: '6px 12px', borderRadius: theme.radius.sm, border: 'none', background: tealDeep, color: 'white', fontWeight: '700', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>Fulfilled</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === 'requests' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px', marginBottom: '20px' }}>
            <StatCard icon={<MessageSquare />} label='Open Requests' value={openReq} alert={openReq > 0} />
            <StatCard icon={<CheckCircle />} label='Fulfilled' value={requests.length - openReq} />
          </div>
          {loading ? <Loading /> : requests.length === 0 ? (
            <Empty icon={<MessageSquare size={40} />} message='No customer requests yet' action='+ Log Request' onAction={() => setShowReq(true)} />
          ) : (
            <Card>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${border}`, background: theme.gray50 }}>
                      {['Product', 'Customer', 'Phone', 'Qty', 'Notes', 'Status', 'Logged', 'Action'].map(h => (
                        <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: gray400, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map(r => (
                      <tr key={r.id} style={{ borderBottom: `1px solid ${gray100}`, background: r.status !== 'fulfilled' ? '#fff8f3' : 'white' }}>
                        <td style={{ padding: '12px 14px', fontWeight: '700', fontSize: '13px', color: navy }}>{r.product_name}</td>
                        <td style={{ padding: '12px 14px', fontSize: '13px', color: gray600 }}>{r.client_name || 'Walk-in'}</td>
                        <td style={{ padding: '12px 14px', fontSize: '12px', color: gray500 }}>{r.phone || '—'}</td>
                        <td style={{ padding: '12px 14px', fontSize: '12px', color: gray500 }}>{r.quantity || '—'}</td>
                        <td style={{ padding: '12px 14px', fontSize: '12px', color: gray500, maxWidth: '160px' }}>{r.notes || '—'}</td>
                        <td style={{ padding: '12px 14px' }}><Pill label={r.status} type={r.status === 'fulfilled' ? 'green' : 'amber'} /></td>
                        <td style={{ padding: '12px 14px', fontSize: '12px', color: gray400 }}>{r.created_at?.slice(0, 10) || '—'}</td>
                        <td style={{ padding: '12px 14px' }}>
                          {r.status !== 'fulfilled' && <button onClick={() => fulfillReq(r)} style={{ padding: '6px 12px', borderRadius: theme.radius.sm, border: 'none', background: tealDeep, color: 'white', fontWeight: '700', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>Fulfilled</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === 'reqs' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px', marginBottom: '20px' }}>
            <StatCard icon={<FileText />} label='Drafts' value={draftReqs} />
            <StatCard icon={<CheckCircle />} label='Sent to Supplier' value={requisitions.length - draftReqs} />
            <StatCard icon={<ClipboardList />} label='Total Ordered' value={fmt(requisitions.reduce((s, r) => s + (r.total || 0), 0))} />
          </div>
          {loading ? <Loading /> : requisitions.length === 0 ? (
            <Empty icon={<FileText size={40} />} message='No requisitions yet' action='+ New Requisition' onAction={() => setShowReqs(true)} />
          ) : (
            <Card>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${border}`, background: theme.gray50 }}>
                      {['Supplier', 'Items', 'Total', 'Status', 'Created', 'Actions'].map(h => (
                        <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: gray400, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {requisitions.map(r => {
                      let items = []
                      try { items = JSON.parse(r.items || '[]') } catch (e) {}
                      return (
                        <tr key={r.id} style={{ borderBottom: `1px solid ${gray100}` }}>
                          <td style={{ padding: '12px 14px', fontWeight: '700', fontSize: '13px', color: navy }}>
                            {r.supplier_name}
                            <div style={{ fontWeight: '400', fontSize: '11px', color: gray400, marginTop: '2px' }}>{items.map(i => i.product_name).join(', ')}</div>
                          </td>
                          <td style={{ padding: '12px 14px', fontSize: '13px', color: gray600 }}>{items.length} item(s)</td>
                          <td style={{ padding: '12px 14px', fontSize: '13px', fontWeight: '700', color: navy }}>{fmt(r.total || 0)}</td>
                          <td style={{ padding: '12px 14px' }}><Pill label={r.status} type={r.status === 'sent' ? 'green' : 'amber'} /></td>
                          <td style={{ padding: '12px 14px', fontSize: '12px', color: gray400 }}>{r.created_at?.slice(0, 10) || '—'}</td>
                          <td style={{ padding: '12px 14px' }}>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                              <button onClick={() => printRequisition(r)} title='Print or save as PDF' style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 12px', borderRadius: theme.radius.sm, border: `1px solid ${border}`, background: 'white', color: gray600, fontWeight: '700', fontSize: '11px', cursor: 'pointer' }}><Printer size={12} /> PDF</button>
                              {r.status !== 'sent' && <button onClick={() => markSent(r)} style={{ padding: '6px 12px', borderRadius: theme.radius.sm, border: 'none', background: tealDeep, color: 'white', fontWeight: '700', fontSize: '11px', cursor: 'pointer' }}>Mark sent</button>}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Log out-of-stock item */}
      <Modal show={showOut} onClose={() => { setShowOut(false); setOutForm({ product_name: '' }) }} title='Log Out-of-Stock Item'
        footer={<><GhostBtn onClick={() => { setShowOut(false); setOutForm({ product_name: '' }) }} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={saveOut} style={{ flex: 1, padding: '12px' }}>{savingOut ? 'Saving...' : 'Log Item'}</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: '700', color: gray600, marginBottom: '6px' }}>Product Name *</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '0 14px' }}>
              <Search size={15} color={gray400} style={{ flexShrink: 0 }} />
              <input list='demand-products' value={outForm.product_name} onChange={e => setOutForm(p => ({ ...p, product_name: e.target.value }))} placeholder='Start typing or pick from your inventory...'
                style={{ flex: 1, padding: '10px 0', border: 'none', fontSize: '13px', outline: 'none', background: 'transparent', color: navy, minWidth: 0 }} />
              <datalist id='demand-products'>
                {products.map(p => <option key={p.id} value={p.name} />)}
              </datalist>
            </div>
          </div>
          <Textarea label='Notes (optional)' value={outForm.notes} onChange={v => setOutForm(p => ({ ...p, notes: v }))} placeholder='Size, brand or what customers need...' rows={2} />
        </div>
      </Modal>

      {/* Log customer request */}
      <Modal show={showReq} onClose={() => { setShowReq(false); setReqForm({}) }} title='Log Customer Request'
        footer={<><GhostBtn onClick={() => { setShowReq(false); setReqForm({}) }} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={saveReq} style={{ flex: 1, padding: '12px' }}>{savingReq ? 'Saving...' : 'Log Request'}</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: '700', color: gray600, marginBottom: '6px' }}>Customer</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '0 14px' }}>
              <Search size={15} color={gray400} style={{ flexShrink: 0 }} />
              <input list='demand-clients' value={reqForm.client_name || ''} onChange={e => pickClient(e.target.value)} placeholder='Pick a saved client or type a name...'
                style={{ flex: 1, padding: '10px 0', border: 'none', fontSize: '13px', outline: 'none', background: 'transparent', color: navy, minWidth: 0 }} />
              <datalist id='demand-clients'>
                {clients.map(c => <option key={c.id} value={c.full_name} />)}
              </datalist>
            </div>
          </div>
          <Inp label='Product Requested *' value={reqForm.product_name} onChange={v => setReqForm(p => ({ ...p, product_name: v }))} placeholder='e.g. Augmentin 625mg' required />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Inp label='Phone' value={reqForm.phone} onChange={v => setReqForm(p => ({ ...p, phone: v }))} placeholder='08012345678' />
            <Inp label='Quantity' value={reqForm.quantity} onChange={v => setReqForm(p => ({ ...p, quantity: v }))} placeholder='e.g. 1 pack' />
          </div>
          <Textarea label='Notes (optional)' value={reqForm.notes} onChange={v => setReqForm(p => ({ ...p, notes: v }))} placeholder='When they need it, how they asked...' rows={2} />
        </div>
      </Modal>

      {/* New requisition */}
      <Modal show={showReqs} onClose={() => { setShowReqs(false); setReqsForm({ items: [blankItem()] }) }} title='New Requisition'
        footer={<><GhostBtn onClick={() => { setShowReqs(false); setReqsForm({ items: [blankItem()] }) }} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={saveReqs} style={{ flex: 1, padding: '12px' }}>{savingReqs ? 'Saving...' : 'Save Requisition'}</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Inp label='Supplier Name *' value={reqsForm.supplier} onChange={v => setReqsForm(p => ({ ...p, supplier: v }))} placeholder='e.g. MedSupply Ltd' required />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: '700', color: gray500 }}>ITEMS TO ORDER *</span>
              <button onClick={() => setReqsForm(p => ({ ...p, items: [...p.items, blankItem()] }))} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 10px', borderRadius: theme.radius.sm, border: 'none', background: tealMist, color: tealDeep, fontWeight: '700', fontSize: '11px', cursor: 'pointer' }}><Plus size={13} /> Add item</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {reqsForm.items.map((item, i) => {
                const sub = (parseFloat(item.quantity) || 0) * (parseFloat(item.cost) || 0)
                return (
                  <div key={i} style={{ padding: '12px', borderRadius: theme.radius.md, border: `1px solid ${gray100}`, background: bg }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input value={item.product_name} onChange={e => setReqsForm(p => ({ ...p, items: p.items.map((it, idx) => idx === i ? { ...it, product_name: e.target.value } : it) }))} placeholder='Product name e.g. Paracetamol 500mg'
                        style={{ flex: 1, minWidth: 0, padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', outline: 'none', color: navy, background: 'white' }} />
                      <input value={item.quantity} onChange={e => setReqsForm(p => ({ ...p, items: p.items.map((it, idx) => idx === i ? { ...it, quantity: e.target.value } : it) }))} placeholder='Qty'
                        aria-label='Quantity'
                        style={{ width: '64px', padding: '9px 10px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', outline: 'none', color: navy, background: 'white' }} />
                      <input value={item.cost} onChange={e => setReqsForm(p => ({ ...p, items: p.items.map((it, idx) => idx === i ? { ...it, cost: e.target.value } : it) }))} placeholder='Cost ₦'
                        aria-label='Unit cost'
                        style={{ width: '96px', padding: '9px 10px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', outline: 'none', color: navy, background: 'white' }} />
                      <button onClick={() => setReqsForm(p => ({ ...p, items: p.items.filter((_, idx) => idx !== i) }))} aria-label={'Remove ' + (item.product_name || 'item')}
                        style={{ width: '34px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.md, border: 'none', background: 'transparent', color: gray400, cursor: 'pointer' }}>
                        <X size={16} />
                      </button>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginTop: '8px' }}>
                      <input value={item.unit} onChange={e => setReqsForm(p => ({ ...p, items: p.items.map((it, idx) => idx === i ? { ...it, unit: e.target.value } : it) }))} placeholder='unit'
                        aria-label='Unit label'
                        style={{ width: '110px', padding: '6px 10px', borderRadius: theme.radius.sm, border: `1px solid ${border}`, fontSize: '12px', outline: 'none', background: 'white', color: navy }} />
                      <span style={{ fontSize: '12px', fontWeight: '700', color: sub > 0 ? tealDeep : gray400 }}>{sub > 0 ? 'Subtotal: ' + fmt(sub) : '—'}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          <div style={{ padding: '10px 14px', borderRadius: theme.radius.md, background: bg, display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
            <span style={{ color: gray500 }}>Total</span>
            <span style={{ fontWeight: '900', color: navy }}>{fmt(reqTotal)}</span>
          </div>
          <Textarea label='Notes (optional)' value={reqsForm.notes} onChange={v => setReqsForm(p => ({ ...p, notes: v }))} placeholder='Delivery date, terms...' rows={2} />
        </div>
      </Modal>

      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}
