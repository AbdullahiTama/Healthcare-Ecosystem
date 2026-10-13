import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

const actions = vi.hoisted(() => ({ busy: null, createStaff: vi.fn() }))
const admin = vi.hoisted(() => ({ showToast: vi.fn() }))

vi.mock('../../hooks/useStaffActions', () => ({
  useStaffActions: () => ({ busy: actions.busy, createStaff: actions.createStaff }),
}))
vi.mock('../../provider/AdminProvider.jsx', () => ({
  useAdmin: () => ({ showToast: admin.showToast }),
}))

import CreateStaffPanel from './CreateStaffPanel.jsx'

const teams = { status: 'ok', data: [{ id: 't1', name: 'Trust' }] }
const roles = {
  status: 'ok',
  data: [
    { id: 'r1', name: 'moderator', is_system: true },
    { id: 'r2', name: 'super_admin', is_system: true },
    { id: 'r3', name: 'content_lead', is_system: false },
    { id: 'r4', name: 'Super Admin', is_system: false },
  ],
}
const SECRET = 'hunter2-secret'

const renderPanel = (props = {}) => render(<CreateStaffPanel teams={teams} roles={roles} onRetry={vi.fn()} {...props} />)
const type = (el, value) => fireEvent.change(el, { target: { value } })
const nameBox = () => screen.getByRole('textbox', { name: 'Full name' })
const emailBox = () => screen.getByRole('textbox', { name: 'Email' })
const passBox = () => screen.getByLabelText(/^Password/)
const roleSel = () => screen.getByRole('combobox', { name: 'Role' })
const teamSel = () => screen.getByRole('combobox', { name: 'Team' })
const submit = () => screen.getByRole('button', { name: /^(create staff account|creating…)$/i })
const fill = (password = SECRET) => {
  type(nameBox(), 'Ada Obi'); type(emailBox(), 'ada@example.com'); type(passBox(), password)
}
const send = async () => { await act(async () => { fireEvent.click(submit()) }) }

beforeEach(() => {
  actions.busy = null
  actions.createStaff.mockReset().mockResolvedValue({ ok: true })
  admin.showToast.mockReset()
})

describe('CreateStaffPanel', () => {
  it('sends a system role with no roleId', async () => {
    renderPanel()
    fill(); type(roleSel(), 'moderator'); type(teamSel(), 't1')
    await send()
    expect(actions.createStaff).toHaveBeenCalledWith({
      name: 'Ada Obi', email: 'ada@example.com', password: SECRET, role: 'moderator', roleId: undefined, teamId: 't1',
    })
  })

  it('sends a custom role with its id and name', async () => {
    renderPanel()
    fill(); type(roleSel(), 'r3')
    await send()
    expect(actions.createStaff).toHaveBeenCalledWith({
      name: 'Ada Obi', email: 'ada@example.com', password: SECRET, role: 'content_lead', roleId: 'r3', teamId: '',
    })
  })

  it('offers the five system roles in order, then custom roles, never super_admin', () => {
    renderPanel()
    const labels = Array.from(roleSel().querySelectorAll('option')).map(o => o.textContent)
    expect(labels).toEqual([
      'Choose a role', 'Content Moderator', 'Verification Officer', 'Business Manager', 'Support Agent', 'Analytics Manager', 'content lead',
    ])
    expect(screen.queryByText(/super.admin/i)).not.toBeInTheDocument()
  })

  it('clears everything on success and says so in a status, until typing again', async () => {
    renderPanel()
    fill(); type(roleSel(), 'moderator'); type(teamSel(), 't1')
    await send()
    expect(screen.getByRole('status')).toHaveTextContent('Staff account created')
    expect(nameBox()).toHaveValue(''); expect(emailBox()).toHaveValue(''); expect(passBox()).toHaveValue('')
    expect(roleSel()).toHaveValue(''); expect(teamSel()).toHaveValue('')
    type(nameBox(), 'B')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps name, email, role and team on failure, clears the password and shows the error', async () => {
    actions.createStaff.mockResolvedValue({ ok: false, error: 'Email already in use' })
    renderPanel()
    fill(); type(roleSel(), 'moderator'); type(teamSel(), 't1')
    await send()
    expect(screen.getByRole('alert')).toHaveTextContent('Email already in use')
    expect(nameBox()).toHaveValue('Ada Obi'); expect(emailBox()).toHaveValue('ada@example.com')
    expect(roleSel()).toHaveValue('moderator'); expect(teamSel()).toHaveValue('t1')
    expect(passBox()).toHaveValue('')
  })

  it('keeps Submit disabled for a 7-character password and enables it at 8', () => {
    renderPanel()
    fill('1234567'); type(roleSel(), 'moderator')
    expect(submit()).toBeDisabled()
    fireEvent.submit(submit().closest('form'))
    expect(actions.createStaff).not.toHaveBeenCalled()
    type(passBox(), '12345678')
    expect(submit()).toBeEnabled()
    expect(screen.getByText('At least 8 characters')).toBeInTheDocument()
  })

  it('marks the required fields natively', () => {
    renderPanel()
    for (const el of [nameBox(), emailBox(), passBox(), roleSel()]) expect(el).toHaveAttribute('required')
  })

  it('clears the password and shows an error when createStaff throws', async () => {
    actions.createStaff.mockRejectedValue(new Error('network down'))
    renderPanel()
    fill(); type(roleSel(), 'moderator')
    await send()
    expect(passBox()).toHaveValue('')
    expect(nameBox()).toHaveValue('Ada Obi')
    expect(screen.getByRole('alert')).toHaveTextContent('network down')
  })

  it('resets the role when the chosen custom role disappears on refresh', () => {
    const { rerender } = renderPanel()
    type(roleSel(), 'r3')
    expect(roleSel()).toHaveValue('r3')
    rerender(<CreateStaffPanel teams={teams} roles={{ status: 'ok', data: [roles.data[0]] }} onRetry={vi.fn()} />)
    expect(roleSel()).toHaveValue('')
    // The stale choice is gone from state too: it does not come back with the role.
    rerender(<CreateStaffPanel teams={teams} roles={roles} onRetry={vi.fn()} />)
    expect(roleSel()).toHaveValue('')
  })

  it('keeps a system role chosen across a roles refresh', () => {
    const { rerender } = renderPanel()
    type(roleSel(), 'moderator')
    rerender(<CreateStaffPanel teams={teams} roles={{ status: 'error', data: null }} onRetry={vi.fn()} />)
    expect(roleSel()).toHaveValue('moderator')
  })

  it('toggles the password between hidden and shown', () => {
    renderPanel()
    const toggle = screen.getByRole('button', { name: 'Show password' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(passBox()).toHaveAttribute('type', 'password')
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true')
    expect(passBox()).toHaveAttribute('type', 'text')
    expect(passBox()).toHaveAttribute('autocomplete', 'new-password')
  })

  it('never puts the password in any attribute or text', async () => {
    actions.createStaff.mockResolvedValue({ ok: false, error: 'nope' })
    const { container } = renderPanel()
    fill(); type(roleSel(), 'moderator')
    const check = () => {
      for (const el of container.querySelectorAll('*')) {
        for (const a of Array.from(el.attributes)) {
          if (el === passBox() && a.name === 'value') continue
          expect(a.value).not.toContain(SECRET)
        }
        if (el.childElementCount === 0) expect(el.textContent).not.toContain(SECRET)
      }
    }
    check()
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
    check()
    await send()
    check()
    expect(passBox()).toHaveValue('')
  })

  it('offers only system roles and a note when custom roles failed', () => {
    renderPanel({ roles: { status: 'error', data: null } })
    expect(screen.getByText("Couldn't load custom roles")).toBeInTheDocument()
    expect(roleSel().querySelectorAll('option')).toHaveLength(6)
  })

  it('offers Retry for custom roles', () => {
    const onRetry = vi.fn()
    renderPanel({ roles: { status: 'error', data: null }, onRetry })
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading roles' }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('disables the team select with a note and Retry when teams failed', () => {
    const onRetry = vi.fn()
    renderPanel({ teams: { status: 'error', data: null }, onRetry })
    expect(teamSel()).toBeDisabled()
    expect(screen.getByText("Couldn't load teams")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('makes one call on a double click', async () => {
    let release
    actions.createStaff.mockReturnValue(new Promise(r => { release = r }))
    renderPanel()
    fill(); type(roleSel(), 'moderator')
    fireEvent.click(submit()); fireEvent.click(submit())
    expect(actions.createStaff).toHaveBeenCalledTimes(1)
    await act(async () => { release({ ok: true }) })
  })

  it('disables submit while busy', () => {
    actions.busy = 'createStaff'
    renderPanel()
    fill(); type(roleSel(), 'moderator')
    expect(submit()).toBeDisabled()
  })

  it('toasts a failure that arrives after unmount', async () => {
    let release
    actions.createStaff.mockReturnValue(new Promise(r => { release = r }))
    const { unmount } = renderPanel()
    fill(); type(roleSel(), 'moderator')
    fireEvent.click(submit())
    unmount()
    await act(async () => { release({ ok: false, error: 'boom' }) })
    expect(admin.showToast).toHaveBeenCalledWith("Couldn't create the staff account: boom", { type: 'error' })
  })
})
