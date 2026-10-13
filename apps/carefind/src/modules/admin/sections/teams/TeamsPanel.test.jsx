import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'

const actions = vi.hoisted(() => ({ busy: null, createTeam: vi.fn() }))
const admin = vi.hoisted(() => ({ showToast: vi.fn() }))

vi.mock('../../hooks/useStaffActions', () => ({
  useStaffActions: () => ({ busy: actions.busy, createTeam: actions.createTeam }),
}))
vi.mock('../../provider/AdminProvider.jsx', () => ({
  useAdmin: () => ({ showToast: admin.showToast }),
}))

import TeamsPanel from './TeamsPanel.jsx'

const teams = { status: 'ok', data: [{ id: 't1', name: 'Trust' }, { id: 't2', name: 'Support' }] }
const staff = {
  status: 'ok',
  data: [
    { id: 's1', full_name: 'Ada Obi', email: 'ada@example.com', role: 'support_agent', team_id: 't1', is_active: true },
    { id: 's2', full_name: 'Bola Eze', email: 'bola@example.com', role: 'moderator', team_id: 't1', is_active: false },
  ],
}

const renderPanel = (props = {}) => render(<TeamsPanel teams={teams} staff={staff} canCreate onRetry={vi.fn()} {...props} />)
const teamBox = () => screen.getByLabelText(/^Team name/)
const addButton = () => screen.getByRole('button', { name: /^(add team|adding…)$/i })
const type = (el, value) => fireEvent.change(el, { target: { value } })
const team = (name) => screen.getByRole('region', { name: `Team ${name}` })

beforeEach(() => {
  actions.busy = null
  actions.createTeam.mockReset().mockResolvedValue({ ok: true })
  admin.showToast.mockReset()
})

describe('TeamsPanel lists', () => {
  it('lists each team with its members, role and status', () => {
    renderPanel()
    const trust = team('Trust')
    expect(within(trust).getByText('Ada Obi')).toBeInTheDocument()
    expect(within(trust).getByText('support agent')).toBeInTheDocument()
    expect(within(trust).getByText('Active')).toBeInTheDocument()
    expect(within(trust).getByText('Bola Eze')).toBeInTheDocument()
    expect(within(trust).getByText('Suspended')).toBeInTheDocument()
    expect(within(trust).queryByText('No members yet')).not.toBeInTheDocument()
  })

  it('says "No members yet" for a team with none once staff has loaded', () => {
    renderPanel()
    expect(within(team('Support')).getByText('No members yet')).toBeInTheDocument()
  })

  it('shows a loading placeholder, never "No members yet", while teams load', () => {
    renderPanel({ teams: undefined, staff: undefined })
    expect(screen.getByRole('status')).toHaveTextContent('Loading teams')
    expect(screen.queryByText('No members yet')).not.toBeInTheDocument()
  })

  it('a failed staff read is a quiet per-team line here, with no alert and no Retry (the directory owns it)', () => {
    renderPanel({ staff: { status: 'error' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /staff/i })).not.toBeInTheDocument()
    expect(screen.queryByText('No members yet')).not.toBeInTheDocument()
    for (const name of ['Trust', 'Support']) {
      expect(within(team(name)).getByText('Members unavailable')).toBeInTheDocument()
    }
  })

  it('restricted staff is one quiet note: no alert, no per-team member text, never "No members yet"', () => {
    renderPanel({ staff: { status: 'restricted' }, canCreate: false })
    expect(screen.getAllByText('Members are visible to super admins')).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('No members yet')).not.toBeInTheDocument()
    expect(screen.queryByText('Members unavailable')).not.toBeInTheDocument()
    expect(screen.queryByText('Only a super admin can see staff accounts')).not.toBeInTheDocument()
  })

  it('a failed teams read says so with Retry and no empty-teams text', () => {
    const onRetry = vi.fn()
    renderPanel({ teams: { status: 'error' }, onRetry })
    expect(screen.getByText("Couldn't load teams")).toBeInTheDocument()
    expect(screen.queryByText('No teams yet')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading teams' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('no teams after a good read says "No teams yet"', () => {
    renderPanel({ teams: { status: 'ok', data: [] } })
    expect(screen.getByText('No teams yet')).toBeInTheDocument()
  })

  it('a stale source keeps its data and offers a refresh Retry', () => {
    const onRetry = vi.fn()
    renderPanel({ teams: { ...teams, stale: true }, onRetry })
    expect(screen.getByText("Couldn't refresh teams")).toBeInTheDocument()
    expect(within(team('Trust')).getByText('Ada Obi')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry refreshing teams' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders markup in team and member names as inert text', () => {
    const evil = '<img src=x onerror=alert(1)>'
    const { container } = renderPanel({
      teams: { status: 'ok', data: [{ id: 't9', name: evil }] },
      staff: { status: 'ok', data: [{ id: 'x', full_name: '<b>bold</b>', role: 'moderator', team_id: 't9', is_active: true }] },
    })
    expect(container.querySelector('img, b')).toBeNull()
    expect(screen.getAllByText(evil).length).toBeGreaterThan(0)
    expect(screen.getByText('<b>bold</b>')).toBeInTheDocument()
  })
})

describe('TeamsPanel create team', () => {
  it('sends the typed name, clears the field on success', async () => {
    renderPanel()
    type(teamBox(), 'Pharmacy')
    await act(async () => { fireEvent.click(addButton()) })
    expect(actions.createTeam).toHaveBeenCalledWith({ name: 'Pharmacy' })
    expect(teamBox()).toHaveValue('')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the name and shows the error inline on failure', async () => {
    actions.createTeam.mockResolvedValue({ ok: false, error: 'Name taken' })
    renderPanel()
    type(teamBox(), 'Pharmacy')
    await act(async () => { fireEvent.click(addButton()) })
    expect(teamBox()).toHaveValue('Pharmacy')
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't create the team: Name taken")
  })

  it('a blank name still goes to the hook, which refuses it with its message', async () => {
    actions.createTeam.mockResolvedValue({ ok: false, error: 'Enter a team name' })
    renderPanel()
    await act(async () => { fireEvent.submit(screen.getByRole('form', { name: 'Create a team' })) })
    expect(actions.createTeam).toHaveBeenCalledWith({ name: '' })
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a team name')
  })

  it('disables the button and field while creating', () => {
    actions.busy = 'createTeam'
    renderPanel()
    expect(addButton()).toBeDisabled()
    expect(teamBox()).toBeDisabled()
  })

  it('does not disable the form for another running action', () => {
    actions.busy = 'toggleStaff'
    renderPanel()
    expect(addButton()).toBeEnabled()
  })

  it('a failure arriving after the panel unmounted is toasted', async () => {
    let resolve
    actions.createTeam.mockReturnValue(new Promise(r => { resolve = r }))
    const { unmount } = renderPanel()
    type(teamBox(), 'Pharmacy')
    fireEvent.click(addButton())
    unmount()
    await act(async () => { resolve({ ok: false, error: 'late' }) })
    expect(admin.showToast).toHaveBeenCalledWith("Couldn't create the team: late", { type: 'error' })
  })

  it('a success arriving after the panel unmounted adds no toast', async () => {
    let resolve
    actions.createTeam.mockReturnValue(new Promise(r => { resolve = r }))
    const { unmount } = renderPanel()
    type(teamBox(), 'Pharmacy')
    fireEvent.click(addButton())
    unmount()
    await act(async () => { resolve({ ok: true }) })
    expect(admin.showToast).not.toHaveBeenCalled()
  })
})

// What list_staff really returns: no team_id key on any row.
const serverStaff = {
  status: 'ok',
  data: [
    { id: 's1', full_name: 'Ada Obi', email: 'ada@example.com', role: 'support_agent', is_active: true, last_login: null, created_at: '2026-01-01' },
  ],
}

describe('TeamsPanel when the server does not return team_id', () => {
  it('says membership is unavailable for every team, never "No members yet"', () => {
    renderPanel({ staff: serverStaff })
    for (const name of ['Trust', 'Support']) {
      expect(within(team(name)).getByText("Team membership isn't available yet")).toBeInTheDocument()
    }
    expect(screen.queryByText('No members yet')).not.toBeInTheDocument()
    expect(screen.queryByText('Ada Obi')).not.toBeInTheDocument()
  })

  it('keeps the normal logic when any row carries team_id, even null', () => {
    renderPanel({ staff: { status: 'ok', data: [{ id: 's1', full_name: 'Ada', role: 'moderator', team_id: null, is_active: true }] } })
    expect(within(team('Trust')).getByText('No members yet')).toBeInTheDocument()
    expect(screen.queryByText("Team membership isn't available yet")).not.toBeInTheDocument()
  })

  it('an empty staff list is still "No members yet"', () => {
    renderPanel({ staff: { status: 'ok', data: [] } })
    expect(within(team('Trust')).getByText('No members yet')).toBeInTheDocument()
  })
})

describe('TeamsPanel create team form guards', () => {
  it('uses native required on the name field, not aria-required', () => {
    renderPanel()
    expect(teamBox()).toBeRequired()
    expect(teamBox()).not.toHaveAttribute('aria-required')
  })

  it('makes one call for a double submit while the first is running', async () => {
    let resolve
    actions.createTeam.mockReturnValue(new Promise(r => { resolve = r }))
    renderPanel()
    type(teamBox(), 'Pharmacy')
    const form = screen.getByRole('form', { name: 'Create a team' })
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(actions.createTeam).toHaveBeenCalledTimes(1)
    await act(async () => { resolve({ ok: true }) })
    // The guard is released afterwards.
    type(teamBox(), 'Again')
    await act(async () => { fireEvent.submit(form) })
    expect(actions.createTeam).toHaveBeenCalledTimes(2)
  })

  it('a later success clears the error from an earlier failure', async () => {
    actions.createTeam.mockResolvedValueOnce({ ok: false, error: 'Name taken' }).mockResolvedValueOnce({ ok: true })
    renderPanel()
    type(teamBox(), 'Pharmacy')
    await act(async () => { fireEvent.click(addButton()) })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await act(async () => { fireEvent.click(addButton()) })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(teamBox()).toHaveValue('')
  })

  it('releases the guard when the hook throws', async () => {
    actions.createTeam.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ ok: true })
    renderPanel()
    type(teamBox(), 'Pharmacy')
    await act(async () => { fireEvent.click(addButton()) })
    expect(screen.getByRole('alert')).toHaveTextContent('boom')
    await act(async () => { fireEvent.click(addButton()) })
    expect(actions.createTeam).toHaveBeenCalledTimes(2)
  })
})

describe('TeamsPanel create form is for super admins', () => {
  it('shows the create form when canCreate', () => {
    renderPanel()
    expect(screen.getByRole('form', { name: 'Create a team' })).toBeInTheDocument()
  })

  it.each([false, undefined])('hides the create form when canCreate is %s', (canCreate) => {
    renderPanel({ canCreate })
    expect(screen.queryByRole('form', { name: 'Create a team' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Team name')).not.toBeInTheDocument()
    expect(within(team('Trust')).getByText('Ada Obi')).toBeInTheDocument()
  })
})
