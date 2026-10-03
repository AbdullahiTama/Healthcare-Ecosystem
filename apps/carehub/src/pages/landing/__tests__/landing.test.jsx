import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

// ScrollTrigger measures the document and schedules work on rAF, neither of
// which means anything under jsdom. The page's own contract is that it renders
// fully in its final state without any tween having run, so the assertions
// below depend on gsap doing nothing at all.
vi.mock('gsap', () => ({
  gsap: {
    registerPlugin: vi.fn(),
    context: vi.fn((fn) => {
      fn()
      return { revert: vi.fn() }
    }),
    from: vi.fn(),
    set: vi.fn(),
  },
}))
vi.mock('gsap/ScrollTrigger', () => ({ ScrollTrigger: { refresh: vi.fn() } }))

import Landing from '../Landing.jsx'
import { BUSINESS_TYPES } from '../../../config/constants'
import {
  PLAN_YEARLY_NAIRA,
  PLAN_MONTHLY_NAIRA,
  PLAN_LABELS,
  isPlanAllowedForBusinessType,
} from '../../../lib/planLimits'

// Every route App.jsx actually serves, plus the dynamic receipt pattern. A
// marketing link outside this set lands on the catch-all and silently returns
// the visitor to the landing page.
const REAL_ROUTES = new Set(['/', '/login', '/register', '/forgot-password', '/apply-agent'])

let host, root
const originalWidth = window.innerWidth

// The landing page is eleven sections of composed product UI; mounting it costs
// the same as a small app. This suite used to mount once per test — twenty
// full mounts — and the trivial read-only assertions were timing out under
// parallel load. So: mount once, hand the read-only tests a detached clone, and
// let the tests that need interaction drive the single live tree.
const mount = async (width = originalWidth) => {
  window.innerWidth = width
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>
    )
  })
}

const unmount = async () => {
  if (root) {
    await act(async () => root.unmount())
    host.remove()
    root = null
  }
}

// useBreakpoint re-reads window.innerWidth on 'resize' via requestAnimationFrame,
// so resizing the live tree is enough to re-render it at another breakpoint.
const setViewport = async (width) => {
  window.innerWidth = width
  await act(async () => {
    window.dispatchEvent(new Event('resize'))
    // Two frames: the first applies setWidth, the second lets React commit.
    await new Promise((r) => requestAnimationFrame(r))
    await new Promise((r) => requestAnimationFrame(r))
  })
}

const text = (el) => el.textContent || ''

const anchorsIn = (el, selector = 'a') => Array.from(el.querySelectorAll(selector))

// A detached clone of the rendered page. Safe for read-only assertions because
// every one of them inspects markup or inline styles, both of which survive
// cloneNode — and no React handler is needed to read them.
let dom

describe('Landing', () => {
  beforeAll(async () => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    await mount()
    dom = host.cloneNode(true)
  }, 30000)

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    delete global.IS_REACT_ACT_ENVIRONMENT
  })

  afterAll(async () => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    await unmount()
    window.innerWidth = originalWidth
    delete global.IS_REACT_ACT_ENVIRONMENT
  })

  describe('document structure', () => {
    it('has exactly one h1', () => {
      expect(dom.querySelectorAll('h1')).toHaveLength(1)
    })

    it('labels every section from a heading on the page', () => {
      const labelled = dom.querySelectorAll('section[aria-labelledby]')
      expect(labelled.length).toBeGreaterThan(5)
      labelled.forEach((s) => {
        expect(dom.querySelector(`#${s.getAttribute('aria-labelledby')}`)).not.toBeNull()
      })
    })

    it('exposes every section the navigation links to', () => {
      const ids = new Set(Array.from(dom.querySelectorAll('[id]')).map((el) => el.id))
      const targets = new Set(
        anchorsIn(dom)
          .map((a) => a.getAttribute('href'))
          .filter((h) => h && h.startsWith('#') && h.length > 1)
          .map((h) => h.slice(1))
      )
      expect(targets.size).toBeGreaterThan(3)
      targets.forEach((t) => expect(ids).toContain(t))
    })

    it('starts with a skip link that targets the main landmark', () => {
      const skip = dom.querySelector('a.ch-skip')
      expect(skip).not.toBeNull()
      expect(skip.getAttribute('href')).toBe('#main')
      expect(dom.querySelector('main#main')).not.toBeNull()
    })
  })

  describe('link integrity', () => {
    it('sends no link to a route the app does not serve', () => {
      const internal = anchorsIn(dom)
        .map((a) => a.getAttribute('href'))
        .filter((h) => h && h.startsWith('/'))
      expect(internal.length).toBeGreaterThan(5)
      internal.forEach((h) => {
        expect(REAL_ROUTES.has(h) || h.startsWith('/receipt/')).toBe(true)
      })
    })

    it('marks external links as safe and reachable', () => {
      const external = anchorsIn(dom, 'a[target="_blank"]')
      expect(external.length).toBeGreaterThan(0)
      external.forEach((a) => expect(a.getAttribute('rel')).toContain('noopener'))
    })

    it('never renders a legal page link that does not exist yet', () => {
      const hrefs = anchorsIn(dom).map((a) => a.getAttribute('href') || '')
      expect(hrefs.some((h) => h.includes('/privacy') || h.includes('/terms'))).toBe(false)
      expect(text(dom)).toContain('Privacy')
    })
  })

  describe('claims the product can back', () => {
    it('makes no traction or trial claim the code does not implement', () => {
      const body = text(dom)
      const forbidden = [
        '30-day',
        'free trial',
        'Save 20%',
        '99.9%',
        '500+',
        '10,000+',
        'Trusted by',
        'testimonial',
      ]
      forbidden.forEach((claim) => expect(body).not.toContain(claim))
    })

    it('lists every business type the product supports', () => {
      const body = text(dom)
      BUSINESS_TYPES.forEach((t) => expect(body).toContain(t.name))
    })

    it('shows capability figures rather than usage statistics', () => {
      const body = text(dom)
      expect(body).toContain('32')
      expect(body).toContain('8')
      expect(body).toContain('Built-in staff roles')
    })

    it('renders the annual price from planLimits for every paid plan', () => {
      const body = text(dom)
      ;['basic', 'growth', 'premium', 'enterprise'].forEach((plan) => {
        const price = `₦${PLAN_YEARLY_NAIRA[plan].toLocaleString('en-NG')}`
        expect(body).toContain(price)
        expect(body).toContain(PLAN_LABELS[plan])
      })
    })

    it('gives the unpriced Custom plan a sales route instead of a number', () => {
      expect(PLAN_YEARLY_NAIRA.custom).toBeNull()
      const body = text(dom)
      expect(body).toContain('Contact sales')
    })

    it('keeps Custom out of the priced grid and gives it a band', () => {
      // Custom is a sales conversation, not a fifth price tier. Five cards in
      // one row is what squeezed the old page's columns to 180px.
      const body = text(dom)
      expect(body).toContain('Bespoke')
      const cards = Array.from(dom.querySelectorAll('#pricing article h3')).map(
        (h) => h.textContent
      )
      expect(cards).toHaveLength(4)
      expect(cards).not.toContain('Custom')
    })

    it('surfaces the hospital constraint on the Basic card, not just in a footnote', () => {
      expect(isPlanAllowedForBusinessType('basic', 'hospital')).toBe(false)
      expect(isPlanAllowedForBusinessType('growth', 'hospital')).toBe(true)
      const basicCard = Array.from(dom.querySelectorAll('#pricing article')).find((a) =>
        a.textContent.includes(PLAN_LABELS.basic)
      )
      expect(basicCard, 'no Basic card found').not.toBeNull()
      expect(basicCard.textContent).toContain('Not available for hospitals')
    })

    it('labels the monthly figure an equivalence, since no monthly billing exists', () => {
      // PLAN_MONTHLY_NAIRA is yearly/12, rounded. Presenting it as a second
      // price would advertise a billing period the payment flow does not support.
      expect(PLAN_MONTHLY_NAIRA.growth).toBe(Math.round(PLAN_YEARLY_NAIRA.growth / 12))
      const body = text(dom)
      expect(body).toContain('billed annually')
      expect(body).toMatch(/≈ ₦[\d,]+\s*\/\s*month/)
    })

    it('compares the same module set across every plan', () => {
      const table = dom.querySelector('#pricing table')
      const rows = Array.from(table.querySelectorAll('tbody tr'))
      const labels = rows.map((r) => r.querySelector('th')?.textContent)
      expect(labels).toEqual(
        expect.arrayContaining([
          'Staff',
          'Locations',
          'Products',
          'Point of sale',
          'Inventory',
          'Reports',
          'Staff & roles',
          'CareFind listing',
          'Multi-location',
        ])
      )
    })
  })

  describe('accessibility', () => {
    it('exposes the pricing comparison as a real table', () => {
      const table = dom.querySelector('table')
      expect(table).not.toBeNull()
      expect(table.querySelector('caption')?.textContent).toBeTruthy()
      // Four priced plans plus Custom, and the "Limit" stub column.
      expect(table.querySelectorAll('th[scope="col"]')).toHaveLength(6)
      expect(table.querySelectorAll('th[scope="row"]').length).toBeGreaterThan(2)
      table.querySelectorAll('th[scope="col"], th[scope="row"]').forEach((th) => {
        expect(th.textContent?.trim()).toBeTruthy()
      })
    })

    it('offsets every anchored section clear of the sticky nav', () => {
      // Without this, jumping to #pricing parks the heading underneath the
      // 68px sticky nav.
      Array.from(dom.querySelectorAll('section[id]')).forEach((s) => {
        expect(s.style.scrollMarginTop, `${s.id} has no scroll offset`).toBe('84px')
      })
    })

    it('keeps illustrative product surfaces out of the tab order', () => {
      // A composed mockup is a picture, not a set of controls. Anything
      // focusable inside one would be a dead end for a keyboard user.
      const frames = dom.querySelectorAll('[data-mock-surface]')
      expect(frames.length).toBeGreaterThan(0)
      frames.forEach((f) => {
        expect(f.querySelectorAll('a, button, input, select, textarea')).toHaveLength(0)
      })
    })

    it('labels every image-like graphic for assistive technology', () => {
      Array.from(dom.querySelectorAll('svg[role="img"]')).forEach((svg) => {
        expect(svg.getAttribute('aria-label')).toBeTruthy()
      })
    })

    it('never hides content behind a low-contrast colour token', () => {
      // gray500 is 2.78:1 and gray400 2.31:1 on var(--bg) — both fail AA. The
      // old page used them for body copy throughout.
      const offenders = Array.from(dom.querySelectorAll('p, li, dd, dt, a, span')).filter((el) => {
        const color = el.style?.color
        if (!color) return false
        if (!el.textContent?.trim()) return false
        return color === '#8B978F' || color === '#9AA69F'
      })
      expect(offenders).toHaveLength(0)
    })
  })

  describe('mobile navigation', () => {
    // Phone width, applied to the shared live tree by resize rather than by
    // building the page again.
    beforeAll(async () => {
      await setViewport(390)
    })

    it('is a labelled disclosure that reports its state', () => {
      const toggle = host.querySelector('button[aria-controls="landing-mobile-nav"]')
      expect(toggle).not.toBeNull()
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      expect(toggle.getAttribute('aria-label')).toBe('Open menu')
    })

    it('opens and closes, and closes on Escape', async () => {
      const toggle = host.querySelector('button[aria-controls="landing-mobile-nav"]')
      expect(host.querySelector('#landing-mobile-nav')).toBeNull()

      await act(async () => toggle.click())
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      expect(toggle.getAttribute('aria-label')).toBe('Close menu')
      expect(host.querySelector('#landing-mobile-nav')).not.toBeNull()

      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(host.querySelector('#landing-mobile-nav')).toBeNull()
    })

    it('keeps every navigation destination reachable on a phone', async () => {
      // The old nav hid Features and Pricing below 768px, leaving two whole
      // sections unreachable on a phone.
      const toggle = host.querySelector('button[aria-controls="landing-mobile-nav"]')
      await act(async () => toggle.click())
      const hrefs = Array.from(host.querySelectorAll('#landing-mobile-nav a')).map((a) =>
        a.getAttribute('href')
      )
      expect(hrefs).toEqual(expect.arrayContaining(['#product', '#features', '#built-for', '#pricing']))
    })
  })

  describe('reduced motion', () => {
    it('renders every section visible with no tween applied', async () => {
      const original = window.matchMedia
      window.matchMedia = (q) => ({
        matches: q.includes('prefers-reduced-motion'),
        media: q,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      })
      // The hook reads the query at mount, so this one case genuinely needs a
      // fresh mount under the stub.
      await unmount()
      await mount(390)
      try {
        expect(host.textContent).toContain('Everything a healthcare business runs on')
        const hidden = Array.from(host.querySelectorAll('[data-reveal]')).filter(
          (el) => el.style.opacity === '0' || el.style.visibility === 'hidden'
        )
        expect(hidden).toHaveLength(0)
      } finally {
        window.matchMedia = original
      }
    }, 20000)
  })
})
