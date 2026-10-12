import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react'

const lists = vi.hoisted(() => ({ result: null }))
const actions = vi.hoisted(() => ({ busy: false, createStory: vi.fn(), deleteStory: vi.fn() }))
const admin = vi.hoisted(() => ({ askConfirm: vi.fn(), showToast: vi.fn() }))

vi.mock('../hooks/useContentLists', () => ({ useStoriesList: () => lists.result }))
vi.mock('../hooks/useContentActions', () => ({
  useContentActions: () => ({ busy: actions.busy, createStory: actions.createStory, deleteStory: actions.deleteStory }),
}))
vi.mock('../provider/AdminProvider.jsx', () => ({
  useAdmin: () => ({ askConfirm: admin.askConfirm, showToast: admin.showToast }),
}))

import StoriesSection from './StoriesSection.jsx'

const hour = 3600000
const stories = [
  { id: 's1', title: 'New feature', body: 'We shipped a thing', image_url: 'https://cdn.example/s1.jpg', bg_color: 'var(--color-primary)', created_at: new Date(Date.now() - 2 * hour).toISOString(), expires_at: new Date(Date.now() + 22 * hour).toISOString() },
  { id: 's2', title: '', body: 'Body only story', image_url: 'javascript:alert(1)', bg_color: 'var(--color-purple)', created_at: new Date(Date.now() - 30 * hour).toISOString(), expires_at: new Date(Date.now() - 6 * hour).toISOString() },
]
const loaded = (over = {}) => ({ data: stories, isLoading: false, isError: false, refetch: vi.fn(), ...over })
const PRESETS = ['Teal', 'Dark Teal', 'Purple', 'Rose', 'Orange', 'Blue']
const CONSEQUENCE = 'This permanently removes the story from the feed. This cannot be undone.'

const titleBox = () => screen.getByLabelText('Story Title')
const bodyBox = () => screen.getByLabelText('Story Message')
const fileBox = () => screen.getByLabelText('Image (optional)')
const publish = () => screen.getByRole('button', { name: /^publish/i })
const png = () => new File(['x'], 'cover.png', { type: 'image/png' })
const chooseFile = async (file) => {
  fireEvent.change(fileBox(), { target: { files: [file] } })
  await screen.findByAltText('Selected image preview')
}
const submit = async () => { await act(async () => { fireEvent.click(publish()) }) }

beforeEach(() => {
  lists.result = loaded()
  actions.busy = false
  actions.createStory.mockReset()
  actions.createStory.mockResolvedValue({ ok: true })
  actions.deleteStory.mockReset()
  actions.deleteStory.mockResolvedValue({ ok: true })
  admin.askConfirm.mockReset()
  admin.showToast.mockReset()
})

describe('StoriesSection', () => {
  it('shows the heading, subtitle and the create panel', () => {
    render(<StoriesSection />)
    expect(screen.getByRole('heading', { level: 1, name: 'Stories' })).toBeInTheDocument()
    expect(screen.getByText('Manage stories that appear at the top of the feed')).toBeInTheDocument()
    expect(screen.getByText('Post a Story')).toBeInTheDocument()
    expect(screen.getByText('Stories auto-expire after 24 hours')).toBeInTheDocument()
    expect(titleBox()).toBeInTheDocument()
    expect(bodyBox()).toBeInTheDocument()
  })

  it('keeps Publish disabled until there is a title, a message or an image', async () => {
    render(<StoriesSection />)
    expect(publish()).toBeDisabled()
    fireEvent.change(titleBox(), { target: { value: '   ' } })
    expect(publish()).toBeDisabled()
    fireEvent.change(titleBox(), { target: { value: 'Hi' } })
    expect(publish()).toBeEnabled()
    fireEvent.change(titleBox(), { target: { value: '' } })
    fireEvent.change(bodyBox(), { target: { value: 'Message' } })
    expect(publish()).toBeEnabled()
    fireEvent.change(bodyBox(), { target: { value: '' } })
    expect(publish()).toBeDisabled()
    await chooseFile(png())
    expect(publish()).toBeEnabled()
  })

  it('offers the six colour presets with Teal selected by default', () => {
    render(<StoriesSection />)
    const group = screen.getByRole('group', { name: 'Background Color' })
    const buttons = within(group).getAllByRole('button')
    expect(buttons.map(b => b.getAttribute('aria-label'))).toEqual(PRESETS)
    expect(screen.getByRole('button', { name: 'Teal' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Purple' }))
    expect(screen.getByRole('button', { name: 'Purple' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Teal' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('creates with trimmed values and clears the form on success', async () => {
    render(<StoriesSection />)
    const file = png()
    fireEvent.change(titleBox(), { target: { value: '  Big news  ' } })
    fireEvent.change(bodyBox(), { target: { value: ' Read this ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rose' }))
    await chooseFile(file)
    await submit()
    expect(actions.createStory).toHaveBeenCalledTimes(1)
    expect(actions.createStory).toHaveBeenCalledWith({ title: 'Big news', body: 'Read this', bgColor: 'var(--color-danger)', imageFile: file })
    await waitFor(() => expect(titleBox()).toHaveValue(''))
    expect(bodyBox()).toHaveValue('')
    expect(fileBox().files).toHaveLength(0)
    expect(screen.queryByAltText('Selected image preview')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Teal' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the error and keeps every field and the file when the create fails', async () => {
    actions.createStory.mockResolvedValue({ ok: false, error: "Couldn't upload the image: too large" })
    render(<StoriesSection />)
    const file = png()
    fireEvent.change(titleBox(), { target: { value: 'Big news' } })
    fireEvent.change(bodyBox(), { target: { value: 'Read this' } })
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }))
    await chooseFile(file)
    await submit()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Couldn't upload the image: too large")
    expect(titleBox()).toHaveValue('Big news')
    expect(bodyBox()).toHaveValue('Read this')
    expect(screen.getByRole('button', { name: 'Blue' })).toHaveAttribute('aria-pressed', 'true')
    expect(fileBox().files[0]).toBe(file)
    expect(screen.getByAltText('Selected image preview')).toBeInTheDocument()
    expect(screen.getByText('cover.png')).toBeInTheDocument()
    // While the screen is shown the failure is inline only, never toasted.
    expect(admin.showToast).not.toHaveBeenCalled()
    // the admin can retry with the same file
    actions.createStory.mockResolvedValue({ ok: true })
    await submit()
    expect(actions.createStory).toHaveBeenLastCalledWith({ title: 'Big news', body: 'Read this', bgColor: 'var(--color-info)', imageFile: file })
    await waitFor(() => expect(titleBox()).toHaveValue(''))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('removes the chosen image with Remove image', async () => {
    render(<StoriesSection />)
    await chooseFile(png())
    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }))
    expect(screen.queryByAltText('Selected image preview')).not.toBeInTheDocument()
    expect(fileBox().files).toHaveLength(0)
    expect(publish()).toBeDisabled()
  })

  it('disables every control while busy', async () => {
    const view = render(<StoriesSection />)
    await chooseFile(png())
    fireEvent.change(titleBox(), { target: { value: 'Hi' } })
    actions.busy = true
    view.rerender(<StoriesSection />)
    expect(titleBox()).toBeDisabled()
    expect(bodyBox()).toBeDisabled()
    expect(fileBox()).toBeDisabled()
    for (const name of PRESETS) expect(screen.getByRole('button', { name })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove image' })).toBeDisabled()
    expect(publish()).toBeDisabled()
    const deletes = screen.getAllByRole('button', { name: /^Delete story/ })
    expect(deletes).toHaveLength(2)
    for (const b of deletes) expect(b).toBeDisabled()
  })

  it('lists the stories with title, excerpt, thumbnail and age', () => {
    render(<StoriesSection />)
    expect(screen.getByText('New feature')).toBeInTheDocument()
    expect(screen.getByText('We shipped a thing')).toBeInTheDocument()
    expect(screen.getByText('Body only story')).toBeInTheDocument()
    expect(screen.getByText(/2h ago/)).toBeInTheDocument()
    expect(screen.getByText(/Expired/)).toBeInTheDocument()
    const imgs = document.querySelectorAll('li img')
    expect(imgs).toHaveLength(1)
    expect(imgs[0]).toHaveAttribute('src', 'https://cdn.example/s1.jpg')
  })

  it('asks for confirmation with the legacy text and deletes only after it is confirmed', async () => {
    render(<StoriesSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete story New feature' }))
    expect(actions.deleteStory).not.toHaveBeenCalled()
    expect(admin.askConfirm).toHaveBeenCalledTimes(1)
    const arg = admin.askConfirm.mock.calls[0][0]
    expect(arg).toMatchObject({ title: 'Delete this story?', consequence: CONSEQUENCE, confirmLabel: 'Delete' })
    await act(async () => { await arg.action() })
    expect(actions.deleteStory).toHaveBeenCalledWith('s1')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a failed delete inline on that story only', async () => {
    actions.deleteStory.mockResolvedValue({ ok: false, error: 'Forbidden' })
    render(<StoriesSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete story New feature' }))
    await act(async () => { await admin.askConfirm.mock.calls[0][0].action() })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent("Couldn't delete the story: Forbidden")
    expect(screen.getByText('New feature').closest('li')).toContainElement(alert)
    expect(admin.showToast).not.toHaveBeenCalled()
  })

  it('shows a loading status while the list loads', () => {
    lists.result = loaded({ data: undefined, isLoading: true })
    render(<StoriesSection />)
    expect(screen.getByRole('status')).toHaveTextContent(/loading stories/i)
    expect(screen.queryByText('No stories yet')).not.toBeInTheDocument()
  })

  it('shows Retry, never the empty text, when the list failed', () => {
    const refetch = vi.fn()
    lists.result = loaded({ data: undefined, isError: true, refetch })
    render(<StoriesSection />)
    expect(screen.getByText("Couldn't load stories")).toBeInTheDocument()
    expect(screen.queryByText('No stories yet')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('shows the empty text when there are no stories', () => {
    lists.result = loaded({ data: [] })
    render(<StoriesSection />)
    expect(screen.getByText('No stories yet')).toBeInTheDocument()
  })

  it('renders story text as text, never as markup', () => {
    lists.result = loaded({ data: [{ id: 'x', title: '<b>bold</b>', body: '<img src=x onerror=alert(1)>', created_at: new Date().toISOString() }] })
    render(<StoriesSection />)
    expect(screen.getByText('<b>bold</b>')).toBeInTheDocument()
    expect(document.querySelector('li b')).toBeNull()
    expect(document.querySelector('li img')).toBeNull()
  })

  // A create or delete can end after the admin has left this tab. The form
  // and the rows are gone then, so a failure is toasted instead of dropped.
  describe('a result that arrives after the screen unmounted', () => {
    it('toasts a failed create', async () => {
      let resolve
      actions.createStory.mockImplementation(() => new Promise(r => { resolve = r }))
      const view = render(<StoriesSection />)
      fireEvent.change(titleBox(), { target: { value: 'Big news' } })
      act(() => { fireEvent.click(publish()) })
      const pending = actions.createStory.mock.results[0].value
      view.unmount()
      await act(async () => { resolve({ ok: false, error: 'Server down' }); await pending })
      expect(admin.showToast).toHaveBeenCalledTimes(1)
      expect(admin.showToast).toHaveBeenCalledWith("Couldn't create the story: Server down", { type: 'error' })
    })

    it('toasts a failed delete', async () => {
      let resolve
      actions.deleteStory.mockImplementation(() => new Promise(r => { resolve = r }))
      const view = render(<StoriesSection />)
      fireEvent.click(screen.getByRole('button', { name: 'Delete story New feature' }))
      let pending
      act(() => { pending = admin.askConfirm.mock.calls[0][0].action() })
      view.unmount()
      await act(async () => { resolve({ ok: false, error: 'Forbidden' }); await pending })
      expect(admin.showToast).toHaveBeenCalledTimes(1)
      expect(admin.showToast).toHaveBeenCalledWith("Couldn't delete the story: Forbidden", { type: 'error' })
    })

    it('adds nothing to a late success (the hook has toasted it)', async () => {
      let resolveCreate
      let resolveDelete
      actions.createStory.mockImplementation(() => new Promise(r => { resolveCreate = r }))
      actions.deleteStory.mockImplementation(() => new Promise(r => { resolveDelete = r }))
      const view = render(<StoriesSection />)
      fireEvent.change(titleBox(), { target: { value: 'Big news' } })
      act(() => { fireEvent.click(publish()) })
      const created = actions.createStory.mock.results[0].value
      fireEvent.click(screen.getByRole('button', { name: 'Delete story New feature' }))
      let deleted
      act(() => { deleted = admin.askConfirm.mock.calls[0][0].action() })
      view.unmount()
      await act(async () => { resolveCreate({ ok: true }); resolveDelete({ ok: true }); await created; await deleted })
      expect(admin.showToast).not.toHaveBeenCalled()
    })
  })
})
