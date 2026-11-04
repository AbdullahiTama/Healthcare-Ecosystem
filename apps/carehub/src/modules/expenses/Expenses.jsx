import { businessDateOf, businessDateTime } from '../../lib/businessDay'
import { useState, useEffect, useRef } from 'react'
import { Target, AlertCircle, AlertTriangle, CheckCircle, Receipt, BarChart2, Clipboard, DollarSign, Plus, ChevronDown } from 'lucide-react'
import { expenseRepository } from './repositories'
import { useQueryParamAction } from '../../hooks/useQueryParamAction'
import { validateExpense, newExpenseId, budgetSummary } from './expenseRules'
import { useExpenseBudget } from './useExpenseBudget'
import { useKeyboardScanner } from '../../hooks/useKeyboardScanner'
import { fmt, todayDate, currentMonth } from '../../lib/utils'
import { EXPENSE_CATS } from '../../config/constants'
import { theme } from '../../styles/theme'
import { Card, StatCard, SectionHead, Modal, ConfirmDialog, Pill, Inp, Sel, Textarea, GhostBtn, TealBtn, RedBtn, Loading, Empty, useToast, Toast } from '../../components/ui'

const { tealDeep, tealBright, tealMist, navy, gray600, gray500, gray400, gray100, gray50, border, danger, dangerBg, success, successBg, warning, warningBg, bg } = theme

const PAGE_SIZE = 50

export default function Expenses({ brand, role, perms }) {
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [filterMonth, setFilterMonth] = useState(currentMonth())
  const [totals, setTotals] = useState({ total_amount: 0, transaction_count: 0 })
  const [categories, setCategories] = useState([])
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
  const budgetState = useExpenseBudget(brand?.id, filterMonth, { isOwner })
  const budget = budgetState.status === 'ready' ? budgetState.amount : 0
  const carriedFrom = budget > 0 && budgetState.fromMonth && budgetState.fromMonth !== filterMonth ? budgetState.fromMonth : null

  useEffect(() => { load() }, [brand?.id, filterMonth])
  useEffect(() => { setBudgetInput(budget > 0 ? String(budget) : '') }, [budget, filterMonth])

  async function load() {
    const seq = ++loadSeq.current
    setLoading(true)
    setLoadError(null)
    setExpenses([])
    setHasMore(true)
    try {
      const [page, totalData, catData] = await Promise.all([
        expenseRepository.getPage(brand.id, { month: filterMonth || null, offset: 0, limit: PAGE_SIZE }),
        expenseRepository.getTotals(brand.id, filterMonth || null),
        expenseRepository.getCategories(brand.id, filterMonth || null),
      ])
      if (seq !== loadSeq.current) return // a newer load (month change, save) owns the screen
      setExpenses(page || [])
      setTotals(totalData?.[0] || { total_amount: 0, transaction_count: 0 })
      // Aggregate categories from summary rows
      const catMap = {}
      ;(catData || []).forEach(r => {
        if (!catMap[r.category]) catMap[r.category] = { category: r.category, total: 0, count: 0 }
        catMap[r.category].total += Number(r.category_amount) || 0
        catMap[r.category].count += 1
      })
      setCategories(Object.values(catMap).sort((a, b) => b.total - a.total))
      setHasMore((page || []).length === PAGE_SIZE)
    } catch (e) {
      if (seq !== loadSeq.current) return
      // A failed read must never look like "no spending": say so and offer a retry.
      console.error('[Expenses] load failed:', e?.message)
      setLoadError(e?.message || 'Could not load expenses.')
      setTotals({ total_amount: 0, transaction_count: 0 })
      setCategories([])
    }
    if (seq === loadSeq.current) setLoading(false)
  }

  async function loadMore() {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const more = await expenseRepository.getPage(brand.id, { month: filterMonth || null, offset: expenses.length, limit: PAGE_SIZE })
      setExpenses(p => [...p, ...(more || [])])
      setHasMore((more || []).length === PAGE_SIZE)
    } catch (e) { showToast('Could not load more expenses. Please try again.', { type: 'error' }) }
    setLoadingMore(false)
  }

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
      showToast('Could not save the expense. Nothing was recorded; please try again.', { type: 'error' })
    }
    saveInFlight.current = false
    setSaving(false)
  }

  function closeAdd() { setShowAdd(false); setForm({ date: todayDate() }); setFormErrors({}); draftId.current = null }

  function askDelete(e) { setDeleteTarget(e) }
  async function handleDelete() {
    const id = deleteTarget?.id
    setDeleteTarget(null)
    try { await expenseRepository.delete(id, brand.id); load(); showToast('Expense deleted.', { type: 'success' }) } catch (e) { showToast('Could not delete expense. Please try again.', { type: 'error' }) }
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
      showToast(amount > 0 ? 'Budget set to ' + fmt(amount) + ' from ' + filterMonth + '.' : 'Budget removed from ' + filterMonth + '.', { type: 'success' })
    } catch (e) {
      console.error('[Expenses] budget save failed:', e?.message)
      showToast(/Only the Owner/.test(e?.message || '') ? 'Only the Owner can set the expense budget.' : 'Could not save the budget. Nothing was changed; please try again.', { type: 'error' })
    }
    setSavingBudget(false)
  }

  const total = Number(totals.total_amount) || 0
  // Spending that could not be read (or is still loading) must not show as "nothing spent, all remaining".
  const spendingKnown = !loading && !loadError
  const summary = budgetSummary(budget, total)
  const remaining = summary.remaining
  const pctUsed = spendingKnown ? summary.pctUsed : 0
  const overBudget = spendingKnown && summary.over
  const nearLimit = spendingKnown && summary.near
  const money = (n) => (spendingKnown ? fmt(n) : '—')

  const byCategory = {}
  categories.forEach(c => { byCategory[c.category] = c.total })

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
    snapshot: () => ({ form, budgetInput, filterMonth }),
    onScan: (code, snap) => {
      setForm(snap.form)
      setBudgetInput(snap.budgetInput)
      setFilterMonth(snap.filterMonth)
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
          <TealBtn onClick={() => setShowAdd(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Plus size={15} /> Log expense</TealBtn>
        </div>
      </div>

      {/* Budget could not be read: never shown as "no budget" */}
      {budgetState.status === 'error' && filterMonth && (
        <div role='alert' style={{ padding: '14px 18px', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', borderRadius: theme.radius.lg, background: 'white', border: `1px solid ${warning}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: navy }}><AlertTriangle size={15} color={warning} aria-hidden='true' /> The budget could not be loaded. It has not been lost.</div>
          <TealBtn onClick={budgetState.reload} style={{ padding: '8px 16px', fontSize: '12px' }}>Try again</TealBtn>
        </div>
      )}
      {budgetState.status === 'loading' && filterMonth && (
        <div role='status' style={{ marginBottom: '20px', fontSize: '12px', color: gray500 }}>Loading the budget…</div>
      )}

      {/* Budget Tracker */}
      {budget > 0 && filterMonth && (
        <Card style={{ padding: '20px', marginBottom: '20px', border: overBudget ? `2px solid ${danger}` : nearLimit ? `2px solid ${warning}` : `1px solid ${border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '800', fontSize: '15px', color: navy }}>
                {overBudget ? <><AlertCircle size={15} color={danger} /> Over budget!</> : nearLimit ? <><AlertTriangle size={15} color={warning} /> Approaching limit</> : <><CheckCircle size={15} color={success} /> Budget tracker</>}
              </div>
              <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>
                {filterMonth} · {carriedFrom ? 'Carried over from ' + carriedFrom + ' budget' : 'Set by Owner'}
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
              <AlertTriangle size={14} /> You have exceeded the monthly budget by {fmt(Math.abs(remaining))}! Please review expenses.
            </div>
          )}
          {nearLimit && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', padding: '10px 14px', borderRadius: theme.radius.md, background: warningBg, border: `1px solid ${warning}`, fontSize: '13px', color: warning, fontWeight: '700' }}>
              <AlertTriangle size={14} /> {pctUsed}% of the budget used. Only {fmt(remaining)} is left this month.
            </div>
          )}
        </Card>
      )}

      {/* No budget set — prompt owner */}
      {budget === 0 && isOwner && budgetState.status === 'ready' && filterMonth && (
        <div style={{ marginBottom: '20px', padding: '14px 18px', borderRadius: theme.radius.lg, background: tealMist, border: `1px dashed ${tealBright}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '700', color: tealDeep, fontSize: '14px' }}><Target size={15} /> Set a monthly expense budget</div>
            <div style={{ fontSize: '12px', color: gray600, marginTop: '2px' }}>Track spending against a target and get alerts when approaching the limit</div>
          </div>
          <TealBtn onClick={() => setShowBudget(true)} style={{ padding: '8px 16px', fontSize: '12px' }}>Set budget</TealBtn>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard icon={<Receipt />} label={filterMonth ? `Total for ${filterMonth}` : 'Total (all time)'} value={loadError ? '—' : fmt(total)} />
        <StatCard icon={<BarChart2 />} label='Categories' value={loadError ? '—' : Object.keys(byCategory).length} />
        <StatCard icon={<Clipboard />} label='Transactions' value={loadError ? '—' : (totals.transaction_count || 0)} />
      </div>

      {/* Category breakdown */}
      {Object.keys(byCategory).length > 0 && (
        <Card style={{ padding: '20px', marginBottom: '20px' }}>
          <div style={{ fontWeight: '800', fontSize: '15px', marginBottom: '14px', color: navy }}>Breakdown by category</div>
          {Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
            <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
              <span style={{ fontSize: '12px', color: gray600, width: '120px', fontWeight: '600', flexShrink: 0 }}>{cat}</span>
              <div style={{ flex: 1, height: '8px', background: gray100, borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: (total > 0 ? (amt / total) * 100 : 0) + '%', background: tealDeep, borderRadius: '4px' }} />
              </div>
              <span style={{ fontSize: '13px', fontWeight: '700', width: '100px', textAlign: 'right', flexShrink: 0, color: navy }}>{fmt(amt)}</span>
            </div>
          ))}
        </Card>
      )}

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input type='month' value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
          style={{ padding: '9px 14px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', outline: 'none', color: navy, background: 'white' }} />
        <button onClick={() => setFilterMonth('')} style={{ padding: '9px 14px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: gray600, fontSize: '13px', cursor: 'pointer', fontWeight: '700' }}>All time</button>
      </div>

      {loading ? <Loading /> : loadError ? (
        <Card style={{ padding: '24px', textAlign: 'center' }} role='alert'>
          <AlertCircle size={28} color={danger} />
          <div style={{ fontWeight: '800', color: navy, margin: '8px 0 4px' }}>Expenses could not be loaded</div>
          <div style={{ fontSize: '13px', color: gray500, marginBottom: '14px' }}>Your totals are not shown because they could not be read. Nothing has been lost.</div>
          <TealBtn onClick={load}>Try again</TealBtn>
        </Card>
      ) : expenses.length === 0 ? (
        <Empty icon={<Receipt size={40} />} message={filterMonth ? 'No expenses recorded for ' + filterMonth : 'No expenses recorded yet'} action='+ Log Expense' onAction={() => setShowAdd(true)} />
      ) : (
        <Card>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${border}`, background: gray50 }}>
                  {['Category', 'Description', 'Amount', 'Date', 'Staff', 'Action'].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: gray400, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {expenses.map(e => (
                  <tr key={e.id} style={{ borderBottom: `1px solid ${gray100}` }}>
                    <td style={{ padding: '12px 16px' }}><Pill label={e.category} type='teal' /></td>
                    <td style={{ padding: '12px 16px', fontSize: '13px', color: gray600 }}>{e.description || 'Not set'}</td>
                    <td style={{ padding: '12px 16px', fontSize: '14px', fontWeight: '900', color: danger }}>{fmt(e.amount)}</td>
                    <td style={{ padding: '12px 16px', fontSize: '12px', color: gray400 }}>{businessDateOf(e.date || e.created_at)}</td>
                    <td style={{ padding: '12px 16px', fontSize: '13px', color: gray500 }}>{e.staff_name || 'Not set'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      {perms?.canDelete && <RedBtn onClick={() => askDelete(e)} style={{ padding: '4px 9px', fontSize: '11px' }}>Delete</RedBtn>}
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

      {/* Set Budget Modal */}
      <Modal show={showBudget} onClose={() => setShowBudget(false)} title={'Set Expense Budget: ' + filterMonth}
        footer={<><GhostBtn onClick={() => setShowBudget(false)} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={saveBudgetAmount} disabled={savingBudget} aria-busy={savingBudget || undefined} style={{ flex: 1, padding: '12px' }}>{savingBudget ? 'Saving…' : 'Save Budget'}</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ padding: '14px', borderRadius: theme.radius.md, background: tealMist, border: `1px solid ${tealMist}`, fontSize: '13px', color: tealDeep, lineHeight: '1.7' }}>
            Set a spending limit from <strong>{filterMonth}</strong>. It carries over to the following months until you change it; enter 0 to have no budget from this month on. {budgetState.onDevice ? 'Until CareHub finishes updating, it is saved on this device only.' : 'It is saved to your business, so everyone working here sees it on any device.'} You will be alerted when 80% is used and when the budget is exceeded.
          </div>
          <Inp id='expense-budget-amount' label={'Monthly Budget for ' + filterMonth + ' (₦)'} value={budgetInput} onChange={setBudgetInput} type='number' placeholder='e.g. 100000' />
          {budgetInput && parseFloat(budgetInput) > 0 && (
            <div style={{ padding: '12px 16px', borderRadius: theme.radius.md, background: bg, border: `1px solid ${border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
                <span style={{ color: gray500 }}>Budget</span>
                <span style={{ fontWeight: '700', color: navy }}>{fmt(parseFloat(budgetInput))}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
                <span style={{ color: gray500 }}>Already spent ({filterMonth})</span>
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
        footer={<GhostBtn onClick={() => setViewing(null)} style={{ flex: 1, padding: '12px' }}>Close</GhostBtn>}>
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
      </Modal>

      <ConfirmDialog show={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete}
        title='Delete this expense?'
        consequence={`This permanently removes the ${deleteTarget?.category || ''} expense of ${deleteTarget ? fmt(deleteTarget.amount) : ''} from your records. This cannot be undone.`}
        confirmLabel='Delete' />

      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}
