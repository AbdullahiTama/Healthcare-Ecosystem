import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import CompanySelector, { describeRoute } from './CompanySelector.jsx'

vi.mock('../../styles/theme', () => ({
  theme: {
    textDark: '#111', textLight: '#666', navy: '#001', gray100: '#eee',
  },
}))

vi.mock('../../components/ui', () => ({
  Card: ({ children }) => <div>{children}</div>,
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
  Input: ({ label, ...props }) => <label>{label}<input {...props} /></label>,
  Empty: ({ message }) => <div>{message}</div>,
}))

function render(el) {
  return renderToString(el)
}

describe('describeRoute', () => {
  it('labels a verified route with the business name and status', () => {
    expect(describeRoute({ selection_kind: 'verified', status: 'routed' }, 'Acme Ltd'))
      .toBe('Acme Ltd — routed')
  })

  it('labels unknown and candidate selections without implying access', () => {
    expect(describeRoute({ selection_kind: 'unknown', status: 'pending' }, null))
      .toBe('Unknown company')
    expect(describeRoute({ selection_kind: 'unverified_candidate', status: 'pending', candidate_name: 'Typed Co' }, null))
      .toBe('Typed Co (unverified — no access granted)')
  })
})

describe('CompanySelector', () => {
  const base = { kind: 'unknown', businessId: '', businessName: '', candidateName: '' }

  it('renders the three selection modes with the public label', () => {
    const html = render(
      <CompanySelector value={base} onChange={() => {}} searchCompanies={vi.fn()} />
    )
    expect(html).toContain('Company responsible for this medicine/product in your country')
    expect(html).toContain('I don’t know')
    expect(html).toContain('can’t find the company')
  })

  it('reports an unknown selection', () => {
    const onChange = vi.fn()
    render(<CompanySelector value={base} onChange={onChange} searchCompanies={vi.fn()} />)
    expect(base.kind).toBe('unknown')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('passes a picked verified company with id and name', () => {
    const onChange = vi.fn()
    const searchCompanies = vi.fn(async () => ([
      { business_id: 'b1', business_name: 'Fidson', business_type: 'manufacturer_importer', city: 'Lagos', state: 'Lagos', matched_alias: null },
    ]))
    const html = render(
      <CompanySelector
        value={{ ...base, kind: 'verified' }}
        onChange={onChange}
        searchCompanies={searchCompanies}
      />
    )
    expect(html).toContain('Search registered companies')
    // Selection itself flows through onChange (picked in the browser from results).
    onChange({ kind: 'verified', businessId: 'b1', businessName: 'Fidson', candidateName: '' })
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'verified', businessId: 'b1' })
    )
  })

  it('captures manual candidate text without a business id', () => {
    const onChange = vi.fn()
    const html = render(
      <CompanySelector
        value={{ ...base, kind: 'unverified_candidate', candidateName: 'Acme Labs' }}
        onChange={onChange}
        searchCompanies={vi.fn()}
      />
    )
    expect(html).toContain('Acme Labs')
    expect(html).toMatch(/unverified/i)
  })
})
