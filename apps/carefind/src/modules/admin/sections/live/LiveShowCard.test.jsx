import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Control room data per show id: { data, isLoading, isError, refetch, dataUpdatedAt }.
const control = vi.hoisted(() => ({ byShow: {}, calls: [] }))
const actions = vi.hoisted(() => ({
  busyKeys: [],
  postItem: vi.fn(), postMedia: vi.fn(), hideComment: vi.fn(), endShow: vi.fn(),
}))
const admin = vi.hoisted(() => ({ askConfirm: vi.fn(), showToast: vi.fn() }))
const stubs = vi.hoisted(() => ({ slideReturned: null, slide: null }))

vi.mock('../../hooks/useLiveControl', () => ({
  useLiveControl: (showId) => { control.calls.push(showId); return control.byShow[showId] },
}))
// The real slideContent is kept so the slide payload is the production format.
vi.mock('../../hooks/useLiveActions', async (importOriginal) => {
  const real = await importOriginal()
  return {
    slideContent: real.slideContent,
    useLiveActions: () => ({
      isBusy: (action, id) => actions.busyKeys.includes(`${action}:${id ?? ''}`),
      postItem: actions.postItem,
      postMedia: actions.postMedia,
      hideComment: actions.hideComment,
      endShow: actions.endShow,
    }),
  }
})
vi.mock('../../provider/AdminProvider.jsx', () => ({
  useAdmin: () => ({ askConfirm: admin.askConfirm, showToast: admin.showToast, confirming: false }),
}))
vi.mock('../../../../components/VoiceRecorder.jsx', () => ({
  default: ({ showId, onRecorded }) => <button type="button" onClick={() => onRecorded('https://cdn/voice.webm')}>stub voice {showId}</button>,
}))
vi.mock('../../../../components/SlideUploader.jsx', () => ({
  // SlideUploader awaits onPostSlide, so the stub keeps what it returned.
  default: ({ showId, onPostSlide }) => <button type="button" onClick={() => { const { url, num, total } = stubs.slide; stubs.slideReturned = onPostSlide(url, num, total) }}>stub slide {showId}</button>,
}))
vi.mock('../../../../components/VideoRecorder.jsx', () => ({
  default: ({ showId, onRecorded }) => <button type="button" onClick={() => onRecorded('https://cdn/cam.webm')}>stub camera {showId}</button>,
}))
vi.mock('../../../../components/VideoUploader.jsx', () => ({
  default: ({ showId, onUploaded }) => <button type="button" onClick={() => onUploaded('https://cdn/up.mp4')}>stub video upload {showId}</button>,
}))

import LiveShowCard from './LiveShowCard.jsx'

const END_CONSEQUENCE = 'This immediately ends the live broadcast for everyone watching. The show cannot be resumed once ended.'
const UPDATED_AT = new Date(2026, 9, 12, 14, 5, 9).getTime()
const show = { id: 'show-1', title: 'Malaria Awareness Live', started_at: new Date(2026, 9, 12, 13, 0, 0).toISOString() }
const otherShow = { id: 'show-2', title: 'Diabetes Q&A', started_at: new Date(2026, 9, 12, 12, 0, 0).toISOString() }

const controlData = (over = {}) => ({
  items: [
    { id: 'i1', kind: 'text', content: 'Welcome everyone' },
    { id: 'i2', kind: 'image', content: 'https://cdn/pic.jpg' },
    { id: 'i3', kind: 'voice', content: 'https://cdn/voice.webm' },
    { id: 'i4', kind: 'video', content: 'https://cdn/clip.mp4' },
    { id: 'i5', kind: 'slide', content: 'https://cdn/slide3.jpg|||3|||8' },
  ],
  comments: [
    { id: 'c1', content: 'Great show', hidden: false, profiles: { full_name: 'Ada Obi', display_name: 'ada' } },
    { id: 'c2', content: 'Spam here', hidden: true, profiles: { full_name: null, display_name: 'spammer' } },
    { id: 'c3', content: 'Anonymous hello', hidden: false, profiles: null },
  ],
  stats: { likes: 12, views: 340, shares: 7, gifts: 55 },
  ...over,
})
const loaded = (over = {}) => ({ data: controlData(), isLoading: false, isError: false, refetch: vi.fn(), dataUpdatedAt: UPDATED_AT, ...over })

const card = (title = show.title) => screen.getByRole('region', { name: `Live show ${title}` })
const draftBox = () => screen.getByLabelText('Broadcast to the audience')
const fileBox = () => screen.getByLabelText('Add image')
// While posting the button reads "Posting…".
const postButton = () => screen.getByRole('button', { name: /^(post live|posting…)$/i })
const endButton = () => screen.getByRole('button', { name: /^(end show|ending…)$/i })
const png = () => new File(['x'], 'poster.png', { type: 'image/png' })
const chooseFile = (file) => fireEvent.change(fileBox(), { target: { files: [file] } })
const click = async (el) => { await act(async () => { fireEvent.click(el) }) }

// Returns the action handed to askConfirm, after clicking End show.
const pressEnd = async () => {
  await click(endButton())
  return admin.askConfirm.mock.calls.at(-1)[0]
}

beforeEach(() => {
  control.byShow = { [show.id]: loaded() }
  control.calls = []
  stubs.slideReturned = null
  stubs.slide = { url: 'https://cdn/s.jpg', num: 2, total: 5 }
  actions.busyKeys = []
  for (const fn of [actions.postItem, actions.postMedia, actions.hideComment, actions.endShow]) {
    fn.mockReset()
    fn.mockResolvedValue({ ok: true })
  }
  admin.askConfirm.mockReset()
  admin.showToast.mockReset()
})

describe('LiveShowCard header', () => {
  it('shows the title, start time and an internal Audience link', () => {
    render(<LiveShowCard show={show} />)
    const c = card()
    expect(within(c).getByRole('heading', { name: show.title })).toBeInTheDocument()
    expect(within(c).getByText(`Started ${new Date(show.started_at).toLocaleTimeString()}`)).toBeInTheDocument()
    expect(within(c).getByRole('link', { name: /audience/i })).toHaveAttribute('href', '/live-show/show-1')
  })

  it('asks for the legacy confirmation and ends the show only once confirmed', async () => {
    render(<LiveShowCard show={show} />)
    const ask = await pressEnd()
    expect(ask).toEqual({
      title: 'End this live show?',
      consequence: END_CONSEQUENCE,
      confirmLabel: 'End Show',
      action: expect.any(Function),
    })
    expect(actions.endShow).not.toHaveBeenCalled()
    await act(async () => { await ask.action() })
    expect(actions.endShow).toHaveBeenCalledTimes(1)
    expect(actions.endShow).toHaveBeenCalledWith('show-1')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a failed end inline on the card', async () => {
    actions.endShow.mockResolvedValue({ ok: false, error: 'Server down' })
    render(<LiveShowCard show={show} />)
    const ask = await pressEnd()
    await act(async () => { await ask.action() })
    expect(within(card()).getByRole('alert')).toHaveTextContent("Couldn't end the show: Server down")
    expect(admin.showToast).not.toHaveBeenCalled()
  })

  it('toasts an end failure that arrives after the card has gone', async () => {
    let resolveEnd
    actions.endShow.mockReturnValue(new Promise(r => { resolveEnd = r }))
    const { unmount } = render(<LiveShowCard show={show} />)
    const ask = await pressEnd()
    let pending
    act(() => { pending = ask.action() })
    unmount()
    await act(async () => { resolveEnd({ ok: false, error: 'Timed out' }); await pending })
    expect(admin.showToast).toHaveBeenCalledWith("Couldn't end the show: Timed out", { type: 'error' })
  })

  it('does not animate the live dot inline (the pulse is only in the no-preference media query)', () => {
    render(<LiveShowCard show={show} />)
    const dot = card().querySelector('.adm-live-dot')
    expect(dot).not.toBeNull()
    expect(dot.style.animation).toBe('')
    expect(dot.style.animationName).toBe('')
    expect(dot).toHaveAttribute('aria-hidden', 'true')
    // CSS imports are stubbed in tests, so the stylesheet is read from disk.
    const css = readFileSync(resolve(__dirname, '../../ui/admin.css'), 'utf8')
    const rule = css.match(/@media \(prefers-reduced-motion: no-preference\) \{[^}]*\.adm-live-dot \{[^}]*animation:/)
    expect(rule).not.toBeNull()
    // The base rule itself carries no animation.
    expect(css).not.toMatch(/^\.adm-live-dot \{[^}]*animation/m)
  })
})

describe('LiveShowCard stats', () => {
  it('shows likes, views, shares, gifts in coins and the Updated stamp', () => {
    render(<LiveShowCard show={show} />)
    const strip = within(card()).getByRole('list', { name: 'Live show stats' })
    expect(within(strip).getByText('Likes').closest('li')).toHaveTextContent('12')
    expect(within(strip).getByText('Views').closest('li')).toHaveTextContent('340')
    expect(within(strip).getByText('Shares').closest('li')).toHaveTextContent('7')
    expect(within(strip).getByText('Gifts (coins)').closest('li')).toHaveTextContent('55')
    expect(within(card()).getByText('Updated 14:05:09')).toBeInTheDocument()
  })

  it('shows loading placeholders with a status, never zeros', () => {
    control.byShow[show.id] = { data: undefined, isLoading: true, isError: false, refetch: vi.fn(), dataUpdatedAt: 0 }
    render(<LiveShowCard show={show} />)
    const c = card()
    expect(within(c).getByRole('status')).toHaveTextContent('Loading the control room')
    expect(within(c).queryByText('0')).not.toBeInTheDocument()
    expect(within(c).queryByText(/^Updated/)).not.toBeInTheDocument()
    expect(within(c).queryByText('Nothing posted yet')).not.toBeInTheDocument()
    expect(within(c).queryByText('No comments yet')).not.toBeInTheDocument()
  })

  it('a failed load with no data offers Retry and shows no numbers or empty lists', async () => {
    const refetch = vi.fn()
    control.byShow[show.id] = { data: undefined, isLoading: false, isError: true, refetch, dataUpdatedAt: 0 }
    render(<LiveShowCard show={show} />)
    const c = card()
    expect(within(c).getByText("Couldn't load the control room")).toBeInTheDocument()
    expect(within(c).queryByRole('list', { name: 'Live show stats' })).not.toBeInTheDocument()
    expect(within(c).queryByText(/^\d+$/)).not.toBeInTheDocument()
    expect(within(c).queryByText(/^Updated/)).not.toBeInTheDocument()
    expect(within(c).queryByText('No comments yet')).not.toBeInTheDocument()
    expect(within(c).queryByText('Nothing posted yet')).not.toBeInTheDocument()
    expect(within(c).queryByText(/Posted \(/)).not.toBeInTheDocument()
    await click(within(c).getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalledTimes(1)
    // The composer stays usable while the control room is down.
    expect(draftBox()).toBeEnabled()
  })

  it('disables both Retry buttons and says Retrying while a refetch runs', () => {
    control.byShow[show.id] = { data: undefined, isLoading: false, isError: true, isFetching: true, refetch: vi.fn(), dataUpdatedAt: 0 }
    const { unmount } = render(<LiveShowCard show={show} />)
    expect(within(card()).getByRole('button', { name: 'Retrying…' })).toBeDisabled()
    expect(within(card()).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    unmount()
    control.byShow[show.id] = loaded({ isError: true, isFetching: true })
    render(<LiveShowCard show={show} />)
    expect(within(card()).getByRole('button', { name: 'Retrying…' })).toBeDisabled()
  })

  it('treats an absent isFetching as not fetching', () => {
    control.byShow[show.id] = loaded({ isError: true })
    expect('isFetching' in control.byShow[show.id]).toBe(false)
    render(<LiveShowCard show={show} />)
    expect(within(card()).getByRole('button', { name: 'Retry' })).toBeEnabled()
  })

  it('a failed refresh keeps the last data and the last good stamp, and warns', async () => {
    const refetch = vi.fn()
    control.byShow[show.id] = loaded({ isError: true, refetch })
    render(<LiveShowCard show={show} />)
    const c = card()
    expect(within(c).getByText("Couldn't refresh the control room")).toBeInTheDocument()
    expect(within(c).getByText('Updated 14:05:09')).toBeInTheDocument()
    expect(within(c).getByText('Likes').closest('li')).toHaveTextContent('12')
    expect(within(c).getByText('Welcome everyone')).toBeInTheDocument()
    expect(within(c).getByText('Great show')).toBeInTheDocument()
    expect(within(c).queryByText("Couldn't load the control room")).not.toBeInTheDocument()
    await click(within(c).getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })
})

describe('LiveShowCard per show', () => {
  it('two cards for two shows each show their own data', () => {
    control.byShow = {
      [show.id]: loaded(),
      [otherShow.id]: loaded({
        data: controlData({
          items: [{ id: 'j1', kind: 'text', content: 'Second show item' }],
          comments: [{ id: 'd1', content: 'Second show comment', hidden: false, profiles: { full_name: 'Bola' } }],
          stats: { likes: 901, views: 902, shares: 903, gifts: 904 },
        }),
        dataUpdatedAt: new Date(2026, 9, 12, 9, 8, 7).getTime(),
      }),
    }
    render(<><LiveShowCard show={show} /><LiveShowCard show={otherShow} /></>)
    expect(control.calls).toEqual(expect.arrayContaining(['show-1', 'show-2']))
    const one = card(show.title)
    const two = card(otherShow.title)
    expect(within(one).getByText('Welcome everyone')).toBeInTheDocument()
    expect(within(one).queryByText('Second show item')).not.toBeInTheDocument()
    expect(within(one).getByText('Likes').closest('li')).toHaveTextContent('12')
    expect(within(one).getByText('Updated 14:05:09')).toBeInTheDocument()
    expect(within(two).getByText('Second show item')).toBeInTheDocument()
    expect(within(two).getByText('Second show comment')).toBeInTheDocument()
    expect(within(two).queryByText('Welcome everyone')).not.toBeInTheDocument()
    expect(within(two).getByText('Likes').closest('li')).toHaveTextContent('901')
    expect(within(two).getByText('Updated 09:08:07')).toBeInTheDocument()
    expect(within(two).getByRole('link', { name: /audience/i })).toHaveAttribute('href', '/live-show/show-2')
  })
})

describe('LiveShowCard composer', () => {
  it('keeps Post live disabled until there is text or an image', () => {
    render(<LiveShowCard show={show} />)
    expect(postButton()).toBeDisabled()
    fireEvent.change(draftBox(), { target: { value: '   ' } })
    expect(postButton()).toBeDisabled()
    fireEvent.change(draftBox(), { target: { value: 'Hello' } })
    expect(postButton()).toBeEnabled()
    fireEvent.change(draftBox(), { target: { value: '' } })
    chooseFile(png())
    expect(postButton()).toBeEnabled()
  })

  it('shows the chosen file name and can remove it', async () => {
    render(<LiveShowCard show={show} />)
    chooseFile(png())
    expect(screen.getByText('poster.png')).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Remove image' }))
    expect(screen.queryByText('poster.png')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove image' })).not.toBeInTheDocument()
    expect(postButton()).toBeDisabled()
  })

  it('posts text and image and clears both on success', async () => {
    render(<LiveShowCard show={show} />)
    const file = png()
    fireEvent.change(draftBox(), { target: { value: 'Big news' } })
    chooseFile(file)
    await click(postButton())
    expect(actions.postItem).toHaveBeenCalledWith({ showId: 'show-1', text: 'Big news', imageFile: file })
    expect(draftBox()).toHaveValue('')
    expect(screen.queryByText('poster.png')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('clears an earlier composer error when a later post succeeds', async () => {
    actions.postItem.mockResolvedValueOnce({ ok: false, error: 'Server busy' }).mockResolvedValueOnce({ ok: true })
    render(<LiveShowCard show={show} />)
    fireEvent.change(draftBox(), { target: { value: 'Try again' } })
    await click(postButton())
    expect(screen.getByRole('alert')).toHaveTextContent('Server busy')
    // The draft was kept, so the operator just posts again.
    await click(postButton())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(draftBox()).toHaveValue('')
  })

  it('a failed image upload keeps the text and the file and shows the error', async () => {
    actions.postItem.mockResolvedValue({ ok: false, error: "Couldn't upload the image: quota" })
    render(<LiveShowCard show={show} />)
    fireEvent.change(draftBox(), { target: { value: 'Keep me' } })
    chooseFile(png())
    await click(postButton())
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't upload the image: quota")
    expect(draftBox()).toHaveValue('Keep me')
    expect(screen.getByText('poster.png')).toBeInTheDocument()
    expect(postButton()).toBeEnabled()
  })

  it('a partial failure (image already live) clears the file but keeps the text', async () => {
    actions.postItem.mockResolvedValue({ ok: false, error: 'text rejected', partial: true })
    render(<LiveShowCard show={show} />)
    fireEvent.change(draftBox(), { target: { value: 'Caption' } })
    chooseFile(png())
    await click(postButton())
    expect(screen.getByRole('alert')).toHaveTextContent('text rejected')
    expect(screen.getByRole('alert')).toHaveTextContent(/image is live/i)
    expect(draftBox()).toHaveValue('Caption')
    expect(screen.queryByText('poster.png')).not.toBeInTheDocument()
  })

  it('keeps text typed while a post was running', async () => {
    let resolvePost
    actions.postItem.mockReturnValue(new Promise(r => { resolvePost = r }))
    render(<LiveShowCard show={show} />)
    fireEvent.change(draftBox(), { target: { value: 'First' } })
    await click(postButton())
    fireEvent.change(draftBox(), { target: { value: 'First and more' } })
    await act(async () => { resolvePost({ ok: true }) })
    expect(draftBox()).toHaveValue('First and more')
  })

  it('disables Post live, the file input and Remove image while posting', () => {
    actions.busyKeys = ['postItem:show-1']
    render(<LiveShowCard show={show} />)
    fireEvent.change(draftBox(), { target: { value: 'Hello' } })
    chooseFile(png())
    expect(postButton()).toBeDisabled()
    expect(fileBox()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove image' })).toBeDisabled()
  })

  it('is not disabled by another show posting', () => {
    actions.busyKeys = ['postItem:show-2']
    render(<LiveShowCard show={show} />)
    fireEvent.change(draftBox(), { target: { value: 'Hello' } })
    expect(postButton()).toBeEnabled()
  })
})

describe('LiveShowCard shared media components', () => {
  it('posts a voice note with the exact payload', async () => {
    render(<LiveShowCard show={show} />)
    await click(screen.getByRole('button', { name: 'stub voice show-1' }))
    expect(actions.postMedia).toHaveBeenCalledWith({ showId: 'show-1', kind: 'voice', content: 'https://cdn/voice.webm' })
  })

  it('posts camera and uploaded video as kind video', async () => {
    render(<LiveShowCard show={show} />)
    await click(screen.getByRole('button', { name: 'stub camera show-1' }))
    await click(screen.getByRole('button', { name: 'stub video upload show-1' }))
    expect(actions.postMedia).toHaveBeenNthCalledWith(1, { showId: 'show-1', kind: 'video', content: 'https://cdn/cam.webm' })
    expect(actions.postMedia).toHaveBeenNthCalledWith(2, { showId: 'show-1', kind: 'video', content: 'https://cdn/up.mp4' })
  })

  it('posts a slide in the url|||page|||total format', async () => {
    render(<LiveShowCard show={show} />)
    await click(screen.getByRole('button', { name: 'stub slide show-1' }))
    expect(actions.postMedia).toHaveBeenCalledWith({ showId: 'show-1', kind: 'slide', content: 'https://cdn/s.jpg|||2|||5' })
  })

  it('returns the post promise to the shared component, settling only when the post does', async () => {
    let resolveMedia
    actions.postMedia.mockReturnValue(new Promise(r => { resolveMedia = r }))
    render(<LiveShowCard show={show} />)
    await click(screen.getByRole('button', { name: 'stub slide show-1' }))
    const returned = stubs.slideReturned
    expect(returned).toBeInstanceOf(Promise)
    let settled = false
    returned.then(() => { settled = true })
    await act(async () => {})
    expect(settled).toBe(false)
    await act(async () => { resolveMedia({ ok: false, error: 'late' }); await returned })
    expect(settled).toBe(true)
    expect(screen.getByRole('alert')).toHaveTextContent('late')
  })

  it('shows a media failure inline, naming the item, separate from the composer', async () => {
    actions.postMedia.mockResolvedValue({ ok: false, error: 'Not allowed' })
    render(<LiveShowCard show={show} />)
    await click(screen.getByRole('button', { name: 'stub voice show-1' }))
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent("Couldn't post Voice note: Not allowed")
    expect(draftBox()).toHaveValue('')
  })
})

describe('LiveShowCard media failures', () => {
  const pressSlide = (num, total = 8) => { stubs.slide = { url: `https://cdn/s${num}.jpg`, num, total }; return click(screen.getByRole('button', { name: 'stub slide show-1' })) }
  const failures = () => screen.getByRole('alert', { name: 'Media that did not post' })
  const lines = () => within(failures()).getAllByRole('listitem')

  it('keeps a failed slide visible when the next slide is posted, naming it', async () => {
    let resolveNext
    actions.postMedia
      .mockResolvedValueOnce({ ok: false, error: 'Network down' })
      .mockReturnValueOnce(new Promise(r => { resolveNext = r }))
    render(<LiveShowCard show={show} />)
    await pressSlide(3)
    expect(failures()).toHaveTextContent("Couldn't post Slide 3 of 8: Network down")
    await pressSlide(4)
    // Slide 4 is still running: slide 3's failure has not been cleared.
    expect(failures()).toHaveTextContent("Couldn't post Slide 3 of 8: Network down")
    await act(async () => { resolveNext({ ok: true }) })
    expect(lines()).toHaveLength(1)
    expect(failures()).toHaveTextContent('Slide 3 of 8')
    expect(actions.postMedia).toHaveBeenNthCalledWith(1, { showId: 'show-1', kind: 'slide', content: 'https://cdn/s3.jpg|||3|||8' })
    expect(actions.postMedia).toHaveBeenNthCalledWith(2, { showId: 'show-1', kind: 'slide', content: 'https://cdn/s4.jpg|||4|||8' })
  })

  it('removes a failure when the same item later posts', async () => {
    actions.postMedia.mockResolvedValueOnce({ ok: false, error: 'Network down' })
    render(<LiveShowCard show={show} />)
    await pressSlide(3)
    expect(failures()).toHaveTextContent('Slide 3 of 8')
    await pressSlide(3)
    expect(screen.queryByRole('alert', { name: 'Media that did not post' })).not.toBeInTheDocument()
  })

  it('shows two different failures as two lines, and Dismiss removes only its own', async () => {
    actions.postMedia
      .mockResolvedValueOnce({ ok: false, error: 'Network down' })
      .mockResolvedValueOnce({ ok: false, error: 'Too large' })
    render(<LiveShowCard show={show} />)
    await pressSlide(3)
    await click(screen.getByRole('button', { name: 'stub camera show-1' }))
    expect(lines()).toHaveLength(2)
    expect(lines()[0]).toHaveTextContent("Couldn't post Slide 3 of 8: Network down")
    expect(lines()[1]).toHaveTextContent("Couldn't post Video: Too large")
    await click(screen.getByRole('button', { name: 'Dismiss: Slide 3 of 8' }))
    expect(lines()).toHaveLength(1)
    expect(lines()[0]).toHaveTextContent("Couldn't post Video: Too large")
    await click(screen.getByRole('button', { name: 'Dismiss: Video' }))
    expect(screen.queryByRole('alert', { name: 'Media that did not post' })).not.toBeInTheDocument()
  })

  it('names the item when the post was refused as already running', async () => {
    actions.postMedia.mockResolvedValue({ ok: false, error: 'Already running' })
    render(<LiveShowCard show={show} />)
    await click(screen.getByRole('button', { name: 'stub voice show-1' }))
    expect(failures()).toHaveTextContent("Couldn't post Voice note: Already running")
  })

  it("keeps each card's failures to its own show", async () => {
    control.byShow[otherShow.id] = loaded()
    actions.postMedia.mockResolvedValue({ ok: false, error: 'Network down' })
    render(<><LiveShowCard show={show} /><LiveShowCard show={otherShow} /></>)
    await click(screen.getByRole('button', { name: 'stub voice show-1' }))
    expect(within(card(show.title)).getByRole('alert', { name: 'Media that did not post' })).toHaveTextContent('Voice note')
    expect(within(card(otherShow.title)).queryByRole('alert', { name: 'Media that did not post' })).not.toBeInTheDocument()
  })
})

describe('LiveShowCard posted items', () => {
  it('renders each kind and counts them', () => {
    render(<LiveShowCard show={show} />)
    const list = within(card()).getByRole('list', { name: 'Posted items' })
    expect(within(card()).getByText('Posted (5)')).toBeInTheDocument()
    expect(within(list).getByText('Welcome everyone')).toBeInTheDocument()
    expect(within(list).getByAltText('Posted image')).toHaveAttribute('src', 'https://cdn/pic.jpg')
    const audio = list.querySelector('audio')
    expect(audio).toHaveAttribute('src', 'https://cdn/voice.webm')
    expect(audio).toHaveAttribute('controls')
    const video = list.querySelector('video')
    expect(video).toHaveAttribute('src', 'https://cdn/clip.mp4')
    expect(video).toHaveAttribute('controls')
    expect(video).toHaveAttribute('playsinline')
    expect(within(list).getByText('Slide 3')).toBeInTheDocument()
    expect(within(list).getByAltText('Slide 3')).toHaveAttribute('src', 'https://cdn/slide3.jpg')
  })

  it('never uses a non-http(s) address as a src or href', () => {
    control.byShow[show.id] = loaded({
      data: controlData({
        items: [
          { id: 'x1', kind: 'image', content: 'javascript:alert(1)' },
          { id: 'x2', kind: 'voice', content: 'javascript:alert(2)' },
          { id: 'x3', kind: 'video', content: 'data:video/mp4;base64,AAAA' },
          { id: 'x4', kind: 'slide', content: 'javascript:alert(4)|||1|||2' },
          { id: 'x5', kind: 'text', content: '<img src=x onerror=alert(5)>' },
        ],
      }),
    })
    render(<LiveShowCard show={show} />)
    const c = card()
    for (const el of c.querySelectorAll('[src], [href]')) {
      const value = el.getAttribute('src') ?? el.getAttribute('href')
      expect(value).not.toMatch(/^\s*(javascript|data):/i)
    }
    expect(within(c).getAllByText('Unsupported media address')).toHaveLength(4)
    expect(within(c).getByText('<img src=x onerror=alert(5)>')).toBeInTheDocument()
    expect(within(c).getByText('Slide 1')).toBeInTheDocument()
  })

  it('labels a slide with no page number as "Slide", never "Slide undefined"', () => {
    control.byShow[show.id] = loaded({ data: controlData({ items: [{ id: 'm1', kind: 'slide', content: 'https://cdn/plain.jpg' }] }) })
    render(<LiveShowCard show={show} />)
    const list = within(card()).getByRole('list', { name: 'Posted items' })
    expect(within(list).getByText('Slide', { exact: true })).toBeInTheDocument()
    expect(within(list).getByAltText('Slide image')).toHaveAttribute('src', 'https://cdn/plain.jpg')
    expect(list.innerHTML).not.toMatch(/undefined/)
  })

  it('says so when nothing has been posted yet', () => {
    control.byShow[show.id] = loaded({ data: controlData({ items: [] }) })
    render(<LiveShowCard show={show} />)
    expect(within(card()).getByText('Nothing posted yet')).toBeInTheDocument()
    expect(within(card()).getByText('Posted (0)')).toBeInTheDocument()
  })
})

describe('LiveShowCard comments', () => {
  it('shows author and text, dims hidden ones and gives them no Hide', () => {
    render(<LiveShowCard show={show} />)
    const list = within(card()).getByRole('list', { name: 'Audience comments' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('Ada Obi')
    expect(items[0]).toHaveTextContent('Great show')
    expect(within(items[0]).getByRole('button', { name: /hide/i })).toBeInTheDocument()
    expect(items[1]).toHaveTextContent('spammer')
    expect(items[1]).toHaveTextContent('(hidden)')
    expect(items[1]).toHaveClass('adm-live-comment-hidden')
    expect(items[1].style.opacity).toBe('')
    expect(within(items[1]).queryByRole('button', { name: /hide/i })).not.toBeInTheDocument()
    expect(items[2]).toHaveTextContent('User')
    expect(items[2]).not.toHaveClass('adm-live-comment-hidden')
    expect(items[0]).not.toHaveTextContent('(hidden)')
    expect(items[2]).not.toHaveTextContent('(hidden)')
    const css = readFileSync(resolve(__dirname, '../../ui/admin.css'), 'utf8')
    expect(css).toMatch(/\.adm-live-comment-hidden \{[^}]*opacity: 0\.4/)
  })

  it('Hide calls hideComment with the comment id', async () => {
    render(<LiveShowCard show={show} />)
    await click(screen.getByRole('button', { name: 'Hide comment by Ada Obi' }))
    expect(actions.hideComment).toHaveBeenCalledWith('c1')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a failed hide inline', async () => {
    actions.hideComment.mockResolvedValue({ ok: false, error: 'Forbidden' })
    render(<LiveShowCard show={show} />)
    await click(screen.getByRole('button', { name: 'Hide comment by Ada Obi' }))
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't hide the comment: Forbidden")
  })

  it('disables Hide only for the comment being hidden', () => {
    actions.busyKeys = ['hideComment:c1']
    render(<LiveShowCard show={show} />)
    expect(screen.getByRole('button', { name: 'Hide comment by Ada Obi' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Hide comment by User' })).toBeEnabled()
  })

  it('says so when there are no comments yet', () => {
    control.byShow[show.id] = loaded({ data: controlData({ comments: [] }) })
    render(<LiveShowCard show={show} />)
    expect(within(card()).getByText('No comments yet')).toBeInTheDocument()
  })
})

describe('LiveShowCard busy', () => {
  it('disables End show while it is ending', () => {
    actions.busyKeys = ['endShow:show-1']
    render(<LiveShowCard show={show} />)
    expect(endButton()).toBeDisabled()
  })

  it('disables every acting control while all actions run', () => {
    actions.busyKeys = ['endShow:show-1', 'postItem:show-1', 'hideComment:c1', 'hideComment:c3']
    render(<LiveShowCard show={show} />)
    fireEvent.change(draftBox(), { target: { value: 'Hello' } })
    expect(endButton()).toBeDisabled()
    expect(postButton()).toBeDisabled()
    expect(fileBox()).toBeDisabled()
    for (const b of screen.getAllByRole('button', { name: /^hide comment/i })) expect(b).toBeDisabled()
  })
})
