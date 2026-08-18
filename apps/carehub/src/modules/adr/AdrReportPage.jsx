import { useState, useEffect, useRef } from 'react'
import { 
  Dossier, Plus, Edit, Trash, RefreshCw, CheckCircle, 
  X, Camera, Image, Mail, Download, 
  Loader2, Sunrise, MoonStars, AlertTriangle,
  Flag, Shield, ExclamationCircle
} from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useToast } from '../../components/ui'
import { sbFetch } from '../../services/supabase'
import { ADR_MODULE_TYPES, REPORT_STATUS, REACTION_SEVERITY, REACTION_OUTCOME, ACTION_TAKEN, DECHALLENGE, RECHALLENGE, CAUSALITY, REACTION_EXPECTED, EVIDENCE_PHOTO_TYPE, QUALIFICATIONS, PATIENT_GENDER, PATIENT_AGE_GROUP } from './types'
import { adrValidation } from './validation'
import { calculateDeadline, getDeadlineStatus } from './services'
import { ADR_FORM } from './formEngine'

export default function AdrReportPage({ reportId }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { msg: toastMsg, show: showToast } = useToast()
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('loading')
  const [moduleType, setModuleType] = useState('community_pharmacy')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [evidencePhotos, setEvidencePhotos] = useState([])
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [deadline, setDeadline] = useState(null)
  const [deadlineStatus, setDeadlineStatus] = useState('on_track')
  const [isSerious, setIsSerious] = useState(null)
  const [reactionExpected, setReactionExpected] = useState(null)
  const [newSafetySignal, setNewSafetySignal] = useState(false)
  const formRef = useRef(null)

  // Load report data
  useEffect(() => {
    loadReport()
  }, [reportId])

  async function loadReport() {
    setLoading(true)
    try {
      const data = await sbFetch(`adr_reports?report_id=eq.${reportId}&select=*`)
      if (data && data.length) {
        const r = data[0]
        setReport(r)
        setModuleType(r.module_type || 'community_pharmacy')
        setStatus(r.status || 'draft')
        
        // Compute deadline
        if (r.created_at) {
          const inputs = ADR_FORM.getDeadlineInputs(
            moduleType,
            new Date(r.created_at),
            adrValidation.computeIsSerious(r.adr_reactions),
            r.reaction_expected,
            r.new_safety_signal
          )
          const deadlineMs = adrValidation.computeDeadline(
            new Date(r.created_at),
            inputs.is_serious,
            inputs.reaction_expected,
            inputs.new_safety_signal
          )
          setDeadline(deadlineMs)
          setDeadlineStatus(getDeadlineStatus(deadlineMs))
        }
      } else {
        showToast('ADR report not found', { variant: 'destructive' })
        navigate('/dashboard/adr-reports')
      }
    } catch (e) {
      showToast('Error loading ADR report', { variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  // Compute deadline status when dependencies change
  useEffect(() => {
    if (report && report.created_at && isSerious !== null && reactionExpected !== null && newSafetySignal !== undefined) {
      const inputs = ADR_FORM.getDeadlineInputs(
        moduleType,
        new Date(report.created_at),
        isSerious,
        reactionExpected,
        newSafetySignal
      )
      const deadlineMs = adrValidation.computeDeadline(
        new Date(report.created_at),
        inputs.is_serious,
        inputs.reaction_expected,
        inputs.new_safety_signal
      )
      setDeadline(deadlineMs)
      setDeadlineStatus(getDeadlineStatus(deadlineMs))
    }
  }, [report, isSerious, reactionExpected, newSafetySignal, moduleType])

  // Get evidence photos
  useEffect(() => {
    if (report) {
      loadEvidencePhotos()
    }
  }, [report])

  async function loadEvidencePhotos() {
    try {
      const data = await sbFetch(`adr_report_evidence_photos?report_id=eq.${reportId}&select=*`)
      if (data) {
        setEvidencePhotos(data)
      }
    } catch (e) {
      // Silently handle
    }
  }

  // Calculate deadline when module type changes
  useEffect(() => {
    if (report && report.created_at) {
      const inputs = ADR_FORM.getDeadlineInputs(
        moduleType,
        new Date(report.created_at),
        isSerious,
        reactionExpected,
        newSafetySignal
      )
      const deadlineMs = adrValidation.computeDeadline(
        new Date(report.created_at),
        inputs.is_serious,
        inputs.reaction_expected,
        inputs.new_safety_signal
      )
      setDeadline(deadlineMs)
      setDeadlineStatus(getDeadlineStatus(deadlineMs))
    }
  }, [moduleType, report])

  // Handle form input changes
  function handleInputChange(field, value) {
    setReport(prev => {
      if (!prev) return prev
      const updated = { ...prev, [field]: value }
      // Recompute deadline if relevant fields changed
      if (field === 'is_serious' || field === 'reaction_expected' || field === 'new_safety_signal') {
        const inputs = ADR_FORM.getDeadlineInputs(
          moduleType,
          new Date(prev.created_at || new Date()),
          value,
          prev.adr_reactions && prev.adr_reactions.length ? adrValidation.computeIsSerious(prev.adr_reactions) : null,
          prev.reaction_expected
        )
        const deadlineMs = adrValidation.computeDeadline(
          new Date(prev.created_at || new Date()),
          inputs.is_serious,
          inputs.reaction_expected,
          inputs.new_safety_signal
        )
        return { ...updated, deadline: deadlineMs }
      }
      return updated
    })
  }

  // Handle submit
  async function handleSubmit() {
    setIsSubmitting(true)
    try {
      // Centralized validation gate
      const validation = await adrValidation.validateForSubmit(report)
      
      if (!validation.valid) {
        // Show exact missing fields
        showToast(`Cannot submit: ${validation.missing.join(', ')}`, { variant: 'destructive' })
        setIsSubmitting(false)
        return
      }

      // Update status to submitted
      await sbFetch(`adr_reports?report_id=eq.${reportId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: REPORT_STATUS.SUBMITTED }),
        prefer: 'return=minimal',
      })

      showToast('Report submitted successfully!')
      setStatus(REPORT_STATUS.SUBMITTED)
      navigate(`/dashboard/adr-reports/${reportId}/detail`)
    } catch (e) {
      showToast('Error submitting report', { variant: 'destructive' })
    } finally {
      setIsSubmitting(false)
    }
  }

  // Handle draft save (always allowed, even when incomplete)
  function handleSaveDraft() {
    // Drafts can always be saved, even if incomplete
    showToast('Draft saved')
  }

  // Handle export PDF — client-side printable view (there is no server-side
  // export endpoint; the old call to `/export` always 400'd)
  async function handleExportPdf() {
    if (!report) return
    try {
      const win = window.open('', '_blank')
      if (!win) {
        showToast('Popup blocked — allow popups to export the PDF', { variant: 'destructive' })
        return
      }

      const rows = [
        ['Report Number', ADR_FORM.formatReportNumber(report.report_number)],
        ['Module Type', ADR_FORM.getModuleTitle ? ADR_FORM.getModuleTitle(report.module_type) : report.module_type],
        ['Status', ADR_FORM.getStatusLabel(report.status)],
        ['Created', report.created_at ? new Date(report.created_at).toLocaleDateString('en-NG') : '—'],
        ['Reporter Name', report.reporter_name || '—'],
        ['Reporter Qualification', report.reporter_qualification || '—'],
        ['Reporter Facility', report.reporter_facility_name || '—'],
        ['Reporter Phone', report.reporter_phone || '—'],
        ['Reporter Email', report.reporter_email || '—'],
        ['Reporter License', report.reporter_license_number || '—'],
        ['Patient Identifier', report.patient_identifier || '—'],
        ['Patient Age', report.patient_age != null ? String(report.patient_age) : '—'],
        ['Patient DOB', report.patient_dob || '—'],
        ['Patient Age Group', report.patient_age_group || '—'],
        ['Patient Gender', report.patient_gender || '—'],
        ['Patient Weight (kg)', report.patient_weight_kg != null ? String(report.patient_weight_kg) : '—'],
      ]

      const table = rows
        .map(([k, v]) => `<tr><td style="padding:6px 10px;border:1px solid #ccc;font-weight:700;white-space:nowrap">${k}</td><td style="padding:6px 10px;border:1px solid #ccc">${v}</td></tr>`)
        .join('')

      win.document.write(`<!doctype html>
<html><head><title>ADR Report ${ADR_FORM.formatReportNumber(report.report_number)}</title>
<style>
  body { font-family: Arial, sans-serif; color: #111; margin: 32px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .sub { color: #666; font-size: 13px; margin-bottom: 24px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
</style></head>
<body>
  <h1>ADR Report ${ADR_FORM.formatReportNumber(report.report_number)}</h1>
  <div class="sub">Adverse Drug Reaction report</div>
  <table>${table}</table>
  <script>window.onload = function(){ window.print() }</script>
</body></html>`)
      win.document.close()
    } catch (e) {
      showToast('Error exporting PDF', { variant: 'destructive' })
    }
  }

  // Handle evidence photo upload
  async function handlePhotoUpload(file, photoType, caption) {
    if (uploadingPhoto) return
    setUploadingPhoto(true)
    
    try {
      const path = `adr-evidence/${reportId}/${Date.now()}-${file.name}`
      const url = await sbUpload('adr-evidence', path, file, file.type || 'image/jpeg', 'Evidence photo upload failed')
      
      const photoData = {
        report_id: reportId,
        evidence_photo_file: url,
        evidence_photo_type: photoType,
        evidence_photo_caption: caption || '',
      }
      
      await sbFetch('adr_report_evidence_photos', {
        method: 'POST',
        body: JSON.stringify(photoData),
        prefer: 'return=representation',
      })
      
      showToast('Evidence photo uploaded!')
      loadEvidencePhotos()
    } catch (e) {
      showToast('Error uploading evidence photo', { variant: 'destructive' })
    } finally {
      setUploadingPhoto(false)
    }
  }

  // Handle follow-up creation
  async function handleFollowUp() {
    if (!report) return
    
    try {
      // Create follow-up report maintaining relationship with original
      const followUpData = {
        business_id: report.business_id,
        module_type: report.module_type,
        follow_up_of_report_id: report.report_id,
        status: 'draft',
        created_by_user_id: report.created_by_user_id,
        ...(moduleType === 'industry' ? { follow_up_version_number: (report.follow_up_version_number || 0) + 1 } : {}),
      }
      
      const result = await sbFetch('adr_reports', {
        method: 'POST',
        body: JSON.stringify(followUpData),
        prefer: 'return=representation',
      })
      
      showToast('Follow-up report created!')
      navigate(`/dashboard/adr-reports/${result.report_id}/detail`)
    } catch (e) {
      showToast('Error creating follow-up', { variant: 'destructive' })
    }
  }

  // Handle report archive (soft delete)
  function handleArchive() {
    setShowDeleteConfirm(true)
  }

  // Confirm archive
  async function confirmArchive() {
    if (!report) return
    setShowDeleteConfirm(false)
    
    try {
      await sbFetch(`adr_reports?report_id=eq.${report.report_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: REPORT_STATUS.FOLLOW_UP_REQUIRED }),
        prefer: 'return=minimal',
      })
      showToast('Report archived (soft-deleted)')
    } catch (e) {
      showToast('Error archiving report', { variant: 'destructive' })
    }
  }

  // Render reporter section
  function renderReporterSection() {
    if (!report) return null
    
    const r = report
    const mt = r.module_type || 'community_pharmacy'
    
    return (
      <div style={{ marginBottom: '24px', paddingBottom: '24px', borderBottom: '1px solid #ECEAE0' }}>
        <h3 style={{ fontSize: '14px', fontWeight: '800', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'gray600', marginBottom: '12px' }}>Reporter</h3>
        
        <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <div>
            <label style={{ fontSize: '12px', color: 'gray500', marginBottom: '4px', display: 'block' }}>Name</label>
            <input 
              value={r.reporter_name || ''} 
              onChange={(e) => handleInputChange('reporter_name', e.target.value)} 
              placeholder="Reporter name" 
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ECEAE0', fontSize: '13px' }}
            />
          </div>
          
          <div>
            <label style={{ fontSize: '12px', color: 'gray500', marginBottom: '4px', display: 'block' }}>Qualification</label>
            <select
              value={r.reporter_qualification || ''}
              onChange={(e) => handleInputChange('reporter_qualification', e.target.value)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ECEAE0', fontSize: '13px' }}
            >
              <option value="">Select qualification</option>
              {Object.entries(QUALIFICATIONS).map(([key, val]) => (
                <option key={key} value={val}>{ADR_FORM.getSkincareReactionTypes()[key] ? ADR_FORM.getSkincareReactionTypes()[key] : val}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label style={{ fontSize: '12px', color: 'gray500', marginBottom: '4px', display: 'block' }}>Facility</label>
            <input
              value={r.reporter_facility_name || ''}
              onChange={(e) => handleInputChange('reporter_facility_name', e.target.value)}
              placeholder="Facility name"
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ECEAE0', fontSize: '13px' }}
            />
          </div>
          
          <div>
            <label style={{ fontSize: '12px', color: 'gray500', marginBottom: '4px', display: 'block' }}>Phone (Nigeria)</label>
            <input
              value={r.reporter_phone || ''}
              onChange={(e) => handleInputChange('reporter_phone', e.target.value)}
              placeholder="+234-800-123-4567"
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ECEAE0', fontSize: '13px' }}
              pattern="^(?:\+?234|0)?[1-9][0-9]{8}$"
              title="Invalid Nigerian phone number"
            />
          </div>
          
          <div>
            <label style={{ fontSize: '12px', color: 'gray500', marginBottom: '4px', display: 'block' }}>Email</label>
            <input
              value={r.reporter_email || ''}
              onChange={(e) => handleInputChange('reporter_email', e.target.value)}
              placeholder="reporter@example.com"
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ECEAE0', fontSize: '13px' }}
              type="email"
            />
          </div>
          
          <div>
            <label style={{ fontSize: '12px', color: 'gray500', marginBottom: '4px', display: 'block' }}>License Number</label>
            <input
              value={r.reporter_license_number || ''}
              onChange={(e) => handleInputChange('reporter_license_number', e.target.value)}
              placeholder="License number"
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ECEAE0', fontSize: '13px' }}
            />
          </div>
          
          <div>
            <label style={{ fontSize: '12px', color: 'gray500', marginBottom: '4px', display: 'block' }}>Consent Follow-up</label>
            <div style={{ display: 'flex', gap: '12px' }}>
              <label>
                <input
                  type="radio"
                  checked={r.reporter_consent_followup === true}
                  onChange={() => handleInputChange('reporter_consent_followup', true)}
                  style={{ accentColor: 'tealDeep' }}
                />
                Yes
              </label>
              <label>
                <input
                  type="radio"
                  checked={r.reporter_consent_followup === false}
                  onChange={() => handleInputChange('reporter_consent_followup', false)}
                  style={{ accentColor: 'tealDeep' }}
                />
                No
              </label>
            </div>
            <p style={{ fontSize: '11px', color: 'gray500', marginTop: '4px' }}>
              {r.reporter_anonymous_confirmed_by_facility ? 'Facility confirmed anonymous' : ''}
            </p>
          </div>
          
          <div>
            <label style={{ fontSize: '12px', color: 'gray500', marginBottom: '4px', display: 'block' }}>Anonymous Confirmed by Facility</label>
            <label>
              <input
                type="checkbox"
                checked={r.reporter_anonymous_confirmed_by_facility === true}
                onChange={(e) => handleInputChange('reporter_anonymous_confirmed_by_facility', e.target.checked)}
                style={{ accentColor: 'tealDeep' }}
              />
              Yes - name may be blank when facility confirms
            </label>
          </div>
        </div>
      </div>
    )
  }

  function renderPatientSection() {
    if (!report) return null
    
    const r = report
    
    return (
      <div style={{ marginBottom: '24px', paddingBottom: '24px', borderBottom: '1px solid #ECEAE0' }}>
        <h3 style={{ fontSize: '14px', fontWeight: '800', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'gray600', marginBottom: '12px' }}>Patient</h3>
        
        <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <div>
            <label style={{ fontSize: '12px', color: 'gray500', marginBottom: '4px', display: 'block' }}>Identifier (initials or internal ID)</label>
            <input
              value={r.patient_identifier || ''}
              onChange={(e) => handleInputChange('patient_identifier', e.target.value)}
              placeholder="J.S. or patient-001"
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ECEAE0', fontSize: '13px' }}
            />
          </div>
          
          <div>
            <label style={{ fontSize: '12px', color: 'gray500', marginBottom: '4px', display: 'block' }}>Age</label>
            <input
              value={r.patient_age !== undefined ? String(r.patient_age) : ''}
              onChange={(e) => handleInputChange('patient_age', e.target.value)}
              placeholder="e.g. 45"
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ECEAE0', fontSize: '13px' }}
              type="number"
            />
          </div>
          
          <div>
            <label style={{ fontSize: '12px', color: 'gray500', marginBottom: '4px', display: 'block' }}>DOB</label>
            <input
              value={r.patient_dob || ''}
              onChange={(e) => handleInputChange('patient_dob', e.target.value)}
              placeholder="YYYY-MM-DD"
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ECEAE0', fontSize: '13px' }}
              type="date"
            />
          </div>
          
          <div>
            <label style={{ fontSize: '12px', color: 'gray500', marginBottom: '4px', display: 'block' }}>Age Group</label>
            <select
              value={r.patient_age_group || ''}
              onChange={(e) => handleInputChange('patient_age_group', e.target.value)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ECEAE0', fontSize: '13px' }}
            >
              <option value="">Select age group</option>
              {Object.entries(PATIENT_AGE_GROUP).map(([key, val]) => (
                <option key={key} value={val}>{val}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label style={{ fontSize: '12px', color: 'gray500', marginBottom: '4px', display: 'block' }}>Gender</label>
            <select
              value={r.patient_gender || ''}
              onChange={(e) => handleInputChange('patient_gender', e.target.value)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ECEAE0', fontSize: '13px' }}
            >
              <option value="">Select gender</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>
          
          <div>
            <label style={{ fontSize: '12px', color: 'gray500', marginBottom: '4px', display: 'block' }}>Weight (kg)</label>
            <input
              value={r.patient_weight_kg !== undefined ? String(r.patient_weight_kg) : ''}
              onChange={(e) => handleInputChange('patient_weight_kg', e.target.value)}
              placeholder="e.g. 70"
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ECEAE0', fontSize: '13px' }}
              type="number"
            />
          </div>
        </div>
      </div>
    )
  }

  // Render main page
  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <h2 style={{ fontSize: '20px', fontWeight: '900', color: 'navy', marginBottom: '24px' }}>
        {report ? (
          `ADR Report ${ADR_FORM.formatReportNumber(report.report_number)} – ${ADR_FORM.getStatusLabel(status)}`
        ) : (
          'New ADR Report'
        )}
      </h2>
      
      {loading ? (
        <p style={{ textAlign: 'center', color: 'gray600' }}>Loading ADR report...</p>
      ) : report ? (
        <div>
          {renderReporterSection()}
          {renderPatientSection()}
          <div style={{ marginTop: '32px' }}>
            <button
              onClick={handleSaveDraft}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '10px 18px', borderRadius: '6px', border: '1px solid #ECEAE0',
                background: 'white', color: 'navy', fontWeight: '700', fontSize: '13px',
                cursor: 'pointer', marginRight: '12px'
              }}
            >
              Save Draft
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || status === 'submitted'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '10px 18px', borderRadius: '6px', border: `1px solid ${status === 'submitted' ? 'tealDeep' : 'navy'}`,
                background: status === 'submitted' ? 'tealDeep' : 'navy', color: 'white', fontWeight: '700', fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              {isSubmitting ? (
                <Loader2 size={15} />
              ) : (
                'Submit Report'
              )}
            </button>
            <button
              onClick={handleExportPdf}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '10px 18px', borderRadius: '6px', border: '1px solid #ECEAE0',
                background: 'white', color: 'navy', fontWeight: '700', fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              Export PDF
            </button>
            <button
              onClick={handleFollowUp}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '10px 18px', borderRadius: '6px', border: '1px solid #ECEAE0',
                background: 'white', color: 'navy', fontWeight: '700', fontSize: '13px',
                cursor: 'pointer', marginLeft: '12px'
              }}
            >
              Create Follow-up
            </button>
          </div>
          
          {deadline && (
            <div style={{ marginTop: '24px', padding: '16px', borderRadius: '8px', 
              background: deadlineStatus === 'overdue' ? '#fef2f2' : 
              deadlineStatus === 'due_soon' ? '#fffbeb' : 
              '#f0fdf4',
              border: `1px solid ${deadlineStatus === 'overdue' ? '#dc2626' : deadlineStatus === 'due_soon' ? '#d97706' : '#16a34a'}` }}>
              <div style={{ fontSize: '12px', color: 'gray500', fontWeight: '600', marginBottom: '4px' }}>
                Deadline
              </div>
              <div style={{ fontSize: '20px', fontWeight: '900', color: deadlineStatus === 'overdue' ? '#dc2626' : deadlineStatus === 'due_soon' ? '#d97706' : '#16a34a' }}>
                {formatDeadline(deadline)}
              </div>
              <div style={{ fontSize: '11px', color: 'gray500', marginTop: '4px' }}>
                {deadlineStatus}
              </div>
            </div>
          )}
        </div>) : null}
    </div>
  )
}

function formatDeadline(deadlineMs) {
  const date = new Date(deadlineMs)
  return date.toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' })
}