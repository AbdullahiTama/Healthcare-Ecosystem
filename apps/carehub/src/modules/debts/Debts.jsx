import { useState, useEffect, useRef, useMemo } from 'react'
import { useKeyboardScanner, fieldSnapshot, restoreField } from '../../hooks/useKeyboardScanner'
import { debtTotals } from './debtTotals'
import { DEFAULT_DEBT_FILTERS, PAYMENT_STATUSES, DEBT_SOURCES, DIRECTIONS, AMOUNT_BASES, filterDebts, debtPaymentStatus, activeDebtFilterCount, describeDebtFilters } from './debtFilters'
import { Landmark, Truck, ShoppingCart, Pencil, Search, UserCheck, MapPin } from 'lucide-react'
import { debtRepository } from './repositories'
// Owners read every location's debts (the database allows it: current_business_ids()); the list of locations comes
// from the locations module's own repository.
import { locationsRepository } from '../locations/repositories'
import PeriodFilter from '../../components/PeriodFilter'
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
import { Card, StatCard, SectionHead, Modal, Pill, Inp, Sel, Textarea, GhostBtn, TealBtn, Loading, Empty, ErrorState, DataTable, useToast, Toast } from '../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, gray100, gray50, border, danger, success, bg } = theme

// `short`: the Details-column pill has less room than the Source column, so it
// uses "Sale" instead of "Credit Sale" — same icon/source mapping either way.
function sourceLabel(source, short) {
  const Icon = source === 'purchase' ? Truck : source === 'credit_sale' ? ShoppingCart : Pencil
  const text = source === 'purchase' ? 'Purchase' : source === 'credit_sale' ? (short ? 'Sale' : 'Credit Sale') : 'Manual'
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Icon size={11} /> {text}</span>
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
  const clearFilters = () => setFilters({ ...DEFAULT_DEBT_FILTERS, location: defaultLocation })
  const [page, setPage] = useState(0)
  useEffect(() => { setPage(0) }, [filters, debts.length])
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ direction: 'owes_us' })
  const [saving, setSaving] = useState(false)
  const [payTarget, setPayTarget] = useState(null)
  const [payMethod, setPayMethod] = useState('Cash')
  const [paying, setPaying] = useState(false)
  // The debt opened in full, and a purchase being paid from it.
  const [detail, setDetail] = useState(null)
  const [payingPurchase, setPayingPurchase] = useState(null)
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
    setSaving(true)
    try {
      const amt = parseFloat(form.amount) || 0
      const paid = parseFloat(form.amountPaid) || 0
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
      setForm({ direction: 'owes_us' }); setShowAdd(false); load()
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
  const filtered = useMemo(() => filterDebts(debts, filters), [debts, filters])
  const activeCount = activeDebtFilterCount(filters, defaultLocation)
  const isFiltered = activeCount > 0
  // The cards always total the rows on screen: every filter (including location) recalculates them.
  const shown = debtTotals(filtered)
  const statusCounts = useMemo(() => {
    const c = { paid: 0, partial: 0, unpaid: 0 }
    filtered.forEach(d => { c[debtPaymentStatus(d)]++ })
    return c
  }, [filtered])
  const filterLabel = describeDebtFilters(filters, { fmt, locationName, defaultLocation })
  const years = useMemo(() => yearsOf(debts.map(d => d.created_at), todayDate()), [debts])

  return (
    <div ref={rootRef}>
      <SectionHead title='Debts' sub='Track money owed to you and money you owe' btn='+ Record Debt' onBtn={() => setShowAdd(true)} />

      {/* Totals for the debts on screen: every filter recalculates them. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: '14px', marginBottom: '20px' }}>
        <Card style={{ padding: '18px', borderLeft: `4px solid ${navy}` }}>
          <div style={{ fontSize: '12px', color: gray500, fontWeight: '600' }}>Total outstanding</div>
          <div style={{ fontSize: '24px', fontWeight: '900', color: navy, marginTop: '6px' }}>{loadError ? '—' : fmt(shown.outstanding)}</div>
          <div style={{ fontSize: '11.5px', color: gray500, marginTop: '4px' }}>{shown.openOwedToUs + shown.openWeOwe} open debt{shown.openOwedToUs + shown.openWeOwe !== 1 ? 's' : ''}</div>
        </Card>
        <Card style={{ padding: '18px', borderLeft: `4px solid ${success}` }}>
          <div style={{ fontSize: '12px', color: gray500, fontWeight: '600' }}>Owed to us</div>
          <div style={{ fontSize: '24px', fontWeight: '900', color: success, marginTop: '6px' }}>{loadError ? '—' : fmt(shown.owedToUs)}</div>
          <div style={{ fontSize: '11.5px', color: gray500, marginTop: '4px' }}>{shown.openOwedToUs} open</div>
        </Card>
        <Card style={{ padding: '18px', borderLeft: `4px solid ${danger}` }}>
          <div style={{ fontSize: '12px', color: gray500, fontWeight: '600' }}>We owe others</div>
          <div style={{ fontSize: '24px', fontWeight: '900', color: danger, marginTop: '6px' }}>{loadError ? '—' : fmt(shown.weOwe)}</div>
          <div style={{ fontSize: '11.5px', color: gray500, marginTop: '4px' }}>{shown.openWeOwe} open</div>
        </Card>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '180px', display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '0 14px' }}>
          <Search size={15} color={gray400} style={{ flexShrink: 0 }} />
          <input value={filters.search} onChange={e => setFilter('search', e.target.value)} placeholder='Search customer, supplier or party name...' aria-label='Search debts by customer or party name'
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
        <FilterSelect label='Direction' value={filters.direction} onChange={v => setFilter('direction', v)} options={DIRECTIONS} />
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
          <span style={{ fontSize: '13px', color: gray600 }}>Outstanding, owed to you: <strong style={{ color: success, fontSize: '15px' }}>{fmt(shown.owedToUs)}</strong>{shown.openOwedToUs > 0 && <span style={{ color: gray500 }}> ({shown.openOwedToUs} open)</span>}</span>
          {shown.weOwe > 0 && <span style={{ fontSize: '13px', color: gray600 }}>You owe: <strong style={{ color: danger, fontSize: '15px' }}>{fmt(shown.weOwe)}</strong></span>}
          {shown.count > 0 && <span style={{ fontSize: '12px', color: gray500 }}>{statusCounts.unpaid} unpaid · {statusCounts.partial} partially paid · {statusCounts.paid} paid</span>}
        </div>
      )}

      {loading ? <Loading /> : loadError ? <ErrorState message={loadError} onRetry={load} /> : filtered.length === 0 ? (
        isFiltered
          ? <Empty icon={<Search size={40} />} message={`No debts match ${filterLabel}`} cause='filtered' action='Clear filters' onAction={clearFilters} />
          : <Empty icon={<Landmark size={40} />} message='No debts recorded' action='+ Record Debt' onAction={() => setShowAdd(true)} />
      ) : (
        <DataTable
          rows={filtered}
          page={page}
          setPage={setPage}
          pageSize={25}
          total={filtered.length}
          count={`${filtered.length} debt${filtered.length !== 1 ? 's' : ''}`}
          onRetry={load}
          columns={[
            {
              key: 'source', label: 'Source', sortable: true,
              sortValue: d => d.source || '',
              render: d => <Pill label={sourceLabel(d.source, false)} type={d.source === 'purchase' ? 'amber' : d.source === 'credit_sale' ? 'blue' : 'gray'} />,
            },
            {
              key: 'direction', label: 'Direction', sortable: true,
              render: d => <Pill label={d.direction === 'owes_us' ? 'Owed to Us' : 'We Owe'} type={d.direction === 'owes_us' ? 'green' : 'red'} />,
            },
            {
              key: 'party_name', label: 'Party', sortable: true,
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
              ? <button onClick={(e) => { e.stopPropagation(); markPaid(d) }} style={{ padding: '6px 12px', borderRadius: theme.radius.sm, border: 'none', background: tealDeep, color: 'white', fontWeight: '700', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>Mark paid</button>
              : <span style={{ fontSize: '11px', color: gray500, whiteSpace: 'nowrap' }}>Settle at {locationName(d.business_id) || 'its location'}</span>)
          )}
        />
      )}

      <Modal show={showAdd} onClose={() => { setShowAdd(false); setForm({ direction: 'owes_us' }) }} title='Record Debt'
        footer={<><GhostBtn onClick={() => { setShowAdd(false); setForm({ direction: 'owes_us' }) }} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={save} style={{ flex: 1, padding: '12px' }}>{saving ? 'Saving...' : 'Save Debt'}</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: '700', color: gray600, marginBottom: '8px' }}>Direction</div>
            <div style={{ display: 'flex', gap: '10px' }}>
              {[['owes_us', 'Client owes us'], ['we_owe', 'We owe someone']].map(([val, label]) => (
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
      {detail && isHere(detail) && (
        <DebtDetail debt={detail} brand={brand} settings={settings} canRefund={role === 'Owner' || isManagerRole(role)} showToast={showToast}
          onClose={() => setDetail(null)} onChanged={load} onMarkPaid={markPaid}
          onPay={(purchase) => { setDetail(null); setPayingPurchase(purchase) }} />
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
