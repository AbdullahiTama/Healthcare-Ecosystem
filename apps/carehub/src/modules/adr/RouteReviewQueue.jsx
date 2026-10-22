import { useState, useEffect, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { adrReportRepository as defaultRepository } from './repositories'
import { availableActions, validateReviewInput, selectionBasis, reviewActionLabel } from './routeReview'
import { reviewAnchorId } from './reviewLink'
import { Card, Loading, Empty, ErrorState, Button, Input, Textarea, useToast } from '../../components/ui'

// ── Reviewer routing queue (platform reviewers) ─────────────────────────────
// Public safety reports are not routed automatically. A reviewer approves,
// redirects or holds each product route; only then can the responsible company
// see the case. Everything shown here is routing metadata: no patient or
// reporter details. Match evidence and suggestions are advice, not routing.
// Authorisation is enforced by the database (is_platform_admin() inside every
// RPC); this screen only shapes the request.

function fmtDateTime(d) {
  if (!d) return 'Not recorded'
  return new Date(d).toLocaleString('en-NG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function ReviewForm({ row, repository, onDone }) {
  const actions = availableActions(row)
  const [action, setAction] = useState(actions[0])
  const [reason, setReason] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [target, setTarget] = useState(null)
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function search() {
    setSearching(true)
    setError(null)
    try {
      setResults((await repository.searchEligibleCompanies(query.trim(), 10)) || [])
    } catch {
      setError('Company search is unavailable right now.')
    } finally {
      setSearching(false)
    }
  }

  async function submit() {
    const problem = validateReviewInput({ action, reason, businessId: target?.business_id })
    if (problem) { setError(problem); return }
    setBusy(true)
    setError(null)
    try {
      const out = await repository.reviewRoute({ routeId: row.route_id, action, reason: reason.trim(), businessId: action === 'redirect' ? target.business_id : null })
      onDone(out)
    } catch (e) {
      setError(e?.message || 'The decision could not be saved. Nothing was changed.')
      setBusy(false)
    }
  }

  const suggestions = Array.isArray(row.suggestions) ? row.suggestions : []

  return (
    <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <div role="radiogroup" aria-label="Review action" style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {actions.map((a) => (
          <label key={a} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
            <input type="radio" name={`act-${row.route_id}`} checked={action === a} onChange={() => { setAction(a); setError(null) }} />
            {reviewActionLabel(a)}
          </label>
        ))}
      </div>

      {action === 'redirect' && (
        <div style={{ marginTop: 8 }}>
          {suggestions.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Possible matches by name (suggestions only; confirm before choosing):</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {suggestions.map((s) => (
                  <Button key={s.business_id} size="sm" variant={target?.business_id === s.business_id ? 'primary' : 'secondary'}
                    onClick={() => setTarget({ business_id: s.business_id, business_name: s.name })}>
                    {s.name}{s.state ? ` · ${s.state}` : ''}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <Input aria-label="Search registered companies" value={query} onChange={setQuery} placeholder="Search registered Importer/Manufacturer…" />
            <Button variant="secondary" size="sm" onClick={search} disabled={searching}>{searching ? 'Searching…' : 'Search'}</Button>
          </div>
          {results.length > 0 && (
            <ul aria-label="Matching companies" style={{ listStyle: 'none', padding: 0, margin: '6px 0 0', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              {results.map((c) => (
                <li key={c.business_id}>
                  <button type="button" aria-pressed={target?.business_id === c.business_id}
                    onClick={() => setTarget({ business_id: c.business_id, business_name: c.business_name })}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', fontSize: 13, background: target?.business_id === c.business_id ? 'var(--hairline)' : 'transparent', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', color: 'var(--fg)' }}>
                    {c.business_name}{c.matched_alias ? ` (also known as ${c.matched_alias})` : ''}
                    {(c.city || c.state) && <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)' }}>{[c.city, c.state].filter(Boolean).join(', ')}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {target && <p role="status" style={{ fontSize: 13, marginTop: 6 }}>Route to: <strong>{target.business_name}</strong></p>}
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <Textarea aria-label="Reason for this decision" value={reason} onChange={setReason} rows={2}
          placeholder="Reason (required, recorded in the case audit trail)" />
      </div>
      {error && <p role="alert" style={{ fontSize: 13, color: 'var(--red, #b91c1c)', marginTop: 6 }}>{error}</p>}
      <div style={{ marginTop: 8 }}>
        <Button variant="primary" size="md" onClick={submit} disabled={busy}>{busy ? 'Saving…' : reviewActionLabel(action)}</Button>
      </div>
    </div>
  )
}

// `anchorId` is set on one card per linked report (a report can have several
// product routes) so the alert deep link has exactly one DOM target.
export function QueueCard({ row, repository, onDecided, highlighted = false, anchorId }) {
  const [open, setOpen] = useState(false)
  const ev = row.match_evidence || {}
  return (
    <Card style={{ padding: '12px 14px', ...(highlighted ? { outline: '2px solid var(--teal)', outlineOffset: 2 } : null) }}>
      <div role="listitem" id={anchorId} tabIndex={anchorId ? -1 : undefined} aria-current={highlighted ? 'true' : undefined}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <strong style={{ fontSize: 15 }}>{row.report_number || row.report_id}</strong>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {row.is_serious ? 'Serious · ' : ''}Submitted {fmtDateTime(row.submitted_at)}
          </span>
        </div>
        <div style={{ fontSize: 13.5, marginTop: 4 }}>
          Product: <strong>{row.product_brand_name || 'Not listed'}</strong>
          {row.product_generic_name ? ` (${row.product_generic_name})` : ''}
          {ev.manufacturer_text ? ` · manufacturer on report: ${ev.manufacturer_text}` : ''}
        </div>
        <div style={{ fontSize: 13, marginTop: 4 }}>
          {row.selection_kind === 'verified' && (
            <>Reporter selected <strong>{row.selected_business_name || 'a registered company'}</strong>
              {row.selected_business_state ? ` (${row.selected_business_state})` : ''}
              {' · '}{row.selected_business_eligible ? 'currently eligible' : <strong>no longer eligible</strong>}</>
          )}
          {row.selection_kind === 'unverified_candidate' && <>Reporter typed: <strong>{row.candidate_name}</strong></>}
          {row.selection_kind === 'unknown' && <>Reporter did not know the company</>}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
          {selectionBasis(row)}
          {ev.selected_name_matches_manufacturer_text === true && ' · selected name matches the manufacturer on the report'}
          {ev.selected_name_matches_manufacturer_text === false && ' · selected name does not match the manufacturer on the report'}
        </div>
        {row.held_at && (
          <div role="status" style={{ fontSize: 13, marginTop: 6 }}>
            On hold since {fmtDateTime(row.held_at)}: {row.held_reason}
          </div>
        )}
        {!open ? (
          <div style={{ marginTop: 8 }}>
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Review</Button>
          </div>
        ) : (
          <ReviewForm row={row} repository={repository} onDone={(out) => { setOpen(false); onDecided(row, out) }} />
        )}
      </div>
    </Card>
  )
}

export default function RouteReviewQueue({ repository = defaultRepository, focusReportId = null }) {
  const { show: showToast } = useToast()
  const [state, setState] = useState('open')
  const [rows, setRows] = useState(null)
  const [failures, setFailures] = useState([])
  const [error, setError] = useState(null)
  const [loadedAt, setLoadedAt] = useState(null)
  const [retrying, setRetrying] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [queue, failed] = await Promise.all([
        repository.getRouteReviewQueue(state),
        repository.getNotificationFailures().catch(() => []),
      ])
      setRows(queue)
      setFailures(failed)
      setLoadedAt(new Date())
    } catch (e) {
      setError(e?.message || 'Unknown error')
    }
  }, [repository, state])

  useEffect(() => { setRows(null); load() }, [load])

  // Deep link from the reviewer alert: bring the linked report into view once
  // the rows are on screen. Re-runs only when the link or the loaded rows change.
  const focusRow = focusReportId && rows ? rows.find((r) => r.report_id === focusReportId) : null
  useEffect(() => {
    if (!focusRow) return
    const el = document.getElementById(reviewAnchorId(focusReportId))
    if (!el) return
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.focus({ preventScroll: true })
  }, [focusRow, focusReportId])

  function decided(row, out) {
    const failed = out?.notification?.failed > 0
    const msg = out?.noop ? 'No change: this decision was already recorded.'
      : out?.action === 'hold' ? 'Route held.'
      : failed ? 'Routed. The company alert failed; retry it from the banner.'
      : 'Routed and the company has been notified.'
    showToast(msg, { type: failed ? 'warning' : 'success' })
    load()
  }

  async function retry(routeId) {
    setRetrying(routeId)
    try {
      await repository.retryRouteNotification(routeId)
      showToast('Alert retried.', { type: 'success' })
      await load()
    } catch (e) {
      showToast('Retry failed: ' + (e?.message || 'unknown error'), { type: 'error' })
    } finally {
      setRetrying(null)
    }
  }

  if (error) return <ErrorState message={`We couldn't load the routing queue: ${error}`} onRetry={load} />
  if (!rows) return <Loading text="Loading routing queue…" />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Safety report routing</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
            Public reports wait here until a reviewer routes them. Approval shares the case with that company; it does not submit anything to a regulator.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{loadedAt ? `Updated ${loadedAt.toLocaleTimeString()}` : ''}</span>
          <Button variant="secondary" size="sm" onClick={load} aria-label="Refresh routing queue"><RefreshCw size={14} aria-hidden="true" /> Refresh</Button>
        </div>
      </div>

      {failures.length > 0 && (
        <div role="alert" style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--amber)', background: 'var(--amber-bg)' }}>
          <strong style={{ fontSize: 13 }}>{failures.length} notification{failures.length === 1 ? '' : 's'} failed to send</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13 }}>
            {failures.map((f) => (
              <li key={f.log_id}>
                {f.kind === 'adr_case_routed' ? 'Company alert' : 'Reviewer alert'} · {fmtDateTime(f.created_at)} · {f.error || 'unknown error'}
                {f.route_id && f.kind === 'adr_case_routed' && (
                  <> {' '}<Button size="sm" variant="secondary" disabled={retrying === f.route_id} onClick={() => retry(f.route_id)}>{retrying === f.route_id ? 'Retrying…' : 'Retry'}</Button></>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div role="tablist" aria-label="Queue view" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)' }}>
        {[['open', 'Awaiting review'], ['held', 'On hold']].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={state === id} onClick={() => setState(id)}
            style={{ padding: '9px 16px', background: 'none', border: 'none', borderBottom: `2px solid ${state === id ? 'var(--teal)' : 'transparent'}`, color: state === id ? 'var(--teal)' : 'var(--muted)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            {label}{state === id ? ` (${rows.length})` : ''}
          </button>
        ))}
      </div>

      {focusReportId && !focusRow && (
        <div role="status" style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 13 }}>
          The report from that alert is not in this view. It may already be routed, or it may be on hold.
          {state === 'open' && <> {' '}<Button size="sm" variant="secondary" onClick={() => setState('held')}>Check on hold</Button></>}
        </div>
      )}

      {rows.length === 0 ? (
        <Empty title={state === 'held' ? 'Nothing on hold' : 'No reports awaiting routing'} description={state === 'held' ? 'Held routes appear here until they are approved or redirected.' : 'New public reports appear here after they pass validation.'} />
      ) : (
        <div role="list" aria-label="Routes awaiting review" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((row) => (
            <QueueCard key={row.route_id} row={row} repository={repository} onDecided={decided}
              highlighted={!!focusReportId && row.report_id === focusReportId}
              anchorId={focusRow && row.route_id === focusRow.route_id ? reviewAnchorId(row.report_id) : undefined} />
          ))}
        </div>
      )}
    </div>
  )
}
