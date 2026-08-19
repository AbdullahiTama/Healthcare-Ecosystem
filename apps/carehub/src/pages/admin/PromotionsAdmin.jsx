import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { theme } from '../../styles/theme'
import {
  Button, Input, Select, Option, DataTable, StatCard, Pill, Modal, ConfirmDialog, Loading, Toast,
  PageHeader, Empty, Card
} from '@care-ecosystem/design-system/components/ui'
import { useNavigate } from 'react-router-dom'

function PromotionsAdmin() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [promotions, setPromotions] = useState([])
  const [form, setForm] = useState({ title: '', link_url: '', expires_at: null, image_url: null })
  const [formTitle, setFormTitle] = useState('Create Promotion')
  const [editId, setEditId] = useState(null)
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
      const [promosRes] = await Promise.all([
        supabase.from('promotions').select('*').order('created_at', { ascending: false })
      ])
      setPromotions(promosRes.data || [])
      setLoading(false)
    } catch (err) {
      showToast(`Error loading promotions: ${err.message}`, { type: 'error' })
      setLoading(false)
    }
  }

  async function handleCreate() {
    setForm({ title: '', link_url: '', expires_at: null, image_url: null })
    setFormTitle('Create Promotion')
    setEditId(null)
  }

  async function handleEdit(id) {
    const promo = promotions.find(p => p.id === id)
    if (promo) {
      setForm({ ...promo, expires_at: promo.expires_at ? promo.expires_at.split('T')[0] : null })
      setFormTitle('Edit Promotion')
      setEditId(id)
    }
  }

  async function handleDelete(id) {
    setDeleteId(id)
    setShowDeleteConfirm(true)
  }

  async function confirmDelete() {
    if (!deleteId) return
    try {
      const { error } = await supabase.from('promotions').delete().eq('id', deleteId)
      if (error) throw error
      fetchData()
      showToast('Promotion deleted', { type: 'success' })
    } catch (err) {
      showToast(`Error deleting promotion: ${err.message}`, { type: 'error' })
    } finally {
      setShowDeleteConfirm(false)
      setDeleteId(null)
    }
  }

  async function saveForm() {
    if (!adminToken) return showToast('Not authenticated', { type: 'error' })
    setSaving(true)
    try {
      const imageUrl = form.image_url || null
      if (form.id) {
        const { error } = await supabase
          .from('promotions')
          .update({ title: form.title, link_url: form.link_url, expires_at: form.expires_at ? `${form.expires_at}T00:00:00.000Z` : null, image_url: imageUrl })
          .eq('id', form.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('promotions')
          .insert({ title: form.title, link_url: form.link_url, expires_at: form.expires_at ? `${form.expires_at}T00:00:00.000Z` : null, image_url: imageUrl })
        if (error) throw error
      }
      fetchData()
      setFormTitle('Create Promotion')
      setForm({ title: '', link_url: '', expires_at: null, image_url: null })
      setEditId(null)
      showToast('Promotion saved', { type: 'success' })
    } catch (err) {
      showToast(`Error saving promotion: ${err.message}`, { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Loading fullScreen />

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 1200, margin: '0 auto', paddingBottom: 40 }}>
      <div style={{ background: theme.heroGradient, padding: '24px', color: '#fff', borderRadius: 12, marginBottom: 24 }}>
        <PageHeader title='Promotions & Campaigns' subtitle='Manage promotional campaigns and coupons' />
      </div>

      <div style={{ marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 12px 0', fontWeight: 800, fontSize: 16, color: theme.navy }}>Promotions ({promotions.length})</h3>
        <Button
          onClick={handleCreate}
          style={{ marginBottom: 16, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px' }}
          >
          Create Promotion
        </Button>
        <DataTable
          data={promotions}
          columns={[
            { key: 'title', label: 'Title' },
            { key: 'link_url', label: 'Link URL', render: v => v || '—' },
            { key: 'expires_at', label: 'Expires', render: v => v ? new Date(v).toLocaleDateString() : 'Never' },
            { key: 'created_at', label: 'Created', render: v => new Date(v).toLocaleDateString() },
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
          skeletonRows={promotions.length > 0 ? 5 : 0}
        />
      </div>

      {/* Add/Edit Promotion Form Modal */}
      <Modal
        show={formTitle && formTitle.includes('Create') || editId}
        onClose={() => setFormTitle(null)}
        title={editId ? 'Edit Promotion' : 'Create New Promotion'}
      >
        <Input
          label='Title *'
          value={form.title}
          onChange={v => setForm(p => ({ ...p, title: v }))}
          required
        />
        <Input
          label='Link URL (optional)'
          value={form.link_url}
          onChange={v => setForm(p => ({ ...p, link_url: v }))}
        />
        <Input
          label='Expires At (YYYY-MM-DD) [leave blank for no expiry]'
          type='date'
          value={form.expires_at}
          onChange={v => setForm(p => ({ ...p, expires_at: v }))}
        />
        <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
          <Button
            size='sm'
            onClose={() => setFormTitle(null)}
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

      {/* Delete Confirm Modal */}
      <Modal
        show={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title='Delete Promotion'
      >
        <p>Are you sure you want to delete this promotion? This cannot be undone.</p>
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

export default PromotionsAdmin