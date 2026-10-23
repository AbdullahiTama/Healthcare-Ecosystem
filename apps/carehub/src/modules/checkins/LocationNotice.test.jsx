import { describe, it, expect, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import LocationNotice from './LocationNotice.jsx'
import { LOCATION_RETENTION_MONTHS } from './locationPolicy'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root, host
function show(props) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<LocationNotice {...props} />))
}
afterEach(() => { act(() => root.unmount()); host.remove() })
const toggle = () => host.querySelector('button[aria-expanded]')

describe('LocationNotice', () => {
  it('on the check-in panel it says the position is taken only when a button is pressed', () => {
    show({ context: 'checkin' })
    expect(host.textContent).toMatch(/only when you press check in or check out/i)
  })

  it('on the report form it says the position is taken once, on opening, and not tracked after', () => {
    show({ context: 'report' })
    expect(host.textContent).toMatch(/once, when you open this form/i)
    expect(host.textContent).toMatch(/not tracked afterwards/i)
  })

  it('the details are hidden until asked for, behind a real button with aria-expanded and aria-controls', () => {
    show({ context: 'report' })
    const b = toggle()
    expect(b.tagName).toBe('BUTTON')
    expect(b.getAttribute('aria-expanded')).toBe('false')
    expect(host.textContent).not.toMatch(/never in the background/i)
    act(() => b.click())
    expect(b.getAttribute('aria-expanded')).toBe('true')
    const panel = host.querySelector('#' + b.getAttribute('aria-controls'))
    expect(panel).toBeTruthy()
    expect(panel.textContent).toMatch(/never in the background/i)
    act(() => b.click())
    expect(b.getAttribute('aria-expanded')).toBe('false')
  })

  it('the details say what is captured, who sees it, that manager views are logged, and how to get a record corrected', () => {
    show({ context: 'checkin' })
    act(() => toggle().click())
    const t = host.textContent
    expect(t).toMatch(/latitude, longitude/i)
    expect(t).toMatch(/owner and your managers/i)
    expect(t).toMatch(/logged/i)
    expect(t).toMatch(/ask your company owner/i)
  })

  it('does not invent a retention period when the company has not set one', () => {
    expect(LOCATION_RETENTION_MONTHS).toBeNull()
    show({ context: 'report' })
    act(() => toggle().click())
    expect(host.textContent).toMatch(/your company decides how long/i)
    expect(host.textContent).not.toMatch(/\d+ months/)
  })

  it('states the period once the company has set one', () => {
    show({ context: 'report', retentionMonths: 12 })
    act(() => toggle().click())
    expect(host.textContent).toMatch(/kept for 12 months, then removed/i)
  })

  it('an unknown context still renders the neutral sentence instead of crashing', () => {
    show({ context: 'something-else' })
    expect(host.textContent).toMatch(/your position is captured only when you ask/i)
  })
})
