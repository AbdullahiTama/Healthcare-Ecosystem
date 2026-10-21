import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { safetyReportRepository as defaultRepository } from './repository'
import { s, Field, TextInput } from './ui.jsx'

// Where a safety report is, by its ADR number. The lookup returns stage names only:
// no patient details, narrative, company name or reviewer notes ever reach this page.
// Anyone signed in can ask; the server answers only for the reporter, or for someone
// who also gives the e-mail or phone the report was made with.

const NUMBER_RE = /^ADR-\d{4}-\d{6}$/

export const STAGE_TEXT = {
  received: ['Received', 'Your report has been received and is waiting for review by the safety team.'],
  in_review: ['Being reviewed', 'The safety team is checking your report before it is passed on.'],
  sent_to_company: ['Sent to the company', 'Your report has been passed to the company responsible for the product.'],
  acknowledged_by_company: ['Acknowledged by the company', 'The company has confirmed it received your report.'],
  under_assessment: ['Under assessment', 'The company is assessing your report.'],
  closed: ['Closed', 'The review of your report is complete.'],
}

export function problemMessage(e) {
  const msg = String(e?.message || '')
  if (/too_many_attempts/.test(msg)) return 'Too many attempts that did not match a report. Please wait about 15 minutes and try again.'
  if (/sign_in_required|jwt|not authenticated/i.test(msg)) return 'Please sign in to check a report.'
  return 'Could not check this report right now. Check your connection and try again.'
}

function initialRef() {
  try { return (new URLSearchParams(window.location.search).get('ref') || '').toUpperCase() } catch { return '' }
}

export default function TrackReportPage({ repository = defaultRepository }) {
  const [number, setNumber] = useState(initialRef)
  const [contact, setContact] = useState('')
  const [state, setState] = useState({ status: 'idle' }) // idle | loading | found | missing | error
  const headingRef = useRef(null)
  const autoRan = useRef(false)

  useEffect(() => { headingRef.current?.focus?.() }, [])

  const normalised = number.trim().toUpperCase()
  const formatOk = NUMBER_RE.test(normalised)

  async function lookup(num = normalised, who = contact) {
    if (!NUMBER_RE.test(num)) { setState({ status: 'missing', reason: 'format' }); return }
    setState({ status: 'loading' })
    try {
      const res = await repository.trackReport(num, who)
      setState(res?.found ? { status: 'found', report: res } : { status: 'missing' })
    } catch (e) {
      console.error('[TrackReport] lookup failed:', e?.message)
      setState({ status: 'error', message: problemMessage(e) })
    }
  }

  // Arriving from the receipt screen (?ref=ADR-...): the reporter is signed in, so look it up straight away.
  useEffect(() => {
    if (!autoRan.current && NUMBER_RE.test(initialRef())) { autoRan.current = true; lookup(initialRef(), '') }
  }, [])

  const busy = state.status === 'loading'

  return (
    <main style={s.page} aria-labelledby="tr-h">
      <h1 id="tr-h" tabIndex={-1} ref={headingRef} style={s.h1}>Track a safety report</h1>
      <div style={s.card}>
        <form onSubmit={(e) => { e.preventDefault(); lookup() }} noValidate>
          <Field label="ADR number" required htmlFor="tr-number"
            help="It looks like ADR-2026-000123 and was shown when you submitted the report."
            error={number && !formatOk && state.status === 'missing' ? 'Check the number: ADR, the year, then six digits.' : null}>
            <TextInput id="tr-number" value={number} autoComplete="off" autoCapitalize="characters" spellCheck={false}
              onChange={(e) => setNumber(e.target.value)} placeholder="ADR-2026-000123" />
          </Field>
          <Field label="E-mail or phone used on the report (only if you are not signed in as the reporter)" htmlFor="tr-contact">
            <TextInput id="tr-contact" value={contact} autoComplete="off" onChange={(e) => setContact(e.target.value)} />
          </Field>
          <div style={{ ...s.row, marginTop: 12 }}>
            <button type="submit" style={s.btnPrimary} disabled={busy || !number.trim()}>{busy ? 'Checking…' : 'Check report'}</button>
          </div>
        </form>

        <div role="status" aria-live="polite">
          {state.status === 'missing' && state.reason !== 'format' && (
            <p style={s.error}>We could not find a report that matches. Check the number, and add the e-mail or phone you used on the report if you are not signed in as the reporter.</p>
          )}
        </div>
        {state.status === 'error' && <p style={s.error} role="alert">{state.message}</p>}
      </div>

      {state.status === 'found' && (
        <div style={s.card} aria-label={`Status of report ${state.report.report_number}`}>
          <h2 style={s.h2}>{state.report.report_number}</h2>
          {state.report.submitted_at && <p style={s.muted}>Submitted {new Date(state.report.submitted_at).toLocaleDateString()}</p>}
          {(state.report.products || []).length === 0 && <p style={s.body}>Received.</p>}
          {(state.report.products || []).map((p, i) => {
            const [title, text] = STAGE_TEXT[p.stage] || STAGE_TEXT.received
            return (
              <div key={i} style={{ borderTop: i ? '1px solid var(--border)' : 'none', paddingTop: i ? 10 : 0, marginTop: i ? 10 : 6 }}>
                <p style={{ ...s.body, fontWeight: 700, marginBottom: 2 }}>{p.product}</p>
                <p style={{ ...s.body, color: 'var(--teal)', fontWeight: 800, marginBottom: 2 }}>{title}</p>
                <p style={s.muted}>{text}</p>
              </div>
            )
          })}
          <p style={{ ...s.muted, marginTop: 12 }}>This page shows progress only. It does not show the details of your report.</p>
        </div>
      )}

      <p style={s.muted}><Link to="/report-side-effect">Report a side effect</Link> · <Link to="/feed">Back to feed</Link></p>
    </main>
  )
}
