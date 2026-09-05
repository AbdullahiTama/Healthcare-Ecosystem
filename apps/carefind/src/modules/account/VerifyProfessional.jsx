import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { useAuth } from '../../providers/AuthContext'
import { AlertCircle, BadgeCheck, CheckCircle2, Clock, Paperclip } from 'lucide-react'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useHeaderIdentity } from '../../hooks/useHeaderIdentity'
import AppShell from '../../components/layout/AppShell.jsx'
import BottomNav from '../../components/BottomNav.jsx'
import { Loading } from '../../components/ui'
import {
  validateCredentialFile, credentialStoragePath, describeUploadError,
  CREDENTIAL_ACCEPT_ATTR, MAX_CREDENTIAL_LABEL,
} from './credentialUpload.js'

const SPECIALTIES = [
  'Pharmacist', 'Medical Doctor', 'Cardiologist', 'Surgeon', 'Pediatrician',
  'Dentist', 'Optometrist', 'Nurse', 'Dermatologist', 'Gynaecologist',
  'Psychiatrist', 'Physiotherapist', 'Radiologist', 'Nutritionist / Dietitian',
  'Other Healthcare Professional',
]

const EXPERIENCE_OPTIONS = ['Less than 1 year', '1-3 years', '3-5 years', '5-10 years', '10-20 years', '20+ years']

function VerifyProfessional() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const { isMobile } = useBreakpoint()
  const { myUsername, myAvatar, unreadNotifs } = useHeaderIdentity(user)
  const [step, setStep] = useState(1) // 1 = personal details, 2 = credential upload
  const [existingRequest, setExistingRequest] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [file, setFile] = useState(null)
  const [fileName, setFileName] = useState('')

  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    profession: 'Pharmacist',
    workplace: '',
    work_address: '',
    years_experience: '1-3 years',
  })

  useEffect(() => {
    async function load() {
      if (!user) { setLoading(false); return }
      const { data } = await supabase
        .from('verification_requests')
        .select('id, full_name, profession, status, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      setExistingRequest(data)

      // Pre-fill name from profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, display_name')
        .eq('id', user.id)
        .single()
      if (profile?.full_name) setForm((f) => ({ ...f, full_name: profile.full_name }))

      setLoading(false)
    }
    if (!authLoading) load()
  }, [user, authLoading])

  function handleChange(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function validateStep1() {
    if (!form.full_name.trim()) return 'Please enter your full name'
    if (!form.phone.trim()) return 'Please enter your phone number'
    if (!form.workplace.trim()) return 'Please enter your current workplace'
    if (!form.work_address.trim()) return 'Please enter your work address'
    return null
  }

  async function handleSubmit(e) {
    e.preventDefault()

    // Validate before touching the network so the message names the real
    // problem (type vs size vs missing) instead of the old catch-all
    // "Upload failed. Try a smaller image." — which was what every failure
    // said, including the RLS rejection that was actually blocking all of
    // them. See modules/account/credentialUpload.js.
    const check = validateCredentialFile(file)
    if (!check.ok) { setError(check.error); return }

    setSubmitting(true)
    setError('')

    // `<userId>/…` is required, not stylistic: the credentials bucket's RLS
    // policies derive ownership from the first path segment.
    const filePath = credentialStoragePath(user.id, file)

    const { error: uploadError } = await supabase.storage
      .from('credentials')
      .upload(filePath, file, { contentType: check.contentType, upsert: false })
    if (uploadError) {
      // Log the real response so a future failure is diagnosable from the
      // console rather than only from the sanitised UI copy.
      console.error('Credential upload failed', {
        status: uploadError.statusCode ?? uploadError.status,
        message: uploadError.message,
        path: filePath,
        contentType: check.contentType,
        bytes: file.size,
      })
      setError(describeUploadError(uploadError))
      setSubmitting(false)
      return
    }

    // The bucket is private (licence documents are identity documents), so
    // there is no public URL. The stored value is the object path; admin
    // review resolves it to a short-lived signed URL server-side.
    const { error: insertError } = await supabase.from('verification_requests').insert({
      user_id: user.id,
      full_name: form.full_name.trim(),
      profession: form.profession,
      credential_url: filePath,
      phone: form.phone.trim(),
      workplace: form.workplace.trim(),
      work_address: form.work_address.trim(),
      years_experience: form.years_experience,
    })

    if (insertError) {
      console.error('Verification request insert failed', insertError)
      setError('Your document uploaded, but the request could not be saved: ' + (insertError.message || 'please try again.'))
    } else {
      await supabase.from('profiles').update({ specialty: form.profession }).eq('id', user.id)
      setExistingRequest({ full_name: form.full_name, profession: form.profession, status: 'pending' })
    }
    setSubmitting(false)
  }

  if (authLoading || loading) return <Loading />

  if (!user) {
    return (
      <div style={{ padding: 20, fontFamily: theme.fontFamily, maxWidth: 420, margin: '0 auto', textAlign: 'center' }}>
        <p style={{ color: theme.textMid }}>Log in to request verification.</p>
        <Link to="/login" style={{ color: theme.tealDeep, fontWeight: 700 }}>Log In</Link>
      </div>
    )
  }

  const bodyContent = (
    <div style={isMobile
      ? { fontFamily: theme.fontFamily, maxWidth: 420, margin: '0 auto', paddingBottom: 'calc(90px + env(safe-area-inset-bottom))' }
      : { fontFamily: theme.fontFamily, maxWidth: 560, margin: '0 auto' }}>
      <div style={{
        background: theme.navy, color: '#fff',
        ...(isMobile ? { padding: '22px 20px 50px 20px', borderRadius: '0 0 28px 28px' } : { padding: '22px 26px', borderRadius: theme.radius.xl, marginBottom: 20 }),
      }}>
        {isMobile && <Link to="/profile" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>← Profile</Link>}
        <h1 style={{ fontSize: 21, fontWeight: 900, margin: isMobile ? '14px 0 4px 0' : '0 0 4px 0' }}>Professional Verification</h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', margin: 0 }}>
          Get your verified badge. Your specialty will be publicly displayed on all your posts and profile
        </p>
      </div>

      <div style={isMobile ? { padding: '0 20px', marginTop: -28 } : {}}>
        <div style={{ background: theme.cardBg, borderRadius: 20, padding: isMobile ? 18 : 24, boxShadow: isMobile ? '0 4px 16px rgba(0,0,0,0.08)' : theme.elevation[2], border: isMobile ? 'none' : `1px solid ${theme.border}` }}>

          {existingRequest ? (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <div style={{
                width: 56, height: 56, borderRadius: 16,
                background: existingRequest.status === 'approved' ? theme.tealMist : existingRequest.status === 'rejected' ? theme.dangerBg : theme.amberBg,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, margin: '0 auto 14px auto',
              }}>
                {existingRequest.status === 'approved'
                  ? <CheckCircle2 size={30} color={theme.success} aria-hidden="true" />
                  : existingRequest.status === 'rejected'
                    ? <AlertCircle size={30} color={theme.danger} aria-hidden="true" />
                    : <Clock size={30} color={theme.warning} aria-hidden="true" />}
              </div>
              <h3 style={{ fontSize: 15, fontWeight: 800, color: theme.navy, margin: '0 0 4px 0' }}>
                {existingRequest.status === 'approved' ? 'You are verified!' :
                 existingRequest.status === 'rejected' ? 'Request not approved' : 'Request under review'}
              </h3>
              <p style={{ fontSize: 13, color: theme.textLight, margin: '0 0 4px 0' }}>{existingRequest.full_name}</p>
              <p style={{ fontSize: 13, fontWeight: 700, color: theme.tealDeep, margin: 0 }}>{existingRequest.profession}</p>
              {existingRequest.status === 'approved' && (
                <div style={{ marginTop: 12, background: theme.tealMist, borderRadius: 12, padding: '8px 14px', display: 'inline-block' }}>
                  <p style={{ margin: 0, fontSize: 12, color: theme.success, fontWeight: 700 }}>
                    <BadgeCheck size={14} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 5 }} />{existingRequest.profession} badge is live on your profile and posts
                  </p>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Step indicator */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                {[1, 2].map((s) => (
                  <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: s === 1 ? 1 : 'none' }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 800,
                      background: step >= s ? theme.tealDeep : theme.bg,
                      color: step >= s ? '#fff' : theme.textLight,
                      border: `2px solid ${step >= s ? theme.tealDeep : theme.border}`,
                    }}>
                      {s}
                    </div>
                    {s === 1 && <div style={{ flex: 1, height: 2, background: step > 1 ? theme.tealDeep : theme.border, borderRadius: 1 }} />}
                  </div>
                ))}
                <div style={{ fontSize: 12, color: theme.textLight, fontWeight: 600 }}>
                  {step === 1 ? 'Your Details' : 'Upload Credential'}
                </div>
              </div>

              {step === 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[
                    { label: 'Full Name', key: 'full_name', placeholder: 'Dr. Amaka Okonkwo', type: 'text' },
                    { label: 'Phone Number', key: 'phone', placeholder: '+234 801 234 5678', type: 'tel' },
                    { label: 'Current Workplace', key: 'workplace', placeholder: 'Lagos University Teaching Hospital', type: 'text' },
                    { label: 'Work Address', key: 'work_address', placeholder: '12 Broad Street, Lagos Island, Lagos', type: 'text' },
                  ].map((field) => (
                    <div key={field.key}>
                      <label style={{ fontSize: 11.5, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 4 }}>{field.label}</label>
                      <input
                        type={field.type}
                        value={form[field.key]}
                        onChange={(e) => handleChange(field.key, e.target.value)}
                        placeholder={field.placeholder}
                        style={{ width: '100%', padding: 12, fontSize: 14, border: `1px solid ${theme.border}`, borderRadius: 12 }}
                      />
                    </div>
                  ))}

                  <div>
                    <label style={{ fontSize: 11.5, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 4 }}>
                      Specialty / Designation
                      <span style={{ color: theme.tealDeep, marginLeft: 6, fontSize: 11 }}>· shown publicly on your posts</span>
                    </label>
                    <select
                      value={form.profession}
                      onChange={(e) => handleChange('profession', e.target.value)}
                      style={{ width: '100%', padding: 12, fontSize: 14, border: `1px solid ${theme.border}`, borderRadius: 12, background: '#fff' }}
                    >
                      {SPECIALTIES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <p style={{ margin: '6px 0 0 0', fontSize: 11, color: theme.textLight }}>
                      This will appear as a verified {form.profession} badge on all your posts and profile
                    </p>
                  </div>

                  <div>
                    <label style={{ fontSize: 11.5, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 4 }}>Years of Experience</label>
                    <select
                      value={form.years_experience}
                      onChange={(e) => handleChange('years_experience', e.target.value)}
                      style={{ width: '100%', padding: 12, fontSize: 14, border: `1px solid ${theme.border}`, borderRadius: 12, background: '#fff' }}
                    >
                      {EXPERIENCE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const err = validateStep1()
                      if (err) { setError(err); return }
                      setError('')
                      setStep(2)
                    }}
                    style={{
                      marginTop: 6, padding: 13, background: theme.tealDeep, color: '#fff', border: 'none',
                      borderRadius: 13, fontWeight: 800, fontSize: 14, boxShadow: '0 3px 8px rgba(15,118,110,0.25)',
                    }}
                  >
                    Continue →
                  </button>
                </div>
              )}

              {step === 2 && (
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ background: theme.tealMist, borderRadius: 12, padding: 12, marginBottom: 4 }}>
                    <p style={{ margin: '0 0 2px 0', fontSize: 13, fontWeight: 800, color: theme.navy }}>{form.full_name}</p>
                    <p style={{ margin: '0 0 2px 0', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: theme.tealDeep, fontWeight: 700 }}><BadgeCheck size={13} aria-hidden="true" /> {form.profession}</p>
                    <p style={{ margin: 0, fontSize: 12, color: theme.textLight }}>{form.workplace} · {form.years_experience}</p>
                  </div>

                  <div>
                    <label style={{ fontSize: 11.5, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 4 }}>
                      Upload Credential
                    </label>
                    <p style={{ fontSize: 12, color: theme.textLight, margin: '0 0 8px 0' }}>
                      Upload a clear photo or PDF of your professional license, MDCN certificate, PCN license, nursing certificate, or valid work ID
                    </p>
                    <label style={{
                      display: 'block', border: `2px dashed ${theme.border}`, borderRadius: 14, padding: '20px 16px',
                      textAlign: 'center', cursor: 'pointer', background: theme.bg,
                    }}>
                      <p style={{ margin: '0 0 6px 0', display: 'flex', justifyContent: 'center', color: theme.gray400 }}><Paperclip size={22} aria-hidden="true" /></p>
                      <p style={{ margin: '0 0 4px 0', fontSize: 13, fontWeight: 700, color: theme.navy }}>
                        {fileName || 'Tap to choose a file'}
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>
                        JPG, PNG, WEBP, HEIC or PDF · max {MAX_CREDENTIAL_LABEL}
                      </p>
                      <input
                        type="file"
                        accept={CREDENTIAL_ACCEPT_ATTR}
                        onChange={(e) => {
                          const f = e.target.files[0]
                          if (!f) return
                          // Report a bad file at the moment it is chosen, not
                          // after the user has filled in the rest and pressed
                          // submit.
                          const picked = validateCredentialFile(f)
                          setFile(picked.ok ? f : null)
                          setFileName(f.name)
                          setError(picked.ok ? '' : picked.error)
                        }}
                        style={{ display: 'none' }}
                      />
                    </label>
                  </div>

                  {error && <p style={{ color: theme.alert, fontSize: 13, margin: 0 }}>{error}</p>}

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      style={{ flex: 1, padding: 12, background: theme.bg, color: theme.textMid, border: `1px solid ${theme.border}`, borderRadius: 13, fontWeight: 700, fontSize: 13 }}
                    >
                      ← Back
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      style={{ flex: 2, padding: 12, background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 13, fontWeight: 800, fontSize: 14 }}
                    >
                      {submitting ? 'Submitting...' : 'Submit for Review'}
                    </button>
                  </div>
                  <p style={{ fontSize: 11, color: theme.textLight, textAlign: 'center', margin: 0 }}>
                    Your details are reviewed manually before approval.
                  </p>
                </form>
              )}

              {error && step === 1 && <p style={{ color: theme.alert, fontSize: 13, marginTop: 8 }}>{error}</p>}
            </>
          )}
        </div>
      </div>
      {isMobile && <BottomNav />}
    </div>
  )

  if (isMobile) return bodyContent

  return (
    <AppShell user={user} myUsername={myUsername} myAvatar={myAvatar} unreadNotifs={unreadNotifs}>
      {bodyContent}
    </AppShell>
  )
}

export default VerifyProfessional
