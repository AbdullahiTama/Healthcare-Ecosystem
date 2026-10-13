import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'

const actions = vi.hoisted(() => ({ busy: null, createRole: vi.fn(), updateRole: vi.fn(), deleteRole: vi.fn() }))
const admin = vi.hoisted(() => ({ adminUser: { role: 'super_admin' }, showToast: vi.fn(), askConfirm: vi.fn() }))

vi.mock('../../hooks/useStaffActions', () => ({
  useStaffActions: () => ({
    busy: actions.busy,
    isBusy: () => false,
    createRole: actions.createRole,
    updateRole: actions.updateRole,
    deleteRole: actions.deleteRole,
  }),
}))
vi.mock('../../provider/AdminProvider.jsx', () => ({
  useAdmin: () => ({ adminUser: admin.adminUser, showToast: admin.showToast, askConfirm: admin.askConfirm }),
}))

import RolesPanel from './RolesPanel.jsx'

const rolesSrc = {
  status: 'ok',
  data: [
    { id: 'r1', name: 'moderator', is_system: true, description: 'Reviews content', carefind_tabs: { overview: true, posts: true } },
    { id: 'r3', name: 'content_lead', is_system: false, description: 'Leads content', carefind_tabs: { overview: true, posts: true } },
  ],
}

const renderPanel = (props = {}) => render(<RolesPanel roles={rolesSrc} onRetry={vi.fn()} {...props} />)
const type = (el, value) => fireEvent.change(el, { target: { value } })
const roleItem = (name) => screen.getByRole('listitem', { name })
const createForm = () => screen.getByRole('form', { name: 'Create a role' })
const createBtn = () => within(createForm()).getByRole('button', { name: /^(create role|creating…)$/i })

beforeEach(() => {
  actions.busy = null
  actions.createRole.mockReset().mockResolvedValue({ ok: true })
  actions.updateRole.mockReset().mockResolvedValue({ ok: true })
  actions.deleteRole.mockReset().mockResolvedValue({ ok: true })
  admin.adminUser = { role: 'super_admin' }
  admin.showToast.mockReset()
  admin.askConfirm.mockReset()
})

describe('RolesPanel access', () => {
  it('shows only a notice to anyone who is not a super admin', () => {
    admin.adminUser = { role: 'moderator' }
    renderPanel()
    expect(screen.getByText('Only a super admin can manage roles')).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Create a role' })).not.toBeInTheDocument()
    expect(screen.queryByText('content lead')).not.toBeInTheDocument()
  })
})

describe('RolesPanel list', () => {
  it('marks system roles read-only and gives custom roles Edit and Delete', () => {
    renderPanel()
    const sys = roleItem('moderator')
    expect(within(sys).getByText('System')).toBeInTheDocument()
    expect(within(sys).getByText("System roles can't be edited here.")).toBeInTheDocument()
    expect(within(sys).queryByRole('button')).not.toBeInTheDocument()
    const custom = roleItem('content lead')
    expect(within(custom).queryByText('System')).not.toBeInTheDocument()
    expect(within(custom).getByRole('button', { name: 'Edit content lead' })).toBeInTheDocument()
    expect(within(custom).getByRole('button', { name: 'Delete content lead' })).toBeInTheDocument()
    expect(within(custom).getByText(/Posts/)).toBeInTheDocument()
  })

  it('treats a role named like a system role as system even without the flag', () => {
    renderPanel({ roles: { status: 'ok', data: [{ id: 'x', name: 'Super Admin', is_system: false, carefind_tabs: {} }] } })
    expect(within(roleItem('Super Admin')).queryByRole('button')).not.toBeInTheDocument()
  })

  it('says there are no custom roles yet but still lists system roles', () => {
    renderPanel({ roles: { status: 'ok', data: [rolesSrc.data[0]] } })
    expect(screen.getByText('No custom roles yet')).toBeInTheDocument()
    expect(roleItem('moderator')).toBeInTheDocument()
  })

  it('shows a failed roles read with Retry and never an empty list', () => {
    const onRetry = vi.fn()
    renderPanel({ roles: { status: 'error', data: null }, onRetry })
    expect(screen.getByText("Couldn't load roles")).toBeInTheDocument()
    expect(screen.queryByText('No custom roles yet')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading roles' }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('keeps a stale list and says it could not refresh', () => {
    renderPanel({ roles: { ...rolesSrc, stale: true } })
    expect(screen.getByText("Couldn't refresh roles")).toBeInTheDocument()
    expect(roleItem('content lead')).toBeInTheDocument()
  })

  it('renders markup in names and descriptions as text', () => {
    const { container } = renderPanel({
      roles: { status: 'ok', data: [{ id: 'x', name: 'lead<img src=x>', is_system: false, description: '<b>bold</b>', carefind_tabs: {} }] },
    })
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(screen.getByText('<b>bold</b>')).toBeInTheDocument()
  })
})

describe('RolesPanel create', () => {
  it('disables Create until there is a name', () => {
    renderPanel()
    expect(createBtn()).toBeDisabled()
    type(screen.getByLabelText('Role name'), '  ')
    expect(createBtn()).toBeDisabled()
  })

  it('sends name, description and the permission map, then clears', async () => {
    renderPanel()
    type(screen.getByLabelText('Role name'), 'Night lead')
    type(screen.getByLabelText('Description'), 'Works nights')
    fireEvent.click(within(createForm()).getByRole('checkbox', { name: 'Posts' }))
    await act(async () => { fireEvent.click(createBtn()) })
    expect(actions.createRole).toHaveBeenCalledWith({ name: 'Night lead', description: 'Works nights', tabs: expect.objectContaining({ posts: true }) })
    expect(screen.getByLabelText('Role name')).toHaveValue('')
    expect(screen.getByLabelText('Description')).toHaveValue('')
    expect(within(createForm()).getByRole('checkbox', { name: 'Posts' })).not.toBeChecked()
  })

  it('keeps everything and shows the error on failure', async () => {
    actions.createRole.mockResolvedValue({ ok: false, error: 'That role name is reserved' })
    renderPanel()
    type(screen.getByLabelText('Role name'), 'super admin')
    fireEvent.click(within(createForm()).getByRole('checkbox', { name: 'Posts' }))
    await act(async () => { fireEvent.click(createBtn()) })
    expect(within(createForm()).getByRole('alert')).toHaveTextContent('That role name is reserved')
    expect(screen.getByLabelText('Role name')).toHaveValue('super admin')
    expect(within(createForm()).getByRole('checkbox', { name: 'Posts' })).toBeChecked()
  })

  it('makes one call on a double click', async () => {
    let release
    actions.createRole.mockReturnValue(new Promise(r => { release = r }))
    renderPanel()
    type(screen.getByLabelText('Role name'), 'Night lead')
    fireEvent.click(createBtn()); fireEvent.click(createBtn())
    expect(actions.createRole).toHaveBeenCalledTimes(1)
    await act(async () => { release({ ok: true }) })
  })

  it('toasts a failure that arrives after unmount', async () => {
    let release
    actions.createRole.mockReturnValue(new Promise(r => { release = r }))
    const { unmount } = renderPanel()
    type(screen.getByLabelText('Role name'), 'Night lead')
    fireEvent.click(createBtn())
    unmount()
    await act(async () => { release({ ok: false, error: 'boom' }) })
    expect(admin.showToast).toHaveBeenCalledWith("Couldn't create the role: boom", { type: 'error' })
  })
})

describe('RolesPanel edit', () => {
  const open = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Edit content lead' }))
    return screen.getByRole('form', { name: 'Edit content lead' })
  }

  it('disables Save until something changed', () => {
    renderPanel()
    const form = open()
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled()
    type(within(form).getByLabelText('Description'), 'New text')
    expect(within(form).getByRole('button', { name: 'Save' })).toBeEnabled()
    type(within(form).getByLabelText('Description'), 'Leads content')
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('sends only the description, with no tabs, for a description-only change', async () => {
    renderPanel()
    const form = open()
    type(within(form).getByLabelText('Description'), 'New text')
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save' })) })
    expect(actions.updateRole).toHaveBeenCalledWith({ roleId: 'r3', description: 'New text' })
    expect(screen.queryByRole('form', { name: 'Edit content lead' })).not.toBeInTheDocument()
  })

  it('sends the full permission map and no description for a permissions-only change', async () => {
    renderPanel()
    const form = open()
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Users' }))
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save' })) })
    expect(actions.updateRole).toHaveBeenCalledWith({ roleId: 'r3', tabs: { overview: true, posts: true, users: true } })
  })

  it('keeps the editor open with the error on failure', async () => {
    actions.updateRole.mockResolvedValue({ ok: false, error: 'No permission' })
    renderPanel()
    const form = open()
    type(within(form).getByLabelText('Description'), 'New text')
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save' })) })
    expect(within(form).getByRole('alert')).toHaveTextContent('No permission')
    expect(within(form).getByLabelText('Description')).toHaveValue('New text')
  })

  it('discards changes on Cancel', () => {
    renderPanel()
    const form = open()
    type(within(form).getByLabelText('Description'), 'New text')
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'Edit content lead' })).not.toBeInTheDocument()
    expect(actions.updateRole).not.toHaveBeenCalled()
    expect(within(open()).getByLabelText('Description')).toHaveValue('Leads content')
  })
})

describe('RolesPanel delete', () => {
  it('asks first with the exact text and deletes only after confirm', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Delete content lead' }))
    expect(actions.deleteRole).not.toHaveBeenCalled()
    expect(admin.askConfirm).toHaveBeenCalledTimes(1)
    const arg = admin.askConfirm.mock.calls[0][0]
    expect(arg.title).toBe('Delete the content lead role?')
    expect(arg.consequence).toBe('This permanently deletes the role. Check the access of any staff who have it.')
    expect(arg.confirmLabel).toBe('Delete role')
    await act(async () => { await arg.action() })
    expect(actions.deleteRole).toHaveBeenCalledWith({ roleId: 'r3' })
  })

  it('toasts a failed delete', async () => {
    actions.deleteRole.mockResolvedValue({ ok: false, error: 'Role is in use' })
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Delete content lead' }))
    await act(async () => { await admin.askConfirm.mock.calls[0][0].action() })
    expect(admin.showToast).toHaveBeenCalledWith("Couldn't delete the role: Role is in use", { type: 'error' })
  })
})
