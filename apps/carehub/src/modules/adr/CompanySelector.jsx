import { useState, useEffect, useRef } from 'react'
import { Button, Input } from '../../components/ui'
import { theme } from '../../styles/theme'
import { PUBLIC_COMPANY_LABEL, ROUTE_SELECTION_KINDS } from './routing'

// ── CompanySelector ─────────────────────────────────────────────────────────
// Optional per-product responsible-company picker for the CareHub ADR form.
// Three modes: a registered Manufacturer / Importer from the eligible-company
// search, explicit "I don't know", or manual candidate text. Manual text is
// stored as an unverified candidate only and can never verify an organisation
// (enforced again server-side). On a draft, a new choice replaces the
// product's earlier one (carehub_20270130_adr_facility_company_routing); at
// submission a registered company receives the case in its PV Tracker, and
// anything else goes to a platform reviewer.

// `submitted`: the report has left the draft state, so a pending route is
// waiting for a reviewer rather than for the submission.
export function describeRoute(route, businessName, { submitted = false } = {}) {
  if (!route) return 'Not set'
  if (route.selection_kind === 'verified') {
    const name = businessName || 'Registered company'
    if (route.status === 'routed' || route.status === 'verified') return `${name} (sent to the company)`
    return `${name} (${submitted ? 'awaiting review' : 'will be sent when you submit'})`
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

// How long typing pauses before the list is filtered.
export const SEARCH_DEBOUNCE_MS = 250

// `suggestedQuery`: what the reporter typed as the manufacturer, used as the
// first search so the likely company is already on the list.
export default function CompanySelector({ value, onChange, searchCompanies, disabled, suggestedQuery = '' }) {
  const [query, setQuery] = useState(() => (value.kind === 'verified' && !value.businessId ? (suggestedQuery || '').trim() : ''))
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const latest = useRef(0)

  const setKind = (kind) => {
    if (kind === 'verified') onChange({ ...value, kind })
    else if (kind === 'unknown') onChange({ kind: 'unknown', businessId: '', businessName: '', candidateName: '' })
    else onChange({ ...value, kind })
  }

  // Only the newest search may update the list (a slow earlier reply must not
  // replace a later one).
  async function runSearch(text = query) {
    const ticket = ++latest.current
    setSearching(true)
    setSearchError(null)
    try {
      const rows = await searchCompanies(text.trim(), 20)
      if (ticket !== latest.current) return
      setResults(rows || [])
    } catch (e) {
      if (ticket !== latest.current) return
      console.warn('[adr] company search failed', e?.message || e)
      setSearchError('Company search is unavailable right now. You can continue with “I can’t find the company”.')
      setResults([])
    } finally {
      if (ticket === latest.current) { setSearching(false); setSearched(true) }
    }
  }

  // The registered companies are listed as soon as "Select the company" is
  // chosen, and the list follows what is typed. Before, nothing appeared until
  // a name was typed and Search pressed, so it looked as if there was nothing
  // to choose from.
  const kindIsVerified = value.kind === 'verified'
  useEffect(() => {
    if (!kindIsVerified || disabled) return
    const t = setTimeout(() => { runSearch(query) }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
    // runSearch reads only its argument and stable setters, so it is not a dependency.
  }, [kindIsVerified, query, disabled])

  return (
    <div style={{ marginTop: 10 }}>
      <span id="adr-company-label" style={{ display: 'block', fontSize: 13, fontWeight: 700, color: theme.textDark, marginBottom: 4 }}>
        {PUBLIC_COMPANY_LABEL}
      </span>
      <p id="adr-company-help" style={{ fontSize: 12, color: theme.textLight, margin: '0 0 4px' }}>
        When you submit, the report is sent to the registered manufacturer or importer you select here, in its
        pharmacovigilance tracker. Your name and contact details are not shown to the company.
      </p>
      <div role="group" aria-labelledby="adr-company-label" aria-describedby="adr-company-help">
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
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(query) } }}
                placeholder="Type the company name…"
                disabled={disabled}
              />
              <Button variant="secondary" size="sm" onClick={() => runSearch(query)} disabled={disabled || searching}>
                {searching ? 'Searching…' : 'Search'}
              </Button>
            </div>
            {searchError && <p role="alert" style={{ fontSize: 12.5, color: theme.danger || '#b91c1c', marginTop: 4 }}>{searchError}</p>}
            {searching && results.length === 0 && (
              <p role="status" style={{ fontSize: 12.5, color: theme.textLight, marginTop: 4 }}>Loading registered companies…</p>
            )}
            {!searching && searched && results.length === 0 && !searchError && (
              <p role="status" style={{ fontSize: 12.5, color: theme.textLight, marginTop: 4 }}>
                {query.trim() ? 'No registered company matches. Try another spelling, or “I can’t find the company”.' : 'No manufacturer or importer is registered yet. Use “I can’t find the company”.'}
              </p>
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
