import { useState, useEffect, useRef, useMemo } from 'react'
import { useKeyboardScanner, fieldSnapshot, restoreField } from '../../hooks/useKeyboardScanner'
import { debtLedgerTotals } from './debtTotals'
import { DEFAULT_DEBT_FILTERS, PAYMENT_STATUSES, DEBT_SOURCES, AMOUNT_BASES, filterDebts, debtPaymentStatus, activeDebtFilterCount, describeDebtFilters } from './debtFilters'
import { Landmark, Truck, ShoppingCart, Pencil, Search, UserCheck, MapPin, Trash2, RotateCcw, Upload, Download, AlertTriangle } from 'lucide-react'
import { debtRepository } from './repositories'
// Owners read every location's debts (the database allows it: current_business_ids()); the list of locations comes
// from the locations module's own repository.
import { locationsRepository } from '../locations/repositories'
import PeriodFilter from '../../components/PeriodFilter'
import SelectionBar from '../../components/SelectionBar'
import BulkDeleteModal from '../../components/BulkDeleteModal'
import RecentlyDeletedModal from '../../components/RecentlyDeletedModal'
import { runBulkUpdates } from '../../lib/bulkUpdates'
import DebtBulkEditModal from './components/DebtBulkEditModal'
import DebtPaymentModal from './components/DebtPaymentModal'
import DebtImportModal from './components/DebtImportModal'
import ExportFormatModal from '../../components/ExportFormatModal'
import { auditedExport, exportColumns } from '../../lib/auditedExport'
import { debtExportColumns, debtExportRows } from './debtImport'
import { FilterPanel, FilterSelect, AmountRangeFilter } from '../../components/RecordFilters'
import { yearsOf } from '../../lib/recordFilters'
import { useQueryParamAction } from '../../hooks/useQueryParamAction'
import { settleDebt } from './settleDebt'
import { paymentErrorMessage } from '../../lib/dbErrors'
// Cross-aggregate read: the client list belongs to the clients module, which
// exposes it through its own repository. `getClients` is still the shared
// services/supabase read used by POS too — repoint it when that call is
// consolidated; it is unrelated to this module's own aggregate.
import { useClients, useSettings, useInvalidateSales } from '../../hooks/queries'
import ClientsLoadNote from '../clients/components/ClientsLoadNote'
// A debt raised by a credit sale is settled against that sale, through the
// sales aggregate's own collection function, so the two never disagree.
import { saleRepository, paymentRepository, isMissingObject } from '../pos/repositories'
import DebtDetail, { DebtSummary } from './DebtDetail'
import { PurchasePaymentModal } from '../purchases/SupplierPayments'
import { isManagerRole } from '../../lib/permissions'
import { fmt, todayDate } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { Card, SectionHead, Modal, Pill, Inp, Sel, Textarea, GhostBtn, TealBtn, RedBtn, Loading, Empty, ErrorState, DataTable, useToast, Toast } from '../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, gray100, gray50, border, danger, success, bg } = theme

// The two ledgers: Receivables (customers and others who owe the business) and Payables (suppliers and others it
// owes). Every debt is in exactly one, by its direction.
export const DEBT_TABS = [
  ['owes_us', 'Receivables', 'Owed to the business'],
  ['we_owe', 'Payables', 'Owed by the business'],
]
const isManual = (d) => (d?.source || 'manual') === 'manual'

// `short`: the Details-column pill has less room than the Source column, so it
// uses "Sale" instead of "Credit Sale" — same icon/source mapping either way.
function sourceLabel(source, short) {
  const Icon = source === 'purchase' ? Truck : source === 'credit_sale' ? ShoppingCart : Pencil
  const text = source === 'purchase' ? 'Purchase' : source === 'credit_sale' ? (short ? 'Sale' : 'Credit Sale') : 'Manual'
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Icon size={11} /> {text}</span>
}

// Why delete_debts kept a debt (it belongs to the sale or purchase that raised it).
export function debtKeptText(reasons, kept) {
  const ref = kept?.ref ? ' ' + kept.ref : ''
  return (reasons || []).map((r) => (r === 'credit_sale' ? `from credit sale${ref}: record the payment, or correct or delete the sale, instead`
    : r === 'purchase' ? `from purchase${ref}: record the payment, or correct or delete the purchase, instead` : r)).join(', ')
}

export default function Debts({ brand, role, perms, staffName }) {
  const [debts, setDebts] = useState([])
  // Shared, cached client list (React Query): one download for every page that
  // picks a client, instead of each page fetching all clients and hiding failures.
  const clientsQuery = useClients(brand?.id)
  // A repayment moves the sale's balance and today's money received.
  const invalidateSales = useInvalidateSales(brand?.id)
  const clients = clientsQuery.data || []
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  // Every filter in one object (debtFilters.js). With several locations loaded the default view is the location in
  // use, as before; "All locations" and the other branches are a choice away.
  const [locations, setLocations] = useState([])
  const multiLocation = locations.length > 1
  const defaultLocation = multiLocation ? String(brand?.id) : ''
  const [filters, setFilters] = useState(DEFAULT_DEBT_FILTERS)
  const setFilter = (k, v) => setFilters(p => ({ ...p, [k]: v }))
  // Receivables or Payables; the direction filter is the tab.
  const [tab, setTab] = useState('owes_us')
  const receivables = tab === 'owes_us'
  const clearFilters = () => setFilters({ ...DEFAULT_DEBT_FILTERS, location: defaultLocation })
  const [page, setPage] = useState(0)
  useEffect(() => { setPage(0) }, [filters, debts.length, tab])
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ direction: 'owes_us' })
  const [saving, setSaving] = useState(false)
  const [payTarget, setPayTarget] = useState(null)
  const [payMethod, setPayMethod] = useState('Cash')
  const [paying, setPaying] = useState(false)
  // The debt opened in full, and a purchase being paid from it.
  const [detail, setDetail] = useState(null)
  const [payingPurchase, setPayingPurchase] = useState(null)
  // A hand-recorded debt being paid (full or part, with its history); import and export dialogs.
  const [payingDebt, setPayingDebt] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const canExport = role === 'Owner' || !!perms?.canExportReports
  const { data: settings } = useSettings(brand?.id)
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  useEffect(() => { load() }, [brand?.id])
  // Opened from the Owner's activity feed: ?debt=<id> shows that debt once the list is in.
  useQueryParamAction('debt', (id) => { const d = debts.find((x) => String(x.id) === id); if (d) setDetail(d) }, !loading && !loadError)

  // Picking a saved client links the debt to their customer record so it
  // shows up on their history.
  function pickClient(name) {
    const c = clients.find(x => x.full_name === name)
    setForm(p => ({ ...p, party: name, client_id: c?.id || null }))
  }

  // An owner with branches gets every location's debts in one read, so the location filter and the totals switch
  // instantly. If the locations cannot be listed, the page falls back to this location alone (as before).
  async function loadLocations() {
    if (role !== 'Owner') return []
    try {
      const all = await locationsRepository.getAll(brand.id)
      return (all || []).filter(l => l && l.id && !l.deleted_at)
    } catch (e) {
      console.warn('[debts] could not list locations; showing this location only:', e?.message)
      return []
    }
  }

  async function load() {
    setLoading(true)
    setLoadError('')
    try {
      const locs = await loadLocations()
      const many = locs.length > 1
      const d = many ? await debtRepository.getForBusinesses(locs.map(l => l.id)) : await debtRepository.getAll(brand.id)
      setLocations(many ? locs : [])
      // First load (or the locations changed): the default view is the location in use.
      setFilters(p => ({ ...p, location: many ? (p.location && (p.location === 'all' || locs.some(l => String(l.id) === p.location)) ? p.location : String(brand.id)) : '' }))
      setDebts(d || [])
    } catch (e) {
      // Shown in place of the list: a failed load must not read as "no debts".
      console.error('[debts] load failed:', e)
      setLoadError("We couldn't load your debts. Check your connection and try again.")
    }
    setLoading(false)
  }

  async function save() {
    if (!form.party || !form.amount) { showToast('Please enter party name and amount.', { type: 'warning' }); return }
    const amt = parseFloat(form.amount) || 0
    const paid = parseFloat(form.amountPaid) || 0
    if (amt <= 0 || paid < 0) { showToast('Enter an amount greater than zero.', { type: 'warning' }); return }
    if (paid > amt) { showToast('The amount already paid cannot be more than the total amount.', { type: 'warning' }); return }
    setSaving(true)
    try {
      await debtRepository.create(brand.id, {
        client_id: form.client_id || null,
        direction: form.direction || 'owes_us',
        party_name: form.party,
        amount: amt,
        amount_paid: paid,
        balance: amt - paid,
        due_date: form.dueDate || '',
        status: paid >= amt ? 'paid' : 'pending',
        description: form.description || '',
      })
      showToast('Debt recorded!', { type: 'success' })
      setForm({ direction: tab }); setShowAdd(false); load()
    } catch (e) { showToast('Could not save debt. Please try again.', { type: 'error' }) }
    setSaving(false)
  }

  // A credit-sale debt is settled through record_sale_payment(): the sale,
  // the debt and the payments ledger move together, and the method feeds the
  // Sales & Accounts report. Previously only the debt changed, so the sale
  // kept showing the balance as owed. Before the accounting migration exists
  // (or when the sale cannot be found) the debt-only update is kept.
  function markPaid(debt) {
    if (debt.source === 'credit_sale' && debt.source_ref) { setPayMethod('Cash'); setPayTarget(debt); return }
    // A debt recorded by hand or imported: full or part payment, kept in its payment history.
    if (isManual(debt)) { setPayingDebt(debt); return }
    markDebtPaid(debt)
  }

  async function settleSaleDebt() {
    const debt = payTarget
    setPaying(true)
    try {
      const sale = await saleRepository.getById(brand.id, debt.source_ref)
      const owed = sale ? Math.max(Number(sale.total || 0) - Math.min(Number(sale.amount_paid || 0), Number(sale.total || 0)), 0) : 0
      if (sale && owed > 0) {
        try {
          await paymentRepository.recordCollection(sale.id, owed, payMethod)
          setPayTarget(null); load(); invalidateSales(); showToast('Marked as paid! ' + fmt(owed) + ' recorded against ' + debt.source_ref + '.', { type: 'success' })
          return
        } catch (e) {
          if (!isMissingObject(e)) { showToast(paymentErrorMessage(e), { type: 'error' }); return }
        }
      }
      setPayTarget(null)
      await markDebtPaid(debt)
    } catch (e) {
      showToast('Could not mark as paid. Please try again.', { type: 'error' })
    } finally { setPaying(false) }
  }

  async function markDebtPaid(debt) {
    try {
      const { via } = await settleDebt(debt, brand.id, { staffName })
      load(); invalidateSales()
      showToast(via === 'purchase' ? 'Marked as paid. The purchase is settled too.' : 'Marked as paid!', { type: 'success' })
    } catch (e) {
      console.error('[debts] mark paid failed:', e)
      showToast(paymentErrorMessage(e), { type: 'error' })
    }
  }

  // A USB barcode scanner types the code into whichever field has focus, then
  // presses Enter. Debts has no barcode field, so a scan is never meant here:
  // it typed the code into a debt's amount, a payment or refund amount, a
  // quantity or price in an opened sale, or the search, and its Enter pressed a
  // focused Save Debt or Mark paid (which settles a hand-entered debt at once).
  // A scan anywhere on this screen, its dialogs included, now puts the field it
  // was typed into back as it was, is explained, and presses nothing. Text areas
  // (Description, notes) and fields outside this screen are left alone.
  const rootRef = useRef(null)
  useKeyboardScanner({
    ignore: (e) => {
      const t = e.target
      const root = rootRef.current
      if (!root || !t || t.tagName === 'TEXTAREA' || t.isContentEditable) return true
      return (t.tagName === 'INPUT' || t.tagName === 'SELECT') && !root.contains(t)
    },
    snapshot: (e) => fieldSnapshot(e.target),
    onScan: (code, field) => {
      restoreField(field)
      showToast('Scan ignored (' + code + '): Debts has no barcode field, so nothing was changed.', { type: 'warning' })
    },
  }, { window: true })


  const locationName = (id) => {
    const l = locations.find(x => String(x.id) === String(id))
    return l ? (l.branch_name || l.location_label || l.name || 'Location') : ''
  }
  // A debt of another location is shown and counted, but settled from that location (switch to it first): its
  // sale, purchase, receipt settings and staff attribution all belong there.
  const isHere = (d) => !d.business_id || String(d.business_id) === String(brand?.id)
  const filtered = useMemo(() => filterDebts(debts, { ...filters, direction: tab }), [debts, filters, tab])
  const activeCount = activeDebtFilterCount({ ...filters, direction: '' }, defaultLocation)
  const isFiltered = activeCount > 0
  // The cards always total the rows on screen: the tab and every filter (including location) recalculate them.
  const shown = debtLedgerTotals(filtered)
  // Each tab's outstanding total for the location in view (filters other than location do not change the tab label).
  const tabTotals = useMemo(() => Object.fromEntries(DEBT_TABS.map(([dir]) => [dir, debtLedgerTotals(filterDebts(debts, { location: filters.location, direction: dir }))])), [debts, filters.location])
  const statusCounts = useMemo(() => {
    const c = { paid: 0, partial: 0, unpaid: 0 }
    filtered.forEach(d => { c[debtPaymentStatus(d)]++ })
    return c
  }, [filtered])
  const filterLabel = describeDebtFilters(filters, { fmt, locationName, defaultLocation })
  const years = useMemo(() => yearsOf(debts.map(d => d.created_at), todayDate()), [debts])

  // ── Bulk actions: mark this location's debts, edit them together, delete them (restorable) ──────────────────
  // Another location's debts cannot be marked: like settling, they are changed from their own location.
  const [marked, setMarked] = useState(() => new Set())
  const [showBulkEdit, setShowBulkEdit] = useState(false)
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [showDeleted, setShowDeleted] = useState(false)
  const canBulkDelete = role === 'Owner' || !!perms?.canDelete
  const markable = useMemo(() => filtered.filter(isHere), [filtered, brand?.id])
  const markedDebts = debts.filter(d => marked.has(d.id) && isHere(d))
  const allShownMarked = markable.length > 0 && markable.every(d => marked.has(d.id))
  const toggleMarked = (id) => setMarked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  useEffect(() => { setMarked(new Set()) }, [brand?.id])
  async function runDebtUpdates(groups, onProgress) {
    const r = await runBulkUpdates(groups, (ids, updates) => debtRepository.updateMany(brand.id, ids, updates), { onProgress })
    if (r.saved.length) {
      const byId = new Map(r.saved.map(x => [String(x.id), x]))
      setDebts(prev => prev.map(x => (byId.has(String(x.id)) ? { ...x, ...byId.get(String(x.id)) } : x)))
    }
    if (r.failed.length) console.error('[debts] bulk edit: some updates failed', r.failed.map(f => f.message))
    else console.info('[debts] bulk edit saved', { debts: r.saved.length })
    return r
  }
  async function deleteMarked() {
    const r = await debtRepository.deleteMany(brand.id, markedDebts.map(d => d.id))
    console.info('[debts] deleted', { deleted: r.deleted, kept: (r.kept || []).length })
    setMarked(new Set())
    load()
    return r
  }
  async function restoreDeletion(deletionId) {
    try {
      const r = await debtRepository.restoreDeleted(brand.id, deletionId)
      load()
      showToast(`${r.restored} debt${r.restored === 1 ? '' : 's'} restored.${r.client_unlinked ? ` ${r.client_unlinked} no longer linked to a client (the client was deleted).` : ''}`, { type: 'success' })
      return r
    } catch (e) {
      showToast(e?.message || 'Could not restore. Please try again.', { type: 'error' })
      throw e
    }
  }
  // ── Import (DebtImportModal → import_debts) and export (the rows on screen) ──────────────────────────────────
  function onImported(r) {
    // The dialog refreshes the cached customers, supplier accounts and debt lists itself.
    load()
    console.info('[debts] import finished', { direction: tab, ...r.summary })
  }
  async function exportShown(format) {
    const clientsById = new Map(clients.map(c => [String(c.id), c]))
    const statusLabel = (d) => PAYMENT_STATUSES.find(([k]) => k === debtPaymentStatus(d))[1]
    return auditedExport({
      format, rows: debtExportRows(filtered, { clientsById, statusLabel }),
      columns: exportColumns(debtExportColumns(tab), ['amount', 'paid', 'balance']),
      sheetName: receivables ? 'Receivables' : 'Payables', fileBase: receivables ? 'CareHub_Receivables' : 'CareHub_Payables',
      businessId: brand.id, exportType: 'debts', noun: 'debt', showToast, logTag: '[debts]',
      // The search text itself is not stored, only that one was applied.
      filters: { direction: tab, status: filters.status || null, source: filters.source || null, location: filters.location || null, search_applied: !!filters.search.trim(), debts: filtered.length },
    })
  }

  const describeRestore = (r) => (r?.client_unlinked ? `${r.client_unlinked} no longer linked to a client, because the client was deleted; the name is kept.` : '')

  return (
    <div ref={rootRef}>
      <SectionHead title='Debts' sub='Receivables (owed to you) and payables (what you owe), with every payment' btn='+ Record Debt' onBtn={() => { setForm({ direction: tab }); setShowAdd(true) }}
        extraBtns={[
          { label: 'Import', icon: <Upload size={14} aria-hidden='true' />, onClick: () => setShowImport(true), title: `Import ${receivables ? 'receivables' : 'payables'} from Excel or CSV` },
          ...(canExport ? [{ label: 'Export', icon: <Download size={14} aria-hidden='true' />, onClick: () => setShowExport(true), title: `Export ${receivables ? 'receivables' : 'payables'} to Excel or CSV` }] : []),
          ...(canBulkDelete ? [{ label: 'Recently deleted', icon: <RotateCcw size={14} aria-hidden='true' />, onClick: () => setShowDeleted(true) }] : []),
        ]} />

      <div role='tablist' aria-label='Receivables and payables' style={{ display: 'flex', gap: 24, borderBottom: `1px solid ${border}`, marginBottom: 16, overflowX: 'auto' }}>
        {DEBT_TABS.map(([dir, label, hint]) => {
          const on = tab === dir
          const t = tabTotals[dir]
          return (
            <button key={dir} type='button' role='tab' id={`debts-tab-${dir}`} aria-selected={on} aria-controls='debts-panel' onClick={() => { setTab(dir); setMarked(new Set()) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '10px 2px', marginBottom: -1, textAlign: 'left', borderBottom: on ? `2px solid ${tealDeep}` : '2px solid transparent', whiteSpace: 'nowrap' }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: on ? 800 : 600, color: on ? tealDeep : gray600 }}>{label}</span>
              <span style={{ display: 'block', fontSize: 11.5, color: gray500 }}>{hint}{!loading && !loadError ? ` · ${fmt(t.balance)}` : ''}</span>
            </button>
          )
        })}
      </div>

      <div id='debts-panel' role='tabpanel' aria-labelledby={`debts-tab-${tab}`}>
      {/* Totals for the debts on screen: the tab and every filter recalculate them. Amount = paid + outstanding. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: '14px', marginBottom: '20px' }}>
        <Card style={{ padding: '18px', borderLeft: `4px solid ${receivables ? success : danger}` }}>
          <div style={{ fontSize: '12px', color: gray500, fontWeight: '600' }}>{receivables ? 'Outstanding: owed to you' : 'Outstanding: you owe'}</div>
          <div style={{ fontSize: '24px', fontWeight: '900', color: receivables ? success : danger, marginTop: '6px' }}>{loadError ? '—' : fmt(shown.balance)}</div>
          <div style={{ fontSize: '11.5px', color: gray500, marginTop: '4px' }}>{shown.open} open debt{shown.open !== 1 ? 's' : ''}</div>
        </Card>
        <Card style={{ padding: '18px', borderLeft: `4px solid ${navy}` }}>
          <div style={{ fontSize: '12px', color: gray500, fontWeight: '600' }}>{receivables ? 'Total owed' : 'Total supplied / owed'}</div>
          <div style={{ fontSize: '24px', fontWeight: '900', color: navy, marginTop: '6px' }}>{loadError ? '—' : fmt(shown.amount)}</div>
          <div style={{ fontSize: '11.5px', color: gray500, marginTop: '4px' }}>{shown.count} debt{shown.count !== 1 ? 's' : ''}</div>
        </Card>
        <Card style={{ padding: '18px', borderLeft: `4px solid ${tealDeep}` }}>
          <div style={{ fontSize: '12px', color: gray500, fontWeight: '600' }}>{receivables ? 'Payments received' : 'Payments made'}</div>
          <div style={{ fontSize: '24px', fontWeight: '900', color: tealDeep, marginTop: '6px' }}>{loadError ? '—' : fmt(shown.paid)}</div>
          <div style={{ fontSize: '11.5px', color: gray500, marginTop: '4px' }}>Total owed − payments = outstanding</div>
        </Card>
      </div>
      {!loading && !loadError && shown.unreconciled > 0 && (
        <div role='status' style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', marginBottom: 14, borderRadius: theme.radius.md, background: theme.warningBg, border: `1px solid ${theme.warning}`, fontSize: 12.5, color: navy }}>
          <AlertTriangle size={15} color={theme.warning} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden='true' />
          <span>{shown.unreconciled} debt{shown.unreconciled === 1 ? '' : 's'} on screen {shown.unreconciled === 1 ? 'has' : 'have'} an outstanding balance that is not its amount less what was paid (recorded before payment history was kept). Open {shown.unreconciled === 1 ? 'it' : 'them'} to check.</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '180px', display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '0 14px' }}>
          <Search size={15} color={gray400} style={{ flexShrink: 0 }} />
          <input value={filters.search} onChange={e => setFilter('search', e.target.value)} placeholder={receivables ? 'Search customer name...' : 'Search supplier or party name...'} aria-label={receivables ? 'Search receivables by customer name' : 'Search payables by supplier or party name'}
            style={{ flex: 1, padding: '10px 0', border: 'none', fontSize: '13px', outline: 'none', background: 'transparent', color: navy, minWidth: 0 }} />
        </div>
      </div>

      <FilterPanel title='Debt filters' activeCount={activeCount} onClear={clearFilters}>
        <div style={{ gridColumn: '1 / -1' }}>
          <PeriodFilter value={filters.period} onChange={v => setFilter('period', v)} years={years} label='Date recorded' />
        </div>
        {multiLocation && (
          <FilterSelect label='Location' value={filters.location === 'all' ? '' : filters.location} allLabel='All locations'
            onChange={v => setFilter('location', v || 'all')}
            options={locations.map(l => [String(l.id), locationName(l.id) + (String(l.id) === String(brand?.id) ? ' (this location)' : '')])} />
        )}
        <FilterSelect label='Payment status' value={filters.status} onChange={v => setFilter('status', v)} options={PAYMENT_STATUSES} />
        <FilterSelect label='Transaction type / source' value={filters.source} onChange={v => setFilter('source', v)} options={DEBT_SOURCES} />
        <AmountRangeFilter label='Amount range (₦)' value={filters.amount} onChange={v => setFilter('amount', v)}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: gray600, marginBottom: 6 }}>
            <span>Compare</span>
            <select aria-label='Amount to compare' value={filters.amountBasis} onChange={e => setFilter('amountBasis', e.target.value)}
              style={{ flex: 1, minHeight: 34, padding: '4px 8px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 12.5, color: navy, background: 'white' }}>
              {AMOUNT_BASES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </AmountRangeFilter>
      </FilterPanel>

      {isFiltered && !loading && !loadError && (
        <div role='status' aria-live='polite' style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 18px', padding: '12px 16px', marginBottom: '14px', borderRadius: theme.radius.md, background: 'white', border: `1px solid ${border}` }}>
          <span style={{ fontSize: '12.5px', color: gray600 }}>{shown.count} debt{shown.count !== 1 ? 's' : ''} for {filterLabel}</span>
          <span style={{ fontSize: '13px', color: gray600 }}>Outstanding: <strong style={{ color: receivables ? success : danger, fontSize: '15px' }}>{fmt(shown.balance)}</strong>{shown.open > 0 && <span style={{ color: gray500 }}> ({shown.open} open)</span>}</span>
          {shown.count > 0 && <span style={{ fontSize: '12px', color: gray500 }}>{statusCounts.unpaid} unpaid · {statusCounts.partial} partially paid · {statusCounts.paid} paid</span>}
        </div>
      )}

      {loading ? <Loading /> : loadError ? <ErrorState message={loadError} onRetry={load} /> : filtered.length === 0 ? (
        isFiltered
          ? <Empty icon={<Search size={40} />} message={`No debts match ${filterLabel}`} cause='filtered' action='Clear filters' onAction={clearFilters} />
          : <Empty icon={<Landmark size={40} />} message={receivables ? 'No receivables recorded' : 'No payables recorded'} action='+ Record Debt' onAction={() => { setForm({ direction: tab }); setShowAdd(true) }} />
      ) : (
        <>
        <SelectionBar count={markedDebts.length} shownCount={markable.length} allShownSelected={allShownMarked}
          onSelectAll={() => setMarked(prev => new Set([...prev, ...markable.map(d => d.id)]))} onClear={() => setMarked(new Set())}>
          <TealBtn onClick={() => setShowBulkEdit(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px' }}><Pencil size={13} aria-hidden='true' /> Edit selected</TealBtn>
          {canBulkDelete && <RedBtn onClick={() => setShowBulkDelete(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px' }}><Trash2 size={13} aria-hidden='true' /> Delete selected</RedBtn>}
        </SelectionBar>
        <DataTable
          rows={filtered}
          page={page}
          setPage={setPage}
          pageSize={25}
          total={filtered.length}
          count={`${filtered.length} debt${filtered.length !== 1 ? 's' : ''}`}
          onRetry={load}
          rowStyle={d => (marked.has(d.id) && isHere(d) ? { background: tealMist } : {})}
          columns={[
            {
              key: 'select', label: <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>Select</span>,
              render: d => (isHere(d)
                ? <input type='checkbox' checked={marked.has(d.id)} onChange={() => toggleMarked(d.id)} onClick={e => e.stopPropagation()}
                    aria-label={`Select debt: ${d.party_name || 'Unnamed'}, ${fmt(d.balance || 0)} outstanding`} style={{ width: 18, height: 18, cursor: 'pointer', accentColor: tealDeep }} />
                : null),
            },
            {
              key: 'source', label: 'Source', sortable: true,
              sortValue: d => d.source || '',
              render: d => <Pill label={sourceLabel(d.source, false)} type={d.source === 'purchase' ? 'amber' : d.source === 'credit_sale' ? 'blue' : 'gray'} />,
            },
            {
              key: 'party_name', label: receivables ? 'Customer' : 'Supplier / party', sortable: true,
              render: d => (
                <>
                  {/* The row opens the debt in full; the name is its keyboard-reachable button. */}
                  <button type='button' onClick={(e) => { e.stopPropagation(); setDetail(d) }} aria-label={`View debt: ${d.party_name}`}
                    style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: '700', fontSize: '13px', color: navy, cursor: 'pointer', textAlign: 'left', textDecoration: 'underline', textDecorationColor: theme.gray100, textUnderlineOffset: 3 }}>
                    {d.party_name}
                  </button>
                  {d.client_id && <div style={{ marginTop: '4px' }}><Pill label={<> <UserCheck size={10} /> Client record</>} type='teal' /></div>}
                </>
              ),
            },
            ...(multiLocation ? [{
              key: 'business_id', label: 'Location', sortable: true,
              sortValue: d => locationName(d.business_id),
              render: d => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '12px', color: gray600 }}><MapPin size={11} aria-hidden='true' />{locationName(d.business_id) || 'Unknown'}</span>,
            }] : []),
            {
              key: 'description', label: 'Details', sortable: true,
              render: d => (
                <span style={{ fontSize: '12px', color: gray500, maxWidth: '200px', display: 'block' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{d.description || 'Not set'}</span>
                  {d.source && <div style={{ marginTop: '4px' }}><Pill label={sourceLabel(d.source, true)} type={d.source === 'purchase' ? 'amber' : d.source === 'credit_sale' ? 'blue' : 'gray'} /></div>}
                </span>
              ),
            },
            {
              key: 'amount', label: 'Amount', sortable: true, align: 'right',
              render: d => <span style={{ fontSize: '13px', fontWeight: '700', color: navy }}>{fmt(d.amount)}</span>,
            },
            {
              key: 'amount_paid', label: 'Paid', sortable: true, align: 'right',
              render: d => <span style={{ fontSize: '13px', color: success }}>{fmt(d.amount_paid || 0)}</span>,
            },
            {
              key: 'balance', label: 'Balance', sortable: true, align: 'right',
              render: d => <span style={{ fontSize: '13px', fontWeight: '900', color: (d.balance || 0) > 0 ? danger : success }}>{fmt(d.balance || 0)}</span>,
            },
            {
              key: 'due_date', label: 'Due Date', sortable: true,
              render: d => <span style={{ fontSize: '12px', color: gray400 }}>{d.due_date || 'Not set'}</span>,
            },
            {
              key: 'status', label: 'Status', sortable: true,
              sortValue: d => debtPaymentStatus(d),
              render: d => {
                const st = debtPaymentStatus(d)
                return <Pill label={PAYMENT_STATUSES.find(([k]) => k === st)[1]} type={st === 'paid' ? 'green' : st === 'partial' ? 'blue' : 'amber'} />
              },
            },
          ]}
          onRowClick={d => setDetail(d)}
          actions={d => (
            d.status !== 'paid' && (isHere(d)
              ? <button onClick={(e) => { e.stopPropagation(); markPaid(d) }} aria-label={`${isManual(d) ? 'Record payment' : 'Mark paid'}: ${d.party_name || 'debt'}`} style={{ padding: '6px 12px', minHeight: 32, borderRadius: theme.radius.sm, border: 'none', background: tealDeep, color: 'white', fontWeight: '700', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>{isManual(d) ? 'Record payment' : 'Mark paid'}</button>
              : <span style={{ fontSize: '11px', color: gray500, whiteSpace: 'nowrap' }}>Settle at {locationName(d.business_id) || 'its location'}</span>)
          )}
        />
        </>
      )}
      </div>

      {showBulkEdit && <DebtBulkEditModal debts={markedDebts} runUpdates={runDebtUpdates} onClose={() => setShowBulkEdit(false)} />}
      {showBulkDelete && (
        <BulkDeleteModal noun='debt' count={markedDebts.length} names={markedDebts.map(d => `${d.party_name || 'Unnamed'} (${fmt(d.balance || 0)} outstanding)`)}
          notes={[
            <>Only debts <strong>recorded by hand</strong> are deleted. A debt from a credit sale or a purchase is <strong>kept</strong>, because it belongs to that sale or purchase; you will see which and why.</>,
            <>Deleting a debt does not record a payment: if it was paid, use Mark paid instead, so the money is counted.</>,
            <>You can <strong>restore</strong> deleted debts afterwards from Recently deleted.</>,
          ]}
          reasonText={debtKeptText} keptHeading='because they belong to a sale or a purchase'
          describeRestore={describeRestore}
          onDelete={deleteMarked} onRestore={restoreDeletion} onClose={() => setShowBulkDelete(false)} />
      )}
      {showDeleted && (
        <RecentlyDeletedModal noun='debt' loadDeletions={() => debtRepository.getDeletions(brand.id)}
          onRestore={(id) => restoreDeletion(id)} describeSkips={(r) => (r.client_unlinked ? `; ${r.client_unlinked} no longer linked to a deleted client` : '')}
          onClose={() => setShowDeleted(false)} />
      )}

      <Modal show={showAdd} onClose={() => { setShowAdd(false); setForm({ direction: tab }) }} title='Record Debt'
        footer={<><GhostBtn onClick={() => { setShowAdd(false); setForm({ direction: tab }) }} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={save} style={{ flex: 1, padding: '12px' }}>{saving ? 'Saving...' : 'Save Debt'}</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: '700', color: gray600, marginBottom: '8px' }}>Direction</div>
            <div style={{ display: 'flex', gap: '10px' }}>
              {[['owes_us', 'Receivable: owed to us'], ['we_owe', 'Payable: we owe']].map(([val, label]) => (
                <label key={val} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 14px', borderRadius: theme.radius.md, border: `1px solid ${form.direction === val ? tealDeep : border}`, background: form.direction === val ? tealMist : 'white', cursor: 'pointer', fontSize: '13px', color: navy }}>
                  <input type='radio' checked={form.direction === val} onChange={() => f('direction', val)} style={{ accentColor: tealDeep }} />{label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: '700', color: gray600, marginBottom: '6px' }}>Party Name *</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '0 14px' }}>
              <Search size={15} color={gray400} style={{ flexShrink: 0 }} />
              <input list='debt-clients' value={form.party || ''} onChange={e => pickClient(e.target.value)} placeholder='Pick a saved client or type a name...'
                style={{ flex: 1, padding: '10px 0', border: 'none', fontSize: '13px', outline: 'none', background: 'transparent', color: navy, minWidth: 0 }} />
              <datalist id='debt-clients'>
                {clients.map(c => <option key={c.id} value={c.full_name} />)}
              </datalist>
              <ClientsLoadNote query={clientsQuery} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Inp label='Total Amount (₦) *' value={form.amount} onChange={v => f('amount', v)} type='number' placeholder='0' required />
            <Inp label='Amount Already Paid (₦)' value={form.amountPaid} onChange={v => f('amountPaid', v)} type='number' placeholder='0' />
          </div>
          {form.amount && <div style={{ padding: '10px 14px', borderRadius: theme.radius.md, background: bg, display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
            <span style={{ color: gray500 }}>Balance remaining</span>
            <span style={{ fontWeight: '900', color: danger }}>{fmt((parseFloat(form.amount) || 0) - (parseFloat(form.amountPaid) || 0))}</span>
          </div>}
          <Inp label='Due Date' value={form.dueDate} onChange={v => f('dueDate', v)} type='date' />
          <Textarea label='Description' value={form.description} onChange={v => f('description', v)} placeholder='What is this debt for?' rows={2} />
        </div>
      </Modal>

      <Modal show={!!payTarget} onClose={() => setPayTarget(null)} title='Record payment'
        footer={<><GhostBtn onClick={() => setPayTarget(null)} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={settleSaleDebt} disabled={paying} style={{ flex: 1, padding: '12px' }}>{paying ? 'Saving…' : 'Mark paid'}</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ padding: '12px', borderRadius: theme.radius.md, background: bg, fontSize: '13px', color: gray600 }}>
            {payTarget?.party_name} pays the remaining <strong>{fmt(payTarget?.balance)}</strong> on sale {payTarget?.source_ref}.
          </div>
          <div role='radiogroup' aria-label='Paid by' style={{ display: 'flex', gap: '8px' }}>
            {['Cash', 'Transfer', 'POS'].map(m => (
              <button key={m} role='radio' aria-checked={payMethod === m} onClick={() => setPayMethod(m)}
                style={{ flex: 1, padding: '10px 0', borderRadius: theme.radius.md, fontWeight: 700, fontSize: '13px', cursor: 'pointer', border: `1px solid ${payMethod === m ? tealDeep : border}`, background: payMethod === m ? tealMist : 'white', color: payMethod === m ? tealDeep : gray600 }}>{m}</button>
            ))}
          </div>
        </div>
      </Modal>

      {detail && !isHere(detail) && (
        <OtherLocationDebt debt={detail} locationName={locationName(detail.business_id)} onClose={() => setDetail(null)} />
      )}
      {detail && isHere(detail) && isManual(detail) && (
        <DebtPaymentModal brand={brand} debt={detail} staffName={staffName} showToast={showToast} onClose={() => setDetail(null)} onPaid={load} />
      )}
      {detail && isHere(detail) && !isManual(detail) && (
        <DebtDetail debt={detail} brand={brand} settings={settings} canRefund={role === 'Owner' || isManagerRole(role)} showToast={showToast}
          onClose={() => setDetail(null)} onChanged={load} onMarkPaid={markPaid}
          onPay={(purchase) => { setDetail(null); setPayingPurchase(purchase) }} />
      )}
      {payingDebt && (
        <DebtPaymentModal brand={brand} debt={payingDebt} staffName={staffName} showToast={showToast} onClose={() => setPayingDebt(null)} onPaid={load} />
      )}
      {showImport && <DebtImportModal brand={brand} direction={tab} onClose={() => setShowImport(false)} onDone={onImported} />}
      {showExport && (
        <ExportFormatModal show onClose={() => setShowExport(false)} onExport={exportShown} title={`Export ${receivables ? 'receivables' : 'payables'}`} name='debt-export-format'
          description={`Exports the ${filtered.length} ${receivables ? 'receivable' : 'payable'}${filtered.length === 1 ? '' : 's'} on screen (with the filters applied), in the same columns as the import template, with each debt's balance and status. The export is recorded in the audit log.`} />
      )}
      {payingPurchase && (
        <PurchasePaymentModal brand={brand} purchase={payingPurchase} staffName={staffName} showToast={showToast}
          onPaid={load} onClose={() => setPayingPurchase(null)} />
      )}

      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}

// A debt of another location opened from the "All locations" view: what it is, and where to settle it.
function OtherLocationDebt({ debt, locationName, onClose }) {
  return <DebtSummary debt={debt} onClose={onClose} note={`This debt belongs to ${locationName || 'another location'}. Switch to that location to open its sale or purchase, or to record a payment.`} />
}
