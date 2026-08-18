import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Plus, Trash2, Download, Camera, X, RefreshCw, CheckCircle, AlertTriangle, Upload } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Pill, Input, Select, Textarea, Toggle, useToast, Toast, Loading, Empty, ErrorState, ConfirmDialog } from '../../components/ui'
import { adrReportRepository } from './repositories'
import { adrValidation } from './validation'
import { ADR_FORM } from './formEngine'
import { buildPdfHtml, buildE2bXml, openPrintView, downloadTextFile, exportFilename } from './exports'
import { draftBackup, buildDraftSnapshot, isStale } from './draftBackup'
import { ADR_MODULE_TYPES, REPORT_STATUS, REACTION_SEVERITY_LABELS, REACTION_OUTCOME_LABELS, ACTION_TAKEN_LABELS, DECHALLENGE_LABELS, RECHALLENGE_LABELS, CAUSALITY_LABELS, EVIDENCE_PHOTO_TYPE_LABELS, QUALIFICATION_LABELS, PATIENT_GENDER_LABELS, PATIENT_AGE_GROUP_LABELS } from './types'
import { theme } from '../../styles/theme'

const SERIOUSNESS_OPTIONS = [
  { key: 'seriousness_death', label: 'Death' },
  { key: 'seriousness_life_threatening', label: 'Life-threatening' },
  { key: 'seriousness_hospitalization', label: 'Required hospitalisation' },
  { key: 'seriousness_disability', label: 'Persistent disability / incapacity' },
  { key: 'seriousness_congenital_anomaly', label: 'Congenital anomaly / birth defect' },
  { key: 'seriousness_other_medically_important', label: 'Other medically important condition' },
]

const severityOptions = () => Object.entries(REACTION_SEVERITY_LABELS).map(([value, label]) => ({ value, label }))
const outcomeOptions = () => Object.entries(REACTION_OUTCOME_LABELS).map(([value, label]) => ({ value, label }))
const actionTakenOptions = () => Object.entries(ACTION_TAKEN_LABELS).map(([value, label]) => ({ value, label }))
const dechallengeOptions = () => Object.entries(DECHALLENGE_LABELS).map(([value, label]) => ({ value, label }))
const rechallengeOptions = () => Object.entries(RECHALLENGE_LABELS).map(([value, label]) => ({ value, label }))
const causalityOptions = () => Object.entries(CAUSALITY_LABELS).map(([value, label]) => ({ value, label }))
const qualificationOptions = () => Object.entries(QUALIFICATION_LABELS).map(([value, label]) => ({ value, label }))
const genderOptions = () => Object.entries(PATIENT_GENDER_LABELS).map(([value, label]) => ({ value, label }))
const ageGroupOptions = () => Object.entries(PATIENT_AGE_GROUP_LABELS).map(([value, label]) => ({ value, label }))

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' })
}

function fmtDeadline(ms) {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' })
}

function fmtDateTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-NG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function AdrReportPage({ reportId }) {
  const navigate = useNavigate()
  const { msg, type, show: showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [report, setReport] = useState(null)
  const [products, setProducts] = useState([])
  const [meds, setMeds] = useState([])
  const [reactions, setReactions] = useState([])
  const [photos, setPhotos] = useState([])
  const [events, setEvents] = useState([])
  const [eventsLoading, setEventsLoading] = useState(false)

  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)
  const [missing, setMissing] = useState([])

  const [reactionExpected, setReactionExpected] = useState(null)
  const [newSafetySignal, setNewSafetySignal] = useState(false)
  const [restorableDraft, setRestorableDraft] = useState(null)
  const fileInputRef = useRef(null)

  const moduleType = report ? (report.module_type || ADR_MODULE_TYPES.COMMUNITY_PHARMACY) : ADR_MODULE_TYPES.COMMUNITY_PHARMACY
  const isIndustry = moduleType === ADR_MODULE_TYPES.INDUSTRY
  const isSkincare = moduleType === ADR_MODULE_TYPES.SKINCARE
  const isHospital = moduleType === ADR_MODULE_TYPES.HOSPITAL
  const isLocked = report && (report.status === REPORT_STATUS.SUBMITTED || report.status === REPORT_STATUS.EXPORTED)
  const terminology = ADR_FORM.getTerminology(moduleType)

  useEffect(() => { load() }, [reportId])

  async function load() {
    setLoading(true)
    setError(false)
    try {
      const full = await adrReportRepository.getReportWithDetails(reportId)
      if (!full) {
        showToast('ADR report not found', { type: 'error' })
        navigate('/dashboard/adr-reports')
        return
      }
      setReport(full)
      setProducts(full.adr_products || [])
      setMeds(full.adr_concomitant_meds || [])
      setReactions(full.adr_reactions || [])
      setPhotos(full.adr_evidence_photos || [])
      setReactionExpected(full.reaction_expected)
      setNewSafetySignal(!!full.new_safety_signal)
      // Offer a local draft backup only when it is newer than the last server
      // save — otherwise the server copy is authoritative.
      const draft = draftBackup.load(reportId)
      if (draft && !isStale(draft, full.updated_at)) {
        setRestorableDraft(draft)
      }
      loadEvents(reportId)
    } catch (e) {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  // Audit trail (Phase 2, Item 5): append-only lifecycle events written by the
  // server trigger (created / status_changed) plus app-initiated exports.
  async function loadEvents(id = reportId) {
    setEventsLoading(true)
    try {
      const rows = await adrReportRepository.getReportEvents(id)
      setEvents(rows || [])
    } catch (e) {
      setEvents([])
    } finally {
      setEventsLoading(false)
    }
  }

  // ── Offline draft backup (Phase 2, Item 5) ─────────────────────────────────
  // Mirrors the live form to localStorage as the reporter types (debounced) so
  // an interrupted session can be restored. Skipped while locked: a submitted /
  // exported report is server-authoritative and must not shadow the server.
  useEffect(() => {
    if (!report || isLocked) return
    const timer = setTimeout(() => {
      draftBackup.save(report.report_id, buildDraftSnapshot({
        report,
        products,
        meds,
        reactions,
        reactionExpected,
        newSafetySignal,
      }))
    }, 800)
    return () => clearTimeout(timer)
  }, [report, products, meds, reactions, reactionExpected, newSafetySignal, isLocked])

  function handleRestoreDraft() {
    if (!restorableDraft || !report) return
    const d = restorableDraft
    setReport(prev => ({ ...prev, ...(d.report || {}) }))
    setProducts(d.products || [])
    setMeds(d.meds || [])
    setReactions(d.reactions || [])
    setReactionExpected(d.reactionExpected ?? null)
    setNewSafetySignal(!!d.newSafetySignal)
    draftBackup.clear(report.report_id)
    setRestorableDraft(null)
    showToast('Draft restored', { type: 'success' })
  }

  function handleDiscardDraft() {
    if (!report) return
    draftBackup.clear(report.report_id)
    setRestorableDraft(null)
    showToast('Local draft discarded', { type: 'info' })
  }

  // ── Deadline (live-computed from current form state) ───────────────────────
  const isSerious = adrValidation.computeIsSerious(reactions)
  const deadline = report ? calculateDeadlineFrom(report, isSerious, reactionExpected, newSafetySignal) : null
  const deadlineStatus = deadline && report ? adrValidation.getDeadlineStatus(deadline, report.created_at) : null

  function setField(field, value) {
    setReport(prev => (prev ? { ...prev, [field]: value } : prev))
  }

  // ── Persistence ────────────────────────────────────────────────────────────
  async function handleSaveDraft() {
    if (!report || isLocked) return
    setSaving(true)
    try {
      await adrReportRepository.updateReport(report.report_id, scalarFields({ ...report, reaction_expected: reactionExpected, new_safety_signal: newSafetySignal }))
      showToast('Draft saved', { type: 'success' })
    } catch (e) {
      showToast('Could not save draft', { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function handleSubmit() {
    if (!report || isLocked) return
    setSubmitting(true)
    setMissing([])
    try {
      const hydrated = { ...report, reaction_expected: reactionExpected, new_safety_signal: newSafetySignal, adr_products: products, adr_reactions: reactions }
      const client = await adrValidation.validateForSubmit(hydrated)
      if (!client.valid) {
        setMissing(client.missing)
        showToast('Cannot submit — complete the highlighted fields', { type: 'warning' })
        setSubmitting(false)
        return
      }

      await adrReportRepository.updateReport(report.report_id, scalarFields(hydrated))
      const result = await adrReportRepository.submitReport(report.report_id)

      if (result && result.valid) {
        showToast(`${terminology.adrLabel} submitted`, { type: 'success' })
        await load()
      } else {
        const list = (result && result.missing) || ['Submission could not be completed']
        setMissing(Array.isArray(list) ? list : [list])
        showToast('Cannot submit — server rejected the report', { type: 'warning' })
      }
    } catch (e) {
      showToast('Error submitting report', { type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  async function handleArchive() {
    if (!report) return
    setArchiving(true)
    try {
      await adrReportRepository.updateReport(report.report_id, { status: REPORT_STATUS.FOLLOW_UP_REQUIRED })
      showToast('Report archived', { type: 'success' })
      await load()
    } catch (e) {
      showToast('Could not archive report', { type: 'error' })
    } finally {
      setArchiving(false)
      setShowArchiveConfirm(false)
    }
  }

  async function handleFollowUp() {
    if (!report) return
    try {
      const created = await adrReportRepository.createFollowUp({
        businessId: report.business_id,
        moduleType: report.module_type,
        followUpOfReportId: report.report_id,
        createdByUserId: report.created_by_user_id,
        followUpVersionNumber: isIndustry ? (report.follow_up_version_number || 0) + 1 : null,
      })
      const row = (created && created[0]) || created
      if (row && row.report_id) navigate(`/dashboard/adr-reports/${row.report_id}/detail`)
      else showToast('Could not create follow-up', { type: 'warning' })
    } catch (e) {
      showToast('Error creating follow-up', { type: 'error' })
    }
  }

  // Industry reports export as an E2B ICSR XML file; the other module types
  // export as a printable NAFDAC document (browser Print -> Save as PDF).
  function handleExport() {
    if (!report) return
    const aggregate = { report, products, meds, reactions, reactionExpected }

    // Append an audit event (best-effort — the export itself must never be
    // blocked by the log write).
    adrReportRepository.logEvent(report.report_id, 'exported', { format: isIndustry ? 'e2b' : 'pdf' })
      .then(() => loadEvents())
      .catch(() => {})

    if (isIndustry) {
      const xml = buildE2bXml(aggregate)
      if (!xml) {
        showToast('Could not build the E2B export', { type: 'error' })
        return
      }
      downloadTextFile(exportFilename(report, 'xml'), xml)
      showToast('E2B XML downloaded', { type: 'success' })
      return
    }

    const html = buildPdfHtml(aggregate)
    if (html) openPrintView(html)
  }

  // ── Child-row persistence ───────────────────────────────────────────────────
  async function addProduct(p) {
    const created = await adrReportRepository.addProduct(report.report_id, p)
    setProducts(prev => [...prev, ...(created || [])])
  }
  async function updateProduct(pid, patch) {
    await adrReportRepository.updateProduct(pid, report.report_id, patch)
    setProducts(prev => prev.map(x => (x.product_id === pid ? { ...x, ...patch } : x)))
  }
  async function removeProduct(pid) {
    await adrReportRepository.deleteProduct(pid, report.report_id)
    setProducts(prev => prev.filter(x => x.product_id !== pid))
  }

  async function addMed(m) {
    const created = await adrReportRepository.addConcomitantMed(report.report_id, m)
    setMeds(prev => [...prev, ...(created || [])])
  }
  async function removeMed(mid) {
    await adrReportRepository.deleteConcomitantMed(mid, report.report_id)
    setMeds(prev => prev.filter(x => x.med_id !== mid))
  }

  async function addReaction(r) {
    const created = await adrReportRepository.addReaction(report.report_id, r)
    setReactions(prev => [...prev, ...(created || [])])
  }
  async function updateReaction(rid, patch) {
    await adrReportRepository.updateReaction(rid, report.report_id, patch)
    setReactions(prev => prev.map(x => (x.reaction_id === rid ? { ...x, ...patch } : x)))
  }
  async function removeReaction(rid) {
    await adrReportRepository.deleteReaction(rid, report.report_id)
    setReactions(prev => prev.filter(x => x.reaction_id !== rid))
  }

  async function handlePhotoUpload(file) {
    if (!file || uploading) return
    setUploading(true)
    try {
      const url = await adrReportRepository.uploadEvidencePhoto(file)
      const created = await adrReportRepository.addEvidencePhoto(report.report_id, {
        evidence_photo_file: url,
        evidence_photo_type: 'product',
        evidence_photo_caption: file.name,
      })
      setPhotos(prev => [...prev, ...(created || [])])
      showToast('Evidence photo added', { type: 'success' })
    } catch (e) {
      showToast('Photo upload failed', { type: 'error' })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // Hospital lab / discharge attachment upload — stores the public URL in the
  // matching report column via setField, so it persists with Save Draft.
  async function handleAttachmentUpload(file, field) {
    if (!file || uploading) return
    setUploading(true)
    try {
      const url = await adrReportRepository.uploadAttachment(file, 'adr-hospital')
      setField(field, url)
      showToast('Attachment uploaded', { type: 'success' })
    } catch (e) {
      showToast('Attachment upload failed', { type: 'error' })
    } finally {
      setUploading(false)
    }
  }

  async function removePhoto(pid) {
    await adrReportRepository.deleteEvidencePhoto(pid, report.report_id)
    setPhotos(prev => prev.filter(x => x.photo_id !== pid))
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) return <Loading text="Loading ADR report..." />
  if (error) return <ErrorState message="We couldn't load this report. Please try again." onRetry={load} />
  if (!report) return null

  const statusToken = ADR_FORM.getStatusToken(report.status)

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '0 4px' }}>
      <button onClick={() => navigate('/dashboard/adr-reports')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: theme.textLight, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: '8px 0' }}>
        <ArrowLeft size={14} /> Back to ADR Reports
      </button>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginTop: 4, marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 20, fontWeight: 900, color: theme.navy, margin: 0 }}>
              {ADR_FORM.formatReportNumber(report.report_number)} — {ADR_FORM.getModuleTitle(moduleType)}
            </h2>
            <Pill label={ADR_FORM.getStatusLabel(report.status)} type={statusToken === 'info' ? 'blue' : statusToken === 'success' ? 'green' : statusToken === 'warning' ? 'amber' : 'gray'} />
          </div>
          <div style={{ fontSize: 12.5, color: theme.textLight, marginTop: 4 }}>{terminology.adrLabel} · Created {fmtDate(report.created_at)}</div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" size="md" onClick={handleSaveDraft} disabled={isLocked} loading={saving} loadingText="Saving…">Save Draft</Button>
          <Button variant="primary" size="md" onClick={handleSubmit} disabled={isLocked} loading={submitting} loadingText="Submitting…"><CheckCircle size={14} /> {terminology.submitButton}</Button>
          <Button variant="ghost" size="md" onClick={handleExport}><Download size={14} /> {isIndustry ? 'Export E2B XML' : terminology.exportButton}</Button>
          <Button variant="ghost" size="md" onClick={handleFollowUp}><RefreshCw size={14} /> Follow-up</Button>
          <Button variant="danger" size="md" onClick={() => setShowArchiveConfirm(true)} disabled={archiving} loading={archiving} loadingText="Archiving…"><Trash2 size={14} /> Archive</Button>
        </div>
      </div>

      {deadline && (
        <DeadlineBanner status={deadlineStatus} deadline={deadline} createdAt={report.created_at} industry={isIndustry} />
      )}

      {restorableDraft && (
        <div role="alert" style={{ marginBottom: 20, padding: '14px 16px', borderRadius: theme.radius.md, background: theme.infoBg, border: `1px solid ${theme.info}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: theme.navy, fontWeight: 700 }}>
              You have a local draft saved from this session that is newer than the server copy.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="primary" size="sm" onClick={handleRestoreDraft}>Restore draft</Button>
              <Button variant="ghost" size="sm" onClick={handleDiscardDraft}>Discard</Button>
            </div>
          </div>
        </div>
      )}

      {missing.length > 0 && (
        <div role="alert" style={{ marginBottom: 20, padding: '14px 16px', borderRadius: theme.radius.md, background: theme.warningBg, border: `1px solid ${theme.warning}` }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: theme.navy, marginBottom: 6 }}>Cannot submit yet — missing:</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: theme.gray600, lineHeight: 1.7 }}>
            {missing.map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
      )}

      <ReporterSection report={report} setField={setField} disabled={isLocked} />
      <PatientSection report={report} setField={setField} disabled={isLocked} />

      <ProductsSection
        products={products}
        onAdd={addProduct}
        onUpdate={updateProduct}
        onRemove={removeProduct}
        disabled={isLocked}
        industry={isIndustry}
      />

      <ConcomitantSection meds={meds} onAdd={addMed} onRemove={removeMed} disabled={isLocked} />

      <ReactionsSection
        reactions={reactions}
        onAdd={addReaction}
        onUpdate={updateReaction}
        onRemove={removeReaction}
        disabled={isLocked}
        terminology={terminology}
        reactionExpected={reactionExpected}
        onExpectedChange={setReactionExpected}
      />

      {isIndustry && <IndustrySection report={report} setField={setField} newSafetySignal={newSafetySignal} setNewSafetySignal={setNewSafetySignal} disabled={isLocked} />}
      {isSkincare && <SkincareSection report={report} setField={setField} disabled={isLocked} />}
      {isHospital && (
        <HospitalSection
          report={report}
          setField={setField}
          onUpload={handleAttachmentUpload}
          uploading={uploading}
          disabled={isLocked}
        />
      )}

      <EvidenceSection
        photos={photos}
        onUpload={handlePhotoUpload}
        onRemove={removePhoto}
        uploading={uploading}
        fileInputRef={fileInputRef}
        disabled={isLocked}
      />

      <AuditTrailSection events={events} loading={eventsLoading} />

      <Card style={{ padding: '16px 18px', marginTop: 8 }}>
        <div style={{ fontSize: 12, color: theme.textLight, lineHeight: 1.9 }}>
          <strong style={{ color: theme.navy }}>Report ID:</strong> {report.report_id}<br />
          {report.follow_up_of_report_id && (<><strong style={{ color: theme.navy }}>Follow-up of:</strong> {report.follow_up_of_report_id}<br /></>)}
          <strong style={{ color: theme.navy }}>Submission deadline:</strong> {fmtDeadline(deadline)} · {deadlineStatus ? deadlineStatus.replace('_', ' ') : '—'}
        </div>
      </Card>

      <ConfirmDialog
        show={showArchiveConfirm}
        title="Archive this report?"
        consequence="The report stays saved but is marked as needing follow-up. Submissions already made are unaffected."
        confirmLabel="Archive"
        onClose={() => setShowArchiveConfirm(false)}
        onConfirm={handleArchive}
      />

      <Toast msg={msg} type={type} />
    </div>
  )
}

// ── Sections ─────────────────────────────────────────────────────────────────
function Section({ title, sub, children, badge }) {
  return (
    <Card style={{ padding: '20px 22px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h3 style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: '0.03em', textTransform: 'uppercase', color: theme.navy, margin: 0 }}>{title}</h3>
          {sub && <div style={{ fontSize: 12, color: theme.textLight, marginTop: 3 }}>{sub}</div>}
        </div>
        {badge}
      </div>
      {children}
    </Card>
  )
}

const grid = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }

// ── Audit trail (Phase 2, Item 5) ───────────────────────────────────────────
// Append-only lifecycle timeline: created / status_changed come from the
// server trigger, exported/note from the adr_log_event RPC. Read-only — the
// events table has no client write path.
const EVENT_LABELS = {
  created: 'Report created',
  status_changed: 'Status changed',
  exported: 'Export produced',
  note: 'Note',
}

function AuditTrailSection({ events, loading }) {
  return (
    <Section title="Timeline" sub="Lifecycle history of this report (append-only)">
      {loading ? (
        <Loading text="Loading history…" />
      ) : events.length === 0 ? (
        <Empty icon={<AlertTriangle size={20} />} message="No events recorded yet." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {events.map((ev) => {
            const label = EVENT_LABELS[ev.event_type] || ev.event_type
            const detail = ev.event_type === 'status_changed'
              ? `${ev.metadata && ev.metadata.from} → ${ev.metadata && ev.metadata.to}`
              : (ev.event_type === 'exported' && ev.metadata && ev.metadata.format)
                ? ev.metadata.format.toUpperCase()
                : null
            return (
              <div key={ev.event_id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0', borderBottom: '1px solid ' + theme.border }}>
                <div style={{ fontSize: 18, lineHeight: 1.3, color: theme.textLight }}>•</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: theme.navy }}>{label} {detail ? <span style={{ color: theme.gray500, fontWeight: 500 }}>— {detail}</span> : null}</div>
                  <div style={{ fontSize: 12, color: theme.textLight, marginTop: 2 }}>
                    {ev.actor_name || 'System'} ({ev.actor_type || 'system'}) · {fmtDateTime(ev.created_at)}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}

function ReporterSection({ report, setField, disabled }) {
  const r = report
  return (
    <Section title="Reporter" sub="Who is reporting this event. Name may be blank when the facility confirms anonymity.">
      <div style={grid}>
        <Input label="Name" value={r.reporter_name || ''} onChange={v => setField('reporter_name', v)} placeholder="Reporter name" disabled={disabled} />
        <Select label="Qualification" value={r.reporter_qualification || ''} onChange={v => setField('reporter_qualification', v)} options={qualificationOptions()} disabled={disabled} />
        <Input label="Facility" value={r.reporter_facility_name || ''} onChange={v => setField('reporter_facility_name', v)} placeholder="Facility name" disabled={disabled} />
        <Input label="Phone (Nigeria)" value={r.reporter_phone || ''} onChange={v => setField('reporter_phone', v)} placeholder="+234..." disabled={disabled} />
        <Input label="Email" type="email" value={r.reporter_email || ''} onChange={v => setField('reporter_email', v)} placeholder="reporter@example.com" disabled={disabled} />
        <Input label="License number" value={r.reporter_license_number || ''} onChange={v => setField('reporter_license_number', v)} placeholder="License number" disabled={disabled} />
        <Select
          label="Consent for follow-up"
          value={r.reporter_consent_followup === true ? 'yes' : r.reporter_consent_followup === false ? 'no' : ''}
          onChange={v => setField('reporter_consent_followup', v === 'yes' ? true : v === 'no' ? false : null)}
          options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
          disabled={disabled}
        />
        <Select
          label="Anonymous confirmed by facility"
          value={r.reporter_anonymous_confirmed_by_facility ? 'yes' : 'no'}
          onChange={v => setField('reporter_anonymous_confirmed_by_facility', v === 'yes')}
          options={[{ value: 'yes', label: 'Yes — name may be blank' }, { value: 'no', label: 'No' }]}
          disabled={disabled}
        />
      </div>
    </Section>
  )
}

function PatientSection({ report, setField, disabled }) {
  const r = report
  return (
    <Section title="Patient" sub="An identifier (initials or internal ID) plus age, DOB or age group. No full name is stored.">
      <div style={grid}>
        <Input label="Identifier (initials or internal ID)" value={r.patient_identifier || ''} onChange={v => setField('patient_identifier', v)} placeholder="J.S. or patient-001" disabled={disabled} />
        <Input label="Age" type="number" value={r.patient_age != null ? String(r.patient_age) : ''} onChange={v => setField('patient_age', v === '' ? null : Number(v))} placeholder="e.g. 45" disabled={disabled} />
        <Input label="Date of birth" type="date" value={r.patient_dob || ''} onChange={v => setField('patient_dob', v || null)} disabled={disabled} />
        <Select label="Age group" value={r.patient_age_group || ''} onChange={v => setField('patient_age_group', v)} options={ageGroupOptions()} disabled={disabled} />
        <Select label="Gender" value={r.patient_gender || ''} onChange={v => setField('patient_gender', v)} options={genderOptions()} disabled={disabled} />
        <Input label="Weight (kg)" type="number" value={r.patient_weight_kg != null ? String(r.patient_weight_kg) : ''} onChange={v => setField('patient_weight_kg', v === '' ? null : Number(v))} placeholder="e.g. 70" disabled={disabled} />
        <div style={{ gridColumn: '1 / -1' }}>
          <Textarea label="Medical history (relevant)" rows={3} value={r.patient_medical_history || ''} onChange={v => setField('patient_medical_history', v)} placeholder="Allergies, chronic conditions, pregnancy status, relevant comorbidities…" disabled={disabled} />
        </div>
      </div>
    </Section>
  )
}

// ── Products ─────────────────────────────────────────────────────────────────
const emptyProduct = () => ({
  product_brand_name: '',
  product_generic_name: '',
  manufacturer: '',
  batch_lot_number: '',
  expiry_date: '',
  dose: '',
  route: '',
  frequency: '',
  start_date: '',
  stop_date: '',
  indication: '',
})

const ROUTE_OPTIONS = ['Oral', 'Topical', 'IV', 'IM', 'Subcutaneous', 'Inhalation', 'Ophthalmic', 'Other']

function ProductsSection({ products, onAdd, onUpdate, onRemove, disabled, industry }) {
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState(emptyProduct())

  function startEdit(p) {
    setEditing(p.product_id)
    setDraft({ ...p })
  }
  function startNew() {
    setEditing('__new__')
    setDraft(emptyProduct())
  }
  async function save() {
    if (!draft.product_brand_name || !draft.product_brand_name.trim()) return
    if (editing === '__new__') await onAdd(draft)
    else await onUpdate(editing, draft)
    setEditing(null)
  }
  function set(field, value) { setDraft(prev => ({ ...prev, [field]: value })) }

  return (
    <Section
      title="Suspect products"
      sub="At least one product with a brand name is required before submission."
      badge={!disabled && <Button variant="ghost" size="sm" onClick={startNew}><Plus size={14} /> Add product</Button>}
    >
      {products.length === 0 && !editing && (
        <Empty icon={<AlertTriangle size={20} />} message="No products yet. Add the product(s) suspected of causing the reaction." />
      )}

      {products.map(p => (
        <div key={p.product_id} style={{ borderBottom: `1px solid ${theme.gray100}`, padding: '12px 0' }}>
          {editing === p.product_id ? (
            <ProductForm draft={draft} set={set} industry={industry} onSave={save} onCancel={() => setEditing(null)} />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 13.5, color: theme.navy }}>{p.product_brand_name || 'Unnamed product'}</div>
                <div style={{ fontSize: 12, color: theme.textLight, marginTop: 2, lineHeight: 1.6 }}>
                  {[p.product_generic_name, p.manufacturer, p.batch_lot_number, p.dose, p.route, p.indication].filter(Boolean).join(' · ') || 'No details yet'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {!disabled && <Button variant="ghost" size="sm" onClick={() => startEdit(p)}>Edit</Button>}
                {!disabled && <Button variant="ghost" size="sm" onClick={() => onRemove(p.product_id)}><Trash2 size={13} /></Button>}
              </div>
            </div>
          )}
        </div>
      ))}

      {editing === '__new__' && (
        <div style={{ borderTop: `1px solid ${theme.gray100}`, paddingTop: 14 }}>
          <ProductForm draft={draft} set={set} industry={industry} onSave={save} onCancel={() => setEditing(null)} />
        </div>
      )}
    </Section>
  )
}

function ProductForm({ draft, set, industry, onSave, onCancel }) {
  return (
    <div>
      <div style={grid}>
        <Input label="Brand name *" value={draft.product_brand_name} onChange={v => set('product_brand_name', v)} placeholder="e.g. Ampiclox" required />
        <Input label="Generic name" value={draft.product_generic_name} onChange={v => set('product_generic_name', v)} />
        <Input label="Manufacturer" value={draft.manufacturer} onChange={v => set('manufacturer', v)} />
        <Input label={industry ? 'Batch / lot number *' : 'Batch / lot number'} value={draft.batch_lot_number} onChange={v => set('batch_lot_number', v)} placeholder="Batch/lot" />
        <Input label="Expiry date" type="date" value={draft.expiry_date} onChange={v => set('expiry_date', v)} />
        <Input label="Dose" value={draft.dose} onChange={v => set('dose', v)} placeholder="e.g. 500mg 3x daily" />
        <Select label="Route" value={draft.route} onChange={v => set('route', v)} options={ROUTE_OPTIONS} />
        <Input label="Frequency" value={draft.frequency} onChange={v => set('frequency', v)} />
        <Input label="Start date" type="date" value={draft.start_date} onChange={v => set('start_date', v)} />
        <Input label="Stop date" type="date" value={draft.stop_date} onChange={v => set('stop_date', v)} />
        <Input label="Indication" value={draft.indication} onChange={v => set('indication', v)} placeholder="Why it was given" />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <Button variant="primary" size="sm" onClick={onSave}>Save product</Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

// ── Concomitant meds ─────────────────────────────────────────────────────────
function ConcomitantSection({ meds, onAdd, onRemove, disabled }) {
  const [name, setName] = useState('')
  const [dose, setDose] = useState('')

  async function add() {
    if (!name.trim()) return
    await onAdd({ name, dose: dose || null })
    setName('')
    setDose('')
  }

  return (
    <Section title="Concomitant medications" sub="Other medicines taken at the same time (optional).">
      <div style={grid}>
        <Input label="Medicine name" value={name} onChange={setName} placeholder="e.g. Metformin" disabled={disabled} />
        <Input label="Dose" value={dose} onChange={setDose} placeholder="e.g. 850mg daily" disabled={disabled} />
      </div>
      {!disabled && <Button variant="ghost" size="sm" onClick={add} style={{ marginTop: 12 }}><Plus size={14} /> Add medication</Button>}

      {meds.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {meds.map(m => (
            <div key={m.med_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: `1px solid ${theme.gray100}` }}>
              <div style={{ fontSize: 13, color: theme.textDark }}><strong>{m.name}</strong>{m.dose ? ` · ${m.dose}` : ''}</div>
              {!disabled && <Button variant="ghost" size="sm" onClick={() => onRemove(m.med_id)}><Trash2 size={13} /></Button>}
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

// ── Reactions ────────────────────────────────────────────────────────────────
const emptyReaction = () => ({
  reaction_description: '',
  onset_date: '',
  duration: '',
  severity: '',
  outcome: '',
  seriousness_death: false,
  seriousness_life_threatening: false,
  seriousness_hospitalization: false,
  seriousness_disability: false,
  seriousness_congenital_anomaly: false,
  seriousness_other_medically_important: false,
  action_taken: '',
  causality_assessment: '',
  dechallenge_result: '',
  rechallenge_result: '',
})

function ReactionsSection({ reactions, onAdd, onUpdate, onRemove, disabled, terminology, reactionExpected, onExpectedChange }) {
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState(emptyReaction())

  function startEdit(r) { setEditing(r.reaction_id); setDraft({ ...r }) }
  function startNew() { setEditing('__new__'); setDraft(emptyReaction()) }
  async function save() {
    if (!draft.reaction_description || !draft.reaction_description.trim()) return
    if (editing === '__new__') await onAdd(draft)
    else await onUpdate(editing, draft)
    setEditing(null)
  }
  function set(field, value) { setDraft(prev => ({ ...prev, [field]: value })) }

  return (
    <Section
      title={terminology.adrLabel}
      sub="Describe the reaction(s). At least one is required; the six seriousness flags and outcome decide the reporting deadline."
      badge={!disabled && <Button variant="ghost" size="sm" onClick={startNew}><Plus size={14} /> Add reaction</Button>}
    >
      <div style={{ marginBottom: 16 }}>
        <Select
          label="Was this expected for the product?"
          value={reactionExpected === null ? '' : reactionExpected ? 'expected' : 'unexpected'}
          onChange={v => onExpectedChange(v === '' ? null : v === 'expected')}
          options={[{ value: 'expected', label: 'Expected' }, { value: 'unexpected', label: 'Unexpected' }]}
          disabled={disabled}
        />
      </div>

      {reactions.length === 0 && !editing && (
        <Empty icon={<AlertTriangle size={20} />} message={`Add the ${terminology.adrLabel.toLowerCase()} description and seriousness.`} />
      )}

      {reactions.map(r => (
        <div key={r.reaction_id} style={{ borderBottom: `1px solid ${theme.gray100}`, padding: '12px 0' }}>
          {editing === r.reaction_id ? (
            <ReactionForm draft={draft} set={set} onSave={save} onCancel={() => setEditing(null)} />
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 13.5, color: theme.navy }}>{r.reaction_description}</div>
                  <div style={{ fontSize: 12, color: theme.textLight, marginTop: 2, lineHeight: 1.6 }}>
                    {[r.severity ? REACTION_SEVERITY_LABELS[r.severity] : null, r.outcome ? `Outcome: ${REACTION_OUTCOME_LABELS[r.outcome]}` : null, r.onset_date ? `Onset ${r.onset_date}` : null].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {!disabled && <Button variant="ghost" size="sm" onClick={() => startEdit(r)}>Edit</Button>}
                  {!disabled && <Button variant="ghost" size="sm" onClick={() => onRemove(r.reaction_id)}><Trash2 size={13} /></Button>}
                </div>
              </div>
              {isSeriousRow(r) && (
                <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {SERIOUSNESS_OPTIONS.filter(o => r[o.key]).map(o => <Pill key={o.key} label={o.label} type="red" />)}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {editing === '__new__' && (
        <div style={{ borderTop: `1px solid ${theme.gray100}`, paddingTop: 14 }}>
          <ReactionForm draft={draft} set={set} onSave={save} onCancel={() => setEditing(null)} />
        </div>
      )}
    </Section>
  )
}

function isSeriousRow(r) {
  return SERIOUSNESS_OPTIONS.some(o => r[o.key])
}

function ReactionForm({ draft, set, onSave, onCancel }) {
  return (
    <div>
      <div style={grid}>
        <div style={{ gridColumn: '1 / -1' }}>
          <Textarea label="Reaction description *" rows={2} value={draft.reaction_description} onChange={v => set('reaction_description', v)} placeholder="e.g. Anaphylactic reaction, rash, nausea…" required />
        </div>
        <Input label="Onset date" type="date" value={draft.onset_date} onChange={v => set('onset_date', v)} />
        <Input label="Duration" value={draft.duration} onChange={v => set('duration', v)} placeholder="e.g. 2 hours, 3 days" />
        <Select label="Severity *" value={draft.severity} onChange={v => set('severity', v)} options={severityOptions()} />
        <Select label="Outcome *" value={draft.outcome} onChange={v => set('outcome', v)} options={outcomeOptions()} />
        <Select label="Action taken" value={draft.action_taken} onChange={v => set('action_taken', v)} options={actionTakenOptions()} />
        <Select label="Causality assessment" value={draft.causality_assessment} onChange={v => set('causality_assessment', v)} options={causalityOptions()} />
        <Select label="De-challenge result" value={draft.dechallenge_result} onChange={v => set('dechallenge_result', v)} options={dechallengeOptions()} />
        <Select label="Re-challenge result" value={draft.rechallenge_result} onChange={v => set('rechallenge_result', v)} options={rechallengeOptions()} />
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: theme.gray600, marginBottom: 8 }}>Seriousness (tick all that apply)</div>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {SERIOUSNESS_OPTIONS.map(o => (
            <label key={o.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: theme.textDark, cursor: 'pointer', padding: '8px 10px', border: `1px solid ${theme.gray200}`, borderRadius: theme.radius.sm, background: draft[o.key] ? theme.successBg : 'white' }}>
              <input type="checkbox" checked={!!draft[o.key]} onChange={e => set(o.key, e.target.checked)} style={{ accentColor: theme.tealDeep }} />
              {o.label}
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <Button variant="primary" size="sm" onClick={onSave}>Save reaction</Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

// ── Module-specific ──────────────────────────────────────────────────────────
function IndustrySection({ report, setField, newSafetySignal, setNewSafetySignal, disabled }) {
  return (
    <Section title="Regulatory details" sub="Industry / manufacturer-importer fields. Batch/lot, causality assessment and case narrative are mandatory.">
      <div style={grid}>
        <Input label="Batch / lot number *" value={report.batch_lot_number || ''} onChange={v => setField('batch_lot_number', v)} placeholder="Batch/lot" disabled={disabled} />
        <Select label="Causality assessment *" value={report.causality_assessment || ''} onChange={v => setField('causality_assessment', v)} options={causalityOptions()} disabled={disabled} />
        <Input label="Naranjo score" type="number" value={report.naranjo_score != null ? String(report.naranjo_score) : ''} onChange={v => setField('naranjo_score', v === '' ? null : Number(v))} disabled={disabled} />
        <Input label="Follow-up version" type="number" value={report.follow_up_version_number != null ? String(report.follow_up_version_number) : ''} onChange={v => setField('follow_up_version_number', v === '' ? null : Number(v))} disabled={disabled} />
        <div style={{ gridColumn: '1 / -1' }}>
          <Textarea label="Case narrative summary *" rows={4} value={report.case_narrative_summary || ''} onChange={v => setField('case_narrative_summary', v)} placeholder="Chronological account of the event…" disabled={disabled} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <Textarea label="Distribution / batch trace notes" rows={3} value={report.distribution_batch_trace_notes || ''} onChange={v => setField('distribution_batch_trace_notes', v)} placeholder="Batches distributed, locations, quantities…" disabled={disabled} />
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <Toggle
          label="New safety signal"
          desc="Industry only — forces the 3-day reporting deadline."
          value={newSafetySignal}
          onChange={setNewSafetySignal}
        />
      </div>
    </Section>
  )
}

const SKINCARE_REACTION_TYPES = [
  { value: 'irritation', label: 'Irritation' },
  { value: 'allergic_contact_dermatitis', label: 'Allergic contact dermatitis' },
  { value: 'photosensitivity', label: 'Photosensitivity' },
  { value: 'breakout', label: 'Breakout' },
  { value: 'other', label: 'Other' },
]

function SkincareSection({ report, setField, disabled }) {
  return (
    <Section title="Cosmetic details" sub="Skincare / aesthetic spa fields for an Adverse Cosmetic Event.">
      <div style={grid}>
        <Input label="Application site *" value={report.application_site || ''} onChange={v => setField('application_site', v)} placeholder="e.g. Face, hands" disabled={disabled} />
        <Select label="Cosmetic reaction type *" value={report.cosmetic_reaction_type || ''} onChange={v => setField('cosmetic_reaction_type', v)} options={SKINCARE_REACTION_TYPES} disabled={disabled} />
        <Select label="Onset timing" value={report.onset_timing || ''} onChange={v => setField('onset_timing', v)} options={[{ value: 'immediate', label: 'Immediate' }, { value: 'delayed', label: 'Delayed' }]} disabled={disabled} />
        <Select label="Resolution status" value={report.resolution_status || ''} onChange={v => setField('resolution_status', v)} options={[{ value: 'resolved', label: 'Resolved' }, { value: 'improving', label: 'Improving' }, { value: 'persistent', label: 'Persistent' }, { value: 'chronic', label: 'Chronic' }]} disabled={disabled} />
        <Select label="Discontinued use after event?" value={report.discontinued_use === true ? 'yes' : report.discontinued_use === false ? 'no' : ''} onChange={v => setField('discontinued_use', v === 'yes' ? true : v === 'no' ? false : null)} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} disabled={disabled} />
      </div>
    </Section>
  )
}

// ── Hospital clinical details ────────────────────────────────────────────────
function HospitalSection({ report, setField, onUpload, uploading, disabled }) {
  const r = report
  return (
    <Section title="Clinical details" sub="Hospital / clinic fields. Ward/department and attending physician are mandatory before submission.">
      <div style={grid}>
        <Input label="Ward / department *" value={r.ward_department || ''} onChange={v => setField('ward_department', v)} placeholder="e.g. Ward 4, General Medicine" disabled={disabled} />
        <Input label="Attending physician *" value={r.attending_physician || ''} onChange={v => setField('attending_physician', v)} placeholder="Physician name" disabled={disabled} />
        <div style={{ gridColumn: '1 / -1' }}>
          <Textarea label="Lab investigation notes" rows={3} value={r.lab_investigation_notes || ''} onChange={v => setField('lab_investigation_notes', v)} placeholder="Lab results, investigations relevant to the reaction…" disabled={disabled} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <Textarea label="Comorbidities" rows={2} value={r.comorbidities || ''} onChange={v => setField('comorbidities', v)} placeholder="Pre-existing conditions relevant to the case…" disabled={disabled} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <Textarea label="Treatment given for the reaction" rows={2} value={r.treatment_given_for_reaction || ''} onChange={v => setField('treatment_given_for_reaction', v)} placeholder="Treatment administered in response to the reaction…" disabled={disabled} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <Toggle
            label="ICU admission required"
            desc="Whether the reaction required admission to intensive care."
            value={!!r.icu_admission}
            onChange={v => setField('icu_admission', v)}
            disabled={disabled}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', marginTop: 16 }}>
        <AttachmentField
          label="Lab investigation attachment"
          url={r.lab_attachment_url || ''}
          onPick={file => onUpload(file, 'lab_attachment_url')}
          uploading={uploading}
          disabled={disabled}
        />
        <AttachmentField
          label="Discharge summary attachment"
          url={r.discharge_summary_attachment_url || ''}
          onPick={file => onUpload(file, 'discharge_summary_attachment_url')}
          uploading={uploading}
          disabled={disabled}
        />
      </div>
    </Section>
  )
}

// Small upload-or-link row for a single attachment column.
function AttachmentField({ label, url, onPick, uploading, disabled }) {
  const inputRef = useRef(null)
  return (
    <div style={{ border: `1px solid ${theme.gray200}`, borderRadius: theme.radius.md, padding: 12, background: 'white' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: theme.gray600, marginBottom: 8 }}>{label}</div>
      <input ref={inputRef} type="file" hidden onChange={e => e.target.files && e.target.files[0] && onPick(e.target.files[0])} />
      {url ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: theme.tealDeep, fontWeight: 600 }}>Open attachment ↗</a>
          {!disabled && (
            <Button variant="ghost" size="sm" onClick={() => inputRef.current && inputRef.current.click()} loading={uploading} loadingText="Uploading…">
              Replace
            </Button>
          )}
        </div>
      ) : (
        !disabled && (
          <Button variant="ghost" size="sm" onClick={() => inputRef.current && inputRef.current.click()} loading={uploading} loadingText="Uploading…">
            <Upload size={14} /> Upload
          </Button>
        )
      )}
    </div>
  )
}

// ── Evidence ─────────────────────────────────────────────────────────────────
function EvidenceSection({ photos, onUpload, onRemove, uploading, fileInputRef, disabled }) {
  return (
    <Section
      title="Evidence photos"
      sub="Photos of the product, packaging or the effect (optional, never blocks submission)."
      badge={!disabled && (
        <Button variant="ghost" size="sm" onClick={() => fileInputRef.current && fileInputRef.current.click()} disabled={uploading} loading={uploading} loadingText="Uploading…">
          <Camera size={14} /> Add photo
        </Button>
      )}
    >
      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => e.target.files && e.target.files[0] && onUpload(e.target.files[0])} />

      {photos.length === 0 && (
        <Empty icon={<Camera size={20} />} message="No evidence photos yet. You can add photos of the product or the effect — they are never required." />
      )}

      {photos.length > 0 && (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
          {photos.map(p => (
            <div key={p.photo_id} style={{ border: `1px solid ${theme.gray200}`, borderRadius: theme.radius.md, overflow: 'hidden', background: 'white' }}>
              <div style={{ height: 110, background: theme.gray100, backgroundImage: `url(${p.evidence_photo_file})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
              <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <div style={{ fontSize: 11.5, color: theme.textLight, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {EVIDENCE_PHOTO_TYPE_LABELS[p.evidence_photo_type] || 'Photo'}
                </div>
                {!disabled && <button onClick={() => onRemove(p.photo_id)} aria-label="Remove photo" style={{ background: 'none', border: 'none', color: theme.danger, cursor: 'pointer', padding: 2 }}><X size={14} /></button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

// ── Deadline banner ───────────────────────────────────────────────────────────
function DeadlineBanner({ status, deadline, createdAt, industry }) {
  const palette = {
    overdue: { bg: theme.dangerBg, border: theme.danger, text: theme.danger, label: 'Overdue' },
    due_soon: { bg: theme.warningBg, border: theme.warning, text: theme.warning, label: 'Due soon' },
    on_track: { bg: theme.successBg, border: theme.success, text: theme.success, label: 'On track' },
  }[status] || { bg: theme.gray50, border: theme.gray200, text: theme.gray600, label: status || '—' }

  return (
    <div style={{ marginBottom: 20, padding: '14px 18px', borderRadius: theme.radius.md, background: palette.bg, border: `1px solid ${palette.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: theme.gray600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Submission deadline</div>
          <div style={{ fontSize: 17, fontWeight: 900, color: palette.text, marginTop: 2 }}>{fmtDeadline(deadline)}</div>
        </div>
        <Pill label={palette.label} type={status === 'overdue' ? 'red' : status === 'due_soon' ? 'amber' : 'green'} />
      </div>
      <div style={{ fontSize: 11.5, color: theme.gray600, marginTop: 6 }}>
        {industry
          ? status === 'overdue' ? 'Under 20% of the window remains (or the deadline has passed).'
            : status === 'due_soon' ? '20–50% of the reporting window remains.'
            : 'Over 50% of the reporting window remains.'
          : 'The deadline is fixed by the seriousness and expected/unexpected status of the reaction.'}
      </div>
    </div>
  )
}

function calculateDeadlineFrom(report, isSerious, reactionExpected, newSafetySignal) {
  if (!report || !report.created_at) return null
  return adrValidation.computeDeadline(new Date(report.created_at), isSerious, reactionExpected, newSafetySignal)
}

function scalarFields(r) {
  return {
    reporter_name: r.reporter_name,
    reporter_qualification: r.reporter_qualification,
    reporter_facility_name: r.reporter_facility_name,
    reporter_phone: r.reporter_phone,
    reporter_email: r.reporter_email,
    reporter_license_number: r.reporter_license_number,
    reporter_consent_followup: r.reporter_consent_followup,
    reporter_anonymous_confirmed_by_facility: !!r.reporter_anonymous_confirmed_by_facility,
    patient_identifier: r.patient_identifier,
    patient_age: r.patient_age,
    patient_dob: r.patient_dob,
    patient_age_group: r.patient_age_group,
    patient_gender: r.patient_gender,
    patient_weight_kg: r.patient_weight_kg,
    patient_medical_history: r.patient_medical_history,
    reaction_expected: r.reaction_expected,
    new_safety_signal: !!r.new_safety_signal,
    batch_lot_number: r.batch_lot_number,
    causality_assessment: r.causality_assessment,
    case_narrative_summary: r.case_narrative_summary,
    naranjo_score: r.naranjo_score,
    distribution_batch_trace_notes: r.distribution_batch_trace_notes,
    application_site: r.application_site,
    cosmetic_reaction_type: r.cosmetic_reaction_type,
    onset_timing: r.onset_timing,
    discontinued_use: r.discontinued_use,
    resolution_status: r.resolution_status,
    follow_up_version_number: r.follow_up_version_number,
    ward_department: r.ward_department,
    attending_physician: r.attending_physician,
    lab_investigation_notes: r.lab_investigation_notes,
    lab_attachment_url: r.lab_attachment_url,
    comorbidities: r.comorbidities,
    icu_admission: r.icu_admission,
    treatment_given_for_reaction: r.treatment_given_for_reaction,
    discharge_summary_attachment_url: r.discharge_summary_attachment_url,
  }
}