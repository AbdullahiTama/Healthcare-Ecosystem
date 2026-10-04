import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { layout, html, esc, safeUrl, detailsTable, itemsTable, BRANDS } from '../templates/layout.js'
import { getTemplate } from '../templates/index.js'
import * as HubTemplates from '../templates/Transactional/index.js'
import * as FindTemplates from '../templates/Transactional/CareFind/index.js'
import { SAMPLES } from '../templates/samples.js'
import { htmlToText } from '../utils/htmlToText.js'

const REPO = fileURLToPath(new URL('../../../../', import.meta.url))
const EVIL = '<script>alert(1)</script>"><img src=x onerror=alert(2)>'

// Every template of both apps, by the name it is exported under.
const ALL = [
  ...Object.entries(HubTemplates).map(([name, fn]) => ({ id: `carehub.${name}`, app: 'carehub', fn })),
  ...Object.entries(FindTemplates).map(([name, fn]) => ({ id: `carefind.${name}`, app: 'carefind', fn })),
]

// A Proxy payload answers every field a template asks for with the same hostile string, so no field can be missed.
const hostilePayload = () => new Proxy({}, { get: (_, key) => (typeof key === 'string' ? EVIL : undefined) })

describe('escaping', () => {
  it('escapes interpolated values and leaves nested html alone', () => {
    expect(String(html`<p>${'<b>'}${html`<i>${'&'}</i>`}</p>`)).toBe('<p>&lt;b&gt;<i>&amp;</i></p>')
  })

  it('keeps a zero and drops null, undefined and false', () => {
    expect(String(html`${0}|${null}|${undefined}|${false}`)).toBe('0|||')
    expect(esc(0)).toBe('0')
  })

  it('only lets web and mail links through', () => {
    expect(safeUrl('https://carefind.app/x?a=1')).toBe('https://carefind.app/x?a=1')
    expect(safeUrl('mailto:a@b.co')).toBe('mailto:a@b.co')
    expect(safeUrl('javascript:alert(1)')).toBe('#')
    expect(safeUrl('data:text/html,x')).toBe('#')
    expect(safeUrl(undefined)).toBe('#')
  })
})

describe('layout', () => {
  const render = (extra = {}) => layout({ app: 'carefind', title: 'Hello', body: html`<p>Body</p>`, ...extra })

  it('is a complete document built from tables', () => {
    const out = render()
    expect(out.startsWith('<!doctype html>')).toBe(true)
    expect(out).toContain('<meta name="viewport"')
    expect(out).toContain('role="presentation"')
    expect(out.endsWith('</body></html>')).toBe(true)
  })

  it('gives the logo real dimensions and puts the name beside it as text', () => {
    const out = render()
    expect(out).toContain(`<img src="${BRANDS.carefind.logoUrl}" width="${BRANDS.carefind.logoWidth}" height="40"`)
    expect(out).toContain('Care<span class="em-accent" style="color:#0E6F5A">Find</span>')
  })

  it('shows the action link as text only when asked', () => {
    const cta = { href: 'https://carefind.app/go?a=1&b=2', label: 'Go' }
    expect(render({ cta })).not.toContain('copy this link')
    const withLink = render({ cta, showLink: true })
    expect(withLink).toContain('copy this link')
    expect(withLink).toContain('href="https://carefind.app/go?a=1&amp;b=2"')
  })

  it('never puts a script link behind the button', () => {
    expect(render({ cta: { href: 'javascript:alert(1)', label: 'Go' } })).not.toContain('javascript:')
  })

  it('hides the inbox preview line from the plain-text part, along with the document head', () => {
    const text = htmlToText(render({ preheader: 'PREVIEW-LINE' }))
    expect(text).not.toContain('PREVIEW-LINE')
    expect(text).not.toContain('prefers-color-scheme')
    expect(text).not.toContain('mso')
    expect(text).toContain('Hello')
  })
})

describe('blocks', () => {
  it('leaves out detail rows that have no value', () => {
    const out = String(detailsTable([['Plan', 'Pro'], ['Business', ''], ['Expiry', undefined]]))
    expect(out).toContain('Plan')
    expect(out).not.toContain('Business')
    expect(out).not.toContain('Expiry')
    expect(String(detailsTable([['A', null]]))).toBe('')
  })

  it('prints the total it is given rather than a sum of the lines', () => {
    const out = String(itemsTable([{ name: 'Paracetamol', quantity: 2, price: 1200 }], { total: 3900 }))
    expect(out).toContain('₦2,400')
    expect(out).toContain('₦3,900')
  })
})

describe('the logo files the emails point at', () => {
  for (const app of ['carefind', 'carehub']) {
    it(`${app}: is a PNG in the app's public folder with the proportions the header declares`, () => {
      const file = `${REPO}apps/${app}/public/email-logo.png`
      expect(existsSync(file)).toBe(true)
      const png = readFileSync(file)
      expect(png.subarray(1, 4).toString()).toBe('PNG')
      const width = png.readUInt32BE(16), height = png.readUInt32BE(20)
      // Shown at 40px high; a wrong declared width would stretch the mark.
      expect(Math.round((width * 40) / height)).toBe(BRANDS[app].logoWidth)
      expect(BRANDS[app].logoUrl.endsWith('/email-logo.png')).toBe(true)
    })
  }
})

describe('every template of both apps', () => {
  for (const { id, app, fn } of ALL) {
    it(`${id}: renders with no data at all`, () => {
      const out = fn({})
      expect(out.startsWith('<!doctype html>')).toBe(true)
      expect(out).not.toMatch(/undefined|NaN|\[object Object\]/)
      expect(out).toContain(BRANDS[app].logoUrl)
      expect(out).toContain('All rights reserved')
      expect(fn()).toBe(out)
    })

    it(`${id}: escapes every field`, () => {
      const out = fn(hostilePayload())
      expect(out).not.toContain('<script>alert(1)</script>')
      expect(out).not.toContain('<img src=x')
      expect(out).not.toMatch(/href="[^"]*<script/)
    })
  }

  it('renders every sample without leaving a hole', () => {
    for (const [key, payload] of Object.entries(SAMPLES)) {
      const render = getTemplate(key, 'carehub') || getTemplate(key, 'carefind')
      expect(render, key).toBeTruthy()
      expect(render(payload), key).not.toMatch(/undefined|NaN|\[object Object\]/)
    }
  })
})
