import { useCallback, useEffect, useRef, useState } from 'react'
import { SERIOUSNESS_KEYS } from './constants.js'

// ── Draft lifecycle + autosave (CareFind safety report) ────────────────────
// Server rows are the source of truth (confidential data never sits in
// localStorage). Local state holds in-progress edits; the report row
// autosaves on a debounce; child entities persist on step continue and at
// submit. Transient network failures surface as a retryable banner — the
// server keeps the last saved state, so nothing is silently lost.

export function blankReporter(prefill = {}) {
  return {
    name: '', qualification: '', phone: '', email: '',
    consentFollowup: null, anonymousConfirmed: false, facilityName: '', ...prefill,
  }
}

export function blankDraft(prefill = {}) {
  return {
    reporter: blankReporter(prefill.reporter),
    patient: { identifier: '', gender: '', age: '', dob: '', ageGroup: '', weightKg: '', medicalHistory: '' },
    products: [],
    reactions: [],
    meds: [],
    extra: { conditions: '', notes: '' },
    attachments: [],
  }
}

export function blankProduct() {
  return {
    brandName: '', genericName: '', manufacturer: '', batchLot: '', expiryDate: '',
    dose: '', route: '', frequency: '', indication: '', startDate: '', stopDate: '',
    company: { kind: 'unknown', businessId: '', businessName: '', candidateName: '' },
  }
}

export function blankReaction() {
  return {
    description: '', severity: '', outcome: '', onsetDate: '', duration: '',
    seriousness: Object.fromEntries(SERIOUSNESS_KEYS.map((k) => [k, ''])),
  }
}

// Map server rows back onto the wizard draft shape (resume path).
export function rowToDraft(report, { products = [], meds = [], reactions = [], photos = [], routes = [] } = {}) {
  const routeByProduct = new Map((routes || []).map((r) => [r.product_id, r]))
  return {
    reporter: {
      name: report.reporter_name || '',
      qualification: report.reporter_qualification || '',
      phone: report.reporter_phone || '',
      email: report.reporter_email || '',
      consentFollowup: report.reporter_consent_followup ?? null,
      anonymousConfirmed: report.reporter_anonymous_confirmed_by_facility === true,
      facilityName: report.reporter_facility_name || '',
    },
    patient: {
      identifier: report.patient_identifier || '',
      gender: report.patient_gender || '',
      age: report.patient_age ?? '',
      dob: report.patient_dob || '',
      ageGroup: report.patient_age_group || '',
      weightKg: report.patient_weight_kg ?? '',
      medicalHistory: report.patient_medical_history || '',
    },
    products: products.map((p) => ({
      product_id: p.product_id,
      brandName: p.product_brand_name || '',
      genericName: p.product_generic_name || '',
      manufacturer: p.manufacturer || '',
      batchLot: p.batch_lot_number || '',
      expiryDate: p.expiry_date || '',
      dose: p.dose || '',
      route: p.route || '',
      frequency: p.frequency || '',
      indication: p.indication || '',
      startDate: p.start_date || '',
      stopDate: p.stop_date || '',
      company: routeToCompany(routeByProduct.get(p.product_id)),
    })),
    reactions: reactions.map((r) => ({
      reaction_id: r.reaction_id,
      description: r.reaction_description || '',
      severity: r.severity || '',
      outcome: r.outcome || '',
      onsetDate: r.onset_date || '',
      duration: r.duration || '',
      seriousness: Object.fromEntries(
        SERIOUSNESS_KEYS.map((k) => [
          k,
          r[`seriousness_${k}`] === true ? 'yes' : ((r.seriousness_unknown || []).includes(k) ? 'not_sure' : 'no'),
        ])
      ),
    })),
    meds: meds.map((m) => ({ med_id: m.med_id, name: m.name || '', dose: m.dose || '', startDate: m.start_date || '', endDate: m.end_date || '' })),
    extra: { conditions: report.comorbidities || '', notes: report.case_narrative_summary || '' },
    attachments: photos.map((p) => ({ photo_id: p.photo_id, path: p.evidence_photo_file, caption: p.evidence_photo_caption || '' })),
  }
}

function routeToCompany(route) {
  if (!route) return { kind: 'unknown', businessId: '', businessName: '', candidateName: '' }
  if (route.selection_kind === 'verified') {
    return { kind: 'verified', businessId: route.responsible_business_id || '', businessName: '', candidateName: '' }
  }
  if (route.selection_kind === 'unverified_candidate') {
    return { kind: 'unverified_candidate', businessId: '', businessName: '', candidateName: route.candidate_name || '' }
  }
  return { kind: 'unknown', businessId: '', businessName: '', candidateName: '' }
}

const AUTOSAVE_MS = 1500

export function useSafetyDraft(repository, prefill) {
  const [draft, setDraftState] = useState(() => blankDraft(prefill))
  const [reportId, setReportId] = useState(null)
  const [reportNumber, setReportNumber] = useState(null)
  const [status, setStatus] = useState('new') // new|loading|ready|saving|saved|error|submitting|submitted
  const [error, setError] = useState(null)
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const timer = useRef(null)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const reportRef = useRef(null)
  // Snapshot of the last successfully persisted draft. The autosave effect
  // only schedules a save when the live draft differs from this — without
  // the comparison, the saved->effect->save cycle would PATCH forever.
  const lastPersisted = useRef(null)

  const setDraft = useCallback((updater) => {
    setDraftState((prev) => (typeof updater === 'function' ? updater(prev) : { ...prev, ...updater }))
  }, [])

  const persistRow = useCallback(async (id, snapshot) => {
    const row = await repository.updateDraft(id, snapshot)
    setReportNumber(row.report_number || null)
    setLastSavedAt(new Date())
    return row
  }, [repository])

  // Debounced autosave of the report row (reporter/patient/extra sections).
  // Fires only when the draft differs from the last persisted snapshot.
  useEffect(() => {
    if (status !== 'ready' && status !== 'saved' && status !== 'error') return
    if (!reportRef.current) return
    const snapshot = JSON.stringify(draftRef.current)
    if (snapshot === lastPersisted.current) return
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setStatus('saving')
      try {
        await persistRow(reportRef.current, draftRef.current)
        lastPersisted.current = JSON.stringify(draftRef.current)
        setStatus('saved')
        setError(null)
      } catch (e) {
        setStatus('error')
        setError('Could not save your draft. Check your connection and try again. Your last saved version is kept.')
      }
    }, AUTOSAVE_MS)
    return () => clearTimeout(timer.current)
  }, [draft, status, persistRow])

  const start = useCallback(async (existingId = null) => {
    setStatus('loading')
    setError(null)
    try {
      if (existingId) {
        const full = await repository.getDraftWithDetails(existingId)
        if (!full) throw new Error('Draft not found. It may have been submitted or deleted.')
        reportRef.current = full.report_id
        setReportId(full.report_id)
        setReportNumber(full.report_number || null)
        const resumed = rowToDraft(full, full)
        lastPersisted.current = JSON.stringify(resumed)
        setDraftState(resumed)
      } else {
        const row = await repository.createDraft(blankDraft(prefill))
        reportRef.current = row.report_id
        setReportId(row.report_id)
        setReportNumber(row.report_number || null)
        lastPersisted.current = JSON.stringify(blankDraft(prefill))
        setDraftState(blankDraft(prefill))
      }
      setStatus('ready')
    } catch (e) {
      setStatus('error')
      setError(e.message || 'Could not start your report. Please retry.')
    }
  }, [repository, prefill])

  const saveNow = useCallback(async () => {
    if (!reportRef.current) return
    setStatus('saving')
    try {
      await persistRow(reportRef.current, draftRef.current)
      lastPersisted.current = JSON.stringify(draftRef.current)
      setStatus('saved')
      setError(null)
    } catch (e) {
      setStatus('error')
      setError('Could not save your draft. Check your connection and try again. Your last saved version is kept.')
      throw e
    }
  }, [persistRow])

  return { draft, setDraft, reportId, reportNumber, status, setStatus, error, setError, lastSavedAt, start, saveNow }
}
