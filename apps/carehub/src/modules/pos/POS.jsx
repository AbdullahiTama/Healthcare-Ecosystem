import { businessDateTime } from '../../lib/businessDay'
import { useState, useEffect, useRef, useMemo, useCallback, useDeferredValue, memo, Component } from 'react'
import { buildProductIndex, searchProducts, findByBarcode as findBarcodeIn, isService } from './productSearch'
import { registerSwitchBlocker } from '../../lib/locationSwitch'
import { useNavigate } from 'react-router-dom'
import {
  Pause, Clock, CreditCard, Camera, ShoppingCart,
  Minus, Plus, Printer, Trash2, Play, CheckCircle,
  DollarSign, Repeat, Divide, Search, Package, PackageX, Clipboard, ReceiptText, ChevronRight, UserPlus, CloudOff, Eye, EyeOff,
} from 'lucide-react'
import { saleRepository, HeldSaleClosedError } from './repositories'
import { usePersistentDraft } from '../../hooks/usePersistentDraft'
import { useAuth } from '../../providers/AuthProvider'
import { blankPosDraft, isPosDraftEmpty, normalizePosDraft, posDraftKey, heldSaleRef, customerRef } from './posDraft'
// Credit sales raise and settle debts. That aggregate belongs to the debts
// module, so its repository is used here rather than a second copy of the
// query shape living in POS.
import { debtRepository } from '../debts/repositories'
// Cross-aggregate reads: clients and consultations adopted the repository seam.
import { clientRepository } from '../clients/repositories'
import { consultationRepository } from '../consultation/repositories'
import { fmt, genId, todayDate, nowStr } from '../../lib/utils'
import { buildReceiptHtml, buildReceiptQrDataUrl, saleToReceipt, heldSaleToInvoice } from './receiptPrint'
import { buildReceiptEscpos } from './receiptEscpos'
import { EscposTransferError, getPairedPrinters, isEscposUsbSupported, printEscpos, requestPrinter } from './escposUsb'
import { theme } from '../../styles/theme'
import { Card, Modal, ConfirmDialog, Pill, GhostBtn, TealBtn, DarkBtn, Inp, Sel, Avatar, Toast, useToast, Empty, ErrorState, Loading, Skeleton } from '../../components/ui'
import { CatalogStatusBanner, loadingLabel } from '../inventory/components/CatalogStatus'
import CreditCollections from './CreditCollections'
import { limitQty, cartStockProblems, stockLimitMessage, cartStockMessage } from './stockLimit'
import CustomerPicker from './CustomerPicker'
import NewCustomerForm from './NewCustomerForm'
import SaleDetailModal from './SaleDetailModal'
import { creditCustomerFor } from './customerPick'
import { unitCost, marginPct, saleCostSummary, readShowCost, writeShowCost } from './costView'
import { isDuplicateError } from '../../lib/dbErrors'
import { startCameraScan } from '../../lib/barcodeScanner'
import { useKeyboardScanner } from '../../hooks/useKeyboardScanner'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useOpenSales, useRecentSales, useSettings, useClients, useCreateClient, useInvalidateSales, useUpsertOpenSale } from '../../hooks/queries'

const { tealDeep, tealMist, bg, navy, gray600, gray500, gray400, gray100, border, danger, dangerBg, warning, warningBg, success } = theme

// One icon per product tile — a Clipboard for services, a Package for stock
// goods. Replaces the per-product emoji so the counter grid reads as one clean
// system (matches the dashboard template's icon-tile treatment).
const productIcon = (p) => ((p.cat || p.category) === 'Services' ? Clipboard : Package)
// Product cards drawn at a time; "Show more" draws the next page.
export const GRID_PAGE = 60

// Strips the transport prefix off a server error so the cashier sees the
// actual reason ("Price override not allowed: ...") instead of the raw
// "Supabase error (403): ..." wrapper.
const cleanServerError = (e) => String(e?.message || e).replace(/^Supabase error \(\d{3}\):\s*/, '')

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
          <div style={{ fontWeight: 800, fontSize: 16, color: theme.danger, marginBottom: 10 }}>
            The POS page crashed. Screenshot this and send it to support:
          </div>
          <div style={{ padding: 12, background: theme.dangerBg, border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, color: theme.danger, fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {String(this.state.error?.message || this.state.error)}
            {this.state.error?.stack ? '\n\n' + this.state.error.stack : ''}
          </div>
          <button onClick={() => this.setState({ error: null })}
            style={{ marginTop: 14, padding: '10px 16px', borderRadius: theme.radius.md, border: 'none', background: theme.tealDeep, color: 'white', fontWeight: 700 }}>
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

// One product on the POS grid. Memoised: typing in the search box redraws only
// the cards whose product or cart quantity changed, not every card.
// `showCost`: the user may see costs and has turned them on (cost and margin under the price).
const ProductCard = memo(function ProductCard({ p, qty, onAdd, showCost = false }) {
  const service = isService(p)
  const low = !service && p.stock > 0 && p.stock <= (p.reorder_level || 5)
  const Icon = productIcon(p)
  const badge = service ? { t: 'Service', bg: tealMist, fg: tealDeep }
    : low ? { t: p.stock + ' left', bg: warningBg, fg: warning }
    : { t: String(p.stock), bg: gray100, fg: gray500 }
  return (
    <div
      style={{ background: 'white', border: `1px solid ${qty > 0 ? tealDeep : border}`, borderRadius: theme.radius.lg, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, boxShadow: qty > 0 ? '0 2px 10px rgba(15,118,110,0.15)' : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{ width: 34, height: 34, borderRadius: theme.radius.full, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon size={17} /></div>
          {qty > 0 && <div style={{ position: 'absolute', top: -7, right: -7, minWidth: 18, height: 18, padding: '0 4px', borderRadius: theme.radius.full, background: tealDeep, color: 'white', fontSize: 10, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }}>{qty}</div>}
        </div>
        <span style={{ padding: '2px 8px', borderRadius: theme.radius.full, background: badge.bg, color: badge.fg, fontSize: 10.5, fontWeight: 700, flexShrink: 0 }}>{badge.t}</span>
      </div>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: navy, lineHeight: 1.3, textTransform: 'uppercase' }}>{p.name}</div>
        <div style={{ fontSize: 14, fontWeight: 900, color: navy, marginTop: 4 }}>{fmt(p.price)}</div>
        {showCost && !service && <CostLine price={p.price} cost={unitCost(p)} />}
      </div>
      <button type='button' onClick={() => onAdd(p)} aria-label={`Add ${p.name}${qty > 0 ? ` (${qty} in sale)` : ''}`}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '8px 0', borderRadius: theme.radius.sm, border: `1px solid ${qty > 0 ? tealDeep : border}`, background: qty > 0 ? tealMist : 'white', color: qty > 0 ? tealDeep : navy, fontWeight: 700, fontSize: 12, cursor: 'pointer', marginTop: 'auto' }}>
        <Plus size={14} /> Add
      </button>
    </div>
  )
})

// Cost and margin of one unit, in a band under the price so it reads at a glance.
// "No cost set" when none is recorded (never a 100% margin).
function CostLine({ price, cost }) {
  const m = marginPct(price, cost)
  return (
    <div data-testid='pos-cost' style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 6, padding: '4px 8px', borderRadius: theme.radius.sm, background: cost == null ? warningBg : bg, fontSize: 11.5 }}>
      {cost == null
        ? <span style={{ color: warning, fontWeight: 700 }}>No cost set</span>
        : <>
            <span style={{ color: gray600 }}>Cost <strong style={{ color: navy, fontWeight: 800 }}>{fmt(cost)}</strong></span>
            {m != null && <span style={{ color: m < 0 ? danger : success, fontWeight: 800 }}>{m}%</span>}
          </>}
    </div>
  )
}

function POSInner({ brand, products, setProducts, role, perms, catalog }) {
  // Catalog load state from BusinessDashboard (inventory/hooks/useProductCatalog.js).
  const catalogStatus = catalog?.status || 'ready'
  const [view, setView] = useState('pos') // pos | held | recent | credit
  // The sale in progress — cart, customer, discount, payment inputs, hold note
  // and the held sale open for editing — is one draft kept on this device
  // (posDraft.js), so leaving the POS, a reload onto a new build or a phone
  // discarding the backgrounded tab never loses it. Scoped per location and
  // per staff member. It is cleared once the sale is charged or held.
  const { auth } = useAuth() || {}
  const draftKey = posDraftKey(brand?.id, auth?.staff?.id)
  const [rawDraft, setDraft, { clear: clearDraft, restoredAt }] = usePersistentDraft(draftKey, blankPosDraft, { isEmpty: isPosDraftEmpty })
  const draft = useMemo(() => normalizePosDraft(rawDraft), [rawDraft])
  // One field of the draft; accepts a value or an updater, like a useState setter.
  const setField = useCallback((name, next) => {
    setDraft(d => {
      const cur = normalizePosDraft(d)
      return { ...cur, [name]: typeof next === 'function' ? next(cur[name]) : next }
    })
  }, [setDraft])
  const { cart, client, method, cash, disc, discPct, splitAmounts, creditAmountPaid, creditMethod, holdNote, resumedSale } = draft
  const setCart = useCallback(v => setField('cart', v), [setField])
  const setClient = useCallback(v => setField('client', v), [setField])
  const setMethod = useCallback(v => setField('method', v), [setField])
  const setCash = useCallback(v => setField('cash', v), [setField])
  const setDisc = useCallback(v => setField('disc', v), [setField])
  const setDiscPct = useCallback(v => setField('discPct', v), [setField])
  const setSplitAmounts = useCallback(v => setField('splitAmounts', v), [setField])
  const setCreditAmountPaid = useCallback(v => setField('creditAmountPaid', v), [setField])
  const setCreditMethod = useCallback(v => setField('creditMethod', v), [setField])
  const setHoldNote = useCallback(v => setField('holdNote', v), [setField])
  const setResumedSale = useCallback(v => setField('resumedSale', v ? heldSaleRef(v) : null), [setField])
  // "Picked up where you left off": shown once for a restored sale, until the
  // cashier dismisses it or the sale is finished.
  const [restoreSeen, setRestoreSeen] = useState(false)
  const showRestored = !!restoredAt && cart.length > 0 && !restoreSeen
  // Products belong to this location. The cart is kept for this location when switching (each location has its own
  // draft), but the cashier is still told it is there before the screen changes.
  useEffect(() => {
    const n = cart.length
    if (n === 0) return undefined
    return registerSwitchBlocker(() => 'Your POS cart has ' + n + (n === 1 ? ' item' : ' items') + '. It stays saved for this location and will be here when you switch back.')
  }, [cart.length])
  // The sale opened from the Recent list (SaleDetailModal).
  const [detailSale, setDetailSale] = useState(null)
  const [filter, setFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [stockFilter, setStockFilter] = useState('All')
  const [expiryFilter, setExpiryFilter] = useState('All')
  const [sortBy, setSortBy] = useState('name_asc')
  const [receipt, setReceipt] = useState(null)
  const [scanning, setScanning] = useState(false)
  const stopScanRef = useRef(null)
  // Out-of-stock products are hidden from the sellable grid; the badge under
  // the category pills opens a bottom sheet listing them so staff can see what
  // is unavailable without clogging the counter (mobile-focused issue #5).
  const [showOutOfStock, setShowOutOfStock] = useState(false)
  // Split amounts, the credit deposit and how it was paid (creditMethod: without
  // it the deposit could not be placed in the cash / transfer / POS totals of
  // the Sales & Accounts report) and the hold note are all part of the draft.
  const [showHoldModal, setShowHoldModal] = useState(false)
  // `resumedSale` (in the draft): the held sale open in the current cart, if
  // any. Its row stays ON HOLD (and listed under Held) while it is edited; it
  // is never released, deleted or counted as a sale. Holding again saves onto
  // it (updateHeld); charging the cart sends `resumed_from`, and the database
  // converts the held row in the same transaction as the new sale.
  // A held sale chosen while another sale is in the cart, waiting for the
  // cashier to confirm the cart may be replaced.
  const [pendingResume, setPendingResume] = useState(null)
  const [printing, setPrinting] = useState(false)
  const [charging, setCharging] = useState(false)
  // Holding is guarded twice: `holding` drives the buttons, and the ref stops a
  // second tap that arrives before React has re-rendered them as disabled.
  // Without it, a double tap on "Hold sale" (or "Hold sale" then "Hold & print
  // invoice") wrote the same held sale two or three times — live data showed
  // identical held sales created 0–1.5 seconds apart.
  const [holding, setHolding] = useState(false)
  const holdingRef = useRef(false)
  const { msg: toastMsg, type: toastType, actionLabel: toastActionLabel, onAction: toastOnAction, show: showToast } = useToast()
  const { isMobile } = useBreakpoint()
  const navigate = useNavigate()
  // Cost price at a glance (POS-Cost-Visibility.md): the Owner, or a role granted "See cost prices at the POS".
  // Shown by default; hiding it (a screen the customer can see) is remembered per business and staff member on this
  // device. Display only.
  const canViewCost = role === 'Owner' || !!perms?.canViewCostPrice
  const costScope = (brand?.id || '') + ':' + (auth?.staff?.id || 'owner')
  const [costOn, setCostOn] = useState(() => readShowCost(costScope))
  useEffect(() => { setCostOn(readShowCost(costScope)) }, [costScope])
  const showCost = canViewCost && costOn
  const toggleCost = () => setCostOn(on => { writeShowCost(costScope, !on); console.info('[pos] cost view', !on ? 'shown' : 'hidden'); return !on })

  // React Query hooks
  const { data: settings } = useSettings(brand?.id)
  const clientsQuery = useClients(brand?.id)
  const clients = clientsQuery.data || []
  // The draft keeps only the picked customer's id and name; their full record
  // (phone, for telling two namesakes apart) comes from the clients list.
  const pickedClient = draft.pickedClient
    ? (clients.find(c => String(c.id) === String(draft.pickedClient.id)) || draft.pickedClient)
    : null
  const createClient = useCreateClient(brand?.id)
  // Held and unpaid credit sales, and the latest completed sales for the
  // Recent tab — targeted reads instead of the whole sales history.
  const { data: openSales = [], isLoading: loadingOpen, isError: openError, refetch: refetchOpen } = useOpenSales(brand?.id)
  const recentQuery = useRecentSales(brand?.id, 50)
  const invalidateSales = useInvalidateSales(brand?.id)
  const loadingSales = loadingOpen

  const heldSales = openSales.filter(s => s.is_on_hold)
  const creditSales = openSales.filter(s => s.is_credit && s.balance > 0)
  const showHeldNow = useUpsertOpenSale(brand?.id)
  // Held sales saved on this device but not yet in the database (offline, or the connection failed): they are in the
  // offline queue, not the server's list, so they are shown from the queue until they sync. Without this a hold made
  // offline vanished from Held Sales until it synced. Re-read after every hold, when the server list changes and
  // when the connection returns.
  const [queueTick, setQueueTick] = useState(0)
  useEffect(() => {
    const bump = () => setQueueTick(t => t + 1)
    window.addEventListener('online', bump)
    return () => window.removeEventListener('online', bump)
  }, [])
  const queuedHeld = useMemo(() => {
    const onServer = new Set(heldSales.map(s => String(s.id)))
    return saleRepository.queuedSales()
      .filter(q => q.is_on_hold && String(q.business_id || brand?.id) === String(brand?.id) && !onServer.has(String(q.id)))
      .map(q => ({ ...q, _queued: true, created_at: q.created_at || null }))
  }, [queueTick, openSales, brand?.id])
  const allHeld = [...queuedHeld, ...heldSales]
  // "Add customer" beside the sale's customer box, for any sale (not only credit).
  const [showAddCustomer, setShowAddCustomer] = useState(false)

  // A restored draft can point at a held sale that was charged since (on this
  // or another till). Holding would then find nothing to save onto, and
  // charging would be refused ("This held sale was already completed"). Once
  // the held list has loaded and that sale is not in it, the cart is kept as a
  // new sale and the cashier is told why.
  const resumedId = resumedSale?.id
  const heldLoaded = !loadingOpen && !openError
  const resumedStillHeld = !resumedId || heldSales.some(s => String(s.id) === String(resumedId))
  useEffect(() => {
    if (!resumedId || !heldLoaded || resumedStillHeld) return
    console.info('[pos] open held sale is no longer on hold; keeping the cart as a new sale', { id: resumedId })
    setResumedSale(null)
    showToast('That held sale was already completed. Your cart is kept as a new sale.', { type: 'info' })
  }, [resumedId, heldLoaded, resumedStillHeld])

  // Product search (productSearch.js). The catalogue is prepared once per
  // change, not per key press. The search box itself updates at once; the
  // grid follows the deferred value, so typing and deleting stay instant while
  // a long list redraws in the background. The box accepts typed text AND
  // barcode scans ("Search products or scan..."), so a barcode matches too.
  const productIndex = useMemo(() => buildProductIndex(products), [products])
  const cats = productIndex.categories
  const deferredSearch = useDeferredValue(search)
  const { sellable, outOfStock } = useMemo(
    () => searchProducts(productIndex, { query: deferredSearch, category: filter, stockFilter, expiryFilter, sortBy }),
    [productIndex, deferredSearch, filter, stockFilter, expiryFilter, sortBy])
  const gridStale = search !== deferredSearch
  // At most a page of cards is drawn: a short query matching most of the
  // catalogue must not build thousands of cards on one key press.
  const [gridLimit, setGridLimit] = useState(GRID_PAGE)
  useEffect(() => { setGridLimit(GRID_PAGE) }, [deferredSearch, filter, stockFilter, expiryFilter, sortBy])
  // One barcode rule for every scan entry point (camera, hardware scanner,
  // fallback prompt): trim only — a stray space from a scanner or a saved
  // label must not break the lookup.
  const findByBarcode = code => findBarcodeIn(productIndex, code)

  // The search box advertises Ctrl+K; nothing implemented it.
  const productSearchRef = useRef(null)
  const focusProductSearch = () => {
    const el = productSearchRef.current
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.focus()
    el.select?.()
  }
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        focusProductSearch()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Cart operations
  // Stable (functional update), so the memoised product cards are not redrawn
  // on every key press.
  // Never more than is on hand (stockLimit.js): adding one more of a product whose units are all in the sale is
  // refused with the quantity available. The check reads the cart as rendered (cartRef) so the toast is shown once,
  // outside the state updater; the updater applies the same limit, so two quick taps can never pass it either.
  // Returns true when a unit was added.
  const cartRef = useRef(cart)
  cartRef.current = cart
  // `baseCart`: the cart the add applies to when it is not the one on screen (a scan first puts the sale back as it
  // was before the scanner typed into a field).
  const add = useCallback((p, baseCart) => {
    const inCart = (baseCart || cartRef.current).find(c => c.id === p.id)?.qty || 0
    const { limited, available } = limitQty(p, inCart + 1)
    if (limited) {
      console.info('[pos] add refused: stock limit', { product: p.id, available, inCart })
      showToast(stockLimitMessage(p.name, available), { type: 'warning' })
      return false
    }
    setCart(cart => cart.some(c => c.id === p.id)
      ? cart.map(c => c.id === p.id ? { ...c, qty: limitQty(p, c.qty + 1).qty } : c)
      : [...cart, { ...p, qty: 1 }])
    return true
  }, [setCart, showToast])
  const qtyInCart = useMemo(() => Object.fromEntries(cart.map(c => [c.id, c.qty])), [cart])
  // Hardware scanners type the code into the focused field and press Enter.
  // When the whole query is a registered barcode, treat it as a scan and add
  // the product exactly like the camera path does; anything else stays a plain
  // text search (Enter never adds an arbitrary name match).
  const onSearchKeyDown = e => {
    if (e.key !== 'Enter') return
    const code = search.trim()
    if (!code) return
    const match = findByBarcode(code)
    if (!match) return
    e.preventDefault()
    if (!isService(match) && match.stock <= 0) { showToast(match.name + ' is out of stock.', { type: 'warning' }); return }
    if (add(match)) showToast('Added: ' + match.name, { type: 'success' })
    setSearch('')
  }

  // A USB scanner types into whichever field has focus. At the till that is
  // often Cash received, Discount, or a cart line's quantity or price, so a
  // scan wrote a 13 digit code into the sale; with a button focused (a product
  // card, Charge), the scanner's Enter pressed it. Every scan on the Sell tab
  // is now taken as a scan, wherever focus is: the sale goes back to how it
  // was before the first scanned key, and the code is looked up exactly like a
  // camera scan (docs/architecture/POS-Barcode-Scanning.md). Open dialogs,
  // free text and fields outside the POS are left alone.
  const posRootRef = useRef(null)
  const ignoreScanKey = (e) => {
    const t = e.target
    const root = posRootRef.current
    if (!root || !t || t.tagName === 'TEXTAREA' || t.isContentEditable) return true
    if (t.closest?.('[role="dialog"], [aria-modal="true"]')) return true
    const editable = t.tagName === 'INPUT' || t.tagName === 'SELECT'
    return editable && !root.contains(t)
  }
  const onScannedCode = (code, snap) => {
    setDraft(() => snap.draft)
    setFilter(snap.filter); setStockFilter(snap.stockFilter); setExpiryFilter(snap.expiryFilter); setSortBy(snap.sortBy)
    const match = findByBarcode(code)
    if (!match) {
      setSearch(code)
      showToast('No product has the barcode ' + code + '.', { type: 'warning' })
      return
    }
    setSearch(snap.inSearch ? '' : snap.search)
    if (!isService(match) && match.stock <= 0) { showToast(match.name + ' is out of stock.', { type: 'warning' }); return }
    if (add(match, normalizePosDraft(snap.draft).cart)) showToast('Added: ' + match.name, { type: 'success' })
  }
  useKeyboardScanner({
    ignore: ignoreScanKey,
    snapshot: (e) => ({ draft: rawDraft, search, filter, stockFilter, expiryFilter, sortBy, inSearch: e.target === productSearchRef.current }),
    onScan: onScannedCode,
  }, { window: true, enabled: view === 'pos' && !receipt })

  const rmv = id => setCart(cart.filter(c => c.id !== id))
  // A typed or stepped quantity above the stock on hand is cut down to what is available, with an alert saying so.
  // Lowering a quantity is always allowed (a line resumed from a held sale may be above the stock now).
  const setQty = (id, v) => {
    const n = parseInt(v) || 0
    if (n <= 0) { rmv(id); return }
    const line = cart.find(c => c.id === id)
    const product = productById.get(id) || line
    const { qty, limited, available } = limitQty(product, n)
    if (limited && n > (line?.qty || 0)) {
      console.info('[pos] quantity limited to stock', { product: id, requested: n, available })
      showToast(stockLimitMessage(product?.name || line?.name || 'This product', available, n), { type: 'warning' })
      if (qty <= 0) return
      setCart(cart.map(c => c.id === id ? { ...c, qty: Math.max(qty, 1) } : c))
      return
    }
    setCart(cart.map(c => c.id === id ? { ...c, qty: n } : c))
  }
  // Brings every line down to the stock on hand (lines with none left are removed).
  const fitCartToStock = () => {
    setCart(cart.flatMap(c => {
      const { qty } = limitQty(productById.get(c.id) || c, c.qty)
      return qty > 0 ? [{ ...c, qty }] : []
    }))
  }
  // One-off unit-price override for a single sale — the vendor can charge a
  // different price for a particular customer without touching the catalog
  // price (which stays in the product's own record). Clearing the field or
  // typing an invalid value falls back to the catalog price, so a line can
  // never be silently zeroed. The override travels into the sale's items JSON,
  // so receipts, reports and debts all reflect what was actually charged.
  const setPrice = (id, v) => {
    const n = parseFloat(v)
    const fallback = products.find(p => p.id === id)?.price || 0
    setCart(cart.map(c => c.id === id ? { ...c, price: isNaN(n) || n <= 0 ? fallback : n } : c))
  }

  const sub = cart.reduce((s, c) => s + c.price * c.qty, 0)
  const discAmt = disc ? (discPct ? Math.round(sub * parseFloat(disc) / 100) : parseFloat(disc) || 0) : 0
  const total = Math.max(0, sub - discAmt)
  // The catalogue's current cost of each cart line (the line itself may predate a cost change).
  const productById = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  // Lines asking for more than is on hand now (stock fell after they were added, or a held sale was resumed).
  const stockProblems = useMemo(() => cartStockProblems(cart, productById), [cart, productById])
  const shortById = useMemo(() => new Map(stockProblems.map(p => [p.id, p])), [stockProblems])
  // Charging is refused while a line is above the stock on hand; the alert says which and how many are available.
  const refuseOverStock = () => {
    if (!stockProblems.length) return false
    console.info('[pos] charge refused: stock limit', stockProblems)
    showToast(cartStockMessage(stockProblems), { type: 'error', duration: 7000 })
    return true
  }
  const lineCost = (item) => unitCost(productById.get(item.id) || item)
  const costSummary = showCost ? saleCostSummary(cart, lineCost, total) : null
  const change = method === 'Cash' && cash ? parseFloat(cash) - total : 0
  const splitTotal = method === 'Split' ? Object.values(splitAmounts).reduce((s, v) => s + (parseFloat(v) || 0), 0) : 0

  // When the typed client name matches a saved client, the sale and any debt
  // it creates get linked to that client's record (customer database).
  // A customer picked in CustomerPicker wins over a name match, so two
  // customers with the same name are never confused.
  // The customer record a sale is linked to: the one picked, or the single client whose name matches what was typed
  // (case and spacing ignored). Two clients with the same name are never guessed between. The link is what counts
  // the sale in the client's visits and total spent.
  function resolveClientId(name) {
    return creditCustomerFor(pickedClient, name, clients)?.id || null
  }

  // The customer a credit sale would be recorded against, or null (blocked).
  const creditCustomer = creditCustomerFor(pickedClient, client, clients)

  function pickCustomer(c) {
    setDraft(d => ({ ...normalizePosDraft(d), pickedClient: customerRef(c), client: c ? c.full_name : 'Walk-in' }))
  }

  async function addCustomer(fields) {
    try {
      const rows = await createClient.mutateAsync(fields)
      const created = Array.isArray(rows) ? rows[0] : rows
      if (!created?.id) throw new Error('The customer was not saved.')
      console.info('[pos] customer added at the till', { id: created.id })
      return created
    } catch (e) {
      console.error('[pos] add customer failed:', e)
      if (isDuplicateError(e)) throw new Error('A customer with this phone number already exists. Search for them instead.')
      throw new Error(cleanServerError(e))
    }
  }

  // Tags each cart line with whether it was recommended on this client's most
  // recent consultation (source: 'recommended') or sold as a walk-in ('walk-in').
  // Fail-safe: any error (offline, no client, no consultation) → all walk-in.
  async function tagItems(clientId) {
    const recIds = new Set()
    if (clientId) {
      try {
        const latest = await consultationRepository.getLatest(clientId)
        ;(latest?.recommended_products || []).forEach(p => recIds.add(p.id))
      } catch (e) {}
    }
    return cart.map(i => ({ ...i, source: recIds.has(i.id) ? 'recommended' : 'walk-in' }))
  }

  // The repository decides whether the sale reaches the database or the offline
  // queue; the page only reports what happened. A queued-on-error sale stays
  // silent, exactly as before — the cashier is told nothing failed because
  // nothing was lost. But when the SERVER rejects the sale (e.g. the
  // guard_sale_item_prices trigger refuses an unauthorized price override),
  // the repository rethrows: the sale must not be parked in the offline queue
  // (it would never sync) nor silently swallowed — the cashier sees the real
  // reason and can act on it.
  async function saveSale(saleData) {
    let result
    try {
      result = await saleRepository.create(brand.id, saleData)
    } catch (e) {
      showToast(cleanServerError(e), { type: 'error' })
      throw e
    }
    if (result.queued && result.reason === 'offline') {
      showToast('Sale saved on this device. It will sync when you reconnect.', { type: 'info' })
    }
    return result
  }

  async function charge() {
    if (!cart.length) return
    if (charging) return
    if (refuseOverStock()) return
    if (method === 'Split' && splitTotal < total) { showToast('Split amounts do not add up to total.', { type: 'warning' }); return }
    setCharging(true)
    try {
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
      ...(resumedSale ? { resumed_from: resumedSale.id } : {}),
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
      amtPaid,
      date: new Date().toISOString(),
    }

    // The sale must be recorded BEFORE the UI advances: if the server rejects
    // it (guard_sale_item_prices — an unauthorized price override), saveSale
    // throws, so the receipt never shows, product state never decrements and
    // no debt is created for a sale that did not happen.
    await saveSale(saleData)
    setReceipt(receiptData)
    setProducts(prev => prev.map(p => {
      const s = cart.find(c => c.id === p.id)
      return s && (p.cat || p.category) !== 'Services' ? { ...p, stock: Math.max(0, p.stock - s.qty) } : p
    }))
    // Recorded: the draft goes at once, so a reload on the receipt screen can
    // never bring back a cart that was already charged. (`cart` below is this
    // call's own copy.)
    clearDraft()

    // AUTO-CREATE DEBT if amount paid is less than total
    if (balance > 0 && brand?.id) {
      const isWalkIn = clientName === 'Walk-in'
      await debtRepository.recordUnderpayment({
        businessId: brand.id,
        direction: 'owes_us',
        clientId,
        partyName: isWalkIn ? 'Walk-in · ' + txnNo : clientName,
        amount: total,
        amountPaid: amtPaid,
        description: (isShortfall && !isWalkIn ? 'Shortfall on sale' : isWalkIn ? 'Sale shortfall' : 'Credit sale')
          + ' · TXN: ' + txnNo + ' | Items: ' + cart.map(i => i.name + ' x' + i.qty).join(', '),
        source: 'credit_sale',
        sourceRef: txnNo,
      })
      if (!isWalkIn) showToast('Sale saved! ₦' + balance.toLocaleString() + ' debt recorded for ' + clientName, { type: 'success' })
    }

    invalidateSales()
    } finally { setCharging(false) }
  }

  async function chargeCredit() {
    if (!cart.length) return
    if (charging) return
    if (refuseOverStock()) return
    setCharging(true)
    try {
    const txnNo = genId('TXN')
    // Every credit sale belongs to a customer record, so the debt can be
    // traced to the right person. The database refuses one without it too.
    const customer = creditCustomer
    if (!customer) { showToast('Select the customer before recording a credit sale.', { type: 'warning' }); return }
    const amtPaid = parseFloat(creditAmountPaid) || 0
    const balance = total - amtPaid
    const clientName = customer.full_name
    const clientId = customer.id
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
      payment_split: amtPaid > 0 ? JSON.stringify({ [creditMethod]: amtPaid }) : null,
      amount_paid: amtPaid,
      balance,
      is_credit: true,
      is_on_hold: false,
      ...(resumedSale ? { resumed_from: resumedSale.id } : {}),
    }
    // Record before advancing the UI — a server rejection (price guard)
    // must not show a receipt, decrement stock state or open a debt for a
    // sale that did not happen.
    await saveSale(saleData)
    setReceipt({ id: txnNo, client: clientName, items, subtotal: sub, disc: discAmt, total, method: 'Credit', amtPaid, balance, date: new Date().toISOString() })
    // `p.cat` was always undefined here — the column is `category` (Inventory
    // strips `cat` on write), so Services lines were decremented on this path
    // but not in charge(). Both now agree, and both are display-only: the
    // authoritative decrement is the sale_stock_movement trigger.
    setProducts(prev => prev.map(p => { const s = cart.find(c => c.id === p.id); return s && (p.cat || p.category) !== 'Services' ? { ...p, stock: Math.max(0, p.stock - s.qty) } : p }))
    clearDraft()
    // AUTO-CREATE DEBT: credit sale automatically appears in debts as "Owes Us"
    if (balance > 0 && brand?.id) {
      await debtRepository.recordUnderpayment({
        businessId: brand.id,
        direction: 'owes_us',
        clientId,
        partyName: clientName,
        amount: total,
        amountPaid: amtPaid,
        description: 'Credit sale · TXN: ' + txnNo,
        source: 'credit_sale',
        sourceRef: txnNo,
      })
    }
    invalidateSales()
    } finally { setCharging(false) }
  }

  // Holds the cart. With `withInvoice`, prints an invoice for the customer once the held sale is saved: the print
  // window is opened first, inside the click, so the browser does not block it as a pop-up.
  async function holdSale(withInvoice = false) {
    if (!cart.length) return
    if (holdingRef.current) return
    holdingRef.current = true
    setHolding(true)
    try {
      await holdCart(withInvoice)
    } finally {
      holdingRef.current = false
      setHolding(false)
    }
  }

  async function holdCart(withInvoice) {
    const txnNo = genId('HLD')
    const invoiceWindow = withInvoice ? openPrintWindow() : null
    if (withInvoice && !invoiceWindow) return
    const clientName = client || 'Walk-in'
    const clientId = resolveClientId(clientName)
    const editing = resumedSale
    // A held sale is validated at insert like any other: if the server
    // rejects it (price guard), saveSale already toasted the reason — keep the
    // cart and the modal intact instead of clearing them.
    try {
      if (editing) {
        // Editing a held sale: save the changes onto the same held row.
        const notes = holdNote || editing.notes || ''
        await saleRepository.updateHeld(editing.id, brand.id, {
          items: cart, subtotal: sub, discount: discAmt, total,
          clientId, clientName, notes,
        })
        const before = heldSales.find(s => String(s.id) === String(editing.id)) || editing
        showHeldNow({ ...before, items: JSON.stringify(cart), subtotal: sub, discount: discAmt, total, balance: total, client_id: clientId, client_name: clientName, notes })
      } else {
        const result = await saveSale({
        txn_no: txnNo,
        client_id: clientId,
        client_name: clientName,
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
        // In Held Sales at once: the saved row from the database, or (offline) the queued copy.
        if (result?.sale) showHeldNow(result.sale)
        else if (result?.queued) console.info('[pos] held sale queued on this device', { txn_no: txnNo, reason: result.reason })
        setQueueTick(t => t + 1)
      }
    } catch (e) {
      invoiceWindow?.close()
      if (editing) reportHeldSaveFailure(e, editing)
      return
    }
    if (invoiceWindow) {
      printInvoice({
        kind: 'invoice', id: editing ? editing.txn_no : txnNo, client: clientName, items: cart,
        subtotal: sub, disc: discAmt, total, amtPaid: 0, balance: total, date: new Date().toISOString(),
        note: holdNote || editing?.notes || '',
      }, invoiceWindow)
    }
    showToast(editing ? 'Held sale updated.' : 'Sale held. Resume it from Held Sales.', { type: 'success' })
    setShowHoldModal(false)
    clearDraft()
    invalidateSales()
  }

  // Saving an edited held sale failed. The cart (the draft) is always kept, so
  // nothing typed is lost; the message says what to do next.
  function reportHeldSaveFailure(e, editing) {
    if (e instanceof HeldSaleClosedError) {
      // Charged since it was opened: nothing to save onto. The cart becomes a
      // new sale, so Hold now creates a new held sale (not a second copy of a
      // live one) and Charge records it normally.
      console.info('[pos] held sale closed before the edit was saved', { id: editing.id })
      setResumedSale(null)
      setShowHoldModal(false)
      showToast('That held sale was already completed, so the changes were not saved onto it. Your cart is kept: hold or charge it as a new sale.', { type: 'warning' })
      invalidateSales()
      return
    }
    console.error('[pos] saving the held sale failed:', e)
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    showToast(offline
      ? 'You are offline, so the held sale was not updated. Your changes are kept on this device: hold again when you are back online.'
      : 'Could not save the changes to this held sale. Your changes are kept: please try again.', { type: 'error' })
  }

  // Opening a held sale loads it into the cart for editing. The held row is
  // left exactly as it is: nothing is released, deleted or recorded as a sale
  // until the cart is charged. A different sale already in the cart is never
  // silently replaced: the cashier confirms first (and can hold it instead).
  function resumeHeld(sale) {
    const sameSale = resumedSale && String(resumedSale.id) === String(sale.id)
    if (cart.length > 0 && !sameSale) { setPendingResume(sale); return }
    openHeld(sale)
  }

  function openHeld(sale) {
    setPendingResume(null)
    if (resumedSale && String(resumedSale.id) === String(sale.id)) { setView('pos'); return }
    let items = []
    try { items = JSON.parse(sale.items || '[]') } catch (e) {}
    setDraft({
      ...blankPosDraft(),
      cart: items,
      client: sale.client_name || 'Walk-in',
      disc: Number(sale.discount) > 0 ? String(sale.discount) : '',
      holdNote: sale.notes || '',
      resumedSale: heldSaleRef(sale),
    })
    setRestoreSeen(true)
    setView('pos')
  }

  function newSale() { setReceipt(null); clearDraft(); setRestoreSeen(false) }

  // Universal fallback path: render an HTML page and let the browser/OS
  // rasterize it via the system print dialog. Always works, but thermal
  // printers print softer than with raw commands.
  function openPrintWindow() {
    const w = window.open('', '_blank', 'width=400,height=700')
    if (!w) showToast('The pop-up was blocked. Allow pop-ups for this site, then print again.', { type: 'warning' })
    return w
  }

  async function legacyPrint(r, win = null) {
    const w = win || openPrintWindow()
    if (!w) return
    // An invoice carries no QR code: it is not proof of payment.
    const qrDataUrl = r.kind === 'invoice' ? null : await buildReceiptQrDataUrl(r, settings || {})
    w.document.write(buildReceiptHtml({ receipt: r, business: brand || {}, settings: settings || {}, qrDataUrl }))
    w.document.close()
    setTimeout(() => { w.focus(); w.print() }, 400)
  }

  // Invoices print through the browser dialog, on A4 or the receipt printer alike: a customer may need it on paper
  // to pay or for approval, and it must never be mistaken for a receipt.
  function printInvoice(r, win = null) {
    legacyPrint({ ...r, kind: 'invoice' }, win)
  }

  // ESC/POS-first. Pairing persists per-origin via navigator.usb.getDevices(),
  // so only the first print ever shows a device picker. The transferOut
  // failure contract prevents a second (browser) print after bytes reached
  // the hardware.
  async function printReceipt(r) {
    if (!isEscposUsbSupported()) { legacyPrint(r); return }
    try {
      let device = (await getPairedPrinters())[0]
      if (!device) device = await requestPrinter()
      if (!device) { legacyPrint(r); return }
      const bytes = buildReceiptEscpos({ receipt: r, business: brand || {}, settings: settings || {} })
      setPrinting(true)
      showToast('Sending to printer…', { type: 'info' })
      try {
        await printEscpos(bytes, device)
        showToast('Receipt printed', { type: 'success' })
      } catch (e) {
        console.error('ESC/POS print failed:', e)
        if (e instanceof EscposTransferError || e?.sent) {
          showToast('The printer accepted the job but stopped partway through printing it. Check the printer and try again.', { type: 'error' })
        } else {
          showToast('Direct printing is unavailable, so the browser print dialog is opening instead.', { type: 'warning' })
          legacyPrint(r)
        }
      } finally {
        setPrinting(false)
      }
    } catch (e) {
      console.error('ESC/POS setup failed:', e)
      legacyPrint(r)
      setPrinting(false)
    }
  }

  function startScan() {
    if ('BarcodeDetector' in window) {
      setScanning(true)
      stopScanRef.current = startCameraScan({
        getVideo: () => document.getElementById('pos-cam'),
        onEnd: () => setScanning(false),
        onError: () => showToast('Camera access denied. Check your browser permissions and try again.', { type: 'error' }),
        onCode: (code) => {
          const match = findByBarcode(code) || products.find(p => (p.name || '').toLowerCase().includes(code.toLowerCase()))
          if (match) {
            if (!isService(match) && match.stock <= 0) { showToast(match.name + ' is out of stock.', { type: 'warning' }); return }
            if (add(match)) showToast('Added: ' + match.name, { type: 'success' })
          }
          else { setSearch(code) }
        },
      })
    } else {
      const code = prompt('Enter barcode number:')
      if (code) {
        const m = findByBarcode(code) || products.find(p => (p.name || '').toLowerCase().includes(code.toLowerCase()))
        if (m) {
          if (!isService(m) && m.stock <= 0) { showToast(m.name + ' is out of stock.', { type: 'warning' }); return }
          if (add(m)) showToast('Added: ' + m.name, { type: 'success' })
        } else setSearch(code)
      }
    }
  }

  // Sell / Held / Recent / Credit tabs — the counter's top-level switch,
  // shared across all four POS views so the active section is always visible
  // (the dashboard template's tabbed treatment). A plain function, not a
  // component, so it never remounts.
  const tabBar = (active) => {
    const tabs = [['pos', 'Sell', null], ['held', 'Held', allHeld.length], ['recent', 'Recent', null], ['credit', 'Credit', creditSales.length]]
    return (
      <div role="tablist" aria-label="POS views" style={{ display: 'flex', gap: 24, borderBottom: `1px solid ${border}` }}>
        {tabs.map(([v, label, count]) => {
          const on = active === v
          return (
            <button key={v} role="tab" aria-selected={on} onClick={() => setView(v)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '10px 2px', marginBottom: -1, fontSize: 13, fontWeight: on ? 800 : 600, color: on ? tealDeep : gray600, borderBottom: on ? `2px solid ${tealDeep}` : '2px solid transparent', display: 'flex', alignItems: 'center', gap: 6 }}>
              {label}{count > 0 && <span style={{ background: on ? tealMist : gray100, color: on ? tealDeep : gray500, borderRadius: theme.radius.full, padding: '1px 7px', fontSize: 11, fontWeight: 800 }}>{count}</span>}
            </button>
          )
        })}
      </div>
    )
  }

  // ── RECEIPT VIEW ────────────────────────────────────────────────────────────
  if (receipt) return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg, padding: '20px' }}>
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
              <div style={{ marginTop: '6px', padding: '8px', borderRadius: theme.radius.md, background: bg, fontSize: '12px' }}>
                {Object.entries(receipt.splitAmounts).filter(([, v]) => parseFloat(v) > 0).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{k}</span><span style={{ fontWeight: '700' }}>{fmt(parseFloat(v))}</span></div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button onClick={() => printReceipt(receipt)} disabled={printing} aria-busy={printing || undefined}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: theme.radius.md, border: 'none', background: tealDeep, color: 'white', fontWeight: '800', fontSize: '14px', cursor: printing ? 'wait' : 'pointer', opacity: printing ? 0.65 : 1 }}>
            <Printer size={15} /> {printing ? 'Sending…' : 'Print receipt'}
          </button>
          <button onClick={newSale} style={{ padding: '12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: gray600, fontWeight: '700', cursor: 'pointer' }}>
            + New sale
          </button>
        </div>
      </Card>
      <Toast msg={toastMsg} type={toastType} actionLabel={toastActionLabel} onAction={toastOnAction} />
    </div>
  )

  // ── HELD SALES VIEW ──────────────────────────────────────────────────────────
  if (view === 'held') return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: bg }}>
      <div style={{ background: 'white', padding: isMobile ? '6px 16px 0' : '8px 24px 0', flexShrink: 0 }}>{tabBar('held')}</div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        {openError && (
          // A failed read must never read as "no held sales": the held sales are still saved.
          <div style={{ marginBottom: 12 }}>
            <ErrorState message="We couldn't load held sales. They are still saved; check your connection and try again." onRetry={() => refetchOpen()} />
          </div>
        )}
        {loadingSales && allHeld.length === 0 ? (
          <Loading text="Loading held sales…" />
        ) : allHeld.length === 0 ? (
          !openError && <Empty icon={<Pause size={40} strokeWidth={1.5} />} message="No held sales" />
        ) : allHeld.map(s => {
          let items = []; try { items = JSON.parse(s.items || '[]') } catch (e) {}
          return (
            <Card key={s.id || s._offline_id} style={{ padding: '16px', marginBottom: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: '800', fontSize: '15px' }}>{s.client_name || 'Walk-in'}</div>
                  <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{items.length} item(s) · {fmt(s.total)}</div>
                  <div style={{ fontSize: '11px', color: gray400, marginTop: '2px' }}>{s._queued ? s.txn_no : businessDateTime(s.created_at)}</div>
                  {s._queued && (
                    <div role='status' style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 6, fontSize: '11.5px', fontWeight: 700, color: theme.warning, background: theme.warningBg, borderRadius: theme.radius.sm, padding: '3px 8px' }}>
                      <CloudOff size={12} aria-hidden='true' /> Saved on this device. It will sync when you are back online.
                    </div>
                  )}
                  {s.notes && <div style={{ fontSize: '12px', color: gray600, marginTop: '4px', fontStyle: 'italic' }}>Note: {s.notes}</div>}
                  <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {items.map((it, i) => <span key={i} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: theme.radius.sm, background: tealMist, color: tealDeep, fontWeight: '600' }}>{it.name} ×{it.qty}</span>)}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
                  {s._queued
                    ? <span style={{ fontSize: '11.5px', color: gray500, maxWidth: 180, textAlign: 'right' }}>Can be opened once it has synced.</span>
                    : <TealBtn onClick={() => resumeHeld(s)} style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 6 }}><Play size={13} /> Open &amp; edit</TealBtn>}
                  <GhostBtn onClick={() => printInvoice(heldSaleToInvoice(s))} aria-label={'Print invoice for ' + (s.client_name || 'Walk-in') + ', ' + fmt(s.total)}
                    style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 6 }}><Printer size={13} aria-hidden='true' /> Print invoice</GhostBtn>
                </div>
              </div>
            </Card>
          )
        })}
      </div>
      <ConfirmDialog show={!!pendingResume} onClose={() => setPendingResume(null)} onConfirm={() => openHeld(pendingResume)}
        title='Replace the current sale?'
        consequence={'The current sale has ' + cart.length + (cart.length === 1 ? ' product' : ' products') + (resumedSale ? ' (unsaved changes to held sale ' + resumedSale.txn_no + ')' : '') + '. Opening this held sale clears it from the cart. To keep it, cancel and hold it first.'}
        confirmLabel='Open held sale' danger={false} />
      <Toast msg={toastMsg} type={toastType} actionLabel={toastActionLabel} onAction={toastOnAction} />
    </div>
  )

  // ── RECENT SALES VIEW ────────────────────────────────────────────────────────
  if (view === 'recent') return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: bg }}>
      <div style={{ background: 'white', padding: isMobile ? '6px 16px 0' : '8px 24px 0', flexShrink: 0 }}>{tabBar('recent')}</div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        {recentQuery.isLoading ? (
          <Loading text="Loading recent sales…" />
        ) : recentQuery.isError ? (
          <ErrorState message="We couldn't load recent sales." onRetry={() => recentQuery.refetch()} />
        ) : (() => {
          const recent = recentQuery.data || []
          if (recent.length === 0) return <Empty icon={<Clipboard size={40} strokeWidth={1.5} />} message="No sales yet" />
          return recent.slice(0, 50).map(s => {
            let items = []; try { items = JSON.parse(s.items || '[]') } catch (e) {}
          return (
            <Card key={s.id} style={{ padding: '14px', marginBottom: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                {/* The whole summary opens the sale in full: items, prices,
                    payments and the receipt. */}
                <button type='button' onClick={() => setDetailSale(s)} aria-label={`View sale ${s.txn_no} for ${s.client_name || 'Walk-in'}`}
                  style={{ flex: '1 1 200px', minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: navy }}>
                  <div style={{ fontWeight: '700', fontSize: '14px', display: 'flex', alignItems: 'center', gap: 4 }}>{s.client_name || 'Walk-in'} <ChevronRight size={14} color={gray400} aria-hidden='true' /></div>
                  <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{s.txn_no} · {items.length} item(s) · {s.payment_method}</div>
                  <div style={{ fontSize: '11px', color: theme.gray500, marginTop: '2px' }}>{businessDateTime(s.created_at)}</div>
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '16px', fontWeight: '900', color: tealDeep }}>{fmt(s.total)}</div>
                    {s.is_credit && <Pill label='Credit' type='amber' />}
                  </div>
                  <button onClick={() => printReceipt(saleToReceipt(s))} disabled={printing} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: gray600, fontWeight: '600', fontSize: '12px', cursor: printing ? 'wait' : 'pointer', opacity: printing ? 0.6 : 1 }}>
                    <Printer size={12} /> {printing ? 'Sending…' : 'Reprint'}
                  </button>
                </div>
              </div>
            </Card>
          )
        })
        })()}
      </div>
      <SaleDetailModal show={!!detailSale} sale={detailSale} onClose={() => setDetailSale(null)} brand={brand} settings={settings}
        readOnly ledgerAvailable showToast={showToast} />
      <Toast msg={toastMsg} type={toastType} actionLabel={toastActionLabel} onAction={toastOnAction} />
    </div>
  )

  // ── CREDIT SALES VIEW ────────────────────────────────────────────────────────
  if (view === 'credit') return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: bg }}>
      <div style={{ background: 'white', padding: isMobile ? '6px 16px 0' : '8px 24px 0', flexShrink: 0 }}>{tabBar('credit')}</div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        <CreditCollections brand={brand} creditSales={creditSales} clients={clients} role={role} perms={perms} loading={loadingOpen} error={openError} onRetry={() => refetchOpen()} showToast={showToast} />
      </div>
      <Toast msg={toastMsg} type={toastType} actionLabel={toastActionLabel} onAction={toastOnAction} />
    </div>
  )

  // ── MAIN POS VIEW (Sell tab) ──────────────────────────────────────────────
  const chargeLabel = !cart.length ? 'Add products' : method === 'Credit' ? (creditCustomer ? 'Record credit sale' : 'Select a customer') : 'Charge ' + fmt(total)
  const creditBlocked = method === 'Credit' && !creditCustomer

  return (
    <div ref={posRootRef} style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: isMobile ? 'auto' : '100%', minHeight: isMobile ? 'auto' : '100%', overflow: isMobile ? 'visible' : 'hidden', background: bg }}>

      {/* Products panel */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: isMobile ? 'visible' : 'hidden' }}>
        {/* Search + scan */}
        <div style={{ padding: isMobile ? '12px 16px 0' : '14px 20px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '0 12px', minWidth: 0 }}>
              <Search size={15} color={gray400} style={{ flexShrink: 0 }} />
              <input ref={productSearchRef} value={search} onChange={e => setSearch(e.target.value)} onKeyDown={onSearchKeyDown} placeholder='Search products or scan...' aria-label='Search products'
                style={{ flex: 1, border: 'none', outline: 'none', padding: '12px 0', fontSize: 13, background: 'transparent', color: navy, minWidth: 0 }} />
              <span style={{ color: gray400, fontSize: 11, padding: '0 8px' }}>Ctrl+K</span>
            </div>
            <button onClick={startScan} title='Scan barcode' aria-label='Scan barcode'
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 42, borderRadius: theme.radius.md, border: `1px solid ${border}`, background: tealDeep, color: 'white', cursor: 'pointer', flexShrink: 0 }}>
              <Camera size={17} />
            </button>
            {/* Sales & Accounts report. White, so the scan button stays the
                primary action on the counter. */}
            <button onClick={() => navigate('/dashboard/pos/report')} title='Sales & Accounts report' aria-label='Sales and accounts report'
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 42, borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: tealDeep, cursor: 'pointer', flexShrink: 0 }}>
              <ReceiptText size={17} />
            </button>
            {canViewCost && (
              <button type='button' onClick={toggleCost} aria-pressed={showCost} title={showCost ? 'Hide cost prices (e.g. when a customer can see the screen)' : 'Show cost prices'} aria-label={showCost ? 'Hide cost prices' : 'Show cost prices'}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '0 12px', minWidth: 42, borderRadius: theme.radius.md, border: `1px solid ${showCost ? tealDeep : border}`, background: showCost ? tealMist : 'white', color: tealDeep, fontWeight: 700, fontSize: 12, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>
                {showCost ? <Eye size={16} aria-hidden='true' /> : <EyeOff size={16} aria-hidden='true' />}
                <span style={showCost ? undefined : { textDecoration: 'line-through' }}>Cost</span>
              </button>
            )}
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

          {/* Stock filter */}
          <div style={{ marginTop: 8 }}>
            <select
              value={stockFilter}
              onChange={e => setStockFilter(e.target.value)}
              style={{ padding: '7px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 12, color: navy, background: bg, minWidth: 120 }}>
              <option value='All'>All stock levels</option>
              <option value='low'>Low stock</option>
              <option value='out'>Out of stock</option>
            </select>
          </div>

          {/* Expiry filter */}
          <div style={{ marginTop: 8, marginLeft: 12 }}>
            <select
              value={expiryFilter}
              onChange={e => setExpiryFilter(e.target.value)}
              style={{ padding: '7px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 12, color: navy, background: bg, minWidth: 120 }}>
              <option value='All'>Any expiry</option>
              <option value='expiring'>Expiring soon</option>
              <option value='expired'>Expired</option>
            </select>
          </div>

          {/* Grid / List toggle and sort */}
          <div style={{ marginTop: 8, marginLeft: 12 }}>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              style={{ padding: '7px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 12, color: navy, background: bg, minWidth: 140 }}>
              <option value='name_asc'>Name A-Z</option>
              <option value='name_desc'>Name Z-A</option>
              <option value='price_asc'>Price low-high</option>
              <option value='price_desc'>Price high-low</option>
            </select>
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
            <button onClick={() => { stopScanRef.current?.(); setScanning(false); const v = document.getElementById('pos-cam'); if (v?.srcObject) { v.srcObject.getTracks().forEach(t => t.stop()); v.srcObject = null } }}
              style={{ position: 'absolute', top: 8, right: 8, padding: '4px 10px', borderRadius: theme.radius.md, border: 'none', background: danger, color: 'white', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>Stop</button>
          </div>
        )}

        {catalog && <div style={{ padding: isMobile ? '12px 16px 0' : '12px 20px 0' }}><CatalogStatusBanner catalog={catalog} /></div>}

        {/* Product grid — only sellable items; out-of-stock live in the sheet */}
        <div aria-busy={gridStale} style={{ flex: 1, overflowY: isMobile ? 'visible' : 'auto', padding: isMobile ? '14px 16px' : '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 12, alignContent: 'start', opacity: gridStale ? 0.75 : 1, transition: 'opacity 120ms' }}>
          {catalogStatus === 'loading' ? (
            <>
              <div role="status" aria-live="polite" style={{ gridColumn: '1 / -1', fontSize: 13, fontWeight: 700, color: gray500 }}>{loadingLabel(catalog?.loadedCount || 0)}</div>
              {Array.from({ length: 8 }, (_, i) => (
                <Card key={i} aria-hidden="true" style={{ padding: 14 }}>
                  <Skeleton width={32} height={32} radius={theme.radius.md} style={{ marginBottom: 10 }} />
                  <Skeleton width="80%" height={12} style={{ marginBottom: 6 }} />
                  <Skeleton width="45%" height={14} />
                </Card>
              ))}
            </>
          ) : catalogStatus === 'error' ? (
            <div style={{ gridColumn: '1 / -1' }}>
              <ErrorState message={catalog?.error || "We couldn't load your products."} onRetry={catalog?.reload} />
            </div>
          ) : products.length === 0 ? (
            <div style={{ gridColumn: '1 / -1' }}>
              <Empty icon={<Search size={40} strokeWidth={1.5} />} title='No products to sell yet' description='Add products in Inventory and they will appear here.' />
            </div>
          ) : sellable.length === 0 ? (
            <div style={{ gridColumn: '1 / -1' }}>
              <Empty icon={<Search size={40} strokeWidth={1.5} />} message={outOfStock.length > 0 ? 'All matching products are out of stock.' : 'No products match your search.'} cause="filtered" />
            </div>
          ) : (
            <>
              {sellable.slice(0, gridLimit).map(p => <ProductCard key={p.id} p={p} qty={qtyInCart[p.id] || 0} onAdd={add} showCost={showCost} />)}
              {sellable.length > gridLimit && (
                <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap', padding: '6px 0 4px', fontSize: 12, color: gray500 }}>
                  <span>Showing {gridLimit.toLocaleString()} of {sellable.length.toLocaleString()} products. Type more of the name to narrow the list.</span>
                  <button type='button' onClick={() => setGridLimit(l => l + GRID_PAGE)}
                    style={{ padding: '7px 14px', borderRadius: theme.radius.full, border: `1px solid ${border}`, background: 'white', color: tealDeep, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                    Show {Math.min(GRID_PAGE, sellable.length - gridLimit)} more
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Cart panel — "Current sale" */}
        <div style={{ width: isMobile ? 'auto' : 340, flexShrink: 0, background: 'white', borderLeft: isMobile ? 'none' : `1px solid ${border}`, borderTop: isMobile ? `1px solid ${border}` : 'none', display: 'flex', flexDirection: 'column', ...(isMobile ? {} : { height: '100%' }) }}>
        {/* Header + client */}
        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexShrink: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: navy, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 32, height: 32, borderRadius: theme.radius.md, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><ShoppingCart size={18} aria-hidden='true' /></span>
            <span>Current Sale</span>
            {cart.length > 0 && (
              <span style={{ fontSize: 11, fontWeight: 800, color: tealDeep, background: tealMist, borderRadius: theme.radius.full, padding: '2px 8px', flexShrink: 0 }}>
                {cart.reduce((s, c) => s + c.qty, 0)}
              </span>
            )}
          </div>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
            <input list='pos-clients' value={client} onChange={e => setClient(e.target.value)} placeholder='Walk-in' aria-label='Customer for this sale'
              style={{ width: 140, padding: '8px 12px', borderRadius: theme.radius.full, border: `1px solid ${border}`, fontSize: 12.5, outline: 'none', boxSizing: 'border-box', background: bg, color: navy }} />
            <datalist id='pos-clients'>
              {clients.map(c => <option key={c.id} value={c.full_name} />)}
            </datalist>
          <button type='button' onClick={() => setShowAddCustomer(true)} aria-label='New customer for this sale' title='New customer for this sale'
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, flexShrink: 0, borderRadius: theme.radius.full, border: `1px solid ${border}`, background: 'white', color: tealDeep, cursor: 'pointer' }}>
            <UserPlus size={16} aria-hidden='true' />
          </button>
          </div>
        </div>

        {showRestored && (
          <div role='status' style={{ padding: '8px 16px', background: tealMist, color: tealDeep, fontSize: 12, fontWeight: 600, lineHeight: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexShrink: 0 }}>
            <span>Picked up where you left off: this sale was kept on this device{restoredAt ? ' (' + new Date(restoredAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) + ')' : ''}.</span>
            <button onClick={() => setRestoreSeen(true)} aria-label='Dismiss restored sale notice' style={{ background: 'none', border: 'none', color: tealDeep, fontWeight: 800, fontSize: 12, cursor: 'pointer', textDecoration: 'underline', flexShrink: 0 }}>OK</button>
          </div>
        )}

        {resumedSale && (
          <div role='status' style={{ padding: '8px 16px', background: warningBg, color: warning, fontSize: 12, fontWeight: 600, lineHeight: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexShrink: 0 }}>
            <span>Editing held sale {resumedSale.txn_no}. Add or remove products, then <strong>Hold</strong> to save it or charge to complete it. It is not a sale until charged.</span>
            <button onClick={newSale} style={{ background: 'none', border: 'none', color: warning, fontWeight: 800, fontSize: 12, cursor: 'pointer', textDecoration: 'underline', flexShrink: 0 }}>Close</button>
          </div>
        )}

        {/* Items */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 12px', ...(isMobile ? { maxHeight: 320 } : {}) }}>
          {cart.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 160 }}>
              <Empty icon={<Package size={80} strokeWidth={2} />} message="Your cart is empty" />
            </div>
          ) : cart.map(item => {
            // The catalog price this line was added at — the baseline shown
            // next to a one-off override (item.price !== catalogPrice).
            const catalogPrice = products.find(p => p.id === item.id)?.price ?? item.price
            return (
            <div key={item.id} className="pos-cart-item" style={{ padding: '12px', borderRadius: theme.radius.md, border: `1px solid ${gray100}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                  {perms?.canEditPrice ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      <input type='number' min='0' step='any' value={item.price} onChange={e => setPrice(item.id, e.target.value)}
                        aria-label={'Unit price for ' + item.name}
                        style={{ width: 84, padding: '3px 6px', borderRadius: theme.radius.sm, border: `1px solid ${item.price !== catalogPrice ? tealDeep : border}`, fontSize: 11.5, fontWeight: 700, outline: 'none', color: navy, background: item.price !== catalogPrice ? tealMist : 'white', textAlign: 'right', boxSizing: 'border-box' }} />
                      {item.price !== catalogPrice && <span style={{ fontSize: 10.5, color: gray400, whiteSpace: 'nowrap' }}>was {fmt(catalogPrice)}</span>}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11.5, color: gray400, marginTop: 1 }}>{fmt(item.price)} each</div>
                  )}
                  {showCost && (() => {
                    const c = lineCost(item)
                    const profit = c == null ? null : (item.price - c) * item.qty
                    return (
                      <div style={{ fontSize: 11, fontWeight: 600, color: gray500, marginTop: 2 }} data-testid='pos-line-cost'>
                        {c == null ? 'No cost set' : <>Cost {fmt(c)} each · <span style={{ color: profit < 0 ? danger : success, fontWeight: 800 }}>{profit < 0 ? 'loss ' + fmt(-profit) : 'profit ' + fmt(profit)}</span></>}
                      </div>
                    )
                  })()}
                </div>
                <div style={{ fontWeight: 800, fontSize: 13, color: navy, flexShrink: 0 }}>{fmt(item.price * item.qty)}</div>
              </div>
              {shortById.has(item.id) && (
                <div role='alert' data-testid='pos-line-stock' style={{ fontSize: 11.5, fontWeight: 700, color: danger, marginTop: 4 }}>
                  {shortById.get(item.id).available > 0 ? `Only ${shortById.get(item.id).available} in stock` : 'Out of stock'}: reduce the quantity to sell.
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', border: `1px solid ${border}`, borderRadius: theme.radius.md, overflow: 'hidden' }}>
                  <button onClick={() => setQty(item.id, item.qty - 1)} aria-label='Decrease quantity' style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, background: 'white', border: 'none', cursor: 'pointer', color: gray600 }}><Minus size={13} /></button>
                  <input type='number' value={item.qty} onChange={e => setQty(item.id, e.target.value)} aria-label={'Quantity of ' + item.name} style={{ width: 34, textAlign: 'center', padding: '4px 0', border: 'none', borderLeft: `1px solid ${border}`, borderRight: `1px solid ${border}`, fontSize: 13, fontWeight: 700, outline: 'none', color: navy }} />
                  <button onClick={() => setQty(item.id, item.qty + 1)} aria-label='Increase quantity' style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, background: 'white', border: 'none', cursor: 'pointer', color: tealDeep }}><Plus size={13} /></button>
                </div>
                <button onClick={() => rmv(item.id)} aria-label='Remove item' style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', color: gray400, background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><Trash2 size={14} /></button>
              </div>
            </div>
            )
          })}
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
            {discAmt > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: danger }}><span>Discount applied</span><span>{fmt(discAmt)} off</span></div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: navy }}>Total</span>
              <span style={{ fontSize: 21, fontWeight: 900, color: navy }}>{fmt(total)}</span>
            </div>
            {costSummary && cart.length > 0 && (
              <div role='status' data-testid='pos-sale-cost' style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 12, color: gray600, padding: '6px 8px', borderRadius: theme.radius.sm, background: bg }}>
                {costSummary.profit == null ? <span>No cost set for these products</span> : (
                  <>
                    <span>Est. profit{costSummary.missing ? ' (' + costSummary.missing + ' without cost)' : ''}</span>
                    <span style={{ fontWeight: 800, color: costSummary.profit < 0 ? danger : success }}>
                      {fmt(costSummary.profit)}{costSummary.marginPct != null ? ' · ' + costSummary.marginPct + '%' : ''}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Payment method chips */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
            {PAYMENT_METHODS.map(([m, Icon]) => {
              const on = method === m
              return (
                <button key={m} onClick={() => setMethod(m)} className={`pos-pay-chip${on ? ' is-active' : ''}`}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '9px 2px', borderRadius: theme.radius.md, cursor: 'pointer', fontWeight: 700 }}>
                  <Icon size={15} /><span style={{ fontSize: 10 }}>{m}</span>
                </button>
              )
            })}
          </div>

          {/* Method-specific inputs */}
          {method === 'Cash' && (
            <div>
              <input type='number' value={cash} onChange={e => setCash(e.target.value)} placeholder='Cash received (₦)'
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <CustomerPicker clients={clients} loading={clientsQuery.isLoading} error={clientsQuery.isError} onRetry={() => clientsQuery.refetch()}
                selected={creditCustomer} onSelect={pickCustomer} onCreate={addCustomer} />
              <input type='number' value={creditAmountPaid} onChange={e => setCreditAmountPaid(e.target.value)} placeholder='Amount paid now (₦)'
                style={{ width: '100%', padding: '10px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 12.5, outline: 'none', boxSizing: 'border-box', background: bg, color: navy }} />
              {creditAmountPaid !== '' && <div style={{ fontSize: 11.5, fontWeight: 700, marginTop: 5, color: danger }}>Balance owed: {fmt(total - (parseFloat(creditAmountPaid) || 0))}</div>}
              {parseFloat(creditAmountPaid) > 0 && (
                <div role='radiogroup' aria-label='Deposit paid by' style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  {['Cash', 'Transfer', 'POS'].map(m => (
                    <button key={m} role='radio' aria-checked={creditMethod === m} onClick={() => setCreditMethod(m)}
                      style={{ flex: 1, padding: '7px 0', borderRadius: theme.radius.md, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', border: `1px solid ${creditMethod === m ? tealDeep : border}`, background: creditMethod === m ? tealMist : 'white', color: creditMethod === m ? tealDeep : gray600 }}>
                      {m}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {stockProblems.length > 0 && (
            <div role='alert' data-testid='pos-stock-banner' style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '10px 12px', marginBottom: 8, borderRadius: theme.radius.md, background: dangerBg, border: `1px solid ${danger}`, fontSize: 12.5, color: navy }}>
              <span style={{ flex: '1 1 200px' }}>{cartStockMessage(stockProblems)}</span>
              <button type='button' onClick={fitCartToStock} style={{ padding: '6px 12px', borderRadius: theme.radius.sm, border: 'none', background: danger, color: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer', minHeight: 32 }}>
                Set to available stock
              </button>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowHoldModal(true)} disabled={!cart.length} className="pos-hold"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '14px 16px', borderRadius: theme.radius.md, fontWeight: 700, fontSize: 13, opacity: cart.length ? 1 : 0.5, flexShrink: 0 }}>
              <Pause size={14} /> Hold
            </button>
            {/* Credit MUST route to chargeCredit. charge() computes
                `amtPaid = method === 'Cash' ? … : method === 'Split' ? … :
                total`, so a Credit sale would be stored as paid in full
                (balance 0, is_credit false), the `creditAmountPaid` the
                cashier typed would be ignored, and the debt would never be
                recorded — the balance simply disappears. */}
            <button onClick={method === 'Credit' ? chargeCredit : charge} disabled={!cart.length || charging || creditBlocked} className="pos-charge"
              style={{ flex: 1, padding: '14px 0', borderRadius: theme.radius.md, border: 'none', fontWeight: 800, fontSize: 14, opacity: charging || creditBlocked ? 0.6 : 1, cursor: charging || creditBlocked ? 'not-allowed' : 'pointer' }}>
              {charging ? 'Processing...' : chargeLabel}
            </button>
          </div>
        </div>
      </div>

      {/* Add a customer without leaving the sale: saved to the Client List and selected for this sale. */}
      <Modal show={showAddCustomer} onClose={() => setShowAddCustomer(false)} title='Add customer'>
        {showAddCustomer && (
          <NewCustomerForm compact={false} title={null}
            initialName={client && client !== 'Walk-in' && !creditCustomerFor(pickedClient, client, clients) ? client : ''}
            onCreate={addCustomer} onCancel={() => setShowAddCustomer(false)}
            onCreated={(c) => { pickCustomer(c); setShowAddCustomer(false); showToast(c.full_name + ' added to your clients and selected for this sale.', { type: 'success' }) }} />
        )}
      </Modal>

      {/* Hold modal */}
      <Modal show={showHoldModal} onClose={() => { if (!holding) setShowHoldModal(false) }} title={resumedSale ? 'Save held sale' : 'Hold sale'}
        footer={<><GhostBtn onClick={() => setShowHoldModal(false)} disabled={holding} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
          <GhostBtn onClick={() => holdSale(true)} disabled={holding} aria-busy={holding || undefined} style={{ flex: 1, padding: '12px', opacity: holding ? 0.6 : 1 }}>Hold &amp; print invoice</GhostBtn>
          <TealBtn onClick={() => holdSale()} disabled={holding} aria-busy={holding || undefined} style={{ flex: 1, padding: '12px', opacity: holding ? 0.6 : 1 }}>{holding ? 'Saving…' : resumedSale ? 'Save changes' : 'Hold sale'}</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ padding: '12px', borderRadius: theme.radius.md, background: bg, fontSize: '13px', color: gray600 }}>
            Cart total: <strong>{fmt(total)}</strong> · {cart.length} item(s) for <strong>{client || 'Walk-in'}</strong>
          </div>
          <Inp label='Note (optional)' value={holdNote} onChange={setHoldNote} placeholder='e.g. Customer coming back in 30 minutes' />
          <div style={{ fontSize: '12px', color: gray500 }}>An invoice shows the customer what is due. It is not a receipt: the sale is recorded, with its payment, only when it is charged.</div>
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


