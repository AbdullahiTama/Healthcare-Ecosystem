import { describe, it, expect, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ProductForm } from './ProductForm'

// Tell React this is an act() environment so the harness below doesn't warn.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Minimal render harness — no RTL in this repo, but react-dom/client +
// act + manual native events are enough to assert the form's submit wiring.
function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el)
  const desc = Object.getOwnPropertyDescriptor(proto, 'value')
  desc.set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function render(ui) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(ui) })
  return { container, root }
}

// The Expiry Date <input type="date"> is the only date field in the form.
function getExpiryInput(container) {
  return container.querySelector('input[type="date"]')
}

describe('ProductForm expiry_date field', () => {
  it('submits a null expiry when the field is left blank (optional, no throw)', () => {
    const onSubmit = vi.fn()
    const { container } = render(<ProductForm product={null} onClose={() => {}} onSubmit={onSubmit} isLoading={false} />)

    const form = container.querySelector('form')
    expect(getExpiryInput(container)).toBeTruthy() // field is present for a new (add) product

    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    // Blocked only on the required product name, not on expiry.
    expect(onSubmit).not.toHaveBeenCalled()

    setNativeValue(container.querySelector('input'), 'Test Product')
    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0].expiry_date).toBeNull()
  })

  it('round-trips a valid expiry date through onSubmit', () => {
    const onSubmit = vi.fn()
    const { container } = render(<ProductForm product={null} onClose={() => {}} onSubmit={onSubmit} isLoading={false} />)

    setNativeValue(container.querySelector('input'), 'Amoxicillin')
    setNativeValue(getExpiryInput(container), '2027-06-30')
    act(() => {
      container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0].expiry_date).toBe('2027-06-30')
  })

  it('shows a non-blocking reminder banner when editing a product with no expiry', () => {
    const { container } = render(<ProductForm product={{ id: 'p1', name: 'Old Stock' }} onClose={() => {}} onSubmit={() => {}} isLoading={false} />)
    const banner = container.querySelector('[role="status"]')
    expect(banner).toBeTruthy()
    expect(banner.textContent).toMatch(/No expiry date set/i)
  })

  it('does not render the reminder banner for a product that already has an expiry', () => {
    const { container } = render(<ProductForm product={{ id: 'p1', name: 'Old Stock', expiry_date: '2028-01-01' }} onClose={() => {}} onSubmit={() => {}} isLoading={false} />)
    expect(container.querySelector('[role="status"]')).toBeNull()
  })
})
