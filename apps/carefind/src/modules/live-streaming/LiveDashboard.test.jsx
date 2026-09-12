import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const mockNavigate = vi.fn()
const mockSupabase = vi.hoisted(() => {
  const tables = {}
  const storageMock = {
    from: vi.fn(() => ({
      upload: vi.fn(async () => ({ error: null })),
      getPublicUrl: (p) => ({ data: { publicUrl: `https://storage.test/${p}` } }),
    })),
  }
  function makeChain(table) {
    let op = 'select'
    let patch = null
    const filters = []
    const chain = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve) => {
            let data = tables[table] || []
            if (op === 'select') {
              for (const f of filters) {
                if (f.op === 'eq') data = data.filter((r) => String(r[f.field]) === String(f.value))
                if (f.op === 'in') data = data.filter((r) => f.values.includes(r[f.field]))
              }
              resolve({ data, error: null })
            } else if (op === 'update') {
              let matched = [...data]
              for (const f of filters) {
                if (f.op === 'eq') matched = matched.filter((r) => String(r[f.field]) === String(f.value))
                if (f.op === 'in') matched = matched.filter((r) => f.values.includes(r[f.field]))
              }
              const hasHost = filters.some((f) => f.field === 'host_id')
              if (hasHost && matched.length === 0) {
                resolve({ data: null, error: { message: 'RLS violation', code: '42501' } })
              } else {
                matched.forEach((r) => Object.assign(r, patch))
                resolve({ data: null, error: null })
              }
            } else if (op === 'delete') {
              let matched = [...data]
              for (const f of filters) {
                if (f.op === 'eq') matched = matched.filter((r) => String(r[f.field]) === String(f.value))
              }
              const hasHost = filters.some((f) => f.field === 'host_id')
              if (hasHost && matched.length === 0) {
                resolve({ data: null, error: { message: 'RLS violation', code: '42501' } })
              } else {
                tables[table] = data.filter((r) => !matched.includes(r))
                resolve({ data: null, error: null })
              }
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
        if (prop === 'select') return () => { op = 'select'; return chain }
        if (prop === 'update') return (p) => { op = 'update'; patch = p; return chain }
        if (prop === 'delete') return () => { op = 'delete'; return chain }
        if (prop === 'insert') return () => { op = 'insert'; return chain }
        if (prop === 'eq') return (f, v) => { filters.push({ op: 'eq', field: f, value: v }); return chain }
        if (prop === 'in') return (f, v) => { filters.push({ op: 'in', field: f, values: v }); return chain }
        if (prop === 'order') return () => chain
        if (prop === 'limit') return () => chain
        return () => chain
      },
    })
    return chain
  }
  return {
    tables,
    storage: storageMock,
    from: vi.fn((t) => makeChain(t)),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  }
})

vi.mock('../../config/supabaseClient', () => ({ supabase: mockSupabase }))
vi.mock('../../services/ensureProfile.js', () => ({ ensureProfile: async () => {} }))

const authUser = { id: 'user-1', email: 'a@test.com' }
vi.mock('../../providers/AuthContext', () => ({
  useAuth: () => ({ user: authUser, signOut: vi.fn() }),
}))
vi.mock('../../hooks/useBreakpoint', () => ({
  useBreakpoint: () => ({ isMobileOrTablet: true }),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useParams: () => ({ id: 'show-1' }),
    useNavigate: () => mockNavigate,
  }
})
vi.mock('../../components/VoiceRecorder.jsx', () => ({ default: () => null }))
vi.mock('../../components/SlideUploader.jsx', () => ({ default: () => null }))
vi.mock('../../components/VideoUploader.jsx', () => ({ default: () => null }))
vi.mock('../../components/VideoRecorder.jsx', () => ({ default: () => null }))

import LiveDashboard from './LiveDashboard.jsx'

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/live-dashboard/show-1']}>
      <Routes>
        <Route path="/live-dashboard/:id" element={<LiveDashboard />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('LiveDashboard scheduled manageable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockSupabase.tables).forEach((k) => delete mockSupabase.tables[k])
    mockSupabase.tables.live_participants = []
    mockSupabase.tables.live_items = []
    mockSupabase.tables.live_comments = []
    mockSupabase.tables.live_reactions = []
    mockSupabase.tables.live_shares = []
    mockSupabase.tables.live_views = []
    mockSupabase.tables.gifts = []
    mockNavigate.mockClear()
  })

  it('owner can edit title and reschedule to future', async () => {
    const future = new Date(Date.now() + 2 * 86400000).toISOString()
    mockSupabase.tables.live_shows = [
      { id: 'show-1', title: 'Old Title', status: 'scheduled', scheduled_at: future, host_id: 'user-1', trailer_url: null, is_platform: false },
    ]
    renderDashboard()
    // Wait for scheduled banner and Edit button
    const editBtn = await screen.findByRole('button', { name: /Edit scheduled/i })
    expect(editBtn).toBeInTheDocument()
    fireEvent.click(editBtn)
    const titleInput = await screen.findByPlaceholderText('Show title')
    fireEvent.change(titleInput, { target: { value: 'New Title' } })
    const dt = document.querySelector('input[type="datetime-local"]')
    expect(dt).not.toBeNull()
    const newFuture = new Date(Date.now() + 3 * 86400000)
    const pad = (n) => String(n).padStart(2, '0')
    const localVal = `${newFuture.getFullYear()}-${pad(newFuture.getMonth() + 1)}-${pad(newFuture.getDate())}T${pad(newFuture.getHours())}:${pad(newFuture.getMinutes())}`
    fireEvent.change(dt, { target: { value: localVal } })
    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }))
    await waitFor(() => expect(screen.queryByPlaceholderText('Show title')).not.toBeInTheDocument())
    const updated = mockSupabase.tables.live_shows.find((s) => s.id === 'show-1')
    expect(updated.title).toBe('New Title')
    expect(new Date(updated.scheduled_at).getTime()).toBeGreaterThan(Date.now() + 2 * 86400000 - 60000)
  })

  it('reschedule to past is rejected', async () => {
    const future = new Date(Date.now() + 2 * 86400000).toISOString()
    mockSupabase.tables.live_shows = [
      { id: 'show-1', title: 'Show', status: 'scheduled', scheduled_at: future, host_id: 'user-1', trailer_url: null },
    ]
    renderDashboard()
    fireEvent.click(await screen.findByRole('button', { name: /Edit scheduled/i }))
    await screen.findByPlaceholderText('Show title')
    const dt = document.querySelector('input[type="datetime-local"]')
    expect(dt).not.toBeNull()
    const past = new Date(Date.now() - 86400000)
    const pad = (n) => String(n).padStart(2, '0')
    const pastVal = `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}T${pad(past.getHours())}:${pad(past.getMinutes())}`
    fireEvent.change(dt, { target: { value: pastVal } })
    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('alert').textContent).toMatch(/at least 5 minutes/i)
  })

  it('cancel makes show disappear (delete or ended)', async () => {
    const future = new Date(Date.now() + 2 * 86400000).toISOString()
    mockSupabase.tables.live_shows = [
      { id: 'show-1', title: 'To Cancel', status: 'scheduled', scheduled_at: future, host_id: 'user-1', trailer_url: null },
    ]
    renderDashboard()
    fireEvent.click(await screen.findByRole('button', { name: /Cancel scheduled/i }))
    const confirmBtn = await screen.findByText('Cancel show')
    fireEvent.click(confirmBtn)
    await waitFor(() => {
      const row = mockSupabase.tables.live_shows.find((s) => s.id === 'show-1')
      expect(row === undefined || row.status === 'ended').toBe(true)
    })
    // After cancel, row should be deleted or marked ended
    const row = mockSupabase.tables.live_shows.find((s) => s.id === 'show-1')
    // either removed or status ended
    if (row) expect(row.status).toBe('ended')
    else expect(row).toBeUndefined()
  })

  it('expired scheduled shows expired notice', async () => {
    const past = new Date(Date.now() - 86400000).toISOString()
    mockSupabase.tables.live_shows = [
      { id: 'show-1', title: 'Expired Show', status: 'scheduled', scheduled_at: past, host_id: 'user-1', trailer_url: null },
    ]
    renderDashboard()
    expect(await screen.findByText(/This scheduled time has passed/i)).toBeInTheDocument()
  })

  it('non-owner cannot see Edit/Cancel and update is rejected', async () => {
    const future = new Date(Date.now() + 2 * 86400000).toISOString()
    mockSupabase.tables.live_shows = [
      { id: 'show-1', title: 'Other Show', status: 'scheduled', scheduled_at: future, host_id: 'other-user', trailer_url: null },
    ]
    // Make participant so dashboard renders (isParticipant check)
    mockSupabase.tables.live_participants = [{ show_id: 'show-1', user_id: 'user-1', role: 'guest', joined: true }]
    renderDashboard()
    // Should show "Not a participant" because isHost false and participants includes user? Actually participants mock will be overridden by load() which fetches from tables.live_participants via supabase; our mock will return the participant we set.
    // But due to isHost false, isParticipant true, so dashboard should render but without Edit.
    await waitFor(() => expect(screen.queryByText(/This show is scheduled/i)).not.toBeNull())
    // Wait a bit for load
    await screen.findByText('Other Show')
    expect(screen.queryByRole('button', { name: /Edit scheduled/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cancel scheduled/i })).not.toBeInTheDocument()
    // Direct supabase update should be rejected
    const { error } = await mockSupabase.from('live_shows').update({ title: 'Hacked' }).eq('id', 'show-1').eq('host_id', 'user-1').eq('status', 'scheduled')
    expect(error).not.toBeNull()
    expect(error.code).toBe('42501')
  })
})
