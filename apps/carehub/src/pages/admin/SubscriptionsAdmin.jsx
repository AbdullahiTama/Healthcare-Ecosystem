import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { theme } from '../../styles/theme'
import {
  Button, Input, Select, Option, DataTable, StatCard, Pill, Modal, ConfirmDialog, Loading, Toast,
  PageHeader, Empty, Card
} from '@care-ecosystem/design-system/components/ui'
import { useNavigate } from 'react-router-dom'

function SubscriptionsAdmin() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [plans, setPlans] = useState([])
  const [subscriptions, setSubscriptions] = useState([])
  const [businesses, setBusinesses] = useState([])
  const [form, setForm] = useState({ name: '', price: 0, features: '', billing_cycle: 'monthly', trial_days: 0, is_active: true })
  const [formTitle, setFormTitle] = useState('Create Plan')
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
      const [plansRes, subsRes, bizRes] = await Promise.all([
        supabase.from('plans').select('*').order('price'),
        supabase.from('subscriptions').select(`
          *,
          businesses!subscriptions_business_id_fkey(name, email),
          plans!subscriptions_plan_id_fkey(name, price, billing_cycle)
        `).order('created_at', { ascending: false }),
        supabase.from('businesses').select('id, name, plan, plan_expires_at, status').order('name')
      ])

      setPlans(plansRes.data || [])
      setSubscriptions(subsRes.data || [])
      setBusinesses(bizRes.data || [])
      setLoading(false)
    } catch (err) {
      showToast(`Error loading subscriptions: ${err.message}`, { type: 'error' })
      setLoading(false)
    }
  }

  async function handleCreate() {
    setForm({ name: '', price: 0, features: '', billing_cycle: 'monthly', trial_days: 0, is_active: true })
    setFormTitle('Create Plan')
    setEditId(null)
  }

  async function handleEdit(id) {
    const plan = plans.find(p => p.id === id)
    if (plan) {
      setForm({ ...plan, features: plan.features || '' })
      setFormTitle('Edit Plan')
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
      const { error } = await supabase.from('subscriptions').delete().eq('id', deleteId)
      if (error) throw error
      fetchData()
      showToast('Subscription cancelled', { type: 'success' })
    } catch (err) {
      showToast(`Error cancelling subscription: ${err.message}`, { type: 'error' })
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
          .from('plans')
          .update({ name: form.name, price: form.price, features: form.features, billing_cycle: form.billing_cycle, trial_days: form.trial_days, is_active: form.is_active })
          .eq('id', form.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('plans')
          .insert({ name: form.name, price: form.price, features: form.features, billing_cycle: form.billing_cycle, trial_days: form.trial_days, is_active: form.is_active })
        if (error) throw error
      }
      fetchData()
      setFormTitle('Create Plan')
      setForm({ name: '', price: 0, features: '', billing_cycle: 'monthly', trial_days: 0, is_active: true })
      setEditId(null)
      showToast('Plan saved', { type: 'success' })
    } catch (err) {
      showToast(`Error saving plan: ${err.message}`, { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Loading fullScreen />

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 1200, margin: '0 auto', paddingBottom: 40 }}>
      <div style={{ background: theme.heroGradient, padding: '24px', color: '#fff', borderRadius: 12, marginBottom: 24 }}>
        <PageHeader title='Subscriptions & Plans' subtitle='Manage SaaS plans and business subscriptions' />
      </div>

      <div style={{ marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 12px 0', fontWeight: 800, fontSize: 16, color: theme.navy }}>SaaS Plans ({plans.length})</h3>
        <Button
          onClick={handleCreate}
          style={{ marginBottom: 16, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px' }}
          >
          Create Plan
        </Button>
        <DataTable
          data={plans}
          columns={[
            { key: 'name', label: 'Plan Name' },
            { key: 'price', label: 'Price (NGN)', render: v => v > 0 ? `₦${v.toLocaleString()}/${form.billing_cycle}` : 'Contact sales' },
            { key: 'billing_cycle', label: 'Billing Cycle', render: v => v === 'monthly' ? 'Monthly' : v === 'annual' ? 'Annual' : v },
            { key: 'trial_days', label: 'Trial Days', render: v => v > 0 ? `${v} days` : 'No trial' },
            { key: 'is_active', label: 'Active', render: v => <Pill type={v ? 'green' : 'amber'} size='sm'>{v ? 'Yes' : 'No'}</Pill> },
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
          skeletonRows={plans.length > 0 ? 5 : 0}
        />
      </div>

      {/* Business Subscriptions */}
      <div style={{ marginBottom: 24, marginTop: 24 }}>
        <h3 style={{ margin: '0 0 12px 0', fontWeight: 800, fontSize: 16, color: theme.navy }}>Active Subscriptions ({subscriptions.length})</h3>
        {subscriptions.length === 0 && <p style={{ color: theme.textLight, fontSize: 14 }}>No active subscriptions</p>}
        <DataTable
          data={subscriptions}
          columns={[
            { key: 'businesses.name', label: 'Business' },
            { key: 'plans.name', label: 'Plan' },
            { key: 'billing_cycle', label: 'Billing', render: v => v === 'monthly' ? 'Monthly' : v === 'annual' ? 'Annual' : v },
            { key: 'trial_days', label: 'Trial Days', render: v => v > 0 ? `${v} days remaining` : '—' },
            { key: 'plan_expires_at', label: 'Expires', render: v => v ? new Date(v).toLocaleDateString() : '—' },
            { key: 'is_active', label: 'Status', render: v => <Pill type={v ? 'green' : 'red'} size='sm'>{v ? 'Active' : 'Canceled'}</Pill> },
          ]}
          loading={loading}
          skeletonRows={subscriptions.length > 0 ? 5 : 0}
        />
      </div>

      {/* Add/Edit Plan Form Modal */}
      <Modal
        show={formTitle && formTitle.includes('Create') || editId}
        onClose={() => setFormTitle(null)}
        title={editId ? 'Edit Plan' : 'Create New Plan'}
      >
        <Input
          label='Plan Name *'
          value={form.name}
          onChange={v => setForm(p => ({ ...p, name: v }))}
          required
        />
        <Input
          label='Price (NGN) *'
          type='number'
          value={form.price}
          onChange={v => setForm(p => ({ ...p, price: Number(v) }))}
          required
        />
        <Select
          label='Billing Cycle *'
          value={form.billing_cycle}
          onChange={v => setForm(p => ({ ...p, billing_cycle: v }))}
          options=['monthly', 'annual']
        />
        <Input
          label='Trial Days'
          type='number'
          value={form.trial_days}
          onChange={v => setForm(p => ({ ...p, trial_days: Number(v) }))}
        />
        <Textarea
          label='Features (comma-separated)'
          value={form.features}
          onChange={v => setForm(p => ({ ...p, features: v }))}
          placeholder='e.g. Unlimited products, Staff management, Advanced reporting'
        />
        <Pill
          type={form.is_active ? 'green' : 'amber'}
          size='sm'
        >
          Active: {form.is_active ? 'Yes' : 'No'}
        </Pill>
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
        title='Cancel Subscription'
      >
        <p>Are you sure you want to cancel this subscription? The business will revert to the free plan or next lower tier.</p>
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
            Cancel Subscription
          </Button>
        </div>
      </Modal>
    </div>
  )
}

export default SubscriptionsAdmin