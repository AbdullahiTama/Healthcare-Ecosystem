import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

const actions = vi.hoisted(() => ({ busyKeys: [], startScheduled: vi.fn(), cancelScheduled: vi.fn() }))
const admin = vi.hoisted(() => ({ askConfirm: vi.fn(), showToast: vi.fn() }))

vi.mock('../../hooks/useLiveActions', () => ({
  useLiveActions: () => ({
    isBusy: (action, id) => actions.busyKeys.includes(`${action}:${id ?? ''}`),
    startScheduled: actions.startScheduled,
    cancelScheduled: actions.cancelScheduled,
  }),
}))
vi.mock('../../provider/AdminProvider.jsx', () => ({
  useAdmin: () => ({ askConfirm: admin.askConfirm, showToast: admin.showToast }),
}))

import ScheduledShowCard from './ScheduledShowCard.jsx'

const show = { id: 'sch-1', title: 'Heart Health Night', scheduled_at: new Date(2026, 10, 3, 18, 30).toISOString(), trailer_url: 'https://cdn/trailer.mp4' }
const click = async (el) => { await act(async () => { fireEvent.click(el) }) }
const startBtn = () => screen.getByRole('button', { name: /^(start now|starting…)$/i })
const cancelBtn = () => screen.getByRole('button', { name: /^(cancel|cancelling…)$/i })
const lastAsk = () => admin.askConfirm.mock.calls.at(-1)[0]

beforeEach(() => {
  actions.busyKeys = []
  actions.startScheduled.mockReset().mockResolvedValue({ ok: true })
  actions.cancelScheduled.mockReset().mockResolvedValue({ ok: true })
  admin.askConfirm.mockReset()
  admin.showToast.mockReset()
})

describe('ScheduledShowCard', () => {
  it('shows the title, local time and a preview link', () => {
    render(<ScheduledShowCard show={show} />)
    expect(screen.getByRole('heading', { name: show.title })).toBeInTheDocument()
    expect(screen.getByText(new Date(show.scheduled_at).toLocaleString())).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /preview/i })).toHaveAttribute('href', '/live-show/sch-1')
  })

  it('asks the exact Start now confirmation and starts only once confirmed', async () => {
    render(<ScheduledShowCard show={show} />)
    await click(startBtn())
    expect(lastAsk()).toEqual({
      title: 'Start this show now?',
      consequence: 'This starts the show now and shows the LIVE indicator to every CareFind user.',
      confirmLabel: 'Start now',
      action: expect.any(Function),
    })
    expect(actions.startScheduled).not.toHaveBeenCalled()
    await act(async () => { await lastAsk().action() })
    expect(actions.startScheduled).toHaveBeenCalledWith('sch-1')
  })

  it('asks the exact Cancel confirmation and cancels only once confirmed', async () => {
    render(<ScheduledShowCard show={show} />)
    await click(cancelBtn())
    expect(lastAsk()).toEqual({
      title: 'Cancel this scheduled show?',
      consequence: 'This cancels the scheduled show and removes its countdown from the audience view. Invited guests will need to be re-added if you reschedule it.',
      confirmLabel: 'Cancel Show',
      action: expect.any(Function),
    })
    expect(actions.cancelScheduled).not.toHaveBeenCalled()
    await act(async () => { await lastAsk().action() })
    expect(actions.cancelScheduled).toHaveBeenCalledWith('sch-1')
  })

  it('renders the trailer only for an http(s) address', () => {
    const { container, rerender } = render(<ScheduledShowCard show={show} />)
    expect(container.querySelector('video')).toHaveAttribute('src', 'https://cdn/trailer.mp4')
    rerender(<ScheduledShowCard show={{ ...show, trailer_url: 'javascript:alert(1)' }} />)
    expect(container.querySelector('video')).toBeNull()
    expect(container.innerHTML).not.toContain('javascript:')
    rerender(<ScheduledShowCard show={{ ...show, trailer_url: null }} />)
    expect(container.querySelector('video')).toBeNull()
  })

  it('shows a failed start inline and a failed cancel inline', async () => {
    actions.startScheduled.mockResolvedValue({ ok: false, error: 'boom' })
    actions.cancelScheduled.mockResolvedValue({ ok: false, error: 'nope' })
    render(<ScheduledShowCard show={show} />)
    await click(startBtn())
    await act(async () => { await lastAsk().action() })
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't start the show: boom")
    await click(cancelBtn())
    await act(async () => { await lastAsk().action() })
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't cancel the show: nope")
  })

  it('disables both buttons while either action runs', () => {
    actions.busyKeys = ['startScheduled:sch-1']
    render(<ScheduledShowCard show={show} />)
    expect(startBtn()).toBeDisabled()
    expect(cancelBtn()).toBeDisabled()
  })

  it('is not disabled by another show being busy', () => {
    actions.busyKeys = ['startScheduled:other']
    render(<ScheduledShowCard show={show} />)
    expect(startBtn()).toBeEnabled()
  })

  it('toasts a failure that resolves after unmount', async () => {
    let finish
    actions.startScheduled.mockReturnValue(new Promise(r => { finish = r }))
    const { unmount } = render(<ScheduledShowCard show={show} />)
    await click(startBtn())
    const pending = lastAsk().action()
    unmount()
    await act(async () => { finish({ ok: false, error: 'late' }); await pending })
    expect(admin.showToast).toHaveBeenCalledWith("Couldn't start the show: late", { type: 'error' })
  })
})
