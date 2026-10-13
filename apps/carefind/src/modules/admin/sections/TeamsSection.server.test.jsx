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
})
