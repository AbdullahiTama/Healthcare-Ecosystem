import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { theme } from '../../styles/theme'
import {
  Button, Input, Select, Option, DataTable, StatCard, Pill, Modal, ConfirmDialog, Loading, Toast,
  PageHeader, Empty, Card, ProgressBar
} from '@care-ecosystem/design-system/components/ui'
import { useNavigate } from 'react-router-dom'

function ReportingAdmin() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [revenueStats, setRevenueStats] = useState({})
  const [salesData, setSalesData] = useState([])
  const [productPerformance, setProductPerformance] = useState([])
  const [inventoryStatus, setInventoryStatus] = useState([])
  const [businessStats, setBusinessStats] = useState({})
  const [adminToken, setAdminToken] = useState(null)
  const { msg, show: showToast } = useToast()

  useEffect(() => {
    const token = localStorage.getItem('admin_token')
    if (token) setAdminToken(token)
    fetchData()
  }, [])

  async function fetchData() {
    try {
      // Set default date range (last 30 days)
      const endDate = new Date()
      const startDate = new Date()
      startDate.setDate(endDate.getDate() - 30)
      
      const [salesRes, productRes, inventoryRes, bizRes] = await Promise.all([
        supabase.from('sales').select(`
          *,
          businesses!sales_business_id_fkey(name, email),
          clients!sales_client_id_fkey(full_name, display_name)
        `).gte('created_at', startDate.toISOString()).lte('created_at', endDate.toISOString()).order('created_at', { ascending: false }),
        supabase.from('master_products').select('id, name, default_price').order('name'),
        supabase.from('stock_batches').select(`
          *,
          products!stock_batches_product_id_fkey(name),
          businesses!stock_batches_business_id_fkey(name)
        `).order('created_at', { ascending: false }),
        supabase.from('businesses').select('id, name, status').order('name')
      ])

      // Process revenue stats
      const revenueData = (salesRes.data || []).reduce((acc, sale) => {
        const amount = Number(sale.total || 0)
        acc.totalRevenue += amount
        acc.totalTransactions++
        if (sale.business_id) {
          const biz = acc.byBusiness[sale.business_id] || { revenue: 0, transactions: 0 }
          biz.revenue += amount
          biz.transactions++
          acc.byBusiness[sale.business_id] = biz
        }
        return acc
      }, { totalRevenue: 0, totalTransactions: 0, byBusiness: {} })

      // Process product performance
      const productPerf = (salesRes.data || []).reduce((acc, sale) => {
        const items = sale.items || []
        items.forEach((item: any) => {
          const productId = item.product_id || item.id
          const existing = acc[productId] || { productName: '', revenue: 0, units: 0, transactions: 0 }
          const itemQty = item.quantity || 1
          existing.revenue += (item.price || 0) * itemQty
          existing.units += itemQty
          existing.transactions++
          // Find product name
          const product = productPerf.find(p => p.id === productId)
          if (product && product.productName) existing.productName = product.productName
          acc[productId] = existing
        })
        return acc
      }, {})

      setRevenueStats({ ...revenueData, period: 'Last 30 days' })
      setSalesData(salesRes.data || [])
      setProductPerformance(Object.values(productPerf).sort((a, b) => b.revenue - a.revenue).slice(0, 10))
      setInventoryStatus(stockBatches.data || [])
      setBusinessStats(bizRes.data ? bizRes.data.reduce((acc, biz) => {
        acc[biz.id] = { name: biz.name, active: biz.status === 'active' }
        return acc
      }, {}) : {})
      setLoading(false)
    } catch (err) {
      showToast(`Error loading reports: ${err.message}`, { type: 'error' })
      setLoading(false)
    }
  }

  async function applyDateFilter() {
    setLoading(true)
    setTimeout(() => fetchData(), 500)
  }

  const STATS = [
    { label: 'Total Revenue', value: revenueStats.totalRevenue ? `₦${revenueStats.totalRevenue.toLocaleString()}` : '0', icon: '💰', alert: revenueStats.totalRevenue > 0 },
    { label: 'Transactions', value: revenueStats.totalTransactions || 0, icon: '💳' },
    { label: 'Active Businesses', value: Object.keys(businessStats).filter(k => businessStats[k].active).length, icon: '🏢' },
    { label: 'Products Tracked', value: productPerformance.length, icon: '📊' }
  ]

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 1200, margin: '0 auto', paddingBottom: 40 }}>
      <div style={{ background: theme.heroGradient, padding: '24px', color: '#fff', borderRadius: 12, marginBottom: 24 }}>
        <PageHeader title='Reporting & Analytics' subtitle='Business intelligence and revenue reports' />
      </div>

      <div style={{ marginBottom: 24, background: '#fff', borderRadius: 12, padding: 20 }}>
        <h3 style={{ margin: '0 0 16px 0', fontWeight: 800, fontSize: 16, color: theme.navy }}>Report Period</h3>
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ fontSize: 12, color: theme.textMid, fontWeight: 700, marginBottom: 4 }}>From</label>
            <Input
              type='date'
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              style={{ width: '100%', padding: 8, fontSize: 12, border: `1px solid ${theme.border}`, borderRadius: 6, boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ fontSize: 12, color: theme.textMid, fontWeight: 700, marginBottom: 4 }}>To</label>
            <Input
              type='date'
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              style={{ width: '100%', padding: 8, fontSize: 12, border: `1px solid ${theme.border}`, borderRadius: 6, boxSizing: 'border-box' }}
            />
          </div>
          <Button
            onClick={applyDateFilter}
            style={{ padding: '8px 16px', background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 6, fontWeight: 700 }}
            >
            Apply Filter
          </Button>
        </div>
      </div>

      <div style={{ marginBottom: 24, background: '#fff', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
          {STATS.map(s => (
            <StatCard
              key={s.label}
              icon={s.icon}
              label={s.label}
              value={s.value}
              alert={s.alert}
            />
          ))}
        </div>
      </div>

      {/* Revenue by Business */}
      {businessStats && Object.keys(businessStats).length > 0 && (
        <div style={{ marginTop: 24, background: '#fff', borderRadius: 12, padding: 20 }}>
          <h3 style={{ margin: '0 0 12px 0', fontWeight: 800, fontSize: 16, color: theme.navy }}>Revenue by Business</h3>
          <DataTable
            data={Object.entries(businessStats).map(([id, stats]) => ({
              id,
              name: stats.name,
              revenue: revenueStats.byBusiness[id] ? revenueStats.byBusiness[id].revenue : 0,
              transactions: revenueStats.byBusiness[id] ? revenueStats.byBusiness[id].transactions : 0
            }))}
            columns={[
              { key: 'name', label: 'Business' },
              { key: 'revenue', label: 'Revenue (NGN)', render: v => v > 0 ? `₦${v.toLocaleString()}` : '—' },
              { key: 'transactions', label: 'Transactions' },
            ]}
            loading={loading}
            skeletonRows={Object.keys(businessStats).length > 0 ? 5 : 0}
          />
        </div>
      )}

      {/* Product Performance */}
      {productPerformance.length > 0 && (
        <div style={{ marginTop: 24, background: '#fff', borderRadius: 12, padding: 20 }}>
          <h3 style={{ margin: '0 0 12px 0', fontWeight: 800, fontSize: 16, color: theme.navy }}>Top Products by Revenue</h3>
          <DataTable
            data={productPerformance}
            columns={[
              { key: 'productName', label: 'Product' },
              { key: 'revenue', label: 'Revenue (NGN)', render: v => v > 0 ? `₦${v.toLocaleString()}` : '—' },
              { key: 'units', label: 'Units Sold' },
              { key: 'transactions', label: 'Transactions' },
            ]}
            loading={loading}
            skeletonRows={productPerformance.length > 0 ? 5 : 0}
          />
        </div>
      )}

      {/* Revenue Trend */}
      {revenueStats.totalRevenue > 0 && (
        <div style={{ marginTop: 24, background: '#fff', borderRadius: 12, padding: 20 }}>
          <h3 style={{ margin: '0 0 12px 0', fontWeight: 800, fontSize: 16, color: theme.navy }}>Revenue Summary</h3>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <p style={{ margin: '0 0 4px 0', fontSize: 14, color: theme.textMid }}>Total Revenue</p>
              <p style={{ margin: 0, fontWeight: 800, fontSize: 24, color: theme.tealDeep }}>{revenueStats.totalRevenue > 0 ? `₦${revenueStats.totalRevenue.toLocaleString()}` : '0'}</p>
            </div>
            <div>
              <p style={{ margin: '0 0 4px 0', fontSize: 14, color: theme.textMid }}>Total Transactions</p>
              <p style={{ margin: 0, fontWeight: 800, fontSize: 24, color: theme.tealDeep }}>{revenueStats.totalTransactions || 0}</p>
            </div>
          </div>
          <p style={{ margin: '0', fontSize: 14, color: theme.textMid }}>
            Period: {revenueStats.period || 'Last 30 days'}
          </p>
        </div>
      )}
    </div>
  )
}

export default ReportingAdmin