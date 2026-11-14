import { useMemo, useState } from 'react'
import { Search, Truck, X, Upload, Download, Plus, AlertTriangle } from 'lucide-react'
import { Card, Modal, Empty, ErrorState, Loading, Pill, Input, Textarea, GhostBtn, TealBtn } from '../../components/ui'
import RecordPaymentForm from '../../components/payments/RecordPaymentForm'
import PaymentHistory from '../../components/payments/PaymentHistory'
import ExportFormatModal from '../../components/ExportFormatModal'
import { useSupplierAccounts, useSupplierActivity, useRecordSupplierPayment } from '../../hooks/queries'
import { paymentErrorMessage } from '../../lib/dbErrors'
import { auditedExport, exportColumns } from '../../lib/auditedExport'
import { fmt, fmtDate } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { PurchasePaymentModal, Figure, purchaseStatus, SUPPLIER_METHODS } from './SupplierPayments'
import PurchaseDetailModal from './PurchaseDetail'
import DebtPaymentModal from '../debts/components/DebtPaymentModal'
import DebtImportModal from '../debts/components/DebtImportModal'
import { debtRepository } from '../debts/repositories'
import { matchSupplier, supplierKey } from './suppliers'
import { toAccount, accountTotals, filterAccounts, ACCOUNT_SORTS, groupSupplierPayments, SUPPLIER_EXPORT_COLUMNS } from './supplierAccounts'

const { navy, gray400, gray500, gray600, gray100, border, danger, success, tealDeep, warning, warningBg } = theme

// Purchases › Supplier summary: every supplier's account (what it supplied, what was paid, what is still owed) built
// from the existing purchases plus supply records (amounts owed without products), with supply and payment history,
// one payment on the account (applied oldest first), import and export. Product quantities and prices stay in the
// Purchase entry; nothing here needs them. Docs: docs/architecture/Debt-Accounts-and-POS-Stock-Limits.md §3.
export default function SupplierAccounts({ brand, role, perms, staffName, showToast, onPaid }) {
  const accountsQuery = useSupplierAccounts(brand?.id)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('owed')
  const [owingOnly, setOwingOnly] = useState(false)
  const [selectedKey, setSelectedKey] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [addingFor, setAddingFor] = useState(null) // '' = choose a supplier; a name = that supplier
  const available = accountsQuery.data?.available !== false
  const accounts = useMemo(() => (accountsQuery.data?.rows || []).map(toAccount), [accountsQuery.data])
  const rows = useMemo(() => filterAccounts(accounts, { query, sort, owingOnly }), [accounts, query, sort, owingOnly])
  const totals = accountTotals(rows)
  const canExport = role === 'Owner' || !!perms?.canExportReports
  const selected = selectedKey != null ? accounts.find((a) => a.key === selectedKey) : null

  async function exportShown(format) {
    return auditedExport({
      format, rows, columns: exportColumns(SUPPLIER_EXPORT_COLUMNS, ['supplied', 'paid', 'balance']),
      sheetName: 'Supplier accounts', fileBase: 'CareHub_Supplier_Accounts', businessId: brand.id, exportType: 'supplier_accounts',
      noun: 'supplier', showToast, logTag: '[suppliers]',
      filters: { search_applied: !!query.trim(), owing_only: owingOnly, sort, suppliers: rows.length },
    })
  }

  if (accountsQuery.isLoading) return <Loading text='Loading supplier accounts…' />
  if (accountsQuery.isError) return <ErrorState message="We couldn't load your supplier accounts." onRetry={() => accountsQuery.refetch()} />

  const toolbar = (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {available && <GhostBtn onClick={() => setAddingFor('')} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Plus size={14} aria-hidden='true' /> Supply record</GhostBtn>}
      {available && <GhostBtn onClick={() => setShowImport(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Upload size={14} aria-hidden='true' /> Import</GhostBtn>}
      {canExport && accounts.length > 0 && <GhostBtn onClick={() => setShowExport(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Download size={14} aria-hidden='true' /> Export</GhostBtn>}
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, color: gray600, maxWidth: 620, lineHeight: 1.5 }}>
          Each supplier's account: everything supplied (purchases and supply records), what you have paid and what you still owe.
          Product quantities and prices stay in the purchase entries.
        </div>
        {toolbar}
      </div>
      {!available && (
        <div role='status' style={{ fontSize: 12.5, color: gray600, marginBottom: 12 }}>
          Supply records, account payments and import become available once the latest database update is applied. Totals below are from purchases.
        </div>
      )}

      {accounts.length === 0 ? (
        <Empty icon={<Truck size={40} />} message='No suppliers yet. Record a purchase, add a supply record or import your supplier balances.' />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 10, marginBottom: 14 }}>
            <Figure label='Total supplied / owed' value={fmt(totals.supplied)} />
            <Figure label='Paid' value={fmt(totals.paid)} color={success} />
            <Figure label='Outstanding' value={fmt(totals.balance)} color={totals.balance > 0 ? danger : success} />
          </div>
          {totals.mismatches > 0 && (
            <div role='status' style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', marginBottom: 12, borderRadius: theme.radius.md, background: warningBg, border: `1px solid ${warning}`, fontSize: 12.5, color: navy }}>
              <AlertTriangle size={15} color={warning} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden='true' />
              <span>{totals.mismatches} item{totals.mismatches === 1 ? '' : 's'} on these accounts {totals.mismatches === 1 ? 'has' : 'have'} a balance that is not its amount less what was paid. Open the supplier to check.</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ flex: '1 1 220px', display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '0 12px' }}>
              <Search size={15} color={gray400} aria-hidden='true' />
              <input type='search' value={query} onChange={(e) => setQuery(e.target.value)} placeholder='Search suppliers' aria-label='Search suppliers'
                style={{ flex: 1, border: 'none', outline: 'none', padding: '10px 0', fontSize: 13, background: 'transparent', color: navy, minWidth: 0 }} />
              {query && <button type='button' onClick={() => setQuery('')} aria-label='Clear search' style={{ background: 'none', border: 'none', cursor: 'pointer', color: gray500, display: 'flex', minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' }}><X size={15} /></button>}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: gray600, fontWeight: 700 }}>
              Sort
              <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ padding: '9px 10px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 13, background: 'white', color: navy }}>
                {Object.entries(ACCOUNT_SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: gray600, cursor: 'pointer' }}>
              <input type='checkbox' checked={owingOnly} onChange={(e) => setOwingOnly(e.target.checked)} style={{ accentColor: tealDeep }} /> Owed only
            </label>
          </div>
          <div role='status' aria-live='polite' style={{ fontSize: 13, color: gray600, marginBottom: 10 }}>
            <strong>{rows.length}</strong> supplier{rows.length === 1 ? '' : 's'} · <strong style={{ color: totals.balance > 0 ? danger : success }}>{fmt(totals.balance)}</strong> owed
          </div>
          {rows.length === 0 ? (
            <Empty icon={<Search size={40} />} cause='filtered' title='No suppliers match' action='Clear search' onAction={() => { setQuery(''); setOwingOnly(false) }} />
          ) : (
            <Card>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${border}` }}>
                      {['Supplier', 'Supplied / owed', 'Paid', 'Outstanding', 'Items', ''].map((h, i) => (
                        <th key={h || 'actions'} scope='col' style={{ padding: 12, textAlign: i >= 1 && i <= 3 ? 'right' : 'left', fontSize: 10, fontWeight: 700, color: gray400, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h || <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>Actions</span>}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((a) => (
                      <tr key={a.key} style={{ borderBottom: `1px solid ${gray100}` }}>
                        <td style={{ padding: 12, fontSize: 13, color: navy }}>
                          <div style={{ fontWeight: 700 }}>{a.name}</div>
                          {a.lastSupply && <div style={{ fontSize: 11.5, color: gray500 }}>Last supply {fmtDate(a.lastSupply)}</div>}
                        </td>
                        <td style={{ padding: 12, fontSize: 13, color: navy, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(a.supplied)}</td>
                        <td style={{ padding: 12, fontSize: 13, color: success, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(a.paid)}</td>
                        <td style={{ padding: 12, fontSize: 13, fontWeight: 900, color: a.balance > 0 ? danger : success, textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(a.balance)}</td>
                        <td style={{ padding: 12, fontSize: 12, color: gray600, whiteSpace: 'nowrap' }}>
                          {a.purchases} purchase{a.purchases === 1 ? '' : 's'}{a.supplies ? ` · ${a.supplies} supply record${a.supplies === 1 ? '' : 's'}` : ''}{a.open ? ` · ${a.open} open` : ''}
                        </td>
                        <td style={{ padding: 12 }}>
                          <button type='button' onClick={() => setSelectedKey(a.key)} aria-label={`Open ${a.name}'s account`}
                            style={{ padding: '6px 12px', borderRadius: theme.radius.sm, border: `1px solid ${border}`, background: 'white', color: tealDeep, fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', minHeight: 32 }}>
                            {a.balance > 0 ? 'View & pay' : 'View'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {selected && (
        <SupplierAccountModal brand={brand} account={selected} available={available} staffName={staffName} showToast={showToast}
          onPaid={onPaid} onAddSupply={() => setAddingFor(selected.name)} onClose={() => setSelectedKey(null)} />
      )}
      {addingFor != null && (
        <SupplyRecordModal brand={brand} accounts={accounts} supplier={addingFor} showToast={showToast}
          onSaved={() => { accountsQuery.refetch(); onPaid?.() }} onClose={() => setAddingFor(null)} />
      )}
      {showImport && <DebtImportModal brand={brand} direction='we_owe' title='Import supplier accounts from Excel / CSV' onClose={() => setShowImport(false)} onDone={() => { accountsQuery.refetch(); onPaid?.() }} />}
      {showExport && (
        <ExportFormatModal show onClose={() => setShowExport(false)} onExport={exportShown} title='Export supplier accounts' name='supplier-export-format'
          description={`Exports the ${rows.length} supplier account${rows.length === 1 ? '' : 's'} on screen: supplied, paid and outstanding for each. Supply values are cost data, so the export is recorded in the audit log.`} />
      )}
    </div>
  )
}

// The item an account's supply row opens or pays, in the shape each dialog takes.
const asPurchase = (s) => ({ id: s.id, supplier_name: s.party_name, product_name: s.description, total_cost: s.amount, amount_paid: s.paid, balance: s.balance, supply_date: s.date, created_at: s.created_at, status: s.status, due_date: s.due_date })
const asDebt = (s) => ({ id: s.id, party_name: s.party_name, direction: 'we_owe', source: 'manual', amount: s.amount, amount_paid: s.paid, balance: s.balance, description: s.description, created_at: s.created_at, due_date: s.due_date, status: s.status })

// One supplier's account: figures, one payment on the account, every supply (purchases and supply records, each
// payable on its own) and every payment.
function SupplierAccountModal({ brand, account, available, staffName, showToast, onPaid, onAddSupply, onClose }) {
  const activity = useSupplierActivity(brand?.id, account.key)
  const recordPayment = useRecordSupplierPayment(brand?.id)
  const [view, setView] = useState('supplies')
  const [paying, setPaying] = useState(null) // { kind, item }
  const [viewing, setViewing] = useState(null)
  const supplies = activity.data?.supplies || []
  const payments = useMemo(() => groupSupplierPayments(activity.data?.payments || []).map((p) => (p.parts
    ? { ...p, note: `${p.note ? p.note + ' · ' : ''}one payment applied to ${p.parts.length} items, oldest first` }
    : p)), [activity.data])

  async function payAccount({ amount, method, paidOn, note }) {
    try {
      const r = await recordPayment.mutateAsync({ supplierKey: account.key, amount, method, paidOn, note, staffName: staffName || null })
      const n = (r?.allocations || []).length
      console.info('[suppliers] account payment recorded', { supplier: account.key, amount, items: n, balance: r?.balance })
      showToast(Number(r?.balance) > 0
        ? `${fmt(amount)} paid to ${account.name}, applied to ${n} item${n === 1 ? '' : 's'}. ${fmt(r.balance)} still owed.`
        : `${account.name} is now fully paid.`, { type: 'success' })
      onPaid?.(r)
    } catch (e) {
      console.error('[suppliers] account payment failed:', e)
      throw new Error(paymentErrorMessage(e))
    }
  }

  // One dialog at a time (each traps focus): a payment or a purchase replaces this one, and closing it comes back.
  if (paying?.kind === 'purchase') {
    return <PurchasePaymentModal brand={brand} purchase={asPurchase(paying.item)} staffName={staffName} showToast={showToast} onPaid={onPaid} onClose={() => setPaying(null)} />
  }
  if (paying?.kind === 'supply') {
    return <DebtPaymentModal brand={brand} debt={asDebt(paying.item)} staffName={staffName} showToast={showToast} onPaid={onPaid} onClose={() => setPaying(null)} />
  }
  if (viewing) {
    return <PurchaseDetailModal brand={brand} purchase={asPurchase(viewing)} onClose={() => setViewing(null)} onPay={() => { const v = viewing; setViewing(null); setPaying({ kind: 'purchase', item: v }) }} />
  }

  return (
    <Modal show onClose={onClose} title={account.name} wide>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <Figure label='Supplied / owed' value={fmt(account.supplied)} />
          <Figure label='Paid' value={fmt(account.paid)} color={success} />
          <Figure label='Outstanding' value={fmt(account.balance)} color={account.balance > 0 ? danger : success} />
        </div>

        {account.balance > 0 && available && (
          <section aria-label='Pay this supplier' style={{ padding: 12, border: `1px solid ${border}`, borderRadius: theme.radius.md }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: navy, marginBottom: 4 }}>Record payment</div>
            <div style={{ fontSize: 12, color: gray500, marginBottom: 10 }}>Applied to the oldest unpaid items first. Each item keeps its own record of what was paid on it.</div>
            <RecordPaymentForm idPrefix='supplier-account' balance={account.balance} methods={SUPPLIER_METHODS} defaultMethod='Transfer'
              showDate showNote submitLabel='Record payment' onSubmit={payAccount} />
          </section>
        )}

        <div role='tablist' aria-label='Supplier history' style={{ display: 'flex', gap: 20, borderBottom: `1px solid ${border}` }}>
          {[['supplies', `Supply history (${supplies.length})`], ['payments', `Payment history (${(activity.data?.payments || []).length})`]].map(([v, label]) => (
            <button key={v} type='button' role='tab' aria-selected={view === v} onClick={() => setView(v)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px 2px', marginBottom: -1, fontSize: 13, fontWeight: view === v ? 800 : 600, color: view === v ? tealDeep : gray600, borderBottom: view === v ? `2px solid ${tealDeep}` : '2px solid transparent' }}>
              {label}
            </button>
          ))}
        </div>

        {activity.isLoading ? <Loading text='Loading the account…' /> : activity.isError ? (
          <ErrorState message="We couldn't load this supplier's history." onRetry={() => activity.refetch()} />
        ) : view === 'supplies' ? (
          <section aria-label='Supply history'>
            {available && <div style={{ marginBottom: 8 }}><GhostBtn onClick={onAddSupply} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px' }}><Plus size={13} aria-hidden='true' /> Add supply record</GhostBtn></div>}
            {supplies.length === 0 ? <div style={{ fontSize: 13, color: gray500 }}>Nothing supplied yet.</div> : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {supplies.map((s) => {
                  const st = purchaseStatus({ balance: s.balance, amount_paid: s.paid, status: s.status })
                  const isPurchase = s.kind === 'purchase'
                  return (
                    <li key={s.kind + s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', border: `1px solid ${border}`, borderRadius: theme.radius.md }}>
                      <div style={{ minWidth: 0, flex: '1 1 200px' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: navy, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          {isPurchase
                            ? <button type='button' onClick={() => setViewing(s)} aria-label={`View purchase: ${s.description}`} style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, color: navy, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3, textDecorationColor: gray100 }}>{s.description}</button>
                            : <span style={{ overflowWrap: 'anywhere' }}>{s.description}</span>}
                          <Pill label={isPurchase ? 'Purchase' : 'Supply record'} type={isPurchase ? 'blue' : 'gray'} />
                          <Pill label={st.label} type={st.type} />
                        </div>
                        <div style={{ fontSize: 12, color: gray500 }}>
                          {fmtDate(s.date || s.created_at)}{isPurchase && s.lines ? ` · ${s.lines} line${s.lines === 1 ? '' : 's'}` : ''} · {fmt(s.amount)} · paid {fmt(s.paid)}{s.due_date ? ` · due ${fmtDate(s.due_date)}` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <strong style={{ color: s.balance > 0 ? danger : success, fontSize: 14 }}>{fmt(s.balance)}</strong>
                        {s.balance > 0 && (isPurchase || available) && (
                          <button type='button' onClick={() => setPaying({ kind: s.kind, item: s })} aria-label={`Pay ${isPurchase ? 'purchase' : 'supply record'}: ${s.description}`}
                            style={{ padding: '6px 12px', borderRadius: theme.radius.sm, border: `1px solid ${tealDeep}`, background: 'white', color: tealDeep, fontWeight: 700, fontSize: 12, cursor: 'pointer', minHeight: 32 }}>
                            Pay this item
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        ) : (
          <section aria-label='Payment history'>
            <PaymentHistory payments={payments} emptyText='No payments made to this supplier yet.' />
          </section>
        )}
      </div>
    </Modal>
  )
}

// A supply record: an amount owed to a supplier without products (an opening balance, an old invoice). Recorded as a
// "we owe" debt on that supplier's account. Picking an existing supplier keeps one account per supplier.
function SupplyRecordModal({ brand, accounts, supplier, showToast, onSaved, onClose }) {
  const [form, setForm] = useState({ supplier: supplier || '', amount: '', paid: '', dueDate: '', description: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k, v) => { setForm((p) => ({ ...p, [k]: v })); setError('') }
  const known = useMemo(() => accounts.map((a) => ({ key: a.key, name: a.name, lastDate: a.lastSupply })), [accounts])
  const { exact, similar } = matchSupplier(known, form.supplier)

  async function save() {
    const name = (exact?.name || form.supplier).trim().replace(/\s+/g, ' ')
    const amount = Number(form.amount)
    const paid = Number(form.paid || 0)
    if (!name) { setError('Enter the supplier.'); return }
    if (!(amount > 0)) { setError('Enter the amount supplied or owed.'); return }
    if (paid < 0 || paid > amount) { setError('The amount already paid must be between 0 and the amount.'); return }
    setSaving(true)
    try {
      await debtRepository.create(brand.id, {
        direction: 'we_owe', party_name: name, amount, amount_paid: paid, balance: amount - paid, due_date: form.dueDate || '',
        status: paid >= amount ? 'paid' : 'pending', description: form.description.trim() || 'Supply record', source: 'manual',
      })
      console.info('[suppliers] supply record added', { supplier: supplierKey(name), amount, paid })
      showToast(`Supply record of ${fmt(amount)} added to ${name}.`, { type: 'success' })
      onSaved?.()
      onClose()
    } catch (e) {
      console.error('[suppliers] supply record failed:', e)
      setError(paymentErrorMessage(e))
    }
    setSaving(false)
  }

  return (
    <Modal show onClose={onClose} title='Add supply record'
      footer={<><GhostBtn onClick={onClose} style={{ flex: 1, padding: 12 }}>Cancel</GhostBtn><TealBtn onClick={save} disabled={saving} style={{ flex: 1, padding: 12 }}>{saving ? 'Saving…' : 'Save'}</TealBtn></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 12.5, color: gray600 }}>An amount you owe a supplier without product details (an opening balance or an old invoice). Products bought go through Record Purchase.</div>
        <div>
          <Input id='supply-supplier' label='Supplier *' value={form.supplier} onChange={(v) => set('supplier', v)} list='supply-suppliers' placeholder='Pick a supplier or type a new one' />
          <datalist id='supply-suppliers'>{accounts.map((a) => <option key={a.key} value={a.name} />)}</datalist>
          {exact && <div style={{ fontSize: 12, color: success, marginTop: 4 }}>Adds to {exact.name}'s account.</div>}
          {!exact && similar.length > 0 && <div role='status' style={{ fontSize: 12, color: theme.amberText || warning, marginTop: 4 }}>Did you mean {similar.map((s) => s.name).join(' or ')}? A different spelling starts a separate account.</div>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Input id='supply-amount' label='Amount supplied / owed (₦) *' type='number' value={form.amount} onChange={(v) => set('amount', v)} placeholder='0' />
          <Input id='supply-paid' label='Already paid (₦)' type='number' value={form.paid} onChange={(v) => set('paid', v)} placeholder='0' />
        </div>
        <Input id='supply-due' label='Due date' type='date' value={form.dueDate} onChange={(v) => set('dueDate', v)} />
        <Textarea label='Description' value={form.description} onChange={(v) => set('description', v)} placeholder='e.g. Opening balance, invoice 2041' rows={2} />
        {error && <div role='alert' style={{ fontSize: 12.5, color: danger }}>{error}</div>}
      </div>
    </Modal>
  )
}
