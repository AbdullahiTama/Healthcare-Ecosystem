import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import PvAnalytics from './PvAnalytics.jsx'

vi.mock('../../styles/theme', () => ({
  theme: { textDark: '#111', textLight: '#666', navy: '#001' },
}))

vi.mock('../../components/ui', () => ({
  Card: ({ children }) => <div>{children}</div>,
  Loading: ({ text }) => <div>{text}</div>,
  Empty: ({ title, description }) => <div>{title} {description}</div>,
  ErrorState: ({ message }) => <div>{message}</div>,
}))

const rxn = (over = {}) => ({
  reaction_description: 'Rash', severity: 'moderate', outcome: 'recovering',
  seriousness_death: false, seriousness_life_threatening: false,
  seriousness_hospitalization: false, seriousness_disability: false,
  seriousness_congenital_anomaly: false, seriousness_other_medically_important: false,
  ...over,
})

const kase = (over = {}) => ({
  report_id: 'r1', report_number: 'ADR-1', report_source: 'public',
  reporter_qualification: 'consumer', created_at: '2026-08-01T00:00:00Z',
  reactions: [rxn()], products: [{ product_brand_name: 'Ampiclox', batch_lot_number: 'L1' }],
  ...over,
})

const props = (cases, extra = {}) => ({
  cases,
  periodLabel: 'Last 6 months',
  activeFilters: 'All sources',
  onDrill: () => {},
  ...extra,
})

describe('PvAnalytics', () => {
  it('states the suspected-reaction disclaimer and the denominator', () => {
    const html = renderToString(<PvAnalytics {...props([kase()])} />)
    expect(html).toMatch(/suspected/i)
    expect(html).toMatch(/do not establish/i)
    expect(html).toMatch(/n = 1/)
  })

  it('shows an insufficient-data state when records are sparse', () => {
    const html = renderToString(<PvAnalytics {...props([kase(), kase({ report_id: 'r2' })])} />)
    expect(html).toMatch(/insufficient|limited data/i)
  })

  it('suppresses small groups instead of printing rare counts', () => {
    const cases = [kase(), kase({ report_id: 'r2', reactions: [rxn({ reaction_description: 'Fever' })] })]
    const html = renderToString(<PvAnalytics {...props(cases)} />)
    expect(html).toMatch(/suppressed/i)
    // The rare term's count must not appear next to it.
    expect(html).not.toMatch(/Fever[^<]*2|[^0-9]1[^0-9]*Fever/)
  })

  it('renders unsuppressed leaders with drill affordances', () => {
    const many = Array.from({ length: 7 }, (_, i) => kase({ report_id: `r${i}`, reactions: [rxn()] }))
    const html = renderToString(<PvAnalytics {...props(many)} />)
    expect(html).toContain('rash')
    expect(html).toMatch(/button/i)
  })

  it('names the geographic limitation instead of guessing', () => {
    const html = renderToString(<PvAnalytics {...props([kase()])} />)
    expect(html).toMatch(/location|geograph/i)
  })
})
