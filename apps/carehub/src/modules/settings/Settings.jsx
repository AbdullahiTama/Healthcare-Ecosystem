import { useState, useEffect } from 'react'
import { Lock } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { settingsRepository } from './repositories'
import { businessLucideIcon, businessName } from '../../lib/utils'
import { NIG_STATES } from '../../config/constants'
import { useAuth } from '../../providers/AuthProvider'
import { authClient } from '../../lib/authClient'
import { PLAN_LABELS, PLAN_MONTHLY_NAIRA, PLAN_YEARLY_NAIRA, PLAN_LIMITS, isPlanAllowedForBusinessType } from '../../lib/planLimits'
import { theme } from '../../styles/theme'
import { sbUpload } from '../../services/supabase'
import { Card, Loading, SectionHead, Inp, Sel, Textarea, Toggle, TealBtn, GhostBtn, useToast, Toast } from '../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, border, danger, success, warning, bg } = theme

export default function Settings({ brand, role, perms }) {
  const { auth, setAuth } = useAuth()
  const [settings, setSettings] = useState({})
  const [bizForm, setBizForm] = useState({})
  const [bookingForm, setBookingForm] = useState({ enabled: false, type: 'physical', slotsText: '', onlineFee: '', physicalFee: '' })
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

  // Services
  const [services, setServices] = useState([])
  const [servicesLoading, setServicesLoading] = useState(false)
  const [servicesError, setServicesError] = useState('')
  const [showServiceModal, setShowServiceModal] = useState(false)
  const [editingService, setEditingService] = useState(null)
  const [serviceForm, setServiceForm] = useState({ name: '', description: '', price: '', duration: '' })
  const [savingService, setSavingService] = useState(false)
  const [deleteServiceTarget, setDeleteServiceTarget] = useState(null)
  const [availDate, setAvailDate] = useState('')
  const [availTime, setAvailTime] = useState('')
  const [availEndTime, setAvailEndTime] = useState('')
  const [availServiceId, setAvailServiceId] = useState('')
  const [availability, setAvailability] = useState([])
  const [availabilityError, setAvailabilityError] = useState('')

  useEffect(() => { load() }, [brand?.id])
  useEffect(() => { if (brand?.id) loadServices() }, [brand?.id])

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
        onlineFee: brand.online_consultation_fee != null ? String(brand.online_consultation_fee) : '',
        physicalFee: brand.physical_consultation_fee != null ? String(brand.physical_consultation_fee) : '',
        consultationMedium: brand.consultation_medium || 'whatsapp',
        consultationMediumLink: brand.consultation_medium_link || '',
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
        receipt_width: settings.receipt_width || '80',
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
      // Fees arrive as naira strings from the form; store as kobo (integer).
      // Blank means "free" — stored as NULL.
      const toKobo = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null }
      await settingsRepository.saveBookingConfig(brand.id, {
        enabled: bookingForm.enabled,
        type: bookingForm.type,
        slots,
        onlineFee: toKobo(bookingForm.onlineFee),
        physicalFee: toKobo(bookingForm.physicalFee),
        consultationMedium: bookingForm.consultationMedium,
        consultationMediumLink: bookingForm.consultationMediumLink,
      })
      showToast(bookingForm.enabled ? 'Online booking is live on your CareFind profile!' : 'Online booking turned off.', { type: 'success' })
    } catch (e) { showToast('Could not save booking settings. Please try again.', { type: 'error' }) }
    setSavingBooking(false)
  }

  // ── Services ────────────────────────────────────────────────────────────────
  async function loadServices() {
    setServicesLoading(true)
    setServicesError('')
    setAvailabilityError('')
    try {
      const s = await settingsRepository.getServices(brand.id)
      setServices(s || [])
      const av = await settingsRepository.getAvailability(brand.id)
      setAvailability(av || [])
    } catch (e) { setServicesError('Could not load services. Check your connection and try again.'); setServices([]) }
    setServicesLoading(false)
  }

  async function handleSaveService() {
    if (!serviceForm.name || !serviceForm.name.trim()) { showToast('Service name is required.', { type: 'warning' }); return }
    const priceNum = serviceForm.price ? parseFloat(serviceForm.price) : null
    if (priceNum != null && (isNaN(priceNum) || priceNum < 0)) { showToast('Price must be a valid non-negative amount.', { type: 'warning' }); return }
    const durNum = serviceForm.duration ? parseInt(serviceForm.duration) : null
    if (durNum != null && (isNaN(durNum) || durNum <= 0)) { showToast('Duration must be a positive number of minutes.', { type: 'warning' }); return }
    setSavingService(true)
    try {
      const payload = {
        name: serviceForm.name.trim(),
        description: serviceForm.description || null,
        price_kobo: serviceForm.price !== '' && serviceForm.price != null ? Math.round(parseFloat(serviceForm.price) * 100) : null,
        duration_minutes: serviceForm.duration ? parseInt(serviceForm.duration) : null,
        is_active: serviceForm.is_active !== false,
      }
      if (editingService) {
        await settingsRepository.updateService(editingService.id, brand.id, payload)
        showToast('Service updated! Future bookings will use the new price; past bookings keep their snapshot.', { type: 'success' })
      } else {
        await settingsRepository.createService(brand.id, payload)
        showToast('Service created!', { type: 'success' })
      }
      setShowServiceModal(false); setEditingService(null); setServiceForm({ name: '', description: '', price: '', duration: '' })
      loadServices()
    } catch (e) { showToast(e.message || 'Could not save service. Please try again.', { type: 'error' }) }
    setSavingService(false)
  }

  async function handleDeleteService() {
    const svc = deleteServiceTarget
    setDeleteServiceTarget(null)
    if (!svc?.id) return
    try { await settingsRepository.deleteService(svc.id, brand.id); showToast(`"${svc.name}" deactivated — hidden from patients but historical bookings preserved.`, { type: 'success' }); loadServices() } catch (e) { showToast(e.message || 'Could not deactivate service.', { type: 'error' }) }
  }

  async function handleAddAvailability() {
    if (!availDate || !availTime) { showToast('Pick a date and time.', { type: 'warning' }); return }
    const today = new Date().toISOString().split('T')[0]
    if (availDate < today) { showToast('Cannot create slots in the past.', { type: 'warning' }); return }
    if (availEndTime && availTime >= availEndTime) { showToast('End time must be after start time.', { type: 'warning' }); return }
    setAvailabilityError('')
    try {
      await settingsRepository.saveAvailability(brand.id, [{ service_id: availServiceId || null, date: availDate, time: availTime, start_time: availTime, end_time: availEndTime || null }])
      showToast('Availability added!', { type: 'success' })
      setAvailTime(''); setAvailEndTime('')
      const av = await settingsRepository.getAvailability(brand.id)
      setAvailability(av || [])
    } catch (e) { setAvailabilityError(e.message || 'Could not add availability. Time may already exist or overlaps.'); showToast(e.message || 'Could not add availability. Time may already exist.', { type: 'error' }) }
  }

  async function handleDeleteAvailability(id) {
    try { await settingsRepository.deleteAvailability(id, brand.id); setAvailability(prev => prev.filter(a => a.id !== id)); showToast('Slot removed.', { type: 'success' }) } catch (e) { showToast(e.message || 'Could not remove slot. Booked slots cannot be deleted.', { type: 'error' }) }
  }

  async function handleReactivateService(svc) {
    try { await settingsRepository.updateService(svc.id, brand.id, { is_active: true }); showToast(`"${svc.name}" reactivated.`, { type: 'success' }); loadServices() } catch (e) { showToast('Could not reactivate service.', { type: 'error' }) }
  }

  const openEditService = (svc) => {
    setEditingService(svc)
    setServiceForm({ name: svc.name, description: svc.description || '', price: svc.price_kobo != null ? String(svc.price_kobo / 100) : '', duration: svc.duration_minutes ? String(svc.duration_minutes) : '', is_active: svc.is_active })
    setShowServiceModal(true)
  }

  if (!isOwner) return (
    <div style={{ padding: '32px', textAlign: 'center', color: gray400 }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}><Lock size={40} /></div>
      <div style={{ fontSize: '16px', fontWeight: '700', color: gray600 }}>Settings are restricted to the business Owner</div>
      <div style={{ fontSize: '13px', marginTop: '8px' }}>Contact the owner to make changes</div>
    </div>
  )

  const planKey = brand?.plan || 'basic'
  const yearlyPrice = PLAN_YEARLY_NAIRA[planKey] ?? PLAN_YEARLY_NAIRA.basic
  const monthlyPrice = PLAN_MONTHLY_NAIRA[planKey] || PLAN_MONTHLY_NAIRA.basic
  const limits = PLAN_LIMITS[planKey] || PLAN_LIMITS.basic
  const expiresAt = brand?.plan_expires_at ? new Date(brand.plan_expires_at) : null
  const daysLeft = expiresAt ? Math.ceil((expiresAt - new Date()) / 86400000) : null
  const isExpired = daysLeft !== null && daysLeft < 0
  const hospitalBlocked = brand?.business_type === 'hospital' && planKey === 'basic'

  if (loading) return <Loading text="Loading settings..." />

  return (
    <div>
      <SectionHead title='Settings' sub='Business details and receipt customization' />

      {/* Billing */}
      <Card style={{ padding: '24px', marginBottom: '20px' }}>
        <div style={{ fontSize: '16px', fontWeight: '800', marginBottom: '4px', color: navy }}>Billing</div>
        <div style={{ fontSize: '13px', color: gray500, marginBottom: '16px' }}>Your plan and renewal</div>

        {hospitalBlocked && (
          <div style={{ marginBottom: '12px', padding: '12px 14px', borderRadius: theme.radius.md, background: theme.dangerBg, border: `1px solid ${theme.dangerBorder}`, color: theme.danger, fontSize: '13px', fontWeight: '600' }}>
            Hospitals start from Growth — Basic is not available for hospital accounts. Please upgrade to Growth or higher.
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', padding: '14px 16px', borderRadius: theme.radius.md, background: tealMist, border: `1px solid ${tealMist}`, marginBottom: '16px' }}>
          <div>
            <div style={{ fontWeight: '800', fontSize: '15px', color: navy }}>{PLAN_LABELS[planKey] || 'Basic'} plan</div>
            <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>
              {yearlyPrice ? `₦${yearlyPrice.toLocaleString()}/year` : 'Custom pricing'} {yearlyPrice ? <span style={{ color: gray400 }}>· ₦{monthlyPrice.toLocaleString()}/month</span> : null}
            </div>
            <div style={{ fontSize: '11px', color: gray400, marginTop: '4px' }}>
              {limits.maxLocations === Infinity ? 'Unlimited locations' : `Up to ${limits.maxLocations} locations`} · {limits.maxStaff === Infinity ? 'Unlimited staff' : `Up to ${limits.maxStaff} staff`} · {limits.maxProducts === Infinity ? 'Unlimited products' : `Up to ${limits.maxProducts.toLocaleString()} products`}
            </div>
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
          yearlyPrice ? (
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <TealBtn onClick={() => handleRenew(1)} disabled={renewing} style={{ padding: '12px 20px' }}>
                {renewing ? 'Redirecting…' : `Renew 1 month — ₦${monthlyPrice.toLocaleString()}`}
              </TealBtn>
              <GhostBtn onClick={() => handleRenew(12)} disabled={renewing} style={{ padding: '12px 20px' }}>
                {renewing ? 'Redirecting…' : `Renew 12 months — ₦${yearlyPrice.toLocaleString()}`}
              </GhostBtn>
            </div>
          ) : (
            <div style={{ padding: '14px', borderRadius: theme.radius.md, background: theme.gray50, border: `1px solid ${border}`, fontSize: '13px', color: gray600 }}>
              Custom plan — pricing is tailored to your organization. Contact <strong>support@carehub.ng</strong> to discuss your requirements.
            </div>
          )
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
          <TealBtn onClick={saveBizDetails} style={{ alignSelf: 'flex-start', padding: '12px 24px' }}>{savingBiz ? 'Saving...' : 'Save Business Details'}</TealBtn>
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <Inp label='Online fee (₦, blank = free)' value={bookingForm.onlineFee} onChange={v => bk('onlineFee', v)} type='number' placeholder='0' />
                <Inp label='Physical fee (₦, blank = free)' value={bookingForm.physicalFee} onChange={v => bk('physicalFee', v)} type='number' placeholder='0' />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <Sel label='Consultation medium' value={bookingForm.consultationMedium || 'whatsapp'} onChange={v => bk('consultationMedium', v)} options={[{ value: 'whatsapp', label: 'WhatsApp' }, { value: 'zoom', label: 'Zoom' }, { value: 'google_meet', label: 'Google Meet' }, { value: 'phone', label: 'Phone call' }, { value: 'other', label: 'Other' }]} />
                <Inp label='Medium link / ID' value={bookingForm.consultationMediumLink || ''} onChange={v => bk('consultationMediumLink', v)} placeholder='Link, meeting ID, or number' />
              </div>
              <div style={{ fontSize: '12px', color: gray500, padding: '10px 12px', borderRadius: theme.radius.md, background: bg }}>
                Clients pay online at booking time. Leave a fee blank to make that appointment type <strong>free</strong>. Bookings arrive in your <strong>Appointments</strong> page with a <strong>Web</strong> badge, ready for you to confirm. The consultation medium is shared with the client on online bookings.
              </div>
            </>
          )}
          <TealBtn onClick={saveBookingSettings} style={{ alignSelf: 'flex-start', padding: '12px 24px' }}>{savingBooking ? 'Saving...' : 'Save Booking Settings'}</TealBtn>
        </div>
      </Card>

      {/* Services — professional appointment configuration */}
      <Card style={{ padding: '24px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: '800', color: navy }}>Services</div>
            <div style={{ fontSize: '13px', color: gray500, marginTop: '4px' }}>Create your services, set prices and manage availability</div>
          </div>
          <TealBtn onClick={() => { setEditingService(null); setServiceForm({ name: '', description: '', price: '', duration: '', is_active: true }); setShowServiceModal(true) }} style={{ padding: '10px 18px' }}>+ Add Service</TealBtn>
        </div>

        {servicesError && (
          <div role="alert" aria-live="polite" style={{ marginBottom: '12px', padding: '10px 12px', borderRadius: theme.radius.md, background: theme.dangerBg, border: `1px solid ${theme.dangerBorder}`, color: theme.danger, fontSize: '12px', fontWeight: '600' }}>
            {servicesError} <button onClick={loadServices} style={{ marginLeft: 8, background: 'none', border: `1px solid ${theme.danger}`, color: theme.danger, borderRadius: theme.radius.sm, padding: '2px 8px', cursor: 'pointer', fontWeight: '700' }}>Retry</button>
          </div>
        )}
        {servicesLoading ? <Loading text="Loading services..." /> : services.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px', border: `2px dashed ${border}`, borderRadius: theme.radius.lg, background: bg }}>
            <div style={{ fontSize: '14px', fontWeight: '700', color: gray600, marginBottom: '6px' }}>No services yet</div>
            <div style={{ fontSize: '12px', color: gray400, marginBottom: '12px' }}>Add your first service to let customers book by service.</div>
            <GhostBtn onClick={() => { setEditingService(null); setServiceForm({ name: '', description: '', price: '', duration: '', is_active: true }); setShowServiceModal(true) }}>+ Add Service</GhostBtn>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
            {services.map(svc => (
              <div key={svc.id} role="article" aria-label={`Service ${svc.name}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: svc.is_active ? 'white' : theme.gray50, gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: '800', fontSize: '14px', color: navy, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {svc.name} {!svc.is_active && <span style={{ fontSize: '10px', fontWeight: '700', padding: '2px 6px', borderRadius: theme.radius.sm, background: theme.gray200, color: gray500 }}>INACTIVE — hidden from patients</span>}
                  </div>
                  {svc.description && <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{svc.description}</div>}
                  <div style={{ display: 'flex', gap: '12px', marginTop: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: tealDeep }}>{svc.price_kobo != null ? `₦${(svc.price_kobo / 100).toLocaleString()}` : 'Free'}</span>
                    {svc.duration_minutes && <span style={{ fontSize: '12px', color: gray400 }}>{svc.duration_minutes} min</span>}
                    <span style={{ fontSize: '11px', color: gray400 }}>Created {svc.created_at ? new Date(svc.created_at).toLocaleDateString() : ''}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <GhostBtn aria-label={`Edit ${svc.name}`} onClick={() => openEditService(svc)} style={{ padding: '6px 12px', fontSize: '12px' }}>Edit</GhostBtn>
                  <button aria-label={svc.is_active ? `Deactivate ${svc.name}` : `Reactivate ${svc.name}`} onClick={() => svc.is_active ? setDeleteServiceTarget(svc) : handleReactivateService(svc)} style={{ padding: '6px 12px', borderRadius: theme.radius.md, border: 'none', background: svc.is_active ? theme.dangerBg : tealMist, color: svc.is_active ? theme.danger : tealDeep, fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}>{svc.is_active ? 'Deactivate' : 'Reactivate'}</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ borderTop: `1px solid ${border}`, paddingTop: '20px', marginTop: '20px' }}>
          <div style={{ fontSize: '14px', fontWeight: '800', color: navy, marginBottom: '4px' }}>Availability</div>
          <div style={{ fontSize: '12px', color: gray500, marginBottom: '14px' }}>Add specific dates and time slots per service. Daily slots above still apply as fallback. Past dates and booked slots are blocked.</div>
          {availabilityError && (
            <div role="alert" style={{ marginBottom: '10px', padding: '8px 10px', borderRadius: theme.radius.md, background: theme.dangerBg, border: `1px solid ${theme.dangerBorder}`, color: theme.danger, fontSize: '12px' }}>{availabilityError}</div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: '8px', alignItems: 'end', marginBottom: '14px' }}>
            <Sel label="Service" value={availServiceId} onChange={setAvailServiceId} options={[{ value: '', label: 'All services (general)' }, ...services.filter(s=>s.is_active).map(s => ({ value: s.id, label: s.name }))]} />
            <Inp label="Date" type="date" value={availDate} onChange={setAvailDate} aria-label="Availability date" />
            <Inp label="Start time" type="time" value={availTime} onChange={setAvailTime} aria-label="Start time" />
            <Inp label="End time (optional)" type="time" value={availEndTime} onChange={setAvailEndTime} aria-label="End time" />
            <TealBtn onClick={handleAddAvailability} style={{ padding: '10px 16px' }} aria-label="Add availability slot">Add</TealBtn>
          </div>
          {availability.length === 0 ? (
            <div style={{ fontSize: '12px', color: gray400, textAlign: 'center', padding: '12px', background: bg, borderRadius: theme.radius.md }}>No date-specific slots yet. Daily slots from Booking above will be used.</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {availability.map(a => {
                const svcName = a.service_id ? (services.find(s => s.id === a.service_id)?.name || a.service_id.slice(0, 8)) : 'General'
                const isBooked = a.is_booked || a.status === 'booked' || !!a.appointment_id
                return (
                  <span key={a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 10px', borderRadius: theme.radius.full, background: isBooked ? theme.gray50 : tealMist, border: `1px solid ${isBooked ? theme.gray200 : tealDeep}`, fontSize: '12px', fontWeight: '600', color: isBooked ? gray500 : tealDeep, textDecoration: isBooked ? 'line-through' : 'none' }} title={isBooked ? 'Booked — cannot delete' : 'Available'}>
                    {svcName} · {a.date} {a.time}{a.end_time ? `–${a.end_time}` : ''} {isBooked && '(booked)'}
                    {!isBooked && <button onClick={() => handleDeleteAvailability(a.id)} aria-label={`Remove slot ${a.date} ${a.time}`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.danger, fontWeight: '900', padding: 0 }}>×</button>}
                  </span>
                )
              })}
            </div>
          )}
        </div>
      </Card>

      {/* Service modal */}
      {showServiceModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <Card style={{ maxWidth: '480px', width: '100%', padding: '24px' }}>
            <div style={{ fontSize: '16px', fontWeight: '800', color: navy, marginBottom: '16px' }}>{editingService ? 'Edit Service' : 'Add Service'}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <Inp label="Service name *" value={serviceForm.name} onChange={v => setServiceForm(p => ({ ...p, name: v }))} placeholder="e.g. Dental Cleaning" required />
              <Textarea label="Description" value={serviceForm.description} onChange={v => setServiceForm(p => ({ ...p, description: v }))} placeholder="What does this service include?" rows={2} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <Inp label="Price (₦, blank = free)" type="number" value={serviceForm.price} onChange={v => setServiceForm(p => ({ ...p, price: v }))} placeholder="0" />
                <Inp label="Duration (minutes)" type="number" value={serviceForm.duration} onChange={v => setServiceForm(p => ({ ...p, duration: v }))} placeholder="30" />
              </div>
              <Toggle label="Active" desc="Inactive services are hidden from customers" value={serviceForm.is_active !== false} onChange={v => setServiceForm(p => ({ ...p, is_active: v }))} />
              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                <GhostBtn onClick={() => { setShowServiceModal(false); setEditingService(null) }} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
                <TealBtn onClick={handleSaveService} style={{ flex: 1, padding: '12px' }}>{savingService ? 'Saving...' : editingService ? 'Save Changes' : 'Add Service'}</TealBtn>
              </div>
            </div>
          </Card>
        </div>
      )}

      {deleteServiceTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <Card style={{ maxWidth: '420px', width: '100%', padding: '24px', textAlign: 'center' }}>
            <div style={{ fontSize: '16px', fontWeight: '800', color: navy, marginBottom: '8px' }}>Deactivate service?</div>
            <div style={{ fontSize: '13px', color: gray500, marginBottom: '8px' }}>This will hide <strong>{deleteServiceTarget.name}</strong> from patients. Historical bookings keep their price and remain visible.</div>
            <div style={{ fontSize: '11px', color: gray400, marginBottom: '20px', padding: '8px', background: bg, borderRadius: theme.radius.sm }}>The service is soft-deactivated, not deleted, to preserve audit history per spec §3.2.</div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <GhostBtn onClick={() => setDeleteServiceTarget(null)} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
              <button onClick={handleDeleteService} style={{ flex: 1, padding: '12px', borderRadius: theme.radius.md, border: 'none', background: theme.danger, color: 'white', fontWeight: '800', cursor: 'pointer' }}>Deactivate</button>
            </div>
          </Card>
        </div>
      )}

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
          <Sel label='Receipt Paper Width' value={settings.receipt_width || '80'} onChange={v => s('receipt_width', v)} options={[{ value: '80', label: '80mm — counter printer' }, { value: '58', label: '58mm — portable printer' }]} />
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

        <TealBtn onClick={saveReceiptSettings} style={{ marginTop: '16px', alignSelf: 'flex-start', padding: '12px 24px' }}>{savingSettings ? 'Saving...' : 'Save Receipt Settings'}</TealBtn>
      </Card>

      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}
