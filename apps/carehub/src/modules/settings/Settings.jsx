import { useState, useEffect } from 'react'
import { Lock } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { settingsRepository } from './repositories'
import { businessLucideIcon, businessName } from '../../lib/utils'
import { NIG_STATES } from '../../config/constants'
import { useAuth } from '../../providers/AuthProvider'
import { authClient } from '../../lib/authClient'
import { PLAN_LABELS, PLAN_MONTHLY_NAIRA } from '../../lib/planLimits'
import { theme } from '../../styles/theme'
import { sbUpload } from '../../services/supabase'
import { Card, Loading, SectionHead, Inp, Sel, Textarea, Toggle, TealBtn, GhostBtn, useToast, Toast } from '../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, border, danger, success, warning, bg } = theme

export default function Settings({ brand, role, perms }) {
  const { auth, setAuth } = useAuth()
  const [settings, setSettings] = useState({})
  const [bizForm, setBizForm] = useState({})
  const [bookingForm, setBookingForm] = useState({ enabled: false, type: 'physical', slotsText: '' })
  const [loading, setLoading] = useState(true)
  const [savingSettings, setSavingSettings] = useState(false)
  const [savingBiz, setSavingBiz] = useState(false)
  const [uploading, setUploading] = useState(null)
  const [savingBooking, setSavingBooking] = useState(false)
  const [renewing, setRenewing] = useState(false)
  const [searchParams] = useSearchParams()
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const isOwner = role === 'Owner'
  const bType = brand?.business_type || brand?.type || 'skincare'

  useEffect(() => { load() }, [brand?.id])

  // Return from Paystack — verify server-side before showing the plan as
  // renewed. Same "never trust the URL, ask Paystack" shape as CareFind's
  // wallet top-up fix.
  useEffect(() => {
    async function handlePaystackReturn() {
      const ref = searchParams.get('reference') || searchParams.get('trxref')
      if (!ref) return
      const { data: { session } } = await authClient.auth.getSession()
      if (!session) { window.history.replaceState({}, '', '/dashboard/settings'); return }

      try {
        const response = await fetch('/api/verify-plan-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ reference: ref }),
        })
        const data = await response.json()
        window.history.replaceState({}, '', '/dashboard/settings')

        if (!response.ok) { showToast(`Could not confirm payment: ${data.error || 'unknown error'}`, { type: 'error' }); return }
        if (data.alreadyProcessed) return

        const newBrand = { ...brand, plan_expires_at: data.newExpiry }
        const newAuth = { ...auth, brand: newBrand }
        setAuth(newAuth)
        try { localStorage.setItem('carehub_auth', JSON.stringify(newAuth)) } catch (e) {}
        showToast('Plan renewed! Your new expiry date is ' + new Date(data.newExpiry).toLocaleDateString(), { type: 'success' })
      } catch (e) {
        window.history.replaceState({}, '', '/dashboard/settings')
        showToast('Could not confirm payment. If you were charged, contact support with your reference.', { type: 'error' })
      }
    }
    handlePaystackReturn()
    // eslint-disable-next-line
  }, [searchParams])

  async function handleRenew(months) {
    setRenewing(true)
    const { data: { session } } = await authClient.auth.getSession()
    if (!session) { showToast('Please log in again to renew your plan.', { type: 'warning' }); setRenewing(false); return }

    try {
      const response = await fetch('/api/initiate-plan-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ months, callback_url: `${window.location.origin}/dashboard/settings` }),
      })
      const data = await response.json()
      if (data.authorization_url) {
        window.location.href = data.authorization_url
      } else {
        showToast(`Payment error: ${data.error || 'Could not start payment'}`, { type: 'error' })
        setRenewing(false)
      }
    } catch (e) {
      showToast('Network error. Please check your connection and try again.', { type: 'error' })
      setRenewing(false)
    }
  }

  async function load() {
    setLoading(true)
    try {
      const s = await settingsRepository.get(brand.id)
      setSettings(s || {})
      setBizForm({
        name: brand.name || '',
        phone: brand.phone || '',
        whatsapp: brand.whatsapp || '',
        address: brand.address || '',
        state: brand.state || '',
        city: brand.city || '',
        hours: brand.hours || '',
        website: brand.website || '',
        logo_url: brand.logo_url || '',
        cover_url: brand.cover_url || '',
        description: brand.description || '',
        visible_on_carefind: brand.visible_on_carefind !== false,
        show_prices: brand.show_prices !== false,
        latitude: brand.latitude ?? '',
        longitude: brand.longitude ?? '',
      })
      setBookingForm({
        enabled: !!brand.booking_enabled,
        type: brand.booking_type || 'physical',
        slotsText: (Array.isArray(brand.booking_slots) ? brand.booking_slots : ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00']).join(', '),
      })
    } catch (e) {}
    setLoading(false)
  }

  async function saveReceiptSettings() {
    if (!isOwner) { showToast('Only the Owner can change settings', { type: 'warning' }); return }
    setSavingSettings(true)
    try {
      await settingsRepository.save(brand.id, {
        logo_url: settings.logo_url || '',
        receipt_header: settings.receipt_header || '',
        receipt_footer: settings.receipt_footer || '',
        refund_policy: settings.refund_policy || '',
        currency: settings.currency || 'NGN',
        tax_rate: parseFloat(settings.tax_rate) || 0,
      })
      showToast('Settings saved!', { type: 'success' })
    } catch (e) { showToast('Could not save settings. Please try again.', { type: 'error' }) }
    setSavingSettings(false)
  }

  async function saveBizDetails() {
    if (!isOwner) { showToast('Only the Owner can update business details', { type: 'warning' }); return }
    setSavingBiz(true)
    try {
      // The repository copies only the whitelisted profile fields, so a field
      // added to bizForm for display cannot reach the database by accident.
      const payload = {
        ...bizForm,
        // GPS fields are numeric in the database — an emptied input must
        // clear the column, not send an empty string.
        latitude: bizForm.latitude === '' ? null : (Number(bizForm.latitude) || null),
        longitude: bizForm.longitude === '' ? null : (Number(bizForm.longitude) || null),
      }
      await settingsRepository.saveBusinessProfile(brand.id, payload)
      showToast('Business details updated!', { type: 'success' })
    } catch (e) { showToast('Could not update business details. Please try again.', { type: 'error' }) }
    setSavingBiz(false)
  }

  const s = (k, v) => setSettings(p => ({ ...p, [k]: v }))
  const b = (k, v) => setBizForm(p => ({ ...p, [k]: v }))
  const bk = (k, v) => setBookingForm(p => ({ ...p, [k]: v }))

  // Upload a logo/cover to the public business-assets bucket and drop the
  // returned URL into the form — the owner still clicks Save to publish.
  async function uploadImage(kind) {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async () => {
      const file = input.files && input.files[0]
      if (!file) return
      setUploading(kind)
      try {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
        const path = 'businesses/' + brand.id + '/' + (kind === 'logo_url' ? 'logo' : 'cover') + '-' + Date.now() + '.' + ext
        const url = await sbUpload('business-assets', path, file, file.type || 'image/jpeg', 'Image upload failed')
        b(kind, url)
        showToast('Image uploaded — click "Save Business Details" to publish it.', { type: 'success' })
      } catch (e) { showToast('Upload failed — ' + e.message, { type: 'error' }) }
      setUploading(null)
    }
    input.click()
  }

  async function saveBookingSettings() {
    if (!isOwner) { showToast('Only the Owner can change booking settings', { type: 'warning' }); return }
    setSavingBooking(true)
    try {
      const slots = bookingForm.slotsText.split(',').map(x => x.trim()).filter(Boolean)
      if (bookingForm.enabled && slots.length === 0) { showToast('Add at least one available time slot.', { type: 'warning' }); setSavingBooking(false); return }
      await settingsRepository.saveBookingConfig(brand.id, {
        enabled: bookingForm.enabled,
        type: bookingForm.type,
        slots,
      })
      showToast(bookingForm.enabled ? 'Online booking is live on your CareFind profile!' : 'Online booking turned off.', { type: 'success' })
    } catch (e) { showToast('Could not save booking settings. Please try again.', { type: 'error' }) }
    setSavingBooking(false)
  }

  if (!isOwner) return (
    <div style={{ padding: '40px', textAlign: 'center', color: gray400 }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}><Lock size={40} /></div>
      <div style={{ fontSize: '16px', fontWeight: '700', color: gray600 }}>Settings are restricted to the business Owner</div>
      <div style={{ fontSize: '13px', marginTop: '8px' }}>Contact the owner to make changes</div>
    </div>
  )

  const planKey = brand?.plan || 'basic'
  const monthlyPrice = PLAN_MONTHLY_NAIRA[planKey] || PLAN_MONTHLY_NAIRA.basic
  const expiresAt = brand?.plan_expires_at ? new Date(brand.plan_expires_at) : null
  const daysLeft = expiresAt ? Math.ceil((expiresAt - new Date()) / 86400000) : null
  const isExpired = daysLeft !== null && daysLeft < 0

  if (loading) return <Loading text="Loading settings..." />

  return (
    <div>
      <SectionHead title='Settings' sub='Business details and receipt customization' />

      {/* Billing */}
      <Card style={{ padding: '24px', marginBottom: '20px' }}>
        <div style={{ fontSize: '16px', fontWeight: '800', marginBottom: '4px', color: navy }}>Billing</div>
        <div style={{ fontSize: '13px', color: gray500, marginBottom: '16px' }}>Your plan and renewal</div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', padding: '14px 16px', borderRadius: theme.radius.md, background: tealMist, border: `1px solid ${tealMist}`, marginBottom: '16px' }}>
          <div>
            <div style={{ fontWeight: '800', fontSize: '15px', color: navy }}>{PLAN_LABELS[planKey] || 'Basic'} plan</div>
            <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>₦{monthlyPrice.toLocaleString()}/month</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: '700', fontSize: '13px', color: isExpired ? danger : (daysLeft !== null && daysLeft <= 7) ? warning : success }}>
              {isExpired ? 'Expired' : expiresAt ? `Renews by ${expiresAt.toLocaleDateString()}` : '—'}
            </div>
            {!isExpired && daysLeft !== null && (
              <div style={{ fontSize: '11px', color: gray400 }}>{daysLeft} day{daysLeft === 1 ? '' : 's'} left</div>
            )}
          </div>
        </div>

        {isOwner ? (
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <TealBtn onClick={() => handleRenew(1)} disabled={renewing} style={{ padding: '11px 20px' }}>
              {renewing ? 'Redirecting…' : `Renew 1 month — ₦${monthlyPrice.toLocaleString()}`}
            </TealBtn>
            <GhostBtn onClick={() => handleRenew(12)} disabled={renewing} style={{ padding: '11px 20px' }}>
              {renewing ? 'Redirecting…' : `Renew 12 months, pay for 10 — ₦${(monthlyPrice * 10).toLocaleString()}`}
            </GhostBtn>
          </div>
        ) : (
          <p style={{ fontSize: '12px', color: gray400 }}>Only the business Owner can renew the plan.</p>
        )}
      </Card>

      {/* Business Type Badge */}
      <div style={{ marginBottom: '24px', padding: '16px', borderRadius: theme.radius.lg, background: 'white', border: `1px solid ${border}`, display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{ width: 48, height: 48, borderRadius: theme.radius.md, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {(() => { const Icon = businessLucideIcon(bType); return <Icon size={24} /> })()}
        </div>
        <div>
          <div style={{ fontWeight: '800', fontSize: '15px', color: navy }}>{businessName(bType)}</div>
          <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>Business type — determines your consultation forms and workflow</div>
        </div>
      </div>

      {/* Business Details */}
      <Card style={{ padding: '24px', marginBottom: '20px' }}>
        <div style={{ fontSize: '16px', fontWeight: '800', marginBottom: '16px', color: navy }}>Business Details</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Inp label='Business Name' value={bizForm.name} onChange={v => b('name', v)} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Inp label='Phone' value={bizForm.phone} onChange={v => b('phone', v)} placeholder='08012345678' />
            <Inp label='WhatsApp' value={bizForm.whatsapp} onChange={v => b('whatsapp', v)} placeholder='08012345678' />
          </div>
          <Inp label='Full Address' value={bizForm.address} onChange={v => b('address', v)} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Sel label='State' value={bizForm.state} onChange={v => b('state', v)} options={NIG_STATES} />
            <Inp label='City / Area' value={bizForm.city} onChange={v => b('city', v)} />
          </div>
          <Inp label='Business Hours' value={bizForm.hours} onChange={v => b('hours', v)} placeholder='e.g. Mon-Sat 8am-8pm' />
          <Inp label='Website / Instagram' value={bizForm.website} onChange={v => b('website', v)} placeholder='@yourbusiness' />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Inp label='GPS Latitude (optional)' value={bizForm.latitude} onChange={v => b('latitude', v)} placeholder='e.g. 6.4474' />
            <Inp label='GPS Longitude (optional)' value={bizForm.longitude} onChange={v => b('longitude', v)} placeholder='e.g. 3.4359' />
          </div>
          <div style={{ fontSize: '12px', color: gray500, padding: '10px 12px', borderRadius: theme.radius.md, background: bg }}>
            Pin your exact location on the public CareFind map. Find your coordinates on <a href='https://www.google.com/maps' target='_blank' rel='noopener noreferrer' style={{ color: tealDeep, fontWeight: '600' }}>Google Maps</a> — right-click anywhere and copy the numbers.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <Inp label='Logo URL' value={bizForm.logo_url} onChange={v => b('logo_url', v)} placeholder='https://yourwebsite.com/logo.png' />
              <GhostBtn onClick={() => uploadImage('logo_url')} style={{ alignSelf: 'flex-start' }}>
                {uploading === 'logo_url' ? 'Uploading…' : 'Upload logo'}
              </GhostBtn>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <Inp label='Cover Image URL' value={bizForm.cover_url} onChange={v => b('cover_url', v)} placeholder='https://yourwebsite.com/banner.jpg' />
              <GhostBtn onClick={() => uploadImage('cover_url')} style={{ alignSelf: 'flex-start' }}>
                {uploading === 'cover_url' ? 'Uploading…' : 'Upload cover image'}
              </GhostBtn>
            </div>
          </div>
          {bizForm.logo_url && (
            <img src={bizForm.logo_url} alt='Logo preview' style={{ width: '48px', height: '48px', borderRadius: '8px', objectFit: 'cover', border: `1px solid ${border}` }} onError={e => e.target.style.display = 'none'} />
          )}
          <Textarea label='About your business' value={bizForm.description || ''} onChange={v => b('description', v)} rows={3} placeholder='Shown on your public CareFind profile — services, specialties, what makes you stand out...' />
          <Toggle label='Listed on CareFind' desc='Allow patients to find your business on the public CareFind platform' value={bizForm.visible_on_carefind !== false} onChange={v => b('visible_on_carefind', v)} />
          <Toggle label='Show product prices on CareFind' desc='When off, patients see "Ask for price" instead of your product prices' value={bizForm.show_prices !== false} onChange={v => b('show_prices', v)} />
          <TealBtn onClick={saveBizDetails} style={{ alignSelf: 'flex-start', padding: '11px 24px' }}>{savingBiz ? 'Saving...' : 'Save Business Details'}</TealBtn>
        </div>
      </Card>

      {/* Booking */}
      <Card style={{ padding: '24px', marginBottom: '20px' }}>
        <div style={{ fontSize: '16px', fontWeight: '800', marginBottom: '4px', color: navy }}>Appointment Booking</div>
        <div style={{ fontSize: '13px', color: gray500, marginBottom: '16px' }}>Let patients book appointments directly from your public CareFind profile</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Toggle label='Accept online bookings' desc='Shows a "Book an Appointment" section on your CareFind profile page' value={bookingForm.enabled} onChange={v => bk('enabled', v)} />
          {bookingForm.enabled && (
            <>
              <Sel label='Appointment type' value={bookingForm.type} onChange={v => bk('type', v)} options={[{ value: 'physical', label: 'Physical visits only' }, { value: 'online', label: 'Online (video/phone) only' }, { value: 'both', label: 'Both — let the patient choose' }]} />
              <Inp label='Available time slots (comma-separated, 24h)' value={bookingForm.slotsText} onChange={v => bk('slotsText', v)} placeholder='09:00, 10:00, 11:00, 14:00, 15:00' />
              <div style={{ fontSize: '12px', color: gray500, padding: '10px 12px', borderRadius: theme.radius.md, background: bg }}>
                Bookings arrive in your <strong>Appointments</strong> page with a <strong>Web</strong> badge, ready for you to confirm or reschedule.
              </div>
            </>
          )}
          <TealBtn onClick={saveBookingSettings} style={{ alignSelf: 'flex-start', padding: '11px 24px' }}>{savingBooking ? 'Saving...' : 'Save Booking Settings'}</TealBtn>
        </div>
      </Card>

      {/* Receipt Customization */}
      <Card style={{ padding: '24px', marginBottom: '20px' }}>
        <div style={{ fontSize: '16px', fontWeight: '800', marginBottom: '4px', color: navy }}>Receipt Customization</div>
        <div style={{ fontSize: '13px', color: gray500, marginBottom: '16px' }}>This appears on every printed receipt</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Inp label='Logo URL' value={settings.logo_url} onChange={v => s('logo_url', v)} placeholder='https://yourwebsite.com/logo.png (paste image URL)' />
          {settings.logo_url && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', borderRadius: theme.radius.md, background: bg }}>
              <img src={settings.logo_url} alt='Logo preview' style={{ width: '48px', height: '48px', borderRadius: '8px', objectFit: 'cover', border: `1px solid ${border}` }} onError={e => e.target.style.display = 'none'} />
              <div style={{ fontSize: '12px', color: gray500 }}>Logo preview — this is how it appears on receipts</div>
            </div>
          )}
          <Textarea label='Receipt Header' value={settings.receipt_header} onChange={v => s('receipt_header', v)} placeholder='e.g. NAFDAC Reg No: A1-234 | PCN Reg No: PCN/LIC/123' rows={2} />
          <Textarea label='Refund / Return Policy' value={settings.refund_policy} onChange={v => s('refund_policy', v)} placeholder='e.g. No refund on dispensed medicines. Report issues within 24 hours.' rows={3} />
          <Textarea label='Receipt Footer Message' value={settings.receipt_footer} onChange={v => s('receipt_footer', v)} placeholder='e.g. Thank you for choosing us! Your health is our priority.' rows={2} />
          <Inp label='Tax Rate (%)' value={settings.tax_rate} onChange={v => s('tax_rate', v)} type='number' placeholder='0 (leave blank if no tax)' />
        </div>

        {/* Preview */}
        <div style={{ marginTop: '20px', padding: '16px', borderRadius: theme.radius.md, border: `2px dashed ${border}`, background: bg }}>
          <div style={{ fontSize: '11px', fontWeight: '700', color: gray400, marginBottom: '10px', letterSpacing: '1px' }}>RECEIPT PREVIEW</div>
          <div style={{ fontFamily: theme.fontMono, fontSize: '12px', color: navy, lineHeight: '1.8' }}>
            <div style={{ textAlign: 'center', marginBottom: '8px' }}>
              {settings.logo_url && <img src={settings.logo_url} alt='' style={{ width: '36px', height: '36px', borderRadius: '50%', objectFit: 'cover', display: 'block', margin: '0 auto 6px' }} onError={e => e.target.style.display = 'none'} />}
              <div style={{ fontWeight: '700' }}>{brand?.name || 'Your Business Name'}</div>
              <div style={{ fontSize: '10px', color: gray500 }}>{brand?.address || 'Business Address'}</div>
              <div style={{ fontSize: '10px', color: gray500 }}>WhatsApp: {brand?.whatsapp || '—'}</div>
              {settings.receipt_header && <div style={{ fontSize: '10px', fontStyle: 'italic', marginTop: '4px' }}>{settings.receipt_header}</div>}
            </div>
            <div style={{ borderTop: `1px dashed ${border}`, margin: '8px 0' }} />
            <div>Amoxicillin 500mg · 2 × ₦1,500 · ₦3,000</div>
            <div>Paracetamol 500mg · 1 × ₦800 · ₦800</div>
            <div style={{ borderTop: `1px dashed ${border}`, margin: '8px 0' }} />
            <div style={{ fontWeight: '700' }}>TOTAL: ₦3,800</div>
            {settings.refund_policy && <div style={{ fontSize: '10px', color: gray500, marginTop: '6px', borderTop: `1px dashed ${border}`, paddingTop: '6px' }}>{settings.refund_policy}</div>}
            {settings.receipt_footer && <div style={{ fontSize: '10px', textAlign: 'center', marginTop: '6px', color: gray600 }}>{settings.receipt_footer}</div>}
          </div>
        </div>

        <TealBtn onClick={saveReceiptSettings} style={{ marginTop: '16px', alignSelf: 'flex-start', padding: '11px 24px' }}>{savingSettings ? 'Saving...' : 'Save Receipt Settings'}</TealBtn>
      </Card>

      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}
