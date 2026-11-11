import { businessDateOf, businessDateTime } from '../../lib/businessDay'
import { useState, useEffect, useRef, useMemo } from 'react'
import { Target, AlertCircle, AlertTriangle, CheckCircle, Receipt, BarChart2, Clipboard, DollarSign, Plus, ChevronDown, Search, Pencil, Trash2, RotateCcw, RefreshCw } from 'lucide-react'
import { expenseRepository } from './repositories'
import { useQueryParamAction } from '../../hooks/useQueryParamAction'
import { validateExpense, newExpenseId, budgetSummary, expenseDate, expensePaymentStatus, expenseBalance, budgetStartDay, spentSince, newBudgetStartRange } from './expenseRules'
import { NewBudgetModal, BudgetHistory } from './components/NewBudget'
import { useExpenseBudget } from './useExpenseBudget'
import { useKeyboardScanner } from '../../hooks/useKeyboardScanner'
import { ExpensePaymentFields, RecordExpensePaymentModal, ExpensePaymentSummary, ExpenseStatusPill } from './components/ExpensePayment'
import { EXPENSE_PAYMENT_FILTERS, defaultExpenseFilters, filterExpenses, sortExpenses, expenseTotals, expenseRecorders, expenseRecorder, activeExpenseFilterCount, describeExpenseFilters } from './expenseFilters'
import PeriodFilter from '../../components/PeriodFilter'
import SelectionBar from '../../components/SelectionBar'
import BulkDeleteModal from '../../components/BulkDeleteModal'
import RecentlyDeletedModal from '../../components/RecentlyDeletedModal'
import ExpenseBulkEditModal from './components/ExpenseBulkEditModal'
import { runBulkUpdates } from '../../lib/bulkUpdates'
import { FilterPanel, FilterSelect, AmountRangeFilter } from '../../components/RecordFilters'
import { yearsOf } from '../../lib/recordFilters'
import { fmt, todayDate, currentMonth } from '../../lib/utils'
import { EXPENSE_CATS } from '../../config/constants'
import { theme } from '../../styles/theme'
import { Card, StatCard, SectionHead, Modal, ConfirmDialog, Pill, Inp, Sel, Textarea, GhostBtn, TealBtn, RedBtn, Loading, Empty, useToast, Toast } from '../../components/ui'

const { tealDeep, tealBright, tealMist, navy, gray600, gray500, gray400, gray100, gray50, border, danger, dangerBg, success, successBg, warning, warningBg, bg } = theme

const PAGE_SIZE = 50

export default function Expenses({ brand, role, perms, staffName }) {
  // Every expense of the business is read once (paged past the server's row cap) and filtered here, so any
  // combination of filters totals exactly the rows on screen. Volumes are small (tens to hundreds per business);
  // a server-side filter is the next step if a business records many thousands.
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [shownCount, setShownCount] = useState(PAGE_SIZE)
  const thisMonth = currentMonth()
  const [filters, setFilters] = useState(() => defaultExpenseFilters(thisMonth))
  const setFilter = (k, v) => setFilters(p => ({ ...p, [k]: v }))
  const clearFilters = () => setFilters(defaultExpenseFilters(thisMonth))
  // The budget is monthly: the month filtered on, otherwise the current month.
  const budgetMonth = filters.period?.mode === 'month' && /^\d{4}-\d{2}$/.test(filters.period.month || '') ? filters.period.month : thisMonth
  const [showAdd, setShowAdd] = useState(false)
  const [showBudget, setShowBudget] = useState(false)
  const [form, setForm] = useState({ date: todayDate() })
  const [budgetInput, setBudgetInput] = useState('')
  const [savingBudget, setSavingBudget] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [formErrors, setFormErrors] = useState({})
  // One id per form session: a double-click or a retried request carries the same id, so the database refuses the second row.
  const draftId = useRef(null)
  const saveInFlight = useRef(false)
  const loadSeq = useRef(0)
  const [deleteTarget, setDeleteTarget] = useState(null)
  // One expense opened in full: from the Owner's activity feed (?expense=<id>).
  const [viewing, setViewing] = useState(null)
  // From the dashboard's "Bills to pay": ?payment=open shows every expense still to pay, whatever its date.
  useQueryParamAction('payment', (v) => {
    if (EXPENSE_PAYMENT_FILTERS.some(([k]) => k === v)) setFilters({ ...defaultExpenseFilters(thisMonth), period: { mode: 'all' }, paymentStatus: v })
  })
  // The expense being paid off (Record payment).
  const [paying, setPaying] = useState(null)
  useQueryParamAction('expense', async (id) => {
    try {
      const e = await expenseRepository.getById(brand.id, id)
      if (e) setViewing(e)
      else showToast('That expense is no longer on record.', { type: 'warning' })
    } catch (err) { console.error('[expenses] could not open expense', id, err?.message) }
  }, !!brand?.id)
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const isOwner = role === 'Owner'
  // The monthly budget, stored in the database (it used to live only in this browser and vanished).
  const budgetState = useExpenseBudget(brand?.id, budgetMonth, { isOwner })
  const budget = budgetState.status === 'ready' ? budgetState.amount : 0
  const carriedFrom = budget > 0 && budgetState.fromMonth && budgetState.fromMonth !== budgetMonth ? budgetState.fromMonth : null
  // A budget set mid-month (Set new budget) counts spending from the day it began; otherwise from the 1st.
  const budgetStart = budgetStartDay({ month: budgetState.fromMonth, startsOn: budgetState.startsOn }, budgetMonth)
  const startedMidMonth = budget > 0 && budgetStart !== budgetMonth + '-01'
  const newBudgetRange = newBudgetStartRange(budgetMonth, budgetStart, todayDate())
  // Set new budget: the Owner, once the update is installed, while a day is left in the month after the current start.
  const canStartNew = isOwner && budget > 0 && budgetState.status === 'ready' && budgetState.newBudgetAvailable && !budgetState.onDevice && !!newBudgetRange
  const [showNewBudget, setShowNewBudget] = useState(false)

  useEffect(() => { load() }, [brand?.id])
  useEffect(() => { setShownCount(PAGE_SIZE) }, [filters])
  useEffect(() => { setBudgetInput(budget > 0 ? String(budget) : '') }, [budget, budgetMonth])

  async function load() {
    const seq = ++loadSeq.current
    setLoading(true)
    setLoadError(null)
    try {
      const rows = await expenseRepository.getAll(brand.id)
      if (seq !== loadSeq.current) return // a newer load (save, delete) owns the screen
      setExpenses(rows || [])
    } catch (e) {
      if (seq !== loadSeq.current) return
      // A failed read must never look like "no spending": say so and offer a retry.
      console.error('[Expenses] load failed:', e?.message)
      setLoadError(e?.message || 'Could not load expenses.')
      setExpenses([])
    }
    if (seq === loadSeq.current) setLoading(false)
  }

  const filtered = useMemo(() => sortExpenses(filterExpenses(expenses, filters)), [expenses, filters])
  const shownTotals = useMemo(() => expenseTotals(filtered), [filtered])
  const recorders = useMemo(() => expenseRecorders(expenses), [expenses])
  const categoryOptions = useMemo(() => [...new Set([...EXPENSE_CATS, ...expenses.map(e => e.category).filter(Boolean)])].map(c => [c, c]), [expenses])
  const years = useMemo(() => yearsOf(expenses.map(expenseDate), todayDate()), [expenses])
  const activeCount = activeExpenseFilterCount(filters, thisMonth)
  const filterLabel = describeExpenseFilters(filters, { fmt })
  // Budget spending is the budget's month from the day it began, whatever else is filtered.
  // Payment status needs carehub_20270107_expense_payments. Until it is applied the rows have no amount_paid: every
  // expense reads as paid, the form records paid expenses only and nothing offers Record payment.
  const paymentsAvailable = expenses.length === 0 || expenses.some(e => e.amount_paid !== undefined)
  const monthSpent = useMemo(() => spentSince(expenses, budgetMonth, budgetStart), [expenses, budgetMonth, budgetStart])

  async function save() {
    if (saveInFlight.current) return
    const check = validateExpense(form, EXPENSE_CATS)
    setFormErrors(check.errors)
    if (!check.ok) { showToast(Object.values(check.errors)[0], { type: 'warning' }); return }
    saveInFlight.current = true
    setSaving(true)
    if (!draftId.current) draftId.current = newExpenseId()
    try {
      // Resolves only once the database has confirmed the row exists for this business.
      await expenseRepository.create(brand.id, { id: draftId.current, ...check.value })
      draftId.current = null
      showToast('Expense logged!', { type: 'success' })
      setForm({ date: todayDate() }); setFormErrors({}); setShowAdd(false); load()
    } catch (e) {
      console.error('[Expenses] save failed:', e?.message)
      // ExpensePaymentsUnavailable (repositories): an unpaid expense before the payment update is installed.
      const notYet = e?.name === 'ExpensePaymentsUnavailable'
      showToast(notYet ? e.message : 'Could not save the expense. Nothing was recorded; please try again.', { type: notYet ? 'warning' : 'error' })
    }
    saveInFlight.current = false
    setSaving(false)
  }

  function closeAdd() { setShowAdd(false); setForm({ date: todayDate() }); setFormErrors({}); draftId.current = null }

  function askDelete(e) { setDeleteTarget(e) }
  // One expense goes through delete_expenses too, so its payment history is kept in a copy and the deletion can be
  // undone. Before that update is installed, the previous plain delete is used.
  async function handleDelete() {
    const id = deleteTarget?.id
    setDeleteTarget(null)
    try {
      const r = await expenseRepository.deleteMany(brand.id, [id])
      load()
      showToast('Expense deleted.', r.deletion_id ? { type: 'success', actionLabel: 'Undo', onAction: () => restoreDeletion(r.deletion_id) } : { type: 'success' })
    } catch (e) {
      if (e?.code === 'DELETE_UNAVAILABLE') {
        try { await expenseRepository.delete(id, brand.id); load(); showToast('Expense deleted.', { type: 'success' }) } catch (err) { showToast('Could not delete expense. Please try again.', { type: 'error' }) }
        return
      }
      showToast(e?.code ? e.message : 'Could not delete expense. Please try again.', { type: 'error' })
    }
  }

  // ── Bulk actions: mark expenses, edit them together, delete them (restorable) ────────────────────────────────
  const [marked, setMarked] = useState(() => new Set())
  const [showBulkEdit, setShowBulkEdit] = useState(false)
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [showDeleted, setShowDeleted] = useState(false)
  const canBulkDelete = !!perms?.canDelete
  const markedExpenses = expenses.filter(e => marked.has(e.id))
  const allShownMarked = filtered.length > 0 && filtered.every(e => marked.has(e.id))
  const toggleMarked = (id) => setMarked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  async function runExpenseUpdates(groups, onProgress) {
    const r = await runBulkUpdates(groups, (ids, updates) => expenseRepository.updateMany(brand.id, ids, updates), { onProgress })
    if (r.saved.length) {
      const byId = new Map(r.saved.map(x => [String(x.id), x]))
      setExpenses(prev => prev.map(x => (byId.has(String(x.id)) ? { ...x, ...byId.get(String(x.id)) } : x)))
    }
    if (r.failed.length) console.error('[expenses] bulk edit: some updates failed', r.failed.map(f => f.message))
    else console.info('[expenses] bulk edit saved', { expenses: r.saved.length })
    return r
  }
  async function deleteMarked() {
    const r = await expenseRepository.deleteMany(brand.id, markedExpenses.map(e => e.id))
    console.info('[expenses] deleted', { deleted: r.deleted })
    setMarked(new Set())
    load()
    return r
  }
  async function restoreDeletion(deletionId) {
    try {
      const r = await expenseRepository.restoreDeleted(brand.id, deletionId)
      load()
      showToast(`${r.restored} expense${r.restored === 1 ? '' : 's'} restored.`, { type: 'success' })
      return r
    } catch (e) {
      showToast(e?.message || 'Could not restore. Please try again.', { type: 'error' })
      throw e
    }
  }

  async function saveBudgetAmount() {
    if (savingBudget) return
    const raw = String(budgetInput).trim()
    const amount = raw === '' ? 0 : Number(raw)
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e12) { showToast('Enter a budget of 0 or more.', { type: 'warning' }); return }
    setSavingBudget(true)
    try {
      // Resolves only once the budget is stored; the modal stays open otherwise.
      await budgetState.save(Math.round(amount * 100) / 100)
      setShowBudget(false)
      showToast(amount > 0 ? 'Budget set to ' + fmt(amount) + ' from ' + budgetMonth + '.' : 'Budget removed from ' + budgetMonth + '.', { type: 'success' })
    } catch (e) {
      console.error('[Expenses] budget save failed:', e?.message)
      showToast(/Only the Owner/.test(e?.message || '') ? 'Only the Owner can set the expense budget.' : 'Could not save the budget. Nothing was changed; please try again.', { type: 'error' })
    }
    setSavingBudget(false)
  }

  // Budget spending: the budget's month from the day it began, whatever else is filtered.
  const total = monthSpent
  // Spending that could not be read (or is still loading) must not show as "nothing spent, all remaining".
  const spendingKnown = !loading && !loadError
  const summary = budgetSummary(budget, total)
  const remaining = summary.remaining
  const pctUsed = spendingKnown ? summary.pctUsed : 0
  const overBudget = spendingKnown && summary.over
  const nearLimit = spendingKnown && summary.near
  const exhausted = spendingKnown && summary.exhausted
  const money = (n) => (spendingKnown ? fmt(n) : '—')

  const byCategory = {}
  shownTotals.byCategory.forEach(c => { byCategory[c.category] = c.total })

  // A USB barcode scanner types the code into whichever field has focus, then
  // presses Enter. Expenses has no barcode field, so a scan is never meant
  // here: in Amount it became the expense (a 12-digit code is under the cap),
  // in the budget it became the budget, and its Enter pressed a focused Save
  // Expense, Save Budget or Delete. A scan anywhere on this screen is now
  // undone and explained, and presses nothing. Description and Recorded By are
  // free text (a receipt or invoice number may be scanned there on purpose) and
  // are left alone, as are fields outside this screen.
  const rootRef = useRef(null)
  useKeyboardScanner({
    ignore: (e) => {
      const t = e.target
      const root = rootRef.current
      if (!root || !t || t.tagName === 'TEXTAREA' || t.isContentEditable) return true
      if (t.id === 'expense-description' || t.id === 'expense-recorded-by') return true
      return (t.tagName === 'INPUT' || t.tagName === 'SELECT') && !root.contains(t)
    },
    snapshot: () => ({ form, budgetInput, filters }),
    onScan: (code, snap) => {
      setForm(snap.form)
      setBudgetInput(snap.budgetInput)
      setFilters(snap.filters)
      showToast('Scan ignored (' + code + '): Expenses has no barcode field, so nothing was changed.', { type: 'warning' })
    },
  }, { window: true })

  return (
    <div ref={rootRef}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: '900', color: navy }}>Expenses</div>
          <div style={{ fontSize: '13px', color: gray500, marginTop: '3px' }}>Track all business spending</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {isOwner && (
            <button onClick={() => setShowBudget(true)}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 14px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: navy, fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}>
              <Target size={14} /> {budget > 0 ? 'Edit budget' : 'Set budget'}
            </button>
          )}
          {canStartNew && (
            <button onClick={() => setShowNewBudget(true)}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 14px', borderRadius: theme.radius.md, border: `1px solid ${exhausted ? tealDeep : border}`, background: exhausted ? tealMist : 'white', color: exhausted ? tealDeep : navy, fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}>
              <RefreshCw size={14} aria-hidden='true' /> Set new budget
            </button>
          )}
          {canBulkDelete && (
            <button onClick={() => setShowDeleted(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 14px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: navy, fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}>
              <RotateCcw size={14} aria-hidden='true' /> Recently deleted
            </button>
          )}
          <TealBtn onClick={() => setShowAdd(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Plus size={15} /> Log expense</TealBtn>
        </div>
      </div>

      {/* Budget could not be read: never shown as "no budget" */}
      {budgetState.status === 'error' && (
        <div role='alert' style={{ padding: '14px 18px', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', borderRadius: theme.radius.lg, background: 'white', border: `1px solid ${warning}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: navy }}><AlertTriangle size={15} color={warning} aria-hidden='true' /> The budget could not be loaded. It has not been lost.</div>
          <TealBtn onClick={budgetState.reload} style={{ padding: '8px 16px', fontSize: '12px' }}>Try again</TealBtn>
        </div>
      )}
      {budgetState.status === 'loading' && (
        <div role='status' style={{ marginBottom: '20px', fontSize: '12px', color: gray500 }}>Loading the budget…</div>
      )}

      {/* Budget Tracker */}
      {budget > 0 && (
        <Card style={{ padding: '20px', marginBottom: '20px', border: overBudget ? `2px solid ${danger}` : nearLimit ? `2px solid ${warning}` : `1px solid ${border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '800', fontSize: '15px', color: navy }}>
                {overBudget ? <><AlertCircle size={15} color={danger} /> Over budget!</> : nearLimit ? <><AlertTriangle size={15} color={warning} /> Approaching limit</> : <><CheckCircle size={15} color={success} /> Budget tracker</>}
              </div>
              <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>
                {budgetMonth} · {carriedFrom ? 'Carried over from ' + carriedFrom + ' budget' : startedMidMonth ? 'New budget from ' + budgetStart : 'Set by Owner'}
                {budgetState.onDevice && ' · saved on this device only'}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '22px', fontWeight: '900', color: overBudget ? danger : tealDeep }}>
                {overBudget ? '-' + fmt(Math.abs(remaining)) : money(remaining)}
              </div>
              <div style={{ fontSize: '11px', color: gray500 }}>
                {!spendingKnown ? (loadError ? 'spending could not be loaded' : 'loading spending…') : overBudget ? 'over budget' : 'remaining'}
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ height: '12px', background: gray100, borderRadius: '6px', overflow: 'hidden', marginBottom: '10px' }}>
            <div style={{
              height: '100%',
              width: Math.min(pctUsed, 100) + '%',
              background: overBudget ? danger : nearLimit ? warning : tealDeep,
              borderRadius: '6px',
              transition: 'width 0.5s'
            }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '10px' }}>
            <div style={{ textAlign: 'center', padding: '10px', borderRadius: theme.radius.md, background: bg }}>
              <div style={{ fontSize: '11px', color: gray500, fontWeight: '600' }}>Budget</div>
              <div style={{ fontSize: '15px', fontWeight: '900', color: navy, marginTop: '2px' }}>{fmt(budget)}</div>
            </div>
            <div style={{ textAlign: 'center', padding: '10px', borderRadius: theme.radius.md, background: dangerBg }}>
              <div style={{ fontSize: '11px', color: gray500, fontWeight: '600' }}>Spent</div>
              <div style={{ fontSize: '15px', fontWeight: '900', color: danger, marginTop: '2px' }}>{money(total)}</div>
            </div>
            <div style={{ textAlign: 'center', padding: '10px', borderRadius: theme.radius.md, background: overBudget ? dangerBg : successBg }}>
              <div style={{ fontSize: '11px', color: gray500, fontWeight: '600' }}>{overBudget ? 'Over by' : 'Remaining'}</div>
              <div style={{ fontSize: '15px', fontWeight: '900', color: overBudget ? danger : success, marginTop: '2px' }}>
                {overBudget ? fmt(Math.abs(remaining)) : money(remaining)}
              </div>
            </div>
          </div>

          {overBudget && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', padding: '10px 14px', borderRadius: theme.radius.md, background: dangerBg, border: `1px solid ${danger}`, fontSize: '13px', color: danger, fontWeight: '700' }}>
              <AlertTriangle size={14} /> You have exceeded the {startedMidMonth ? 'budget' : 'monthly budget'} by {fmt(Math.abs(remaining))}! Please review expenses.
            </div>
          )}
          {exhausted && canStartNew && (
            <div role='status' style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginTop: '10px', padding: '10px 14px', borderRadius: theme.radius.md, background: tealMist, fontSize: '12.5px', color: navy }}>
              <span>This budget is used up. Set a new one to keep tracking: this one stays in the budget history with what was spent.</span>
              <TealBtn onClick={() => setShowNewBudget(true)} style={{ padding: '8px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: 6 }}><RefreshCw size={13} aria-hidden='true' /> Set new budget</TealBtn>
            </div>
          )}
          {nearLimit && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', padding: '10px 14px', borderRadius: theme.radius.md, background: warningBg, border: `1px solid ${warning}`, fontSize: '13px', color: warning, fontWeight: '700' }}>
              <AlertTriangle size={14} /> {pctUsed}% of the budget used. Only {fmt(remaining)} is left this month.
            </div>
          )}
        </Card>
      )}
      {/* Budgets replaced (Set new budget) or edited this month, kept with what was spent. */}
      {budgetState.status === 'ready' && (budgetState.history.length > 0 || budgetState.historyStatus === 'error') && (
        <Card style={{ padding: '4px 20px 14px', marginBottom: '20px' }}>
          <BudgetHistory status={budgetState.historyStatus} history={budgetState.history} month={budgetMonth} onRetry={budgetState.reloadHistory} />
        </Card>
      )}

      {/* No budget set — prompt owner */}
      {budget === 0 && isOwner && budgetState.status === 'ready' && (
        <div style={{ marginBottom: '20px', padding: '14px 18px', borderRadius: theme.radius.lg, background: tealMist, border: `1px dashed ${tealBright}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '700', color: tealDeep, fontSize: '14px' }}><Target size={15} /> Set a monthly expense budget</div>
            <div style={{ fontSize: '12px', color: gray600, marginTop: '2px' }}>Track spending against a target and get alerts when approaching the limit</div>
          </div>
          <TealBtn onClick={() => setShowBudget(true)} style={{ padding: '8px 16px', fontSize: '12px' }}>Set budget</TealBtn>
        </div>
      )}

      {/* Totals for the expenses shown: every filter recalculates them. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard icon={<Receipt />} label='Total spent' value={loadError ? '—' : fmt(shownTotals.total)} sub={loadError ? undefined : describeExpenseFilters({ period: filters.period })} />
        <StatCard icon={<CheckCircle />} label='Paid' value={loadError ? '—' : fmt(shownTotals.paid)} />
        <StatCard icon={<AlertCircle />} label='Still to pay' value={loadError ? '—' : fmt(shownTotals.outstanding)} tone={shownTotals.outstanding > 0 ? 'danger' : undefined}
          sub={loadError ? undefined : shownTotals.open + ' expense' + (shownTotals.open !== 1 ? 's' : '') + ' not fully paid'} />
        <StatCard icon={<BarChart2 />} label='Categories' value={loadError ? '—' : shownTotals.byCategory.length} />
        <StatCard icon={<Clipboard />} label='Transactions' value={loadError ? '—' : shownTotals.count} />
      </div>

      {/* Category breakdown */}
      {Object.keys(byCategory).length > 0 && (
        <Card style={{ padding: '20px', marginBottom: '20px' }}>
          <div style={{ fontWeight: '800', fontSize: '15px', marginBottom: '14px', color: navy }}>Breakdown by category</div>
          {Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
            <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
              <span style={{ fontSize: '12px', color: gray600, width: '120px', fontWeight: '600', flexShrink: 0 }}>{cat}</span>
              <div style={{ flex: 1, height: '8px', background: gray100, borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: (shownTotals.total > 0 ? (amt / shownTotals.total) * 100 : 0) + '%', background: tealDeep, borderRadius: '4px' }} />
              </div>
              <span style={{ fontSize: '13px', fontWeight: '700', width: '100px', textAlign: 'right', flexShrink: 0, color: navy }}>{fmt(amt)}</span>
            </div>
          ))}
        </Card>
      )}

      <div style={{ marginBottom: '10px', display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '0 14px' }}>
        <Search size={15} color={gray400} style={{ flexShrink: 0 }} />
        <input value={filters.search} onChange={e => setFilter('search', e.target.value)} placeholder='Search description, category or staff...' aria-label='Search expenses'
          style={{ flex: 1, padding: '10px 0', border: 'none', fontSize: '13px', outline: 'none', background: 'transparent', color: navy, minWidth: 0 }} />
      </div>

      <FilterPanel title='Expense filters' activeCount={activeCount} onClear={clearFilters} defaultOpen>
        <div style={{ gridColumn: '1 / -1' }}>
          <PeriodFilter value={filters.period} onChange={v => setFilter('period', v)} years={years} label='Expense date' />
        </div>
        <FilterSelect label='Category' value={filters.category} onChange={v => setFilter('category', v)} options={categoryOptions} />
        {paymentsAvailable && <FilterSelect label='Payment status' value={filters.paymentStatus} onChange={v => setFilter('paymentStatus', v)} options={EXPENSE_PAYMENT_FILTERS} />}
        <FilterSelect label='Recorded by' value={filters.recordedBy} onChange={v => setFilter('recordedBy', v)} options={recorders.map(r => [r, r])} allLabel='Anyone' />
        <AmountRangeFilter label='Amount (₦)' value={filters.amount} onChange={v => setFilter('amount', v)} />
      </FilterPanel>

      {activeCount > 0 && !loading && !loadError && (
        <div role='status' aria-live='polite' style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 18px', padding: '12px 16px', marginBottom: '14px', borderRadius: theme.radius.md, background: 'white', border: `1px solid ${border}` }}>
          <span style={{ fontSize: '12.5px', color: gray600 }}>{shownTotals.count} expense{shownTotals.count !== 1 ? 's' : ''} for {filterLabel}</span>
          <span style={{ fontSize: '13px', color: gray600 }}>Total: <strong style={{ color: danger, fontSize: '15px' }}>{fmt(shownTotals.total)}</strong></span>
          <span style={{ fontSize: '13px', color: gray600 }}>Paid: <strong style={{ color: success }}>{fmt(shownTotals.paid)}</strong> · Still to pay: <strong style={{ color: shownTotals.outstanding > 0 ? danger : gray500 }}>{fmt(shownTotals.outstanding)}</strong></span>
        </div>
      )}

      {loading ? <Loading /> : loadError ? (
        <Card style={{ padding: '24px', textAlign: 'center' }} role='alert'>
          <AlertCircle size={28} color={danger} />
          <div style={{ fontWeight: '800', color: navy, margin: '8px 0 4px' }}>Expenses could not be loaded</div>
          <div style={{ fontSize: '13px', color: gray500, marginBottom: '14px' }}>Your totals are not shown because they could not be read. Nothing has been lost.</div>
          <TealBtn onClick={load}>Try again</TealBtn>
        </Card>
      ) : filtered.length === 0 ? (
        expenses.length > 0 && activeCount > 0
          ? <Empty icon={<Search size={40} />} message={'No expenses match ' + filterLabel} cause='filtered' action='Clear filters' onAction={clearFilters} />
          : <Empty icon={<Receipt size={40} />} message={expenses.length > 0 ? 'No expenses recorded for ' + filterLabel : 'No expenses recorded yet'} action='+ Log Expense' onAction={() => setShowAdd(true)} />
      ) : (
        <>
        <SelectionBar count={marked.size} shownCount={filtered.length} allShownSelected={allShownMarked}
          onSelectAll={() => setMarked(prev => new Set([...prev, ...filtered.map(e => e.id)]))} onClear={() => setMarked(new Set())}>
          <TealBtn onClick={() => setShowBulkEdit(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px' }}><Pencil size={13} aria-hidden='true' /> Edit selected</TealBtn>
          {canBulkDelete && <RedBtn onClick={() => setShowBulkDelete(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px' }}><Trash2 size={13} aria-hidden='true' /> Delete selected</RedBtn>}
        </SelectionBar>
        <Card>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${border}`, background: gray50 }}>
                  <th style={{ padding: '12px 0 12px 16px', width: 34 }}><span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>Select</span></th>
                  {['Category', 'Description', 'Amount', 'Status', 'Date', 'Staff', 'Action'].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: gray400, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, shownCount).map(e => (
                  <tr key={e.id} style={{ borderBottom: `1px solid ${gray100}`, background: marked.has(e.id) ? tealMist : undefined }}>
                    <td style={{ padding: '12px 0 12px 16px' }}>
                      <input type='checkbox' checked={marked.has(e.id)} onChange={() => toggleMarked(e.id)}
                        aria-label={'Select ' + [e.category, e.description].filter(Boolean).join(': ') + ', ' + fmt(e.amount)} style={{ width: 18, height: 18, cursor: 'pointer', accentColor: tealDeep }} />
                    </td>
                    <td style={{ padding: '12px 16px' }}><Pill label={e.category} type='teal' /></td>
                    <td style={{ padding: '12px 16px', fontSize: '13px', color: gray600 }}>
                      {/* Opens the expense in full: payment, history and who recorded it. */}
                      <button type='button' onClick={() => setViewing(e)} aria-label={'View expense: ' + (e.description || e.category) + ', ' + fmt(e.amount)}
                        style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: navy, cursor: 'pointer', textAlign: 'left', textDecoration: 'underline', textDecorationColor: gray100, textUnderlineOffset: 3 }}>
                        {e.description || 'Not set'}
                      </button>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '14px', fontWeight: '900', color: danger }}>
                      {fmt(e.amount)}
                      {expensePaymentStatus(e) !== 'paid' && <div style={{ fontSize: '11px', fontWeight: '700', color: gray500, marginTop: 2 }}>{fmt(expenseBalance(e))} to pay</div>}
                    </td>
                    <td style={{ padding: '12px 16px' }}><ExpenseStatusPill expense={e} /></td>
                    <td style={{ padding: '12px 16px', fontSize: '12px', color: gray400 }}>{businessDateOf(e.date || e.created_at)}</td>
                    <td style={{ padding: '12px 16px', fontSize: '13px', color: gray500 }}>{expenseRecorder(e) || 'Not set'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {paymentsAvailable && expensePaymentStatus(e) !== 'paid' && (
                          <TealBtn onClick={() => setPaying(e)} aria-label={'Record payment: ' + (e.description || e.category)} style={{ padding: '4px 10px', fontSize: '11px', whiteSpace: 'nowrap' }}>Record payment</TealBtn>
                        )}
                        {perms?.canDelete && <RedBtn onClick={() => askDelete(e)} style={{ padding: '4px 9px', fontSize: '11px' }}>Delete</RedBtn>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > shownCount && (
            <div style={{ padding: '16px', textAlign: 'center' }}>
              <button onClick={() => setShownCount(n => n + PAGE_SIZE)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 20px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: navy, fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>
                <ChevronDown size={14} /> Show more ({filtered.length - shownCount} left)
              </button>
            </div>
          )}
        </Card>
        </>
      )}

      {showBulkEdit && (
        <ExpenseBulkEditModal expenses={markedExpenses} categories={EXPENSE_CATS} runUpdates={runExpenseUpdates} onClose={() => setShowBulkEdit(false)} />
      )}
      {showBulkDelete && (
        <BulkDeleteModal noun='expense' count={markedExpenses.length} names={markedExpenses.map(e => `${e.category}${e.description ? ': ' + e.description : ''} (${fmt(e.amount)})`)}
          notes={[
            <>Each expense is deleted with its payment history; spending totals and the budget drop by {fmt(markedExpenses.reduce((n, e) => n + (Number(e.amount) || 0), 0))}.</>,
            <>You can <strong>restore</strong> them afterwards, payments and all, from Recently deleted.</>,
          ]}
          onDelete={deleteMarked} onRestore={restoreDeletion} onClose={() => setShowBulkDelete(false)} />
      )}
      {showDeleted && (
        <RecentlyDeletedModal noun='expense' loadDeletions={() => expenseRepository.getDeletions(brand.id)}
          onRestore={(id) => restoreDeletion(id)} describeSkips={() => ''} onClose={() => setShowDeleted(false)} />
      )}

      {/* Set Budget Modal */}
      <Modal show={showBudget} onClose={() => setShowBudget(false)} title={'Set Expense Budget: ' + budgetMonth}
        footer={<><GhostBtn onClick={() => setShowBudget(false)} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={saveBudgetAmount} disabled={savingBudget} aria-busy={savingBudget || undefined} style={{ flex: 1, padding: '12px' }}>{savingBudget ? 'Saving…' : 'Save Budget'}</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ padding: '14px', borderRadius: theme.radius.md, background: tealMist, border: `1px solid ${tealMist}`, fontSize: '13px', color: tealDeep, lineHeight: '1.7' }}>
            Set a spending limit from <strong>{budgetMonth}</strong>. It carries over to the following months until you change it; enter 0 to have no budget from this month on. {budgetState.onDevice ? 'Until CareHub finishes updating, it is saved on this device only.' : 'It is saved to your business, so everyone working here sees it on any device.'} You will be alerted when 80% is used and when the budget is exceeded.
          </div>
          <Inp id='expense-budget-amount' label={'Monthly Budget for ' + budgetMonth + ' (₦)'} value={budgetInput} onChange={setBudgetInput} type='number' placeholder='e.g. 100000' />
          {budgetInput && parseFloat(budgetInput) > 0 && (
            <div style={{ padding: '12px 16px', borderRadius: theme.radius.md, background: bg, border: `1px solid ${border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
                <span style={{ color: gray500 }}>Budget</span>
                <span style={{ fontWeight: '700', color: navy }}>{fmt(parseFloat(budgetInput))}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
                <span style={{ color: gray500 }}>Already spent ({startedMidMonth ? 'since ' + budgetStart : budgetMonth})</span>
                <span style={{ fontWeight: '700', color: danger }}>{money(total)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', borderTop: `1px solid ${border}`, paddingTop: '8px', marginTop: '4px' }}>
                <span style={{ color: gray500 }}>Remaining</span>
                <span style={{ fontWeight: '900', color: spendingKnown && parseFloat(budgetInput) - total < 0 ? danger : success }}>
                  {money(parseFloat(budgetInput) - total)}
                </span>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {showNewBudget && newBudgetRange && (
        <NewBudgetModal month={budgetMonth} current={{ amount: budget, startsOn: budgetStart }} range={newBudgetRange} expenses={expenses} spendingKnown={spendingKnown}
          onSave={async (v) => {
            await budgetState.startNew(v.amount, v.startsOn)
            showToast('New budget of ' + fmt(v.amount) + ' from ' + v.startsOn + '. The previous budget is kept in the budget history.', { type: 'success' })
          }}
          onClose={() => setShowNewBudget(false)} />
      )}

      {/* Add Expense Modal */}
      <Modal show={showAdd} onClose={closeAdd} title='Log Expense'
        footer={<><GhostBtn onClick={closeAdd} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={save} disabled={saving} style={{ flex: 1, padding: '12px' }}>{saving ? 'Saving...' : 'Save Expense'}</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {budget > 0 && spendingKnown && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 14px', borderRadius: theme.radius.md, background: overBudget ? dangerBg : tealMist, border: `1px solid ${overBudget ? danger : tealMist}`, fontSize: '12px', color: overBudget ? danger : tealDeep, fontWeight: '600' }}>
              {overBudget ? <><AlertTriangle size={13} /> Already over budget by {fmt(Math.abs(remaining))}</> : <><DollarSign size={13} /> Budget remaining this month: {fmt(remaining)}</>}
            </div>
          )}
          <Sel label='Category *' value={form.category} onChange={v => f('category', v)} options={EXPENSE_CATS} required error={formErrors.category} />
          <Inp id='expense-description' label='Description' value={form.description} onChange={v => f('description', v)} placeholder='What was this expense for?' error={formErrors.description} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Inp id='expense-amount' label='Amount (₦) *' value={form.amount} onChange={v => f('amount', v)} type='number' min='0' placeholder='0' required error={formErrors.amount} />
            <Inp label='Date' value={form.date} onChange={v => f('date', v)} type='date' error={formErrors.date} />
          </div>
          {paymentsAvailable && <ExpensePaymentFields form={form} setField={f} errors={formErrors} />}
          <Inp id='expense-recorded-by' label='Recorded By' value={form.staffName} onChange={v => f('staffName', v)} placeholder='Your name' />
          {form.amount && budget > 0 && spendingKnown && (
            <div style={{ padding: '10px', borderRadius: theme.radius.md, background: bg, fontSize: '12px', color: gray600 }}>
              After this expense: <strong style={{ color: remaining - (parseFloat(form.amount) || 0) < 0 ? danger : success }}>
                {fmt(remaining - (parseFloat(form.amount) || 0))} remaining
              </strong>
            </div>
          )}
        </div>
      </Modal>

      <Modal show={!!viewing} onClose={() => setViewing(null)} title='Expense'
        footer={<><GhostBtn onClick={() => setViewing(null)} style={{ flex: 1, padding: '12px' }}>Close</GhostBtn>
          {viewing && paymentsAvailable && expensePaymentStatus(viewing) !== 'paid' && <TealBtn onClick={() => { setPaying(viewing); setViewing(null) }} style={{ flex: 1, padding: '12px' }}>Record payment</TealBtn>}</>}>
        {viewing && (
          <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '10px 16px', margin: 0, fontSize: '13px' }}>
            {[
              ['Amount', <strong key='a' style={{ color: danger, fontSize: '16px' }}>{fmt(viewing.amount)}</strong>],
              ['Category', viewing.category || 'Not set'],
              ['Description', viewing.description || 'Not set'],
              ['Date', businessDateOf(viewing.date || viewing.created_at) || 'Not set'],
              ['Staff (as entered)', viewing.staff_name || 'Not set'],
              ['Recorded by', viewing.recorded_by_name || 'Not recorded'],
              ['Recorded at', businessDateTime(viewing.created_at) || 'Not recorded'],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt style={{ color: gray400, fontWeight: '700' }}>{k}</dt>
                <dd style={{ margin: 0, color: navy }}>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {viewing && <ExpensePaymentSummary businessId={brand?.id} expense={viewing} available={paymentsAvailable && viewing.amount_paid !== undefined} />}
      </Modal>

      {paying && (
        <RecordExpensePaymentModal expense={paying} staffName={staffName} showToast={showToast}
          onClose={() => setPaying(null)} onPaid={() => { setPaying(null); load() }} />
      )}

      <ConfirmDialog show={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete}
        title='Delete this expense?'
        consequence={`This removes the ${deleteTarget?.category || ''} expense of ${deleteTarget ? fmt(deleteTarget.amount) : ''} and its payments from your records. You can undo it, or restore it later from Recently deleted.`}
        confirmLabel='Delete' />

      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}
