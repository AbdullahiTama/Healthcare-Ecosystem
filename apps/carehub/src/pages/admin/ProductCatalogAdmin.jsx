import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { theme } from '../../styles/theme'
import {
  Button, Input, Select, Option, DataTable, StatCard, Pill, Modal, ConfirmDialog, Loading, Toast,
  PageHeader, Empty, Card
} from '@care-ecosystem/design-system/components/ui'
import { useNavigate } from 'react-router-dom'

function ProductCatalogAdmin() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [masterProducts, setMasterProducts] = useState([])
  const [branchProducts, setBranchProducts] = useState([])
  const [businesses, setBusinesses] = useState([])
  const [form, setForm] = useState({ id: null, name: '', description: '', category: '', default_price: 0, business_id: null })
  const [formTitle, setFormTitle] = useState('Create Product')
  const [editingId, setEditingId] = useState(null)
  const [deleteId, setDeleteId] = useState(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showBranchModal, setShowBranchModal] = useState(false)
  const [productForBranch, setProductForBranch] = useState(null)
  const [branchForm, setBranchForm] = useState({ master_product_id: null, branch_id: null, active: true, override_price: null })
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterBranch, setFilterBranch] = useState('')
  const [saving, setSaving] = useState(false)
  const adminToken = localStorage.getItem('admin_token')

  useEffect(() => {
    fetchMasterProducts()
    fetchBusinesses()
  }, [])

  async function fetchMasterProducts() {
    try {
      const { data, error } = await supabase
        .from('master_products')
        .select('*, businesses(name, email)')
        .order('created_at', { ascending: false })
      if (error) throw error
      setMasterProducts(data || [])
      setLoading(false)
    } catch (err) {
      showToast(`Error loading products: ${err.message}`, { type: 'error' })
      setLoading(false)
    }
  }

  async function fetchBusinesses() {
    try {
      const { data, error } = await supabase
        .from('businesses')
        .select('id, name, status')
        .order('name')
      if (error) throw error
      setBusinesses(data || [])
    } catch (err) {
      showToast(`Error loading businesses: ${err.message}`, { type: 'error' })
    }
  }

  async function fetchBranchProducts() {
    try {
      const { data, error } = await supabase
        .from('branch_products')
        .select(`
          *,
          master_products(name, category, default_price),
          businesses!branch_products_branch_id_fkey(name)
        `)
      if (error) throw error
      setBranchProducts(data || [])
    } catch (err) {
      showToast(`Error loading branch products: ${err.message}`, { type: 'error' })
    }
  }

  async function handleCreate() {
    setForm({ id: null, name: '', description: '', category: '', default_price: 0, business_id: null })
    setFormTitle('Create Product')
    setEditingId(null)
    setTab('form')
  }

  async function handleEdit(id) {
    const product = masterProducts.find(p => p.id === id)
    if (product) {
      setForm({ id: product.id, name: product.name, description: product.description, category: product.category, default_price: product.default_price, business_id: product.business_id })
      setFormTitle('Edit Product')
      setEditingId(id)
      setTab('form')
    }
  }

  async function handleDelete(id) {
    setDeleteId(id)
    setShowDeleteConfirm(true)
  }

  async function confirmDelete() {
    if (!deleteId) return
    try {
      const { error } = await supabase
        .from('master_products')
        .delete()
        .eq('id', deleteId)
      if (error) throw error
      fetchMasterProducts()
      fetchBranchProducts()
      showToast('Product deleted', { type: 'success' })
    } catch (err) {
      showToast(`Error deleting product: ${err.message}`, { type: 'error' })
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
          .from('master_products')
          .update({ name: form.name, description: form.description, category: form.category, default_price: form.default_price })
          .eq('id', form.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('master_products')
          .insert({ name: form.name, description: form.description, category: form.category, default_price: form.default_price, business_id: form.business_id })
        if (error) throw error
      }
      fetchMasterProducts()
      fetchBranchProducts()
      setFormTitle('Create Product')
      setForm({ id: null, name: '', description: '', category: '', default_price: 0, business_id: null })
      setEditingId(null)
      setTab('list')
      showToast('Product saved', { type: 'success' })
    } catch (err) {
      showToast(`Error saving product: ${err.message}`, { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function toggleBranchActivation(row) {
    const { branch_id, master_product_id, active, override_price } = row
    try {
      const { error } = await supabase
        .from('branch_products')
        .upsert({ branch_id, master_product_id, active: !active, override_price })
      if (error) throw error
      fetchBranchProducts()
      showToast('Branch activation updated', { type: 'success' })
    } catch (err) {
      showToast(`Error updating branch activation: ${err.message}`, { type: 'error' })
    }
  }

  function getBranchColor(active) {
    return active ? 'green' : 'amber'
  }

  const masterTableColumns = [
    { key: 'name', label: 'Product Name' },
    { key: 'category', label: 'Category' },
    { key: 'default_price', label: 'Default Price (NGN)' },
    { key: 'business.name', label: 'Business' },
    { key: 'created_at', label: 'Created', render: v => new Date(v).toLocaleDateString() },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => (
        <div style={{ display: 'flex', gap: 4 }}>
          <Button
            size='sm'
            onClick={() => handleEdit(row.id)}
            style={{ flex: 1, background: theme.tealGradient, color: '#fff', border: 'none' }}
            >
            Edit
          </Button>
          <Button
            size='sm'
            onClick={() => handleDelete(row.id)}
            style={{ flex: 1, background: theme.dangerBg, color: theme.alert, border: 'none' }}
            >
            Delete
          </Button>
        </div>
      )
    }
  ]

  const branchTableColumns = [
    { key: 'master_product.name', label: 'Product' },
    { key: 'businesses.name', label: 'Branch' },
    {
      key: 'active',
      label: 'Active',
      render: (row) => (
        <Pill
          type={getBranchColor(row.active)}
          size='sm'
        >
          {row.active ? 'Yes' : 'No'}
        </Pill>
      )
    },
    { key: 'override_price', label: 'Override Price (NGN)', render: v => v !== null ? `₦${v.toLocaleString()}` : 'Inherit master' },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => (
        <div style={{ display: 'flex', gap: 4 }}>
          <Button
            size='sm'
            onClick={() => toggleBranchActivation(row)}
            style={{ flex: 1, background: theme.tealGradient, color: '#fff', border: 'none' }}
            >
            {row.active ? 'Deactivate' : 'Activate'}
          </Button>
          <Button
            size='sm'
            onClick={() => openBranchForm(row.master_product_id, row.branch_id)}
            style={{ flex: 1, background: theme.bg, color: theme.textMid, border: `1px solid ${theme.border}`, borderRadius: 6 }}
            >
            Details
          </Button>
        </div>
      )
    }
  ]

  function openBranchForm(masterProductId, branchId) {
    const product = masterProducts.find(p => p.id === masterProductId)
    const branch = businesses.find(b => b.id === branchId)
    setProductForBranch({ id: masterProductId, name: product ? product.name : 'Unknown', category: product ? product.category : '' })
    setBranchForm({ master_product_id: masterProductId, branch_id: branchId, active: true, override_price: branchForm.override_price })
    setShowBranchModal(true)
  }

  async function saveBranchForm() {
    if (!adminToken) return showToast('Not authenticated', { type: 'error' })
    setSaving(true)
    try {
      const { error } = await supabase
        .from('branch_products')
        .upsert({
          branch_id: branchForm.branch_id,
          master_product_id: branchForm.master_product_id,
          active: branchForm.active,
          override_price: branchForm.override_price
        })
      if (error) throw error
      fetchBranchProducts()
      setShowBranchModal(false)
      setBranchForm({ master_product_id: null, branch_id: null, active: true, override_price: null })
      showToast('Branch activation updated', { type: 'success' })
    } catch (err) {
      showToast(`Error saving branch activation: ${err.message}`, { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Loading fullScreen />

  const TABS = [
    { key: 'master', label: 'Master Products' },
    { key: 'branch', label: 'Branch Activation' }
  ]

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 1200, margin: '0 auto', paddingBottom: 40 }}>
      <div style={{ background: theme.heroGradient, padding: '24px', color: '#fff', borderRadius: 12, marginBottom: 24 }}>
        <PageHeader title='Product Catalog' subtitle='Manage master products and branch activation matrix' />
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 20, background: '#fff', borderRadius: 12, overflow: 'hidden' }}>
        {TABS.map(t => (
          <Button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '8px 16px', borderRadius: 20, fontSize: 12, fontWeight: 700,
              border: tab === t.key ? 'none' : `1px solid ${theme.border}`,
              background: tab === t.key ? theme.tealDeep : theme.bg,
              color: tab === t.key ? '#fff' : theme.textMid
            }}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {/* Master Products Form Modal */}
      <Modal
        show={tab === 'form' && !!formTitle}
        onClose={() => {
          setFormTitle('Create Product')
          setForm({ id: null, name: '', description: '', category: '', default_price: 0, business_id: null })
          setEditingId(null)
          setTab('list')
        }}
        title={formTitle}
      >
        <Input
          label='Product Name *'
          value={form.name}
          onChange={v => setForm(p => ({ ...p, name: v }))}
          required
        />
        <Input
          label='Description'
          value={form.description}
          onChange={v => setForm(p => ({ ...p, description: v }))}
        />
        <Select
          label='Category'
          value={filterCategory}
          onChange={v => setFilterCategory(v)}
          options={['Medicines', 'Skincare', 'Equipment', 'Consumables', 'Services', 'Other']}
        />
        <Input
          label='Default Price (NGN) *'
          type='number'
          value={form.default_price}
          onChange={v => setForm(p => ({ ...p, default_price: Number(v) || 0 }))}
          required
        />
        <Select
          label='Business *'
          value={form.business_id}
          onChange={v => setForm(p => ({ ...p, business_id: v }))}
          options={businesses.map(b => ({ label: b.name, value: b.id }))}
        />
        <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
          <Button
            size='sm'
            onClick={() => {
              setFormTitle('Create Product')
              setForm({ id: null, name: '', description: '', category: '', default_price: 0, business_id: null })
              setEditingId(null)
              setTab('list')
            }}
            style={{ flex: 1, background: 'none', border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textMid }}
            >
            Cancel
          </Button>
          <Button
            size='sm'
            onClick={saveForm}
            style={{ flex: 1, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 6 }}
            >
            {form.id ? 'Update' : 'Create'}
          </Button>
        </div>
      </Modal>

      {/* Branch Activation Form Modal */}
      <Modal
        show={showBranchModal}
        onClose={() => {
          setShowBranchModal(false)
          setBranchForm({ master_product_id: null, branch_id: null, active: true, override_price: null })
          setProductForBranch(null)
        }}
        title={productForBranch ? `Branch Activation: ${productForBranch.name}` : 'Branch Activation'}
      >
        <Input
          label='Branch *'
          value={branchForm.branch_id ? businesses.find(b => b.id === branchForm.branch_id)?.name : ''}
          onChange={v => {}}
          readOnly
        />
        <Select
          label='Master Product'
          value={branchForm.master_product_id}
          onChange={v => setBranchForm(p => ({ ...p, master_product_id: v }))}
          options={masterProducts.map(p => ({ label: p.name, value: p.id }))}
        />
        <Input
          label='Override Price (NGN) [leave blank to inherit master]'
          type='number'
          value={branchForm.override_price}
          onChange={v => setBranchForm(p => ({ ...p, override_price: Number(v) || null }))}
        />
        <Pill
          type={branchForm.active ? 'green' : 'amber'}
          size='sm'
        >
          Active: {branchForm.active ? 'Yes' : 'No'}
        </Pill>
        <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
          <Button
            size='sm'
            onClick={() => setShowBranchModal(false)}
            style={{ flex: 1, background: 'none', border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textMid }}
            >
            Cancel
          </Button>
          <Button
            size='sm'
            onClick={saveBranchForm}
            style={{ flex: 1, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 6 }}
            >
            Save
          </Button>
        </div>
      </Modal>

      {/* Delete Confirm Modal */}
      <Modal
        show={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title='Delete Product'
      >
        <p>Are you sure you want to delete this product? This will also deactivate all branch activations linked to it.</p>
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

      {/* Main Content Area */}
      {tab === 'master' && masterProducts.length === 0 && <Empty title='No master products yet' description='Click "Create Product" to add your first product.' />}

      {tab === 'master' && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ margin: '0 0 12px 0', fontWeight: 800, fontSize: 16, color: theme.navy }}>Master Products ({masterProducts.length})</h3>
          <Button
            onClick={handleCreate}
            style={{ marginBottom: 16, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px' }}
            >
            Create Product
          </Button>
          <DataTable
            data={masterProducts}
            columns={masterTableColumns}
            loading={loading}
            skeletonRows={5}
          />
        </div>
      )}

      {tab === 'branch' && branchProducts.length === 0 && <Empty title='No branch activations yet' description='Products must be created first, then assign them to branches.' />}

      {tab === 'branch' && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ margin: '0 0 12px 0', fontWeight: 800, fontSize: 16, color: theme.navy }}>Branch Activation Matrix ({branchProducts.length})</h3>
          <Button
            onClick={handleCreate}
            style={{ marginBottom: 16, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px' }}
            >
            Create Product
          </Button>
          <DataTable
            data={branchProducts}
            columns={branchTableColumns}
            loading={loading}
            skeletonRows={5}
          />
        </div>
      )}
    </div>
  )
}

export default ProductCatalogAdmin