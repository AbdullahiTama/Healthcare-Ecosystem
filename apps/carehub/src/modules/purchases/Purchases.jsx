import { useState, useEffect, useRef, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Truck, CreditCard, Hourglass, Search, ChevronDown, History, CheckCircle, Pencil, Trash2, RotateCcw, Upload, Download } from 'lucide-react'
import { purchaseRepository } from './repositories'
import { useQueryParamAction } from '../../hooks/useQueryParamAction'
// Recording a purchase composes three aggregates (the purchase record, inventory
// replenishment through the stock ledger, and the debt raised by any shortfall):
// recordPurchase.js, shared with the bulk upload.
import { fmt, fmtDate, todayDate } from '../../lib/utils'
import { blankItem, isBlankItem } from './lineItems'
import { usePersistentDraft } from '../../hooks/usePersistentDraft'
import { useAuth } from '../../providers/AuthProvider'
import { upsertProducts } from '../inventory/productListState'
import { PurchasePaymentModal, SupplierBalances, purchaseStatus } from './SupplierPayments'
import PurchaseDetailModal from './PurchaseDetail'
import EditPurchaseModal from './EditPurchase'
import PurchaseHistory from './PurchaseHistory'
import PurchaseForm, { formLineProblems } from './PurchaseForm'
import { useSupplierDirectory, useProductInsights } from './hooks'
import { recordPurchase, resolveExistingProduct, NEW_PRODUCT_MARKUP } from './recordPurchase'
import { usePlanGate } from '../../hooks/usePlanGate'
import { restrictedMessage } from '../../lib/planStatus'
import { isMissingObject } from '../../lib/dbErrors'
import { periodBounds, ALL_TIME } from '../../lib/datePeriods'
import PeriodFilter from '../../components/PeriodFilter'
import SelectionBar from '../../components/SelectionBar'
import BulkDeleteModal from '../../components/BulkDeleteModal'
import RecentlyDeletedModal from '../../components/RecentlyDeletedModal'
import PurchaseBulkEditModal from './components/PurchaseBulkEditModal'
import PurchaseImportModal from './components/PurchaseImportModal'
import PurchaseExportModal from './components/PurchaseExportModal'
import { duplicateKey } from './purchaseImport'
import { exportPurchases } from './purchaseExport'
import { auditRepository } from '../audit/repositories'
import { runPurchaseBulkEdit, purchaseKeptText, purchaseLabel } from './purchaseBulkEdit'
import { theme } from '../../styles/theme'
import { Card, StatCard, SectionHead, Modal, ConfirmDialog, Pill, GhostBtn, TealBtn, RedBtn, Loading, Empty, ErrorState, useToast, Toast } from '../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, gray100, gray50, border, danger, warning, warningBg, success } = theme

const PAGE_SIZE = 50

// A restore that could not put some purchases back (a product or batch they stocked was deleted since).
function describePurchaseRestore(r) {
  if (!r?.skipped_stock) return ''
  const names = (r.skipped || []).map(x => x.name + (x.product ? ' (' + x.product + ')' : '')).join(', ')
  return `${r.skipped_stock} not restored because a product or batch they stocked is gone${names ? ': ' + names : ''}.`
}

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
  // Opened from the Owner's activity feed: ?purchase=<id> shows that invoice,
  // ?view=suppliers the supplier balances.
  useQueryParamAction('purchase', async (id) => {
    try {
      const p = await purchaseRepository.getById(id, brand.id)
      if (p) setViewing(p)
    } catch (e) { console.error('[purchases] could not open purchase', id, e?.message) }
  }, !!brand?.id)
  useQueryParamAction('view', (v) => { if (v === 'suppliers') setView('suppliers') })
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
  // Deleting takes stock back and removes payments and the debt with the purchase: the Owner, or a role allowed both
  // to delete and to edit purchases (delete_purchases checks the same).
  const canDeletePurchases = canEditPurchases && (role === 'Owner' || !!perms?.canDelete)
  // Exports carry costs: the Owner, or a role allowed to export (record_export_audit checks the same and refuses
  // anyone else before the file is saved).
  const canExport = role === 'Owner' || !!perms?.canExportReports
  const [showImport, setShowImport] = useState(false)
  const [showExport, setShowExport] = useState(false)

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

  // ── Bulk actions: mark purchases, edit their headers together, delete them (stock taken back; restorable) ─────
  const [marked, setMarked] = useState(() => new Set())
  const [showBulkEdit, setShowBulkEdit] = useState(false)
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [showDeleted, setShowDeleted] = useState(false)
  const canMark = canEditPurchases
  const markedPurchases = purchases.filter(p => marked.has(p.id))
  const allShownMarked = purchases.length > 0 && purchases.every(p => marked.has(p.id))
  const toggleMarked = (id) => setMarked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  useEffect(() => { setMarked(new Set()) }, [brand?.id])
  const queryClient = useQueryClient()
  // What a single edit refreshes (useEditPurchase): supplier totals and history, Debts, Reports.
  const refreshRelated = () => { for (const prefix of ['purchases', 'debts', 'reports']) queryClient.invalidateQueries({ queryKey: [prefix] }) }
  const supplierNames = useMemo(() => (directory.suppliers || []).map(s => s.name).filter(Boolean), [directory.suppliers])

  async function runPurchaseUpdates(groups, onProgress, reason) {
    const labels = Object.fromEntries(purchases.map(p => [p.id, purchaseLabel(p)]))
    const r = await runPurchaseBulkEdit(groups, (ids, updates) => purchaseRepository.bulkEdit(brand.id, ids, updates, { reason, staffName }), { onProgress, labels })
    if (r.saved.length) {
      const byId = new Map(r.saved.map(x => [String(x.id), x]))
      const pick = (x) => ({ supplier_name: x.supplier_name, supply_date: x.supply_date, due_date: x.due_date, notes: x.notes, edit_count: x.edit_count, edited_at: x.edited_at })
      setPurchases(prev => prev.map(x => (byId.has(String(x.id)) ? { ...x, ...pick(byId.get(String(x.id))) } : x)))
      refreshRelated()
    }
    if (r.failed.length) console.error('[purchases] bulk edit: some updates failed', r.failed.map(f => f.message))
    else console.info('[purchases] bulk edit saved', { purchases: r.saved.length, notes: r.notes.length })
    return r
  }
  async function deleteMarked() {
    const r = await purchaseRepository.deleteMany(brand.id, markedPurchases.map(p => p.id))
    console.info('[purchases] deleted', { deleted: r.deleted, kept: (r.kept || []).length })
    setMarked(new Set())
    if (r.deleted > 0) { load(); catalog?.reload?.(); refreshRelated() }
    return r
  }
  async function restoreDeletion(deletionId) {
    try {
      const r = await purchaseRepository.restoreDeleted(brand.id, deletionId)
      load(); catalog?.reload?.(); refreshRelated()
      showToast(`${r.restored} purchase${r.restored === 1 ? '' : 's'} restored, stock put back.${describePurchaseRestore(r) ? ' ' + describePurchaseRestore(r) : ''}`, { type: r.skipped_stock ? 'warning' : 'success' })
      return r
    } catch (e) {
      showToast(e?.message || 'Could not restore. Please try again.', { type: 'error' })
      throw e
    }
  }

  // ── Bulk upload (purchaseImport.js) and export (purchaseExport.js) ──────────────────────────────────────────
  // Purchases already recorded in the file's supply dates, to spot a file uploaded twice.
  async function loadExistingKeys({ from, to }) {
    const rows = await purchaseRepository.getAllPages(brand.id, { from, to })
    return new Set(rows.map(p => duplicateKey(p.supplier_name, p.supply_date || String(p.created_at || '').slice(0, 10), p.total_cost)))
  }
  function onImportDone(r) {
    const changed = r.recorded.flatMap(x => x.result?.changedRows || [])
    if (changed.length && setProducts) setProducts(prev => upsertProducts(prev, changed))
    if (r.recorded.length) { load(); refreshRelated() }
  }
  async function exportList(format) {
    if (!plan.allow('exporting')) return false
    let purchasesToExport
    try {
      purchasesToExport = await purchaseRepository.getAllForExport(brand.id, pageFilters())
    } catch (e) {
      console.error('[purchases] export: load failed:', e)
      showToast('Could not load the purchases to export. Check your connection and try again.', { type: 'error' })
      return false
    }
    if (!purchasesToExport.length) { showToast('There are no purchases to export for these filters.', { type: 'warning' }); return false }
    let audit = { status: 'failed' }
    try {
      const saved = await exportPurchases(format, purchasesToExport, {
        beforeDownload: async (rowCount) => {
          audit = await auditRepository.recordExport(brand.id, {
            exportType: 'purchases.' + format,
            rowCount,
            // The search term itself is not stored, only that one was applied.
            filters: { from: periodFrom || null, to: periodTo || null, supplier: supplierFilter || null, search_applied: !!search.trim(), purchases: purchasesToExport.length },
          })
          return audit.status !== 'refused'
        },
      })
      const n = purchasesToExport.length + ' purchase' + (purchasesToExport.length === 1 ? '' : 's')
      if (!saved) showToast('Your role is not allowed to export data.', { type: 'error' })
      else if (audit.status !== 'recorded') {
        console.warn('[purchases] export audit record not saved:', audit.status)
        showToast(`Exported ${n}, but the audit record could not be saved.`, { type: 'warning' })
      } else showToast(`Exported ${n}.`, { type: 'success' })
      return saved
    } catch (e) {
      console.error('[purchases] export failed:', e)
      showToast('Could not export: ' + (e?.message || 'unknown error'), { type: 'error' })
      return false
    }
  }
  const exportScope = (() => {
    const parts = []
    if (supplierFilter) parts.push('from ' + (directory.suppliers.find(x => x.key === supplierFilter)?.name || 'this supplier'))
    if (period.mode !== 'all' && !filtersUnavailable) parts.push('for ' + periodLabel.toLowerCase())
    if (search.trim()) parts.push('matching "' + search.trim() + '"')
    return parts.length ? 'the purchases ' + parts.join(' ') : 'all your purchases'
  })()

  // Every line the user has started. A started line that is incomplete blocks
  // the save (lineItems.itemProblems): it used to be dropped silently with a
  // "success" toast. Fully blank lines are ignored.
  const startedItems = form.items.filter(i => !isBlankItem(i))
  const problemLines = formLineProblems(form, inventory)

  const resolveExisting = (line) => resolveExistingProduct(inventory, line)

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
      const r = await recordPurchase({ businessId: brand.id, form, inventory, canReprice })
      // One update to the shared catalog with the rows the database returned.
      if (r.changedRows.length > 0 && setProducts) setProducts(prev => upsertProducts(prev, r.changedRows))
      const parts = ['Purchase recorded!']
      if (r.created > 0 || r.updated > 0) {
        parts.push(r.created + ' new product(s) added to Inventory, ' + r.updated + ' updated')
        if (r.newProductsAutoPriced) parts.push('new items priced at a ' + Math.round((NEW_PRODUCT_MARKUP - 1) * 100) + '% markup: adjust in Inventory anytime')
      }
      if (r.syncFailed.length > 0) parts.push('Not added to Inventory: ' + r.syncFailed.join(', ') + '. Add their stock from Inventory')
      if (r.balance > 0) parts.push(r.debtFailed ? 'The ' + fmt(r.balance) + ' balance could not be added to Debts: add it there' : 'Debt of ' + fmt(r.balance) + ' added to Debts automatically')
      const warn = r.syncFailed.length > 0 || r.debtFailed
      showToast(parts.join(' · '), { type: warn ? 'warning' : 'success', duration: warn ? 10000 : 5000 })
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
      <SectionHead title='Purchases' sub='Record supplier purchases and the payments you make on them' btn={hasDraft ? 'Resume draft' : '+ Record Purchase'} onBtn={openForm}
        extraBtns={[
          { label: 'Upload', icon: <Upload size={14} aria-hidden='true' />, onClick: () => setShowImport(true), disabled: catalogLoading, title: catalogLoading ? 'Wait for your products to load' : 'Upload purchases from Excel or CSV' },
          ...(canExport ? [{ label: 'Export', icon: <Download size={14} aria-hidden='true' />, onClick: () => setShowExport(true), title: 'Export purchases to Excel or CSV' }] : []),
          ...(canDeletePurchases ? [{ label: 'Recently deleted', icon: <RotateCcw size={14} aria-hidden='true' />, onClick: () => setShowDeleted(true) }] : []),
        ]} />

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
        <>
        {canMark && (
          <SelectionBar count={markedPurchases.length} shownCount={purchases.length} allShownSelected={allShownMarked}
            onSelectAll={() => setMarked(prev => new Set([...prev, ...purchases.map(p => p.id)]))} onClear={() => setMarked(new Set())}>
            <TealBtn onClick={() => setShowBulkEdit(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px' }}><Pencil size={13} aria-hidden='true' /> Edit selected</TealBtn>
            {canDeletePurchases && <RedBtn onClick={() => setShowBulkDelete(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px' }}><Trash2 size={13} aria-hidden='true' /> Delete selected</RedBtn>}
          </SelectionBar>
        )}
        <Card>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${border}`, background: gray50 }}>
                  {canMark && <th style={{ padding: '12px 0 12px 12px', width: 30 }}><span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>Select</span></th>}
                  {['Supplier', 'Product', 'Qty', 'Unit Cost', 'Total', 'Paid', 'Balance', 'Supply Date', 'Due Date', 'Expiry Date', 'Status', 'Action'].map(h => (
                    <th key={h} style={{ padding: '12px 12px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: gray400, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {purchases.map(p => (
                  // The whole row opens the purchase as an invoice; the supplier
                  // name is its keyboard-reachable button.
                  <tr key={p.id} onClick={() => setViewing(p)} style={{ borderBottom: `1px solid ${gray100}`, cursor: 'pointer', background: marked.has(p.id) ? tealMist : undefined }}>
                    {canMark && (
                      <td style={{ padding: '12px 0 12px 12px' }} onClick={(e) => e.stopPropagation()}>
                        <input type='checkbox' checked={marked.has(p.id)} onChange={() => toggleMarked(p.id)}
                          aria-label={`Select purchase from ${p.supplier_name}${p.supply_date ? ', ' + p.supply_date : ''}, ${fmt(p.total_cost || 0)}`} style={{ width: 18, height: 18, cursor: 'pointer', accentColor: tealDeep }} />
                      </td>
                    )}
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
        </>
      )}

      </>)}

      {showImport && (
        <PurchaseImportModal show onClose={() => setShowImport(false)} inventory={inventory} catalogReady={!catalogLoading}
          restricted={!!plan.restricted} canReprice={canReprice} loadExistingKeys={loadExistingKeys}
          record={(f, known) => recordPurchase({ businessId: brand.id, form: f, inventory: known, canReprice })}
          mergeProducts={upsertProducts} onDone={onImportDone} />
      )}
      {showExport && <PurchaseExportModal show onClose={() => setShowExport(false)} scope={exportScope} onExport={exportList} />}
      {showBulkEdit && <PurchaseBulkEditModal purchases={markedPurchases} suppliers={supplierNames} runUpdates={runPurchaseUpdates} onClose={() => setShowBulkEdit(false)} />}
      {showBulkDelete && (
        <BulkDeleteModal noun='purchase' count={markedPurchases.length} names={markedPurchases.map(p => `${purchaseLabel(p)} (${fmt(p.total_cost || 0)})`)}
          notes={[
            <>Each purchase's <strong>stock is taken back</strong> out of Inventory, and its supplier payments and its "we owe" debt are removed with it. Products it created stay in Inventory.</>,
            <>A purchase whose units were already <strong>sold or moved</strong> is <strong>kept</strong>, and you will see which and why: lower its quantities with Edit purchase instead.</>,
            <>You can <strong>restore</strong> deleted purchases afterwards from Recently deleted; their stock goes back too.</>,
          ]}
          reasonText={purchaseKeptText} keptHeading='because their stock cannot be taken back'
          describeRestore={describePurchaseRestore}
          onDelete={deleteMarked} onRestore={restoreDeletion} onClose={() => setShowBulkDelete(false)} />
      )}
      {showDeleted && (
        <RecentlyDeletedModal noun='purchase' loadDeletions={() => purchaseRepository.getDeletions(brand.id)}
          onRestore={(id) => restoreDeletion(id)} describeSkips={(r) => (r.skipped_stock ? `; ${r.skipped_stock} not restored because a product or batch they stocked is gone` : '')}
          onClose={() => setShowDeleted(false)} />
      )}

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
