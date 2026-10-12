import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, within, act, waitFor } from '@testing-library/react'
import { renderWithQueryClient } from '../../../test/renderWithQueryClient.jsx'

// The directory hook records every set of params it is called with and returns
// whatever query-like result the test has set.
const dir = vi.hoisted(() => ({ calls: [], result: null }))
const actions = vi.hoisted(() => ({ verifyUser: vi.fn(), suspendUser: vi.fn(), deleteUser: vi.fn(), busy: null }))
const trust = vi.hoisted(() => ({ value: null }))
// adminUser.id is the admin_users row id; authUserId is the sign-in (auth.users)
// id, which is what profiles.id holds. For real staff the two differ.
const admin = vi.hoisted(() => ({ askConfirm: vi.fn(), adminUser: { id: 'admin-row-1' }, authUserId: 'u-self' }))
const api = vi.hoisted(() => ({ callAdminAuth: vi.fn() }))
const csv = vi.hoisted(() => ({ exportCSV: vi.fn() }))

vi.mock('../hooks/useUsersDirectory', async (importActual) => {
  const actual = await importActual()
  return { ...actual, useUsersDirectory: (params) => { dir.calls.push(params); return dir.result } }
})
vi.mock('../hooks/useUserActions', () => ({ useUserActions: () => actions }))
vi.mock('../hooks/useTrustQueues', () => ({ useTrustQueues: () => ({ data: trust.value }) }))
vi.mock('../provider/AdminProvider.jsx', () => ({
  useAdmin: () => ({ adminUser: admin.adminUser, authUserId: admin.authUserId, askConfirm: admin.askConfirm, confirming: false }),
}))
vi.mock('../adminApi', () => ({ callAdminAuth: api.callAdminAuth }))
vi.mock('../ui', async (importActual) => ({ ...(await importActual()), exportCSV: csv.exportCSV }))

import UsersSection from './UsersSection.jsx'

const day = 86400000
const users = [
  { id: 'u1-0123456789abcdef', full_name: 'Ada Obi', display_name: 'ada', is_verified: true, verification_label: 'Pharmacist', specialty: 'Pharmacy', location: 'Abuja', website: 'ada.example', created_at: new Date(Date.now() - 3 * day).toISOString() },
  { id: 'u2', full_name: 'Bayo Lawal', display_name: null, is_verified: false, verification_label: null, specialty: null, location: 'Lagos', website: null, created_at: new Date(Date.now() - 5 * day).toISOString() },
  { id: 'u-self', full_name: 'Admin Self', display_name: null, is_verified: false, verification_label: null, specialty: null, location: null, website: null, created_at: new Date(Date.now() - 9 * day).toISOString() },
]
const posts = [
  { id: 'p1', content: 'First post', post_type: 'update', created_at: new Date().toISOString() },
  { id: 'p2', content: 'Second post', post_type: 'question', created_at: new Date().toISOString() },
  { id: 'p3', content: 'Third post', post_type: 'update', created_at: new Date().toISOString() },
]
const ok = (over = {}) => ({
  data: { rows: users, hasNext: true, total: 4218 },
  isLoading: false, isError: false, isPlaceholderData: false, refetch: vi.fn(), ...over,
})
const last = () => dir.calls[dir.calls.length - 1]
const render = () => renderWithQueryClient(<UsersSection />)
const openUser = (name) => {
  fireEvent.click(screen.getByRole('button', { name: `Review ${name}` }))
  return screen.getByRole('dialog')
}

beforeEach(() => {
  dir.calls = []
  dir.result = ok()
  trust.value = { verifications: { status: 'ok', data: [{ user_id: 'u1-0123456789abcdef', phone: '08030000000' }] } }
  actions.verifyUser.mockReset().mockImplementation(({ specialty }) =>
    Promise.resolve(specialty && specialty.trim() ? { ok: true } : { ok: false, error: 'Enter a specialty' }))
  actions.suspendUser.mockReset().mockResolvedValue({ ok: true })
  actions.deleteUser.mockReset().mockResolvedValue({ ok: true })
  admin.askConfirm.mockReset()
  admin.adminUser = { id: 'admin-row-1' }
  admin.authUserId = 'u-self'
  api.callAdminAuth.mockReset().mockResolvedValue({ data: posts })
  csv.exportCSV.mockReset()
})
afterEach(() => { vi.useRealTimers() })

describe('UsersSection', () => {
  it('has one h1, renders rows with the verified badge, and counts from total', () => {
    render()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Users' })).toBeInTheDocument()
    expect(screen.getByText('Ada Obi')).toBeInTheDocument()
    expect(screen.getByText('@ada')).toBeInTheDocument()
    expect(screen.getByText('Bayo Lawal')).toBeInTheDocument()
    expect(screen.getAllByText('Confirmed')).toHaveLength(1)
    expect(screen.getByText('4218 users')).toBeInTheDocument()
    expect(last()).toEqual({ search: '', verified: 'all', specialty: '', page: 0 })
  })

  it('searches 300 ms after typing stops on page 0, and any filter change returns to page 0', () => {
    vi.useFakeTimers()
    render()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search by name or username' }), { target: { value: 'ada' } })
    act(() => { vi.advanceTimersByTime(299) })
    expect(last().search).toBe('')
    act(() => { vi.advanceTimersByTime(1) })
    expect(last()).toEqual({ search: 'ada', verified: 'all', specialty: '', page: 0 })

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(last().page).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: 'Unverified' }))
    expect(last()).toEqual({ search: 'ada', verified: 'unverified', specialty: '', page: 0 })

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(last().page).toBe(1)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search by name or username' }), { target: { value: 'bayo' } })
    act(() => { vi.advanceTimersByTime(300) })
    expect(last()).toEqual({ search: 'bayo', verified: 'unverified', specialty: '', page: 0 })
  })

  it('the Verified pill filters on verified, and the Specialty input filters (debounced, trimmed) from page 0', () => {
    vi.useFakeTimers()
    render()
    const pills = screen.getByRole('group', { name: 'Verification' })
    expect(within(pills).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(pills).getByRole('button', { name: 'Verified' }))
    expect(last()).toEqual({ search: '', verified: 'verified', specialty: '', page: 0 })
    expect(within(pills).getByRole('button', { name: 'Verified' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(pills).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(last().page).toBe(1)
    fireEvent.change(screen.getByLabelText('Specialty'), { target: { value: ' Pharm ' } })
    act(() => { vi.advanceTimersByTime(299) })
    expect(last().specialty).toBe('')
    act(() => { vi.advanceTimersByTime(1) })
    expect(last()).toEqual({ search: '', verified: 'verified', specialty: 'Pharm', page: 0 })

    fireEvent.change(screen.getByLabelText('Specialty'), { target: { value: '   ' } })
    act(() => { vi.advanceTimersByTime(300) })
    expect(last().specialty).toBe('')
  })

  it('Clear filters resets search, verified, specialty and the Specialty text', () => {
    vi.useFakeTimers()
    dir.result = ok({ data: { rows: [], hasNext: false, total: null } })
    render()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search by name or username' }), { target: { value: 'zed' } })
    fireEvent.change(screen.getByLabelText('Specialty'), { target: { value: 'Nurse' } })
    act(() => { vi.advanceTimersByTime(300) })
    fireEvent.click(screen.getByRole('button', { name: 'Verified' }))
    expect(last()).toEqual({ search: 'zed', verified: 'verified', specialty: 'Nurse', page: 0 })
    expect(screen.getByText('No users match these filters')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    act(() => { vi.advanceTimersByTime(400) })
    expect(last()).toEqual({ search: '', verified: 'all', specialty: '', page: 0 })
    expect(screen.getByLabelText('Specialty')).toHaveValue('')
    expect(screen.getByRole('textbox', { name: 'Search by name or username' })).toHaveValue('')
  })

  it('retyping the cleared specialty straight after Clear filters still applies it', () => {
    vi.useFakeTimers()
    dir.result = ok({ data: { rows: [], hasNext: false, total: null } })
    render()
    fireEvent.change(screen.getByLabelText('Specialty'), { target: { value: 'Nurse' } })
    act(() => { vi.advanceTimersByTime(300) })
    expect(last().specialty).toBe('Nurse')
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(last().specialty).toBe('')
    act(() => { vi.advanceTimersByTime(100) })
    fireEvent.change(screen.getByLabelText('Specialty'), { target: { value: 'Nurse' } })
    act(() => { vi.advanceTimersByTime(300) })
    expect(last().specialty).toBe('Nurse')
  })

  it('a failed list shows Retry and never "No users match"', () => {
    dir.result = ok({ isError: true, data: undefined })
    render()
    expect(screen.queryByText(/No users match/)).not.toBeInTheDocument()
    expect(screen.queryByText(/No users yet/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(dir.result.refetch).toHaveBeenCalled()
  })

  it('exports this page as CSV with its icon, and is disabled with no rows', () => {
    const { unmount } = render()
    const btn = screen.getByRole('button', { name: 'Export this page (CSV)' })
    expect(btn).toBeEnabled()
    expect(btn.querySelector('svg')).not.toBeNull()
    fireEvent.click(btn)
    expect(csv.exportCSV).toHaveBeenCalledWith(users, 'users_page.csv')
    unmount()

    dir.result = ok({ data: { rows: [], hasNext: false, total: 0 } })
    render()
    expect(screen.getByRole('button', { name: 'Export this page (CSV)' })).toBeDisabled()
  })

  it('the drawer shows details, Call only when the phone is known, Website, and the 3 most recent posts', async () => {
    render()
    const dialog = openUser('Ada Obi')
    expect(within(dialog).getByText('Ada Obi')).toBeInTheDocument()
    expect(within(dialog).getByText('Confirmed')).toBeInTheDocument()
    expect(within(dialog).getByText('u1-0123456789abc…')).toBeInTheDocument()
    expect(within(dialog).getByText('Pharmacist')).toBeInTheDocument()
    expect(within(dialog).getByText('Pharmacy')).toBeInTheDocument()
    expect(within(dialog).getByText('Abuja')).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:08030000000')
    expect(within(dialog).getByRole('link', { name: 'Website' })).toHaveAttribute('href', 'https://ada.example')
    expect(await within(dialog).findByText('First post')).toBeInTheDocument()
    expect(within(dialog).getByText('Second post')).toBeInTheDocument()
    expect(within(dialog).getByText('Third post')).toBeInTheDocument()
    expect(api.callAdminAuth).toHaveBeenCalledWith('get_user_posts', { userId: 'u1-0123456789abcdef', limit: 3 })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    const bayo = openUser('Bayo Lawal')
    expect(within(bayo).queryByRole('link', { name: 'Call' })).not.toBeInTheDocument()
    expect(within(bayo).queryByRole('link', { name: 'Website' })).not.toBeInTheDocument()
  })

  it('a failed posts load says so inline and never shows 0 or "No posts yet"', async () => {
    api.callAdminAuth.mockRejectedValue(new Error('boom'))
    render()
    const dialog = openUser('Ada Obi')
    expect(await within(dialog).findByText("Couldn't load posts")).toBeInTheDocument()
    expect(within(dialog).queryByText(/\b0\b/)).not.toBeInTheDocument()
    expect(within(dialog).queryByText('No posts yet')).not.toBeInTheDocument()
  })

  it('a get_user_posts response without a list is an error, and an empty list says "No posts yet"', async () => {
    api.callAdminAuth.mockResolvedValue({ data: null })
    const { unmount } = render()
    const dialog = openUser('Ada Obi')
    expect(await within(dialog).findByText("Couldn't load posts")).toBeInTheDocument()
    expect(within(dialog).queryByText('No posts yet')).not.toBeInTheDocument()
    unmount()

    api.callAdminAuth.mockResolvedValue({ data: [] })
    render()
    const again = openUser('Ada Obi')
    expect(await within(again).findByText('No posts yet')).toBeInTheDocument()
  })

  it('Verify needs a specialty: blank shows the error inline, "Pharmacist" verifies and closes', async () => {
    render()
    const dialog = openUser('Bayo Lawal')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Verify' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Verify user' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Enter a specialty')
    expect(actions.verifyUser).toHaveBeenCalledWith({ id: 'u2', specialty: '' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText('Specialty'), { target: { value: 'Pharmacist' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Verify user' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(actions.verifyUser).toHaveBeenLastCalledWith({ id: 'u2', specialty: 'Pharmacist' })
  })

  it('has no Verify for an already verified user', () => {
    render()
    const dialog = openUser('Ada Obi')
    expect(within(dialog).queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument()
  })

  it('Suspend asks first, says the user loses verified status, and sends the chosen days', async () => {
    render()
    let dialog = openUser('Ada Obi')
    expect(within(dialog).getByRole('combobox', { name: 'Suspend duration' })).toHaveValue('7')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Suspend' }))
    expect(admin.askConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Suspend this user?',
      confirmLabel: 'Suspend',
      consequence: expect.stringMatching(/Ada Obi .*7 days.*loses their verified status; they must be verified again/),
    }))
    expect(actions.suspendUser).not.toHaveBeenCalled()
    await act(async () => { await admin.askConfirm.mock.calls[0][0].action() })
    expect(actions.suspendUser).toHaveBeenCalledWith({ id: 'u1-0123456789abcdef', days: '7' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    dialog = openUser('Ada Obi')
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Suspend duration' }), { target: { value: '30' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Suspend' }))
    expect(admin.askConfirm.mock.calls[1][0].consequence).toMatch(/30 days/)
    await act(async () => { await admin.askConfirm.mock.calls[1][0].action() })
    expect(actions.suspendUser).toHaveBeenLastCalledWith({ id: 'u1-0123456789abcdef', days: '30' })
  })

  it('Delete asks first, deletes only from the confirm action, and keeps the drawer open with the error on failure', async () => {
    actions.deleteUser.mockResolvedValue({ ok: false, error: 'Not allowed' })
    render()
    const dialog = openUser('Bayo Lawal')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete user' }))
    expect(admin.askConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Delete this user?',
      confirmLabel: 'Delete',
      consequence: "This permanently deletes Bayo Lawal's profile, their posts, and their comments, reactions, saved posts and follows. Their sign-in account itself is not removed. This cannot be undone.",
    }))
    expect(actions.deleteUser).not.toHaveBeenCalled()
    await act(async () => { await admin.askConfirm.mock.calls[0][0].action() })
    expect(actions.deleteUser).toHaveBeenCalledWith({ id: 'u2', name: 'Bayo Lawal' })
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('Not allowed')
  })

  it('fails closed: with the sign-in user id not yet known, no Delete or Suspend; they appear once it is known', () => {
    admin.adminUser = undefined
    admin.authUserId = undefined
    const { rerender } = render()
    let dialog = openUser('Bayo Lawal')
    expect(within(dialog).queryByRole('button', { name: 'Delete user' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('combobox', { name: 'Suspend duration' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Verify' })).toBeInTheDocument()

    // The admin_users id alone is not the sign-in id, so it is not enough.
    admin.adminUser = { id: 'admin-row-1' }
    rerender(<UsersSection />)
    dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'Delete user' })).not.toBeInTheDocument()

    admin.authUserId = 'u-self'
    rerender(<UsersSection />)
    dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Delete user' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Suspend' })).toBeInTheDocument()
  })

  it('hides Delete user and Suspend on the profile of the sign-in user (whose admin_users id differs), but keeps Verify', () => {
    render()
    const self = openUser('Admin Self')
    expect(within(self).queryByRole('button', { name: 'Delete user' })).not.toBeInTheDocument()
    expect(within(self).queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument()
    expect(within(self).queryByRole('combobox', { name: 'Suspend duration' })).not.toBeInTheDocument()
    expect(within(self).getByRole('button', { name: 'Verify' })).toBeInTheDocument()

    fireEvent.click(within(self).getByRole('button', { name: 'Close' }))
    const other = openUser('Bayo Lawal')
    expect(within(other).getByRole('button', { name: 'Delete user' })).toBeInTheDocument()
    expect(within(other).getByRole('button', { name: 'Suspend' })).toBeInTheDocument()
  })

  it('also hides them on a profile whose id equals the admin_users id (where the two ids coincide, as in the QA seed)', () => {
    admin.adminUser = { id: 'u2' }
    render()
    const dialog = openUser('Bayo Lawal')
    expect(within(dialog).queryByRole('button', { name: 'Delete user' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument()
  })
})
