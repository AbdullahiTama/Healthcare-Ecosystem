import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'

const actions = vi.hoisted(() => ({ busy: null, busyKeys: [], stateful: false, toggleStaff: vi.fn(), assignRole: vi.fn() }))
const admin = vi.hoisted(() => ({ askConfirm: vi.fn(), showToast: vi.fn(), confirming: false }))

// Stateful mode gives every hook instance its own in-flight set, like the real
// hook, so two instances in one screen cannot see each other's running action.
vi.mock('../../hooks/useStaffActions', async () => {
  const { useState } = await import('react')
  return {
    useStaffActions: () => {
      const [keys, setKeys] = useState([])
      if (!actions.stateful) {
        return {
          busy: actions.busy,
          isBusy: (action, id) => actions.busyKeys.includes(`${action}:${id ?? ''}`),
          toggleStaff: actions.toggleStaff,
          assignRole: actions.assignRole,
        }
      }
      const track = (name, fn) => async (arg) => {
        const key = `${name}:${arg.id ?? arg.staffId}`
        setKeys(k => [...k, key])
        try { return await fn(arg) } finally { setKeys(k => k.filter(x => x !== key)) }
      }
      return {
        busy: keys.length ? keys[0].split(':')[0] : null,
        isBusy: (action, id) => keys.includes(`${action}:${id ?? ''}`),
        toggleStaff: track('toggleStaff', actions.toggleStaff),
        assignRole: track('assignRole', actions.assignRole),
      }
    },
  }
})
vi.mock('../../provider/AdminProvider.jsx', () => ({
  useAdmin: () => ({ askConfirm: admin.askConfirm, showToast: admin.showToast, confirming: admin.confirming }),
}))

import StaffDirectory from './StaffDirectory.jsx'

const day = 86400000
const staffRows = [
  { id: 's1', full_name: 'Ada Obi', email: 'ada@example.com', role: 'moderator', team_id: 't1', is_active: true, last_login: new Date(Date.now() - 2 * day).toISOString() },
  { id: 's2', full_name: 'Bola Eze', email: 'bola@example.com', role: 'support_agent', team_id: null, is_active: false, last_login: null },
  { id: 's3', full_name: 'Chi Ude', email: 'chi@example.com', role: 'super_admin', team_id: 't1', is_active: true, last_login: 'not a date' },
]
const roleRows = [
  { id: 'r1', name: 'moderator', is_system: true },
  { id: 'r2', name: 'verification_officer', is_system: true },
  { id: 'r3', name: 'super_admin', is_system: true },
  { id: 'r4', name: 'Super Admin', is_system: false },
  { id: 'r5', name: 'support_agent', is_system: true },
  { id: 'r6', name: 'night_shift', is_system: false },
]
const teams = { status: 'ok', data: [{ id: 't1', name: 'Trust' }] }
const staff = { status: 'ok', data: staffRows }
const roles = { status: 'ok', data: roleRows }

const renderDir = (props = {}) => render(
  <StaffDirectory staff={staff} roles={roles} teams={teams} currentAdminId="s3" onRetry={props.onRetry || vi.fn()} {...props} />,
)
const openMember = (name) => {
  fireEvent.click(screen.getByRole('button', { name: `Review ${name}` }))
  return screen.getByRole('dialog')
}
const lastAsk = () => admin.askConfirm.mock.calls.at(-1)[0]
const click = async (el) => { await act(async () => { fireEvent.click(el) }) }

beforeEach(() => {
  actions.busy = null
  actions.busyKeys = []
  actions.stateful = false
  actions.toggleStaff.mockReset().mockResolvedValue({ ok: true })
  actions.assignRole.mockReset().mockResolvedValue({ ok: true })
  admin.askConfirm.mockReset()
  admin.showToast.mockReset()
  admin.confirming = false
})

describe('StaffDirectory states', () => {
  it('shows a loading placeholder while staff has not settled', () => {
    renderDir({ staff: undefined })
    expect(screen.getByRole('status')).toHaveTextContent('Loading staff')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('a failed staff read says so with a distinguishable Retry and no table or empty text', () => {
    const onRetry = vi.fn()
    renderDir({ staff: { status: 'error' }, onRetry })
    expect(screen.getByText("Couldn't load staff")).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText(/No staff accounts/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading staff' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('restricted staff says only a super admin can see it', () => {
    renderDir({ staff: { status: 'restricted' } })
    expect(screen.getByText('Only a super admin can see staff accounts')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('an empty loaded staff list says there are no staff accounts', () => {
    renderDir({ staff: { status: 'ok', data: [] } })
    expect(screen.getByText('No staff accounts yet')).toBeInTheDocument()
  })

  it('a stale source keeps its rows and offers a refresh Retry', () => {
    const onRetry = vi.fn()
    renderDir({ staff: { ...staff, stale: true }, onRetry })
    expect(screen.getByText("Couldn't refresh staff")).toBeInTheDocument()
    expect(screen.getByText('Ada Obi')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry refreshing staff' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

describe('StaffDirectory table', () => {
  it('lists name, email, role, team, status and last sign-in', () => {
    renderDir()
    const [, ada, bola, chi] = screen.getAllByRole('row')
    expect(within(ada).getByText('Ada Obi')).toBeInTheDocument()
    expect(within(ada).getByText('ada@example.com')).toBeInTheDocument()
    expect(within(ada).getByText('moderator')).toBeInTheDocument()
    expect(within(ada).getByText('Trust')).toBeInTheDocument()
    expect(within(ada).getByText('Active')).toBeInTheDocument()
    expect(within(ada).getByText('2d ago')).toBeInTheDocument()
    expect(within(bola).getByText('support agent')).toBeInTheDocument()
    expect(within(bola).getByText('Suspended')).toBeInTheDocument()
    // No sign-in and an unreadable date are both an em dash; no team is too.
    expect(within(bola).getAllByText('—')).toHaveLength(2)
    expect(within(chi).getByText('—')).toBeInTheDocument()
    expect(within(chi).queryByText(/Never|Unknown/)).not.toBeInTheDocument()
  })

  it('renders markup in names, emails and roles as inert text', () => {
    const evil = { id: 'x1', full_name: '<img src=x onerror=alert(1)>', email: '<b>e@x</b>', role: '<script>boom</script>', team_id: null, is_active: true, last_login: null }
    const { container } = renderDir({ staff: { status: 'ok', data: [evil] }, currentAdminId: 'nobody' })
    expect(container.querySelector('img, script, b')).toBeNull()
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(screen.getByText('<b>e@x</b>')).toBeInTheDocument()
    const dialog = openMember('<img src=x onerror=alert(1)>')
    expect(dialog.querySelector('img, script, b')).toBeNull()
  })

  it('each row has an accessibly named Review button that opens the drawer with details', () => {
    renderDir()
    const dialog = openMember('Ada Obi')
    expect(within(dialog).getByText('ada@example.com')).toBeInTheDocument()
    expect(within(dialog).getByText('Trust')).toBeInTheDocument()
    expect(within(dialog).getByText('Last sign-in')).toBeInTheDocument()
  })
})

describe('StaffDirectory deactivate and reactivate', () => {
  it('Deactivate asks with the exact wording and runs only after the confirm action', async () => {
    renderDir()
    const dialog = openMember('Ada Obi')
    await click(within(dialog).getByRole('button', { name: 'Deactivate' }))
    expect(actions.toggleStaff).not.toHaveBeenCalled()
    expect(admin.askConfirm).toHaveBeenCalledTimes(1)
    const ask = lastAsk()
    expect(ask.title).toBe('Deactivate Ada Obi?')
    expect(ask.consequence).toBe('This stops them using the console: every request checks their account is active. Their account and history are kept.')
    expect(ask.confirmLabel).toBe('Deactivate')
    await act(async () => { await ask.action() })
    expect(actions.toggleStaff).toHaveBeenCalledWith({ id: 's1', isActive: false })
  })

  it('a suspended member offers Reactivate with its own wording and payload', async () => {
    renderDir()
    const dialog = openMember('Bola Eze')
    expect(within(dialog).queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument()
    await click(within(dialog).getByRole('button', { name: 'Reactivate' }))
    const ask = lastAsk()
    expect(ask.title).toBe('Reactivate Bola Eze?')
    expect(ask.consequence).toBe('This lets them use the console again with their current role.')
    expect(ask.confirmLabel).toBe('Reactivate')
    expect(actions.toggleStaff).not.toHaveBeenCalled()
    await act(async () => { await ask.action() })
    expect(actions.toggleStaff).toHaveBeenCalledWith({ id: 's2', isActive: true })
  })

  it('success closes the drawer; failure keeps it open with the server error inline', async () => {
    actions.toggleStaff.mockResolvedValueOnce({ ok: false, error: 'Server said no' })
    renderDir()
    const dialog = openMember('Ada Obi')
    await click(within(dialog).getByRole('button', { name: 'Deactivate' }))
    await act(async () => { await lastAsk().action() })
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('Server said no')
    expect(admin.showToast).not.toHaveBeenCalled()

    await click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate' }))
    await act(async () => { await lastAsk().action() })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a failure arriving after the drawer closed is toasted, not dropped', async () => {
    let resolve
    actions.toggleStaff.mockReturnValueOnce(new Promise(r => { resolve = r }))
    renderDir()
    const dialog = openMember('Ada Obi')
    await click(within(dialog).getByRole('button', { name: 'Deactivate' }))
    let pending
    act(() => { pending = lastAsk().action() })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await act(async () => { resolve({ ok: false, error: 'late failure' }); await pending })
    expect(admin.showToast).toHaveBeenCalledWith("Couldn't deactivate the account: late failure", { type: 'error' })
  })

  it('a late success after the drawer closed adds no toast', async () => {
    let resolve
    actions.toggleStaff.mockReturnValueOnce(new Promise(r => { resolve = r }))
    renderDir()
    const dialog = openMember('Ada Obi')
    await click(within(dialog).getByRole('button', { name: 'Deactivate' }))
    let pending
    act(() => { pending = lastAsk().action() })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    await act(async () => { resolve({ ok: true }); await pending })
    expect(admin.showToast).not.toHaveBeenCalled()
  })

  it('a busy action disables Deactivate and Change role', () => {
    actions.busy = 'toggleStaff'
    actions.busyKeys = ['toggleStaff:s1']
    renderDir()
    const dialog = openMember('Ada Obi')
    expect(within(dialog).getByRole('button', { name: 'Deactivating…' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Change role' })).toBeDisabled()
    expect(within(dialog).getByRole('combobox', { name: 'Change role' })).toBeDisabled()
  })
})

describe('StaffDirectory change role', () => {
  const choose = (dialog, label) => {
    const select = within(dialog).getByRole('combobox', { name: 'Change role' })
    const option = within(select).getByRole('option', { name: label })
    fireEvent.change(select, { target: { value: option.value } })
  }

  it('offers the system roles that exist plus custom roles, and never super_admin', () => {
    renderDir()
    const dialog = openMember('Ada Obi')
    const select = within(dialog).getByRole('combobox', { name: 'Change role' })
    const labels = within(select).getAllByRole('option').map(o => o.textContent)
    // moderator, verification_officer and support_agent have rows; the other two system roles do not.
    expect(labels).toEqual(['Choose a role', 'moderator', 'verification officer', 'support agent', 'night shift'])
    expect(labels.join()).not.toMatch(/super/i)
  })

  it('Change role is disabled until a different role is chosen', () => {
    renderDir()
    const dialog = openMember('Ada Obi')
    const button = within(dialog).getByRole('button', { name: 'Change role' })
    expect(button).toBeDisabled()
    choose(dialog, 'moderator')
    expect(button).toBeDisabled()
    choose(dialog, 'night shift')
    expect(button).toBeEnabled()
  })

  it('asks with the exact wording and runs only after confirm, with the id and the real name', async () => {
    renderDir()
    const dialog = openMember('Ada Obi')
    choose(dialog, 'verification officer')
    await click(within(dialog).getByRole('button', { name: 'Change role' }))
    expect(actions.assignRole).not.toHaveBeenCalled()
    const ask = lastAsk()
    expect(ask.title).toBe("Change Ada Obi's role?")
    expect(ask.consequence).toBe("They will have verification officer's access from their next request.")
    expect(ask.confirmLabel).toBe('Change role')
    await act(async () => { await ask.action() })
    expect(actions.assignRole).toHaveBeenCalledWith({ staffId: 's1', roleId: 'r2', roleName: 'verification_officer' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a failed change keeps the drawer open with the error inline', async () => {
    actions.assignRole.mockResolvedValueOnce({ ok: false, error: 'Role gone' })
    renderDir()
    const dialog = openMember('Ada Obi')
    choose(dialog, 'night shift')
    await click(within(dialog).getByRole('button', { name: 'Change role' }))
    await act(async () => { await lastAsk().action() })
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('Role gone')
  })

  it('a failure arriving after the drawer closed is toasted', async () => {
    let resolve
    actions.assignRole.mockReturnValueOnce(new Promise(r => { resolve = r }))
    renderDir()
    const dialog = openMember('Ada Obi')
    choose(dialog, 'night shift')
    await click(within(dialog).getByRole('button', { name: 'Change role' }))
    let pending
    act(() => { pending = lastAsk().action() })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    await act(async () => { resolve({ ok: false, error: 'late' }); await pending })
    expect(admin.showToast).toHaveBeenCalledWith("Couldn't change the role: late", { type: 'error' })
  })

  it('failed roles say so with Retry instead of a select', () => {
    const onRetry = vi.fn()
    renderDir({ roles: { status: 'error' }, onRetry })
    const dialog = openMember('Ada Obi')
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(dialog).getByText("Couldn't load roles")).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry loading roles' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

describe('StaffDirectory own account', () => {
  it('has no Deactivate and no Change role, and says why', () => {
    renderDir()
    const dialog = openMember('Chi Ude')
    expect(within(dialog).queryByRole('button', { name: /Deactivate|Reactivate/ })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Change role' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(dialog).getByText("You can't change your own account here.")).toBeInTheDocument()
  })

  it('other rows keep their actions', () => {
    renderDir()
    const dialog = openMember('Ada Obi')
    expect(within(dialog).getByRole('button', { name: 'Deactivate' })).toBeInTheDocument()
    expect(within(dialog).queryByText("You can't change your own account here.")).not.toBeInTheDocument()
  })
})

describe('StaffDirectory one action at a time per member', () => {
  const pending = () => { let resolve; const p = new Promise(r => { resolve = r }); return { p, resolve } }
  const pick = (dialog, label) => {
    const select = within(dialog).getByRole('combobox', { name: 'Change role' })
    fireEvent.change(select, { target: { value: within(select).getByRole('option', { name: label }).value } })
  }

  it('while a deactivate runs, Change role and the select are disabled and cannot assign', async () => {
    actions.stateful = true
    const d = pending()
    actions.toggleStaff.mockReturnValueOnce(d.p)
    renderDir()
    const dialog = openMember('Ada Obi')
    pick(dialog, 'night shift')
    await click(within(dialog).getByRole('button', { name: 'Deactivate' }))
    act(() => { lastAsk().action() })
    expect(within(dialog).getByRole('button', { name: 'Change role' })).toBeDisabled()
    expect(within(dialog).getByRole('combobox', { name: 'Change role' })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change role' }))
    expect(admin.askConfirm).toHaveBeenCalledTimes(1)
    expect(actions.assignRole).not.toHaveBeenCalled()
    await act(async () => { d.resolve({ ok: true }) })
  })

  it('while a role change runs, Deactivate is disabled', async () => {
    actions.stateful = true
    const d = pending()
    actions.assignRole.mockReturnValueOnce(d.p)
    renderDir()
    const dialog = openMember('Ada Obi')
    pick(dialog, 'night shift')
    await click(within(dialog).getByRole('button', { name: 'Change role' }))
    act(() => { lastAsk().action() })
    expect(within(dialog).getByRole('button', { name: 'Deactivate' })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }))
    expect(admin.askConfirm).toHaveBeenCalledTimes(1)
    expect(actions.toggleStaff).not.toHaveBeenCalled()
    await act(async () => { d.resolve({ ok: true }) })
  })

  it('an action running on a different member does not block this one', () => {
    actions.stateful = false
    actions.busy = 'toggleStaff'
    actions.busyKeys = ['toggleStaff:s2']
    renderDir()
    const dialog = openMember('Ada Obi')
    expect(within(dialog).getByRole('button', { name: 'Deactivate' })).toBeEnabled()
    expect(within(dialog).getByRole('combobox', { name: 'Change role' })).toBeEnabled()
  })
})
