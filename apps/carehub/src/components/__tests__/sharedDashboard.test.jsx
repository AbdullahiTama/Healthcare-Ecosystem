import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, afterEach } from 'vitest'
import {
  DashboardShell,
  MetricGrid,
  SectionCard,
  ChartCard,
  Sparkline,
  BarList,
  ActivityList,
  SearchBar,
  FilterBar,
  QuickAction,
  UserMenu,
} from '@care-ecosystem/design-system/components/ui'
import { theme } from '@care-ecosystem/design-system'

// Dashboard foundation (docs/design/DASHBOARD_FOUNDATION.md). These assert the
// contract the D1–D3 dashboard rebuilds depend on: landmarks and headings,
// responsive grid math, the three required chart states, and accessible names.

async function mount(element) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(element) })
  return {
    host,
    unmount: async () => {
      await act(async () => { root.unmount() })
      host.remove()
    },
    rerender: async (next) => { await act(async () => { root.render(next) }) },
  }
}

function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

// jsdom serializes hex colors to rgb() — compare against that form.
const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

describe('dashboard tokens', () => {
  it('completes the dashboard spacing set (40 / 48)', () => {
    expect(theme.space[13]).toBe(40)
    expect(theme.space[14]).toBe(48)
  })

  it('defines metric type roles', () => {
    expect(theme.type.metric.size).toBeGreaterThanOrEqual(24)
    expect(theme.type.metricLabel.weight).toBeGreaterThanOrEqual(600)
  })

  it('defines dashboard shell geometry', () => {
    expect(theme.dashboard.navWidth).toBeGreaterThan(0)
    expect(theme.dashboard.contentMaxWidth).toBeGreaterThan(theme.dashboard.navWidth)
    expect(theme.dashboard.metricMin).toBeGreaterThan(100)
  })
})

describe('DashboardShell', () => {
  let m
  afterEach(async () => { if (m) { await m.unmount(); m = null } })

  it('renders skip link, main landmark, nav and topbar slots', async () => {
    m = await mount(
      <DashboardShell nav={<nav aria-label="Primary">rail</nav>} topbar={<div>bar</div>}>
        <p>content</p>
      </DashboardShell>
    )
    const skip = m.host.querySelector('a[href="#ds-main-content"]')
    expect(skip).toBeTruthy()
    expect(skip.textContent).toContain('Skip to main content')

    const main = m.host.querySelector('main#ds-main-content')
    expect(main).toBeTruthy()
    expect(main.getAttribute('tabindex')).toBe('-1')
    expect(main.textContent).toContain('content')

    expect(m.host.querySelector('nav[aria-label="Primary"]')).toBeTruthy()
    expect(m.host.textContent).toContain('bar')
  })

  it('caps content width instead of stretching to the viewport', async () => {
    m = await mount(<DashboardShell><p>x</p></DashboardShell>)
    const main = m.host.querySelector('main')
    expect(main.style.maxWidth).toBe(`${theme.dashboard.contentMaxWidth}px`)
    expect(main.style.margin).toContain('auto')
  })

  it('renders an labelled aside only when provided', async () => {
    m = await mount(<DashboardShell aside={<div>ctx</div>}><p>x</p></DashboardShell>)
    const aside = m.host.querySelector('aside')
    expect(aside).toBeTruthy()
    expect(aside.getAttribute('aria-label')).toBeTruthy()
    expect(aside.textContent).toContain('ctx')
  })

  it('exposes horizontal overflow from the content scroller instead of masking it', async () => {
    m = await mount(<DashboardShell><p>x</p></DashboardShell>)
    const scroller = m.host.querySelector('main').parentElement
    expect(scroller.style.overflowX).toBe('auto')
    expect(scroller.style.overflowY).toBe('auto')
  })

  it('reserves the nav rail width, or hands nav to the viewport on mobile', async () => {
    const original = window.innerWidth
    const shell = (key) => (
      <DashboardShell nav={<nav aria-label={key}>rail</nav>}><p>x</p></DashboardShell>
    )
    try {
      window.innerWidth = 1280
      m = await mount(shell('wide'))
      expect(m.host.querySelector('nav').parentElement.style.width).toBe(`${theme.dashboard.navWidth}px`)
      await m.unmount(); m = null

      window.innerWidth = 1280
      m = await mount(<DashboardShell collapsed nav={<nav aria-label="collapsed">rail</nav>}><p>x</p></DashboardShell>)
      expect(m.host.querySelector('nav').parentElement.style.width).toBe(`${theme.dashboard.navCollapsedWidth}px`)
      await m.unmount(); m = null

      window.innerWidth = 375
      m = await mount(shell('mobile'))
      // display:contents — the app's mobile drawer is fixed-positioned, so the
      // shell must reserve no rail width.
      expect(m.host.querySelector('nav').parentElement.style.display).toBe('contents')
      await m.unmount(); m = null
    } finally {
      window.innerWidth = original
    }
  })
})

describe('MetricGrid', () => {
  it('derives a percentage floor from columns so rows wrap without overflow', async () => {
    const m = await mount(<MetricGrid columns={4} label="Key metrics"><i /></MetricGrid>)
    expect(m.host.firstElementChild.style.gridTemplateColumns).toContain('25%')
    expect(m.host.firstElementChild.getAttribute('role')).toBe('group')
    expect(m.host.firstElementChild.getAttribute('aria-label')).toBe('Key metrics')
    await m.unmount()
  })

  it('falls back to the pixel floor when no column count is given', async () => {
    const m = await mount(<MetricGrid><i /></MetricGrid>)
    expect(m.host.firstElementChild.style.gridTemplateColumns).toContain(`${theme.dashboard.metricMin}px`)
    await m.unmount()
  })
})

describe('SectionCard', () => {
  it('renders a real heading, subtitle and action slot', async () => {
    const m = await mount(
      <SectionCard title="Recent sales" sub="Last 24 hours" actions={<button>New</button>} headingLevel={3}>
        <p>rows</p>
      </SectionCard>
    )
    const heading = m.host.querySelector('h3')
    expect(heading).toBeTruthy()
    expect(heading.textContent).toBe('Recent sales')
    expect(m.host.textContent).toContain('Last 24 hours')
    expect(m.host.querySelector('button').textContent).toBe('New')
    expect(m.host.textContent).toContain('rows')
    await m.unmount()
  })

  it('omits the header entirely when there is nothing to say', async () => {
    const m = await mount(<SectionCard><p>body</p></SectionCard>)
    expect(m.host.querySelector('h1,h2,h3,h4,h5,h6')).toBeNull()
    await m.unmount()
  })
})

describe('ChartCard', () => {
  it('exposes a loading state with aria-busy', async () => {
    const m = await mount(<ChartCard title="Revenue" loading><p>chart</p></ChartCard>)
    const status = m.host.querySelector('[role="status"]')
    expect(status).toBeTruthy()
    expect(status.getAttribute('aria-busy')).toBe('true')
    expect(m.host.textContent).not.toContain('chart')
    await m.unmount()
  })

  it('exposes an error state with a retry path', async () => {
    let retried = 0
    const m = await mount(<ChartCard title="Revenue" error onRetry={() => retried++}><p>chart</p></ChartCard>)
    const alert = m.host.querySelector('[role="alert"]')
    expect(alert).toBeTruthy()
    const retry = [...m.host.querySelectorAll('button')].find((b) => b.textContent === 'Retry')
    expect(retry).toBeTruthy()
    click(retry)
    expect(retried).toBe(1)
    await m.unmount()
  })

  it('exposes an empty state', async () => {
    const m = await mount(<ChartCard title="Revenue" empty emptyMessage="No sales yet."><p>chart</p></ChartCard>)
    expect(m.host.textContent).toContain('No sales yet.')
    expect(m.host.textContent).not.toContain('chart')
    await m.unmount()
  })

  it('keeps a minimum plot height when data is present', async () => {
    const m = await mount(<ChartCard title="Revenue"><p>chart</p></ChartCard>)
    const plot = [...m.host.querySelectorAll('div')].find((d) => d.style.minHeight !== '')
    expect(plot).toBeTruthy()
    expect(plot.style.minHeight).toBe(`${theme.dashboard.chartMinHeight}px`)
    await m.unmount()
  })
})

describe('Sparkline', () => {
  it('is an img with a readable trend summary', async () => {
    const m = await mount(<Sparkline data={[1, 2, 3, 8]} format={(v) => `${v}k`} />)
    const svg = m.host.querySelector('svg')
    expect(svg.getAttribute('role')).toBe('img')
    const label = svg.getAttribute('aria-label')
    expect(label).toContain('4 points')
    expect(label).toContain('1k')
    expect(label).toContain('8k')
    expect(label).toContain('up')
    await m.unmount()
  })

  it('renders a flat line for a single sample and nothing for no samples', async () => {
    const one = await mount(<Sparkline data={[5]} />)
    expect(one.host.querySelector('polyline')).toBeTruthy()
    await one.unmount()

    const none = await mount(<Sparkline data={[]} />)
    expect(none.host.querySelector('svg')).toBeNull()
    await none.unmount()
  })
})

describe('BarList', () => {
  it('renders a labelled list where text carries every value', async () => {
    const m = await mount(
      <BarList label="Revenue by category" format={(v) => `₦${v}`} items={[
        { label: 'Consultations', value: 50 },
        { label: 'Pharmacy', value: 100 },
      ]} />
    )
    const list = m.host.querySelector('[role="list"]')
    expect(list.getAttribute('aria-label')).toBe('Revenue by category')
    expect(m.host.textContent).toContain('₦50')
    expect(m.host.textContent).toContain('₦100')
    const tracks = [...m.host.querySelectorAll('[aria-hidden="true"]')]
    expect(tracks).toHaveLength(2)
    expect(tracks[0].children[0].style.width).toBe('50%')
    expect(tracks[1].children[0].style.width).toBe('100%')
    await m.unmount()
  })

  it('renders nothing when there are no items', async () => {
    const m = await mount(<BarList items={[]} />)
    expect(m.host.querySelector('ul')).toBeNull()
    await m.unmount()
  })
})

describe('ActivityList', () => {
  it('renders a semantic list with title, meta and trailing value', async () => {
    const m = await mount(
      <ActivityList label="Recent activity" items={[
        { id: 1, title: 'Walk-in sale', meta: 'Card · 2m ago', value: '₦4,500' },
        { id: 2, title: 'Credit sale', meta: 'Transfer · 11m ago', value: '₦1,200' },
      ]} />
    )
    expect(m.host.querySelectorAll('li')).toHaveLength(2)
    expect(m.host.querySelector('[role="list"]').getAttribute('aria-label')).toBe('Recent activity')
    expect(m.host.textContent).toContain('Walk-in sale')
    expect(m.host.textContent).toContain('₦4,500')
    await m.unmount()
  })

  it('makes a row a real button only when it is actionable', async () => {
    let opened = 0
    const m = await mount(
      <ActivityList items={[{ id: 1, title: 'Open', onClick: () => opened++ }, { id: 2, title: 'Static' }]} />
    )
    const buttons = m.host.querySelectorAll('button')
    expect(buttons).toHaveLength(1)
    click(buttons[0])
    expect(opened).toBe(1)
    await m.unmount()
  })

  it('shows the shared empty state, or nothing when told to', async () => {
    const withEmpty = await mount(<ActivityList items={[]} emptyMessage="No sales yet." />)
    expect(withEmpty.host.textContent).toContain('No sales yet.')
    await withEmpty.unmount()

    const silent = await mount(<ActivityList items={[]} empty={false} />)
    expect(silent.host.querySelector('ul')).toBeNull()
    await silent.unmount()
  })

  it('tints the icon tile and value with the row tone', async () => {
    const m = await mount(
      <ActivityList label="Out of stock" items={[
        { id: 'd', tone: 'danger', icon: <i />, title: 'Drug out', value: '2 left' },
        { id: 'b', tone: 'brand', icon: <i />, title: 'Sale', value: '₦500' },
      ]} />
    )
    const [dangerTile, brandTile] = m.host.querySelectorAll('span[aria-hidden="true"]')
    expect(dangerTile.style.background).toBe(rgb(theme.dangerBg))
    expect(dangerTile.style.color).toBe(rgb(theme.danger))
    // Untoned default and the brand tone keep the historical teal tile.
    expect(brandTile.style.background).toBe(rgb(theme.tealMist))
    expect(brandTile.style.color).toBe(rgb(theme.tealDeep))

    const values = [...m.host.querySelectorAll('li span')].filter((s) => s.textContent === '2 left')
    expect(values[0].style.color).toBe(rgb(theme.danger))
    await m.unmount()
  })
})

describe('SearchBar / FilterBar', () => {
  it('labels the input, reports values and clears them', async () => {
    const changes = []
    const m = await mount(<SearchBar label="Search products" value="para" onChange={(v) => changes.push(v)} />)
    const input = m.host.querySelector('input')
    const label = m.host.querySelector('label')
    expect(label.getAttribute('for')).toBe(input.id)
    expect(label.textContent).toBe('Search products')
    expect(m.host.querySelector('[role="search"]')).toBeTruthy()

    const inputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    await act(async () => {
      inputSetter.call(input, 'paracetamol')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(changes).toEqual(['paracetamol'])

    const clear = m.host.querySelector('button[aria-label="Clear search products"]')
    expect(clear).toBeTruthy()
    click(clear)
    expect(changes[changes.length - 1]).toBe('')
    await m.unmount()
  })

  it('groups filters and right-aligns the action slot', async () => {
    const m = await mount(
      <FilterBar label="Stock filters" right={<button>Export</button>}>
        <SearchBar value="" onChange={() => {}} />
      </FilterBar>
    )
    const group = m.host.querySelector('[role="group"]')
    expect(group.getAttribute('aria-label')).toBe('Stock filters')
    expect(group.querySelector('[role="search"]')).toBeTruthy()
    expect(group.textContent).toContain('Export')
    await m.unmount()
  })
})

describe('QuickAction', () => {
  it('is a real button with a disabled state', async () => {
    let clicks = 0
    const m = await mount(<QuickAction icon={<i />} label="Add product" sub="Catalogue" onClick={() => clicks++} />)
    const btn = m.host.querySelector('button')
    expect(btn.getAttribute('type')).toBe('button')
    expect(btn.textContent).toContain('Add product')
    expect(btn.textContent).toContain('Catalogue')
    expect(btn.disabled).toBe(false)
    click(btn)
    expect(clicks).toBe(1)

    await m.rerender(<QuickAction icon={<i />} label="Add product" disabled />)
    expect(m.host.querySelector('button').disabled).toBe(true)
    await m.unmount()
  })
})

describe('UserMenu', () => {
  it('opens a menu, moves focus in, and closes on Escape', async () => {
    const m = await mount(
      <UserMenu name="Amina Yusuf" role="Owner" items={[
        { label: 'Settings', onClick: () => {} },
        { label: 'Sign out', danger: true },
      ]} />
    )
    const trigger = m.host.querySelector('button')
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(m.host.textContent).toContain('Amina Yusuf')

    await act(async () => { click(trigger) })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const menu = m.host.querySelector('[role="menu"]')
    expect(menu).toBeTruthy()
    expect(menu.querySelectorAll('[role="menuitem"]')).toHaveLength(2)
    expect(document.activeElement).toBe(menu.querySelector('[role="menuitem"]'))

    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(m.host.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    await m.unmount()
  })

  it('degrades to a static identity chip when there is nothing to open', async () => {
    const m = await mount(<UserMenu name="Chidi Okafor" role="Admin" />)
    expect(m.host.querySelector('button')).toBeNull()
    expect(m.host.textContent).toContain('Chidi Okafor')
    await m.unmount()
  })
})
