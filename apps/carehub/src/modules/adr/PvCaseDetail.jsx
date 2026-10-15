import { useState, useEffect, useRef } from 'react'
import { adrReportRepository } from './repositories'
import { adrValidation } from './validation'
import { getDeadlineStatus } from './services'
import { buildE2bXml, buildPdfHtml, openPrintView, downloadTextFile, exportFilename, buildAdrCsv, csvRowsFromCases, E2B_FORMAT_NOTE } from './exports'
import { companyStatusLabel } from './pvWorkflow'
import { CaseHeader, WorkflowActions } from './PvTracker.jsx'
import { theme } from '../../styles/theme'
import { Card, Loading, ErrorState, Button, useToast } from '../../components/ui'

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' })
}

// Per-case exports on masked view data only (includeReporter:false always —
// companies never hold reporter identity, so it must never enter their files).
export function CaseExportBar({ onCsv, onPrint, onE2b }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Button variant="secondary" size="md" onClick={onCsv}>Export CSV</Button>
      <Button variant="secondary" size="md" onClick={onPrint}>NAFDAC print view</Button>
      <Button variant="secondary" size="md" onClick={onE2b} title={E2B_FORMAT_NOTE}>E2B XML (prep. only)</Button>
    </div>
  )
}

// New-safety-signal escalation banner: 3-day internal review, not a filing.
export function SignalEscalation({ active }) {
  if (!active) return null
  return (
    <p role="alert" style={{ fontSize: 13, fontWeight: 700, color: '#b45309', background: '#fffbeb', border: '1px solid #d97706', borderRadius: 10, padding: '8px 12px' }}>
      Flagged as a new safety signal — internal review within 3 days. This flag prioritizes internal review; it is not a regulatory submission.
    </p>
  )
}

// Deadline line naming the rule version behind the date plus internal status.
export function DeadlineLine({ deadline, createdAt, ruleVersion }) {
  if (!deadline) return null
  return (
    <p style={{ fontSize: 12, color: theme.textLight }}>
      Due {fmtDate(deadline)} ({getDeadlineStatus(deadline, createdAt).replace('_', ' ')}) ·
      Rule: {ruleVersion || 'not recorded'} · Internal platform deadline — not a regulator-confirmed submission deadline.
    </p>
  )
}

function Section({ title, children }) {
  return (
    <Card style={{ padding: '12px 14px', marginBottom: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: theme.textDark, marginBottom: 6 }}>{title}</div>
      {children}
    </Card>
  )
}

const line = (label, value) => (
  <p key={label} style={{ fontSize: 13, color: theme.textLight, margin: '2px 0' }}>
    <span style={{ fontWeight: 700, color: theme.textDark }}>{label}:</span> {value || '—'}
  </p>
)

export default function PvCaseDetail({ brand, reportId }) {
  const { show: showToast } = useToast()
  const [kase, setKase] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [followupMsg, setFollowupMsg] = useState('')
  const [assessment, setAssessment] = useState('')
  const [actionTaken, setActionTaken] = useState('')
  const accessLogged = useRef(false)

  useEffect(() => { load() }, [reportId])

  // Access logging: one `note` audit event per case view (the Phase 6
  // migration authorizes routed companies to write it; failures stay silent
  // so a logging outage never blocks safety work).
  useEffect(() => {
    if (accessLogged.current || !reportId) return
    accessLogged.current = true
    adrReportRepository.logEvent(reportId, 'note', { action: 'pv_case_viewed', via: 'pv-tracker' }).catch(() => {})
  }, [reportId])

  async function load() {
    setError(null)
    try {
      const data = await adrReportRepository.getPvCase(reportId)
      if (!data) {
        setError('Case not found or not routed to your organisation.')
        return
      }
      setKase(data)
    } catch (e) {
      setError(e?.message || 'Unknown error')
    }
  }

  const myRoutes = (kase?.routes || []).filter(
    (r) => r.responsible_business_id === brand?.id && ['verified', 'routed'].includes(r.status)
  )
  const activeRoute = myRoutes[0] || null
  const serious = adrValidation.computeIsSerious(kase?.adr_reactions || [])

  async function transition(status) {
    if (!activeRoute) return
    setBusy(true)
    try {
      await adrReportRepository.updateRouteWorkflow(activeRoute.route_id, status, null)
      await load()
      showToast(status === 'acknowledged' ? 'Receipt acknowledged internally.' : `Status: ${companyStatusLabel(status)}`)
    } catch (e) {
      showToast('Workflow update failed: ' + (e?.message || 'unknown error'), { type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function sendFollowup() {
    if (!activeRoute || !followupMsg.trim()) return
    setBusy(true)
    try {
      await adrReportRepository.requestRouteFollowup(activeRoute.route_id, followupMsg.trim(), null)
      setFollowupMsg('')
      await load()
      showToast('Follow-up request sent to the reporting facility.')
    } catch (e) {
      showToast('Request failed: ' + (e?.message || 'unknown error'), { type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function saveAssessment() {
    if (!activeRoute || !assessment.trim()) return
    setBusy(true)
    try {
      await adrReportRepository.addRouteAssessment({
        routeId: activeRoute.route_id,
        reportId,
        assessment: assessment.trim(),
        actionTaken: actionTaken.trim() || null,
      })
      setAssessment('')
      setActionTaken('')
      await load()
      showToast('Assessment recorded.')
    } catch (e) {
      showToast('Assessment failed: ' + (e?.message || 'unknown error'), { type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  function exportNafdac() {
    openPrintView(buildPdfHtml({ report: kase, products: kase.adr_products, meds: kase.adr_concomitant_meds, reactions: kase.adr_reactions, reactionExpected: kase.reaction_expected }))
    adrReportRepository.logEvent(reportId, 'exported', { format: 'nafdac-print', via: 'pv-tracker' }).catch(() => {})
  }

  function exportCsv() {
    const rows = csvRowsFromCases([{ ...kase, adr_products: kase.adr_products || [], adr_reactions: kase.adr_reactions || [] }])
    downloadTextFile(exportFilename(kase, 'csv'), buildAdrCsv(rows, { includeReporter: false }).join('\n'), 'text/csv')
    adrReportRepository.logEvent(reportId, 'exported', { format: 'csv', via: 'pv-tracker' }).catch(() => {})
  }

  function exportE2b() {
    downloadTextFile(exportFilename(kase, 'xml'), buildE2bXml({ report: kase, products: kase.adr_products, reactions: kase.adr_reactions }))
    adrReportRepository.logEvent(reportId, 'exported', { format: 'e2b-xml', via: 'pv-tracker' }).catch(() => {})
  }

  if (error) return <ErrorState message={error} onRetry={load} />
  if (!kase) return <Loading text="Loading case…" />

  return (
    <div>
      <Card style={{ padding: '14px 16px', marginBottom: 10 }}>
        <CaseHeader kase={kase} />
        <SignalEscalation active={kase.new_safety_signal === true} />
        <DeadlineLine deadline={kase.submission_deadline} createdAt={kase.created_at} ruleVersion={kase.deadline_rule_version} />
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: theme.textLight }}>Workflow: <strong>{companyStatusLabel(activeRoute?.company_status || 'new')}</strong></span>
          <span style={{ fontSize: 12, color: theme.textLight }}>{serious ? 'Serious' : 'Non-serious'}</span>
          {kase.submission_deadline && <span style={{ fontSize: 12, color: theme.textLight }}>Due {fmtDate(kase.submission_deadline)} ({getDeadlineStatus(kase.submission_deadline, kase.created_at)})</span>}
        </div>
      </Card>

      <Section title="Your workflow">
        {activeRoute ? (
          <WorkflowActions route={activeRoute} onTransition={transition} busy={busy} />
        ) : (
          <p style={{ fontSize: 13, color: theme.textLight }}>No verified route for your organisation on this case.</p>
        )}
      </Section>

      <Section title="Suspect products & routing">
        {(kase.adr_products || []).map((p) => {
          const route = (kase.routes || []).find((r) => r.product_id === p.product_id)
          return (
            <div key={p.product_id} style={{ marginBottom: 6 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: theme.textDark, margin: 0 }}>{p.product_brand_name}</p>
              <p style={{ fontSize: 12.5, color: theme.textLight, margin: 0 }}>
                {route
                  ? route.selection_kind === 'verified'
                    ? `Routed to your organisation (verified${route.status === 'verified' ? ', awaiting final routing' : ''}).`
                    : route.selection_kind === 'unknown'
                      ? 'Reporter did not know the responsible company.'
                      : `Reporter-typed candidate: ${route.candidate_name || '—'} (unverified, informative only).`
                  : 'No company selection recorded for this product.'}
                {p.batch_lot_number ? ` Batch: ${p.batch_lot_number}.` : ''}
              </p>
            </div>
          )
        })}
      </Section>

      <Section title="Reactions & seriousness">
        {(kase.adr_reactions || []).map((r) => (
          <div key={r.reaction_id} style={{ marginBottom: 6 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: theme.textDark, margin: 0 }}>{r.reaction_description}</p>
            <p style={{ fontSize: 12.5, color: theme.textLight, margin: 0 }}>
              Severity: {r.severity || '—'} · Outcome: {r.outcome || '—'} ·
              Serious: {['seriousness_death', 'seriousness_life_threatening', 'seriousness_hospitalization', 'seriousness_disability', 'seriousness_congenital_anomaly', 'seriousness_other_medically_important'].some((k) => r[k]) ? 'yes' : 'no'}
              {(r.seriousness_unknown || []).length > 0 ? ` (unknown: ${r.seriousness_unknown.join(', ')})` : ''}
            </p>
          </div>
        ))}
      </Section>

      <Section title="Patient (clinical only)">
        {line('Identifier', kase.patient_identifier)}
        {line('Gender', kase.patient_gender)}
        {line('Age', kase.patient_age ?? kase.patient_dob ?? kase.patient_age_group)}
        {line('Weight', kase.patient_weight_kg)}
        {line('Medical history', kase.patient_medical_history)}
      </Section>

      <Section title="Reporter (masked)">
        {line('Qualification', kase.reporter_qualification)}
        {line('Follow-up consent', kase.reporter_consent_followup === true ? 'Yes' : kase.reporter_consent_followup === false ? 'No' : '—')}
        {line('Name / contact', kase.reporter_name || kase.reporter_phone || kase.reporter_email || 'Masked under the interim privacy policy')}
      </Section>

      <Section title="Attachments">
        {(kase.adr_evidence_photos || []).length === 0 && <p style={{ fontSize: 13, color: theme.textLight }}>No attachments.</p>}
        {(kase.adr_evidence_photos || []).map((a) => (
          <p key={a.photo_id} style={{ fontSize: 13, margin: '2px 0' }}>
            [{a.evidence_photo_type}] {a.evidence_photo_caption || 'Attachment'}{' '}
            {String(a.evidence_photo_file || '').startsWith('http') ? (
              <a href={a.evidence_photo_file} target="_blank" rel="noreferrer">View</a>
            ) : (
              <span style={{ color: theme.textLight }}>Stored confidentially — full file via platform support.</span>
            )}
          </p>
        ))}
      </Section>

      <Section title="Assessments & actions (versioned)">
        {(kase.assessments || []).map((a) => (
          <div key={a.assessment_id} style={{ marginBottom: 6 }}>
            <p style={{ fontSize: 13, color: theme.textDark, margin: 0 }}>{a.assessment}</p>
            <p style={{ fontSize: 12, color: theme.textLight, margin: 0 }}>
              {a.author_name || 'Company user'} · {fmtDate(a.created_at)}{a.action_taken ? ` · Action: ${a.action_taken}` : ''}
            </p>
          </div>
        ))}
        <label htmlFor="pv-assessment" style={{ fontSize: 13, fontWeight: 700 }}>Record assessment</label>
        <textarea id="pv-assessment" value={assessment} onChange={(e) => setAssessment(e.target.value)} rows={3}
          style={{ width: '100%', boxSizing: 'border-box', fontSize: 14, border: '1px solid #ddd', borderRadius: 8, padding: 8 }} />
        <label htmlFor="pv-action" style={{ fontSize: 13, fontWeight: 700, marginTop: 6, display: 'block' }}>Action taken (optional)</label>
        <input id="pv-action" value={actionTaken} onChange={(e) => setActionTaken(e.target.value)} maxLength={240}
          style={{ width: '100%', boxSizing: 'border-box', fontSize: 14, border: '1px solid #ddd', borderRadius: 8, padding: 8 }} />
        <div style={{ marginTop: 8 }}>
          <Button variant="secondary" size="md" disabled={busy || !assessment.trim() || !activeRoute} onClick={saveAssessment}>Save assessment</Button>
        </div>
      </Section>

      <Section title="Follow-up requests">
        {(kase.followups || []).map((f) => (
          <p key={f.request_id} style={{ fontSize: 13, margin: '2px 0' }}>
            {f.message} <span style={{ color: theme.textLight }}>({f.status} · {fmtDate(f.created_at)})</span>
          </p>
        ))}
        <label htmlFor="pv-followup" style={{ fontSize: 13, fontWeight: 700 }}>Request information from the reporting facility</label>
        <textarea id="pv-followup" value={followupMsg} onChange={(e) => setFollowupMsg(e.target.value)} rows={2}
          style={{ width: '100%', boxSizing: 'border-box', fontSize: 14, border: '1px solid #ddd', borderRadius: 8, padding: 8 }} />
        <div style={{ marginTop: 8 }}>
          <Button variant="secondary" size="md" disabled={busy || !followupMsg.trim() || !activeRoute} onClick={sendFollowup}>Send request</Button>
        </div>
      </Section>

      <Section title="Timeline">
        {(kase.events || []).map((e) => (
          <p key={e.event_id} style={{ fontSize: 12.5, color: theme.textLight, margin: '2px 0' }}>
            {fmtDate(e.created_at)} — {e.event_type} ({e.actor_name || e.actor_type})
          </p>
        ))}
        {(kase.events || []).length === 0 && <p style={{ fontSize: 13, color: theme.textLight }}>No events yet.</p>}
      </Section>

      <Section title="Export (masked case data)">
        <CaseExportBar onCsv={exportCsv} onPrint={exportNafdac} onE2b={exportE2b} />
        <p style={{ fontSize: 12.5, color: theme.textLight }}>Exports contain only data your role may access and are audit-logged. The E2B file is preparation only — not a regulatory submission.</p>
      </Section>
    </div>
  )
}
