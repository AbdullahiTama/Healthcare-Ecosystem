import { useState, useEffect } from 'react'
import { debtTotals, matchesParty } from './debtTotals'
import { Landmark, Truck, ShoppingCart, Pencil, Search, UserCheck } from 'lucide-react'
import { debtRepository } from './repositories'
import { settleDebt } from './settleDebt'
import { paymentErrorMessage } from '../../lib/dbErrors'
// Cross-aggregate read: the client list belongs to the clients module, which
// exposes it through its own repository. `getClients` is still the shared
// services/supabase read used by POS too — repoint it when that call is
// consolidated; it is unrelated to this module's own aggregate.
import { useClients, useSettings } from '../../hooks/queries'
import ClientsLoadNote from '../clients/components/ClientsLoadNote'
// A debt raised by a credit sale is settled against that sale, through the
// sales aggregate's own collection function, so the two never disagree.
import { saleRepository, paymentRepository, isMissingObject } from '../pos/repositories'
import DebtDetail from './DebtDetail'
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
  const clients = clientsQuery.data || []
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [filterMonth, setFilterMonth] = useState('')
  const [page, setPage] = useState(0)
  useEffect(() => { setPage(0) }, [search, filterMonth, debts.length])
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

  // Picking a saved client links the debt to their customer record so it
  // shows up on their history.
  function pickClient(name) {
    const c = clients.find(x => x.full_name === name)
    setForm(p => ({ ...p, party: name, client_id: c?.id || null }))
  }

  async function load() {
    setLoading(true)
    setLoadError('')
    try {
      const d = await debtRepository.getAll(brand.id)
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
          setPayTarget(null); load(); showToast('Marked as paid! ' + fmt(owed) + ' recorded against ' + debt.source_ref + '.', { type: 'success' })
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
      load()
      showToast(via === 'purchase' ? 'Marked as paid. The purchase is settled too.' : 'Marked as paid!', { type: 'success' })
    } catch (e) {
      console.error('[debts] mark paid failed:', e)
      showToast(paymentErrorMessage(e), { type: 'error' })
    }
  }

  const filtered = debts.filter(d => matchesParty(d, search) && (!filterMonth || d.created_at?.startsWith(filterMonth)))
  const isFiltered = !!search.trim() || !!filterMonth
  const { owedToUs, weOwe } = debtTotals(debts)
  // The outstanding amount of the debts the filter shows (e.g. everything one customer owes).
  const shown = debtTotals(filtered)
  const filterLabel = [search.trim() && `"${search.trim()}"`, filterMonth && new Date(filterMonth + '-01T00:00:00').toLocaleDateString('en-NG', { month: 'long', year: 'numeric' })].filter(Boolean).join(' · ')

  return (
    <div>
      <SectionHead title='Debts' sub='Track money owed to you and money you owe' btn='+ Record Debt' onBtn={() => setShowAdd(true)} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '20px' }}>
        <Card style={{ padding: '18px', borderLeft: `4px solid ${success}` }}>
          <div style={{ fontSize: '12px', color: gray500, fontWeight: '600' }}>Clients owe you</div>
          <div style={{ fontSize: '24px', fontWeight: '900', color: success, marginTop: '6px' }}>{fmt(owedToUs)}</div>
        </Card>
        <Card style={{ padding: '18px', borderLeft: `4px solid ${danger}` }}>
          <div style={{ fontSize: '12px', color: gray500, fontWeight: '600' }}>You owe others</div>
          <div style={{ fontSize: '24px', fontWeight: '900', color: danger, marginTop: '6px' }}>{fmt(weOwe)}</div>
        </Card>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '180px', display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '0 14px' }}>
          <Search size={15} color={gray400} style={{ flexShrink: 0 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder='Search party name...' aria-label='Search debts by customer or party name'
            style={{ flex: 1, padding: '10px 0', border: 'none', fontSize: '13px', outline: 'none', background: 'transparent', color: navy, minWidth: 0 }} />
        </div>
        <input type='month' aria-label='Filter debts by month' value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
          style={{ padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', outline: 'none', color: navy, background: 'white' }} />
        {filterMonth && <button onClick={() => setFilterMonth('')} style={{ padding: '9px 14px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: gray600, cursor: 'pointer', fontSize: '12px', fontWeight: 700 }}>Clear</button>}
      </div>

      {isFiltered && !loading && !loadError && (
        <div role='status' aria-live='polite' style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 18px', padding: '12px 16px', marginBottom: '14px', borderRadius: theme.radius.md, background: 'white', border: `1px solid ${border}` }}>
          <span style={{ fontSize: '12.5px', color: gray600 }}>{shown.count} debt{shown.count !== 1 ? 's' : ''} for {filterLabel}</span>
          <span style={{ fontSize: '13px', color: gray600 }}>Outstanding, owed to you: <strong style={{ color: success, fontSize: '15px' }}>{fmt(shown.owedToUs)}</strong>{shown.openOwedToUs > 0 && <span style={{ color: gray500 }}> ({shown.openOwedToUs} open)</span>}</span>
          {shown.weOwe > 0 && <span style={{ fontSize: '13px', color: gray600 }}>You owe: <strong style={{ color: danger, fontSize: '15px' }}>{fmt(shown.weOwe)}</strong></span>}
        </div>
      )}

      {loading ? <Loading /> : loadError ? <ErrorState message={loadError} onRetry={load} /> : filtered.length === 0 ? (
        isFiltered
          ? <Empty icon={<Search size={40} />} message={`No debts match ${filterLabel}`} cause='filtered' action='Clear filters' onAction={() => { setSearch(''); setFilterMonth('') }} />
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
              render: d => <Pill label={d.status} type={d.status === 'paid' ? 'green' : 'amber'} />,
            },
          ]}
          onRowClick={d => setDetail(d)}
          actions={d => (
            d.status !== 'paid' && <button onClick={(e) => { e.stopPropagation(); markPaid(d) }} style={{ padding: '6px 12px', borderRadius: theme.radius.sm, border: 'none', background: tealDeep, color: 'white', fontWeight: '700', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>Mark paid</button>
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

      {detail && (
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
