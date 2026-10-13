import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

const hook = vi.hoisted(() => ({ value: null, refetch: vi.fn() }))
vi.mock('../hooks/useSearchAnalytics', () => ({ useSearchAnalytics: () => ({ ...hook.value, refetch: hook.refetch }) }))

import SearchesSection from './SearchesSection.jsx'

const MARKUP = '<img src=x onerror=alert(1)>'
const row = (id, query, found, extra = {}) => ({
  id, query, found, results_count: found ? 3 : 0, category: 'pharmacy',
  profiles: { full_name: 'Ada Obi' }, ...extra,
})
const rows = [
  row('s1', 'Paracetamol', true),
  row('s2', 'insulin', false),
  row('s3', ' Insulin ', false, { profiles: null }),
  row('s4', 'amoxil', false, { profiles: { display_name: 'Bayo' } }),
]
const setHook = (v) => { hook.value = { data: rows, isLoading: false, isError: false, ...v } }
const cell = (name) => screen.getByText(name).closest('div')

beforeEach(() => {
  hook.refetch.mockReset()
  setHook({})
})

describe('SearchesSection', () => {
  it('states the window the numbers cover', () => {
    render(<SearchesSection />)
    expect(screen.getByRole('heading', { level: 1, name: 'Search Analytics' })).toBeInTheDocument()
    expect(screen.getByText(/Based on the newest 300 searches/)).toBeInTheDocument()
  })

  it('shows loading placeholders, not empty messages', () => {
    setHook({ data: undefined, isLoading: true })
    render(<SearchesSection />)
    expect(screen.getByRole('status', { name: 'Loading Searches' })).toBeInTheDocument()
    expect(screen.getAllByRole('status').length).toBeGreaterThan(2)
    expect(screen.queryByText('No searches yet')).not.toBeInTheDocument()
    expect(screen.queryByText('No unmet searches yet')).not.toBeInTheDocument()
  })

  it('shows a failed read as an error everywhere, never as empty', () => {
    setHook({ data: undefined, isError: true })
    render(<SearchesSection />)
    expect(within(cell('Searches')).getByText(/Couldn't load/)).toBeInTheDocument()
    expect(within(cell('Found nothing')).getByText(/Couldn't load/)).toBeInTheDocument()
    for (const name of ['Retry loading demand gaps', 'Retry loading top terms', 'Retry loading recent searches']) {
      fireEvent.click(screen.getByRole('button', { name }))
    }
    expect(hook.refetch).toHaveBeenCalledTimes(3)
    expect(screen.queryByText('No searches yet')).not.toBeInTheDocument()
    expect(screen.queryByText('No unmet searches yet')).not.toBeInTheDocument()
    expect(screen.queryByText('No recent searches')).not.toBeInTheDocument()
  })

  it('counts searches and searches that found nothing', () => {
    render(<SearchesSection />)
    expect(within(cell('Searches')).getByText('4')).toBeInTheDocument()
    expect(within(cell('Found nothing')).getByText('3')).toBeInTheDocument()
    expect(screen.getAllByText('last 300 searches')).toHaveLength(2)
  })

  it('lists demand gaps, most wanted first', () => {
    render(<SearchesSection />)
    const list = screen.getByRole('list', { name: 'Demand gaps' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]).getByText('insulin')).toBeInTheDocument()
    expect(within(items[0]).getByText('2× wanted')).toBeInTheDocument()
    expect(within(items[1]).getByText('1× wanted')).toBeInTheDocument()
  })

  it('caps demand gaps at 15 and top terms at 12', () => {
    setHook({ data: Array.from({ length: 20 }, (_, i) => row(`g${i}`, `term${i}`, false)) })
    render(<SearchesSection />)
    expect(within(screen.getByRole('list', { name: 'Demand gaps' })).getAllByRole('listitem')).toHaveLength(15)
    expect(within(screen.getByRole('list', { name: 'Top terms' })).getAllByRole('listitem')).toHaveLength(12)
  })

  it('ranks top terms with their counts', () => {
    render(<SearchesSection />)
    const first = within(screen.getByRole('list', { name: 'Top terms' })).getAllByRole('listitem')[0]
    expect(within(first).getByText('1')).toBeInTheDocument()
    expect(within(first).getByText('insulin')).toBeInTheDocument()
    expect(within(first).getByText('2')).toBeInTheDocument()
  })

  it('shows recent searches with category, user and a found badge', () => {
    render(<SearchesSection />)
    const items = within(screen.getByRole('list', { name: 'Recent searches' })).getAllByRole('listitem')
    expect(items).toHaveLength(4)
    expect(within(items[0]).getByText('Paracetamol')).toBeInTheDocument()
    expect(within(items[0]).getByText(/pharmacy · Ada Obi/)).toBeInTheDocument()
    expect(within(items[0]).getByText('3 found')).toBeInTheDocument()
    expect(within(items[1]).getByText('none')).toBeInTheDocument()
    expect(within(items[2]).getByText(/Guest/)).toBeInTheDocument()
    expect(within(items[3]).getByText(/Bayo/)).toBeInTheDocument()
  })

  it('shows at most 40 recent searches', () => {
    setHook({ data: Array.from({ length: 50 }, (_, i) => row(`r${i}`, `q${i}`, true)) })
    render(<SearchesSection />)
    expect(within(screen.getByRole('list', { name: 'Recent searches' })).getAllByRole('listitem')).toHaveLength(40)
  })

  it('renders query markup as inert text', () => {
    setHook({ data: [row('m1', MARKUP, false)] })
    const { container } = render(<SearchesSection />)
    expect(screen.getAllByText(MARKUP).length).toBeGreaterThan(0)
    expect(container.querySelector('img')).toBeNull()
  })

  it('uses the legacy empty messages when the read succeeded with nothing', () => {
    setHook({ data: [] })
    render(<SearchesSection />)
    expect(screen.getByText('No unmet searches yet')).toBeInTheDocument()
    expect(screen.getByText('No searches yet')).toBeInTheDocument()
    expect(screen.getByText('No recent searches')).toBeInTheDocument()
  })

  it('keeps loaded data and says so when a refresh fails', () => {
    setHook({ isError: true })
    render(<SearchesSection />)
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't refresh, showing the last loaded data.")
    fireEvent.click(screen.getByRole('button', { name: 'Retry refreshing searches' }))
    expect(hook.refetch).toHaveBeenCalled()
    expect(within(cell('Searches')).getByText('4')).toBeInTheDocument()
  })

  it('does not show the refresh note when there is no data at all', () => {
    setHook({ data: undefined, isError: true })
    render(<SearchesSection />)
    expect(screen.queryByText(/showing the last loaded data/)).not.toBeInTheDocument()
  })

  it('leaves no stray separator when a search has no category', () => {
    setHook({ data: [row('n1', 'zinc', true, { category: null })] })
    render(<SearchesSection />)
    const item = within(screen.getByRole('list', { name: 'Recent searches' })).getByRole('listitem')
    expect(within(item).getByText('Ada Obi')).toBeInTheDocument()
  })
})
