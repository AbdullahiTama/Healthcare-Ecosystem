import { useState, useEffect, Component } from 'react'
import {
  Pause, Clock, CreditCard, Camera, ShoppingCart,
  Minus, Plus, Printer, Trash2, Play, CheckCircle,
  DollarSign, Repeat, Divide, Search, Package, PackageX, Clipboard,
} from 'lucide-react'
import { saleRepository } from './repositories'
// Credit sales raise and settle debts. That aggregate belongs to the debts
// module, so its repository is used here rather than a second copy of the
// query shape living in POS.
import { debtRepository } from '../debts/repositories'
// Receipt/currency/tax configuration belongs to the settings module; the
// receipt printer reads it through that module's repository.
import { settingsRepository } from '../settings/repositories'
// Cross-aggregate reads owned by modules that have not adopted the repository
// seam yet (clients, consultations).
import { getClients, getLatestConsultation } from '../../services/supabase'
import { fmt, genId, todayDate, nowStr } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { Card, Modal, ConfirmDialog, Pill, GhostBtn, TealBtn, DarkBtn, Inp, Sel, Avatar, Toast, useToast, Empty, Loading } from '../../components/ui'
import { useBreakpoint } from '../../hooks/useBreakpoint'

const { tealDeep, tealMist, bg, navy, gray600, gray500, gray400, gray100, border, danger, dangerBg, warning, warningBg, success } = theme

// One icon per product tile — a Clipboard for services, a Package for stock
// goods. Replaces the per-product emoji so the counter grid reads as one clean
// system (matches the dashboard template's icon-tile treatment).
const productIcon = (p) => ((p.cat || p.category) === 'Services' ? Clipboard : Package)

const PAYMENT_METHODS = [
  ['Cash', DollarSign], ['Transfer', Repeat], ['POS', CreditCard], ['Split', Divide], ['Credit', Clock],
]

// Catches any crash inside the POS page and shows the real error message on
// screen (in red) instead of a blank white page — added because there's no
// way to open a browser console on mobile, so a silent crash was impossible
// to diagnose. Purely a safety net: it doesn't change any POS behavior when
// nothing is broken.
class POSErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('POS crashed:', error, info) }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, fontFamily: 'monospace' }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: '#dc2626', marginBottom: 10 }}>
            POS page crashed — screenshot this and send it:
          </div>
          <div style={{ padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#7f1d1d', fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {String(this.state.error?.message || this.state.error)}
            {this.state.error?.stack ? '\n\n' + this.state.error.stack : ''}
          </div>
          <button onClick={() => this.setState({ error: null })}
            style={{ marginTop: 14, padding: '10px 16px', borderRadius: 8, border: 'none', background: '#0f766e', color: 'white', fontWeight: 700 }}>
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default function POS(props) {
  return <POSErrorBoundary><POSInner {...props} /></POSErrorBoundary>
}

function POSInner({ brand, products, setProducts, role, perms }) {
  const [view, setView] = useState('pos') // pos | held | recent | credit
  const [cart, setCart] = useState([])
  const [client, setClient] = useState('Walk-in')
  const [method, setMethod] = useState('Cash')
  const [cash, setCash] = useState('')
  const [disc, setDisc] = useState('')
  const [discPct, setDiscPct] = useState(false)
  const [filter, setFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [receipt, setReceipt] = useState(null)
  const [scanning, setScanning] = useState(false)
  // Out-of-stock products are hidden from the sellable grid; the badge under
  // the category pills opens a bottom sheet listing them so staff can see what
  // is unavailable without clogging the counter (mobile-focused issue #5).
  const [showOutOfStock, setShowOutOfStock] = useState(false)
  const [settings, setSettings] = useState(null)
  const [todaySales, setTodaySales] = useState([])
  const [heldSales, setHeldSales] = useState([])
  const [creditSales, setCreditSales] = useState([])
  const [allSales, setAllSales] = useState([])
  const [loadingSales, setLoadingSales] = useState(false)
  // Split payment
  const [splitAmounts, setSplitAmounts] = useState({ Cash: '', Transfer: '', POS: '' })
  // Credit
  const [creditAmountPaid, setCreditAmountPaid] = useState('')
  // Hold note
  const [holdNote, setHoldNote] = useState('')
  const [showHoldModal, setShowHoldModal] = useState(false)
  const [deleteHeldTarget, setDeleteHeldTarget] = useState(null)
  // The held-sale row resumed into the current cart, if any — removed (soft
  // deleted) the moment this cart is actually charged, so held sales never
  // linger as phantom rows after completion (#17).
  const [resumedSaleId, setResumedSaleId] = useState(null)
  const [clients, setClients] = useState([])
  const { msg: toastMsg, type: toastType, actionLabel: toastActionLabel, onAction: toastOnAction, show: showToast } = useToast()
  const { isMobile } = useBreakpoint()

  const cats = ['All', ...Array.from(new Set(products.map(p => p.cat)))]
  const visible = products.filter(p =>
    (filter === 'All' || p.cat === filter) &&
    ((p.name || '').toLowerCase().includes(search.toLowerCase()) || (p.generic_name || p.genericName || '').toLowerCase().includes(search.toLowerCase()))
  )
  // Services are always sellable; stock goods only when stock > 0. Anything
  // else is collected for the Out-of-Stock sheet instead of the grid.
  const isService = p => (p.cat || p.category) === 'Services'
  const sellable = visible.filter(p => isService(p) || p.stock > 0)
  const outOfStock = visible.filter(p => !isService(p) && p.stock <= 0)

  useEffect(() => {
    if (brand?.id) {
      settingsRepository.get(brand.id).then(s => setSettings(s))
      getClients(brand.id).then(c => setClients(c || [])).catch(() => {})
      loadSalesData()
    }
  }, [brand?.id])

  async function loadSalesData() {
    setLoadingSales(true)
    try {
      const [today, all] = await Promise.all([saleRepository.getToday(brand.id), saleRepository.getAll(brand.id)])
      setTodaySales(today || [])
      setAllSales(all || [])
      setHeldSales((all || []).filter(s => s.is_on_hold))
      setCreditSales((all || []).filter(s => s.is_credit && s.balance > 0))
    } catch (e) {}
    setLoadingSales(false)
  }

  // Cart operations
  const add = p => {
    const f = cart.find(c => c.id === p.id)
    if (f) setCart(cart.map(c => c.id === p.id ? { ...c, qty: c.qty + 1 } : c))
    else setCart([...cart, { ...p, qty: 1 }])
  }
  const rmv = id => setCart(cart.filter(c => c.id !== id))
  const setQty = (id, v) => { const n = parseInt(v) || 0; if (n <= 0) rmv(id); else setCart(cart.map(c => c.id === id ? { ...c, qty: n } : c)) }

  const sub = cart.reduce((s, c) => s + c.price * c.qty, 0)
  const discAmt = disc ? (discPct ? Math.round(sub * parseFloat(disc) / 100) : parseFloat(disc) || 0) : 0
  const total = Math.max(0, sub - discAmt)
  const change = method === 'Cash' && cash ? parseFloat(cash) - total : 0
  const splitTotal = method === 'Split' ? Object.values(splitAmounts).reduce((s, v) => s + (parseFloat(v) || 0), 0) : 0

  // When the typed client name matches a saved client, the sale and any debt
  // it creates get linked to that client's record (customer database).
  function resolveClientId(name) {
    const match = clients.find(c => c.full_name === name)
    return match?.id || null
  }

  // Tags each cart line with whether it was recommended on this client's most
  // recent consultation (source: 'recommended') or sold as a walk-in ('walk-in').
  // Fail-safe: any error (offline, no client, no consultation) → all walk-in.
  async function tagItems(clientId) {
    const recIds = new Set()
    if (clientId) {
      try {
        const latest = await getLatestConsultation(clientId)
        ;(latest?.recommended_products || []).forEach(p => recIds.add(p.id))
      } catch (e) {}
    }
    return cart.map(i => ({ ...i, source: recIds.has(i.id) ? 'recommended' : 'walk-in' }))
  }

  // A completed sale closes the loop on a resumed held sale: the original
  // held row is soft-deleted so it can't be resumed twice or linger in the
  // sales list as a phantom "resumed" entry.
  async function finishResumedSale() {
    if (!resumedSaleId) return
    try { await saleRepository.update(resumedSaleId, brand.id, { is_on_hold: false, status: 'deleted' }) } catch (e) {}
    setResumedSaleId(null)
  }

  // The repository decides whether the sale reaches the database or the offline
  // queue; the page only reports what happened. A queued-on-error sale stays
  // silent, exactly as before — the cashier is told nothing failed because
  // nothing was lost.
  async function saveSale(saleData) {
    const { queued, reason } = await saleRepository.create(brand.id, saleData)
    if (queued && reason === 'offline') {
      showToast('Sale saved offline — will sync when connected', { type: 'info' })
    }
  }

  async function charge() {
    if (!cart.length) return
    if (method === 'Split' && splitTotal < total) { showToast('Split amounts do not add up to total.', { type: 'warning' }); return }
    const txnNo = genId('TXN')
    const clientName = client || 'Walk-in'
    const clientId = resolveClientId(clientName)
    const items = await tagItems(clientId)
    const amtPaid = method === 'Cash' ? parseFloat(cash) || total : method === 'Split' ? splitTotal : total
    const balance = Math.max(0, total - amtPaid)
    const isShortfall = amtPaid < total && method !== 'Credit'

    const saleData = {
      txn_no: txnNo,
      client_id: clientId,
      client_name: clientName,
      items: JSON.stringify(items),
      subtotal: sub,
      discount: discAmt,
      total,
      payment_method: method,
      payment_split: method === 'Split' ? JSON.stringify(splitAmounts) : null,
      amount_paid: amtPaid,
      balance: balance,
      is_credit: isShortfall,
      is_on_hold: false,
    }

    const receiptData = {
      id: txnNo,
      client: clientName,
      items,
      subtotal: sub,
      disc: discAmt,
      total,
      method,
      cashGiven: parseFloat(cash) || 0,
      splitAmounts: method === 'Split' ? { ...splitAmounts } : null,
      balance,
    }

    setReceipt(receiptData)
    setProducts(prev => prev.map(p => {
      const s = cart.find(c => c.id === p.id)
      return s && (p.cat || p.category) !== 'Services' ? { ...p, stock: Math.max(0, p.stock - s.qty) } : p
    }))
    await saveSale(saleData)
    await finishResumedSale()

    // AUTO-CREATE DEBT if amount paid is less than total
    if (balance > 0 && brand?.id) {
      const isWalkIn = clientName === 'Walk-in'
      await debtRepository.recordUnderpayment({
        businessId: brand.id,
        direction: 'owes_us',
        clientId,
        partyName: isWalkIn ? 'Walk-in — ' + txnNo : clientName,
        amount: total,
        amountPaid: amtPaid,
        description: (isShortfall && !isWalkIn ? 'Shortfall on sale' : isWalkIn ? 'Sale shortfall' : 'Credit sale')
          + ' — TXN: ' + txnNo + ' | Items: ' + cart.map(i => i.name + ' x' + i.qty).join(', '),
        source: 'credit_sale',
        sourceRef: txnNo,
      })
      if (!isWalkIn) showToast('Sale saved! ₦' + balance.toLocaleString() + ' debt recorded for ' + clientName, { type: 'success' })
    }

    loadSalesData()
  }

  async function chargeCredit() {
    if (!cart.length) return
    const txnNo = genId('TXN')
    const amtPaid = parseFloat(creditAmountPaid) || 0
    const balance = total - amtPaid
    const clientName = client || 'Walk-in'
    const clientId = resolveClientId(clientName)
    const items = await tagItems(clientId)
    const saleData = {
      txn_no: txnNo,
      client_id: clientId,
      client_name: clientName,
      items: JSON.stringify(items),
      subtotal: sub,
      discount: discAmt,
      total,
      payment_method: 'Credit',
      amount_paid: amtPaid,
      balance,
      is_credit: true,
      is_on_hold: false,
    }
    setReceipt({ id: txnNo, client: clientName, items, subtotal: sub, disc: discAmt, total, method: 'Credit', amtPaid, balance })
    // `p.cat` was always undefined here — the column is `category` (Inventory
    // strips `cat` on write), so Services lines were decremented on this path
    // but not in charge(). Both now agree, and both are display-only: the
    // authoritative decrement is the sale_stock_movement trigger.
    setProducts(prev => prev.map(p => { const s = cart.find(c => c.id === p.id); return s && (p.cat || p.category) !== 'Services' ? { ...p, stock: Math.max(0, p.stock - s.qty) } : p }))
    await saveSale(saleData)
    await finishResumedSale()
    // AUTO-CREATE DEBT: credit sale automatically appears in debts as "Owes Us"
    if (balance > 0 && brand?.id) {
      await debtRepository.recordUnderpayment({
        businessId: brand.id,
        direction: 'owes_us',
        clientId,
        partyName: clientName,
        amount: total,
        amountPaid: amtPaid,
        description: 'Credit sale — TXN: ' + txnNo,
        source: 'credit_sale',
        sourceRef: txnNo,
      })
    }
    loadSalesData()
  }

  async function holdSale() {
    if (!cart.length) return
    const txnNo = genId('HLD')
    await saveSale({
      txn_no: txnNo,
      client_name: client || 'Walk-in',
      items: JSON.stringify(cart),
      subtotal: sub,
      discount: discAmt,
      total,
      payment_method: 'On Hold',
      amount_paid: 0,
      balance: total,
      is_credit: false,
      is_on_hold: true,
      notes: holdNote,
    })
    showToast('Sale held — resume it from Held Sales', { type: 'success' })
    setShowHoldModal(false)
    setCart([])
    setClient('Walk-in')
    setHoldNote('')
    loadSalesData()
  }

  function askDeleteHeldSale(sale) {
    // Only Owner can delete held sales
    if (role !== 'Owner') { showToast('Only the Owner can delete held sales', { type: 'warning' }); return }
    setDeleteHeldTarget(sale)
  }
  async function deleteHeldSale() {
    const sale = deleteHeldTarget
    setDeleteHeldTarget(null)
    try {
      await saleRepository.update(sale.id, brand.id, { is_on_hold: false, status: 'deleted' })
      showToast('Held sale deleted.', { type: 'success' })
      loadSalesData()
    } catch (e) { showToast('Could not delete held sale. Please try again.', { type: 'error' }) }
  }

  async function resumeHeld(sale) {
    let items = []
    try { items = JSON.parse(sale.items || '[]') } catch (e) {}
    setCart(items)
    setClient(sale.client_name || 'Walk-in')
    try { await saleRepository.update(sale.id, brand.id, { is_on_hold: false, status: 'resumed' }) } catch (e) {}
    setView('pos')
    setResumedSaleId(sale.id)
    loadSalesData()
  }

  async function collectCredit(sale, amount) {
    const newPaid = (sale.amount_paid || 0) + parseFloat(amount)
    const newBalance = sale.total - newPaid
    await saleRepository.update(sale.id, brand.id, { amount_paid: newPaid, balance: Math.max(0, newBalance), is_credit: newBalance > 0 })
    // AUTO-UPDATE matching debt. The lookup lives in the debt repository —
    // Purchases' mark-paid needs the same one, and both used to fetch every
    // debt in the business and scan it here.
    try {
      const matchDebt = await debtRepository.findOpenBySource('credit_sale', sale.txn_no, brand.id)
      if (matchDebt) {
        await debtRepository.update(matchDebt.id, brand.id, { amount_paid: newPaid, balance: Math.max(0, newBalance), status: newBalance <= 0 ? 'paid' : 'pending' })
      }
    } catch (e) {}
    showToast('Payment collected!', { type: 'success' })
    loadSalesData()
  }

  function newSale() { finishResumedSale(); setReceipt(null); setCart([]); setClient('Walk-in'); setDisc(''); setCash(''); setMethod('Cash'); setSplitAmounts({ Cash: '', Transfer: '', POS: '' }); setCreditAmountPaid('') }

  function printReceipt(r) {
    const biz = brand
    const s = settings || {}
    const w = window.open('', '_blank', 'width=400,height=700')
    const items = r.items || []
    w.document.write(`<!DOCTYPE html><html><head><title>Receipt</title><style>
      *{margin:0;padding:0;box-sizing:border-box;font-family:'Courier New',monospace}
      body{padding:20px;max-width:320px;margin:auto}
      .c{text-align:center}.b{font-weight:bold}
      hr{border:none;border-top:1px dashed #999;margin:8px 0}
      .r{display:flex;justify-content:space-between;margin:3px 0;font-size:12px}
      .logo{font-size:28px;margin-bottom:4px}
    </style></head><body>
      <div class="c">
        ${s.logo_url ? '<img src="' + s.logo_url + '" style="width:60px;height:60px;border-radius:50%;object-fit:cover;margin-bottom:8px" />' : '<div class="logo">🏥</div>'}
        <div class="b" style="font-size:16px">${biz?.name || 'CareHub'}</div>
        ${biz?.address ? '<div style="font-size:11px;color:#666;margin-top:2px">' + biz.address + '</div>' : ''}
        ${biz?.phone ? '<div style="font-size:11px;color:#666">' + biz.phone + '</div>' : ''}
        ${biz?.whatsapp ? '<div style="font-size:11px;color:#666">WhatsApp: ' + biz.whatsapp + '</div>' : ''}
        ${s.receipt_header ? '<div style="font-size:11px;margin-top:4px;font-style:italic">' + s.receipt_header + '</div>' : ''}
      </div>
      <hr/>
      <div class="r"><span>Receipt:</span><span>${r.id}</span></div>
      <div class="r"><span>Date:</span><span>${nowStr()}</span></div>
      <div class="r"><span>Client:</span><span>${r.client}</span></div>
      <hr/>
      ${items.map(i => `<div style="margin-bottom:6px"><div class="b" style="font-size:12px">${i.emoji || ''} ${i.name}</div><div class="r" style="color:#666"><span>${i.qty} x ${fmt(i.price)}</span><span>${fmt(i.price * i.qty)}</span></div></div>`).join('')}
      <hr/>
      <div class="r"><span>Subtotal</span><span>${fmt(r.subtotal)}</span></div>
      ${r.disc > 0 ? '<div class="r" style="color:green"><span>Discount</span><span>-' + fmt(r.disc) + '</span></div>' : ''}
      <div class="r b" style="font-size:15px"><span>TOTAL</span><span>${fmt(r.total)}</span></div>
      <div class="r"><span>Payment</span><span>${r.method}</span></div>
      ${r.method === 'Cash' && r.cashGiven ? '<div class="r"><span>Cash Given</span><span>' + fmt(r.cashGiven) + '</span></div><div class="r" style="color:green"><span>Change</span><span>' + fmt(r.cashGiven - r.total) + '</span></div>' : ''}
      ${r.method === 'Credit' ? '<div class="r" style="color:orange"><span>Amount Paid</span><span>' + fmt(r.amtPaid) + '</span></div><div class="r" style="color:red"><span>Balance Owed</span><span>' + fmt(r.balance) + '</span></div>' : ''}
      ${r.splitAmounts ? '<div style="font-size:11px;margin-top:4px">' + Object.entries(r.splitAmounts).filter(([, v]) => parseFloat(v) > 0).map(([k, v]) => k + ': ' + fmt(parseFloat(v))).join(' | ') + '</div>' : ''}
      <hr/>
      ${s.refund_policy ? '<div style="font-size:10px;color:#666;margin-bottom:6px;text-align:center">' + s.refund_policy + '</div><hr/>' : ''}
      <div class="c" style="font-size:11px;color:#999;margin-top:8px">${s.receipt_footer || 'Thank you for your patronage!'}</div>
    </body></html>`)
    w.document.close()
    setTimeout(() => { w.focus(); w.print() }, 400)
  }

  function startScan() {
    if ('BarcodeDetector' in window) {
      setScanning(true)
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(stream => {
        const video = document.getElementById('pos-cam')
        if (video) { video.srcObject = stream; video.play() }
        const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e'] })
        let found = false
        const interval = setInterval(async () => {
          if (found || !video) return
          try {
            const codes = await detector.detect(video)
            if (codes.length > 0) {
              found = true; clearInterval(interval)
              stream.getTracks().forEach(t => t.stop())
              setScanning(false)
              const code = codes[0].rawValue
              const match = products.find(p => p.barcode === code || (p.name || '').toLowerCase().includes(code.toLowerCase()))
              if (match) {
                if (!isService(match) && match.stock <= 0) { showToast(match.name + ' is out of stock.', { type: 'warning' }); return }
                add(match); showToast('Added: ' + match.name, { type: 'success' })
              }
              else { setSearch(code) }
            }
          } catch (e) {}
        }, 300)
        setTimeout(() => { if (!found) { clearInterval(interval); stream.getTracks().forEach(t => t.stop()); setScanning(false) } }, 15000)
      }).catch(() => { setScanning(false); showToast('Camera access denied. Check your browser permissions and try again.', { type: 'error' }) })
    } else {
      const code = prompt('Enter barcode number:')
      if (code) { const m = products.find(p => (p.name || '').toLowerCase().includes(code.toLowerCase())); if (m) { if (!isService(m) && m.stock <= 0) { showToast(m.name + ' is out of stock.', { type: 'warning' }); return } add(m) } else setSearch(code) }
    }
  }

  // Sell / Held / Recent / Credit tabs — the counter's top-level switch,
  // shared across all four POS views so the active section is always visible
  // (the dashboard template's tabbed treatment). A plain function, not a
  // component, so it never remounts.
  const tabBar = (active) => {
    const tabs = [['pos', 'Sell', null], ['held', 'Held', heldSales.length], ['recent', 'Recent', null], ['credit', 'Credit', creditSales.length]]
    return (
      <div style={{ display: 'flex', gap: 22, borderBottom: `1px solid ${border}` }}>
        {tabs.map(([v, label, count]) => {
          const on = active === v
          return (
            <button key={v} onClick={() => setView(v)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '10px 2px', marginBottom: -1, fontSize: 13, fontWeight: on ? 800 : 600, color: on ? tealDeep : gray600, borderBottom: on ? `2px solid ${tealDeep}` : '2px solid transparent', display: 'flex', alignItems: 'center', gap: 6 }}>
              {label}{count > 0 && <span style={{ background: on ? tealMist : gray100, color: on ? tealDeep : gray500, borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 800 }}>{count}</span>}
            </button>
          )
        })}
      </div>
    )
  }

  // ── RECEIPT VIEW ────────────────────────────────────────────────────────────
  if (receipt) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg, padding: '20px' }}>
      <Card style={{ width: '100%', maxWidth: '380px', overflow: 'hidden' }}>
        <div style={{ padding: '24px', textAlign: 'center', borderBottom: `1px solid ${border}` }}>
          <div style={{ fontSize: 44, marginBottom: 8, color: tealDeep, display: 'flex', justifyContent: 'center' }}><CheckCircle /></div>
          <div style={{ fontSize: '20px', fontWeight: '900' }}>Sale complete!</div>
          <div style={{ fontSize: '12px', color: gray400, marginTop: '4px' }}>#{receipt.id}</div>
        </div>
        <div style={{ padding: '20px' }}>
          {receipt.items.map((it, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '8px' }}>
              <span>{it.emoji || '💊'} {it.name} <span style={{ color: gray400 }}>×{it.qty}</span></span>
              <span style={{ fontWeight: '700' }}>{fmt(it.price * it.qty)}</span>
            </div>
          ))}
          <div style={{ borderTop: `1px dashed ${border}`, marginTop: '12px', paddingTop: '12px' }}>
            {receipt.disc > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: success, marginBottom: '4px' }}><span>Discount</span><span>-{fmt(receipt.disc)}</span></div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '22px', fontWeight: '900' }}><span>TOTAL</span><span style={{ color: tealDeep }}>{fmt(receipt.total)}</span></div>
            {receipt.method === 'Cash' && receipt.cashGiven > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: '700', color: success, marginTop: '6px' }}><span>Change</span><span>{fmt(receipt.cashGiven - receipt.total)}</span></div>
            )}
            {receipt.method === 'Credit' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: warning, marginTop: '4px' }}><span>Paid Now</span><span>{fmt(receipt.amtPaid)}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: danger, fontWeight: '700' }}><span>Balance Owed</span><span>{fmt(receipt.balance)}</span></div>
              </>
            )}
            {receipt.method === 'Split' && receipt.splitAmounts && (
              <div style={{ marginTop: '6px', padding: '8px', borderRadius: '8px', background: bg, fontSize: '12px' }}>
                {Object.entries(receipt.splitAmounts).filter(([, v]) => parseFloat(v) > 0).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{k}</span><span style={{ fontWeight: '700' }}>{fmt(parseFloat(v))}</span></div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button onClick={() => printReceipt(receipt)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '13px', borderRadius: '12px', border: 'none', background: tealDeep, color: 'white', fontWeight: '800', fontSize: '14px', cursor: 'pointer' }}>
            <Printer size={15} /> Print receipt
          </button>
          <button onClick={newSale} style={{ padding: '11px', borderRadius: '12px', border: `1px solid ${border}`, background: 'white', color: gray600, fontWeight: '700', cursor: 'pointer' }}>
            + New sale
          </button>
        </div>
      </Card>
      <Toast msg={toastMsg} type={toastType} actionLabel={toastActionLabel} onAction={toastOnAction} />
    </div>
  )

  // ── HELD SALES VIEW ──────────────────────────────────────────────────────────
  if (view === 'held') return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: bg }}>
      <div style={{ background: 'white', padding: isMobile ? '6px 16px 0' : '8px 24px 0', flexShrink: 0 }}>{tabBar('held')}</div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        {loadingSales ? (
          <Loading text="Loading held sales…" />
        ) : heldSales.length === 0 ? (
          <Empty icon={<Pause size={40} strokeWidth={1.5} />} message="No held sales" />
        ) : heldSales.map(s => {
          let items = []; try { items = JSON.parse(s.items || '[]') } catch (e) {}
          return (
            <Card key={s.id} style={{ padding: '16px', marginBottom: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: '800', fontSize: '15px' }}>{s.client_name || 'Walk-in'}</div>
                  <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{items.length} item(s) · {fmt(s.total)}</div>
                  <div style={{ fontSize: '11px', color: gray400, marginTop: '2px' }}>{s.created_at?.replace('T', ' ').slice(0, 16)}</div>
                  {s.notes && <div style={{ fontSize: '12px', color: gray600, marginTop: '4px', fontStyle: 'italic' }}>Note: {s.notes}</div>}
                  <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {items.map((it, i) => <span key={i} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '6px', background: tealMist, color: tealDeep, fontWeight: '600' }}>{it.name} ×{it.qty}</span>)}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
                  <TealBtn onClick={() => resumeHeld(s)} style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 6 }}><Play size={13} /> Resume sale</TealBtn>
                  {role === 'Owner' && (
                    <button onClick={() => askDeleteHeldSale(s)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: '8px', border: 'none', background: dangerBg, color: danger, fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}>
                      <Trash2 size={12} /> Delete
                    </button>
                  )}
                </div>
              </div>
            </Card>
          )
        })}
      </div>
      <ConfirmDialog show={!!deleteHeldTarget} onClose={() => setDeleteHeldTarget(null)} onConfirm={deleteHeldSale}
        title='Delete this held sale?'
        consequence={`This permanently discards the held sale for ${deleteHeldTarget?.client_name || 'this customer'}. The cart cannot be recovered once deleted.`}
        confirmLabel='Delete' />
      <Toast msg={toastMsg} type={toastType} actionLabel={toastActionLabel} onAction={toastOnAction} />
    </div>
  )

  // ── RECENT SALES VIEW ────────────────────────────────────────────────────────
  if (view === 'recent') return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: bg }}>
      <div style={{ background: 'white', padding: isMobile ? '6px 16px 0' : '8px 24px 0', flexShrink: 0 }}>{tabBar('recent')}</div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        {allSales.filter(s => !s.is_on_hold).slice(0, 50).map(s => {
          let items = []; try { items = JSON.parse(s.items || '[]') } catch (e) {}
          return (
            <Card key={s.id} style={{ padding: '14px', marginBottom: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: '700', fontSize: '14px' }}>{s.client_name || 'Walk-in'}</div>
                  <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{s.txn_no} · {items.length} item(s) · {s.payment_method}</div>
                  <div style={{ fontSize: '11px', color: '#aaa', marginTop: '2px' }}>{s.created_at?.replace('T', ' ').slice(0, 16)}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '16px', fontWeight: '900', color: tealDeep }}>{fmt(s.total)}</div>
                    {s.is_credit && <Pill label='Credit' type='amber' />}
                  </div>
                  <button onClick={() => {
                    const receiptData = { id: s.txn_no, client: s.client_name, items, subtotal: s.subtotal, disc: s.discount, total: s.total, method: s.payment_method, cashGiven: 0 }
                    printReceipt(receiptData)
                  }} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: '8px', border: `1px solid ${border}`, background: 'white', color: gray600, fontWeight: '600', fontSize: '12px', cursor: 'pointer' }}>
                    <Printer size={12} /> Reprint
                  </button>
                </div>
              </div>
            </Card>
          )
        })}
      </div>
      <Toast msg={toastMsg} type={toastType} actionLabel={toastActionLabel} onAction={toastOnAction} />
    </div>
  )

  // ── CREDIT SALES VIEW ────────────────────────────────────────────────────────
  if (view === 'credit') return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: bg }}>
      <div style={{ background: 'white', padding: isMobile ? '6px 16px 0' : '8px 24px 0', flexShrink: 0 }}>{tabBar('credit')}</div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        {creditSales.length === 0 ? (
          <Empty icon={<CreditCard size={40} strokeWidth={1.5} />} message="No outstanding credit sales" />
        ) : creditSales.map(s => (
          <Card key={s.id} style={{ padding: '16px', marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: '800', fontSize: '15px' }}>{s.client_name || 'Walk-in'}</div>
                <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{s.txn_no} · Total: {fmt(s.total)}</div>
                <div style={{ fontSize: '12px', color: success, marginTop: '2px' }}>Paid: {fmt(s.amount_paid || 0)}</div>
                <div style={{ fontSize: '13px', fontWeight: '900', color: danger, marginTop: '2px' }}>Balance: {fmt(s.balance || 0)}</div>
                <div style={{ fontSize: '11px', color: gray400, marginTop: '2px' }}>{s.created_at?.split('T')[0]}</div>
              </div>
              <CollectPayment sale={s} onCollect={collectCredit} />
            </div>
          </Card>
        ))}
      </div>
      <Toast msg={toastMsg} type={toastType} actionLabel={toastActionLabel} onAction={toastOnAction} />
    </div>
  )

  // ── MAIN POS VIEW (Sell tab) ──────────────────────────────────────────────
  const chargeLabel = !cart.length ? 'Add products' : method === 'Credit' ? 'Record credit sale' : 'Charge ' + fmt(total)

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: isMobile ? 'auto' : '100vh', minHeight: '100vh', overflow: isMobile ? 'visible' : 'hidden', background: bg }}>

      {/* Products panel */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: isMobile ? 'visible' : 'hidden' }}>
        {/* Search + scan */}
        <div style={{ padding: isMobile ? '12px 16px 0' : '14px 20px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '0 12px', minWidth: 0 }}>
              <Search size={15} color={gray400} style={{ flexShrink: 0 }} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder='Search products or scan...'
                style={{ flex: 1, border: 'none', outline: 'none', padding: '11px 0', fontSize: 13, background: 'transparent', color: navy, minWidth: 0 }} />
            </div>
            <button onClick={startScan} title='Scan barcode' aria-label='Scan barcode'
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 42, borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: gray600, cursor: 'pointer', flexShrink: 0 }}>
              <Camera size={17} />
            </button>
          </div>

          {/* Category pills */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            {cats.map(c => {
              const on = filter === c
              return (
                <button key={c} onClick={() => setFilter(c)}
                  style={{ padding: '7px 14px', borderRadius: theme.radius.full, border: `1px solid ${on ? tealDeep : border}`, background: on ? tealDeep : 'white', color: on ? 'white' : gray600, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                  {c}
                </button>
              )
            })}
          </div>

          {/* Out-of-stock badge — opens the sheet listing unavailable products */}
          {outOfStock.length > 0 && (
            <button onClick={() => setShowOutOfStock(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, padding: '8px 14px', borderRadius: theme.radius.full, border: `1px solid ${dangerBg}`, background: dangerBg, color: danger, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
              <PackageX size={13} /> Out of Stock ({outOfStock.length})
            </button>
          )}

          {/* Tabs */}
          <div style={{ marginTop: 12 }}>{tabBar('pos')}</div>
        </div>

        {scanning && (
          <div style={{ margin: isMobile ? '12px 16px 0' : '12px 20px 0', borderRadius: theme.radius.lg, overflow: 'hidden', border: `2px solid ${tealDeep}`, position: 'relative', background: 'black', flexShrink: 0 }}>
            <video id='pos-cam' style={{ width: '100%', maxHeight: 180, objectFit: 'cover', display: 'block' }} autoPlay playsInline muted />
            <button onClick={() => { setScanning(false); const v = document.getElementById('pos-cam'); if (v?.srcObject) { v.srcObject.getTracks().forEach(t => t.stop()); v.srcObject = null } }}
              style={{ position: 'absolute', top: 8, right: 8, padding: '4px 10px', borderRadius: 8, border: 'none', background: danger, color: 'white', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>Stop</button>
          </div>
        )}

        {/* Product grid — only sellable items; out-of-stock live in the sheet */}
        <div style={{ flex: 1, overflowY: isMobile ? 'visible' : 'auto', padding: isMobile ? '14px 16px' : '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 12, alignContent: 'start' }}>
          {sellable.length === 0 ? (
            <div style={{ gridColumn: '1 / -1' }}>
              <Empty icon={<Search size={40} strokeWidth={1.5} />} message={outOfStock.length > 0 ? 'All matching products are out of stock.' : 'No products match your search.'} cause="filtered" />
            </div>
          ) : sellable.map(p => {
            const inCart = cart.find(c => c.id === p.id)
            const qty = inCart?.qty || 0
            const service = isService(p)
            const low = !service && p.stock > 0 && p.stock <= (p.reorder_level || 5)
            const Icon = productIcon(p)
            const badge = service ? { t: 'Service', bg: tealMist, fg: tealDeep }
              : low ? { t: p.stock + ' left', bg: warningBg, fg: warning }
              : { t: String(p.stock), bg: gray100, fg: gray500 }
            return (
              <button key={p.id} onClick={() => add(p)}
                style={{ background: 'white', border: `1px solid ${qty > 0 ? tealDeep : border}`, borderRadius: theme.radius.lg, padding: 13, cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: qty > 0 ? '0 2px 10px rgba(15,118,110,0.15)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <div style={{ width: 34, height: 34, borderRadius: theme.radius.md, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon size={17} /></div>
                    {qty > 0 && <div style={{ position: 'absolute', top: -7, right: -7, minWidth: 18, height: 18, padding: '0 4px', borderRadius: 9, background: tealDeep, color: 'white', fontSize: 10, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }}>{qty}</div>}
                  </div>
                  <span style={{ padding: '2px 8px', borderRadius: theme.radius.full, background: badge.bg, color: badge.fg, fontSize: 10.5, fontWeight: 700, flexShrink: 0 }}>{badge.t}</span>
                </div>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: navy, lineHeight: 1.3 }}>{p.name}</div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: navy, marginTop: 4 }}>{fmt(p.price)}</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Cart panel — "Current sale" */}
      <div style={{ width: isMobile ? 'auto' : 340, flexShrink: 0, background: 'white', borderLeft: isMobile ? 'none' : `1px solid ${border}`, borderTop: isMobile ? `1px solid ${border}` : 'none', display: 'flex', flexDirection: 'column', ...(isMobile ? {} : { height: '100vh' }) }}>
        {/* Header + client */}
        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexShrink: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: navy }}>Current sale</div>
          <div style={{ position: 'relative' }}>
            <input list='pos-clients' value={client} onChange={e => setClient(e.target.value)} placeholder='Walk-in'
              style={{ width: 140, padding: '8px 12px', borderRadius: theme.radius.full, border: `1px solid ${border}`, fontSize: 12.5, outline: 'none', boxSizing: 'border-box', background: bg, color: navy }} />
            <datalist id='pos-clients'>
              {clients.map(c => <option key={c.id} value={c.full_name} />)}
            </datalist>
          </div>
        </div>

        {/* Items */}
        <div style={{ flex: 1, overflowY: 'auto', ...(isMobile ? { maxHeight: 320 } : {}) }}>
          {cart.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 160 }}>
              <Empty icon={<ShoppingCart size={40} strokeWidth={1.5} />} message="Cart is empty" action="Tap a product to add it" />
            </div>
          ) : cart.map(item => (
            <div key={item.id} style={{ padding: '12px 16px', borderBottom: `1px solid ${gray100}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                  <div style={{ fontSize: 11.5, color: gray400, marginTop: 1 }}>{fmt(item.price)} each</div>
                </div>
                <div style={{ fontWeight: 800, fontSize: 13, color: navy, flexShrink: 0 }}>{fmt(item.price * item.qty)}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', border: `1px solid ${border}`, borderRadius: theme.radius.md, overflow: 'hidden' }}>
                  <button onClick={() => setQty(item.id, item.qty - 1)} aria-label='Decrease quantity' style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, background: 'white', border: 'none', cursor: 'pointer', color: gray600 }}><Minus size={13} /></button>
                  <input type='number' value={item.qty} onChange={e => setQty(item.id, e.target.value)} style={{ width: 34, textAlign: 'center', padding: '4px 0', border: 'none', borderLeft: `1px solid ${border}`, borderRight: `1px solid ${border}`, fontSize: 13, fontWeight: 700, outline: 'none', color: navy }} />
                  <button onClick={() => setQty(item.id, item.qty + 1)} aria-label='Increase quantity' style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, background: 'white', border: 'none', cursor: 'pointer', color: tealDeep }}><Plus size={13} /></button>
                </div>
                <button onClick={() => rmv(item.id)} aria-label='Remove item' style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', color: gray400, background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>

        {/* Totals + payment + actions */}
        <div style={{ borderTop: `1px solid ${border}`, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, flexShrink: 0 }}>
          {/* Discount */}
          <div style={{ display: 'flex', gap: 6 }}>
            <div style={{ display: 'flex', borderRadius: theme.radius.md, border: `1px solid ${border}`, overflow: 'hidden' }}>
              <button onClick={() => setDiscPct(false)} style={{ padding: '0 11px', border: 'none', cursor: 'pointer', fontWeight: 800, fontSize: 12, background: !discPct ? tealDeep : 'white', color: !discPct ? 'white' : gray500 }}>₦</button>
              <button onClick={() => setDiscPct(true)} style={{ padding: '0 11px', border: 'none', cursor: 'pointer', fontWeight: 800, fontSize: 12, background: discPct ? tealDeep : 'white', color: discPct ? 'white' : gray500 }}>%</button>
            </div>
            <input value={disc} onChange={e => setDisc(e.target.value)} placeholder='Discount'
              style={{ flex: 1, padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 12.5, outline: 'none', background: bg, color: navy, boxSizing: 'border-box' }} />
          </div>

          {/* Summary */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: gray600 }}><span>Subtotal</span><span>{fmt(sub)}</span></div>
            {discAmt > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: danger }}><span>Discount</span><span>−{fmt(discAmt)}</span></div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: navy }}>Total</span>
              <span style={{ fontSize: 21, fontWeight: 900, color: navy }}>{fmt(total)}</span>
            </div>
          </div>

          {/* Payment method chips */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
            {PAYMENT_METHODS.map(([m, Icon]) => {
              const on = method === m
              return (
                <button key={m} onClick={() => setMethod(m)}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '9px 2px', borderRadius: theme.radius.md, border: `1px solid ${on ? tealDeep : border}`, background: on ? tealMist : 'white', color: on ? tealDeep : gray600, cursor: 'pointer', fontWeight: 700 }}>
                  <Icon size={15} /><span style={{ fontSize: 10 }}>{m}</span>
                </button>
              )
            })}
          </div>

          {/* Method-specific inputs */}
          {method === 'Cash' && (
            <div>
              <input type='number' value={cash} onChange={e => setCash(e.target.value)} placeholder='Cash given (₦)'
                style={{ width: '100%', padding: '10px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 12.5, outline: 'none', boxSizing: 'border-box', background: bg, color: navy }} />
              {cash !== '' && <div style={{ fontSize: 11.5, fontWeight: 700, marginTop: 5, color: change >= 0 ? theme.success : danger }}>{change >= 0 ? 'Change: ' + fmt(change) : 'Short: ' + fmt(Math.abs(change))}</div>}
            </div>
          )}
          {method === 'Split' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {['Cash', 'Transfer', 'POS'].map(m => (
                <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, width: 58, color: gray600 }}>{m}</span>
                  <input type='number' value={splitAmounts[m]} onChange={e => setSplitAmounts(prev => ({ ...prev, [m]: e.target.value }))}
                    placeholder='0' style={{ flex: 1, padding: '8px 10px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 12.5, outline: 'none', background: bg, color: navy }} />
                </div>
              ))}
              <div style={{ fontSize: 11.5, fontWeight: 700, color: splitTotal >= total ? theme.success : danger, textAlign: 'right' }}>
                {splitTotal >= total ? 'Balanced' : 'Short: ' + fmt(total - splitTotal)}
              </div>
            </div>
          )}
          {method === 'Credit' && (
            <div>
              <input type='number' value={creditAmountPaid} onChange={e => setCreditAmountPaid(e.target.value)} placeholder='Amount paid now (₦)'
                style={{ width: '100%', padding: '10px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 12.5, outline: 'none', boxSizing: 'border-box', background: bg, color: navy }} />
              {creditAmountPaid !== '' && <div style={{ fontSize: 11.5, fontWeight: 700, marginTop: 5, color: danger }}>Balance owed: {fmt(total - (parseFloat(creditAmountPaid) || 0))}</div>}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowHoldModal(true)} disabled={!cart.length}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '13px 16px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: navy, fontWeight: 700, fontSize: 13, cursor: cart.length ? 'pointer' : 'not-allowed', opacity: cart.length ? 1 : 0.5, flexShrink: 0 }}>
              <Pause size={14} /> Hold
            </button>
            <button onClick={method === 'Credit' ? chargeCredit : charge} disabled={!cart.length}
              style={{ flex: 1, padding: 13, borderRadius: theme.radius.md, border: 'none', background: cart.length ? tealDeep : theme.gray200, color: cart.length ? 'white' : gray400, fontWeight: 800, fontSize: 14, cursor: cart.length ? 'pointer' : 'not-allowed' }}>
              {chargeLabel}
            </button>
          </div>
        </div>
      </div>

      {/* Hold modal */}
      <Modal show={showHoldModal} onClose={() => setShowHoldModal(false)} title='Hold sale'
        footer={<><GhostBtn onClick={() => setShowHoldModal(false)} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={holdSale} style={{ flex: 1, padding: '12px' }}>Hold sale</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ padding: '12px', borderRadius: theme.radius.md, background: bg, fontSize: '13px', color: gray600 }}>
            Cart total: <strong>{fmt(total)}</strong> · {cart.length} item(s) for <strong>{client || 'Walk-in'}</strong>
          </div>
          <Inp label='Note (optional)' value={holdNote} onChange={setHoldNote} placeholder='e.g. Customer coming back in 30 minutes' />
        </div>
      </Modal>

      {/* Out-of-stock sheet — read-only list of products hidden from the grid */}
      <Modal show={showOutOfStock} onClose={() => setShowOutOfStock(false)} title={'Out of stock (' + outOfStock.length + ')'} sheet={isMobile}
        footer={<GhostBtn onClick={() => setShowOutOfStock(false)} style={{ flex: 1 }}>Close</GhostBtn>}>
        <div style={{ fontSize: '12.5px', color: gray500, marginBottom: '12px' }}>
          These products were hidden from the counter. Restock them from Inventory.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {outOfStock.length === 0 ? (
            <Empty icon={<PackageX size={40} strokeWidth={1.5} />} message="No out-of-stock products" />
          ) : outOfStock.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '12px 14px', borderRadius: theme.radius.md, border: `1px solid ${gray100}`, background: 'white' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                <div style={{ fontSize: '11.5px', color: gray400, marginTop: 2 }}>{p.cat || p.category || 'Product'}{p.reorder_level ? ' · reorder at ' + p.reorder_level : ''}</div>
              </div>
              <Pill label='Out of stock' type='red' />
            </div>
          ))}
        </div>
      </Modal>

      <Toast msg={toastMsg} type={toastType} actionLabel={toastActionLabel} onAction={toastOnAction} />
    </div>
  )
}

// Collect payment component for credit sales
function CollectPayment({ sale, onCollect }) {
  const [amount, setAmount] = useState('')
  const [collecting, setCollecting] = useState(false)

  const handleCollect = async () => {
    if (!amount || parseFloat(amount) <= 0) return
    setCollecting(true)
    await onCollect(sale, amount)
    setAmount('')
    setCollecting(false)
  }

  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
      <input type='number' value={amount} onChange={e => setAmount(e.target.value)} placeholder='Amount'
        style={{ width: '90px', padding: '6px 8px', borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '12px', outline: 'none' }} />
      <TealBtn onClick={handleCollect} style={{ padding: '6px 12px', fontSize: '12px' }}>{collecting ? '...' : 'Collect'}</TealBtn>
    </div>
  )
}
