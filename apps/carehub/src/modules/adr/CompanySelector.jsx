import { useState } from 'react'
import { Button, Input } from '../../components/ui'
import { theme } from '../../styles/theme'
import { PUBLIC_COMPANY_LABEL, ROUTE_SELECTION_KINDS } from './routing'

// ── CompanySelector ─────────────────────────────────────────────────────────
// Optional per-product responsible-company picker for the CareHub ADR form.
// Three modes: verified pick from the eligible-company type-ahead, explicit
// "I don't know", or manual candidate text. Manual text is stored as an
// unverified candidate only and can never verify an organisation (enforced
// again server-side). Hub rows may carry more than one selection — this
// control appends; it never edits or removes existing routes.

export function describeRoute(route, businessName) {
  if (!route) return 'Not set'
  if (route.selection_kind === 'verified') {
    return `${businessName || 'Verified company'} (${route.status || 'pending'})`
  }
  if (route.selection_kind === 'unverified_candidate') {
    return `${route.candidate_name || 'Typed name'} (unverified, no access granted)`
  }
  return 'Unknown company'
}

const KIND_LABELS = {
  verified: 'Select the company',
  unknown: 'I don’t know',
  unverified_candidate: 'I can’t find the company',
}

export default function CompanySelector({ value, onChange, searchCompanies, disabled }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)

  const setKind = (kind) => {
    if (kind === 'verified') onChange({ ...value, kind })
    else if (kind === 'unknown') onChange({ kind: 'unknown', businessId: '', businessName: '', candidateName: '' })
    else onChange({ ...value, kind })
  }

  async function runSearch() {
    setSearching(true)
    setSearchError(null)
    try {
      const rows = await searchCompanies(query.trim(), 10)
      setResults(rows || [])
    } catch (e) {
      setSearchError('Company search is unavailable right now. You can continue with “I can’t find the company”.')
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: theme.textDark, marginBottom: 4 }}>
        {PUBLIC_COMPANY_LABEL}
      </span>
      <div role="group" aria-label="Responsible company selection">
        {ROUTE_SELECTION_KINDS.map((kind) => (
          <label key={kind} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13.5, marginTop: 6, cursor: disabled ? 'default' : 'pointer' }}>
            <input
              type="radio"
              name="adr-company-kind"
              checked={value.kind === kind}
              onChange={() => setKind(kind)}
              disabled={disabled}
              style={{ marginTop: 3 }}
            />
            <span>
              {KIND_LABELS[kind]}
              {kind === 'verified' && value.businessName ? `: ${value.businessName}` : ''}
            </span>
          </label>
        ))}

        {value.kind === 'verified' && (
          <div style={{ marginTop: 6 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <Input
                aria-label="Search registered companies"
                value={query}
                onChange={setQuery}
                placeholder="Type the company name…"
                disabled={disabled}
              />
              <Button variant="secondary" size="sm" onClick={runSearch} disabled={disabled || searching}>
                {searching ? 'Searching…' : 'Search'}
              </Button>
            </div>
            {searchError && <p role="alert" style={{ fontSize: 12.5, color: theme.danger || '#b91c1c', marginTop: 4 }}>{searchError}</p>}
            {!searching && results.length === 0 && query.trim() && !searchError && (
              <p role="status" style={{ fontSize: 12.5, color: theme.textLight, marginTop: 4 }}>No registered company matches. Try “I can’t find the company”.</p>
            )}
            {results.length > 0 && (
              <ul aria-label="Matching companies" style={{ listStyle: 'none', padding: 0, margin: '6px 0 0', border: `1px solid ${theme.gray100}`, borderRadius: 8, overflow: 'hidden' }}>
                {results.map((c) => (
                  <li key={c.business_id}>
                    <button
                      type="button"
                      onClick={() => onChange({ kind: 'verified', businessId: c.business_id, businessName: c.business_name, candidateName: '' })}
                      disabled={disabled}
                      aria-pressed={value.businessId === c.business_id}
                      style={{ display: 'block', width: '100%', textAlign: 'left', fontSize: 13.5, padding: '8px 10px', cursor: 'pointer', background: value.businessId === c.business_id ? theme.tealMist || '#e6f4ef' : '#fff', border: 'none', borderBottom: `1px solid ${theme.gray100}` }}
                    >
                      {c.business_name}
                      {c.matched_alias && <span style={{ fontSize: 12, color: theme.textLight }}> also known as “{c.matched_alias}”</span>}
                      {(c.city || c.state) && <span style={{ display: 'block', fontSize: 12, color: theme.textLight }}>{[c.city, c.state].filter(Boolean).join(', ')}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {value.kind === 'unverified_candidate' && (
          <div style={{ marginTop: 6 }}>
            <Input
              label="Company name as printed on the pack"
              value={value.candidateName}
              onChange={(v) => onChange({ ...value, candidateName: v })}
              placeholder="Type the name exactly as printed"
              disabled={disabled}
            />
            <p style={{ fontSize: 12, color: theme.textLight, marginTop: 2 }}>
              Stored as an unverified note only. It does not give any company access to this report.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
