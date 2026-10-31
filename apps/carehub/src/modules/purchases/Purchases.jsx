import { useState, useEffect, useRef } from 'react'
import { Truck, CreditCard, Hourglass, Search, ChevronDown, History, CheckCircle, Pencil } from 'lucide-react'
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
import { findDuplicate } from '../../lib/productMatches'
import { blankItem, isBlankItem, findProductByBarcode, groupLinesByProduct } from './lineItems'
import { usePersistentDraft } from '../../hooks/usePersistentDraft'
import { useAuth } from '../../providers/AuthProvider'
import { upsertProducts } from '../inventory/productListState'
import { PurchasePaymentModal, SupplierBalances, purchaseStatus } from './SupplierPayments'
import PurchaseDetailModal from './PurchaseDetail'
import EditPurchaseModal from './EditPurchase'
import PurchaseHistory from './PurchaseHistory'
import PurchaseForm, { formLineProblems, formTotal } from './PurchaseForm'
import { useSupplierDirectory, useProductInsights } from './hooks'
import { purchaseItemsFromForm } from './purchaseInvoice'
import { usePlanGate } from '../../hooks/usePlanGate'
import { restrictedMessage } from '../../lib/planStatus'
import { isMissingObject } from '../../lib/dbErrors'
import { periodBounds, ALL_TIME } from '../../lib/datePeriods'
import PeriodFilter from '../../components/PeriodFilter'
import { theme } from '../../styles/theme'
import { Card, StatCard, SectionHead, Modal, ConfirmDialog, Pill, GhostBtn, TealBtn, Loading, Empty, ErrorState, useToast, Toast } from '../../components/ui'

const { tealDeep, navy, gray600, gray500, gray400, gray100, gray50, border, danger, warning, warningBg, success } = theme

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

// `products`/`setProducts`/`catalog` are the dashboard's shared catalog
// (inventory/hooks/useProductCatalog.js). Purchased items are matched against
// it, and the stock and products a purchase changes are written back into it,
// so Inventory and POS show the new stock at once without a re-download.
export default function Purchases({ brand, role, perms, products = [], setProducts, catalog, staffName }) {
  const { auth } = useAuth() || {}
  const [purchases, setPurchases] = useState([])
  // 'purchases' (the list), 'history' (every purchase line, with spending
  // analytics) or 'suppliers' (totals and payment history per supplier).
  const [view, setView] = useState('purchases')
  // The purchase whose Edit dialog is open.
  const [editing, setEditing] = useState(null)
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
  const [period, setPeriod] = useState(ALL_TIME)
  const [supplierFilter, setSupplierFilter] = useState('')
  // Set when the database predates the date / supplier filters and the list
  // was loaded without them (carehub_20261229 not applied yet).
  const [filtersUnavailable, setFiltersUnavailable] = useState(false)
  const [totals, setTotals] = useState({ purchase_count: 0, total_paid: 0, total_owed: 0 })
  const [saving, setSaving] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const formRef = useRef(null)
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const plan = usePlanGate(showToast)
  const directory = useSupplierDirectory(brand?.id)
  // The Owner always; another role only when granted "Edit purchases". The
  // database checks again (can_edit_purchases), so this only decides what is
  // offered.
  const canEditPurchases = role === 'Owner' || !!perms?.canEditPurchases

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
  // Earlier purchases of each product, fetched once while the form is open.
  const insights = useProductInsights(brand?.id, showAdd)
  const canReprice = !!perms?.canEditPrice

  const setForm = (updater) => setDraft(d => ({ ...d, form: typeof updater === 'function' ? updater(d.form) : updater }))

  const { from: periodFrom, to: periodTo, label: periodLabel } = periodBounds(period)
  useEffect(() => { load() }, [brand?.id, periodFrom, periodTo, supplierFilter, search])

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

  const filtersUnavailableRef = useRef(false)
  const pageFilters = () => (filtersUnavailableRef.current ? { search } : { search, from: periodFrom, to: periodTo, supplierKey: supplierFilter })

  // The list for the period and supplier chosen. A database without the
  // filters (migration not applied yet) answers "function not found": the list
  // is then loaded unfiltered and the filters say why they do nothing.
  async function fetchPage(offset) {
    try {
      return await purchaseRepository.getPage(brand.id, { ...pageFilters(), offset, limit: PAGE_SIZE })
    } catch (e) {
      if (!isMissingObject(e) || filtersUnavailableRef.current) throw e
      console.warn('[purchases] date and supplier filters not deployed yet; listing without them')
      filtersUnavailableRef.current = true
      setFiltersUnavailable(true)
      return purchaseRepository.getPage(brand.id, { search, offset, limit: PAGE_SIZE })
    }
  }

  async function load() {
    if (!brand?.id) return
    setLoading(true)
    setLoadError('')
    setPurchases([])
    setHasMore(true)
    try {
      const [page, totalData] = await Promise.all([
        fetchPage(0),
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
      const more = await fetchPage(purchases.length)
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
  const problemLines = formLineProblems(form, inventory)
  const computedTotal = formTotal(form)

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
      formRef.current?.focusLine(form.items[first.idx].id, Object.keys(first.problems)[0])
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
        const { existing, name, cost, sell, cat, barcode, lines } = group
        // A barcode entered on the line is saved onto a product that has none,
        // unless another product already uses it (the form blocks that).
        const owner = barcode ? findProductByBarcode(inventory, barcode) : null
        const newBarcode = barcode && !owner ? barcode : null
        let row = null
        try {
          if (existing) {
            // cost_price is a plain overwrite, with no race to lose. A changed
            // selling price is an explicit repricing intent, honoured only for
            // roles allowed to edit prices (the same rule Inventory enforces).
            const updates = { cost_price: cost }
            if (canReprice && sell && sell !== Number(existing.price)) updates.price = sell
            if (newBarcode && !String(existing.barcode || '').trim()) updates.barcode = newBarcode
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
              ...(newBarcode ? { barcode: newBarcode } : {}),
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
        {[['purchases', 'Purchases'], ['history', 'History & analytics'], ['suppliers', 'Suppliers & payments']].map(([v, label]) => {
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
      ) : view === 'history' ? (
        <PurchaseHistory brand={brand} suppliers={directory.suppliers} onOpenPurchase={(id) => setViewing({ id })} />
      ) : (<>
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '0 14px' }}>
            <Search size={15} color={gray400} style={{ flexShrink: 0 }} aria-hidden='true' />
            <input type='search' value={search} onChange={e => setSearch(e.target.value)} placeholder='Search supplier or product...' aria-label='Search purchases by supplier or product'
              style={{ flex: 1, padding: '10px 0', border: 'none', fontSize: '13px', outline: 'none', background: 'transparent', color: navy, minWidth: 0 }} />
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 700, color: gray600 }}>
            Supplier
            <select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)} disabled={filtersUnavailable}
              style={{ padding: '9px 12px', minHeight: 40, borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', fontWeight: 400, outline: 'none', background: 'white', color: navy }}>
              <option value=''>All suppliers</option>
              {directory.suppliers.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
            </select>
          </label>
        </div>
        <div style={{ flex: '2 1 320px', minWidth: 0 }}>
          <PeriodFilter value={period} onChange={setPeriod} label='Supply date' />
        </div>
      </div>
      {filtersUnavailable && (
        <div role='status' style={{ fontSize: 12, color: gray500, marginBottom: 12 }}>Filtering by date and supplier becomes available once the latest database update is applied. All purchases are listed.</div>
      )}

      {loading ? <Loading /> : loadError ? <ErrorState message={loadError} onRetry={load} /> : purchases.length === 0 ? (
        (search || supplierFilter || period.mode !== 'all') && !filtersUnavailable
          ? <Empty icon={<Search size={40} />} cause='filtered' title='No purchases match' description={'Nothing for ' + periodLabel.toLowerCase().replace(/^all time$/, 'any date') + (supplierFilter ? ' from this supplier' : '') + (search ? ' matching "' + search + '"' : '') + '.'}
              action='Clear filters' onAction={() => { setSearch(''); setSupplierFilter(''); setPeriod(ALL_TIME) }} />
          : <Empty icon={<Truck size={40} />} message='No purchases recorded' action={hasDraft ? 'Resume draft' : '+ Record Purchase'} onAction={openForm} />
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
                    <td style={{ padding: '12px 12px', fontSize: '13px', color: gray600, maxWidth: '260px' }}>
                      {p.product_name || 'Not set'}
                      {Number(p.edit_count) > 0 && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 800, color: gray500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Edited</span>}
                    </td>
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
                      <div style={{ display: 'flex', gap: 6 }}>
                      {canEditPurchases && (
                        <button type='button' onClick={(e) => { e.stopPropagation(); setEditing(p) }} aria-label={`Edit purchase from ${p.supplier_name}`}
                          style={{ padding: '6px 10px', borderRadius: theme.radius.sm, border: `1px solid ${border}`, background: 'white', color: tealDeep, fontWeight: '700', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap', minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Pencil size={12} aria-hidden='true' /> Edit
                        </button>
                      )}
                      {(Number(p.balance) || 0) > 0 ? (
                        <button type='button' onClick={(e) => { e.stopPropagation(); setPaying(p) }} aria-label={`Record payment to ${p.supplier_name}`} style={{ padding: '6px 12px', borderRadius: theme.radius.sm, border: 'none', background: tealDeep, color: 'white', fontWeight: '700', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap', minHeight: 32 }}>Record payment</button>
                      ) : (
                        <button type='button' onClick={(e) => { e.stopPropagation(); setPaying(p) }} aria-label={`Payment history for ${p.supplier_name}`} style={{ padding: '6px 12px', borderRadius: theme.radius.sm, border: `1px solid ${border}`, background: 'white', color: gray600, fontWeight: '700', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap', minHeight: 32 }}>History</button>
                      )}
                      </div>
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

      {viewing && !paying && !editing && <PurchaseDetailModal brand={brand} purchase={viewing} onClose={() => setViewing(null)} onPay={(p) => { setViewing(null); setPaying(p) }}
        onEdit={canEditPurchases ? (p) => { setViewing(null); setEditing(p) } : undefined} />}
      {editing && <EditPurchaseModal brand={brand} purchase={editing} inventory={inventory} inventoryStatus={inventoryStatus} catalog={catalog} setProducts={setProducts}
        staffName={staffName} showToast={showToast} onClose={() => setEditing(null)} onSaved={load} />}
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

          <PurchaseForm ref={formRef} form={form} setForm={setForm} inventory={inventory} inventoryStatus={inventoryStatus} catalog={catalog}
            canReprice={canReprice} showErrors={showErrors} brandId={brand?.id} insights={insights}
            suppliers={directory.suppliers} suppliersStatus={directory.isLoading ? 'loading' : directory.isError ? 'error' : 'ready'} />
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
