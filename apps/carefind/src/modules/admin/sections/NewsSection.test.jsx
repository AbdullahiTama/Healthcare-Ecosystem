import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'

// The shape useNewsList (a react-query result) really has: data is
// { items, phones } once loaded; a failed read leaves data undefined with
// isError true.
const lists = vi.hoisted(() => ({ result: null }))
const actions = vi.hoisted(() => ({ busyId: null, approveNews: vi.fn(), rejectNews: vi.fn(), deleteNews: vi.fn() }))
const admin = vi.hoisted(() => ({ askConfirm: vi.fn(), showToast: vi.fn(), confirming: false }))
vi.mock('../hooks/useContentLists', () => ({ useNewsList: () => lists.result }))
vi.mock('../hooks/useNewsActions', () => ({ useNewsActions: () => actions }))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => admin }))

import NewsSection, { columns } from './NewsSection.jsx'

const REJECT_TITLE = 'Reject this news item?'
const REJECT_CONSEQUENCE = 'The item is marked as rejected and is not published. It stays in the list under All.'
const DELETE_TITLE = 'Permanently delete this news item?'
const DELETE_CONSEQUENCE = 'This permanently removes the news item from the app. This cannot be undone.'

const item = (over = {}) => ({
  id: 'n1', status: 'pending', author_id: 'u1',
  headline: 'Clinic opens in Ikeja', subtitle: 'A new 24-hour clinic', body: 'Line one\nLine two {with} [brackets] "quoted"',
  hero_image_url: 'https://cdn.example.com/hero.jpg',
  contact_phone: '+234 801 234 5678', contact_email: 'ada@example.com',
  profiles: { full_name: 'Ada Obi', display_name: 'ada' },
  created_at: new Date().toISOString(),
  ...over,
})

const items = () => [
  item(),
  item({ id: 'n2', headline: 'Pharmacy hours change', subtitle: null, body: 'Short body', hero_image_url: null, contact_phone: null, contact_email: null, author_id: 'u2', profiles: { full_name: null, display_name: 'Bayo' } }),
  item({ id: 'n3', status: 'approved', headline: 'Free screening day', author_id: 'u3', profiles: { full_name: 'Chika Eze' } }),
  item({ id: 'n4', status: 'rejected', headline: 'Spam submission', contact_phone: null, contact_email: null, hero_image_url: null, author_id: 'u4', profiles: null }),
]

const loaded = (over = {}) => ({ data: { items: items(), phones: { u2: '08099990000' } }, isLoading: false, isError: false, refetch: vi.fn(), ...over })
const openReview = (headline) => fireEvent.click(screen.getByRole('button', { name: `Review ${headline}` }))
const dialog = () => within(screen.getByRole('dialog'))
const approveButton = () => dialog().getByRole('button', { name: 'Approve and publish' })
const showAll = () => fireEvent.click(screen.getByRole('tab', { name: /All/ }))
const type = (label, value) => fireEvent.change(dialog().getByLabelText(label), { target: { value } })

beforeEach(() => {
  lists.result = loaded()
  actions.busyId = null
  actions.approveNews.mockReset()
  actions.approveNews.mockResolvedValue({ ok: true })
  actions.rejectNews.mockReset()
  actions.rejectNews.mockResolvedValue({ ok: true })
  actions.deleteNews.mockReset()
  actions.deleteNews.mockResolvedValue({ ok: true })
  admin.askConfirm.mockReset()
  admin.showToast.mockReset()
})

describe('NewsSection', () => {
  it('lists pending items by default, and All shows approved and rejected ones', () => {
    render(<NewsSection />)
    expect(screen.getByRole('heading', { level: 1, name: 'News' })).toBeInTheDocument()
    expect(screen.getByText('Clinic opens in Ikeja')).toBeInTheDocument()
    expect(screen.getByText('Pharmacy hours change')).toBeInTheDocument()
    expect(screen.queryByText('Free screening day')).not.toBeInTheDocument()
    expect(screen.queryByText('Spam submission')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Pending (2)' })).toBeInTheDocument()
    showAll()
    expect(screen.getByText('Free screening day')).toBeInTheDocument()
    expect(screen.getByText('Spam submission')).toBeInTheDocument()
  })

  it('shows the headline, submitter, status badge and submitted columns, with Submitted not sortable', () => {
    render(<NewsSection />)
    expect(columns.map(c => c.label)).toEqual(['Headline', 'Submitted by', 'Status', 'Submitted'])
    // Sorting would only reorder the 60 rows the server returned (finding 44).
    expect(columns.find(c => c.label === 'Submitted').sortable).toBeFalsy()
    expect(screen.getByText('Ada Obi')).toBeInTheDocument()
    expect(screen.getByText('Bayo')).toBeInTheDocument()
    showAll()
    expect(screen.getByText('Chika Eze')).toBeInTheDocument()
    expect(screen.getByText('User')).toBeInTheDocument()
    expect(screen.getAllByText('Just now').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/approved/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/rejected/i).length).toBeGreaterThan(0)
  })

  it('says the server returns at most 60 items when the list is at the cap', () => {
    const many = Array.from({ length: 60 }, (_, i) => item({ id: `m${i}`, headline: `Item ${i}` }))
    lists.result = loaded({ data: { items: many, phones: {} } })
    render(<NewsSection />)
    expect(screen.getByText('The server returns at most 60 items, so there may be older items not shown.')).toBeInTheDocument()
  })

  it('shows the full body as plain text, the hero image, and the subtitle in the drawer', () => {
    render(<NewsSection />)
    openReview('Clinic opens in Ikeja')
    const body = dialog().getByText(/Line one/)
    expect(body.textContent).toBe('Line one\nLine two {with} [brackets] "quoted"')
    expect(body).toHaveStyle({ whiteSpace: 'pre-wrap' })
    expect(dialog().getByText('A new 24-hour clinic')).toBeInTheDocument()
    expect(dialog().getByRole('img', { name: 'News image' })).toHaveAttribute('src', 'https://cdn.example.com/hero.jpg')
  })

  it('never renders a hero image whose URL is not http(s)', () => {
    lists.result = loaded({ data: { items: [item({ hero_image_url: 'javascript:alert(1)' })], phones: {} } })
    render(<NewsSection />)
    openReview('Clinic opens in Ikeja')
    expect(dialog().queryByRole('img')).not.toBeInTheDocument()
    expect(document.querySelector('[src^="javascript"]')).toBeNull()
  })

  it('renders body markup as text, never as HTML', () => {
    lists.result = loaded({ data: { items: [item({ body: '<img src=x onerror="alert(1)">' })], phones: {} } })
    render(<NewsSection />)
    openReview('Clinic opens in Ikeja')
    expect(dialog().getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument()
    expect(document.querySelector('img[src="x"]')).toBeNull()
  })

  it('shows the contact block with tel: and mailto: links built from encoded values', () => {
    render(<NewsSection />)
    openReview('Clinic opens in Ikeja')
    const contact = within(dialog().getByRole('region', { name: 'Contact the submitter' }))
    const call = contact.getByRole('link', { name: 'Call +234 801 234 5678' })
    expect(call).toHaveAttribute('href', `tel:${encodeURIComponent('+234 801 234 5678')}`)
    const mail = contact.getByRole('link', { name: 'Email ada@example.com' })
    expect(mail).toHaveAttribute('href', `mailto:${encodeURIComponent('ada@example.com')}`)
  })

  it('falls back to the phone from the submitter verification when the item has no contact phone', () => {
    render(<NewsSection />)
    openReview('Pharmacy hours change')
    const contact = within(dialog().getByRole('region', { name: 'Contact the submitter' }))
    expect(contact.getByRole('link', { name: 'Call 08099990000' })).toHaveAttribute('href', 'tel:08099990000')
    expect(contact.queryByRole('link', { name: /^Email/ })).not.toBeInTheDocument()
  })

  it('shows no contact block when there is no phone or email', () => {
    render(<NewsSection />)
    showAll()
    openReview('Spam submission')
    expect(dialog().queryByRole('region', { name: 'Contact the submitter' })).not.toBeInTheDocument()
  })

  it('approves without edits with the item values and edited: false, and closes on success', async () => {
    render(<NewsSection />)
    openReview('Clinic opens in Ikeja')
    await act(async () => { fireEvent.click(approveButton()) })
    expect(admin.askConfirm).not.toHaveBeenCalled()
    expect(actions.approveNews).toHaveBeenCalledTimes(1)
    expect(actions.approveNews).toHaveBeenCalledWith({
      id: 'n1', headline: 'Clinic opens in Ikeja', subtitle: 'A new 24-hour clinic',
      body: 'Line one\nLine two {with} [brackets] "quoted"', edited: false,
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('reveals Headline, Subtitle and Body inputs pre-filled with the current values', () => {
    render(<NewsSection />)
    openReview('Clinic opens in Ikeja')
    expect(dialog().queryByLabelText(/Headline/)).not.toBeInTheDocument()
    fireEvent.click(dialog().getByRole('button', { name: 'Edit' }))
    expect(dialog().getByLabelText(/Headline/)).toHaveValue('Clinic opens in Ikeja')
    expect(dialog().getByLabelText(/Headline/)).toBeRequired()
    expect(dialog().getByLabelText('Subtitle')).toHaveValue('A new 24-hour clinic')
    expect(dialog().getByLabelText('Body')).toHaveValue('Line one\nLine two {with} [brackets] "quoted"')
  })

  it('sends the edited values with edited: true after editing', async () => {
    render(<NewsSection />)
    openReview('Clinic opens in Ikeja')
    fireEvent.click(dialog().getByRole('button', { name: 'Edit' }))
    type(/Headline/, 'Clinic opens in Ikeja on Monday')
    type('Body', 'Rewritten body')
    await act(async () => { fireEvent.click(approveButton()) })
    expect(actions.approveNews).toHaveBeenCalledWith({
      id: 'n1', headline: 'Clinic opens in Ikeja on Monday', subtitle: 'A new 24-hour clinic',
      body: 'Rewritten body', edited: true,
    })
  })

  it('keeps an untouched empty subtitle as it was when another field was edited', async () => {
    render(<NewsSection />)
    openReview('Pharmacy hours change')
    fireEvent.click(dialog().getByRole('button', { name: 'Edit' }))
    type(/Headline/, 'Pharmacy hours change from today')
    await act(async () => { fireEvent.click(approveButton()) })
    expect(actions.approveNews).toHaveBeenCalledWith({
      id: 'n2', headline: 'Pharmacy hours change from today', subtitle: null, body: 'Short body', edited: true,
    })
  })

  it('sends edited: false when Edit was opened but nothing changed', async () => {
    render(<NewsSection />)
    openReview('Clinic opens in Ikeja')
    fireEvent.click(dialog().getByRole('button', { name: 'Edit' }))
    type(/Headline/, 'Something else')
    type(/Headline/, 'Clinic opens in Ikeja')
    await act(async () => { fireEvent.click(approveButton()) })
    expect(actions.approveNews).toHaveBeenCalledWith({
      id: 'n1', headline: 'Clinic opens in Ikeja', subtitle: 'A new 24-hour clinic',
      body: 'Line one\nLine two {with} [brackets] "quoted"', edited: false,
    })
  })

  it('discards the edits on Cancel edit', async () => {
    render(<NewsSection />)
    openReview('Clinic opens in Ikeja')
    fireEvent.click(dialog().getByRole('button', { name: 'Edit' }))
    type(/Headline/, 'Changed')
    fireEvent.click(dialog().getByRole('button', { name: 'Cancel edit' }))
    expect(dialog().queryByLabelText(/Headline/)).not.toBeInTheDocument()
    await act(async () => { fireEvent.click(approveButton()) })
    expect(actions.approveNews).toHaveBeenCalledWith(expect.objectContaining({ headline: 'Clinic opens in Ikeja', edited: false }))
  })

  it('does not carry edits over to another item, or to the same item reopened', () => {
    render(<NewsSection />)
    openReview('Clinic opens in Ikeja')
    fireEvent.click(dialog().getByRole('button', { name: 'Edit' }))
    type(/Headline/, 'Changed')
    fireEvent.click(dialog().getByRole('button', { name: 'Close' }))
    openReview('Pharmacy hours change')
    expect(dialog().queryByLabelText(/Headline/)).not.toBeInTheDocument()
    fireEvent.click(dialog().getByRole('button', { name: 'Close' }))
    openReview('Clinic opens in Ikeja')
    expect(dialog().queryByLabelText(/Headline/)).not.toBeInTheDocument()
  })

  it('disables Approve while the edited headline is blank', () => {
    render(<NewsSection />)
    openReview('Clinic opens in Ikeja')
    fireEvent.click(dialog().getByRole('button', { name: 'Edit' }))
    type(/Headline/, '   ')
    expect(approveButton()).toBeDisabled()
    fireEvent.click(approveButton())
    expect(actions.approveNews).not.toHaveBeenCalled()
    type(/Headline/, 'Back')
    expect(approveButton()).toBeEnabled()
  })

  it('asks for confirmation before rejecting and rejects only when it is confirmed', async () => {
    render(<NewsSection />)
    openReview('Clinic opens in Ikeja')
    fireEvent.click(dialog().getByRole('button', { name: 'Reject' }))
    expect(admin.askConfirm).toHaveBeenCalledTimes(1)
    const call = admin.askConfirm.mock.calls[0][0]
    expect(call).toEqual(expect.objectContaining({ title: REJECT_TITLE, consequence: REJECT_CONSEQUENCE, confirmLabel: 'Reject' }))
    expect(actions.rejectNews).not.toHaveBeenCalled()
    await act(async () => { await call.action() })
    expect(actions.rejectNews).toHaveBeenCalledWith('n1')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('asks for confirmation before deleting and deletes only when it is confirmed', async () => {
    render(<NewsSection />)
    openReview('Clinic opens in Ikeja')
    fireEvent.click(dialog().getByRole('button', { name: 'Delete' }))
    expect(admin.askConfirm).toHaveBeenCalledTimes(1)
    const call = admin.askConfirm.mock.calls[0][0]
    expect(call).toEqual(expect.objectContaining({ title: DELETE_TITLE, consequence: DELETE_CONSEQUENCE, confirmLabel: 'Delete' }))
    expect(actions.deleteNews).not.toHaveBeenCalled()
    await act(async () => { await call.action() })
    expect(actions.deleteNews).toHaveBeenCalledWith('n1')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps the drawer open with the prefixed error when approving fails, and keeps the edits', async () => {
    actions.approveNews.mockResolvedValue({ ok: false, error: 'Server said no' })
    render(<NewsSection />)
    openReview('Clinic opens in Ikeja')
    fireEvent.click(dialog().getByRole('button', { name: 'Edit' }))
    type(/Headline/, 'Edited headline')
    await act(async () => { fireEvent.click(approveButton()) })
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't approve the news item: Server said no")
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(dialog().getByLabelText(/Headline/)).toHaveValue('Edited headline')
    expect(admin.showToast).not.toHaveBeenCalled()
  })

  it('keeps the drawer open with the prefixed error when rejecting fails', async () => {
    actions.rejectNews.mockResolvedValue({ ok: false, error: 'Network down' })
    render(<NewsSection />)
    openReview('Clinic opens in Ikeja')
    fireEvent.click(dialog().getByRole('button', { name: 'Reject' }))
    await act(async () => { await admin.askConfirm.mock.calls[0][0].action() })
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't reject the news item: Network down")
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('keeps the drawer open with the prefixed error when deleting fails', async () => {
    actions.deleteNews.mockResolvedValue({ ok: false, error: 'Network down' })
    render(<NewsSection />)
    openReview('Clinic opens in Ikeja')
    fireEvent.click(dialog().getByRole('button', { name: 'Delete' }))
    await act(async () => { await admin.askConfirm.mock.calls[0][0].action() })
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't delete the news item: Network down")
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('disables every footer button, Edit and the edit inputs while an action is running', () => {
    const { rerender } = render(<NewsSection />)
    openReview('Clinic opens in Ikeja')
    fireEvent.click(dialog().getByRole('button', { name: 'Edit' }))
    actions.busyId = 'n1'
    rerender(<NewsSection />)
    expect(approveButton()).toBeDisabled()
    expect(dialog().getByRole('button', { name: 'Reject' })).toBeDisabled()
    expect(dialog().getByRole('button', { name: 'Delete' })).toBeDisabled()
    expect(dialog().getByRole('button', { name: 'Cancel edit' })).toBeDisabled()
    expect(dialog().getByLabelText(/Headline/)).toBeDisabled()
    expect(dialog().getByLabelText('Subtitle')).toBeDisabled()
    expect(dialog().getByLabelText('Body')).toBeDisabled()
  })

  it('disables the buttons even when the running action is for another item', () => {
    actions.busyId = 'n2'
    render(<NewsSection />)
    openReview('Clinic opens in Ikeja')
    expect(approveButton()).toBeDisabled()
    expect(dialog().getByRole('button', { name: 'Reject' })).toBeDisabled()
    expect(dialog().getByRole('button', { name: 'Delete' })).toBeDisabled()
    expect(dialog().getByRole('button', { name: 'Edit' })).toBeDisabled()
  })

  it('offers no Edit, Approve or Reject for decided items, but keeps Delete', () => {
    render(<NewsSection />)
    showAll()
    for (const headline of ['Free screening day', 'Spam submission']) {
      openReview(headline)
      expect(dialog().queryByRole('button', { name: 'Approve and publish' })).not.toBeInTheDocument()
      expect(dialog().queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
      expect(dialog().queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
      expect(dialog().getByRole('button', { name: 'Delete' })).toBeInTheDocument()
      fireEvent.click(dialog().getByRole('button', { name: 'Close' }))
    }
  })

  // The confirm closes before the action runs, so the admin can move on while
  // the server works. A late result must not land on another drawer.
  const startRejectThenOpenOther = () => {
    let resolve
    actions.rejectNews.mockImplementation(() => new Promise(r => { resolve = r }))
    render(<NewsSection />)
    openReview('Clinic opens in Ikeja')
    fireEvent.click(dialog().getByRole('button', { name: 'Reject' }))
    let pending
    act(() => { pending = admin.askConfirm.mock.calls[0][0].action() })
    fireEvent.click(dialog().getByRole('button', { name: 'Close' }))
    openReview('Pharmacy hours change')
    return async (result) => { await act(async () => { resolve(result); await pending }) }
  }

  it('toasts a late failure for an item whose drawer is no longer shown', async () => {
    const finish = startRejectThenOpenOther()
    await finish({ ok: false, error: 'Network down' })
    expect(screen.getByRole('dialog')).toHaveTextContent('Pharmacy hours change')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(admin.showToast).toHaveBeenCalledTimes(1)
    expect(admin.showToast).toHaveBeenCalledWith("Couldn't reject the news item: Network down", { type: 'error' })
  })

  it('leaves another open drawer alone when a late action succeeds', async () => {
    const finish = startRejectThenOpenOther()
    await finish({ ok: true })
    expect(screen.getByRole('dialog')).toHaveTextContent('Pharmacy hours change')
    expect(admin.showToast).not.toHaveBeenCalled()
  })

  it('toasts a late delete failure that arrives after the drawer was closed', async () => {
    let resolve
    actions.deleteNews.mockImplementation(() => new Promise(r => { resolve = r }))
    render(<NewsSection />)
    openReview('Clinic opens in Ikeja')
    fireEvent.click(dialog().getByRole('button', { name: 'Delete' }))
    let pending
    act(() => { pending = admin.askConfirm.mock.calls[0][0].action() })
    fireEvent.click(dialog().getByRole('button', { name: 'Close' }))
    await act(async () => { resolve({ ok: false, error: 'Gone' }); await pending })
    expect(admin.showToast).toHaveBeenCalledWith("Couldn't delete the news item: Gone", { type: 'error' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows Retry, and neither empty message, when the list failed', () => {
    const refetch = vi.fn()
    lists.result = loaded({ data: undefined, isError: true, refetch })
    render(<NewsSection />)
    expect(screen.queryByText('Nothing pending')).not.toBeInTheDocument()
    showAll()
    expect(screen.queryByText('No news submissions yet')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(refetch).toHaveBeenCalled()
  })

  it('treats a finished query with no data as failed, not empty', () => {
    lists.result = loaded({ data: undefined })
    render(<NewsSection />)
    expect(screen.queryByText('Nothing pending')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('shows neither Retry nor an empty message while loading', () => {
    lists.result = loaded({ data: undefined, isLoading: true })
    render(<NewsSection />)
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Nothing pending')).not.toBeInTheDocument()
    expect(screen.queryByText('No news submissions yet')).not.toBeInTheDocument()
  })

  it('says nothing is pending, and All says there are no submissions yet, when the list is empty', () => {
    lists.result = loaded({ data: { items: [], phones: {} } })
    render(<NewsSection />)
    expect(screen.getByText('Nothing pending')).toBeInTheDocument()
    showAll()
    expect(screen.getByText('No news submissions yet')).toBeInTheDocument()
  })
})
