import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import { useAuth } from './lib/AuthContext'
import { theme } from './lib/theme'
import BottomNav from './BottomNav.jsx'

const SPECIALTIES = [
  'Pharmacist', 'Medical Doctor', 'Cardiologist', 'Surgeon', 'Pediatrician',
  'Dentist', 'Optometrist', 'Nurse', 'Dermatologist', 'Gynaecologist',
  'Psychiatrist', 'Physiotherapist', 'Radiologist', 'Nutritionist / Dietitian',
  'Other Healthcare Professional',
]

const EXPERIENCE_OPTIONS = ['Less than 1 year', '1-3 years', '3-5 years', '5-10 years', '10-20 years', '20+ years']

function VerifyProfessional() {
  const { user, loading: authLoading } = useAuth()
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
    if (!file) { setError('Please upload a credential photo (license, certificate, or ID)'); return }
    setSubmitting(true)
    setError('')

    const fileExt = file.name.split('.').pop()
    const filePath = `${user.id}-${Date.now()}.${fileExt}`

    const { error: uploadError } = await supabase.storage.from('credentials').upload(filePath, file)
    if (uploadError) {
      setError('Upload failed. Try a smaller image.')
      setSubmitting(false)
      return
    }

    const { data: urlData } = supabase.storage.from('credentials').getPublicUrl(filePath)

    const { error: insertError } = await supabase.from('verification_requests').insert({
      user_id: user.id,
      full_name: form.full_name.trim(),
      profession: form.profession,
      credential_url: urlData.publicUrl,
      phone: form.phone.trim(),
      workplace: form.workplace.trim(),
      work_address: form.work_address.trim(),
      years_experience: form.years_experience,
    })

    if (insertError) {
      setError('Something went wrong. Please try again.')
    } else {
      await supabase.from('profiles').update({ specialty: form.profession }).eq('id', user.id)
      setExistingRequest({ full_name: form.full_name, profession: form.profession, status: 'pending' })
    }
    setSubmitting(false)
  }

  if (authLoading || loading) return <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif' }}>Loading...</div>

  if (!user) {
    return (
      <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif', maxWidth: 420, margin: '0 auto', textAlign: 'center' }}>
        <p style={{ color: theme.textMid }}>Log in to request verification.</p>
        <Link to="/login" style={{ color: theme.tealDeep, fontWeight: 700 }}>Log In</Link>
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 420, margin: '0 auto', paddingBottom: 90 }}>
      <div style={{ background: theme.heroGradient, padding: '22px 20px 50px 20px', borderRadius: '0 0 28px 28px', color: '#fff' }}>
        <Link to="/profile" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>← Profile</Link>
        <h1 style={{ fontSize: 21, fontWeight: 900, margin: '14px 0 4px 0' }}>Professional Verification</h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', margin: 0 }}>
          Get your verified badge — your specialty will be publicly displayed on all your posts and profile
        </p>
      </div>

      <div style={{ padding: '0 20px', marginTop: -28 }}>
        <div style={{ background: theme.cardBg, borderRadius: 20, padding: 18, boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}>

          {existingRequest ? (
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <div style={{
                width: 56, height: 56, borderRadius: 16,
                background: existingRequest.status === 'approved' ? '#ecfdf5' : existingRequest.status === 'rejected' ? '#fef2f2' : '#fef3c7',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, margin: '0 auto 14px auto',
              }}>
                {existingRequest.status === 'approved' ? '✅' : existingRequest.status === 'rejected' ? '❌' : '⏳'}
              </div>
              <h3 style={{ fontSize: 15, fontWeight: 800, color: theme.navy, margin: '0 0 4px 0' }}>
                {existingRequest.status === 'approved' ? 'You are verified!' :
                 existingRequest.status === 'rejected' ? 'Request not approved' : 'Request under review'}
              </h3>
              <p style={{ fontSize: 13, color: theme.textLight, margin: '0 0 4px 0' }}>{existingRequest.full_name}</p>
              <p style={{ fontSize: 13, fontWeight: 700, color: theme.tealDeep, margin: 0 }}>{existingRequest.profession}</p>
              {existingRequest.status === 'approved' && (
                <div style={{ marginTop: 12, background: '#ecfdf5', borderRadius: 12, padding: '8px 14px', display: 'inline-block' }}>
                  <p style={{ margin: 0, fontSize: 12, color: theme.success, fontWeight: 700 }}>
                    ✓ {existingRequest.profession} badge is live on your profile and posts
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
                      <span style={{ color: theme.tealDeep, marginLeft: 6, fontSize: 11 }}>— publicly shown on your posts</span>
                    </label>
                    <select
                      value={form.profession}
                      onChange={(e) => handleChange('profession', e.target.value)}
                      style={{ width: '100%', padding: 12, fontSize: 14, border: `1px solid ${theme.border}`, borderRadius: 12, background: '#fff' }}
                    >
                      {SPECIALTIES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <p style={{ margin: '6px 0 0 0', fontSize: 11, color: theme.textLight }}>
                      This will appear as "✓ {form.profession}" on all your posts and profile
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
                      marginTop: 6, padding: 13, background: theme.tealGradient, color: '#fff', border: 'none',
                      borderRadius: 13, fontWeight: 800, fontSize: 14, boxShadow: '0 3px 8px rgba(15,118,110,0.25)',
                    }}
                  >
                    Continue →
                  </button>
                </div>
              )}

              {step === 2 && (
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ background: '#ecfdf5', borderRadius: 12, padding: 12, marginBottom: 4 }}>
                    <p style={{ margin: '0 0 2px 0', fontSize: 13, fontWeight: 800, color: theme.navy }}>{form.full_name}</p>
                    <p style={{ margin: '0 0 2px 0', fontSize: 12, color: theme.tealDeep, fontWeight: 700 }}>✓ {form.profession}</p>
                    <p style={{ margin: 0, fontSize: 12, color: theme.textLight }}>{form.workplace} · {form.years_experience}</p>
                  </div>

                  <div>
                    <label style={{ fontSize: 11.5, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 4 }}>
                      Upload Credential
                    </label>
                    <p style={{ fontSize: 12, color: theme.textLight, margin: '0 0 8px 0' }}>
                      Upload a clear photo of your professional license, MDCN certificate, PCN license, nursing certificate, or valid work ID
                    </p>
                    <label style={{
                      display: 'block', border: `2px dashed ${theme.border}`, borderRadius: 14, padding: '20px 16px',
                      textAlign: 'center', cursor: 'pointer', background: theme.bg,
                    }}>
                      <p style={{ margin: '0 0 4px 0', fontSize: 22 }}>📎</p>
                      <p style={{ margin: '0 0 4px 0', fontSize: 13, fontWeight: 700, color: theme.navy }}>
                        {fileName || 'Tap to choose a file'}
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>JPG, PNG — max 5MB</p>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const f = e.target.files[0]
                          if (f) { setFile(f); setFileName(f.name) }
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
                      style={{ flex: 2, padding: 12, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 13, fontWeight: 800, fontSize: 14 }}
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
      <BottomNav />
    </div>
  )
}

export default VerifyProfessional
