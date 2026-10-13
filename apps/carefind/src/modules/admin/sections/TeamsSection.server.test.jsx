import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'

// TeamsSection with the REAL panels and server-shaped data (list_staff has no
// team_id / role_id). Only the hooks and the provider are stubbed.
const state = vi.hoisted(() => ({ query: null, admin: null, createTeam: null, calls: [] }))

vi.mock('../hooks/useTeamsData', () => ({ useTeamsData: (o) => { state.calls.push(o); return state.query } }))
vi.mock('../hooks/useStaffActions', () => ({
  useStaffActions: () => ({
    busy: null, isBusy: () => false,
    createTeam: state.createTeam, createStaff: vi.fn(), toggleStaff: vi.fn(), assignRole: vi.fn(),
    createRole: vi.fn(), updateRole: vi.fn(), deleteRole: vi.fn(),
  }),
}))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => state.admin }))

import TeamsSection from './TeamsSection.jsx'

const ok = (data) => ({ status: 'ok', data })
const teams = ok([{ id: 't1', name: 'Trust' }])
const roles = ok([{ id: 'r1', name: 'moderator', is_system: true }])
const staff = ok([{ id: 's1', full_name: 'Ada Obi', email: 'ada@example.com', role: 'moderator', is_active: true, last_login: null, created_at: '2026-01-01' }])
const setQuery = (data) => { state.query = { data, isLoading: false, isError: false, refetch: vi.fn() } }

beforeEach(() => {
  state.calls = []
  state.createTeam = vi.fn().mockResolvedValue({ ok: true })
  state.admin = { adminUser: { id: 'a1', role: 'super_admin' }, askConfirm: vi.fn(), showToast: vi.fn(), confirming: false }
  setQuery({ teams, roles, staff })
})

describe('TeamsSection with the real panels and server-shaped staff', () => {
  it('says membership is unavailable in the teams panel and the directory', () => {
    render(<TeamsSection />)
    expect(within(screen.getByRole('region', { name: 'Team Trust' })).getByText("Team membership isn't available yet")).toBeInTheDocument()
    expect(screen.queryByText('No members yet')).toBeNull()
    expect(within(screen.getByRole('table')).queryByText('No team')).toBeNull()
    expect(within(screen.getAllByRole('row')[1]).getByText('Not provided by the server')).toBeInTheDocument()
  })
  it('a non-super admin sees one note, no create form, and no way to create a team', () => {
    state.admin = { ...state.admin, adminUser: { id: 'a2', role: 'support_agent' } }
    setQuery({ teams, roles, staff: { status: 'restricted' } })
    render(<TeamsSection />)
    expect(state.calls.at(-1)).toEqual({ canSeeStaff: false })
    expect(screen.queryByRole('form', { name: 'Create a team' })).toBeNull()
    expect(screen.queryByLabelText(/^Team name/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add team' })).toBeNull()
    expect(screen.getAllByText('Staff accounts and roles can only be managed by a super admin.')).toHaveLength(1)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('No members yet')).toBeNull()
    expect(screen.queryByText('Only a super admin can see staff accounts')).toBeNull()
    expect(state.createTeam).not.toHaveBeenCalled()
  })

  it('a failed staff read has one Retry for staff, owned by the directory', () => {
    setQuery({ teams, roles, staff: { status: 'error' } })
    render(<TeamsSection />)
    expect(screen.getAllByRole('button', { name: 'Retry loading staff' })).toHaveLength(1)
    expect(within(screen.getByRole('region', { name: 'Team Trust' })).getByText('Members unavailable')).toBeInTheDocument()
    expect(screen.getAllByRole('alert').filter(a => /staff/.test(a.textContent))).toHaveLength(1)
  })
})
