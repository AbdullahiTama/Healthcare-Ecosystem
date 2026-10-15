import { useEffect, useRef, useState } from 'react'
import { PUBLIC_COMPANY_LABEL, COMPANY_KINDS } from './constants.js'
import { Field, TextInput, s } from './ui.jsx'

// ── CompanyPicker ──────────────────────────────────────────────────────────
// One verified selection, explicit "I don't know", or manual unverified text.
// Manual text is stored as a candidate only and can never verify an org.

export default function CompanyPicker({ value, onChange, searchCompanies }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const timer = useRef(null)

  const setKind = (kind) => {
    if (kind === COMPANY_KINDS.VERIFIED) onChange({ ...value, kind })
    else if (kind === COMPANY_KINDS.UNKNOWN) onChange({ kind, businessId: '', businessName: '', candidateName: '' })
    else onChange({ ...value, kind })
  }

  useEffect(() => {
    if (value.kind !== COMPANY_KINDS.VERIFIED) return
    clearTimeout(timer.current)
    if (!query.trim()) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    timer.current = setTimeout(async () => {
      try {
        const rows = await searchCompanies(query.trim(), 10)
        setResults(rows || [])
        setSearchError(null)
      } catch {
        setSearchError('Company search is unavailable right now. You can continue with “I can’t find the company”.')
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer.current)
  }, [query, value.kind, searchCompanies])

  return (
    <div>
      <span id="sr-company-label" style={s.label}>{PUBLIC_COMPANY_LABEL}</span>
      <div role="group" aria-labelledby="sr-company-label">
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, marginTop: 6, cursor: 'pointer' }}>
          <input type="radio" name="sr-company-kind" checked={value.kind === COMPANY_KINDS.VERIFIED} onChange={() => setKind(COMPANY_KINDS.VERIFIED)} style={{ marginTop: 3 }} />
          <span>Select the company{value.businessName ? `: ${value.businessName}` : ''}</span>
        </label>

        {value.kind === COMPANY_KINDS.VERIFIED && (
          <div style={{ marginTop: 6 }}>
            <TextInput
              aria-label="Search registered companies"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type the company name…"
              maxLength={120}
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls="sr-company-results"
              autoComplete="off"
            />
            {searching && <p style={s.help} role="status">Searching…</p>}
            {searchError && <p style={s.error} role="alert">{searchError}</p>}
            {!searching && query.trim() && results.length === 0 && !searchError && (
              <p style={s.help} role="status">No registered company matches. Try “I can’t find the company” below.</p>
            )}
            {results.length > 0 && (
              <ul id="sr-company-results" role="listbox" aria-label="Matching companies" style={{ listStyle: 'none', padding: 0, margin: '6px 0 0', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                {results.map((c) => (
                  <li key={c.business_id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={value.businessId === c.business_id}
                      onClick={() => onChange({ kind: COMPANY_KINDS.VERIFIED, businessId: c.business_id, businessName: c.business_name, candidateName: '' })}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left', fontSize: 14,
                        padding: '9px 12px', cursor: 'pointer', background: value.businessId === c.business_id ? 'var(--teal-mist)' : '#fff',
                        border: 'none', borderBottom: '1px solid var(--hairline)',
                      }}
                    >
                      {c.business_name}
                      {c.matched_alias && <span style={s.help}> — also known as “{c.matched_alias}”</span>}
                      {(c.city || c.state) && <span style={{ ...s.help, display: 'block' }}>{[c.city, c.state].filter(Boolean).join(', ')}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, marginTop: 8, cursor: 'pointer' }}>
          <input type="radio" name="sr-company-kind" checked={value.kind === COMPANY_KINDS.UNKNOWN} onChange={() => setKind(COMPANY_KINDS.UNKNOWN)} style={{ marginTop: 3 }} />
          <span>I don’t know</span>
        </label>

        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, marginTop: 8, cursor: 'pointer' }}>
          <input type="radio" name="sr-company-kind" checked={value.kind === COMPANY_KINDS.UNVERIFIED_CANDIDATE} onChange={() => setKind(COMPANY_KINDS.UNVERIFIED_CANDIDATE)} style={{ marginTop: 3 }} />
          <span>I can’t find the company</span>
        </label>

        {value.kind === COMPANY_KINDS.UNVERIFIED_CANDIDATE && (
          <div style={{ marginTop: 6 }}>
            <Field label="Company name as printed on the pack" htmlFor="sr-company-manual" help="We store this as an unverified note only. It does not give any company access to your report.">
              <TextInput
                id="sr-company-manual"
                value={value.candidateName}
                onChange={(e) => onChange({ ...value, candidateName: e.target.value })}
                maxLength={160}
                placeholder="Type the name exactly as printed"
                autoComplete="off"
              />
            </Field>
          </div>
        )}
      </div>
    </div>
  )
}
