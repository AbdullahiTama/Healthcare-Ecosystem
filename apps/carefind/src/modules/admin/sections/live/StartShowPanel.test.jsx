import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'

const actions = vi.hoisted(() => ({ busyKeys: [], startShow: vi.fn(), scheduleShow: vi.fn() }))
const admin = vi.hoisted(() => ({ askConfirm: vi.fn(), showToast: vi.fn() }))
const search = vi.hoisted(() => ({ terms: [], result: {} }))

vi.mock('../../hooks/useLiveActions', () => ({
  useLiveActions: () => ({
    isBusy: (action, id) => actions.busyKeys.includes(`${action}:${id ?? ''}`),
    startShow: actions.startShow,
    scheduleShow: actions.scheduleShow,
  }),
}))
vi.mock('../../hooks/useGuestSearch', () => ({
  useGuestSearch: (term) => { search.terms.push(term); return search.result },
}))
vi.mock('../../provider/AdminProvider.jsx', () => ({
  useAdmin: () => ({ askConfirm: admin.askConfirm, showToast: admin.showToast }),
}))

import StartShowPanel from './StartShowPanel.jsx'

const ada = { id: 'u1', full_name: 'Ada Obi', display_name: 'ada' }
const bola = { id: 'u2', full_name: null, display_name: 'bola' }
const nameless = { id: 'u3', full_name: null, display_name: null }
const found = (data) => ({ data, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() })

const titleBox = () => screen.getByLabelText('Show title')
const dateBox = () => screen.getByLabelText('Date and time')
const trailerBox = () => screen.getByLabelText('Add trailer video (optional)')
const goLive = () => screen.getByRole('button', { name: /^(go live now|starting…)$/i })
const schedule = () => screen.getByRole('button', { name: /^(schedule show|scheduling…)$/i })
const type = (el, value) => fireEvent.change(el, { target: { value } })
const click = async (el) => { await act(async () => { fireEvent.click(el) }) }
const lastAsk = () => admin.askConfirm.mock.calls.at(-1)[0]
const video = () => new File(['x'], 'trailer.mp4', { type: 'video/mp4' })

beforeEach(() => {
  actions.busyKeys = []
  actions.startShow.mockReset().mockResolvedValue({ ok: true })
  actions.scheduleShow.mockReset().mockResolvedValue({ ok: true })
  admin.askConfirm.mockReset()
  admin.showToast.mockReset()
  search.terms = []
  search.result = found([ada, bola, nameless])
})

describe('StartShowPanel go live', () => {
  it('disables both buttons while the title is blank', () => {
    render(<StartShowPanel liveCount={0} />)
    expect(goLive()).toBeDisabled()
    expect(schedule()).toBeDisabled()
    type(titleBox(), '   ')
    expect(goLive()).toBeDisabled()
    type(titleBox(), 'Malaria Live')
    expect(goLive()).toBeEnabled()
    expect(schedule()).toBeDisabled() // still needs a date
  })

  it('asks the exact confirmation with no other live show', async () => {
    render(<StartShowPanel liveCount={0} />)
    type(titleBox(), 'Malaria Live')
    await click(goLive())
    expect(lastAsk()).toEqual({
      title: 'Go live now?',
      consequence: 'This starts a live show that every CareFind user will see. It stays live until you end it.',
      confirmLabel: 'Go live',
      action: expect.any(Function),
    })
    expect(actions.startShow).not.toHaveBeenCalled()
  })

  it('mentions one other live show, and several', async () => {
    const { rerender } = render(<StartShowPanel liveCount={1} />)
    type(titleBox(), 'Malaria Live')
    await click(goLive())
    expect(lastAsk().consequence).toContain('1 other show is already live')
    rerender(<StartShowPanel liveCount={3} />)
    await click(goLive())
    expect(lastAsk().consequence).toContain('3 other shows are already live')
  })

  it('starts with the selected guest ids only after confirm, then clears the form', async () => {
    render(<StartShowPanel liveCount={0} />)
    type(titleBox(), 'Malaria Live')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ada Obi' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'bola' }))
    await click(goLive())
    expect(actions.startShow).not.toHaveBeenCalled()
    await act(async () => { await lastAsk().action() })
    expect(actions.startShow).toHaveBeenCalledWith({ title: 'Malaria Live', guestIds: ['u1', 'u2'] })
    expect(titleBox()).toHaveValue('')
    expect(screen.getByText('Selected guests (0)')).toBeInTheDocument()
  })

  it('keeps everything and shows the error when starting fails', async () => {
    actions.startShow.mockResolvedValue({ ok: false, error: 'server down' })
    render(<StartShowPanel liveCount={0} />)
    type(titleBox(), 'Malaria Live')
    type(dateBox(), '2026-11-03T18:30')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ada Obi' }))
    await click(goLive())
    await act(async () => { await lastAsk().action() })
    expect(within(screen.getByRole('group', { name: 'Go live' })).getByRole('alert')).toHaveTextContent("Couldn't start the show: server down")
    expect(titleBox()).toHaveValue('Malaria Live')
    expect(dateBox()).toHaveValue('2026-11-03T18:30')
    expect(screen.getByText('Selected guests (1)')).toBeInTheDocument()
  })

  it('disables the buttons while an action runs', () => {
    actions.busyKeys = ['startShow:']
    render(<StartShowPanel liveCount={0} />)
    type(titleBox(), 'x')
    type(dateBox(), '2026-11-03T18:30')
    expect(goLive()).toBeDisabled()
    expect(schedule()).toBeDisabled()
  })
})

describe('StartShowPanel schedule', () => {
  it('sends the legacy datetime-local string with the file and guests, then clears everything', async () => {
    render(<StartShowPanel liveCount={0} />)
    type(titleBox(), '  Heart Night ')
    type(dateBox(), '2026-11-03T18:30')
    const file = video()
    fireEvent.change(trailerBox(), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ada Obi' }))
    expect(schedule()).toBeEnabled()
    await click(schedule())
    expect(actions.scheduleShow).toHaveBeenCalledWith({
      title: '  Heart Night ', scheduledAt: '2026-11-03T18:30', trailerFile: file, guestIds: ['u1'],
    })
    expect(titleBox()).toHaveValue('')
    expect(dateBox()).toHaveValue('')
    expect(screen.queryByText('trailer.mp4')).toBeNull()
    expect(screen.getByText('Selected guests (0)')).toBeInTheDocument()
  })

  it('keeps title, guests, date and trailer when scheduling fails', async () => {
    actions.scheduleShow.mockResolvedValue({ ok: false, error: "Couldn't upload the trailer: too big" })
    render(<StartShowPanel liveCount={0} />)
    type(titleBox(), 'Heart Night')
    type(dateBox(), '2026-11-03T18:30')
    fireEvent.change(trailerBox(), { target: { files: [video()] } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ada Obi' }))
    await click(schedule())
    expect(within(screen.getByRole('form', { name: 'Schedule a show' })).getByRole('alert')).toHaveTextContent("Couldn't schedule the show: Couldn't upload the trailer: too big")
    expect(titleBox()).toHaveValue('Heart Night')
    expect(dateBox()).toHaveValue('2026-11-03T18:30')
    expect(screen.getByText('trailer.mp4')).toBeInTheDocument()
    expect(screen.getByText('Selected guests (1)')).toBeInTheDocument()
  })

  it('disables Schedule while scheduleShow runs', () => {
    actions.busyKeys = ['scheduleShow:']
    render(<StartShowPanel liveCount={0} />)
    type(titleBox(), 'x')
    type(dateBox(), '2026-11-03T18:30')
    expect(schedule()).toBeDisabled()
  })
})

describe('StartShowPanel guests', () => {
  it('lists users with an initial and a safe name, never "undefined"', () => {
    const { container } = render(<StartShowPanel liveCount={0} />)
    const list = screen.getByRole('list', { name: 'Search results' })
    expect(within(list).getByRole('checkbox', { name: 'Ada Obi' })).toBeInTheDocument()
    expect(within(list).getByRole('checkbox', { name: 'bola' })).toBeInTheDocument()
    expect(within(list).getByRole('checkbox', { name: 'User' })).toBeInTheDocument()
    expect(within(list).getByText('A')).toBeInTheDocument()
    expect(within(list).getByText('?')).toBeInTheDocument()
    expect(container.textContent).not.toContain('undefined')
  })

  it('selects and removes a guest, and sends the typed search to the hook', () => {
    render(<StartShowPanel liveCount={0} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ada Obi' }))
    const picked = screen.getByRole('list', { name: 'Selected guests' })
    expect(within(picked).getByText('Ada Obi')).toBeInTheDocument()
    fireEvent.click(within(picked).getByRole('button', { name: 'Remove Ada Obi' }))
    expect(screen.getByText('Selected guests (0)')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Ada Obi' })).not.toBeChecked()
    type(screen.getByLabelText('Search users by name…'), 'ada')
    expect(search.terms.at(-1)).toBe('ada')
  })

  it('shows at most 20 results', () => {
    search.result = found(Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, full_name: `Person ${i}` })))
    render(<StartShowPanel liveCount={0} />)
    expect(screen.getAllByRole('checkbox')).toHaveLength(20)
  })

  it('says "No users found" for an empty successful search', () => {
    search.result = found([])
    render(<StartShowPanel liveCount={0} />)
    expect(screen.getByText('No users found')).toBeInTheDocument()
  })

  it('shows a failed search with Retry, never "No users"', () => {
    const refetch = vi.fn()
    search.result = { data: undefined, isLoading: false, isError: true, isFetching: false, refetch }
    render(<StartShowPanel liveCount={0} />)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't search users")
    expect(screen.queryByText(/no users/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('shows a loading state while searching for the first time', () => {
    search.result = { data: undefined, isLoading: true, isError: false, isFetching: true, refetch: vi.fn() }
    render(<StartShowPanel liveCount={0} />)
    expect(screen.getByRole('status')).toHaveTextContent('Searching users…')
  })
})

describe('StartShowPanel polish', () => {
  it('disables the guest search, checkboxes and remove buttons while busy', () => {
    const { rerender } = render(<StartShowPanel liveCount={0} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ada Obi' }))
    actions.busyKeys = ['scheduleShow:']
    rerender(<StartShowPanel liveCount={0} />)
    expect(screen.getByLabelText('Search users by name…')).toBeDisabled()
    screen.getAllByRole('checkbox').forEach(c => expect(c).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Remove Ada Obi' })).toBeDisabled()
  })

  it('shows each failure in its own region and clears both on a new attempt', async () => {
    actions.startShow.mockResolvedValueOnce({ ok: false, error: 'live down' })
    actions.scheduleShow.mockResolvedValueOnce({ ok: false, error: 'sched down' })
    render(<StartShowPanel liveCount={0} />)
    type(titleBox(), 'Show')
    type(dateBox(), '2026-11-03T18:30')
    const liveRegion = screen.getByRole('group', { name: 'Go live' })
    const formRegion = screen.getByRole('form', { name: 'Schedule a show' })
    await click(goLive())
    await act(async () => { await lastAsk().action() })
    expect(within(liveRegion).getByRole('alert')).toHaveTextContent('live down')
    expect(within(formRegion).queryByRole('alert')).toBeNull()
    await click(schedule())
    expect(within(formRegion).getByRole('alert')).toHaveTextContent('sched down')
    expect(within(liveRegion).queryByRole('alert')).toBeNull()
  })

  it('clears a visible schedule error when a go-live attempt starts', async () => {
    actions.scheduleShow.mockResolvedValueOnce({ ok: false, error: 'sched down' })
    actions.startShow.mockResolvedValueOnce({ ok: false, error: 'live down' })
    render(<StartShowPanel liveCount={0} />)
    type(titleBox(), 'Show')
    type(dateBox(), '2026-11-03T18:30')
    const liveRegion = screen.getByRole('group', { name: 'Go live' })
    const formRegion = screen.getByRole('form', { name: 'Schedule a show' })
    await click(schedule())
    expect(within(formRegion).getByRole('alert')).toHaveTextContent('sched down')
    await click(goLive())
    await act(async () => { await lastAsk().action() })
    expect(within(formRegion).queryByRole('alert')).toBeNull()
    expect(within(liveRegion).getByRole('alert')).toHaveTextContent('live down')
  })

  it('toasts a failure that resolves after unmount', async () => {
    let finishStart
    actions.startShow.mockReturnValue(new Promise(r => { finishStart = r }))
    const { unmount } = render(<StartShowPanel liveCount={0} />)
    type(titleBox(), 'Show')
    await click(goLive())
    const pending = lastAsk().action()
    unmount()
    await act(async () => { finishStart({ ok: false, error: 'late' }); await pending })
    expect(admin.showToast).toHaveBeenCalledWith("Couldn't start the show: late", { type: 'error' })
  })

  it('keeps earlier results and offers Retry when a refresh fails', () => {
    const refetch = vi.fn()
    search.result = { data: [ada], isLoading: false, isError: true, isFetching: false, refetch }
    render(<StartShowPanel liveCount={0} />)
    expect(screen.getByRole('checkbox', { name: 'Ada Obi' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't refresh the search")
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalled()
  })
})
