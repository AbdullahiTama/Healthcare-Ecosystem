import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

const shows = vi.hoisted(() => ({ result: null, panelProps: [] }))

vi.mock('../hooks/useLiveShows', () => ({ useLiveShows: () => shows.result }))
vi.mock('./live/LiveShowCard.jsx', () => ({
  default: ({ show }) => <div data-testid="live-card" data-id={show.id}>{show.title}</div>,
}))
vi.mock('./live/ScheduledShowCard.jsx', () => ({
  default: ({ show }) => <div data-testid="scheduled-card" data-id={show.id}>{show.title}</div>,
}))
vi.mock('./live/StartShowPanel.jsx', () => ({
  default: (props) => { shows.panelProps.push(props); return <div data-testid="start-panel">start panel</div> },
}))

import GoLiveSection from './GoLiveSection.jsx'

const ok = (data) => ({ status: 'ok', data })
const failed = { status: 'error' }
const result = (active, scheduled, over = {}) => ({ data: { active, scheduled }, isLoading: false, isError: false, refetch: vi.fn(), ...over })

beforeEach(() => {
  shows.panelProps = []
  shows.result = result(ok([]), ok([]))
})

describe('GoLiveSection', () => {
  it('has one h1 with the subtitle and always renders the start panel', () => {
    render(<GoLiveSection />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Go Live')
    expect(screen.getByText('Manage live shows on CareFind')).toBeInTheDocument()
    expect(screen.getByTestId('start-panel')).toBeInTheDocument()
  })

  it('shows both empty texts when both sources loaded empty', () => {
    render(<GoLiveSection />)
    expect(screen.getByText('No live shows right now')).toBeInTheDocument()
    expect(screen.getByText('No scheduled shows')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Currently live (0)' })).toBeInTheDocument()
  })

  it('renders one card per show with its own id, and passes liveCount to the panel', () => {
    shows.result = result(
      ok([{ id: 'a1', title: 'Show A' }, { id: 'a2', title: 'Show B' }]),
      ok([{ id: 's1', title: 'Later' }]),
    )
    render(<GoLiveSection />)
    expect(screen.getAllByTestId('live-card').map(el => el.dataset.id)).toEqual(['a1', 'a2'])
    expect(screen.getAllByTestId('scheduled-card').map(el => el.dataset.id)).toEqual(['s1'])
    expect(screen.getByRole('heading', { name: 'Currently live (2)' })).toBeInTheDocument()
    expect(shows.panelProps.at(-1)).toEqual({ liveCount: 2 })
    expect(screen.queryByText('No live shows right now')).toBeNull()
  })

  it('shows a failed active source with Retry, never the empty text, and passes an unknown liveCount', () => {
    shows.result = result(failed, ok([]))
    render(<GoLiveSection />)
    const region = screen.getByRole('region', { name: /Currently live/ })
    expect(within(region).getByRole('alert')).toHaveTextContent("Couldn't load live shows")
    expect(screen.queryByText('No live shows right now')).toBeNull()
    expect(screen.getByText('No scheduled shows')).toBeInTheDocument()
    expect(shows.panelProps.at(-1)).toEqual({ liveCount: null })
    fireEvent.click(within(region).getByRole('button', { name: 'Retry loading live shows' }))
    expect(shows.result.refetch).toHaveBeenCalledTimes(1)
  })

  it('shows a failed scheduled source with Retry, never the empty text', () => {
    shows.result = result(ok([{ id: 'a1', title: 'Show A' }]), failed)
    render(<GoLiveSection />)
    const region = screen.getByRole('region', { name: 'Scheduled shows' })
    expect(within(region).getByRole('alert')).toHaveTextContent("Couldn't load scheduled shows")
    expect(screen.queryByText('No scheduled shows')).toBeNull()
    expect(screen.getAllByTestId('live-card')).toHaveLength(1)
    fireEvent.click(within(region).getByRole('button', { name: 'Retry loading scheduled shows' }))
    expect(shows.result.refetch).toHaveBeenCalledTimes(1)
  })

  it('shows a loading placeholder, not the empty texts, before the first load', () => {
    shows.result = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() }
    render(<GoLiveSection />)
    expect(screen.getAllByRole('status')).toHaveLength(2)
    expect(screen.queryByText('No live shows right now')).toBeNull()
    expect(screen.queryByText('No scheduled shows')).toBeNull()
    expect(screen.getByTestId('start-panel')).toBeInTheDocument()
    expect(shows.panelProps.at(-1)).toEqual({ liveCount: null })
  })

  it('treats a failed whole query as failed on both lists', () => {
    shows.result = { data: undefined, isLoading: false, isError: true, refetch: vi.fn() }
    render(<GoLiveSection />)
    expect(screen.getAllByRole('alert')).toHaveLength(2)
    expect(screen.queryByText(/^No /)).toBeNull()
  })

  it('keeps the live cards on screen with a retry warning when a refresh of the live list failed', () => {
    shows.result = result({ status: 'ok', data: [{ id: 'a1', title: 'Show A' }], stale: true }, ok([]))
    render(<GoLiveSection />)
    const region = screen.getByRole('region', { name: /Currently live/ })
    expect(within(region).getByRole('alert')).toHaveTextContent("Couldn't refresh live shows")
    expect(screen.getAllByTestId('live-card')).toHaveLength(1)
    expect(screen.queryByText('No live shows right now')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Currently live (1)' })).toBeInTheDocument()
    expect(shows.panelProps.at(-1)).toEqual({ liveCount: null })
    fireEvent.click(within(region).getByRole('button', { name: 'Retry refreshing live shows' }))
    expect(shows.result.refetch).toHaveBeenCalledTimes(1)
  })

  it('keeps the scheduled cards on screen with a retry warning when a refresh failed', () => {
    shows.result = result(ok([]), { status: 'ok', data: [{ id: 's1', title: 'Later' }], stale: true })
    render(<GoLiveSection />)
    const region = screen.getByRole('region', { name: 'Scheduled shows' })
    expect(within(region).getByRole('alert')).toHaveTextContent("Couldn't refresh scheduled shows")
    expect(screen.getAllByTestId('scheduled-card')).toHaveLength(1)
    expect(screen.queryByText('No scheduled shows')).toBeNull()
    fireEvent.click(within(region).getByRole('button', { name: 'Retry refreshing scheduled shows' }))
    expect(shows.result.refetch).toHaveBeenCalledTimes(1)
  })

  it('a stale empty live list still warns with Retry beside the empty text', () => {
    shows.result = result({ status: 'ok', data: [], stale: true }, ok([]))
    render(<GoLiveSection />)
    const region = screen.getByRole('region', { name: /Currently live/ })
    expect(within(region).getByRole('alert')).toHaveTextContent("Couldn't refresh live shows")
    fireEvent.click(within(region).getByRole('button', { name: 'Retry refreshing live shows' }))
    expect(shows.result.refetch).toHaveBeenCalledTimes(1)
  })

  it('a stale empty scheduled list still warns with Retry beside the empty text', () => {
    shows.result = result(ok([]), { status: 'ok', data: [], stale: true })
    render(<GoLiveSection />)
    const region = screen.getByRole('region', { name: 'Scheduled shows' })
    expect(within(region).getByRole('alert')).toHaveTextContent("Couldn't refresh scheduled shows")
    fireEvent.click(within(region).getByRole('button', { name: 'Retry refreshing scheduled shows' }))
    expect(shows.result.refetch).toHaveBeenCalledTimes(1)
  })

  it('passes an unknown liveCount while the live list is stale, even when it is empty', () => {
    shows.result = result({ status: 'ok', data: [], stale: true }, ok([]))
    render(<GoLiveSection />)
    expect(shows.panelProps.at(-1)).toEqual({ liveCount: null })
  })
})
