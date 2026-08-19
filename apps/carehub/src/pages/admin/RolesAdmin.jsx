import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { theme } from '../../styles/theme'
import {
  Button, Input, Select, Option, DataTable, StatCard, Pill, Modal, ConfirmDialog, Loading, Toast,
  PageHeader, Empty, Card
} from '@care-ecosystem/design-system/components/ui'
import { useNavigate } from 'react-router-dom'

function RolesAdmin() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [roles, setRoles] = useState([])
  const [permissions, setPermissions] = useState([])
  const [form, setForm] = useState({ name: '', description: '', permissions: [] })
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
      const [rolesRes, permsRes] = await Promise.all([
        supabase.from('roles').select('id, name, description, permissions, business_id').order('name'),
        supabase.from('permissions').select('id, name, description').order('name')
      ])
      
      // Transform roles data to include extracted permission names
      const transformedRoles = (rolesRes.data || []).map(role => ({
        ...role,
        permissionNames: role.permissions ? Object.keys(role.permissions).filter(k => role.permissions[k] === true || role.permissions[k] === 'true') : []
      }))
      
      setRoles(transformedRoles)
      
      // Build permissions list from all role permissions
      const allPerms = new Set()
      ;(rolesRes.data || []).forEach(role => {
        if (role.permissions) {
          Object.keys(role.permissions).forEach(key => {
            if (role.permissions[key] === true || role.permissions[key] === 'true') {
              allPerms.add(key)
            }
          })
        }
      })
      setPermissions(Array.from(allPerms).map(perm => ({
        id: perm,
        name: perm,
        description: `${perm} permission`
      })))
      
      setLoading(false)
    } catch (err) {
      showToast(`Error loading roles: ${err.message}`, { type: 'error' })
      setLoading(false)
    }
  }

  async function handleCreate() {
    setForm({ name: '', description: '', permissions: [] })
    setEditId(null)
  }

  async function handleEdit(id) {
    const role = roles.find(r => r.id === id)
    if (role) {
      setForm({ ...role, permissionNames: role.permissionNames || [] })
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
      const { error } = await supabase.from('roles').delete().eq('id', deleteId)
      if (error) throw error
      fetchData()
      showToast('Role deleted', { type: 'success' })
    } catch (err) {
      showToast(`Error deleting role: ${err.message}`, { type: 'error' })
    } finally {
      setShowDeleteConfirm(false)
      setDeleteId(null)
    }
  }

  async function saveForm() {
    if (!adminToken) return showToast('Not authenticated', { type: 'error' })
    setSaving(true)
    try {
      // Extract permission names from the form
      const permObj = {}
      ;(form.permissionNames || []).forEach(p => {
        permObj[p] = true
      })
      
      if (form.id) {
        const { error } = await supabase
          .from('roles')
          .update({ name: form.name, description: form.description, permissions: permObj })
          .eq('id', form.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('roles')
          .insert({ name: form.name, description: form.description, permissions: permObj, business_id: adminToken ? null : undefined })
        if (error) throw error
      }
      fetchData()
      setForm({ name: '', description: '', permissions: [] })
      setEditId(null)
      showToast('Role saved', { type: 'success' })
    } catch (err) {
      showToast(`Error saving role: ${err.message}`, { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Loading fullScreen />

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 1200, margin: '0 auto', paddingBottom: 40 }}>
      <div style={{ background: theme.heroGradient, padding: '24px', color: '#fff', borderRadius: 12, marginBottom: 24 }}>
        <PageHeader title='User Roles & Permissions' subtitle='Manage admin roles and permission matrix' />
      </div>

      <div style={{ marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 12px 0', fontWeight: 800, fontSize: 16, color: theme.navy }}>Roles ({roles.length})</h3>
        <Button
          onClick={handleCreate}
          style={{ marginBottom: 16, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px' }}
          >
          Create Role
        </Button>
        <DataTable
          data={roles}
          columns={[
            { key: 'name', label: 'Role Name' },
            { key: 'description', label: 'Description' },
            { key: 'permissionNames', label: 'Permissions', render: v => v && v.length > 0 ? v.join(', ') : 'None' },
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
          skeletonRows={roles.length > 0 ? 5 : 0}
        />
      </div>

      {/* Permissions List */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 12px 0', fontWeight: 800, fontSize: 16, color: theme.navy }}>Unique Permissions ({permissions.length})</h3>
        <DataTable
          data={permissions}
          columns={[
            { key: 'name', label: 'Permission Name' },
            { key: 'description', label: 'Description' },
            {
              key: 'assigned_to',
              label: 'Assigned To',
              render: v => v && v.length > 0 ? `${v.length} roles` : 'None'
            },
          ]}
          loading={loading}
          skeletonRows={permissions.length > 0 ? 5 : 0}
        />
      </div>

      {/* Add/Edit Role Form Modal */}
      <Modal
        show={formTitle || editId}
        onClose={() => setFormTitle(null)}
        title={editId ? 'Edit Role' : 'Create New Role'}
      >
        <Input
          label='Role Name *'
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
          label='Permissions'
          value={form.permissionNames}
          onChange={v => setForm(p => ({ ...p, permissionNames: v }))}
          options={permissions.map(p => ({ label: p.name, value: p.name }))}
          multiple
          style={{ minHeight: 120 }}
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
        title='Delete Role'
      >
        <p>Are you sure you want to delete this role? This will revoke all associated permissions.</p>
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

export default RolesAdmin