import { useState, useEffect, useRef } from 'react'
import { Truck, CreditCard, Hourglass, Search, Plus, X, ChevronDown, History, AlertTriangle, CheckCircle, Package } from 'lucide-react'
import { purchaseRepository } from './repositories'
// Product writes go through the inventory seam: replenishment must be atomic
// now that sales decrement stock server-side (C5/C12).
import { productRepository } from '../inventory/repositories'
// Recording a purchase composes three aggregates: the purchase record (above),
// inventory replenishment, and the debt raised by any shortfall. Each is owned
// by its own module's repository rather than re-derived here.
import { debtRepository } from '../debts/repositories'
import { fmt, fmtDate, todayDate } from '../../lib/utils'
import { purchaseExpirySummary } from './expirySummary'
import { findDuplicate, normalize } from '../../lib/productMatches'
import { blankItem, isBlankItem, findProductForEntry, applyProduct, itemProblems, isPastExpiry, groupLinesByProduct } from './lineItems'
import { usePersistentDraft } from '../../hooks/usePersistentDraft'
import { useAuth } from '../../providers/AuthProvider'
import { upsertProducts } from '../inventory/productListState'
import { PurchasePaymentModal, SupplierBalances, purchaseStatus } from './SupplierPayments'
import PurchaseDetailModal from './PurchaseDetail'
import { purchaseItemsFromForm } from './purchaseInvoice'
import { usePlanGate } from '../../hooks/usePlanGate'
import { restrictedMessage } from '../../lib/planStatus'
import { PRODUCT_CATS } from '../../config/constants'
import { theme } from '../../styles/theme'
import { Card, StatCard, SectionHead, Modal, ConfirmDialog, Pill, Inp, Textarea, GhostBtn, TealBtn, Loading, Empty, ErrorState, useToast, Toast } from '../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, gray100, gray50, border, danger, dangerBg, warning, warningBg, success, bg } = theme

// Margin applied to newly created products from a purchase so they are
// immediately sellable (stock is also set). Existing products keep their
// own selling price; only stock and cost are updated.
const NEW_PRODUCT_MARKUP = 1.5
const PAGE_SIZE = 50

const blankForm = () => ({ supplier: '', supplyDate: todayDate(), dueDate: '', amountPaid: '', notes: '', items: [blankItem()] })
// The draft holds the form AND whether it was open, so a tab the browser
// discarded in the background reopens exactly where the user left it.
const blankDraft = () => ({ open: false, form: blankForm() })
const formHasContent = (form) => !!(String(form.supplier || '').trim() || form.amountPaid || form.dueDate || String(form.notes || '').trim() || form.items.some(i => !isBlankItem(i)))

const lineInput = (invalid, readOnly) => ({
  width: '100%', boxSizing: 'border-box', minHeight: 40, padding: '8px 10px', borderRadius: theme.radius.sm,
  border: `1px solid ${invalid ? danger : border}`, fontSize: '13px', outline: 'none', color: navy,
  background: readOnly ? gray50 : 'white', fontFamily: theme.fontFamily,
})

function LineField({ id, label, error, children }) {
  return (
    <div style={{ minWidth: 0 }}>
      <label htmlFor={id} style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: gray500, marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</label>
      {children}
      {error && <div id={id + '-error'} style={{ fontSize: '11px', color: danger, marginTop: '3px' }}>{error}</div>}
    </div>
  )
}

// `products`/`setProducts`/`catalog` are the dashboard's shared catalog
// (inventory/hooks/useProductCatalog.js). Purchased items are matched against
// it, and the stock and products a purchase changes are written back into it,
// so Inventory and POS show the new stock at once without a re-download.
export default function Purchases({ brand, role, perms, products = [], setProducts, catalog, staffName }) {
  const { auth } = useAuth() || {}
  const [purchases, setPurchases] = useState([])
  // 'purchases' (the list) or 'suppliers' (totals and payment history per supplier).
  const [view, setView] = useState('purchases')
  // The purchase whose "Record payment" dialog is open.
  const [paying, setPaying] = useState(null)
  // The purchase opened as a supplier invoice (PurchaseDetailModal).
  const [viewing, setViewing] = useState(null)
  const inventory = products
  // Matching a purchase against a half-loaded catalog would create duplicates.
  const inventoryStatus = catalog?.status || 'ready'
  const catalogLoading = inventoryStatus === 'loading' || inventoryStatus === 'error'
  const [loading, setLoading] = useState(true)
  // A failed load used to be swallowed and shown as "No purchases recorded"
  // with zero totals, which hid a broken get_purchases_page for every business.
  const [loadError, setLoadError] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [search, setSearch] = useState('')
  const [filterMonth, setFilterMonth] = useState('')
  const [filterYear, setFilterYear] = useState('')
  const [totals, setTotals] = useState({ purchase_count: 0, total_paid: 0, total_owed: 0 })
  const [saving, setSaving] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [focusTarget, setFocusTarget] = useState(null)
  const fieldRefs = useRef({})
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const plan = usePlanGate(showToast)

  // The Record Purchase form is kept on this device as it is typed, scoped per
  // business AND per staff member: on a shared till one person's half-entered
  // delivery is never shown to (or saved by) someone else.
  const draftKey = brand?.id ? 'purchase_' + brand.id + '_' + (auth?.staff?.id || 'owner') : null
  const [draft, setDraft, { clear: clearDraft, restoredAt }] = usePersistentDraft(draftKey, blankDraft, {
    isEmpty: d => !d.open && !formHasContent(d.form),
  })
  const form = draft.form
  const showAdd = draft.open
  const hasDraft = formHasContent(form)
  const canReprice = !!perms?.canEditPrice

  const setForm = (updater) => setDraft(d => ({ ...d, form: typeof updater === 'function' ? updater(d.form) : updater }))
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const setItem = (id, k, v) => setForm(p => ({ ...p, items: p.items.map(it => it.id === id ? { ...it, [k]: v } : it) }))

  useEffect(() => { load() }, [brand?.id, filterMonth, filterYear, search])

  // Lines typed (or restored from a draft) before the catalog arrived are
  // linked once it does. Values the user already typed are kept, except a
  // selling price they are not allowed to change, which reverts to the
  // product's own rather than sitting in a read-only field the save ignores.
  useEffect(() => {
    if (inventoryStatus !== 'ready') return
    setForm(p => {
      let changed = false
      const items = p.items.map(it => {
        if (it.productId || !String(it.name).trim()) return it
        const match = findProductForEntry(inventory, it.name)
        if (!match) return it
        changed = true
        const linked = { ...it, productId: match.id, name: match.name }
        if (!canReprice) linked.sell = Number(match.price) > 0 ? String(match.price) : ''
        return linked
      })
      return changed ? { ...p, items } : p
    })
  }, [inventoryStatus, inventory, canReprice])

  useEffect(() => {
    if (!focusTarget) return
    fieldRefs.current[focusTarget.id + ':' + focusTarget.field]?.focus()
    setFocusTarget(null)
  }, [focusTarget])

  function openForm() { setDraft(d => ({ ...d, open: true })) }

  // Closing never throws work away: the draft stays on this device until it
  // is saved or explicitly discarded.
  function closeForm() {
    setDraft(d => ({ ...d, open: false }))
    if (hasDraft) showToast('Draft kept on this device. Resume it anytime.', { type: 'info' })
  }

  function discardDraft() {
    setConfirmDiscard(false)
    setShowErrors(false)
    clearDraft()
    showToast('Draft discarded.', { type: 'info' })
  }

  function addItem() {
    const item = blankItem()
    setForm(p => ({ ...p, items: [...p.items, item] }))
    setFocusTarget({ id: item.id, field: 'name' })
  }

  function removeItem(id) {
    setForm(p => {
      const items = p.items.filter(it => it.id !== id)
      return { ...p, items: items.length ? items : [blankItem()] }
    })
  }

  // Typing, picking from the list or scanning a barcode into the product
  // field. An exact match links the line to that product and fills in its
  // details; anything else is a new product.
  function changeName(item, value) {
    const match = inventoryStatus === 'ready' ? findProductForEntry(inventory, value) : null
    // A pick from the suggestions (or a paste or scan) changes the value by
    // more than one character at once. Only then does focus jump to Quantity,
    // never while someone is still typing a longer name.
    const picked = Math.abs(value.length - item.name.length) > 1
    setForm(p => ({
      ...p,
      items: p.items.map(it => {
        if (it.id !== item.id) return it
        if (!match) return { ...it, name: value, productId: null }
        // Same product still: keep what was typed unless it was the barcode.
        if (match.id === it.productId) return { ...it, name: normalize(value) === normalize(match.name) ? value : match.name }
        return applyProduct(it, match)
      }),
    }))
    if (match && picked) setFocusTarget({ id: item.id, field: 'qty' })
  }

  // Enter moves through the sheet like a spreadsheet: from the product field
  // to its quantity, from any other field to the next line's product, adding
  // a new line when this is the last one.
  function onLineKeyDown(e, index, field) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const item = form.items[index]
    if (field === 'name') { setFocusTarget({ id: item.id, field: 'qty' }); return }
    const next = form.items[index + 1]
    if (next) setFocusTarget({ id: next.id, field: 'name' })
    else addItem()
  }

  async function load() {
    setLoading(true)
    setLoadError('')
    setPurchases([])
    setHasMore(true)
    try {
      const [page, totalData] = await Promise.all([
        purchaseRepository.getPage(brand.id, { search, month: filterMonth, year: filterYear, offset: 0, limit: PAGE_SIZE }),
        purchaseRepository.getTotals(brand.id),
      ])
      setPurchases(page || [])
      setTotals(totalData?.[0] || { purchase_count: 0, total_paid: 0, total_owed: 0 })
      setHasMore((page || []).length === PAGE_SIZE)
    } catch (e) {
      console.error('[purchases] load failed:', e)
      setHasMore(false)
      setLoadError(e?.message?.startsWith('Session expired') ? e.message : "We couldn't load your purchases. Check your connection and try again.")
    }
    setLoading(false)
  }

  async function loadMore() {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const more = await purchaseRepository.getPage(brand.id, { search, month: filterMonth, year: filterYear, offset: purchases.length, limit: PAGE_SIZE })
      setPurchases(p => [...p, ...(more || [])])
      setHasMore((more || []).length === PAGE_SIZE)
    } catch (e) {
      console.error('[purchases] load more failed:', e)
      showToast('Could not load more purchases. Please try again.', { type: 'error' })
    }
    setLoadingMore(false)
  }

  // Every line the user has started. A started line that is incomplete blocks
  // the save (lineItems.itemProblems): it used to be dropped silently with a
  // "success" toast. Fully blank lines are ignored.
  const startedItems = form.items.filter(i => !isBlankItem(i))
  const linkedProduct = (it) => (it.productId ? inventory.find(p => p.id === it.productId) : null) || null
  const problemLines = form.items.map((it, idx) => ({ idx, problems: itemProblems(it, linkedProduct(it)) })).filter(x => Object.keys(x.problems).length > 0)
  const computedTotal = startedItems.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.cost) || 0), 0)
  const today = todayDate()

  const resolveExisting = (line) => (line.productId && inventory.find(p => p.id === line.productId)) || findDuplicate(inventory, line.name, '', null)

  async function save() {
    if (saving) return
    if (!String(form.supplier || '').trim()) { setShowErrors(true); showToast('Please enter the supplier name.', { type: 'warning' }); return }
    if (catalogLoading) { showToast('Your products are still loading. Try again in a moment so items match your existing products.', { type: 'warning' }); return }
    if (startedItems.length === 0) { showToast('Enter at least one item with a name, quantity and unit cost.', { type: 'warning' }); return }
    if (problemLines.length > 0) {
      setShowErrors(true)
      const nums = problemLines.map(x => x.idx + 1)
      showToast((nums.length === 1 ? 'Line ' : 'Lines ') + nums.join(', ') + (nums.length === 1 ? ' needs' : ' need') + ' attention: see the highlighted fields.', { type: 'warning' })
      const first = problemLines[0]
      setFocusTarget({ id: form.items[first.idx].id, field: Object.keys(first.problems)[0] })
      return
    }
    // An expired (restricted) plan still records purchases that restock products already in stock, but cannot create
    // new products (the database refuses them); say which lines before anything is saved, not halfway through.
    if (plan.restricted) {
      const newNames = [...new Set(startedItems.filter(i => !resolveExisting(i)).map(i => i.name.trim()))]
      if (newNames.length) {
        showToast(restrictedMessage('adding new products') + ' Remove or rename these lines to match products you already stock: ' + newNames.join(', ') + '.', { type: 'warning' })
        return
      }
    }
    setSaving(true)
    try {
      const total = computedTotal
      const paid = parseFloat(form.amountPaid) || 0
      // Clamp at zero: overpaying a supplier must not persist a negative
      // balance that the list would mis-render as a green "owed" figure.
      const balance = Math.max(0, total - paid)
      const totalQty = startedItems.reduce((s, i) => s + Number(i.qty), 0)
      const productNames = startedItems.map(i => i.name.trim())
      const supplier = form.supplier.trim()
      const supplyDate = form.supplyDate || todayDate()
      const { expiry, batch } = purchaseExpirySummary(startedItems)
      const purchase = await purchaseRepository.create(brand.id, {
        supplier_name: supplier,
        product_name: productNames.join(', '),
        quantity: totalQty,
        cost_price: totalQty > 0 ? total / totalQty : 0,
        total_cost: total,
        amount_paid: paid,
        balance: balance,
        supply_date: supplyDate,
        due_date: form.dueDate || '',
        status: paid >= total ? 'paid' : 'pending',
        notes: form.notes || '',
        expiry: expiry,
        batch: batch,
        // Each line's quantity and price, for the invoice view.
        items: purchaseItemsFromForm(startedItems),
      })
      const purchaseId = (purchase[0] || {}).id || ''

      // INVENTORY SYNC, through the stock ledger. Lines are grouped by product
      // so a new product is created once (against the stale snapshot two lines
      // would otherwise make two catalogue entries) and the cost and price are
      // written once. Then every line is received on its own through
      // receive_stock: one ledger movement per line (who, before, after, this
      // purchase), its batch created in the same transaction, and a key of
      // purchase + line so a retried request can never add the stock twice.
      let created = 0
      let updated = 0
      const syncFailed = []
      const changedRows = []
      const keyBase = purchaseId || ('unsaved-' + Date.now().toString(36))
      for (const group of groupLinesByProduct(startedItems, resolveExisting)) {
        const { existing, name, cost, sell, cat, lines } = group
        let row = null
        try {
          if (existing) {
            // cost_price is a plain overwrite, with no race to lose. A changed
            // selling price is an explicit repricing intent, honoured only for
            // roles allowed to edit prices (the same rule Inventory enforces).
            const updates = { cost_price: cost }
            if (canReprice && sell && sell !== Number(existing.price)) updates.price = sell
            row = (await productRepository.update(existing.id, brand.id, updates)) || { id: existing.id, ...updates }
            updated++
          } else {
            // Created empty, then received like any other line, so the units
            // are journalled as this purchase rather than as opening stock.
            const createdRow = await productRepository.create(brand.id, {
              name,
              category: cat,
              price: sell || Math.ceil(cost * NEW_PRODUCT_MARKUP),
              cost_price: cost,
              stock: 0,
              reorder_level: 5,
              list_on_carefind: true,
            })
            row = Array.isArray(createdRow) ? createdRow[0] : createdRow
            if (!row?.id) throw new Error('the product could not be created')
            created++
          }
        } catch (e) {
          syncFailed.push(name)
          console.error('Inventory sync failed for:', name, e.message)
          continue
        }
        let stock = null
        for (const line of lines) {
          try {
            const result = await productRepository.receiveStock(brand.id, row.id, line.qty, {
              movementType: 'purchase_receipt',
              idempotencyKey: 'purchase:' + keyBase + ':' + line.id,
              sourceType: 'purchase',
              sourceId: purchaseId || null,
              sourceLineId: line.id,
              reason: 'Purchase from ' + supplier,
              batchNumber: line.batch,
              expiryDate: line.expiry,
              dateReceived: supplyDate,
              supplier,
            })
            if (result?.stock != null) stock = result.stock
          } catch (e) {
            syncFailed.push(name + (e.code ? ' (' + e.message + ')' : ''))
            console.error('Stock receipt failed for:', name, e.message)
          }
        }
        changedRows.push({ ...row, ...(stock != null ? { stock } : {}) })
      }
      // One update to the shared catalog with the rows the database returned.
      if (changedRows.length > 0 && setProducts) setProducts(prev => upsertProducts(prev, changedRows))

      // AUTO-CREATE DEBT: if there is a balance, create a "We Owe" debt automatically
      if (balance > 0) {
        await debtRepository.recordUnderpayment({
          businessId: brand.id,
          direction: 'we_owe',
          partyName: supplier,
          amount: total,
          amountPaid: paid,
          dueDate: form.dueDate || '',
          description: 'Purchase: ' + (productNames[0] || 'Stock') + (productNames.length > 1 ? ' +' + (productNames.length - 1) + ' more' : '') + ': Due: ' + (form.dueDate || 'Not set'),
          source: 'purchase',
          sourceRef: purchaseId,
        })
      }
      const parts = []
      parts.push('Purchase recorded!')
      if (created > 0 || updated > 0) {
        parts.push(created + ' new product(s) added to Inventory, ' + updated + ' updated')
        if (created > 0 && !startedItems.some(i => !i.productId && Number(i.sell) > 0)) parts.push('new items priced at a ' + Math.round((NEW_PRODUCT_MARKUP - 1) * 100) + '% markup: adjust in Inventory anytime')
      }
      if (syncFailed.length > 0) parts.push('Not added to Inventory: ' + syncFailed.join(', ') + '. Add their stock from Inventory')
      if (balance > 0) parts.push('Debt of ' + fmt(balance) + ' added to Debts automatically')
      showToast(parts.join(' · '), { type: syncFailed.length > 0 ? 'warning' : 'success', duration: syncFailed.length > 0 ? 10000 : 5000 })
      setShowErrors(false)
      clearDraft()
      load()
    } catch (e) {
      console.error('[purchases] save failed:', e)
      showToast('Could not save purchase. Your entries are kept: please try again.', { type: 'error' })
    }
    setSaving(false)
  }

  const years = [...new Set(purchases.map(p => p.created_at?.slice(0, 4)).filter(Boolean))].sort().reverse()

  // Autocomplete suggestions for the product-name inputs: existing catalogue
  // names, deduplicated, so a purchase line can pick the product it is
  // replenishing rather than retyping it (and risking a near-miss duplicate).
  // One suggestion per name, labelled with generic name and stock so the
  // right product is easy to pick.
  const suggestions = []
  const seenNames = new Set()
  for (const p of inventory || []) {
    if (!p.name || seenNames.has(p.name)) continue
    seenNames.add(p.name)
    suggestions.push(p)
  }

  const draftLines = startedItems.length
  const draftSummary = draftLines + ' item' + (draftLines === 1 ? '' : 's') + (String(form.supplier || '').trim() ? ' from ' + form.supplier.trim() : '')

  return (
    <div>
      <SectionHead title='Purchases' sub='Record supplier purchases and the payments you make on them' btn={hasDraft ? 'Resume draft' : '+ Record Purchase'} onBtn={openForm} />

      {hasDraft && !showAdd && (
        <div role='status' style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '12px 16px', marginBottom: '16px', borderRadius: theme.radius.md, background: warningBg, border: `1px solid ${warning}` }}>
          <History size={18} color={warning} style={{ flexShrink: 0 }} aria-hidden='true' />
          <div style={{ flex: 1, minWidth: '180px' }}>
            <div style={{ fontSize: '13px', fontWeight: '800', color: theme.amberText }}>Unsaved purchase draft</div>
            <div style={{ fontSize: '12px', color: gray600, marginTop: '2px' }}>{draftSummary}. Kept on this device until you save or discard it.</div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <GhostBtn onClick={() => setConfirmDiscard(true)}>Discard</GhostBtn>
            <TealBtn onClick={openForm}>Resume</TealBtn>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard icon={<Truck />} label='Total Purchases' value={totals.purchase_count || 0} />
        <StatCard icon={<CreditCard />} label='Total Paid' value={fmt(Number(totals.total_paid) || 0)} />
        <StatCard icon={<Hourglass />} label='Balance Owed' value={fmt(Number(totals.total_owed) || 0)} alert={(Number(totals.total_owed) || 0) > 0} />
      </div>

      <div role='tablist' aria-label='Purchases views' style={{ display: 'flex', gap: 24, borderBottom: `1px solid ${border}`, marginBottom: 16 }}>
        {[['purchases', 'Purchases'], ['suppliers', 'Suppliers & payments']].map(([v, label]) => {
          const on = view === v
          return (
            <button key={v} type='button' role='tab' aria-selected={on} onClick={() => setView(v)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '10px 2px', marginBottom: -1, fontSize: 13, fontWeight: on ? 800 : 600, color: on ? tealDeep : gray600, borderBottom: on ? `2px solid ${tealDeep}` : '2px solid transparent' }}>
              {label}
            </button>
          )
        })}
      </div>

      {view === 'suppliers' ? (
        <SupplierBalances brand={brand} staffName={staffName} showToast={showToast} onPaid={load} />
      ) : (<>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '180px', display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '0 14px' }}>
          <Search size={15} color={gray400} style={{ flexShrink: 0 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder='Search supplier or product...'
            style={{ flex: 1, padding: '10px 0', border: 'none', fontSize: '13px', outline: 'none', background: 'transparent', color: navy, minWidth: 0 }} />
        </div>
        <input type='month' value={filterMonth} onChange={e => { setFilterMonth(e.target.value); setFilterYear('') }}
          style={{ padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', outline: 'none', color: navy, background: 'white' }} />
        <select value={filterYear} onChange={e => { setFilterYear(e.target.value); setFilterMonth('') }}
          style={{ padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', outline: 'none', background: 'white', color: navy }}>
          <option value=''>All years</option>
          {years.map(y => <option key={y}>{y}</option>)}
        </select>
        {(filterMonth || filterYear) && <button onClick={() => { setFilterMonth(''); setFilterYear('') }} style={{ padding: '9px 14px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: gray600, cursor: 'pointer', fontSize: '12px', fontWeight: 700 }}>Clear</button>}
      </div>

      {loading ? <Loading /> : loadError ? <ErrorState message={loadError} onRetry={load} /> : purchases.length === 0 ? (
        <Empty icon={<Truck size={40} />} message='No purchases recorded' action={hasDraft ? 'Resume draft' : '+ Record Purchase'} onAction={openForm} />
      ) : (
        <Card>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${border}`, background: gray50 }}>
                  {['Supplier', 'Product', 'Qty', 'Unit Cost', 'Total', 'Paid', 'Balance', 'Supply Date', 'Due Date', 'Expiry Date', 'Status', 'Action'].map(h => (
                    <th key={h} style={{ padding: '12px 12px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: gray400, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {purchases.map(p => (
                  // The whole row opens the purchase as an invoice; the supplier
                  // name is its keyboard-reachable button.
                  <tr key={p.id} onClick={() => setViewing(p)} style={{ borderBottom: `1px solid ${gray100}`, cursor: 'pointer' }}>
                    <td style={{ padding: '12px 12px', fontWeight: '700', fontSize: '13px', color: navy }}>
                      <button type='button' onClick={(e) => { e.stopPropagation(); setViewing(p) }} aria-label={`View purchase from ${p.supplier_name}`}
                        style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, color: navy, cursor: 'pointer', textAlign: 'left', textDecoration: 'underline', textDecorationColor: gray100, textUnderlineOffset: 3 }}>
                        {p.supplier_name}
                      </button>
                    </td>
                    <td style={{ padding: '12px 12px', fontSize: '13px', color: gray600, maxWidth: '260px' }}>{p.product_name || 'Not set'}</td>
                    <td style={{ padding: '12px 12px', fontSize: '13px', color: navy }}>{p.quantity || 'Not set'}</td>
                    <td style={{ padding: '12px 12px', fontSize: '13px', color: navy }}>{p.cost_price ? fmt(p.cost_price) : 'Not set'}</td>
                    <td style={{ padding: '12px 12px', fontSize: '13px', fontWeight: '700', color: navy }}>{fmt(p.total_cost || 0)}</td>
                    <td style={{ padding: '12px 12px', fontSize: '13px', color: success }}>{fmt(p.amount_paid || 0)}</td>
                    <td style={{ padding: '12px 12px', fontSize: '13px', fontWeight: '900', color: (p.balance || 0) > 0 ? danger : success }}>{fmt(p.balance || 0)}</td>
                    <td style={{ padding: '12px 12px', fontSize: '12px', color: gray500 }}>{p.supply_date || 'Not set'}</td>
                    <td style={{ padding: '12px 12px', fontSize: '12px', color: gray400 }}>{p.due_date || 'Not set'}</td>
                    <td style={{ padding: '12px 12px', fontSize: '12px', color: gray500 }}>{fmtDate(p.expiry)}</td>
                    <td style={{ padding: '12px 12px' }}>{(() => { const st = purchaseStatus(p); return <Pill label={st.label} type={st.type} /> })()}</td>
                    <td style={{ padding: '12px 12px' }}>
                      {(Number(p.balance) || 0) > 0 ? (
                        <button type='button' onClick={(e) => { e.stopPropagation(); setPaying(p) }} aria-label={`Record payment to ${p.supplier_name}`} style={{ padding: '6px 12px', borderRadius: theme.radius.sm, border: 'none', background: tealDeep, color: 'white', fontWeight: '700', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap', minHeight: 32 }}>Record payment</button>
                      ) : (
                        <button type='button' onClick={(e) => { e.stopPropagation(); setPaying(p) }} aria-label={`Payment history for ${p.supplier_name}`} style={{ padding: '6px 12px', borderRadius: theme.radius.sm, border: `1px solid ${border}`, background: 'white', color: gray600, fontWeight: '700', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap', minHeight: 32 }}>History</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <div style={{ padding: '16px', textAlign: 'center' }}>
              <button onClick={loadMore} disabled={loadingMore}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 20px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: navy, fontWeight: '700', fontSize: '13px', cursor: loadingMore ? 'wait' : 'pointer' }}>
                {loadingMore ? 'Loading...' : <><ChevronDown size={14} /> Load more</>}
              </button>
            </div>
          )}
        </Card>
      )}

      </>)}

      {viewing && !paying && <PurchaseDetailModal brand={brand} purchase={viewing} onClose={() => setViewing(null)} onPay={(p) => { setViewing(null); setPaying(p) }} />}
      {paying && <PurchasePaymentModal brand={brand} purchase={paying} staffName={staffName} showToast={showToast} onPaid={load} onClose={() => setPaying(null)} />}

      {/* A tap outside the sheet or Escape must never cost a long entry, so the
          backdrop does not close it; Close keeps the draft, Discard is explicit. */}
      <Modal show={showAdd} onClose={closeForm} title='Record Purchase' wide preventBackdropClose
        footer={<>
          <GhostBtn onClick={closeForm} style={{ flex: 1, padding: '12px' }}>Close</GhostBtn>
          <TealBtn onClick={save} disabled={saving || catalogLoading} aria-busy={saving} title={catalogLoading ? 'Available once your products have loaded' : undefined}
            style={{ flex: 2, padding: '12px', opacity: saving ? 0.7 : 1, cursor: saving ? 'wait' : 'pointer' }}>
            {saving ? 'Saving...' : catalogLoading ? 'Loading products…' : 'Save Purchase' + (draftLines > 0 ? ' (' + draftLines + ')' : '')}
          </TealBtn>
        </>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', fontSize: '11.5px', color: gray500 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <CheckCircle size={13} color={success} aria-hidden='true' />
              {restoredAt && hasDraft
                ? 'Picked up where you left off (draft from ' + new Date(restoredAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) + ')'
                : 'Saved on this device as you type'}
            </span>
            {hasDraft && (
              <button onClick={() => setConfirmDiscard(true)} style={{ border: 'none', background: 'transparent', color: danger, fontWeight: '700', fontSize: '11.5px', cursor: 'pointer', padding: '4px 0' }}>Discard draft</button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            <Inp label='Supplier Name' id='purchase-supplier' value={form.supplier} onChange={v => f('supplier', v)} placeholder='e.g. MedSupply Ltd' required
              error={showErrors && !String(form.supplier || '').trim() ? 'Enter the supplier name' : undefined} />
            <Inp label='Supply Date' id='purchase-supply-date' value={form.supplyDate} onChange={v => f('supplyDate', v)} type='date' />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
              <span id='purchase-items-label' style={{ fontSize: '12px', fontWeight: '700', color: gray500 }}>ITEMS RECEIVED *</span>
              <span style={{ fontSize: '11px', color: gray400 }}>{draftLines} item{draftLines === 1 ? '' : 's'}</span>
            </div>

            {inventoryStatus === 'loading' && (
              <div role='status' style={{ fontSize: '12px', color: gray500, marginBottom: '8px' }}>Loading your products…</div>
            )}
            {inventoryStatus === 'error' && (
              <div role='alert' style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: '8px 12px', marginBottom: '8px', borderRadius: theme.radius.sm, background: dangerBg, border: `1px solid ${danger}`, fontSize: '12px', color: danger }}>
                <AlertTriangle size={14} aria-hidden='true' />
                <span style={{ flex: 1, minWidth: '160px' }}>Could not load your products, so existing items cannot be matched yet.</span>
                {catalog?.reload && <button onClick={() => catalog.reload()} style={{ border: `1px solid ${danger}`, background: 'white', color: danger, borderRadius: theme.radius.sm, padding: '4px 10px', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}>Retry</button>}
              </div>
            )}
            {inventoryStatus === 'ready' && (
              <div style={{ fontSize: '12px', color: gray500, marginBottom: '8px', lineHeight: 1.5 }}>
                Pick a product from your inventory (or scan its barcode) and its details fill in. Enter the quantity and change only what is different, then press Enter for the next item.
              </div>
            )}

            <div role='list' aria-labelledby='purchase-items-label' style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {form.items.map((item, i) => {
                const product = item.productId ? inventory.find(p => p.id === item.productId) : null
                const problems = showErrors ? itemProblems(item, product) : {}
                const hasProblems = Object.keys(problems).length > 0
                const qtyNum = Number(item.qty)
                const qtyValid = Number.isInteger(qtyNum) && qtyNum > 0
                const sub = (Number(item.qty) || 0) * (Number(item.cost) || 0)
                const priceLocked = !!product && !canReprice
                const isService = (product?.category || product?.cat) === 'Services'
                const tracking = product?.tracking_mode || 'none'
                const sameAs = !isBlankItem(item) && String(item.name).trim()
                  ? form.items.findIndex((o, j) => j < i && (item.productId ? o.productId === item.productId : (!o.productId && normalize(o.name) === normalize(item.name))))
                  : -1
                const fid = (k) => 'pi-' + item.id + '-' + k
                const reg = (k) => (el) => { fieldRefs.current[item.id + ':' + k] = el }
                const described = (k) => problems[k] ? fid(k) + '-error' : undefined
                return (
                  <div key={item.id} role='listitem' aria-label={'Item ' + (i + 1) + (item.name ? ': ' + item.name : '')}
                    style={{ padding: '12px', borderRadius: theme.radius.md, border: `1px solid ${hasProblems ? danger : gray100}`, background: bg }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                      <div style={{ width: '24px', height: '40px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '800', color: gray400 }} aria-hidden='true'>{i + 1}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <LineField id={fid('name')} label='Product' error={problems.name}>
                          <input id={fid('name')} ref={reg('name')} value={item.name} list='purchase-product-names' autoComplete='off'
                            onChange={e => changeName(item, e.target.value)} onKeyDown={e => onLineKeyDown(e, i, 'name')}
                            placeholder='Type, pick or scan e.g. Amoxicillin 500mg'
                            aria-invalid={!!problems.name} aria-describedby={described('name')}
                            style={lineInput(problems.name)} />
                        </LineField>
                      </div>
                      <button onClick={() => removeItem(item.id)} aria-label={'Remove item ' + (i + 1) + (item.name ? ' (' + item.name + ')' : '')}
                        style={{ width: '40px', height: '40px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.md, border: 'none', background: 'transparent', color: gray400, cursor: 'pointer' }}>
                        <X size={16} />
                      </button>
                    </div>

                    {product ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', margin: '8px 0 0 32px', fontSize: '12px', color: gray600 }}>
                        <Package size={13} color={tealDeep} aria-hidden='true' />
                        <span style={{ fontWeight: '700', color: tealDeep }}>In inventory</span>
                        <span>· {product.category || product.cat || 'Uncategorised'}</span>
                        {product.generic_name && <span>· {product.generic_name}</span>}
                        {tracking !== 'none' && <span>· tracked by batch{tracking === 'batch_expiry' ? ' and expiry' : ''}</span>}
                        {!isService && (
                          <span>· Stock <strong style={{ color: navy }}>{product.stock || 0}</strong>{qtyValid && <> → <strong style={{ color: success }}>{(product.stock || 0) + qtyNum}</strong> after saving</>}</span>
                        )}
                      </div>
                    ) : String(item.name).trim() ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', margin: '8px 0 0 32px', fontSize: '12px', color: gray600 }}>
                        <span><strong style={{ fontWeight: '700', color: warning }}>New product</strong>, added to Inventory as</span>
                        <select value={item.cat} onChange={e => setItem(item.id, 'cat', e.target.value)} aria-label={'Category for item ' + (i + 1)}
                          style={{ padding: '4px 8px', borderRadius: theme.radius.sm, border: `1px solid ${border}`, fontSize: '12px', background: 'white', color: navy }}>
                          {PRODUCT_CATS.map(c => <option key={c}>{c}</option>)}
                        </select>
                      </div>
                    ) : null}

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '8px', marginTop: '10px', marginLeft: '32px' }}>
                      <LineField id={fid('qty')} label='Quantity *' error={problems.qty}>
                        <input id={fid('qty')} ref={reg('qty')} value={item.qty} onChange={e => setItem(item.id, 'qty', e.target.value)} onKeyDown={e => onLineKeyDown(e, i, 'qty')}
                          type='number' inputMode='numeric' min='1' step='1' placeholder='0'
                          aria-invalid={!!problems.qty} aria-describedby={described('qty')} style={lineInput(problems.qty)} />
                      </LineField>
                      <LineField id={fid('cost')} label='Unit cost (₦) *' error={problems.cost}>
                        <input id={fid('cost')} ref={reg('cost')} value={item.cost} onChange={e => setItem(item.id, 'cost', e.target.value)} onKeyDown={e => onLineKeyDown(e, i, 'cost')}
                          type='number' inputMode='decimal' min='0' placeholder='0'
                          aria-invalid={!!problems.cost} aria-describedby={described('cost')} style={lineInput(problems.cost)} />
                      </LineField>
                      <LineField id={fid('sell')} label='Selling price (₦)'>
                        <input id={fid('sell')} ref={reg('sell')} value={item.sell} onChange={e => setItem(item.id, 'sell', e.target.value)} onKeyDown={e => onLineKeyDown(e, i, 'sell')}
                          type='number' inputMode='decimal' min='0' placeholder={product ? '0' : 'Auto +50%'} readOnly={priceLocked}
                          aria-describedby={priceLocked ? fid('sell') + '-locked' : undefined} style={lineInput(false, priceLocked)} />
                      </LineField>
                      <LineField id={fid('batch')} label={tracking !== 'none' ? 'Batch no. *' : 'Batch no.'} error={problems.batch}>
                        <input id={fid('batch')} ref={reg('batch')} value={item.batch} onChange={e => setItem(item.id, 'batch', e.target.value)} onKeyDown={e => onLineKeyDown(e, i, 'batch')}
                          placeholder={tracking !== 'none' ? 'Required' : 'Optional'} aria-invalid={!!problems.batch} aria-describedby={described('batch')} style={lineInput(problems.batch)} />
                      </LineField>
                      <LineField id={fid('expiry')} label={tracking === 'batch_expiry' ? 'Expiry date *' : 'Expiry date'} error={problems.expiry}>
                        <input id={fid('expiry')} ref={reg('expiry')} value={item.expiry} onChange={e => setItem(item.id, 'expiry', e.target.value)} onKeyDown={e => onLineKeyDown(e, i, 'expiry')}
                          type='date' aria-invalid={!!problems.expiry} aria-describedby={described('expiry')} style={lineInput(problems.expiry)} />
                      </LineField>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginTop: '8px', marginLeft: '32px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '11.5px' }}>
                        {priceLocked && <span id={fid('sell') + '-locked'} style={{ color: gray500 }}>Selling price can only be changed by roles with price permission.</span>}
                        {isPastExpiry(item, today) && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: warning, fontWeight: '700' }}><AlertTriangle size={12} aria-hidden='true' /> This expiry date has already passed: check the year.</span>}
                        {sameAs >= 0 && <span style={{ color: gray500 }}>Same product as line {sameAs + 1}: stock is combined, each batch is kept separately.</span>}
                      </div>
                      <span style={{ fontSize: '12px', fontWeight: '700', color: sub > 0 ? tealDeep : gray400, marginLeft: 'auto' }}>{sub > 0 ? 'Subtotal: ' + fmt(sub) : 'Not set'}</span>
                    </div>
                  </div>
                )
              })}
            </div>

            <button onClick={addItem} style={{ width: '100%', marginTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', minHeight: '44px', borderRadius: theme.radius.md, border: `1px dashed ${tealDeep}`, background: tealMist, color: tealDeep, fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>
              <Plus size={15} aria-hidden='true' /> Add another item
            </button>
          </div>

          <datalist id='purchase-product-names'>
            {suggestions.map(p => {
              const isSvc = (p.category || p.cat) === 'Services'
              const label = [p.generic_name, isSvc ? null : (p.stock || 0) + ' in stock'].filter(Boolean).join(' · ')
              return <option key={p.id} value={p.name}>{label}</option>
            })}
          </datalist>

          <div style={{ padding: '10px 14px', borderRadius: theme.radius.md, background: bg, display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
            <span style={{ color: gray500 }}>Total Cost (auto)</span>
            <span style={{ fontWeight: '900', color: navy }}>{fmt(computedTotal)}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            <Inp label='Amount Paid (₦)' id='purchase-amount-paid' value={form.amountPaid} onChange={v => f('amountPaid', v)} type='number' placeholder='0' />
            <Inp label='Payment Due Date' id='purchase-due-date' value={form.dueDate} onChange={v => f('dueDate', v)} type='date' />
          </div>
          {computedTotal > 0 && (
            <div style={{ padding: '10px 14px', borderRadius: theme.radius.md, background: bg, display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
              <span style={{ color: gray500 }}>Balance remaining</span>
              <span style={{ fontWeight: '900', color: danger }}>{fmt(Math.max(0, computedTotal - (parseFloat(form.amountPaid) || 0)))}</span>
            </div>
          )}
          <Textarea label='Notes' id='purchase-notes' value={form.notes} onChange={v => f('notes', v)} placeholder='Invoice number, delivery notes...' rows={2} />

          <div style={{ padding: '10px 14px', borderRadius: theme.radius.md, background: tealMist, border: `1px solid ${tealDeep}`, fontSize: '12px', color: tealDeep, lineHeight: '1.7' }}>
            Saving adds every item to Inventory: existing products get the extra stock and the new unit cost; new products are created with your selling price (or a 50% markup if left blank). Batch and expiry details create a stock batch for expiry tracking.
          </div>
        </div>
      </Modal>

      <ConfirmDialog show={confirmDiscard} onClose={() => setConfirmDiscard(false)} onConfirm={discardDraft}
        title='Discard this purchase draft?'
        consequence={'This clears ' + (draftLines > 0 ? draftSummary : 'everything entered in this draft') + ' from this device. Nothing has been saved to your records yet, and this cannot be undone.'}
        confirmLabel='Discard' />

      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}
