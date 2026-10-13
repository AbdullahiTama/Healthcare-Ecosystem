import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const state = vi.hoisted(() => ({ query: null, admin: null, teamsCalls: [] }))

vi.mock('../hooks/useTeamsData', () => ({
  useTeamsData: (opts) => { state.teamsCalls.push(opts); return state.query },
}))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => state.admin }))
vi.mock('./teams/TeamsPanel.jsx', () => ({
  default: (p) => <div data-testid="teams-panel" data-props={JSON.stringify({ teams: p.teams, staff: p.staff })}><button onClick={p.onRetry}>teams retry</button></div>,
}))
vi.mock('./teams/StaffDirectory.jsx', () => ({
  default: (p) => <div data-testid="staff-directory" data-props={JSON.stringify({ staff: p.staff, roles: p.roles, teams: p.teams, currentAdminId: p.currentAdminId ?? null })} data-has-id={String('currentAdminId' in p)} />,
}))
vi.mock('./teams/CreateStaffPanel.jsx', () => ({
  default: (p) => <div data-testid="create-staff" data-props={JSON.stringify({ teams: p.teams, roles: p.roles })} />,
}))
vi.mock('./teams/RolesPanel.jsx', () => ({
  default: (p) => <div data-testid="roles-panel" data-props={JSON.stringify({ roles: p.roles })} />,
}))

import TeamsSection from './TeamsSection.jsx'

const teams = { status: 'ok', data: [{ id: 't1', name: 'Trust' }] }
const roles = { status: 'ok', data: [{ id: 'r1', name: 'auditor' }] }
const staff = { status: 'ok', data: [{ id: 's1', full_name: 'Ada' }] }
const props = (id) => JSON.parse(screen.getByTestId(id).dataset.props)

beforeEach(() => {
  state.teamsCalls = []
  state.admin = { adminUser: { id: 'a1', role: 'super_admin' } }
  state.query = { data: { teams, roles, staff }, isLoading: false, isError: false, refetch: vi.fn() }
})

describe('TeamsSection', () => {
  it('has one h1 with the subtitle', () => {
    render(<TeamsSection />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Teams & Staff')
    expect(screen.getByText('Manage teams, staff, and roles')).toBeInTheDocument()
  })

  it('gives a super admin every panel with the settled sources and the admin id', () => {
    render(<TeamsSection />)
    expect(state.teamsCalls.at(-1)).toEqual({ canSeeStaff: true })
    expect(props('teams-panel')).toEqual({ teams, staff })
    expect(props('create-staff')).toEqual({ teams, roles })
    expect(props('staff-directory')).toEqual({ staff, roles, teams, currentAdminId: 'a1' })
    expect(props('roles-panel')).toEqual({ roles })
    expect(screen.queryByText('Staff accounts and roles can only be managed by a super admin.')).toBeNull()
  })

  it('passes a missing admin id through as undefined so it fails closed', () => {
    state.admin = { adminUser: { role: 'super_admin' } }
    render(<TeamsSection />)
    expect(props('staff-directory').currentAdminId).toBeNull()
    expect(screen.getByTestId('staff-directory').dataset.hasId).toBe('true')
  })

  it('gives a non-super only the teams panel and one note', () => {
    state.admin = { adminUser: { id: 'a2', role: 'support_agent' } }
    state.query = { data: { teams, roles, staff: { status: 'restricted' } }, isLoading: false, isError: false, refetch: vi.fn() }
    render(<TeamsSection />)
    expect(state.teamsCalls.at(-1)).toEqual({ canSeeStaff: false })
    expect(screen.getByTestId('teams-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('create-staff')).toBeNull()
    expect(screen.queryByTestId('staff-directory')).toBeNull()
    expect(screen.queryByTestId('roles-panel')).toBeNull()
    expect(screen.getAllByText('Staff accounts and roles can only be managed by a super admin.')).toHaveLength(1)
  })

  it('treats no admin user as not super', () => {
    state.admin = { adminUser: null }
    render(<TeamsSection />)
    expect(state.teamsCalls.at(-1)).toEqual({ canSeeStaff: false })
    expect(screen.queryByTestId('roles-panel')).toBeNull()
  })

  it('shows a placeholder while the whole query loads', () => {
    state.query = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() }
    render(<TeamsSection />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading teams and staff…')
    expect(screen.queryByTestId('teams-panel')).toBeNull()
  })

  it('shows a failure with Retry, never empty panels, when the query failed with no data', () => {
    const refetch = vi.fn()
    state.query = { data: undefined, isLoading: false, isError: true, refetch }
    render(<TeamsSection />)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load teams and staff")
    expect(screen.queryByTestId('teams-panel')).toBeNull()
    expect(screen.queryByTestId('roles-panel')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading teams and staff' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('keeps the data when a refresh failed', () => {
    state.query = { data: { teams, roles, staff }, isLoading: false, isError: true, refetch: vi.fn() }
    render(<TeamsSection />)
    expect(screen.getByTestId('teams-panel')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('wires onRetry to refetch', () => {
    render(<TeamsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'teams retry' }))
    expect(state.query.refetch).toHaveBeenCalledTimes(1)
  })
})
