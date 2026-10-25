import { describe, it, expect } from 'vitest'
import { popupContent, TONE_COLOR } from '../LeafletMap.jsx'

// Names and places in a popup are typed by people (reps, the platform team). They must stay text: a popup built from
// an HTML string would run an <img onerror> planted in a name in the manager's session.

describe('popupContent', () => {
  it('shows the title and each line as text', () => {
    const el = popupContent({ title: 'Allen Pharmacy', lines: ['Ada · 11:30', 'Location matches'] })
    expect(el.querySelector('strong').textContent).toBe('Allen Pharmacy')
    expect([...el.querySelectorAll('div')].map((d) => d.textContent)).toEqual(['Ada · 11:30', 'Location matches'])
  })

  it('HTML in a name or a line stays text', () => {
    const el = popupContent({ title: '<img src=x onerror=alert(1)>', lines: ['<b>bold</b>'] })
    expect(el.querySelector('img')).toBeNull()
    expect(el.querySelector('b')).toBeNull()
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('every tone has a colour', () => {
    for (const tone of ['current', 'earlier', 'out', 'visit', 'quiet']) expect(TONE_COLOR[tone]).toMatch(/^#|^rgb|^var|^[a-z]/i)
  })
})

import { resolveLeaflet } from '../LeafletMap.jsx'

describe('resolveLeaflet', () => {
  // Leaflet is a CommonJS bundle; depending on the bundler the dynamic import yields the library under .default or
  // its functions directly. Either way the map must get the library, not undefined.
  it('accepts the library under default, or the module itself', () => {
    const lib = { map() {}, tileLayer() {} }
    expect(resolveLeaflet({ default: lib })).toBe(lib)
    expect(resolveLeaflet(lib)).toBe(lib)
    const both = { ...lib, default: lib }
    expect(resolveLeaflet(both)).toBe(lib)
  })
})
