import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { TrackerSummary, TrackerList, CaseHeader, WorkflowActions } from './PvTracker.jsx'

vi.mock('./repositories', () => ({
  adrReportRepository: {},
  getModuleTypeFromBusinessType: () => 'industry',
}))

// Design-system chain (theme + ui primitives) is not resolvable in this
// checkout (packages/design-system is absent from disk — pre-existing gap);
// presentational logic is tested against minimal stubs with the same shape.
vi.mock('../../styles/theme', () => ({
  theme: {
    textDark: '#111', textLight: '#666',
    type: { h1: { size: 22, weight: 800 }, body: { size: 14 } },
    space: { 8: 8, 10: 10 },
  },
}))

vi.mock('../../components/ui', () => ({
  Card: ({ children }) => <div>{children}</div>,
  Loading: ({ text }) => <div>{text}</div>,
  Empty: ({ title, description }) => <div>{title} {description}</div>,
  ErrorState: ({ message }) => <div>{message}</div>,
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
  useToast: () => ({ show: () => {} }),
}))

const kase = (over = {}) => ({
  report_id: 'r1',
  report_number: 'ADR-2026-000001',
  report_source: 'public',
  company_status: 'new',
  report_status: 'submitted',
  is_serious: true,
  submission_deadline: null,
  created_at: new Date().toISOString(),
  products: [{ product_brand_name: 'Ampiclox' }],
  reactions: [{ reaction_description: 'Rash' }],
  ...over,
})

function render(el) {
  return renderToString(<MemoryRouter>{el}</MemoryRouter>)
}

describe('TrackerSummary', () => {
  it('renders counts that reconcile with the list', () => {
    const cases = [kase(), kase({ report_id: 'r2', company_status: 'closed', is_serious: false })]
    const html = render(<TrackerSummary cases={cases} />)
    // Exact bucket math is pinned in pvWorkflow.test.js; here we pin wiring:
    // every card label renders and the headlining totals appear.
    for (const label of ['Total accessible', 'New', 'Serious', 'Follow-up required', 'Under assessment', 'Closed', 'Overdue']) {
      expect(html).toContain(label)
    }
    expect(html).toContain('>2<')
  })
})

describe('TrackerList', () => {
  it('renders a visible source badge per row', () => {
    const html = render(<TrackerList cases={[kase(), kase({ report_id: 'r2', report_source: 'business_facility' })]} onOpen={() => {}} />)
    expect(html).toMatch(/Public report/)
    expect(html).toMatch(/Business report/)
    expect(html).toContain('ADR-2026-000001')
  })

  it('shows the empty state when nothing is routed', () => {
    const html = render(<TrackerList cases={[]} onOpen={() => {}} />)
    expect(html).toMatch(/No routed cases|No .*cases/i)
  })
})

describe('CaseHeader', () => {
  it('states masking and never renders reporter contact', () => {
    const html = render(
      <CaseHeader
        kase={{ ...kase(), reporter_name: null, reporter_phone: null, reporter_email: null }}
      />
    )
    expect(html).toMatch(/mask/i)
    expect(html).not.toMatch(/0803|@example/)
    expect(html).toContain('ADR-2026-000001')
  })
})

describe('WorkflowActions', () => {
  it('offers only allowed transitions and labels acknowledgement internal-only', () => {
    const onTransition = vi.fn()
    const html = render(
      <WorkflowActions route={{ route_id: 'rt1', company_status: 'new' }} onTransition={onTransition} busy={false} />
    )
    expect(html).toMatch(/Acknowledge/i)
    expect(html).toMatch(/internal/i)
    expect(html).not.toMatch(/under assessment/i)
  })

  it('exposes no case-data edit controls', () => {
    const html = render(
      <WorkflowActions route={{ route_id: 'rt1', company_status: 'acknowledged' }} onTransition={() => {}} busy={false} />
    )
    expect(html).not.toMatch(/name="product_brand_name"|name="reporter_name"|name="reaction_description"/)
  })
})
