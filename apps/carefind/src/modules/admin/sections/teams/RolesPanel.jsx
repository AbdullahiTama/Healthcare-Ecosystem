import { useEffect, useId, useRef, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Button, Input } from '@care-ecosystem/design-system/components/ui'
import PermissionMatrix from '../../ui/PermissionMatrix.jsx'
import SourceNotice, { isOk } from './SourceNotice.jsx'
import { norm, spaced, isSystemRole } from './roleNames.js'
import { NAV_GROUPS } from '../../navigation'
import { useStaffActions } from '../../hooks/useStaffActions'
import { useAdmin } from '../../provider/AdminProvider.jsx'
import '../../ui/admin.css'

// Roles: who may open which console sections. Super admin only. The server
// enforces that (every role call checks it); the panel hides itself from anyone
// else as a courtesy so a lower role is not shown controls that would fail.
//
// Security: roles decide what staff can open, so every change here is explicit.
// System roles (built in, or named like one, including super_admin) are
// read-only. Creating or updating sends a complete true/false permission map,
// updating sends permissions only when they changed, and a delete is confirmed
// first. Names and descriptions are rendered as text, never as markup.

const DELETE_CONSEQUENCE = 'This permanently deletes the role. Check the access of any staff who have it.'

// The sections the permission grid can switch, in navigation order.
const GRID_ITEMS = NAV_GROUPS.flatMap(g => g.items).filter(i => i.key !== 'overview' && !i.permissionKey)
const enabledKeys = (tabs) => GRID_ITEMS.filter(i => tabs?.[i.key] === true).map(i => i.key)
const sameSections = (a, b) => {
  const x = enabledKeys(a)
  const y = enabledKeys(b)
  return x.length === y.length && x.every(k => y.includes(k))
}
const sectionsText = (tabs) => `Sections: ${['Dashboard', ...GRID_ITEMS.filter(i => tabs?.[i.key] === true).map(i => i.label)].join(', ')}`

function useMounted() {
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  return mounted
}

function CreateRoleForm() {
  const { busy, createRole } = useStaffActions()
  const { showToast } = useAdmin()
  const ids = useId()
  const mounted = useMounted()
  const inFlight = useRef(false)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tabs, setTabs] = useState({})
  const [error, setError] = useState('')
  const running = busy === 'createRole'
  const valid = !!name.trim()

  const submit = async (e) => {
    e.preventDefault()
    if (!valid || running || inFlight.current) return
    inFlight.current = true
    setError('')
    let res
    try {
      res = await createRole({ name, description, tabs })
    } finally {
      inFlight.current = false
    }
    // A result after the panel has gone is toasted, not dropped.
    if (!mounted.current) {
      if (!res.ok) showToast(`Couldn't create the role: ${res.error}`, { type: 'error' })
      return
    }
    if (res.ok) { setName(''); setDescription(''); setTabs({}) }
    else setError(`Couldn't create the role: ${res.error}`)
  }

  return (
    <section className="adm-panel adm-role-create" aria-label="Create role">
      <div className="adm-live-heading">
        <h3>Create a role</h3>
        <p className="adm-note">Choose which sections people with this role can open.</p>
      </div>
      <form onSubmit={submit} aria-label="Create a role" className="adm-staff-form">
        <Input id={`${ids}-name`} label="Role name" value={name} onChange={setName} placeholder="e.g. Night lead"
          aria-required="true" disabled={running} />
        <Input id={`${ids}-desc`} label="Description" value={description} onChange={setDescription} disabled={running} />
        <PermissionMatrix value={tabs} onChange={setTabs} disabled={running} />
        {error && <p role="alert" className="adm-live-alert">{error}</p>}
        <Button type="submit" variant="primary" disabled={!valid || running} loading={running} loadingText="Creating…"
          leftIcon={<Plus size={14} aria-hidden="true" />}>
          Create role
        </Button>
      </form>
    </section>
  )
}

// The inline editor for one custom role. Only what changed is sent: the
// description alone leaves permissions untouched; permissions go as the full map.
function RoleEditor({ role, onClose }) {
  const { isBusy, updateRole } = useStaffActions()
  const { showToast } = useAdmin()
  const ids = useId()
  const mounted = useMounted()
  const inFlight = useRef(false)

  const initialDescription = role.description || ''
  const initialTabs = role.carefind_tabs || {}
  const [description, setDescription] = useState(initialDescription)
  const [tabs, setTabs] = useState(() => ({ ...initialTabs }))
  const [error, setError] = useState('')

  const running = isBusy('updateRole', role.id)
  const descriptionChanged = description !== initialDescription
  const tabsChanged = !sameSections(tabs, initialTabs)
  const changed = descriptionChanged || tabsChanged
  const label = spaced(role.name)

  const save = async (e) => {
    e.preventDefault()
    if (!changed || running || inFlight.current) return
    inFlight.current = true
    setError('')
    let res
    try {
      res = await updateRole({
        roleId: role.id,
        ...(descriptionChanged ? { description } : {}),
        ...(tabsChanged ? { tabs } : {}),
      })
    } finally {
      inFlight.current = false
    }
    if (!mounted.current) {
      if (!res.ok) showToast(`Couldn't update the role: ${res.error}`, { type: 'error' })
      return
    }
    if (res.ok) onClose()
    else setError(`Couldn't update the role: ${res.error}`)
  }

  return (
    <form onSubmit={save} aria-label={`Edit ${label}`} className="adm-staff-form adm-role-editor">
      <Input id={`${ids}-desc`} label="Description" value={description} onChange={setDescription} disabled={running} />
      <PermissionMatrix value={tabs} onChange={setTabs} disabled={running} />
      {error && <p role="alert" className="adm-live-alert">{error}</p>}
      <div className="adm-role-actions">
        <Button type="submit" variant="primary" disabled={!changed || running} loading={running} loadingText="Saving…">Save</Button>
        <Button type="button" variant="ghost" disabled={running} onClick={onClose}>Cancel</Button>
      </div>
    </form>
  )
}

function RoleRow({ role, editing, onEdit, onCancel, onDelete }) {
  const system = isSystemRole(role)
  const label = spaced(role.name)
  return (
    <li className="adm-role-item" aria-label={label}>
      <div className="adm-role-head">
        <strong className="adm-role-name">{label}</strong>
        {system && <span className="adm-role-badge">System</span>}
      </div>
      {role.description && <p className="adm-note">{role.description}</p>}
      <p className="adm-note">{sectionsText(role.carefind_tabs)}</p>
      {system && <p className="adm-note">System roles can't be edited here.</p>}
      {!system && !editing && (
        <div className="adm-role-actions">
          <Button size="sm" variant="secondary" aria-label={`Edit ${label}`} leftIcon={<Pencil size={14} aria-hidden="true" />}
            onClick={onEdit}>Edit</Button>
          <Button size="sm" variant="danger" aria-label={`Delete ${label}`} leftIcon={<Trash2 size={14} aria-hidden="true" />}
            onClick={onDelete}>Delete</Button>
        </div>
      )}
      {!system && editing && <RoleEditor role={role} onClose={onCancel} />}
    </li>
  )
}

export default function RolesPanel({ roles, onRetry }) {
  const { adminUser, askConfirm, showToast } = useAdmin()
  const { deleteRole } = useStaffActions()
  const [editingId, setEditingId] = useState(null)

  if (norm(adminUser?.role) !== 'super_admin') {
    return <p className="adm-note">Only a super admin can manage roles</p>
  }

  const list = isOk(roles) ? roles.data.filter(r => r && r.id != null && typeof r.name === 'string') : []
  const hasCustom = list.some(r => !isSystemRole(r))

  const confirmDelete = (role) => askConfirm({
    title: `Delete the ${spaced(role.name)} role?`,
    consequence: DELETE_CONSEQUENCE,
    confirmLabel: 'Delete role',
    // The confirm has closed by now: a failure is toasted, a success is toasted
    // by the hook.
    action: async () => {
      const res = await deleteRole({ roleId: role.id })
      if (!res.ok) showToast(`Couldn't delete the role: ${res.error}`, { type: 'error' })
    },
  })

  return (
    <section className="adm-teams" aria-label="Roles">
      <h2 className="adm-live-subhead">Roles</h2>
      <SourceNotice source={roles} noun="roles" onRetry={onRetry} />
      {isOk(roles) && (
        <>
          <ul className="adm-role-list" aria-label="Role list">
            {list.map(r => (
              <RoleRow key={r.id} role={r} editing={editingId === r.id}
                onEdit={() => setEditingId(r.id)} onCancel={() => setEditingId(null)} onDelete={() => confirmDelete(r)} />
            ))}
          </ul>
          {!hasCustom && <p className="adm-note">No custom roles yet</p>}
        </>
      )}
      <CreateRoleForm />
    </section>
  )
}
