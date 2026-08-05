import { useState, useEffect } from 'react'
import { Download, CheckCircle, AlertTriangle } from 'lucide-react'
import { purchaseRepository } from '../purchases/repositories'
// Cross-aggregate reads owned by modules that have not adopted the repository
// seam yet (sales live with POS, expenses with the expenses module).
import { getSales, getExpenses } from '../../services/supabase'
import { fmt, currentMonth } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { Card, StatCard, Loading, useToast, Toast } from '../../components/ui'

const { tealDeep, navy, gray600, gray500, gray400, gray100, gray50, border, danger, success, warning, bg } = theme

export default function Reports({ brand, role, perms }) {
  const [sales, setSales] = useState([])
  const [expenses, setExpenses] = useState([])
  const [purchases, setPurchases] = useState([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('month')
  const [customMonth, setCustomMonth] = useState(currentMonth())
  const { msg, show: showToast } = useToast()

  useEffect(() => { load() }, [brand?.id])

  async function load() {
    setLoading(true)
    try {
      const [s, e, p] = await Promise.all([getSales(brand.id), getExpenses(brand.id), purchaseRepository.getAll(brand.id)])
      setSales(s || []); setExpenses(e || []); setPurchases(p || [])
    } catch (e) {}
    setLoading(false)
  }

  const now = new Date()
  const filterItem = item => {
    const d = item.created_at || ''
    if (period === 'today') return d.startsWith(now.toISOString().split('T')[0])
    if (period === 'week') { const w = new Date(now - 7 * 864e5); return new Date(d) >= w }
    if (period === 'month') return d.startsWith(customMonth)
    if (period === 'year') return d.startsWith(String(now.getFullYear()))
    return true
  }

  const fSales = sales.filter(filterItem).filter(s => !s.is_on_hold)
  const fExpenses = expenses.filter(filterItem)
  const fPurchases = purchases.filter(filterItem)

  const totalRevenue = fSales.reduce((s, x) => s + (x.total || 0), 0)
  const totalExpenses = fExpenses.reduce((s, x) => s + (x.amount || 0), 0)
  const totalPurchases = fPurchases.reduce((s, x) => s + (x.total_cost || 0), 0)
  const netProfit = totalRevenue - totalExpenses - totalPurchases
  const creditBalance = sales.filter(s => s.is_credit && (s.balance || 0) > 0).reduce((s, x) => s + (x.balance || 0), 0)
  const cashCollected = fSales.filter(s => s.is_credit && s.amount_paid > 0).reduce((s, x) => s + (x.amount_paid || 0), 0)

  const byMethod = {}
  fSales.forEach(s => { byMethod[s.payment_method] = (byMethod[s.payment_method] || 0) + (s.total || 0) })

  const byExpCat = {}
  fExpenses.forEach(e => { byExpCat[e.category] = (byExpCat[e.category] || 0) + (e.amount || 0) })

  const dailySales = {}
  fSales.forEach(s => { const d = s.created_at?.split('T')[0] || ''; dailySales[d] = (dailySales[d] || 0) + (s.total || 0) })
  const dailyDates = Object.keys(dailySales).sort().slice(-14)
  const maxDaily = Math.max(...Object.values(dailySales), 1)

  function exportCSV() {
    const rows = [
      ['CareHub Financial Report'],
      ['Business', brand?.name || '', 'Period', period === 'month' ? customMonth : period],
      ['Generated', new Date().toLocaleDateString('en-NG')],
      [],
      ['SUMMARY'],
      ['Total Revenue', totalRevenue],
      ['Total Expenses', totalExpenses],
      ['Total Purchases', totalPurchases],
      ['Net Profit', netProfit],
      ['Credit Outstanding', creditBalance],
      [],
      ['SALES DETAIL'],
      ['Date', 'Transaction No', 'Client', 'Total', 'Payment Method', 'Credit?'],
      ...fSales.map(s => [s.created_at?.split('T')[0] || '', s.txn_no || '', s.client_name || 'Walk-in', s.total || 0, s.payment_method || '', s.is_credit ? 'Yes' : 'No']),
      [],
      ['EXPENSES DETAIL'],
      ['Date', 'Category', 'Description', 'Amount', 'Staff'],
      ...fExpenses.map(e => [e.date || e.created_at?.split('T')[0] || '', e.category || '', e.description || '', e.amount || 0, e.staff_name || '']),
      [],
      ['PURCHASES DETAIL'],
      ['Date', 'Supplier', 'Product', 'Total Cost', 'Paid', 'Balance', 'Status'],
      ...fPurchases.map(p => [p.supply_date || '', p.supplier_name || '', p.product_name || '', p.total_cost || 0, p.amount_paid || 0, p.balance || 0, p.status || '']),
    ]
    const csv = rows.map(r => (Array.isArray(r) ? r : [r]).map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'CareHub_Report_' + (period === 'month' ? customMonth : period) + '.csv'; a.click()
    URL.revokeObjectURL(url)
    showToast('Report exported!')
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
        <div><div style={{ fontSize: '20px', fontWeight: '900', color: navy }}>Financial Reports</div><div style={{ fontSize: '13px', color: gray500, marginTop: '3px' }}>Full breakdown of revenue, expenses and profit</div></div>
        {perms?.canExportReports && (
          <button onClick={exportCSV} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 18px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: navy, fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>
            <Download size={15} /> Export to Excel / CSV
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
        {['today', 'week', 'month', 'year', 'all'].map(p => { const on = period === p; return (
          <button key={p} onClick={() => setPeriod(p)}
            style={{ padding: '8px 14px', borderRadius: theme.radius.full, border: `1px solid ${on ? tealDeep : border}`, cursor: 'pointer', fontSize: '12px', fontWeight: '700', background: on ? tealDeep : 'white', color: on ? 'white' : gray600, textTransform: 'capitalize' }}>
            {p === 'all' ? 'All time' : p}
          </button>
        )})}
        {period === 'month' && (
          <input type='month' value={customMonth} onChange={e => setCustomMonth(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', outline: 'none', color: navy, background: 'white' }} />
        )}
      </div>

      {loading ? <Loading /> : (
        <>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '14px', marginBottom: '20px' }}>
            <Card style={{ padding: '20px', borderLeft: `4px solid ${success}` }}>
              <div style={{ fontSize: '12px', color: gray500, fontWeight: '600', marginBottom: '4px' }}>Total revenue</div>
              <div style={{ fontSize: '28px', fontWeight: '900', color: success }}>{fmt(totalRevenue)}</div>
              <div style={{ fontSize: '12px', color: gray400, marginTop: '4px' }}>{fSales.length} transactions</div>
            </Card>
            <Card style={{ padding: '20px', borderLeft: `4px solid ${danger}` }}>
              <div style={{ fontSize: '12px', color: gray500, fontWeight: '600', marginBottom: '4px' }}>Total expenditure</div>
              <div style={{ fontSize: '28px', fontWeight: '900', color: danger }}>{fmt(totalExpenses + totalPurchases)}</div>
              <div style={{ fontSize: '12px', color: gray400, marginTop: '4px' }}>Expenses + purchases</div>
            </Card>
            <Card style={{ padding: '20px', borderLeft: `4px solid ${netProfit >= 0 ? tealDeep : danger}` }}>
              <div style={{ fontSize: '12px', color: gray500, fontWeight: '600', marginBottom: '4px' }}>Net profit</div>
              <div style={{ fontSize: '28px', fontWeight: '900', color: netProfit >= 0 ? tealDeep : danger }}>{fmt(netProfit)}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: gray400, marginTop: '4px' }}>{netProfit >= 0 ? <><CheckCircle size={12} /> Profitable</> : <><AlertTriangle size={12} /> Loss</>}</div>
            </Card>
            <Card style={{ padding: '20px', borderLeft: `4px solid ${warning}` }}>
              <div style={{ fontSize: '12px', color: gray500, fontWeight: '600', marginBottom: '4px' }}>Credit outstanding</div>
              <div style={{ fontSize: '28px', fontWeight: '900', color: warning }}>{fmt(creditBalance)}</div>
              <div style={{ fontSize: '12px', color: gray400, marginTop: '4px' }}>Unpaid credit sales</div>
            </Card>
          </div>

          {/* Revenue by method */}
          {Object.keys(byMethod).length > 0 && (
            <Card style={{ padding: '20px', marginBottom: '20px' }}>
              <div style={{ fontWeight: '800', fontSize: '15px', marginBottom: '14px', color: navy }}>Revenue by payment method</div>
              {Object.entries(byMethod).sort((a, b) => b[1] - a[1]).map(([method, amt]) => (
                <div key={method} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                  <span style={{ fontSize: '12px', color: gray600, width: '80px', fontWeight: '600', flexShrink: 0 }}>{method}</span>
                  <div style={{ flex: 1, height: '10px', background: gray100, borderRadius: '5px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: (totalRevenue > 0 ? (amt / totalRevenue) * 100 : 0) + '%', background: tealDeep, borderRadius: '5px' }} />
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: '700', width: '100px', textAlign: 'right', flexShrink: 0, color: navy }}>{fmt(amt)}</span>
                </div>
              ))}
            </Card>
          )}

          {/* Expense breakdown */}
          {Object.keys(byExpCat).length > 0 && (
            <Card style={{ padding: '20px', marginBottom: '20px' }}>
              <div style={{ fontWeight: '800', fontSize: '15px', marginBottom: '14px', color: navy }}>Expense breakdown</div>
              {Object.entries(byExpCat).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
                <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                  <span style={{ fontSize: '12px', color: gray600, width: '110px', fontWeight: '600', flexShrink: 0 }}>{cat}</span>
                  <div style={{ flex: 1, height: '10px', background: gray100, borderRadius: '5px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: (totalExpenses > 0 ? (amt / totalExpenses) * 100 : 0) + '%', background: danger, borderRadius: '5px' }} />
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: '700', width: '100px', textAlign: 'right', flexShrink: 0, color: navy }}>{fmt(amt)}</span>
                </div>
              ))}
            </Card>
          )}

          {/* Daily chart */}
          {dailyDates.length > 0 && (
            <Card style={{ padding: '20px', marginBottom: '20px' }}>
              <div style={{ fontWeight: '800', fontSize: '15px', marginBottom: '14px', color: navy }}>Daily sales (last 14 days)</div>
              {dailyDates.map(date => (
                <div key={date} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', color: gray400, width: '60px', flexShrink: 0 }}>{date.slice(5)}</span>
                  <div style={{ flex: 1, height: '8px', background: gray100, borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: ((dailySales[date] || 0) / maxDaily * 100) + '%', background: tealDeep, borderRadius: '4px' }} />
                  </div>
                  <span style={{ fontSize: '12px', fontWeight: '700', width: '90px', textAlign: 'right', flexShrink: 0, color: navy }}>{fmt(dailySales[date] || 0)}</span>
                </div>
              ))}
            </Card>
          )}

          {/* Recent transactions */}
          <Card style={{ marginBottom: '20px' }}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${border}`, fontWeight: '800', fontSize: '15px', color: navy }}>Recent transactions</div>
            {fSales.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: gray400, fontSize: '13px' }}>No transactions in this period</div>
            ) : fSales.slice(0, 20).map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', borderBottom: `1px solid ${gray100}` }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: navy }}>{s.client_name || 'Walk-in'}</div>
                  <div style={{ fontSize: '11px', color: gray400 }}>{s.txn_no} · {s.created_at?.split('T')[0]} · {s.payment_method}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '14px', fontWeight: '900', color: tealDeep }}>{fmt(s.total || 0)}</div>
                  {s.is_credit && <span style={{ fontSize: '10px', color: warning, fontWeight: '700' }}>Credit</span>}
                </div>
              </div>
            ))}
          </Card>
        </>
      )}

      <Toast msg={msg} />
    </div>
  )
}
