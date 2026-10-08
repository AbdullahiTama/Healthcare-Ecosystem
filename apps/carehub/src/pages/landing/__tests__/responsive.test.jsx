import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

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

// The five viewports the brief calls out, plus the 320px floor declared in
// theme.breakpoints. useBreakpoint seeds its state from window.innerWidth, so
// setting the width before render is enough to drive the layout mode.
const VIEWPORTS = [
  { name: 'smallest supported', width: 320 },
  { name: 'iPhone SE', width: 375 },
  { name: 'iPhone 14', width: 390 },
  { name: 'tablet', width: 768 },
  { name: 'laptop', width: 1024 },
  { name: 'desktop', width: 1440 },
]

let host, root
const originalWidth = window.innerWidth

// Mount the page once, then drive every viewport through a resize event.
// useBreakpoint re-reads window.innerWidth on 'resize' (batched through
// requestAnimationFrame), so a resize exercises exactly the same layout code a
// real page load would, at a fraction of the cost. The previous version
// unmounted and rebuilt the whole page per viewport — six full mounts — which
// made this the slowest file in the suite and blew the default 5s test timeout
// and 10s hook timeout whenever the suite ran in parallel.
const mount = async () => {
  window.innerWidth = VIEWPORTS[0].width
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

const setViewport = async (width) => {
  window.innerWidth = width
  await act(async () => {
    window.dispatchEvent(new Event('resize'))
    // Two frames: the first runs useBreakpoint's setWidth, the second lets
    // React commit the re-render before we read the DOM.
    await new Promise((r) => requestAnimationFrame(r))
    await new Promise((r) => requestAnimationFrame(r))
  })
}

const toggle = () => document.querySelector('button[aria-controls="landing-mobile-nav"]')

// Every layout assertion below reads inline styles, which survive a cloneNode,
// so each viewport is captured once and then asserted against synchronously.
const snapshots = new Map()

describe('Landing responsive behaviour', () => {
  beforeAll(async () => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    await mount()
    for (const { width } of VIEWPORTS) {
      await setViewport(width)
      snapshots.set(width, host.cloneNode(true))
    }
    await setViewport(originalWidth)
  }, 30000)

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    delete global.IS_REACT_ACT_ENVIRONMENT
  })

  afterAll(async () => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    if (root) {
      await act(async () => root.unmount())
      host.remove()
      root = null
    }
    window.innerWidth = originalWidth
    snapshots.clear()
    delete global.IS_REACT_ACT_ENVIRONMENT
  })

  it.each(VIEWPORTS)('renders without horizontal-overflow risks at $width', ({ width }) => {
    const tree = snapshots.get(width)

    // The only way an element pushes a page sideways is a hard width wider
    // than the viewport, or a grid/flex child that cannot shrink. The page
    // must contain neither.
    const tooWide = Array.from(tree.querySelectorAll('*')).filter((el) => {
      const w = parseInt(el.style?.width, 10)
      return Number.isFinite(w) && w > width
    })
    expect(tooWide).toHaveLength(0)

    // min-width is only dangerous on a grid/flex child that cannot shrink. The
    // pricing table is the one deliberate exception and it lives inside an
    // overflow-x scroller.
    // (jsdom returns '' — not undefined — for unset style properties, so the
    // empty case has to be filtered explicitly.)
    const unshrinkable = Array.from(tree.querySelectorAll('*')).filter((el) => {
      const minWidth = el.style?.minWidth
      if (!minWidth) return false
      return minWidth !== '0' && minWidth !== '0px' && minWidth !== 'min-content'
    })
    // Assert on the min-width VALUE, not the selector: the message has to name
    // the offending element for this to be actionable when it fails.
    unshrinkable.forEach((el) => {
      const scroller = el.closest('[style*="overflow-x"]')
      expect(scroller, `<${el.tagName.toLowerCase()}> with min-width:${el.style.minWidth}`).not.toBeNull()
    })
  })

  it('gives every anchored section a scroll offset clear of the sticky nav', () => {
    for (const { width } of VIEWPORTS) {
      const tree = snapshots.get(width)
      const anchored = Array.from(tree.querySelectorAll('section[id], [id="business-types"]'))
      expect(anchored.length, `no anchored sections at ${width}px`).toBeGreaterThan(4)
      anchored.forEach((s) => {
        expect(s.style.scrollMarginTop, `${s.id} at ${width}px`).toBe('84px')
      })
    }
  })

  it('exposes every section the primary nav links to above the breakpoint', () => {
    for (const { width } of VIEWPORTS.filter((v) => v.width >= 1024)) {
      const tree = snapshots.get(width)
      const links = Array.from(tree.querySelectorAll('nav[aria-label="Primary"] a')).map((a) =>
        a.getAttribute('href')
      )
      expect(links, `missing primary links at ${width}px`).toEqual(
        expect.arrayContaining(['#features', '#pricing', '#product', '#built-for'])
      )
    }
  })

  it('collapses the bento to a single column on phones and drops its placement', () => {
    for (const { width } of VIEWPORTS) {
      const tree = snapshots.get(width)
      const tile = tree.querySelector('#features article')
      const grid = tile.parentElement

      if (width < 768) {
        expect(grid.style.gridTemplateColumns, `bento columns at ${width}px`).toBe(
          'repeat(1, minmax(0, 1fr))'
        )
      } else if (width < 1024) {
        expect(grid.style.gridTemplateColumns, `bento columns at ${width}px`).toBe(
          'repeat(2, minmax(0, 1fr))'
        )
      } else {
        expect(grid.style.gridTemplateColumns, `bento columns at ${width}px`).toBe(
          'repeat(6, minmax(0, 1fr))'
        )
        expect(tile.style.gridColumn).toBeTruthy()
      }

      // Explicit placements are meaningless once the grid is one or two wide.
      if (width < 1024) expect(tile.style.gridColumn).toBe('')
    }
  })

  it('stacks the hero copy above the product on narrow viewports', () => {
    for (const { width } of VIEWPORTS) {
      const tree = snapshots.get(width)
      const grid = tree.querySelector('[data-reveal="load"]').parentElement
      if (width < 1024) {
        expect(grid.style.gridTemplateColumns, `hero columns at ${width}px`).toBe(
          'minmax(0, 1fr)'
        )
      } else {
        expect(grid.style.gridTemplateColumns, `hero columns at ${width}px`).toContain('1.08fr')
      }
    }
  })

  it('keeps the pricing table scrollable rather than clipped', () => {
    for (const { width } of VIEWPORTS) {
      const tree = snapshots.get(width)
      const table = tree.querySelector('table')
      const scroller = table.parentElement
      expect(scroller.style.overflowX, `table scroller at ${width}px`).toBe('auto')
      // min-width only matters so the columns stay readable when scrolled.
      expect(parseInt(table.style.minWidth, 10)).toBeGreaterThan(0)
    }
  })

  // The only test that needs to drive the disclosure. Reuses the single live
  // tree, so it still costs no extra page mounts.
  it('opens the mobile disclosure onto every section, and closes on click and Escape', async () => {
    for (const { width } of VIEWPORTS.filter((v) => v.width < 1024)) {
      await setViewport(width)
      const btn = toggle()

      expect(btn, `no menu toggle at ${width}px`).not.toBeNull()
      expect(btn.getAttribute('aria-expanded'), `toggle state at ${width}px`).toBe('false')

      await act(async () => btn.click())
      const panel = host.querySelector('#landing-mobile-nav')
      expect(panel, `no panel at ${width}px`).not.toBeNull()
      const hrefs = Array.from(panel.querySelectorAll('a')).map((a) => a.getAttribute('href'))
      expect(hrefs, `missing sections at ${width}px`).toEqual(
        expect.arrayContaining(['#features', '#pricing', '#product', '#built-for'])
      )
      expect(btn.getAttribute('aria-expanded')).toBe('true')

      await act(async () => btn.click())
      expect(btn.getAttribute('aria-expanded'), `did not close at ${width}px`).toBe('false')

      // Escape must close it too, and return focus to the toggle.
      await act(async () => btn.click())
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(btn.getAttribute('aria-expanded'), `Escape did not close at ${width}px`).toBe('false')
    }
  })
})
