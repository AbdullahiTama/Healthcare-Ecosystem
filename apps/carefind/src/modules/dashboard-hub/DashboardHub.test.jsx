import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// --- mock supabase with in-memory tables, chainable like LiveDashboard.test.jsx ---
const mockSupabase = vi.hoisted(() => {
  const tables = {}
  function makeChain(table) {
    let op = 'select'
    const filters = []
    const chain = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve) => {
            let data = tables[table] || []
            // handle error injection
            if (tables[table] && tables[table]._error) {
              resolve({ data: null, error: { message: tables[table]._error } })
              return
            }
            if (op === 'select') {
              for (const f of filters) {
                if (f.op === 'eq') data = data.filter((r) => String(r[f.field]) === String(f.value))
                if (f.op === 'in') data = data.filter((r) => f.values.includes(r[f.field]))
                if (f.op === 'limit') data = data.slice(0, f.value)
              }
              // order is no-op for mock, filters already applied
              // limit already via eq? Actually limit via separate filter
              // For limit filter, we already slice
              // Need to handle limit distinct
              resolve({ data, error: null })
            } else {
              resolve({ data, error: null })
            }
          }
        }
        if (prop === 'maybeSingle' || prop === 'single') {
          return async () => {
            let data = tables[table] || []
            for (const f of filters) {
              if (f.op === 'eq') data = data.filter((r) => String(r[f.field]) === String(f.value))
            }
            return { data: data[0] || null, error: null }
          }
        }
        if (prop === 'select') return (..._args) => { op = 'select'; return chain }
        if (prop === 'eq') return (f, v) => { filters.push({ op: 'eq', field: f, value: v }); return chain }
        if (prop === 'in') return (f, v) => { filters.push({ op: 'in', field: f, values: v }); return chain }
        if (prop === 'order') return () => chain
        if (prop === 'limit') return (n) => { filters.push({ op: 'limit', value: n }); return chain }
        // fallback for any other chain method
        return () => chain
      },
    })
    return chain
  }
  return {
    tables,
    from: vi.fn((t) => makeChain(t)),
  }
})

vi.mock('../../config/supabaseClient', () => ({ supabase: mockSupabase }))

import DashboardHub from './DashboardHub.jsx'

function renderHub() {
  return render(
    <MemoryRouter>
      <DashboardHub />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.keys(mockSupabase.tables).forEach((k) => delete mockSupabase.tables[k])
  mockSupabase.from.mockClear()
})

describe('DashboardHub', () => {
  it('shows loading initially then stats', async () => {
    mockSupabase.tables.businesses = []
    mockSupabase.tables.admin_team_members = []
    mockSupabase.tables.agents = []
    mockSupabase.tables.applications = []
    renderHub()
    expect(screen.getByTestId('dashboard-loading')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('dashboard-hub')).toBeInTheDocument())
  })

  it('counts 0 when empty tables', async () => {
    mockSupabase.tables.businesses = []
    mockSupabase.tables.admin_team_members = []
    mockSupabase.tables.agents = []
    mockSupabase.tables.applications = []
    renderHub()
    await waitFor(() => expect(screen.getByTestId('dashboard-hub')).toBeInTheDocument())
    // stats labels should be present, values 0
    expect(screen.getByText('Total businesses')).toBeInTheDocument()
    expect(screen.getByText('Vendor approvals pending')).toBeInTheDocument()
    expect(screen.getByText('Active users')).toBeInTheDocument()
    expect(screen.getByText('Admin teams')).toBeInTheDocument()
    expect(screen.getByText('E-commerce participants')).toBeInTheDocument()
    // values: check at least that 0 appears multiple times
    // StatCard renders value as text; we check by querying testids which contain value via live region fallback?
    // Better: check stats via text content of stat containers
    const totalStat = screen.getByTestId('stat-total-businesses')
    expect(totalStat.textContent).toMatch(/0/)
    expect(screen.getByTestId('stat-pending').textContent).toMatch(/0/)
    expect(screen.getByTestId('stat-active').textContent).toMatch(/0/)
    expect(screen.getByTestId('stat-teams').textContent).toMatch(/0/)
    expect(screen.getByTestId('stat-ecommerce').textContent).toMatch(/0/)
  })

  it('counts 1 for single pending business', async () => {
    mockSupabase.tables.businesses = [
      { id: 'b1', name: 'One Biz', owner_name: 'Owner', owner_email: 'o@test.com', status: 'pending', ecommerce_enabled: false, created_at: new Date().toISOString() },
    ]
    mockSupabase.tables.admin_team_members = [{ id: 't1' }]
    mockSupabase.tables.agents = []
    mockSupabase.tables.applications = []
    renderHub()
    await waitFor(() => expect(screen.getByTestId('dashboard-hub')).toBeInTheDocument())
    expect(screen.getByTestId('stat-total-businesses').textContent).toMatch(/1/)
    expect(screen.getByTestId('stat-pending').textContent).toMatch(/1/)
    expect(screen.getByTestId('stat-active').textContent).toMatch(/0/)
    expect(screen.getByTestId('stat-teams').textContent).toMatch(/1/)
    expect(screen.getByTestId('stat-ecommerce').textContent).toMatch(/0/)
  })

  it('counts many with mixed statuses correctly', async () => {
    mockSupabase.tables.businesses = [
      { id: 'b1', name: 'Biz 1', status: 'pending', ecommerce_enabled: true, created_at: new Date().toISOString() },
      { id: 'b2', name: 'Biz 2', status: 'pending', ecommerce_enabled: false, created_at: new Date().toISOString() },
      { id: 'b3', name: 'Biz 3', status: 'active', ecommerce_enabled: true, created_at: new Date().toISOString() },
      { id: 'b4', name: 'Biz 4', status: 'active', ecommerce_enabled: false, created_at: new Date().toISOString() },
      { id: 'b5', name: 'Biz 5', status: 'suspended', ecommerce_enabled: true, created_at: new Date().toISOString() },
    ]
    mockSupabase.tables.admin_team_members = [{ id: 't1' }, { id: 't2' }, { id: 't3' }]
    mockSupabase.tables.agents = []
    mockSupabase.tables.applications = []
    renderHub()
    await waitFor(() => expect(screen.getByTestId('dashboard-hub')).toBeInTheDocument())
    expect(screen.getByTestId('stat-total-businesses').textContent).toMatch(/5/)
    expect(screen.getByTestId('stat-pending').textContent).toMatch(/2/)
    expect(screen.getByTestId('stat-active').textContent).toMatch(/2/)
    expect(screen.getByTestId('stat-teams').textContent).toMatch(/3/)
    expect(screen.getByTestId('stat-ecommerce').textContent).toMatch(/3/)
  })

  it('pending businesses list shows pending and links to /admin/businesses', async () => {
    mockSupabase.tables.businesses = [
      { id: 'b1', name: 'Pending One', owner_name: 'Alice', owner_email: 'alice@test.com', status: 'pending', ecommerce_enabled: false, created_at: new Date().toISOString() },
      { id: 'b2', name: 'Active Biz', owner_name: 'Bob', status: 'active', ecommerce_enabled: false, created_at: new Date().toISOString() },
    ]
    mockSupabase.tables.admin_team_members = []
    mockSupabase.tables.agents = []
    mockSupabase.tables.applications = []
    renderHub()
    await waitFor(() => expect(screen.getByTestId('dashboard-hub')).toBeInTheDocument())
    expect(screen.getByText('Pending One')).toBeInTheDocument()
    expect(screen.queryByText('Active Biz')).not.toBeInTheDocument()
    const link = screen.getByRole('link', { name: /View business Pending One/i })
    expect(link.getAttribute('href')).toContain('/admin/businesses')
    expect(link.getAttribute('href')).toContain('b1')
    // View all link
    const viewAll = screen.getByRole('link', { name: /View all businesses/i })
    expect(viewAll.getAttribute('href')).toBe('/admin/businesses')
    // Active not in pending list, but total still counts
    expect(screen.getByTestId('stat-total-businesses').textContent).toMatch(/2/)
  })

  it('pending agents list shows agents and links to /admin/applications', async () => {
    mockSupabase.tables.businesses = []
    mockSupabase.tables.admin_team_members = []
    mockSupabase.tables.agents = [
      { id: 'a1', full_name: 'Agent Ada', email: 'ada@test.com', status: 'pending', created_at: new Date().toISOString() },
    ]
    mockSupabase.tables.applications = [
      { id: 'app1', applicant_name: 'Applicant John', applicant_email: 'john@test.com', type: 'agent', status: 'pending', created_at: new Date().toISOString() },
    ]
    renderHub()
    await waitFor(() => expect(screen.getByTestId('dashboard-hub')).toBeInTheDocument())
    expect(screen.getByText('Agent Ada')).toBeInTheDocument()
    expect(screen.getByText('Applicant John')).toBeInTheDocument()
    const agentLink = screen.getByRole('link', { name: /View application Agent Ada/i })
    expect(agentLink.getAttribute('href')).toContain('/admin/applications')
    expect(agentLink.getAttribute('href')).toContain('a1')
    const appLink = screen.getByRole('link', { name: /View application Applicant John/i })
    expect(appLink.getAttribute('href')).toContain('/admin/applications')
    const viewAll = screen.getByRole('link', { name: /View all applications/i })
    expect(viewAll.getAttribute('href')).toBe('/admin/applications')
  })

  it('shows empty states when no pending', async () => {
    mockSupabase.tables.businesses = [
      { id: 'b1', name: 'Active Only', status: 'active', ecommerce_enabled: false, created_at: new Date().toISOString() },
    ]
    mockSupabase.tables.admin_team_members = []
    mockSupabase.tables.agents = []
    mockSupabase.tables.applications = []
    renderHub()
    await waitFor(() => expect(screen.getByTestId('dashboard-hub')).toBeInTheDocument())
    expect(screen.getByTestId('empty-businesses')).toBeInTheDocument()
    expect(screen.getByText('No pending approvals')).toBeInTheDocument()
    expect(screen.getByTestId('empty-agents')).toBeInTheDocument()
    expect(screen.getByText('No pending applications')).toBeInTheDocument()
  })

  it('is stats-only with no management buttons', async () => {
    mockSupabase.tables.businesses = [
      { id: 'b1', name: 'Biz', status: 'pending', ecommerce_enabled: false, created_at: new Date().toISOString() },
    ]
    mockSupabase.tables.admin_team_members = []
    mockSupabase.tables.agents = [
      { id: 'a1', full_name: 'Agent', email: 'a@test.com', status: 'pending', created_at: new Date().toISOString() },
    ]
    mockSupabase.tables.applications = []
    renderHub()
    await waitFor(() => expect(screen.getByTestId('dashboard-hub')).toBeInTheDocument())
    // No approve/reject/manage/delete/suspend buttons should exist
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /suspend/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /manage/i })).not.toBeInTheDocument()
    // Only expected buttons are View all links (which are links, not buttons) and maybe no buttons at all
    const buttons = screen.queryAllByRole('button')
    // Should be 0 buttons in stats-only dashboard (no management). If any, ensure none are management.
    buttons.forEach((btn) => {
      expect(btn.textContent.toLowerCase()).not.toMatch(/approve|reject|suspend|delete|manage/)
    })
  })

  it('handles no data without crashing', async () => {
    mockSupabase.tables.businesses = []
    mockSupabase.tables.admin_team_members = []
    mockSupabase.tables.agents = []
    mockSupabase.tables.applications = []
    renderHub()
    await waitFor(() => expect(screen.getByTestId('dashboard-hub')).toBeInTheDocument())
    // No error
    expect(screen.queryByTestId('dashboard-error')).not.toBeInTheDocument()
    // Empty states visible
    expect(screen.getByTestId('empty-businesses')).toBeInTheDocument()
    expect(screen.getByTestId('empty-agents')).toBeInTheDocument()
  })

  it('limits pending businesses to 5', async () => {
    mockSupabase.tables.businesses = Array.from({ length: 10 }, (_, i) => ({
      id: `b${i}`,
      name: `Biz ${i}`,
      status: 'pending',
      ecommerce_enabled: false,
      created_at: new Date(Date.now() - i * 1000).toISOString(),
    }))
    mockSupabase.tables.admin_team_members = []
    mockSupabase.tables.agents = []
    mockSupabase.tables.applications = []
    renderHub()
    await waitFor(() => expect(screen.getByTestId('dashboard-hub')).toBeInTheDocument())
    // Only 5 should be rendered due to limit(5) in mock
    const items = screen.getAllByRole('link', { name: /View business Biz/i })
    expect(items.length).toBe(5)
  })

  it('shows error state when businesses fails', async () => {
    mockSupabase.tables.businesses = []
    mockSupabase.tables.businesses._error = 'Failed to load businesses'
    mockSupabase.tables.admin_team_members = []
    mockSupabase.tables.agents = []
    mockSupabase.tables.applications = []
    renderHub()
    await waitFor(() => expect(screen.getByTestId('dashboard-error')).toBeInTheDocument())
    expect(screen.getByText(/Failed to load Businesses/i)).toBeInTheDocument()
    // Should have retry button
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument()
  })

  it('counts ecommerce participants where ecommerce_enabled true', async () => {
    mockSupabase.tables.businesses = [
      { id: 'b1', name: 'Ecom Yes', status: 'active', ecommerce_enabled: true, created_at: new Date().toISOString() },
      { id: 'b2', name: 'Ecom No', status: 'active', ecommerce_enabled: false, created_at: new Date().toISOString() },
      { id: 'b3', name: 'Ecom Null', status: 'active', ecommerce_enabled: null, created_at: new Date().toISOString() },
    ]
    mockSupabase.tables.admin_team_members = []
    mockSupabase.tables.agents = []
    mockSupabase.tables.applications = []
    renderHub()
    await waitFor(() => expect(screen.getByTestId('dashboard-hub')).toBeInTheDocument())
    // Only b1 counts
    expect(screen.getByTestId('stat-ecommerce').textContent).toMatch(/1/)
  })

  it('uses admin_team_members count not platform_team_members', async () => {
    mockSupabase.tables.businesses = []
    mockSupabase.tables.admin_team_members = [{ id: 't1' }, { id: 't2' }]
    // Ensure we query admin_team_members
    mockSupabase.tables.agents = []
    mockSupabase.tables.applications = []
    renderHub()
    await waitFor(() => expect(screen.getByTestId('dashboard-hub')).toBeInTheDocument())
    // Verify supabase.from was called with admin_team_members
    const calledTables = mockSupabase.from.mock.calls.map((c) => c[0])
    expect(calledTables).toContain('admin_team_members')
    expect(calledTables).not.toContain('platform_team_members')
    expect(screen.getByTestId('stat-teams').textContent).toMatch(/2/)
  })

  it('has accessible headings and responsive stats grid', async () => {
    mockSupabase.tables.businesses = []
    mockSupabase.tables.admin_team_members = []
    mockSupabase.tables.agents = []
    mockSupabase.tables.applications = []
    renderHub()
    await waitFor(() => expect(screen.getByTestId('dashboard-hub')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: /CareFindHub Dashboard/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Pending business approvals/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Pending agent applications/i })).toBeInTheDocument()
    // stats region
    expect(screen.getByRole('list', { name: /Dashboard statistics/i })).toBeInTheDocument()
  })
})
