import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// `confirming` is true while the admin's confirmation dialog is open on top.
const admin = vi.hoisted(() => ({ confirming: false }))
vi.mock('../provider/AdminProvider.jsx', () => ({ useAdmin: () => admin }))

import ReviewQueue from './ReviewQueue.jsx'

const rows = [
  { id: 'a', name: 'Amina', status: 'pending' },
  { id: 'b', name: 'Bola', status: 'approved' },
]
const columns = [{ key: 'name', label: 'Name' }, { key: 'status', label: 'Status' }]

function setup(over = {}) {
  const props = {
    title: 'Verification', source: { status: 'ok', data: rows }, onRetry: vi.fn(), columns,
    isOpen: r => r.status === 'pending', nothingWaiting: 'Nothing waiting', noneYet: 'No requests yet',
    drawerTitle: r => r.name,
    renderDrawer: (r) => ({ body: <p>Details for {r.name}</p>, footer: <button>Approve</button> }),
    ...over,
  }
  return { props, ...render(<ReviewQueue {...props} />) }
}

beforeEach(() => { admin.confirming = false })

describe('ReviewQueue', () => {
  it('has one h1 and defaults to the pending rows', () => {
    setup()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByText('Amina')).toBeInTheDocument()
    expect(screen.queryByText('Bola')).not.toBeInTheDocument()
  })

  it('All shows every row', () => {
    setup()
    fireEvent.click(screen.getByRole('tab', { name: /All/ }))
    expect(screen.getByText('Bola')).toBeInTheDocument()
  })

  it('shows a Retry, not an empty message, when the source failed', () => {
    const { props } = setup({ source: { status: 'error' } })
    expect(screen.queryByText('Nothing waiting')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(props.onRetry).toHaveBeenCalled()
  })

  it('says nothing is waiting only when the source loaded and no row is open', () => {
    setup({ source: { status: 'ok', data: [rows[1]] } })
    expect(screen.getByText('Nothing waiting')).toBeInTheDocument()
  })

  it('says none yet under All when the list is empty', () => {
    setup({ source: { status: 'ok', data: [] } })
    fireEvent.click(screen.getByRole('tab', { name: /All/ }))
    expect(screen.getByText('No requests yet')).toBeInTheDocument()
  })

  it('shows N+ and a note when the list reaches the server cap', () => {
    setup({ cap: 2 })
    expect(screen.getAllByText(/2\+/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/may be older items/i)).toBeInTheDocument()
  })

  it('opens the drawer from the Review button and closes it', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Review Amina' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Details for Amina')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes the drawer when its row disappears from the list', () => {
    const { props, rerender } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Review Amina' }))
    rerender(<ReviewQueue {...props} source={{ status: 'ok', data: [rows[1]] }} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Escape closes the drawer when no confirmation is open', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Review Amina' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Escape inside a confirmation leaves the drawer behind it open', () => {
    const { props, rerender } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Review Amina' }))
    admin.confirming = true
    rerender(<ReviewQueue {...props} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Details for Amina')).toBeInTheDocument()
  })
})
