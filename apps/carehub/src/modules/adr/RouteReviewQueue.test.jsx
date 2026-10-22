import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { QueueCard } from './RouteReviewQueue.jsx'

// Same stub approach as PvTracker.test.jsx: the design-system chain is not
// resolvable in this checkout, so presentation is tested against minimal stubs.
vi.mock('./repositories', () => ({ adrReportRepository: {} }))
vi.mock('../../components/ui', () => ({
  Card: ({ children }) => <div>{children}</div>,
  Loading: ({ text }) => <div>{text}</div>,
  Empty: ({ title, description }) => <div>{title} {description}</div>,
  ErrorState: ({ message }) => <div>{message}</div>,
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
  Input: (props) => <input {...props} />,
  Textarea: (props) => <textarea {...props} />,
  useToast: () => ({ show: () => {} }),
}))

const row = (over = {}) => ({
  route_id: 'rt1', report_id: 'r1', report_number: 'ADR-2026-000001',
  submitted_at: '2026-10-20T10:00:00Z', is_serious: false,
  product_brand_name: 'Ampiclox', product_generic_name: null,
  selection_kind: 'verified', selected_business_id: 'b1', selected_business_name: 'Acme Pharma Ltd',
  selected_business_state: 'Lagos', selected_business_eligible: true, candidate_name: null,
  match_evidence: { manufacturer_text: 'Acme', selected_name_matches_manufacturer_text: true },
  suggestions: [], held_at: null, held_reason: null,
  ...over,
})
const render = (r) => renderToString(<QueueCard row={r} repository={{}} onDecided={() => {}} />)

describe('QueueCard', () => {
  it('shows the case reference, product and the reporter-selected company without calling it verified', () => {
    const html = render(row())
    expect(html).toContain('ADR-2026-000001')
    expect(html).toContain('Ampiclox')
    expect(html).toContain('Acme Pharma Ltd')
    expect(html).toContain('not independently verified')
    expect(html).toContain('currently eligible')
  })

  it('distinguishes a typed company from a registered selection', () => {
    const html = render(row({ selection_kind: 'unverified_candidate', selected_business_id: null, selected_business_name: null, candidate_name: 'Acme Pharm', selected_business_eligible: null }))
    expect(html).toContain('Reporter typed')
    expect(html).toContain('Acme Pharm')
    expect(html).toContain('no registry match')
    expect(html).not.toContain('currently eligible')
  })

  it('flags a selected company that is no longer eligible', () => {
    expect(render(row({ selected_business_eligible: false }))).toContain('no longer eligible')
  })

  it('shows the hold reason on a held route', () => {
    const html = render(row({ held_at: '2026-10-20T11:00:00Z', held_reason: 'confirm licence' }))
    expect(html).toContain('On hold since')
    expect(html).toContain('confirm licence')
  })

  it('carries the alert deep-link anchor and highlight only when asked', () => {
    const plain = render(row())
    expect(plain).not.toContain('id="adr-')
    expect(plain).not.toContain('aria-current')
    const linked = renderToString(<QueueCard row={row()} repository={{}} onDecided={() => {}} highlighted anchorId="adr-r1" />)
    expect(linked).toContain('id="adr-r1"')
    expect(linked).toContain('aria-current="true"')
  })

  it('does not render any patient or reporter fields', () => {
    const html = render(row({ patient_identifier: 'AB-PATIENT', reporter_name: 'Ada Okoro', reporter_phone: '0803' }))
    expect(html).not.toMatch(/AB-PATIENT|Ada Okoro|0803/)
  })
})
