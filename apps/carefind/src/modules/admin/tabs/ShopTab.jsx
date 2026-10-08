import { useState, useEffect, useCallback } from 'react'
import { ShoppingBag, Search, RefreshCw, CheckCircle, XCircle, Eye, ExternalLink } from 'lucide-react'
import { Card, Empty, Loading, ErrorState } from '@care-ecosystem/design-system/components/ui'
import { StatusDot } from '../components/StatusDot'
import { RowActions } from '../components/RowActions'
import { AdminPageHeader } from '../ui'
import { callAdminAuth } from '../adminApi'

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'rejected', label: 'Rejected' },
]

export default function ShopTab({ showToast }) {
  const [products, setProducts] = useState([])
  const [applications, setApplications] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [activeView, setActiveView] = useState('products')
  const pageSize = 15

  const loadShopData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const token = localStorage.getItem('admin_token')
      const [productsRes, appsRes] = await Promise.all([
        callAdminAuth('list_ecommerce_products_admin', { token }).catch(() => ({ data: [] })),
        callAdminAuth('list_ecommerce_applications', { token }).catch(() => ({ data: [] })),
      ])
      setProducts(productsRes.data || [])
      setApplications(appsRes.data || [])
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadShopData() }, [loadShopData])

  async function handleAppStatus(id, status) {
    try {
      await callAdminAuth('update_ecommerce_application', { token: localStorage.getItem('admin_token'), id, status })
      setApplications(prev => prev.map(a => a.id === id ? { ...a, status } : a))
      showToast(`Application ${status}`, { type: 'success' })
    } catch (e) {
      showToast(e.message, { type: 'error' })
    }
  }

  async function handleModerateProduct(id, patch) {
    try {
      await callAdminAuth('moderate_ecommerce_product', { token: localStorage.getItem('admin_token'), id, ...patch })
      setProducts(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p))
      showToast('Product updated', { type: 'success' })
    } catch (e) {
      showToast(e.message, { type: 'error' })
    }
  }

  const filteredProducts = products.filter(p => {
    const matchSearch = !search || (p.name || '').toLowerCase().includes(search.toLowerCase()) || (p.seller_name || '').toLowerCase().includes(search.toLowerCase())
    const matchStatus = !statusFilter || p.status === statusFilter
    return matchSearch && matchStatus
  })

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / pageSize))
  const visibleProducts = filteredProducts.slice((page - 1) * pageSize, page * pageSize)

  const pendingApps = applications.filter(a => a.status === 'pending' || a.status === 'submitted')

  if (loading) return <Loading />
  if (error) return <ErrorState message={error} onRetry={loadShopData} />

  return (
    <div>
      <AdminPageHeader title="Shop" subtitle="Manage e-commerce products and seller applications">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>
            {products.length} products · {pendingApps.length} pending apps
          </span>
          <button onClick={loadShopData} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700 }}>
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </AdminPageHeader>

      {/* View toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {[{ value: 'products', label: 'Products' }, { value: 'applications', label: 'Applications' }].map(opt => (
          <button key={opt.value} onClick={() => setActiveView(opt.value)} style={{ padding: '6px 14px', borderRadius: 9999, border: activeView === opt.value ? '1px solid var(--teal)' : '1px solid var(--border)', background: activeView === opt.value ? 'var(--teal-mist)' : 'var(--panel)', color: activeView === opt.value ? 'var(--teal)' : 'var(--muted)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
            {opt.label}
            {opt.value === 'applications' && pendingApps.length > 0 && (
              <span style={{ marginLeft: 4, minWidth: 16, height: 16, borderRadius: 8, background: 'var(--amber)', color: 'white', fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                {pendingApps.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeView === 'products' ? (
        <>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 360 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products or sellers..." aria-label="Search products" style={{ width: '100%', padding: '10px 12px 10px 30px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 13, background: 'var(--panel)', color: 'var(--fg)', boxSizing: 'border-box' }} />
            </div>
            <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }} aria-label="Filter by status" style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 13, background: 'var(--panel)', color: 'var(--fg)' }}>
              {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{filteredProducts.length} results · page {page}/{totalPages}</span>
          </div>

          {visibleProducts.length === 0 ? (
            <div style={{ minHeight: 108, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12 }}>
              <Empty icon={<ShoppingBag size={28} />} message={search || statusFilter ? 'No products match filters.' : 'No products yet.'} />
            </div>
          ) : (
            <Card style={{ padding: 0, overflow: 'hidden', background: 'var(--panel)', border: '1px solid var(--border)' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead style={{ background: 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
                    <tr style={{ height: 36 }}>
                      <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Product</th>
                      <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Seller</th>
                      <th style={{ padding: '0 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Price</th>
                      <th style={{ padding: '0 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Status</th>
                      <th style={{ padding: '0 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleProducts.map(p => (
                      <tr key={p.id} className="ds-data-row" style={{ height: 36, borderBottom: '1px solid var(--hairline)' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 8, height: 36 }}>
                          <span style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--teal-mist)', color: 'var(--teal)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <ShoppingBag size={14} />
                          </span>
                          <span style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>{p.name || 'Unnamed'}</span>
                        </td>
                        <td style={{ padding: '0 12px', color: 'var(--muted)', fontSize: 13, whiteSpace: 'nowrap' }}>{p.seller_name || '—'}</td>
                        <td style={{ padding: '0 12px', textAlign: 'right', fontWeight: 700, color: 'var(--fg)' }}>₦{(p.price || 0).toLocaleString()}</td>
                        <td style={{ padding: '0 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: p.status === 'active' ? 'var(--green)' : p.status === 'pending' ? 'var(--amber)' : 'var(--muted)' }}>
                            <StatusDot status={p.status || 'pending'} /> {p.status || 'pending'}
                          </span>
                        </td>
                        <td style={{ padding: '0 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <RowActions actions={[
                            p.status === 'pending' && { label: 'Approve', variant: 'primary', icon: <CheckCircle size={11} />, onClick: () => handleModerateProduct(p.id, { status: 'active' }) },
                            p.status === 'active' && { label: 'Reject', variant: 'danger', icon: <XCircle size={11} />, onClick: () => handleModerateProduct(p.id, { status: 'rejected' }) },
                            p.status === 'rejected' && { label: 'Restore', variant: 'primary', icon: <CheckCircle size={11} />, onClick: () => handleModerateProduct(p.id, { status: 'active' }) },
                          ].filter(Boolean)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', marginTop: 12 }}>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: page <= 1 ? 'var(--hairline)' : 'var(--panel)', color: page <= 1 ? 'var(--muted-2)' : 'var(--fg)', fontWeight: 700, fontSize: 12, cursor: page <= 1 ? 'not-allowed' : 'pointer' }}>Prev</button>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>Page {page} of {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: page >= totalPages ? 'var(--hairline)' : 'var(--panel)', color: page >= totalPages ? 'var(--muted-2)' : 'var(--fg)', fontWeight: 700, fontSize: 12, cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}>Next</button>
            </div>
          )}
        </>
      ) : (
        /* Applications view */
        <>
          {pendingApps.length === 0 && applications.length === 0 ? (
            <div style={{ minHeight: 108, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12 }}>
              <Empty icon={<ShoppingBag size={28} />} message="No seller applications" />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {applications.map(a => (
                <Card key={a.id} style={{ padding: 14, background: 'var(--panel)', border: a.status === 'pending' || a.status === 'submitted' ? '1px solid var(--amber)' : '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--fg)' }}>{a.business_name || a.applicant_name || 'Application'}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{a.applicant_email || a.contact_email || ''} · {a.created_at ? new Date(a.created_at).toLocaleDateString() : '—'}</div>
                    </div>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: a.status === 'approved' ? 'var(--green)' : a.status === 'pending' || a.status === 'submitted' ? 'var(--amber)' : 'var(--muted)', background: a.status === 'approved' ? 'var(--green-bg)' : a.status === 'pending' || a.status === 'submitted' ? 'var(--amber-bg)' : 'var(--hairline)', padding: '4px 8px', borderRadius: 9999 }}>
                      <StatusDot status={a.status === 'approved' ? 'active' : a.status === 'rejected' ? 'rejected' : 'pending'} /> {a.status}
                    </span>
                  </div>
                  {(a.status === 'pending' || a.status === 'submitted') && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <button onClick={() => handleAppStatus(a.id, 'approved')} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: 'var(--green)', color: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <CheckCircle size={12} /> Approve
                      </button>
                      <button onClick={() => handleAppStatus(a.id, 'rejected')} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--muted)', fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <XCircle size={12} /> Reject
                      </button>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
