import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'

// `confirming` is true while the admin's confirmation dialog is open on top.
const admin = vi.hoisted(() => ({ confirming: false }))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => admin }))

import DirectoryTable from './DirectoryTable.jsx'

const people = [
  { id: 'u1', name: 'Ada', email: 'ada@x.test' },
  { id: 'u2', name: 'Bayo', email: 'bayo@x.test' },
  { id: 'u3', name: 'Chi', email: 'chi@x.test' },
]
const columns = [{ key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }]
const ok = (over = {}) => ({
  data: { rows: people, hasNext: true, total: 4218 },
  isLoading: false, isError: false, isPlaceholderData: false, refetch: vi.fn(), ...over,
})

function setup(over = {}) {
  const props = {
    title: 'Users', noun: 'user', query: ok(), columns, search: '', onSearch: vi.fn(),
    searchPlaceholder: 'Search users', filters: <span>filter row</span>, filtersActive: false,
    onClear: vi.fn(), page: 1, onPage: vi.fn(), pageSize: 25,
    renderDrawer: (r) => ({ body: <p>Details for {r.name}</p>, footer: <button>Do thing</button> }),
    rowLabel: r => r.name,
    ...over,
  }
  return { props, ...render(<DirectoryTable {...props} />) }
}

beforeEach(() => { admin.confirming = false })
afterEach(() => { vi.useRealTimers() })

describe('DirectoryTable', () => {
  it('has one h1, renders rows, and shows the total or a shown count', () => {
    const { props, rerender } = setup()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(screen.getByText('4218 users')).toBeInTheDocument()
    rerender(<DirectoryTable {...props} query={ok({ data: { rows: people, hasNext: false, total: null } })} />)
    expect(screen.getByText('3 shown')).toBeInTheDocument()
  })

  it('does not keep the previous total on screen while a new query loads', () => {
    setup({ query: ok({ isPlaceholderData: true }) })
    expect(screen.queryByText('4218 users')).not.toBeInTheDocument()
    expect(screen.queryByText(/shown/)).not.toBeInTheDocument()
  })

  it('has a labelled search box that calls onSearch once, 300 ms after typing stops', () => {
    vi.useFakeTimers()
    const { props } = setup()
    const box = screen.getByRole('textbox', { name: 'Search users' })
    fireEvent.change(box, { target: { value: 'a' } })
    act(() => { vi.advanceTimersByTime(100) })
    fireEvent.change(box, { target: { value: 'ad' } })
    act(() => { vi.advanceTimersByTime(100) })
    fireEvent.change(box, { target: { value: ' ada ' } })
    act(() => { vi.advanceTimersByTime(299) })
    expect(props.onSearch).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(props.onSearch).toHaveBeenCalledTimes(1)
    expect(props.onSearch).toHaveBeenCalledWith('ada')
  })

  it('does not call onSearch when the trimmed text equals the search prop', () => {
    vi.useFakeTimers()
    const { props } = setup({ search: 'ada' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Search users' }), { target: { value: 'ada ' } })
    act(() => { vi.advanceTimersByTime(400) })
    expect(props.onSearch).not.toHaveBeenCalled()
  })

  it('clears the box, without searching again, when search is reset from outside', () => {
    vi.useFakeTimers()
    const { props, rerender } = setup({ search: 'ada' })
    const box = screen.getByRole('textbox', { name: 'Search users' })
    expect(box).toHaveValue('ada')
    rerender(<DirectoryTable {...props} search="" />)
    expect(box).toHaveValue('')
    act(() => { vi.advanceTimersByTime(400) })
    expect(props.onSearch).not.toHaveBeenCalled()
  })

  it('shows a Retry, never an empty message, when the list failed', () => {
    const query = ok({ isError: true, data: undefined })
    setup({ query })
    expect(screen.queryByText(/No users match/)).not.toBeInTheDocument()
    expect(screen.queryByText(/No users yet/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(query.refetch).toHaveBeenCalled()
  })

  it('says no users match, with Clear filters, when filtered and empty; "No users yet" otherwise', () => {
    const empty = ok({ data: { rows: [], hasNext: false, total: 0 } })
    const { props, rerender } = setup({ query: empty, filtersActive: true })
    expect(screen.getByText('No users match these filters')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(props.onClear).toHaveBeenCalled()
    rerender(<DirectoryTable {...props} filtersActive={false} />)
    expect(screen.getByText('No users yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
  })

  it('shows no count and no empty text while loading', () => {
    setup({ query: ok({ isLoading: true, data: undefined }) })
    expect(screen.queryByText(/users$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/shown/)).not.toBeInTheDocument()
    expect(screen.queryByText(/No users/)).not.toBeInTheDocument()
  })

  it('disables Previous on the first page and Next without hasNext, and pages otherwise', () => {
    const { props, rerender } = setup({ page: 0, query: ok({ data: { rows: people, hasNext: false, total: 3 } }) })
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    rerender(<DirectoryTable {...props} page={2} query={ok()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(props.onPage).toHaveBeenLastCalledWith(1)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(props.onPage).toHaveBeenLastCalledWith(3)
  })

  it('opens the drawer from the Review button with the renderDrawer content, and Close closes it', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Review Ada' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Details for Ada')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Do thing' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes the drawer when its row leaves the page', () => {
    const { props, rerender } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Review Ada' }))
    rerender(<DirectoryTable {...props} query={ok({ data: { rows: people.slice(1), hasNext: true, total: 4217 } })} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Escape closes the drawer, but not while a confirmation is open on top', () => {
    const { props, rerender } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Review Ada' }))
    admin.confirming = true
    rerender(<DirectoryTable {...props} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    admin.confirming = false
    rerender(<DirectoryTable {...props} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('uses the title and status renderDrawer returns', () => {
    setup({ renderDrawer: (r) => ({ title: `Account of ${r.name}`, status: 'approved', body: <p>x</p> }) })
    fireEvent.click(screen.getByRole('button', { name: 'Review Ada' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Account of Ada')).toBeInTheDocument()
    expect(within(dialog).getByText(/approved/i)).toBeInTheDocument()
  })
})
