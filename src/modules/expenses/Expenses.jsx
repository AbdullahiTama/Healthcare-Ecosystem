import { useState, useEffect } from 'react'
import { Target, AlertCircle, AlertTriangle, CheckCircle, Receipt, BarChart2, Clipboard, DollarSign, Plus } from 'lucide-react'
import { getExpenses, addExpense, deleteExpense } from '../../services/supabase'
import { fmt, todayDate, currentMonth } from '../../lib/utils'
import { EXPENSE_CATS } from '../../config/constants'
import { theme } from '../../styles/theme'
import { Card, StatCard, SectionHead, Modal, ConfirmDialog, Pill, Inp, Sel, Textarea, GhostBtn, TealBtn, RedBtn, Loading, Empty, useToast, Toast } from '../../components/ui'

const { tealDeep, tealBright, tealMist, navy, gray600, gray500, gray400, gray100, gray50, border, danger, dangerBg, success, successBg, warning, warningBg, bg } = theme

const BUDGET_KEY = 'carehub_expense_budget'

function getBudgets() {
  try { return JSON.parse(localStorage.getItem(BUDGET_KEY) || '{}') } catch (e) { return {} }
}
function saveBudget(businessId, month, amount) {
  try {
    const budgets = getBudgets()
    if (!budgets[businessId]) budgets[businessId] = {}
    budgets[businessId][month] = parseFloat(amount) || 0
    localStorage.setItem(BUDGET_KEY, JSON.stringify(budgets))
  } catch (e) {}
}
function getBudget(businessId, month) {
  try {
    const budgets = getBudgets()
    return budgets[businessId]?.[month] || 0
  } catch (e) { return 0 }
}

export default function Expenses({ brand, role, perms }) {
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterMonth, setFilterMonth] = useState(currentMonth())
  const [showAdd, setShowAdd] = useState(false)
  const [showBudget, setShowBudget] = useState(false)
  const [form, setForm] = useState({ date: todayDate() })
  const [budgetInput, setBudgetInput] = useState('')
  const [budget, setBudget] = useState(0)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const isOwner = role === 'Owner'

  useEffect(() => { load() }, [brand?.id])
  useEffect(() => {
    const b = getBudget(brand?.id, filterMonth)
    setBudget(b)
    setBudgetInput(b > 0 ? String(b) : '')
  }, [brand?.id, filterMonth])

  async function load() {
    setLoading(true)
    try { const e = await getExpenses(brand.id); setExpenses(e || []) } catch (e) {}
    setLoading(false)
  }

  async function save() {
    if (!form.category || !form.amount) { showToast('Please enter category and amount.', { type: 'warning' }); return }
    setSaving(true)
    try {
      await addExpense({
        business_id: brand.id,
        category: form.category,
        description: form.description || '',
        amount: parseFloat(form.amount) || 0,
        date: form.date || todayDate(),
        staff_name: form.staffName || '',
      })
      showToast('Expense logged!', { type: 'success' })
      setForm({ date: todayDate() }); setShowAdd(false); load()
    } catch (e) { showToast('Could not save expense. Please try again.', { type: 'error' }) }
    setSaving(false)
  }

  function askDelete(e) { setDeleteTarget(e) }
  async function handleDelete() {
    const id = deleteTarget?.id
    setDeleteTarget(null)
    try { await deleteExpense(id); load(); showToast('Expense deleted.', { type: 'success' }) } catch (e) { showToast('Could not delete expense. Please try again.', { type: 'error' }) }
  }

  function saveBudgetAmount() {
    const amount = parseFloat(budgetInput) || 0
    saveBudget(brand?.id, filterMonth, amount)
    setBudget(amount)
    setShowBudget(false)
    showToast('Budget set to ' + fmt(amount) + ' for ' + filterMonth, { type: 'success' })
  }

  const filtered = filterMonth ? expenses.filter(e => e.created_at?.startsWith(filterMonth)) : expenses
  const total = filtered.reduce((s, e) => s + (e.amount || 0), 0)
  const remaining = budget > 0 ? budget - total : 0
  const pctUsed = budget > 0 ? Math.round((total / budget) * 100) : 0
  const overBudget = budget > 0 && total > budget
  const nearLimit = budget > 0 && pctUsed >= 80 && !overBudget

  const byCategory = {}
  filtered.forEach(e => { byCategory[e.category] = (byCategory[e.category] || 0) + (e.amount || 0) })

  return (
    <div>
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

      {/* Budget Tracker */}
      {budget > 0 && (
        <Card style={{ padding: '20px', marginBottom: '20px', border: overBudget ? `2px solid ${danger}` : nearLimit ? `2px solid ${warning}` : `1px solid ${border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '800', fontSize: '15px', color: navy }}>
                {overBudget ? <><AlertCircle size={15} color={danger} /> Over budget!</> : nearLimit ? <><AlertTriangle size={15} color={warning} /> Approaching limit</> : <><CheckCircle size={15} color={success} /> Budget tracker</>}
              </div>
              <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>
                {filterMonth} · Set by Owner
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '22px', fontWeight: '900', color: overBudget ? danger : tealDeep }}>
                {overBudget ? '-' + fmt(Math.abs(remaining)) : fmt(remaining)}
              </div>
              <div style={{ fontSize: '11px', color: gray500 }}>
                {overBudget ? 'over budget' : 'remaining'}
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
              <div style={{ fontSize: '15px', fontWeight: '900', color: danger, marginTop: '2px' }}>{fmt(total)}</div>
            </div>
            <div style={{ textAlign: 'center', padding: '10px', borderRadius: theme.radius.md, background: overBudget ? dangerBg : successBg }}>
              <div style={{ fontSize: '11px', color: gray500, fontWeight: '600' }}>{overBudget ? 'Over by' : 'Remaining'}</div>
              <div style={{ fontSize: '15px', fontWeight: '900', color: overBudget ? danger : success, marginTop: '2px' }}>
                {overBudget ? fmt(Math.abs(remaining)) : fmt(remaining)}
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
              <AlertTriangle size={14} /> {pctUsed}% of budget used — only {fmt(remaining)} remaining this month.
            </div>
          )}
        </Card>
      )}

      {/* No budget set — prompt owner */}
      {budget === 0 && isOwner && (
        <div style={{ marginBottom: '20px', padding: '14px 18px', borderRadius: theme.radius.lg, background: tealMist, border: `1px dashed ${tealBright}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '700', color: tealDeep, fontSize: '14px' }}><Target size={15} /> Set a monthly expense budget</div>
            <div style={{ fontSize: '12px', color: gray600, marginTop: '2px' }}>Track spending against a target and get alerts when approaching the limit</div>
          </div>
          <TealBtn onClick={() => setShowBudget(true)} style={{ padding: '8px 16px', fontSize: '12px' }}>Set budget</TealBtn>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard icon={<Receipt />} label='Total This Period' value={fmt(total)} />
        <StatCard icon={<BarChart2 />} label='Categories' value={Object.keys(byCategory).length} />
        <StatCard icon={<Clipboard />} label='Transactions' value={filtered.length} />
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

      {loading ? <Loading /> : filtered.length === 0 ? (
        <Empty icon={<Receipt size={40} />} message='No expenses recorded yet' action='+ Log Expense' onAction={() => setShowAdd(true)} />
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
                {filtered.map(e => (
                  <tr key={e.id} style={{ borderBottom: `1px solid ${gray100}` }}>
                    <td style={{ padding: '12px 16px' }}><Pill label={e.category} type='teal' /></td>
                    <td style={{ padding: '12px 16px', fontSize: '13px', color: gray600 }}>{e.description || '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: '14px', fontWeight: '900', color: danger }}>{fmt(e.amount)}</td>
                    <td style={{ padding: '12px 16px', fontSize: '12px', color: gray400 }}>{e.date || e.created_at?.split('T')[0]}</td>
                    <td style={{ padding: '12px 16px', fontSize: '13px', color: gray500 }}>{e.staff_name || '—'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      {perms?.canDelete && <RedBtn onClick={() => askDelete(e)} style={{ padding: '4px 9px', fontSize: '11px' }}>Delete</RedBtn>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Set Budget Modal */}
      <Modal show={showBudget} onClose={() => setShowBudget(false)} title={'Set Expense Budget — ' + filterMonth}
        footer={<><GhostBtn onClick={() => setShowBudget(false)} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={saveBudgetAmount} style={{ flex: 1, padding: '12px' }}>Save Budget</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ padding: '14px', borderRadius: theme.radius.md, background: tealMist, border: `1px solid ${tealMist}`, fontSize: '13px', color: tealDeep, lineHeight: '1.7' }}>
            Set a spending limit for <strong>{filterMonth}</strong>. All staff can see the budget and how much has been spent. You will be alerted when 80% is used and when the budget is exceeded.
          </div>
          <Inp label={'Monthly Budget for ' + filterMonth + ' (₦)'} value={budgetInput} onChange={setBudgetInput} type='number' placeholder='e.g. 100000' />
          {budgetInput && parseFloat(budgetInput) > 0 && (
            <div style={{ padding: '12px 16px', borderRadius: theme.radius.md, background: bg, border: `1px solid ${border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
                <span style={{ color: gray500 }}>Budget</span>
                <span style={{ fontWeight: '700', color: navy }}>{fmt(parseFloat(budgetInput))}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
                <span style={{ color: gray500 }}>Already spent ({filterMonth})</span>
                <span style={{ fontWeight: '700', color: danger }}>{fmt(total)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', borderTop: `1px solid ${border}`, paddingTop: '8px', marginTop: '4px' }}>
                <span style={{ color: gray500 }}>Remaining</span>
                <span style={{ fontWeight: '900', color: parseFloat(budgetInput) - total < 0 ? danger : success }}>
                  {fmt(parseFloat(budgetInput) - total)}
                </span>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Add Expense Modal */}
      <Modal show={showAdd} onClose={() => { setShowAdd(false); setForm({ date: todayDate() }) }} title='Log Expense'
        footer={<><GhostBtn onClick={() => { setShowAdd(false); setForm({ date: todayDate() }) }} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={save} style={{ flex: 1, padding: '12px' }}>{saving ? 'Saving...' : 'Save Expense'}</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {budget > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 14px', borderRadius: theme.radius.md, background: overBudget ? dangerBg : tealMist, border: `1px solid ${overBudget ? danger : tealMist}`, fontSize: '12px', color: overBudget ? danger : tealDeep, fontWeight: '600' }}>
              {overBudget ? <><AlertTriangle size={13} /> Already over budget by {fmt(Math.abs(remaining))}</> : <><DollarSign size={13} /> Budget remaining this month: {fmt(remaining)}</>}
            </div>
          )}
          <Sel label='Category *' value={form.category} onChange={v => f('category', v)} options={EXPENSE_CATS} required />
          <Inp label='Description' value={form.description} onChange={v => f('description', v)} placeholder='What was this expense for?' />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Inp label='Amount (₦) *' value={form.amount} onChange={v => f('amount', v)} type='number' placeholder='0' required />
            <Inp label='Date' value={form.date} onChange={v => f('date', v)} type='date' />
          </div>
          <Inp label='Recorded By' value={form.staffName} onChange={v => f('staffName', v)} placeholder='Your name' />
          {form.amount && budget > 0 && (
            <div style={{ padding: '10px', borderRadius: theme.radius.md, background: bg, fontSize: '12px', color: gray600 }}>
              After this expense: <strong style={{ color: remaining - (parseFloat(form.amount) || 0) < 0 ? danger : success }}>
                {fmt(remaining - (parseFloat(form.amount) || 0))} remaining
              </strong>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog show={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete}
        title='Delete this expense?'
        consequence={`This permanently removes the ${deleteTarget?.category || ''} expense of ${deleteTarget ? fmt(deleteTarget.amount) : ''} from your records. This cannot be undone.`}
        confirmLabel='Delete' />

      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}
