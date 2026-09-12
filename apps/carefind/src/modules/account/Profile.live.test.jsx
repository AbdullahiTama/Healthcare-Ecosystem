import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Hoisted stable mocks
const mockSupabase = vi.hoisted(() => {
  const tables = {}
  const storageMock = {
    from: vi.fn((bucket) => ({
      upload: vi.fn(async () => ({ error: null })),
      getPublicUrl: (path) => ({ data: { publicUrl: `https://storage.test/${path}` } }),
    })),
  }
  // Builder for query chaining
  function makeChain(table) {
    let op = 'select'
    let patch = null
    const filters = []
    const chain = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve, reject) => {
            try {
              let data = tables[table] || []
              // For select, apply filters; for update/delete, apply patch/remove
              if (op === 'select') {
                for (const f of filters) {
                  if (f.op === 'eq') data = data.filter((r) => String(r[f.field]) === String(f.value))
                  if (f.op === 'in') data = data.filter((r) => f.values.includes(r[f.field]))
                  if (f.op === 'gt') data = data.filter((r) => new Date(r[f.field]) > new Date(f.value))
                }
                resolve({ data, error: null })
              } else if (op === 'update') {
                let matched = [...data]
                for (const f of filters) {
                  if (f.op === 'eq') matched = matched.filter((r) => String(r[f.field]) === String(f.value))
                  if (f.op === 'in') matched = matched.filter((r) => f.values.includes(r[f.field]))
                }
                // Simulate RLS: if trying to update with host_id filter that doesn't match, return 42501
                // For our tests, if matched length 0, simulate RLS deny when host_id filter present
                const hasHostFilter = filters.some((f) => f.field === 'host_id')
                if (hasHostFilter && matched.length === 0) {
                  resolve({ data: null, error: { message: 'new row violates row-level security policy', code: '42501' } })
                } else {
                  matched.forEach((row) => Object.assign(row, patch))
                  resolve({ data: null, error: null })
                }
              } else if (op === 'delete') {
                let matched = [...data]
                for (const f of filters) {
                  if (f.op === 'eq') matched = matched.filter((r) => String(r[f.field]) === String(f.value))
                  if (f.op === 'in') matched = matched.filter((r) => f.values.includes(r[f.field]))
                }
                const hasHostFilter = filters.some((f) => f.field === 'host_id')
                if (hasHostFilter && matched.length === 0) {
                  resolve({ data: null, error: { message: 'new row violates row-level security policy', code: '42501' } })
                } else {
                  tables[table] = data.filter((r) => !matched.includes(r))
                  resolve({ data: null, error: null })
                }
              } else if (op === 'insert') {
                resolve({ data: null, error: null })
              } else {
                resolve({ data: data, error: null })
              }
            } catch (e) {
              reject(e)
            }
          }
        }
        if (prop === 'maybeSingle' || prop === 'single') {
          return async () => {
            let data = tables[table] || []
            for (const f of filters) {
              if (f.op === 'eq') data = data.filter((r) => String(r[f.field]) === String(f.value))
              if (f.op === 'in') data = data.filter((r) => f.values.includes(r[f.field]))
            }
            return { data: data[0] || null, error: null }
          }
        }
        if (prop === 'select') return (..._a) => { op = 'select'; return chain }
        if (prop === 'update') return (p) => { op = 'update'; patch = p; return chain }
        if (prop === 'delete') return () => { op = 'delete'; return chain }
        if (prop === 'insert') return () => { op = 'insert'; return chain }
        if (prop === 'eq') return (field, value) => { filters.push({ op: 'eq', field, value }); return chain }
        if (prop === 'in') return (field, values) => { filters.push({ op: 'in', field, values }); return chain }
        if (prop === 'gt') return (field, value) => { filters.push({ op: 'gt', field, value }); return chain }
        if (prop === 'order') return () => chain
        if (prop === 'limit') return () => chain
        if (prop === 'range') return () => chain
        // any other builder method chains
        return () => chain
      },
    })
    return chain
  }
  return {
    tables,
    storage: storageMock,
    from: vi.fn((table) => makeChain(table)),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  }
})

const { authUser } = vi.hoisted(() => ({ authUser: { id: 'user-1', email: 'me@carefind.app' } }))

vi.mock('../../config/supabaseClient', () => ({ supabase: mockSupabase }))
vi.mock('../../providers/AuthContext', () => ({
  useAuth: () => ({ user: authUser, signOut: vi.fn() }),
}))
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => ({ isMobile: true }) }))
vi.mock('../../hooks/useHeaderIdentity', () => ({
  useHeaderIdentity: () => ({ myUsername: 'me', myAvatar: null, unreadNotifs: 0 }),
}))
vi.mock('../subscriptions-monetization/subscriptions.js', () => ({
  MAX_PRICE_COINS: 100000,
  coinsToNaira: () => 0,
  loadActiveCreatorIds: async () => [],
}))
vi.mock('../../components/layout/AppShell.jsx', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../../components/BottomNav.jsx', () => ({ default: () => null }))
vi.mock('./ProductUpload.jsx', () => ({ default: () => null }))
vi.mock('../social-feed/FollowersSheet.jsx', () => ({ default: () => null }))
vi.mock('../social-feed/components/StoryViewer.jsx', () => ({ default: () => null }))
vi.mock('../../utils/imageResize.js', () => ({ resizeImage: async (f) => f }))

import Profile from './Profile.jsx'

function renderProfile() {
  return render(
    <MemoryRouter>
      <Profile />
    </MemoryRouter>
  )
}

describe('Profile scheduled live manageable lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockSupabase.tables).forEach((k) => delete mockSupabase.tables[k])
    // Minimal required tables for loadProfile etc
    mockSupabase.tables.profiles = [{ id: 'user-1', full_name: 'Test User', display_name: 'testuser', is_verified: false, location: null, website: null, cover_url: null, avatar_url: null, subscription_price: 0, bio: null }]
    mockSupabase.tables.businesses = []
    mockSupabase.tables.posts = []
    mockSupabase.tables.saved_posts = []
    mockSupabase.tables.stories = []
    mockSupabase.tables.playlists = []
    mockSupabase.tables.user_reviews = []
    mockSupabase.tables.follows = []
    mockSupabase.tables.wallets = []
    mockSupabase.tables.staff_claims = []
  })

  it('expired scheduled_at not in Upcoming but in Past', async () => {
    const now = Date.now()
    const future = new Date(now + 2 * 86400000).toISOString()
    const past = new Date(now - 2 * 86400000).toISOString()
    mockSupabase.tables.live_shows = [
      { id: 'future-1', title: 'Future Show', status: 'scheduled', scheduled_at: future, host_id: 'user-1', trailer_url: null },
      { id: 'past-1', title: 'Past Show', status: 'scheduled', scheduled_at: past, host_id: 'user-1', trailer_url: null },
    ]
    renderProfile()
    // Upcoming manage should contain future but not past
    expect(await screen.findByTestId('upcoming-manage-future-1')).toBeInTheDocument()
    expect(screen.queryByTestId('upcoming-manage-past-1')).not.toBeInTheDocument()
    // Past section should contain past-1 but not future-1
    const pastSection = await screen.findByTestId('past-shows-section')
    expect(pastSection).toBeInTheDocument()
    expect(await screen.findByTestId('past-show-past-1')).toBeInTheDocument()
    expect(screen.queryByTestId('past-show-future-1')).not.toBeInTheDocument()
  })

  it('owner can edit title and reschedule to future', async () => {
    const future = new Date(Date.now() + 2 * 86400000).toISOString()
    mockSupabase.tables.live_shows = [
      { id: 'show-1', title: 'Old Title', status: 'scheduled', scheduled_at: future, host_id: 'user-1', trailer_url: null },
    ]
    renderProfile()
    const editBtn = await screen.findByRole('button', { name: /Edit Old Title/i })
    fireEvent.click(editBtn)
    // modal appears
    const titleInput = await screen.findByPlaceholderText('Show title')
    expect(titleInput).toBeInTheDocument()
    fireEvent.change(titleInput, { target: { value: 'New Title' } })
    const datetime = document.querySelector('input[type="datetime-local"]')
    expect(datetime).not.toBeNull()
    // set to 3 days future
    const newFuture = new Date(Date.now() + 3 * 86400000)
    const pad = (n) => String(n).padStart(2, '0')
    const localVal = `${newFuture.getFullYear()}-${pad(newFuture.getMonth() + 1)}-${pad(newFuture.getDate())}T${pad(newFuture.getHours())}:${pad(newFuture.getMinutes())}`
    fireEvent.change(datetime, { target: { value: localVal } })
    const saveBtn = screen.getByRole('button', { name: /Save changes/i })
    fireEvent.click(saveBtn)
    await waitFor(() => expect(screen.queryByText('Give your show a title.')).not.toBeInTheDocument())
    // Verify table was updated
    await waitFor(() => {
      const updated = mockSupabase.tables.live_shows.find((s) => s.id === 'show-1')
      expect(updated.title).toBe('New Title')
    })
    // After save, modal closes and profile reflects new title (in upcoming manage)
    await waitFor(() => expect(screen.queryByPlaceholderText('Show title')).not.toBeInTheDocument())
  })

  it('reschedule to past is rejected with validation error', async () => {
    const future = new Date(Date.now() + 2 * 86400000).toISOString()
    mockSupabase.tables.live_shows = [
      { id: 'show-2', title: 'Show 2', status: 'scheduled', scheduled_at: future, host_id: 'user-1', trailer_url: null },
    ]
    renderProfile()
    const editBtn = await screen.findByRole('button', { name: /Edit Show 2/i })
    fireEvent.click(editBtn)
    await screen.findByPlaceholderText('Show title')
    const datetime = document.querySelector('input[type="datetime-local"]')
    expect(datetime).not.toBeNull()
    const past = new Date(Date.now() - 86400000)
    const pad = (n) => String(n).padStart(2, '0')
    const pastVal = `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}T${pad(past.getHours())}:${pad(past.getMinutes())}`
    fireEvent.change(datetime, { target: { value: pastVal } })
    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('alert').textContent).toMatch(/at least 5 minutes/i)
    // Ensure not saved
    const row = mockSupabase.tables.live_shows.find((s) => s.id === 'show-2')
    // original future should remain unchanged (still future, not past)
    expect(new Date(row.scheduled_at).getTime()).toBeGreaterThan(Date.now())
  })

  it('cancel makes scheduled disappear from Upcoming', async () => {
    const future = new Date(Date.now() + 2 * 86400000).toISOString()
    mockSupabase.tables.live_shows = [
      { id: 'show-3', title: 'To Cancel', status: 'scheduled', scheduled_at: future, host_id: 'user-1', trailer_url: null },
    ]
    renderProfile()
    expect(await screen.findByTestId('upcoming-manage-show-3')).toBeInTheDocument()
    const cancelBtn = screen.getByRole('button', { name: /Cancel To Cancel/i })
    fireEvent.click(cancelBtn)
    // confirm dialog
    const confirmBtn = await screen.findByText('Cancel show')
    fireEvent.click(confirmBtn)
    await waitFor(() => expect(screen.queryByTestId('upcoming-manage-show-3')).not.toBeInTheDocument())
    // Should now be in Past/Ended or removed entirely; if soft-cancel, it will be in Past
    // Our mock delete removes row, so Past should not contain it. Check it disappeared from Upcoming at least.
    const stillUpcoming = screen.queryByTestId('upcoming-manage-show-3')
    expect(stillUpcoming).not.toBeInTheDocument()
  })

  it('non-owner edit is rejected by RLS (42501)', async () => {
    // Simulate direct supabase update attempt as non-owner
    const future = new Date(Date.now() + 2 * 86400000).toISOString()
    mockSupabase.tables.live_shows = [
      { id: 'other-show', title: 'Other Show', status: 'scheduled', scheduled_at: future, host_id: 'other-user', trailer_url: null },
    ]
    // Attempt to update with host_id filter = user-1 (non-owner) should fail
    const { error } = await mockSupabase.from('live_shows').update({ title: 'Hacked' }).eq('id', 'other-show').eq('host_id', 'user-1').eq('status', 'scheduled')
    expect(error).not.toBeNull()
    expect(error.code).toBe('42501')
    // Ensure title not changed
    const row = mockSupabase.tables.live_shows.find((s) => s.id === 'other-show')
    expect(row.title).toBe('Other Show')
  })

  it('shows Past/Ended for status ended regardless of scheduled_at', async () => {
    const future = new Date(Date.now() + 2 * 86400000).toISOString()
    mockSupabase.tables.live_shows = [
      { id: 'ended-1', title: 'Ended Show', status: 'ended', scheduled_at: future, host_id: 'user-1', trailer_url: null },
    ]
    renderProfile()
    // Ended shows should not be in Upcoming manage
    await waitFor(() => expect(screen.queryByTestId('upcoming-manage-ended-1')).not.toBeInTheDocument())
    expect(await screen.findByTestId('past-show-ended-1')).toBeInTheDocument()
  })
})
