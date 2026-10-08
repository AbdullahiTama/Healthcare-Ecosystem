// The cart drawer is a modal: it must announce itself, trap focus, close on Escape, lock the page scroll behind
// it and hand focus back to the control that opened it.
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('./CartProvider', () => ({
  useCart: () => ({
    items: [{ ecommerce_product_id: 'p1', product_name: 'Paracetamol', unit_price_kobo: 50000, quantity: 2 }],
    total: 100000,
    removeItem: vi.fn(),
    updateQuantity: vi.fn(),
  }),
}))

import MiniCart from './MiniCart'

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <MemoryRouter>
      <button onClick={() => setOpen(true)}>Open cart</button>
      {/* inline onClose on purpose: callers pass a new function every render */}
      <MiniCart open={open} onClose={() => setOpen(false)} />
    </MemoryRouter>
  )
}

function openDrawer() {
  const opener = screen.getByRole('button', { name: 'Open cart' })
  opener.focus()
  fireEvent.click(opener)
  return opener
}

describe('MiniCart drawer', () => {
  afterEach(() => { document.body.style.overflow = '' })

  it('is a labelled modal dialog', () => {
    render(<Harness />)
    openDrawer()

    const dialog = screen.getByRole('dialog', { name: /shopping cart/i })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })

  it('closes on Escape', () => {
    render(<Harness />)
    openDrawer()
    expect(screen.getByText('Subtotal')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByText('Subtotal')).toBeNull()
  })

  it('locks page scroll while open and restores it on close', () => {
    document.body.style.overflow = 'auto'
    render(<Harness />)
    openDrawer()
    expect(document.body.style.overflow).toBe('hidden')

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(document.body.style.overflow).toBe('auto')
  })

  it('moves focus into the drawer on open and back to the opener on close', () => {
    render(<Harness />)
    const opener = openDrawer()

    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(document.activeElement).toBe(opener)
  })

  it('keeps Tab and Shift+Tab inside the drawer', () => {
    render(<Harness />)
    openDrawer()
    const dialog = screen.getByRole('dialog')
    const focusable = [...dialog.querySelectorAll('a[href], button:not([disabled])')]
    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    first.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('does not steal focus back to the first control when the parent re-renders', () => {
    render(<Harness />)
    openDrawer()
    const dialog = screen.getByRole('dialog')
    const plus = [...dialog.querySelectorAll('button')].find((b) => b.textContent === '+')
    plus.focus()

    fireEvent.click(plus) // re-renders the parent chain

    expect(document.activeElement).toBe(plus)
  })

  it('names the quantity and remove buttons after the product', () => {
    render(<Harness />)
    openDrawer()

    expect(screen.getByRole('button', { name: 'Decrease quantity of Paracetamol' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Increase quantity of Paracetamol' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove Paracetamol from cart' })).toBeTruthy()
  })
})
