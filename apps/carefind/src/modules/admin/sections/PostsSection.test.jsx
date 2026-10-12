import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// The directory hook records every set of params it is called with and returns
// whatever query-like result the test has set.
const dir = vi.hoisted(() => ({ calls: [], result: null }))
const actions = vi.hoisted(() => ({ deletePost: vi.fn(), busyId: null }))
const admin = vi.hoisted(() => ({ askConfirm: vi.fn(), showToast: vi.fn() }))
const api = vi.hoisted(() => ({ callAdminAuth: vi.fn() }))
const csv = vi.hoisted(() => ({ exportCSV: vi.fn() }))

vi.mock('../hooks/usePostsDirectory', async (importActual) => {
  const actual = await importActual()
  return { ...actual, usePostsDirectory: (params) => { dir.calls.push(params); return dir.result } }
})
vi.mock('../hooks/useReviewActions', () => ({ useReviewActions: () => actions }))
vi.mock('../provider/AdminProvider.jsx', () => ({
  useAdmin: () => ({ askConfirm: admin.askConfirm, confirming: false, showToast: admin.showToast }),
}))
vi.mock('../adminApi', () => ({ callAdminAuth: api.callAdminAuth }))
vi.mock('../ui', async (importActual) => ({ ...(await importActual()), exportCSV: csv.exportCSV }))

import PostsSection from './PostsSection.jsx'
import { POSTS_PAGE_SIZE } from '../hooks/usePostsDirectory'

const day = 86400000
const longText = `${'a'.repeat(100)}TAIL beyond the excerpt`
const posts = [
  {
    id: 'p1', content: 'Is paracetamol safe in pregnancy?\nAsking for a friend.', post_type: 'question',
    user_id: 'u1234567-89ab-cdef', view_count: 42, created_at: new Date(Date.now() - 2 * day).toISOString(),
    image_urls: ['https://cdn.example/one.jpg', null, '', 'https://cdn.example/two.jpg'], image_url: 'https://cdn.example/legacy.jpg',
    video_url: 'https://cdn.example/clip.mp4', audio_url: 'https://cdn.example/voice.mp3',
    rating: 4, theme: 'sunrise', subscriber_only: true,
  },
  {
    id: 'p2', content: longText, post_type: 'article', user_id: null, view_count: null,
    created_at: new Date(Date.now() - 5 * day).toISOString(), image_urls: [], image_url: 'javascript:alert(1)',
  },
  { id: 'p3', content: '', post_type: 'text', user_id: 'u9', view_count: 0, created_at: null },
]
const profile = { id: 'u1234567-89ab-cdef', full_name: 'Ada Obi', display_name: 'ada', is_verified: true, verification_label: 'Pharmacist' }
const ok = (over = {}) => ({
  data: { rows: posts, hasNext: true, total: 1200 },
  isLoading: false, isError: false, isPlaceholderData: false, refetch: vi.fn(), ...over,
})
const last = () => dir.calls[dir.calls.length - 1]
const CONSEQUENCE = 'This permanently deletes the post along with its likes and comments. This cannot be undone.'

// One QueryClient per test, created in beforeEach and shared by every render
// in that test.
function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}
let wrapper
const renderSection = () => render(<PostsSection />, { wrapper })
const searchBox = () => screen.getByRole('textbox', { name: 'Search post text…' })
// The From and To inputs are reached by their labels, inside the named group.
const dateInputs = () => {
  const group = within(screen.getByRole('group', { name: 'Posted between' }))
  return [group.getByLabelText('From'), group.getByLabelText('To')]
}
const openPost = (label) => {
  fireEvent.click(screen.getByRole('button', { name: `Review ${label}` }))
  return screen.getByRole('dialog')
}
// The list excerpt is one line: runs of whitespace collapse to a space.
const openFirst = () => openPost('Is paracetamol safe in pregnancy? Asking for a friend.')

beforeEach(() => {
  wrapper = makeWrapper()
  dir.calls = []
  dir.result = ok()
  actions.deletePost.mockReset()
  actions.deletePost.mockResolvedValue({ ok: true })
  actions.busyId = null
  admin.askConfirm.mockReset()
  admin.showToast.mockReset()
  api.callAdminAuth.mockReset()
  api.callAdminAuth.mockResolvedValue({ data: profile })
  csv.exportCSV.mockReset()
})
afterEach(() => { vi.useRealTimers() })

describe('PostsSection', () => {
  it('has one h1 "Posts", counts from total, and starts unfiltered on page 0', () => {
    renderSection()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Posts' })).toBeInTheDocument()
    expect(screen.getByText('1200 posts')).toBeInTheDocument()
    expect(last()).toEqual({ search: '', type: 'all', dateFrom: '', dateTo: '', page: 0 })
    expect(POSTS_PAGE_SIZE).toBe(25)
  })

  it('renders rows with excerpt, type, author id, views and never an invented 0 views', () => {
    renderSection()
    const [, first, second, third] = screen.getAllByRole('row')
    expect(within(first).getByText('Is paracetamol safe in pregnancy? Asking for a friend.')).toBeInTheDocument()
    expect(within(first).getByText('Question')).toBeInTheDocument()
    expect(within(first).getByText('u1234567')).toBeInTheDocument()
    expect(within(first).getByText('42')).toBeInTheDocument()

    expect(within(second).getByText(`${'a'.repeat(100)}…`)).toBeInTheDocument()
    expect(within(second).queryByText(/TAIL/)).not.toBeInTheDocument()
    expect(within(second).getByText('Article')).toBeInTheDocument()
    // No author and no view count: both are '—', never 0.
    expect(within(second).getAllByText('—')).toHaveLength(2)
    expect(within(second).queryByText('0')).not.toBeInTheDocument()

    // An empty post and a missing date show '—'; a real 0 views is shown as 0.
    expect(within(third).getAllByText('—')).toHaveLength(2)
    expect(within(third).getByText('0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review Post' })).toBeInTheDocument()
  })

  it('searches 300 ms after typing stops, and returns to page 0 after paging', () => {
    vi.useFakeTimers()
    renderSection()
    fireEvent.change(searchBox(), { target: { value: 'paracetamol' } })
    act(() => { vi.advanceTimersByTime(299) })
    expect(last().search).toBe('')
    act(() => { vi.advanceTimersByTime(1) })
    expect(last()).toEqual({ search: 'paracetamol', type: 'all', dateFrom: '', dateTo: '', page: 0 })

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(last().page).toBe(2)
    fireEvent.change(searchBox(), { target: { value: 'ibuprofen' } })
    act(() => { vi.advanceTimersByTime(300) })
    expect(last()).toEqual({ search: 'ibuprofen', type: 'all', dateFrom: '', dateTo: '', page: 0 })
  })

  it('the Post type pills filter by type from page 0 and report which is pressed', () => {
    renderSection()
    const pills = screen.getByRole('group', { name: 'Post type' })
    expect(within(pills).getAllByRole('button').map(b => b.textContent))
      .toEqual(['All', 'Text', 'Question', 'Review', 'Article', 'Visual', 'Premium'])
    expect(within(pills).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(last().page).toBe(1)
    fireEvent.click(within(pills).getByRole('button', { name: 'Review' }))
    expect(last()).toEqual({ search: '', type: 'review', dateFrom: '', dateTo: '', page: 0 })
    expect(within(pills).getByRole('button', { name: 'Review' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(pills).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false')

    // Clicking the pill already chosen changes nothing, including the page.
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(within(pills).getByRole('button', { name: 'Review' }))
    expect(last().page).toBe(1)
  })

  it('the From and To dates filter from page 0', () => {
    renderSection()
    const [from, to] = dateInputs()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.change(from, { target: { value: '2026-09-01' } })
    expect(last()).toEqual({ search: '', type: 'all', dateFrom: '2026-09-01', dateTo: '', page: 0 })

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(last().page).toBe(1)
    fireEvent.change(to, { target: { value: '2026-09-30' } })
    expect(last()).toEqual({ search: '', type: 'all', dateFrom: '2026-09-01', dateTo: '2026-09-30', page: 0 })
  })

  it('Clear filters resets search, type, dates, page and the search box', () => {
    vi.useFakeTimers()
    dir.result = ok({ data: { rows: [], hasNext: false, total: null } })
    renderSection()
    fireEvent.change(searchBox(), { target: { value: 'zed' } })
    act(() => { vi.advanceTimersByTime(300) })
    fireEvent.click(screen.getByRole('button', { name: 'Visual' }))
    const [from, to] = dateInputs()
    fireEvent.change(from, { target: { value: '2026-09-01' } })
    fireEvent.change(to, { target: { value: '2026-09-30' } })
    expect(last()).toEqual({ search: 'zed', type: 'visual', dateFrom: '2026-09-01', dateTo: '2026-09-30', page: 0 })

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    act(() => { vi.advanceTimersByTime(400) })
    expect(last()).toEqual({ search: '', type: 'all', dateFrom: '', dateTo: '', page: 0 })
    expect(searchBox()).toHaveValue('')
    const [fromAfter, toAfter] = dateInputs()
    expect(fromAfter).toHaveValue('')
    expect(toAfter).toHaveValue('')
  })

  it('a failed list shows Retry and never "No posts match"', () => {
    dir.result = ok({ isError: true, data: undefined })
    renderSection()
    expect(screen.queryByText(/No posts match/)).not.toBeInTheDocument()
    expect(screen.queryByText(/No posts yet/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(dir.result.refetch).toHaveBeenCalled()
  })

  it('an empty filtered list says "No posts match these filters" with Clear filters; unfiltered says "No posts yet"', () => {
    dir.result = ok({ data: { rows: [], hasNext: false, total: null } })
    const { unmount } = renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Premium' }))
    expect(screen.getByText('No posts match these filters')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(last().type).toBe('all')
    unmount()

    dir.result = ok({ data: { rows: [], hasNext: false, total: 0 } })
    renderSection()
    expect(screen.getByText('No posts yet')).toBeInTheDocument()
    expect(screen.queryByText(/No posts match/)).not.toBeInTheDocument()
  })

  it('exports this page as CSV with its icon, and is disabled with no rows', () => {
    const { unmount } = renderSection()
    const btn = screen.getByRole('button', { name: 'Export this page (CSV)' })
    expect(btn).toBeEnabled()
    expect(btn.querySelector('svg')).not.toBeNull()
    fireEvent.click(btn)
    expect(csv.exportCSV).toHaveBeenCalledWith(posts, 'posts_page.csv')
    unmount()

    dir.result = ok({ data: { rows: [], hasNext: false, total: 0 } })
    renderSection()
    expect(screen.getByRole('button', { name: 'Export this page (CSV)' })).toBeDisabled()
  })

  it('the Posted column is not sortable, because only the 25 rows on screen would sort', () => {
    renderSection()
    const before = screen.getAllByRole('row').map(r => r.textContent)
    const posted = screen.getByRole('columnheader', { name: 'Posted' })
    expect(posted).toHaveAttribute('aria-sort', 'none')
    fireEvent.click(posted)
    fireEvent.click(posted)
    expect(posted).toHaveAttribute('aria-sort', 'none')
    expect(screen.getAllByRole('row').map(r => r.textContent)).toEqual(before)
  })

  it('the drawer shows the type, author, full content, images, video, audio and badges; the author loads only once opened', async () => {
    renderSection()
    expect(api.callAdminAuth).not.toHaveBeenCalled()
    const dialog = openFirst()
    // The drawer's title is the post type; there is no status badge.
    expect(within(dialog).getByText('Question')).toBeInTheDocument()
    expect(await within(dialog).findByText('Ada Obi')).toBeInTheDocument()
    expect(within(dialog).getByText('@ada')).toBeInTheDocument()
    expect(within(dialog).getByText('Pharmacist')).toBeInTheDocument()
    expect(api.callAdminAuth).toHaveBeenCalledWith('get_user_profile', { userId: 'u1234567-89ab-cdef' })

    const content = within(dialog).getByText(/Is paracetamol safe in pregnancy\?/)
    expect(content.textContent).toBe('Is paracetamol safe in pregnancy?\nAsking for a friend.')
    expect(content).toHaveStyle({ whiteSpace: 'pre-wrap' })

    const images = within(dialog).getAllByRole('img', { name: /^Post image/ })
    expect(images.map(i => i.getAttribute('src'))).toEqual(['https://cdn.example/one.jpg', 'https://cdn.example/two.jpg'])
    const imageLink = images[0].closest('a')
    expect(imageLink).toHaveAttribute('href', 'https://cdn.example/one.jpg')
    expect(imageLink).toHaveAttribute('rel', 'noreferrer')
    expect(dialog.querySelector('video[controls]')).toHaveAttribute('aria-label', 'Post video')
    expect(dialog.querySelector('video')).toHaveAttribute('src', 'https://cdn.example/clip.mp4')
    expect(dialog.querySelector('audio[controls]')).toHaveAttribute('aria-label', 'Post audio')
    expect(within(dialog).getByText('Rating 4')).toBeInTheDocument()
    expect(within(dialog).getByText('Theme: sunrise')).toBeInTheDocument()
    expect(within(dialog).getByText('Subscribers only')).toBeInTheDocument()
  })

  it('a post without user_id says "No author recorded", asks nothing, and never renders a javascript: image', () => {
    renderSection()
    const dialog = openPost(`${'a'.repeat(100)}…`)
    expect(within(dialog).getByText('No author recorded')).toBeInTheDocument()
    expect(api.callAdminAuth).not.toHaveBeenCalled()
    expect(within(dialog).getByText(longText)).toBeInTheDocument()
    expect(within(dialog).queryByText(/Rating|Theme:|Subscribers only/)).not.toBeInTheDocument()
    expect(dialog.querySelector('video')).toBeNull()
    expect(dialog.querySelector('audio')).toBeNull()
    // The legacy image_url is used when image_urls is empty, but only an
    // http(s) URL is ever an image source or a link.
    expect(within(dialog).queryByRole('img', { name: /^Post image/ })).not.toBeInTheDocument()
    expect(dialog.querySelector('img')).toBeNull()
    expect(dialog.querySelector('a[href^="javascript"]')).toBeNull()
    expect(within(dialog).getByText('Unsupported media address')).toBeInTheDocument()
  })

  it('a non-http(s) video or audio address shows a note, never a media element', () => {
    dir.result = ok({ data: { rows: [{ ...posts[0], image_urls: ['data:image/png;base64,AAAA'], image_url: null, video_url: 'javascript:alert(1)', audio_url: 'blob:abc' }], hasNext: false, total: 1 } })
    renderSection()
    const dialog = openFirst()
    expect(dialog.querySelector('img')).toBeNull()
    expect(dialog.querySelector('video')).toBeNull()
    expect(dialog.querySelector('audio')).toBeNull()
    expect(within(within(dialog).getByRole('region', { name: 'Images' })).getByText('Unsupported media address')).toBeInTheDocument()
    expect(within(within(dialog).getByRole('region', { name: 'Video' })).getByText('Unsupported media address')).toBeInTheDocument()
    expect(within(within(dialog).getByRole('region', { name: 'Audio' })).getByText('Unsupported media address')).toBeInTheDocument()
  })

  it('a non-string post_type renders without crashing and falls back to "Post"', () => {
    dir.result = ok({ data: { rows: [{ ...posts[2], id: 'p9', post_type: 7 }], hasNext: false, total: 1 } })
    renderSection()
    // The Type cell is '—' and the drawer title falls back to 'Post'.
    expect(within(screen.getAllByRole('row')[1]).getAllByText('—').length).toBeGreaterThan(0)
    const dialog = openPost('Post')
    expect(dialog.querySelector('.adm-drawer-title')).toHaveTextContent(/^Post$/)
  })

  it('Delete post is disabled while any delete is running, and names the running one "Deleting…"', () => {
    actions.busyId = 'p2'
    const { unmount } = renderSection()
    let dialog = openFirst()
    expect(within(dialog).getByRole('button', { name: 'Delete post' })).toBeDisabled()
    unmount()

    actions.busyId = 'p1'
    renderSection()
    dialog = openFirst()
    expect(within(dialog).getByRole('button', { name: 'Deleting…' })).toBeDisabled()
  })

  it('a failed author request says "Couldn\'t load the author" and never "Unknown user"', async () => {
    api.callAdminAuth.mockRejectedValue(new Error('boom'))
    renderSection()
    const dialog = openFirst()
    expect(await within(dialog).findByText("Couldn't load the author")).toBeInTheDocument()
    expect(within(dialog).queryByText(/Unknown user/)).not.toBeInTheDocument()
  })

  it('a get_user_profile response without a profile object is a failure too', async () => {
    api.callAdminAuth.mockResolvedValue({ data: null })
    const { unmount } = renderSection()
    let dialog = openFirst()
    expect(await within(dialog).findByText("Couldn't load the author")).toBeInTheDocument()
    unmount()

    api.callAdminAuth.mockResolvedValue({ data: 'Ada' })
    renderSection()
    dialog = openFirst()
    // The same client refetches on the new mount, so this is the 'Ada' response.
    await waitFor(() => expect(api.callAdminAuth).toHaveBeenCalledTimes(2))
    expect(await within(dialog).findByText("Couldn't load the author")).toBeInTheDocument()
    expect(within(dialog).queryByText(/Unknown user/)).not.toBeInTheDocument()
  })

  it('Delete post asks first with the exact consequence, deletes only from the confirm action, and closes on success', async () => {
    renderSection()
    const dialog = openFirst()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete post' }))
    expect(admin.askConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Delete this post?', consequence: CONSEQUENCE, confirmLabel: 'Delete',
    }))
    expect(actions.deletePost).not.toHaveBeenCalled()
    await act(async () => { await admin.askConfirm.mock.calls[0][0].action() })
    expect(actions.deletePost).toHaveBeenCalledWith('p1')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(admin.showToast).not.toHaveBeenCalled()
  })

  it('a failed delete keeps the drawer open with the error inline', async () => {
    actions.deletePost.mockResolvedValue({ ok: false, error: 'Not allowed' })
    renderSection()
    openFirst()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete post' }))
    await act(async () => { await admin.askConfirm.mock.calls[0][0].action() })
    expect(actions.deletePost).toHaveBeenCalledWith('p1')
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('Not allowed')
  })

  it('a delete that ends after its drawer was closed toasts a failure and never touches another post\'s drawer', async () => {
    let resolve
    actions.deletePost.mockImplementation(() => new Promise(r => { resolve = r }))
    renderSection()
    openFirst()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete post' }))
    let pending
    act(() => { pending = admin.askConfirm.mock.calls[0][0].action() })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    const other = openPost('Post')
    await act(async () => { resolve({ ok: false, error: 'Not allowed' }); await pending })
    expect(actions.deletePost).toHaveBeenCalledWith('p1')
    expect(admin.showToast).toHaveBeenCalledWith("Couldn't delete the post: Not allowed", { type: 'error' })
    expect(screen.getByRole('dialog')).toBe(other)
    expect(within(other).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a late successful delete does not close another post\'s drawer', async () => {
    let resolve
    actions.deletePost.mockImplementation(() => new Promise(r => { resolve = r }))
    renderSection()
    openFirst()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete post' }))
    let pending
    act(() => { pending = admin.askConfirm.mock.calls[0][0].action() })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    openPost('Post')
    await act(async () => { resolve({ ok: true }); await pending })
    expect(actions.deletePost).toHaveBeenCalledWith('p1')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(admin.showToast).not.toHaveBeenCalled()
  })
})
