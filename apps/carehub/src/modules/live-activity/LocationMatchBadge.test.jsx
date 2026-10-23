import { describe, it, expect, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import LocationMatchBadge from './LocationMatchBadge.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root, host
function render(state) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<LocationMatchBadge state={state} />))
  return host.querySelector('span')
}
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('LocationMatchBadge', () => {
  it.each([
    ['verified', 'Location matches'],
    ['pending', 'Pending review'],
    ['unverified', 'Not matched'],
    ['uncertain', 'Location uncertain'],
  ])('%s shows the words "%s", so meaning never rests on colour alone', (state, text) => {
    expect(render(state).textContent).toContain(text)
  })

  it('uncertain explains that the GPS was too imprecise to decide, and does not claim a visit', () => {
    const el = render('uncertain')
    expect(el.getAttribute('title')).toMatch(/too imprecise|not accurate enough/i)
    expect(el.getAttribute('title')).toMatch(/does not mean|may or may not/i)
  })

  it('an unknown state reads as not matched', () => {
    expect(render('something-new').textContent).toContain('Not matched')
  })
})
