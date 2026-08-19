import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { theme } from '../../styles/theme'
import {
  Button, Input, Select, Option, DataTable, StatCard, Pill, Modal, ConfirmDialog, Loading, Toast,
  PageHeader, Empty, Card
} from '@care-ecosystem/design-system/components/ui'
import { useNavigate } from 'react-router-dom'

function PricingAdmin() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [masterPrices, setMasterPrices] = useState([])
  const [branchPriceOverrides, setBranchPriceOverrides] = useState([])
  const [businesses, setBusinesses] = useState([])
  const [products, setProducts] = useState([])
  const [form, setForm] = useState({ product_id: null, branch_id: null, price: null, sale_type: 'retail', price_unit: 'piece', is_override: false })
  const [formTitle, setFormTitle] = useState('Create Price')
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
      const [bizRes, prodRes, masterRes, overrideRes] = await Promise.all([
        supabase.from('businesses').select('id, name, status').order('name'),
        supabase.from('products').select('id, name, sale_type, price_unit, default_price'),
        supabase.from('master_products').select('id, name, default_price').order('name'),
        supabase.from('branch_products').select(`
          *,
          master_products(name),
          businesses!branch_products_branch_id_fkey(name)
        `).order('created_at', { ascending: false })
      ])

      setBusinesses(bizRes.data || [])
      setProducts(prodRes.data || [])
      setMasterPrices(masterRes.data || [])
      setBranchPriceOverrides(overrideRes.data || [])
      setLoading(false)
    } catch (err) {
      showToast(`Error loading pricing: ${err.message}`, { type: 'error' })
      setLoading(false)
    }
  }

  async function handleCreate() {
    setForm({ product_id: null, branch_id: null, price: null, sale_type: 'retail', price_unit: 'piece', is_override: false })
    setFormTitle('Create Price Rule')
    setEditingId(null)
  }

  async function handleEdit(id) {
    const override = branchPriceOverrides.find(o => o.id === id)
    if (override) {
      setForm({ id: override.id, product_id: override.product_id, branch_id: override.branch_id, price: override.override_price, sale_type: override.sale_type, price_unit: override.price_unit, is_override: true })
      setFormTitle('Edit Price Rule')
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
      const { error } = await supabase.from('branch_products').delete().eq('id', deleteId)
      if (error) throw error
      fetchData()
      showToast('Price override removed', { type: 'success' })
    } catch (err) {
      showToast(`Error removing price override: ${err.message}`, { type: 'error' })
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
          .from('branch_products')
          .update({ override_price: form.price, sale_type: form.sale_type, price_unit: form.price_unit, updated_at: new Date().toISOString() })
          .eq('id', form.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('branch_products')
          .insert({ product_id: form.product_id, branch_id: form.branch_id, override_price: form.price, sale_type: form.sale_type, price_unit: form.price_unit, is_override: form.is_override })
        if (error) throw error
      }
      fetchData()
      setFormTitle('Create Price')
      setForm({ product_id: null, branch_id: null, price: null, sale_type: 'retail', price_unit: 'piece', is_override: false })
      setEditingId(null)
      showToast('Price rule saved', { type: 'success' })
    } catch (err) {
      showToast(`Error saving price rule: ${err.message}`, { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Loading fullScreen />

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 1200, margin: '0 auto', paddingBottom: 40 }}>
      <div style={{ background: theme.heroGradient, padding: '24px', color: '#fff', borderRadius: 12, marginBottom: 24 }}>
        <PageHeader title='Pricing & Sale Types' subtitle='Manage product pricing, sale types and branch overrides' />
      </div>

      <div style={{ marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 12px 0', fontWeight: 800, fontSize: 16, color: theme.navy }}>Master Product Prices</h3>
        <DataTable
          data={masterPrices}
          columns={[
            { key: 'name', label: 'Product Name' },
            { key: 'default_price', label: 'Master Price (NGN)' },
            { key: 'sale_type', label: 'Sale Type', render: v => <Pill type='retail' size='sm'>Retail</Pill> },
            { key: 'price_unit', label: 'Unit', render: v => v === 'piece' ? 'Piece' : v === 'card' ? 'Card' : v},
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
                </div>
              )
            }
          ]}
          loading={loading}
          skeletonRows={5}
        />
      </div>

      <div style={{ marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 12px 0', fontWeight: 800, fontSize: 16, color: theme.navy }}>Branch Price Overrides</h3>
        <DataTable
          data={branchPriceOverrides}
          columns={[
            { key: 'master_products.name', label: 'Product' },
            { key: 'businesses.name', label: 'Branch' },
            { key: 'override_price', label: 'Override Price (NGN)', render: v => v !== null ? `₦${v.toLocaleString()}` : 'Inherit Master' },
            { key: 'sale_type', label: 'Sale Type', render: v => <Pill type='retail' size='sm'>Retail</Pill> },
            { key: 'price_unit', label: 'Unit', render: v => v === 'piece' ? 'Piece' : v === 'card' ? 'Card' : v },
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
                    Remove
                  </Button>
                </div>
              )
            }
          ]}
          loading={loading}
          skeletonRows={5}
        />
      </div>

      {/* Add/Edit Price Form Modal */}
      <Modal
        show={formTitle && formTitle.includes('Create')}
        onClose={() => {
          setFormTitle('Create Price')
          setForm({ product_id: null, branch_id: null, price: null, sale_type: 'retail', price_unit: 'piece', is_override: false })
        }}
        title={formTitle}
      >
        <Input
          label='Product *'
          value={form.product_id}
          onChange={v => setForm(p => ({ ...p, product_id: v }))}
          required
        />
        <Select
          label='Branch *'
          value={form.branch_id}
          onChange={v => setForm(p => ({ ...p, branch_id: v }))}
          options={businesses.map(b => ({ label: b.name, value: b.id }))}
        />
        <Input
          label='Override Price (NGN) [leave blank to set as base]'
          type='number'
          value={form.price}
          onChange={v => setForm(p => ({ ...p, price: Number(v) || null }))}
        />
        <Select
          label='Sale Type *'
          value={form.sale_type}
          onChange={v => setForm(p => ({ ...p, sale_type: v }))}
          options=['retail', 'wholesale', 'distributor']
        />
        <Select
          label='Price Unit *'
          value={form.price_unit}
          onChange={v => setForm(p => ({ ...p, price_unit: v }))}
          options=['piece', 'card', 'sachet', 'bottle', 'pack', 'box', 'roll', 'carton']
        />
        <Pill
          type={form.is_override ? 'amber' : 'green'}
          size='sm'
        >
          Is Override: {form.is_override ? 'Yes' : 'Inherit Master'}
        </Pill>
        <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
          <Button
            size='sm'
            onClose={() => setFormTitle('Create Price')}
            style={{ flex: 1, background: 'none', border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textMid }}
            >
            Cancel
          </Button>
          <Button
            size='sm'
            onClick={saveForm}
            style={{ flex: 1, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 6 }}
            >
            {form.id ? 'Update' : 'Save'}
          </Button>
        </div>
      </Modal>

      {/* Add/Edit Confirm Modal */}
      <Modal
        show={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title='Delete Price Override'
      >
        <p>Are you sure you want to delete this price override? The product will revert to the master default price.</p>
        <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
          <Button
            size='sm'
            onClose={() => setShowDeleteConfirm(false)}
            style={{ flex: 1, background: 'none', border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textMid }}
            >
            Cancel
          </Button>
          <Button
            size='sm'
            onClick={confirmDelete}
            style={{ flex: 1, background: theme.dangerBg, color: theme.alert, border: 'none', borderRadius: 6 }}
            >
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  )
}

export default PricingAdmin