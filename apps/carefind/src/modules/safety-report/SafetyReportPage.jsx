import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../providers/AuthContext'
import { safetyReportRepository as repository } from './repository'
import { validatePublicReport, buildRouteKey } from './validation.js'
import { STEPS, STEP_ORDER, STEP_LABELS, WELCOME_HEADING, COMPANY_KINDS } from './constants.js'
import { useSafetyDraft, blankProduct, blankReaction } from './useSafetyDraft.js'
import { s, ProgressDots } from './ui.jsx'
import ReporterStep from './steps/ReporterStep.jsx'
import PatientStep from './steps/PatientStep.jsx'
import ProductsStep from './steps/ProductsStep.jsx'
import ReactionsStep from './steps/ReactionsStep.jsx'
import AdditionalStep from './steps/AdditionalStep.jsx'
import ReviewStep from './steps/ReviewStep.jsx'

// Server missing-label -> wizard step (for post-submit server errors).
const SERVER_LABEL_TO_STEP = {
  'Reporter qualification': STEPS.REPORTER,
  'Reporter name': STEPS.REPORTER,
  'Reporter consent for follow-up': STEPS.REPORTER,
  'Reporter phone or email': STEPS.REPORTER,
  'Patient identifier': STEPS.PATIENT,
  'Patient gender': STEPS.PATIENT,
  'Patient age or DOB or age group': STEPS.PATIENT,
  'At least one suspect product': STEPS.PRODUCTS,
  'Product brand name': STEPS.PRODUCTS,
  'At least one adverse reaction': STEPS.REACTIONS,
  'Reaction description': STEPS.REACTIONS,
  Severity: STEPS.REACTIONS,
  Outcome: STEPS.REACTIONS,
  'Seriousness answers': STEPS.REACTIONS,
  'All six seriousness fields': STEPS.REACTIONS,
  'All six seriousness fields': STEPS.REACTIONS,
}

function companyIssues(products) {
  return products.filter(
    (p) =>
      p.brandName.trim().length > 0 &&
      ((p.company.kind === COMPANY_KINDS.VERIFIED && !p.company.businessId) ||
        (p.company.kind === COMPANY_KINDS.UNVERIFIED_CANDIDATE && p.company.candidateName.trim().length === 0))
  ).length
}

export default function SafetyReportPage() {
  const { user } = useAuth()
  const [prefill, setPrefill] = useState({ reporter: { email: user?.email || '' } })
  const [view, setView] = useState(STEPS.WELCOME)
  const [myDrafts, setMyDrafts] = useState([])
  const [draftsLoading, setDraftsLoading] = useState(true)
  const [stepError, setStepError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [serverMissing, setServerMissing] = useState([])
  const [reference, setReference] = useState(null)
  const headingRef = useRef(null)

  const { draft, setDraft, reportId, status, error, lastSavedAt, start, saveNow } =
    useSafetyDraft(repository, prefill)
  const serverIds = useRef({ products: [], reactions: [], meds: [] })

  // Prefill reliable profile info (name + auth email); everything stays editable.
  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const [profile, drafts] = await Promise.all([repository.getMyProfile(), repository.getMyDrafts()])
        if (!live) return
        setPrefill({ reporter: { name: profile.display_name || '', email: user?.email || '' } })
        setMyDrafts(drafts)
      } catch {
        if (live) setPrefill({ reporter: { email: user?.email || '' } })
      } finally {
        if (live) setDraftsLoading(false)
      }
    })()
    return () => { live = false }
  }, [user])

  useEffect(() => {
    headingRef.current?.focus?.()
    window.scrollTo(0, 0)
  }, [view])

  const validation = useMemo(() => validatePublicReport(draft), [draft])
  const missingFor = useCallback((step) => validation.missingFields.filter((f) => f.step === step), [validation])

  const persistProducts = useCallback(async (snapshot) => {
    const seen = []
    for (const p of snapshot.products.length > 0 ? snapshot.products : [{ ...blankProduct() }]) {
      if (!p.brandName.trim() && !p.product_id) continue
      const saved = await repository.saveProduct(reportId, { ...p, brandName: p.brandName.trim() || '(unspecified product)' })
      seen.push(saved.product_id)
      const company = p.company?.kind ? p.company : { kind: 'unknown' }
      if (p.brandName.trim()) {
        await repository.createRoute({
          reportId,
          productId: saved.product_id,
          kind: company.kind || 'unknown',
          businessId: company.kind === 'verified' ? company.businessId || null : null,
          candidateName: company.kind === 'unverified_candidate' ? company.candidateName || null : null,
          idempotencyKey: buildRouteKey({
            reportId, productId: saved.product_id, kind: company.kind || 'unknown',
            businessId: company.businessId || '', candidateName: company.candidateName || '',
          }),
        })
      }
      setDraft((prev) => ({
        ...prev,
        products: prev.products.map((lp) =>
          lp === p || (!lp.product_id && lp.brandName === p.brandName) ? { ...lp, product_id: saved.product_id } : lp
        ),
      }))
    }
    for (const id of serverIds.current.products.filter((id) => !seen.includes(id))) {
      const prod = snapshot.products.find((p) => p.product_id === id)
      if (!prod) await repository.deleteProduct(id, reportId).catch(() => {})
    }
    serverIds.current.products = seen
  }, [reportId, repository, setDraft])

  const persistReactions = useCallback(async (snapshot) => {
    const seen = []
    const list = snapshot.reactions.length > 0 ? snapshot.reactions : [{ ...blankReaction() }]
    for (const r of list) {
      if (!r.description.trim() && !r.reaction_id) continue
      const saved = await repository.saveReaction(reportId, r)
      seen.push(saved.reaction_id)
      setDraft((prev) => ({
        ...prev,
        reactions: prev.reactions.map((lr) => (lr === r ? { ...lr, reaction_id: saved.reaction_id } : lr)),
      }))
    }
    for (const id of serverIds.current.reactions.filter((id) => !seen.includes(id))) {
      if (!snapshot.reactions.some((r) => r.reaction_id === id)) {
        await repository.deleteReaction(id, reportId).catch(() => {})
      }
    }
    serverIds.current.reactions = seen
  }, [reportId, repository, setDraft])

  const persistMeds = useCallback(async (snapshot) => {
    const seen = []
    for (const m of snapshot.meds) {
      if (!m.name.trim() && !m.med_id) continue
      const saved = await repository.saveMed(reportId, m)
      seen.push(saved.med_id)
      setDraft((prev) => ({
        ...prev,
        meds: prev.meds.map((lm) => (lm === m ? { ...lm, med_id: saved.med_id } : lm)),
      }))
    }
    for (const id of serverIds.current.meds.filter((id) => !seen.includes(id))) {
      if (!snapshot.meds.some((m) => m.med_id === id)) {
        await repository.deleteMed(id, reportId).catch(() => {})
      }
    }
    serverIds.current.meds = seen
  }, [reportId, repository, setDraft])

  const goNext = async (step) => {
    setStepError(null)
    const idx = STEP_ORDER.indexOf(step)
    if (step === STEPS.PRODUCTS) {
      const issues = companyIssues(draft.products)
      if (issues > 0) {
        setStepError('Choose a company option for each named product (select a company, “I don’t know”, or enter the name as printed).')
        return
      }
    }
    const missing = missingFor(step)
    // The additional step is optional — never block on it.
    if (step !== STEPS.ADDITIONAL && missing.length > 0) {
      setStepError(`Please complete: ${missing.map((m) => m.label).join('; ')}.`)
      return
    }
    try {
      await saveNow()
      if (step === STEPS.PRODUCTS) await persistProducts(draft)
      if (step === STEPS.REACTIONS) await persistReactions(draft)
      if (step === STEPS.ADDITIONAL) await persistMeds(draft)
      setView(STEP_ORDER[idx + 1])
    } catch {
      setStepError('Could not save. Check your connection and retry — nothing was lost.')
    }
  }

  const handleUpload = async (file) => {
    const row = await repository.uploadAttachment(reportId, file)
    setDraft((prev) => ({ ...prev, attachments: [...prev.attachments, { photo_id: row.photo_id, path: row.evidence_photo_file, caption: '' }] }))
  }

  const handleRemoveAttachment = async (attachment) => {
    await repository.removeAttachment(attachment.photo_id, reportId, attachment.path)
    setDraft((prev) => ({ ...prev, attachments: prev.attachments.filter((a) => a !== attachment) }))
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    setSubmitError(null)
    setServerMissing([])
    try {
      await saveNow()
      await persistProducts(draft)
      await persistReactions(draft)
      await persistMeds(draft)
      const result = await repository.submit(reportId)
      if (!result || result.valid !== true) {
        const labels = result?.missing || ['Submission was rejected.']
        setServerMissing(labels.map((label) => ({ label, step: SERVER_LABEL_TO_STEP[label] || STEPS.REVIEW })))
        setSubmitError('The server could not accept this report yet. See the missing items above — your draft is saved.')
        setSubmitting(false)
        return
      }
      const full = await repository.getDraftWithDetails(reportId)
      setReference(full?.report_number || full?.report_id || reportId)
      setView(STEPS.SUCCESS)
    } catch (e) {
      setSubmitError(e.message || 'Submission failed. Your draft is saved — please retry.')
    } finally {
      setSubmitting(false)
    }
  }

  const begin = async (existingId) => {
    setStepError(null)
    await start(existingId)
    setView(STEPS.REPORTER)
  }

  if (view === STEPS.WELCOME) {
    return (
      <main style={s.page} aria-labelledby="sr-welcome-h">
        <h1 id="sr-welcome-h" tabIndex={-1} ref={headingRef} style={s.h1}>{WELCOME_HEADING}</h1>
        <div style={s.card}>
          <p style={s.body}>Have you or someone else had a suspected side effect from a medicine, vaccine or health product? Tell us — your report helps monitor medicine safety for everyone.</p>
          <p style={s.body}>A report does <strong>not</strong> prove the product caused the reaction. It is the starting point for safety reviewers to look for patterns.</p>
          <p style={s.banner} role="note">This is <strong>not</strong> an emergency service. If someone needs urgent care, contact emergency services or go to the nearest hospital first.</p>
          <button type="button" onClick={() => begin(null)} style={s.btnPrimary} disabled={status === 'loading'}>
            {status === 'loading' ? 'Starting…' : 'Start report'}
          </button>
          {draftsLoading ? (
            <p style={s.help} role="status">Checking for saved drafts…</p>
          ) : (
            myDrafts.length > 0 && (
              <button type="button" onClick={() => begin(myDrafts[0].report_id)} style={{ ...s.btnGhost, marginTop: 8, width: '100%' }}>
                Continue draft{myDrafts.length > 1 ? ` (most recent of ${myDrafts.length})` : ''} — started {new Date(myDrafts[0].created_at).toLocaleDateString()}
              </button>
            )
          )}
          {error && <p style={s.error} role="alert">{error}</p>}
        </div>
        <p style={s.muted}>Takes about 1–2 minutes for a basic report. Your details stay confidential and are never published.</p>
      </main>
    )
  }

  if (view === STEPS.SUCCESS) {
    return (
      <main style={s.page} aria-labelledby="sr-success-h">
        <h1 id="sr-success-h" tabIndex={-1} ref={headingRef} style={s.h1}>Report received</h1>
        <div style={s.card}>
          <p style={s.body}>Thank you. Your safety report has been recorded with reference:</p>
          <p style={{ fontSize: 20, fontWeight: 800, color: 'var(--teal)' }} aria-label={`Report reference ${reference}`}>{reference}</p>
          <p style={s.body}>What happens next: our safety team acknowledges your report inside this platform and may contact you if you agreed to follow-up. Acknowledgement here means <strong>we received it</strong> — it is not a confirmation of any regulatory submission.</p>
          <div style={{ ...s.row, marginTop: 12 }}>
            <Link to="/feed" style={{ ...s.btnPrimary, textDecoration: 'none', textAlign: 'center' }}>Back to feed</Link>
          </div>
        </div>
      </main>
    )
  }

  const stepIndex = STEP_ORDER.indexOf(view)
  const saveLabel = status === 'saving' ? 'Saving…' : status === 'error' ? 'Save failed' : lastSavedAt ? `Draft saved ${lastSavedAt.toLocaleTimeString()}` : 'Draft'

  return (
    <main style={s.page} aria-labelledby="sr-step-h">
      <span id="sr-step-h" ref={headingRef} tabIndex={-1} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {STEP_LABELS[view]} — step {stepIndex + 1} of {STEP_ORDER.length}
      </span>
      <ProgressDots steps={STEP_ORDER} current={view} />
      <p style={s.help} role="status" aria-live="polite">{saveLabel}</p>
      {error && (
        <div style={s.error} role="alert">
          {error} <button type="button" onClick={saveNow} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--teal)', fontWeight: 800, cursor: 'pointer', textDecoration: 'underline' }}>Retry now</button>
        </div>
      )}

      <div style={s.card}>
        {view === STEPS.REPORTER && <ReporterStep value={draft.reporter} onChange={(reporter) => setDraft((p) => ({ ...p, reporter }))} />}
        {view === STEPS.PATIENT && <PatientStep value={draft.patient} onChange={(patient) => setDraft((p) => ({ ...p, patient }))} />}
        {view === STEPS.PRODUCTS && (
          <ProductsStep
            value={draft.products}
            onChange={(products) => setDraft((p) => ({ ...p, products }))}
            searchCompanies={(q, l) => repository.searchCompanies(q, l)}
          />
        )}
        {view === STEPS.REACTIONS && <ReactionsStep value={draft.reactions} onChange={(reactions) => setDraft((p) => ({ ...p, reactions }))} />}
        {view === STEPS.ADDITIONAL && (
          <AdditionalStep
            value={draft.extra}
            meds={draft.meds}
            attachments={draft.attachments}
            onExtra={(extra) => setDraft((p) => ({ ...p, extra }))}
            onMeds={(meds) => setDraft((p) => ({ ...p, meds }))}
            onUpload={handleUpload}
            onRemoveAttachment={handleRemoveAttachment}
            resolveUrl={(path) => repository.signedAttachmentUrl(path)}
          />
        )}
        {view === STEPS.REVIEW && (
          <ReviewStep
            draft={draft}
            missing={[...validation.missingFields, ...serverMissing]}
            onEdit={setView}
            onSubmit={handleSubmit}
            submitting={submitting}
            submitError={submitError}
          />
        )}
      </div>

      {stepError && <p style={s.error} role="alert">{stepError}</p>}

      <div style={s.nav}>
        {stepIndex > 0 && (
          <button type="button" onClick={() => { setStepError(null); setView(STEP_ORDER[stepIndex - 1]) }} style={s.btnGhost}>Back</button>
        )}
        {view !== STEPS.REVIEW && (
          <button type="button" onClick={() => goNext(view)} style={s.btnPrimary}>
            {view === STEPS.ADDITIONAL ? 'Save & review' : 'Save & continue'}
          </button>
        )}
      </div>
    </main>
  )
}
