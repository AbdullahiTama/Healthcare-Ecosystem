import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ReviewDrawer from './ReviewDrawer.jsx'

describe('ReviewDrawer', () => {
  it('renders nothing when closed', () => {
    render(<ReviewDrawer show={false} title="Amina" onClose={() => {}}>body</ReviewDrawer>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows title, status, body and footer', () => {
    render(<ReviewDrawer show title="Amina Yusuf" status="pending" onClose={() => {}} footer={<button>Approve</button>}>Pharmacist</ReviewDrawer>)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Amina Yusuf')).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('Pharmacist')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  it('closes on Escape and on the close button', () => {
    const onClose = vi.fn()
    render(<ReviewDrawer show title="x" onClose={onClose}>b</ReviewDrawer>)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('shows an action error inline as an alert', () => {
    render(<ReviewDrawer show title="x" onClose={() => {}} error="Not allowed">b</ReviewDrawer>)
    expect(screen.getByRole('alert')).toHaveTextContent('Not allowed')
  })
})
