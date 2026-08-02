import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { CheckCircle, ChevronLeft, ArrowRight, MapPin, Percent, Repeat } from 'lucide-react'
import { submitAgentApplication } from '../../services/supabase'
import { Card, Inp, Sel, TealBtn, GhostBtn, useToast, Toast, Logo } from '../../components/ui/index'
import { NIG_STATES } from '../../config/constants'
import { theme } from '../../styles/theme'

const { tealDeep, fontDisplay, bg, navy, gray600, gray400, border } = theme

const CInp = (props) => <Inp fill={bg} {...props} />
const CSel = (props) => <Sel fill={bg} {...props} />

export default function ApplyAgent() {
  const [form, setForm] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const navigate = useNavigate()
  const { msg, type, show: showToast } = useToast()
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const canSubmit = () => form.name && form.email && form.city && form.area

  const submit = async () => {
    if (!canSubmit()) { showToast('Please fill in the required fields.', { type: 'warning' }); return }
    setSubmitting(true)
    try {
      await submitAgentApplication({
        applicant_name: form.name,
        contact_email: form.email.toLowerCase(),
        contact_phone: form.phone || '',
        requested_city: form.city,
        requested_area: form.area,
        applicant_details: {
          motivation: form.motivation || '',
          experience: form.experience || '',
        },
      })
      setDone(true)
    } catch (e) {
      showToast('Could not submit — please try again or email support@carehub.ng.', { type: 'error' })
    }
    setSubmitting(false)
  }

  if (done) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg, padding: '20px' }}>
      <Card style={{ maxWidth: '460px', width: '100%', padding: '40px', textAlign: 'center', borderRadius: theme.radius.xl, border: 'none', boxShadow: theme.elevation[3] }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}><CheckCircle size={48} color={tealDeep} /></div>
        <div style={{ fontFamily: fontDisplay, fontSize: '26px', fontWeight: '700', color: navy, marginBottom: '8px' }}>Application submitted</div>
        <div style={{ fontSize: '14px', color: gray600, lineHeight: '1.8', marginBottom: '24px' }}>
          Thanks <strong>{form.name}</strong>! We'll review your request to cover{' '}
          <strong>{form.area}, {form.city}</strong> and be in touch. If approved, you'll complete a short
          onboarding before your area goes live.
        </div>
        <TealBtn onClick={() => navigate('/')} style={{ width: '100%', padding: '15px', borderRadius: theme.radius.full, background: tealDeep, fontSize: '15px', fontWeight: '800' }}>Back to home</TealBtn>
      </Card>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: bg, padding: '24px 20px' }}>
      <div style={{ maxWidth: '540px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <Link to='/agent/login' style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: gray400, fontSize: 13, fontWeight: 600, textDecoration: 'none', marginBottom: '18px' }}><ChevronLeft size={15} /> Agent sign in</Link>
          <div style={{ margin: '0 auto 12px', display: 'flex', justifyContent: 'center' }}><Logo size={56} /></div>
          <div style={{ fontFamily: fontDisplay, fontSize: '28px', fontWeight: '700', color: navy }}>Become a CareHub Referral Agent</div>
          <div style={{ fontSize: '14px', color: gray600, marginTop: '8px', lineHeight: '1.7' }}>Own the growth of healthcare businesses in your area — onboarding them onto CareHub and supporting them long-term.</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '18px' }}>
          {[['40%', 'of a business\'s first payment', Percent], ['5%', 'of every renewal after that', Repeat]].map(([v, l, Icon]) => (
            <div key={l} style={{ display: 'flex', gap: '10px', padding: '14px', borderRadius: theme.radius.lg, background: theme.tealMist, alignItems: 'center' }}>
              <Icon size={20} color={tealDeep} style={{ flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: '18px', fontWeight: '900', color: tealDeep }}>{v}</div>
                <div style={{ fontSize: '11.5px', color: gray600 }}>{l}</div>
              </div>
            </div>
          ))}
        </div>

        <Card style={{ padding: '28px', borderRadius: theme.radius.xl, border: 'none', boxShadow: theme.elevation[3] }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '15px', fontWeight: '800', color: navy }}><MapPin size={16} color={tealDeep} /> Your territory</div>
            <CSel label='City / State *' value={form.city} onChange={v => f('city', v)} options={NIG_STATES} />
            <CInp label='Specific area / zone *' value={form.area} onChange={v => f('area', v)} placeholder='e.g. Surulere, Ikeja, Yaba…' required />

            <div style={{ borderTop: `1px solid ${border}`, margin: '4px 0', paddingTop: '14px', display: 'flex', alignItems: 'center', gap: 6, fontSize: '15px', fontWeight: '800', color: navy }}>Your details</div>
            <CInp label='Full name *' value={form.name} onChange={v => f('name', v)} placeholder='e.g. Chidinma Eze' required />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <CInp label='Email *' value={form.email} onChange={v => f('email', v)} type='email' placeholder='you@example.com' required />
              <CInp label='Phone' value={form.phone} onChange={v => f('phone', v)} type='tel' placeholder='08012345678' />
            </div>
            <CInp label='Experience (optional)' value={form.experience} onChange={v => f('experience', v)} placeholder='Healthcare, sales, or community experience' />
            <CInp label='Why this area? (optional)' value={form.motivation} onChange={v => f('motivation', v)} placeholder='A few sentences about your plan for the area' />
          </div>
        </Card>

        <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
          <GhostBtn onClick={() => navigate('/')} style={{ flex: 1, padding: '15px', borderRadius: theme.radius.full }}>Cancel</GhostBtn>
          <TealBtn onClick={submit} disabled={submitting} style={{ flex: 1, padding: '15px', borderRadius: theme.radius.full, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            {submitting ? 'Submitting…' : <>Submit application <ArrowRight size={14} /></>}
          </TealBtn>
        </div>
      </div>
      <Toast msg={msg} type={type} />
    </div>
  )
}