import { useState } from 'react'
import { useNavigate, Link, useLocation } from 'react-router-dom'
import { Hourglass, CheckCircle, Circle, Search, Check, X, ArrowLeft, ArrowRight, ChevronLeft, Sparkles, Pill, Stethoscope, Smile, Eye, Leaf, Factory, Truck, Building2 } from 'lucide-react'
import { registerBusiness } from '../../services/supabase'
import { emailAdminNewRegistration } from '../../lib/email'
import { Card, Inp, Sel, TealBtn, DarkBtn, GhostBtn, Toggle, useToast, Toast, Logo } from '../../components/ui/index'
import { DARK, businessName } from '../../lib/utils'
import { BUSINESS_TYPES, NIG_STATES } from '../../config/constants'
import { theme } from '../../styles/theme'

const { tealDeep, fontDisplay, bg, navy, gray600, gray400, border } = theme

// Lucide icons per business type — replaces the emoji glyphs on the auth
// screens (config/constants.js's BUSINESS_TYPES still carries emojis for the
// rest of the app until that wider migration lands). Building2 is the fallback
// for an unset type (e.g. a deep link straight into the wizard).
const BIZ_ICONS = {
  skincare: Sparkles, pharmacy: Pill, hospital: Stethoscope, dental: Smile,
  optical: Eye, wellness: Leaf, manufacturer_importer: Factory, wholesale: Truck,
}
const bizIcon = (id) => BIZ_ICONS[id] || Building2

// Cream-filled field variants for the wizard, so inputs read against the white
// card the same way the Login screen's do. Defined at module scope (not inside
// the component) so their identity is stable across renders — otherwise every
// keystroke would remount the field and drop focus.
const CInp = (props) => <Inp fill={bg} {...props} />
const CSel = (props) => <Sel fill={bg} {...props} />

export default function Register() {
  const [step, setStep] = useState(0)
  const [data, setData] = useState({})
  const [done, setDone] = useState(false)
  const [saving, setSaving] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  // Referral agent attribution — `?ref=CODE` on the register URL. The client
  // never sends an agent id; the DB `apply_referring_agent()` trigger resolves
  // the code to a live agent at insert (planning/20260802_referral_agent_program_plan.md §2).
  const refCode = new URLSearchParams(location.search).get('ref') || ''
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const STEPS = ['Business Info', 'Contact & Location', 'Owner Info', 'Account', 'Review']
  const f = (k, v) => setData(p => ({ ...p, [k]: v }))

  const canNext = () => {
    if (step === 1) return data.businessName && data.state && data.address && data.phone && data.businessEmail
    if (step === 2) return data.whatsapp && data.businessHours
    if (step === 3) return data.firstName && data.lastName && data.ownerEmail && data.ownerPhone
    if (step === 4) return data.password && data.password === data.confirmPassword && data.password.length >= 6 && data.agreedTerms
    return true
  }

  const submit = async () => {
    setSaving(true)
    const ownerEmail = data.ownerEmail.toLowerCase()
    try {
      await registerBusiness({
        name: data.businessName,
        owner: (data.firstName + ' ' + data.lastName).trim(),
        email: ownerEmail,
        password: data.password,
        phone: data.ownerPhone || '',
        whatsapp: data.whatsapp || '',
        address: data.address || '',
        state: data.state || '',
        city: data.city || '',
        business_type: data.businessType || 'skincare',
        hours: data.businessHours || '',
        maps_link: data.mapsLink || '',
        lat: parseFloat(data.lat) || 0,
        lng: parseFloat(data.lng) || 0,
        website: data.website || '',
        visible_on_carefind: data.visibleOnCareFind !== false,
        referral_code_used: refCode || null,
      })
      // The register_business RPC mints the owner's CONFIRMED Supabase Auth
      // account in the same transaction that creates the pending business row —
      // there is no separate provisioning step any more (businesses.password
      // was dropped in C2). New owners can sign in immediately and see the
      // honest pending state.
      // Send email notification to admin
      try {
        await emailAdminNewRegistration({
          businessName: data.businessName,
          ownerName: (data.firstName + ' ' + data.lastName).trim(),
          businessType: data.businessType || 'skincare',
          state: data.state || '',
          email: ownerEmail,
        })
      } catch (e) {}
      setDone(true)
    } catch (e) {
      // The message names the real cause instead of blaming the email, which
      // was never checked. The register_business RPC rejects with readable
      // errors (invalid email, short password, or "An account with this email
      // already exists. Please sign in instead."), which surface as-is here.
      showToast('Registration failed: ' + (e.message || 'Please try again.'), { type: 'error' })
    }
    setSaving(false)
  }

  if (done) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg, padding: '20px' }}>
      <Card style={{ maxWidth: '440px', width: '100%', padding: '40px', textAlign: 'center', borderRadius: theme.radius.xl, border: 'none', boxShadow: theme.elevation[3] }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}><Hourglass size={48} color={tealDeep} /></div>
        <div style={{ fontFamily: fontDisplay, fontSize: '26px', fontWeight: '700', color: navy, marginBottom: '8px' }}>Registration submitted</div>
        <div style={{ fontSize: '14px', color: gray600, lineHeight: '1.8', marginBottom: '24px' }}>
          Thank you <strong>{data.firstName}</strong>! Your business <strong>{data.businessName}</strong> has been submitted for review. You will be notified within 24 hours.
        </div>
        <div style={{ background: theme.tealMist, borderRadius: theme.radius.lg, padding: '16px', marginBottom: '24px', textAlign: 'left' }}>
          {[['done', 'Registration submitted'], ['pending', 'Admin review in progress'], ['wait', 'Approval notification sent to your email'], ['wait2', 'Dashboard unlocked, start using CareHub']].map(([k, l]) => {
            const Icon = k === 'done' ? CheckCircle : k === 'pending' ? Hourglass : Circle
            return (
              <div key={k} style={{ display: 'flex', gap: '10px', marginBottom: '8px', fontSize: '13px', alignItems: 'center', color: k === 'done' ? theme.success : k === 'pending' ? theme.warning : gray400 }}>
                <Icon size={14} style={{ flexShrink: 0 }} /><span>{l}</span>
              </div>
            )
          })}
        </div>
        <TealBtn onClick={() => navigate('/login')} style={{ width: '100%', padding: '15px', borderRadius: theme.radius.full, background: tealDeep, fontSize: '15px', fontWeight: '800' }}>Go to sign in</TealBtn>
      </Card>
    </div>
  )

  // Step 0 — type selection
  if (step === 0) return (
    <div style={{ minHeight: '100vh', background: bg, padding: '32px 20px' }}>
      <div style={{ maxWidth: '680px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <Link to='/login' style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: gray400, fontSize: '13px', fontWeight: '600', textDecoration: 'none', marginBottom: '20px' }}><ChevronLeft size={15} /> Back to sign in</Link>
          <div style={{ margin: '0 auto 16px', display: 'flex', justifyContent: 'center' }}><Logo size={64} /></div>
          <div style={{ fontFamily: fontDisplay, fontSize: '30px', fontWeight: '700', color: navy }}>CareHub</div>
          <div style={{ fontSize: '15px', fontWeight: '700', color: navy, marginTop: '10px' }}>What type of business are you?</div>
          <div style={{ fontSize: '13.5px', color: gray600, marginTop: '4px' }}>Your consultation forms and features will be tailored to your selection</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: '12px' }}>
          {BUSINESS_TYPES.map(b => {
            const Icon = bizIcon(b.id)
            return (
              <button key={b.id} onClick={() => { f('businessType', b.id); setStep(1) }}
                style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '16px 18px', borderRadius: theme.radius.lg, border: `1px solid ${border}`, background: 'white', cursor: 'pointer', textAlign: 'left', boxShadow: theme.elevation[1] }}>
                <div style={{ width: 44, height: 44, borderRadius: theme.radius.md, background: theme.tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon size={22} strokeWidth={2} /></div>
                <div style={{ fontWeight: '800', fontSize: '14px', color: navy }}>{b.name}</div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: bg, padding: '24px 20px' }}>
      <div style={{ maxWidth: '540px', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <button onClick={() => setStep(s => s - 1)} aria-label='Back' style={{ width: '38px', height: '38px', borderRadius: theme.radius.md, background: 'white', border: `1px solid ${border}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: navy, flexShrink: 0 }}><ArrowLeft size={16} /></button>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontWeight: '800', fontSize: '18px', color: navy }}>
              {(() => { const Icon = bizIcon(data.businessType); return <Icon size={17} color={tealDeep} strokeWidth={2} style={{ flexShrink: 0 }} /> })()}
              Register {businessName(data.businessType)}
            </div>
            <div style={{ fontSize: '12px', color: gray400, marginTop: '1px' }}>Step {step} of {STEPS.length} · {STEPS[step - 1]}</div>
          </div>
        </div>
        <div style={{ height: '6px', background: border, borderRadius: theme.radius.full, overflow: 'hidden', marginBottom: '20px' }}>
          <div style={{ height: '100%', width: ((step / STEPS.length) * 100) + '%', background: tealDeep, borderRadius: theme.radius.full, transition: 'width 0.4s' }} />
        </div>

        <Card style={{ padding: '28px', marginBottom: '16px', borderRadius: theme.radius.xl, border: 'none', boxShadow: theme.elevation[3] }}>
          {refCode && (
            <div style={{ marginBottom: '16px', padding: '12px 14px', borderRadius: theme.radius.md, background: theme.tealMist, border: `1px solid ${tealDeep}`, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Sparkles size={16} color={tealDeep} style={{ flexShrink: 0 }} />
              <div style={{ fontSize: '13px', color: tealDeep, fontWeight: '700' }}>
                Invited by a CareHub Referral Agent (code {refCode.toUpperCase()})
              </div>
            </div>
          )}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '17px', fontWeight: '800', color: theme.slate }}>Business Information</div>
              <CInp label='Business Name' value={data.businessName} onChange={v => f('businessName', v)} placeholder='e.g. HealthPlus Pharmacy Ikeja' required />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <CSel label='State' value={data.state} onChange={v => f('state', v)} options={NIG_STATES} />
                <CInp label='City / Area' value={data.city} onChange={v => f('city', v)} placeholder='e.g. Ikeja' />
              </div>
              <CInp label='Full Business Address' value={data.address} onChange={v => f('address', v)} placeholder='Street, area, city' required />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <CInp label='Business Phone' value={data.phone} onChange={v => f('phone', v)} placeholder='08012345678' required />
                <CInp label='Business Email' value={data.businessEmail} onChange={v => f('businessEmail', v)} type='email' placeholder='info@yourbiz.ng' required />
              </div>
              <CInp label='Website or Instagram (optional)' value={data.website} onChange={v => f('website', v)} placeholder='@yourbusiness' />
            </div>
          )}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '17px', fontWeight: '800', color: theme.slate }}>Contact & Location for CareFind</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: theme.space[6], borderRadius: theme.radius.md, background: theme.tealMist, border: `1px solid ${theme.border}`, fontSize: '12px', color: theme.tealDeep, lineHeight: '1.6' }}>
                <Search size={13} /> This info will show on CareFind so patients can find and contact your business
              </div>
              <CInp label='WhatsApp Number' value={data.whatsapp} onChange={v => f('whatsapp', v)} placeholder='e.g. 08012345678' required />
              <CInp label='Business Hours' value={data.businessHours} onChange={v => f('businessHours', v)} placeholder='e.g. Mon-Sat 8am-8pm' required />
              <CInp label='Google Maps Link (optional)' value={data.mapsLink} onChange={v => f('mapsLink', v)} placeholder='Paste Google Maps URL' />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <CInp label='GPS Latitude (optional)' value={data.lat} onChange={v => f('lat', v)} placeholder='e.g. 6.4474' />
                <CInp label='GPS Longitude (optional)' value={data.lng} onChange={v => f('lng', v)} placeholder='e.g. 3.4359' />
              </div>
              <Toggle label='List my business on CareFind' desc='Patients can find your business and products through CareFind' value={data.visibleOnCareFind !== false} onChange={v => f('visibleOnCareFind', v)} />
            </div>
          )}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '17px', fontWeight: '800', color: theme.slate }}>Owner / Administrator</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <CInp label='First Name' value={data.firstName} onChange={v => f('firstName', v)} placeholder='e.g. Chidinma' required />
                <CInp label='Last Name' value={data.lastName} onChange={v => f('lastName', v)} placeholder='e.g. Eze' required />
              </div>
              <CInp label='Your Email (used to log in)' value={data.ownerEmail} onChange={v => f('ownerEmail', v)} type='email' placeholder='chidinma@gmail.com' required />
              <CInp label='Your Phone' value={data.ownerPhone} onChange={v => f('ownerPhone', v)} placeholder='08099887766' required />
              <CSel label='Years in Business' value={data.yearsInBusiness} onChange={v => f('yearsInBusiness', v)} options={['Less than 1 year', '1-2 years', '3-5 years', 'More than 5 years']} />
              <CSel label='Number of Staff' value={data.staffCount} onChange={v => f('staffCount', v)} options={['Just me (solo)', '2-5 staff', '6-10 staff', 'More than 10']} />
            </div>
          )}
          {step === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ fontSize: '17px', fontWeight: '800', color: theme.slate }}>Create Your Password</div>
              <div style={{ padding: theme.space[6], borderRadius: theme.radius.md, background: theme.cardBg, border: `1px solid ${theme.border}` }}>
                <div style={{ fontSize: '11px', color: theme.textFaint }}>Login email:</div>
                <div style={{ fontSize: '14px', fontWeight: '700', color: theme.slate, marginTop: '2px' }}>{data.ownerEmail || '—'}</div>
              </div>
              <CInp label='Password' value={data.password} onChange={v => f('password', v)} type='password' placeholder='Create a strong password' required />
              <CInp label='Confirm Password' value={data.confirmPassword} onChange={v => f('confirmPassword', v)} type='password' placeholder='Repeat your password' required />
              {data.password && data.confirmPassword && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: '700', color: data.password === data.confirmPassword ? theme.success : theme.danger }}>
                  {data.password === data.confirmPassword ? <><Check size={13} /> Passwords match</> : <><X size={13} /> Passwords do not match</>}
                </div>
              )}
              <div style={{ padding: '14px', borderRadius: '12px', background: theme.cardBg, border: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div><div style={{ fontWeight: '800', color: theme.slate }}>CareHub Full Access</div><div style={{ fontSize: '12px', color: theme.textFaint, marginTop: '2px' }}>All features + CareFind listing</div></div>
                <div style={{ textAlign: 'right' }}><div style={{ fontSize: '20px', fontWeight: '900', color: theme.tealDeep }}>Free</div><div style={{ fontSize: '11px', color: theme.textLight }}>for now</div></div>
              </div>
              <label style={{ display: 'flex', gap: '10px', cursor: 'pointer', alignItems: 'flex-start' }}>
                <input type='checkbox' checked={data.agreedTerms || false} onChange={e => f('agreedTerms', e.target.checked)} style={{ marginTop: '2px', flexShrink: 0 }} />
                <span style={{ fontSize: '12px', color: theme.textMid, lineHeight: '1.6' }}>I agree to the Terms of Service and Privacy Policy. I understand my account requires admin approval.</span>
              </label>
            </div>
          )}
          {step === 5 && (
            <div>
              <div style={{ fontSize: '17px', fontWeight: '800', color: theme.slate, marginBottom: '16px' }}>Review & Submit</div>
              <div style={{ borderRadius: theme.radius.md, overflow: 'hidden', border: `1px solid ${theme.hairline}` }}>
                {[
                  ['Business Type', businessName(data.businessType)],
                  ['Business Name', data.businessName],
                  ['State', data.state],
                  ['WhatsApp', data.whatsapp],
                  ['Business Hours', data.businessHours],
                  ['Owner', (data.firstName || '') + ' ' + (data.lastName || '')],
                  ['Login Email', data.ownerEmail],
                  ['CareFind', data.visibleOnCareFind !== false ? 'Yes - Listed publicly' : 'No'],
                ].filter(([, v]) => v).map(([l, v], i) => (
                  <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: i % 2 === 0 ? theme.gray50 : '#fff', fontSize: '13px' }}>
                    <span style={{ color: theme.textFaint, fontWeight: '600' }}>{l}</span><span style={{ color: theme.slate }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: '16px', padding: '14px', borderRadius: '12px', background: theme.warningBg, border: `1px solid ${theme.amberBorder}`, fontSize: '13px', color: theme.amberText, lineHeight: '1.7' }}>
                After submitting, admin will review and approve your account within 24 hours.
              </div>
            </div>
          )}
        </Card>

        <div style={{ display: 'flex', gap: '10px' }}>
          {step > 1 && <GhostBtn onClick={() => setStep(s => s - 1)} style={{ flex: 1, padding: '15px', borderRadius: theme.radius.full, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}><ArrowLeft size={14} /> Back</GhostBtn>}
          {step < 5
            ? <button onClick={() => setStep(s => s + 1)} disabled={!canNext()}
                style={{ flex: 1, padding: '15px', borderRadius: theme.radius.full, border: 'none', background: canNext() ? tealDeep : theme.gray200, color: canNext() ? 'white' : gray400, fontWeight: '800', fontSize: '15px', cursor: canNext() ? 'pointer' : 'not-allowed', boxShadow: canNext() ? theme.elevation[2] : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                Continue <ArrowRight size={14} />
              </button>
            : <button onClick={submit} disabled={saving}
                style={{ flex: 1, padding: '15px', borderRadius: theme.radius.full, border: 'none', background: saving ? theme.gray200 : DARK, color: saving ? gray400 : 'white', fontWeight: '800', fontSize: '15px', cursor: saving ? 'not-allowed' : 'pointer', boxShadow: saving ? 'none' : theme.elevation[2], display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                {saving ? 'Submitting...' : <>Submit registration <ArrowRight size={14} /></>}
              </button>
          }
        </div>
      </div>
      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}
