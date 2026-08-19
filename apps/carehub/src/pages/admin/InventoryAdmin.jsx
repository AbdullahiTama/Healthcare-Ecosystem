import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { theme } from '../../styles/theme'
import {
  Button, Input, Select, Option, DataTable, StatCard, Pill, Modal, ConfirmDialog, Loading, Toast,
  PageHeader, Empty, Card, ProgressBar
} from '@care-ecosystem/design-system/components/ui'
import { useNavigate } from 'react-router-dom'

function InventoryAdmin() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [stockBatches, setStockBatches] = useState([])
  const [stockMovements, setStockMovements] = useState([])
  const [outOfStock, setOutOfStock] = useState([])
  const [businesses, setBusinesses] = useState([])
  const [products, setProducts] = useState([])
  const [form, setForm] = useState({ batch_number: '', product_id: null, quantity: 0, expiry_date: null, supplier_source: '', status: 'active', notes: '' })
  const [formTitle, setFormTitle] = useState('Add Stock Batch')
  const [editingId, setEditingId] = useState(null)
  const [deleteId, setDeleteId] = useState(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [adminToken, setAdminToken] = useState(null)
  const [saving, setSaving] = useState(false)
  const { msg, show: showToast } = useToast()

  useEffect(() => {
    const token = localStorage.getItem('admin_token')
    if (token) setAdminToken(token)
    fetchData()
  }, [])

  async function fetchData() {
    try {
      const [batchesRes, movementsRes, oosRes, bizRes, productsRes] = await Promise.all([
        supabase.from('stock_batches').select(`
          *,
          products!stock_batches_product_id_fkey(name, category),
          businesses!stock_batches_business_id_fkey(name)
        `).order('created_at', { ascending: false }),
        supabase.from('stock_movements').select(`
          *,
          businesses!stock_movements_business_id_fkey(name),
          stock_batches!stock_movements_batch_id_fkey(batch_number)
        `).order('created_at', { ascending: false }),
        supabase.from('out_of_stock').select(`
          *,
          products!out_of_stock_product_id_fkey(name, category)
        `).order('created_at', { ascending: false }),
        supabase.from('businesses').select('id, name, status').order('name'),
        supabase.from('products').select('id, name, category, default_price').order('name')
      ])

      setStockBatches(batchesRes.data || [])
      setStockMovements(movementsRes.data || [])
      setOutOfStock(oosRes.data || [])
      setBusinesses(bizRes.data || [])
      setProducts(productsRes.data || [])
      setLoading(false)
    } catch (err) {
      showToast(`Error loading inventory: ${err.message}`, { type: 'error' })
      setLoading(false)
    }
  }

  async function handleCreate() {
    setForm({ batch_number: '', product_id: null, quantity: 0, expiry_date: null, supplier_source: '', status: 'active', notes: '' })
    setFormTitle('Add Stock Batch')
    setEditingId(null)
  }

  async function handleEdit(id) {
    const batch = stockBatches.find(b => b.id === id)
    if (batch) {
      setForm({ batch_number: batch.batch_number, product_id: batch.product_id, quantity: batch.quantity, expiry_date: batch.expiry_date?.toISOString().split('T')[0], supplier_source: batch.supplier_source || '', status: batch.status || 'active', notes: batch.notes || '' })
      setFormTitle('Edit Stock Batch')
      setEditingId(id)
    }
  }

  async function handleDelete(id) {
    setDeleteId(id)
    setShowDeleteConfirm(true)
  }

  async function confirmDelete() {
    if (!deleteId) return
    try {
      const { error } = await supabase.from('stock_batches').delete().eq('id', deleteId)
      if (error) throw error
      fetchData()
      showToast('Stock batch removed', { type: 'success' })
    } catch (err) {
      showToast(`Error removing stock batch: ${err.message}`, { type: 'error' })
    } finally {
      setShowDeleteConfirm(false)
      setDeleteId(null)
    }
  }

  async function saveForm() {
    if (!adminToken) return showToast('Not authenticated', { type: 'error' })
    setSaving(true)
    try {
      if (form.id) {
        const { error } = await supabase
          .from('stock_batches')
          .update({ batch_number: form.batch_number, product_id: form.product_id, quantity: form.quantity, expiry_date: form.expiry_date, supplier_source: form.supplier_source, status: form.status, notes: form.notes, updated_at: new Date().toISOString() })
          .eq('id', form.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('stock_batches')
          .insert({ batch_number: form.batch_number, product_id: form.product_id, quantity: form.quantity, expiry_date: form.expiry_date, supplier_source: form.supplier_source, status: form.status, notes: form.notes, business_id: adminToken ? null : undefined })
        if (error) throw error
      }
      fetchData()
      setFormTitle('Add Stock Batch')
      setForm({ batch_number: '', product_id: null, quantity: 0, expiry_date: null, supplier_source: '', status: 'active', notes: '' })
      setEditingId(null)
      showToast('Stock batch saved', { type: 'success' })
    } catch (err) {
      showToast(`Error saving stock batch: ${err.message}`, { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function addMovement() {
    if (!adminToken) return showToast('Not authenticated', { type: 'error' })
    setSaving(true)
    try {
      const { error } = await supabase
        .from('stock_movements')
        .insert({ batch_id: form.id || null, from_location_id: null, to_location_id: null, movement_type: 'adjustment', quantity: form.quantity, reason: 'Inventory adjustment', moved_by: adminToken.substring(0, 8) })
      if (error) throw error
      fetchData()
      showToast('Stock movement recorded', { type: 'success' })
    } catch (err) {
      showToast(`Error recording stock movement: ${err.message}`, { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Loading fullScreen />

  const STATS = [
    { label: 'Stock Batches', value: stockBatches.length, icon: '📦' },
    { label: 'Stock Movements', value: stockMovements.length, icon: '🔄' },
    { label: 'Out of Stock', value: outOfStock.length, icon: '⚠️', alert: outOfStock.length > 0 }
  ]

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 1200, margin: '0 auto', paddingBottom: 40 }}>
      <div style={{ background: theme.heroGradient, padding: '24px', color: '#fff', borderRadius: 12, marginBottom: 24 }}>
        <PageHeader title='Inventory Management' subtitle='Track stock batches, movements and out-of-stock items' />
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 20, background: '#fff', borderRadius: 12, overflow: 'hidden' }}>
        {STATS.map(s => (
          <Button
            key={s.label}
            onClick={() => {}}
            style={{
              padding: '8px 16px', borderRadius: 20, fontSize: 12, fontWeight: 700,
              border: '1px solid transparent',
              background: s.alert ? theme.dangerBg : theme.bg,
              color: s.alert ? theme.alert : theme.textMid
            }}
            title={s.label}
          >
            {s.icon} {s.value}
          </Button>
        ))}
      </div>

      {/* Add Stock Batch Form Modal */}
      <Modal
        show={formTitle && formTitle.includes('Add')}
        onClose={() => {
          setFormTitle('Add Stock Batch')
          setForm({ batch_number: '', product_id: null, quantity: 0, expiry_date: null, supplier_source: '', status: 'active', notes: '' })
        }}
        title={formTitle}
      >
        <Input
          label='Batch Number *'
          value={form.batch_number}
          onChange={v => setForm(p => ({ ...p, batch_number: v }))}
          required
        />
        <Select
          label='Product *'
          value={form.product_id}
          onChange={v => setForm(p => ({ ...p, product_id: v }))}
          options={products.map(p => ({ label: p.name, value: p.id }))}
        />
        <Input
          label='Quantity *'
          type='number'
          value={form.quantity}
          onChange={v => setForm(p => ({ ...p, quantity: Number(v) }))}
          required
        />
        <Input
          label='Expiry Date (YYYY-MM-DD)'
          type='date'
          value={form.expiry_date}
          onChange={v => setForm(p => ({ ...p, expiry_date: v }))}
        />
        <Input
          label='Supplier Source'
          value={form.supplier_source}
          onChange={v => setForm(p => ({ ...p, supplier_source: v }))}
        />
        <Select
          label='Status'
          value={form.status}
          onChange={v => setForm(p => ({ ...p, status: v }))}
          options=['active', 'expired', 'quarantined', 'transferred']
        />
        <Textarea
          label='Notes'
          value={form.notes}
          onChange={v => setForm(p => ({ ...p, notes: v }))}
          placeholder='e.g. Received from supplier, quality check passed'
        />
        <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
          <Button
            size='sm'
            onClose={() => setFormTitle('Add Stock Batch')}
            style={{ flex: 1, background: 'none', border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textMid }}
            >
            Cancel
          </Button>
          <Button
            size='sm'
            onClick={saveForm}
            style={{ flex: 1, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 6 }}
            >
            {form.id ? 'Update' : 'Add Batch'}
          </Button>
        </div>
      </Modal>

      {/* Stock Batches Table */}
      <div style={{ marginTop: 24, overflowX: 'auto' }}>
        <h3 style={{ margin: '0 0 12px 0', fontWeight: 800, fontSize: 16, color: theme.navy }}>Stock Batches ({stockBatches.length})</h3>
        <Button
          onClick={handleCreate}
          style={{ marginBottom: 16, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px' }}
          >
          Add Stock Batch
        </Button>
        <DataTable
          data={stockBatches}
          columns={[
            { key: 'batch_number', label: 'Batch #' },
            { key: 'products.name', label: 'Product' },
            { key: 'businesses.name', label: 'Business' },
            { key: 'quantity', label: 'Quantity', render: v => `${v} ${v > 1 ? 'units' : 'unit'}` },
            { key: 'expiry_date', label: 'Expiry', render: v => v ? new Date(v).toLocaleDateString() : 'N/A' },
            { key: 'status', label: 'Status', render: v => <Pill type={v === 'active' ? 'green' : 'amber'} size='sm'>{v}</Pill> },
            {
              key: 'actions',
              label: 'Actions',
              render: (row) => (
                <div style={{ display: 'flex', gap: 4 }}>
                  <Button
                    size='sm'
                    onClick={() => handleEdit(row.id)}
                    style={{ flex: 1, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 6 }}
                    >
                    Edit
                  </Button>
                  <Button
                    size='sm'
                    onClick={() => handleDelete(row.id)}
                    style={{ flex: 1, background: theme.dangerBg, color: theme.alert, border: 'none', borderRadius: 6 }}
                    >
                    Delete
                  </Button>
                </div>
              )
            }
          ]}
          loading={loading}
          skeletonRows={5}
        />
      </div>

      {/* Out of Stock Items */}
      <div style={{ marginTop: 24, marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 12px 0', fontWeight: 800, fontSize: 16, color: theme.navy }}>Out of Stock Items ({outOfStock.length})</h3>
        {outOfStock.length === 0 && <p style={{ color: theme.textLight, fontSize: 14 }}>No out-of-stock items</p>}
        <DataTable
          data={outOfStock}
          columns={[
            { key: 'products.name', label: 'Product' },
            { key: 'quantity_needed', label: 'Quantity Needed' },
            { key: 'status', label: 'Status', render: v => <Pill type={v} size='sm'>{v}</Pill> },
            { key: 'target_price', label: 'Target Price (NGN)', render: v => v ? `₦${v.toLocaleString()}` : '—' },
            {
              key: 'actions',
              label: 'Actions',
              render: (row) => (
                <div style={{ display: 'flex', gap: 4 }}>
                  <Button
                    size='sm'
                    style={{ flex: 1, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 6 }}
                    >
                    Mark as Resolved
                  </Button>
                  <Button
                    size='sm'
                    style={{ flex: 1, background: theme.bg, color: theme.textMid, border: `1px solid ${theme.border}`, borderRadius: 6 }}
                    >
                    Details
                  </Button>
                </div>
              )
            }
          ]}
          loading={loading}
          skeletonRows={outOfStock.length > 0 ? 3 : 0}
        />
      </div>

      {/* Stock Movements */}
      <div style={{ marginTop: 24 }}>
        <h3 style={{ margin: '0 0 12px 0', fontWeight: 800, fontSize: 16, color: theme.navy }}>Stock Movements ({stockMovements.length})</h3>
        <DataTable
          data={stockMovements}
          columns={[
            { key: 'businesses.name', label: 'Business' },
            { key: 'movement_type', label: 'Type' },
            { key: 'quantity', label: 'Quantity', render: v => `${v} units` },
            { key: 'reason', label: 'Reason' },
            { key: 'created_at', label: 'Date', render: v => new Date(v).toLocaleDateString() },
          ]}
          loading={loading}
          skeletonRows={5}
        />
      </div>
    </div>
  )
}

export default InventoryAdmin