import { useCallback, useEffect, useRef, useState } from 'react'
import { expenseRepository } from './repositories'
import { effectiveBudget, legacyBudgetEntries } from './expenseRules'
import { isMissingObject } from '../../lib/dbErrors'

// The monthly expense budget for one business (docs/architecture/Expense-Budgets.md).
//
// Budgets are stored in the database (expense_budgets, carehub_20270103), read by
// every member and set by the Owner. They used to live only in this browser's
// localStorage, so they vanished on another device, after site data was cleared,
// and at every new month. On the Owner's first visit after the update, budgets
// still held in this browser are moved to the database (a month that already has
// one there is left alone) and then removed from the browser.
//
// Before the migration is applied the old browser storage is used, as before,
// and `onDevice` is true so the screen can say so.
//
// status: 'loading' | 'ready' | 'error'. `amount` is the budget in force for
// `month` (0 = none); `fromMonth` is the month it was set for, which is earlier
// than `month` when it carried over; `startsOn` the day it began when a new
// budget was set mid-month (carehub_20270116), else null.
//
// "Set new budget" (startNew): the budget in force is closed and kept in the
// budget history; `history` lists the month's earlier budgets. Both need
// carehub_20270116: until it is applied `newBudgetAvailable` is false and the
// screen offers Edit only, as before.

const BUDGET_KEY = 'carehub_expense_budget'
const log = (...a) => console.info('[expenses] budget:', ...a)

function readLocal() {
  try { return JSON.parse(localStorage.getItem(BUDGET_KEY) || '{}') || {} } catch (e) { return {} }
}
function writeLocal(all) {
  try { localStorage.setItem(BUDGET_KEY, JSON.stringify(all)) } catch (e) { /* storage unavailable: nothing more to do */ }
}
function setLocal(businessId, month, amount) {
  const all = readLocal()
  all[businessId] = { ...(all[businessId] || {}), [month]: amount }
  writeLocal(all)
}
function dropLocal(businessId, months) {
  const all = readLocal()
  if (!all[businessId]) return
  for (const m of months) delete all[businessId][m]
  if (!Object.keys(all[businessId]).length) delete all[businessId]
  writeLocal(all)
}

const EMPTY = { status: 'loading', amount: 0, fromMonth: null, startsOn: null, onDevice: false }
const NO_HISTORY = { historyStatus: 'loading', history: [], newBudgetAvailable: false }

export function useExpenseBudget(businessId, month, { isOwner = false } = {}) {
  const [state, setState] = useState(EMPTY)
  const [hist, setHist] = useState(NO_HISTORY)
  const seq = useRef(0)
  const moved = useRef(new Set()) // businesses whose browser budgets were already checked this session

  // Moves this browser's budgets for the business to the database. Owner only.
  const moveLocalBudgets = useCallback(async () => {
    if (!isOwner || moved.current.has(businessId)) return
    moved.current.add(businessId)
    const entries = legacyBudgetEntries(readLocal(), businessId)
    if (!entries.length) return
    let stored
    try {
      stored = new Set(await expenseRepository.getBudgetMonths(businessId))
    } catch (e) {
      moved.current.delete(businessId) // try again on the next load
      throw e
    }
    const done = []
    for (const e of entries) {
      if (stored.has(e.month)) { done.push(e.month); continue } // the database already has this month: it wins
      try {
        await expenseRepository.setBudget(businessId, e.month, e.amount)
        done.push(e.month)
      } catch (err) {
        console.error('[expenses] budget: could not move', e.month, 'to the database:', err?.message)
      }
    }
    dropLocal(businessId, done)
    if (done.length) log(`moved ${done.length} budget(s) from this browser to the database for`, businessId)
  }, [businessId, isOwner])

  // The month's earlier budgets. A missing table means carehub_20270116 is not applied: no history and no
  // "Set new budget" yet. A failed read is shown as such, never as "no earlier budgets".
  const loadHistory = useCallback(async (mine) => {
    setHist((h) => ({ ...h, historyStatus: 'loading' }))
    try {
      const rows = await expenseRepository.getBudgetHistory(businessId, month)
      if (mine !== seq.current) return
      setHist({ historyStatus: 'ready', history: rows, newBudgetAvailable: true })
    } catch (e) {
      if (mine !== seq.current) return
      if (isMissingObject(e)) { setHist({ historyStatus: 'ready', history: [], newBudgetAvailable: false }); return }
      console.error('[expenses] budget: history load failed:', e?.message)
      setHist({ historyStatus: 'error', history: [], newBudgetAvailable: true })
    }
  }, [businessId, month])

  const load = useCallback(async () => {
    const mine = ++seq.current
    if (!businessId || !month) { setState({ status: 'ready', amount: 0, fromMonth: null, startsOn: null, onDevice: false }); setHist({ ...NO_HISTORY, historyStatus: 'ready' }); return }
    setState((s) => ({ ...s, status: 'loading' }))
    loadHistory(mine)
    try {
      await moveLocalBudgets()
      const b = await expenseRepository.getBudget(businessId, month)
      if (mine !== seq.current) return
      setState({ status: 'ready', amount: b?.amount || 0, fromMonth: b ? b.month : null, startsOn: b?.startsOn || null, onDevice: false })
    } catch (e) {
      if (mine !== seq.current) return
      if (isMissingObject(e)) {
        // The database update is not installed yet: the browser keeps the budget, as before.
        const b = effectiveBudget(readLocal()[businessId], month)
        setState({ status: 'ready', amount: b?.amount || 0, fromMonth: b ? b.month : null, startsOn: null, onDevice: true })
        return
      }
      // A failed read is not "no budget": the screen says it could not be loaded.
      console.error('[expenses] budget: load failed:', e?.message)
      setState({ status: 'error', amount: 0, fromMonth: null, onDevice: false })
    }
  }, [businessId, month, moveLocalBudgets, loadHistory])

  useEffect(() => { load() }, [load])

  // Sets the budget for `month` (0 removes it from this month on). Resolves once it is stored; throws otherwise.
  const save = useCallback(async (amount) => {
    try {
      const b = await expenseRepository.setBudget(businessId, month, amount)
      setState({ status: 'ready', amount: b.amount, fromMonth: b.month, startsOn: b.startsOn, onDevice: false })
      loadHistory(seq.current)
    } catch (e) {
      if (!isMissingObject(e)) throw e
      setLocal(businessId, month, amount)
      setState({ status: 'ready', amount, fromMonth: month, startsOn: null, onDevice: true })
    }
  }, [businessId, month, loadHistory])

  // Closes the budget in force and starts `amount` on `startsOn` (Owner only; the database checks). Resolves once
  // stored; throws otherwise (a missing function is reported as needing the update).
  const startNew = useCallback(async (amount, startsOn) => {
    try {
      const b = await expenseRepository.startNewBudget(businessId, month, amount, startsOn)
      log('new budget', amount, 'from', startsOn, 'for', businessId)
      setState({ status: 'ready', amount: b.amount, fromMonth: b.month, startsOn: b.startsOn, onDevice: false })
      await loadHistory(seq.current)
    } catch (e) {
      if (isMissingObject(e)) throw Object.assign(new Error('Setting a new budget needs the latest CareHub update, which is not installed yet. Use Edit budget for now.'), { code: 'NEW_BUDGET_UNAVAILABLE' })
      throw e
    }
  }, [businessId, month, loadHistory])

  return { ...state, ...hist, save, startNew, reload: load, reloadHistory: () => loadHistory(seq.current) }
}
