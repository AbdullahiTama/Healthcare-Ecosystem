import { useEffect, useState, useRef } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { useAuth } from '../../providers/AuthContext'
import {
  ArrowLeft, Building2, Eye, Hospital, Leaf, MapPin, MessageCircle, Phone,
  Pill as PillIcon, Smile, Sparkles, Star, Store,
} from 'lucide-react'
import { theme } from '../../styles/theme'
import { notifyReview } from '../../services/reviewNotifications.js'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useHeaderIdentity } from '../../hooks/useHeaderIdentity'
import { useGeolocation } from '../../hooks/useGeolocation'
import { canShowPrice, distanceLabel, whatsappLink, telLink, coordsFrom } from '../utils/marketplace'
import AppShell from '../../components/layout/AppShell.jsx'
import { StickySidebar, SidebarSection } from '../../components/layout/SidebarSection.jsx'
import { getSentimentSummary } from './sentiment'
import { Card, Pill, TealBtn, Inp, Textarea, Empty, StarPicker, Stars, Toast, useToast, CardSkeleton } from '../../components/ui'
import VerifiedBadge from '../../components/VerifiedBadge.jsx'

function BookingCard({ biz }) {
  const toast = useToast()
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const [date, setDate] = useState('')
  const [slot, setSlot] = useState('')
  const [apptType, setApptType] = useState(biz.booking_type === 'online' ? 'online' : 'physical')
  const [payMethod, setPayMethod] = useState(user ? 'coins' : 'card')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [booking, setBooking] = useState(false)
  const [done, setDone] = useState(false)
  const [services, setServices] = useState([])
  const [selectedService, setSelectedService] = useState('')
  const [serviceAvailability, setServiceAvailability] = useState([])
  const [availLoading, setAvailLoading] = useState(false)
  const [showReview, setShowReview] = useState(false)
  const [reviewData, setReviewData] = useState(null)
  const reviewCancelRef = useRef(null)

  // Dialog accessibility: ESC closes, focus management
  useEffect(() => {
    if (!showReview) return
    const onKey = (e) => { if (e.key === 'Escape') setShowReview(false) }
    window.addEventListener('keydown', onKey)
    // Focus first focusable in dialog
    setTimeout(() => reviewCancelRef.current?.focus(), 0)
    return () => window.removeEventListener('keydown', onKey)
  }, [showReview])

  useEffect(() => {
    let live = true
    supabase.from('business_services').select('id,name,price_kobo,duration_minutes,is_active').eq('business_id', biz.id).eq('is_active', true).then(({ data }) => {
      if (live) {
        setServices(data || [])
        if (data && data.length === 1) setSelectedService(data[0].id)
      }
    }).catch(() => {})
    return () => { live = false }
  }, [biz.id])

  // Load service-specific availability when service and date are selected
  useEffect(() => {
    if (!selectedService || !date) { setServiceAvailability([]); setAvailLoading(false); return }
    let live = true
    setAvailLoading(true)
    supabase.from('service_availability').select('id,date,time,start_time,end_time,status,is_booked').eq('business_id', biz.id).eq('service_id', selectedService).eq('date', date).then(({ data, error }) => {
      if (live) {
        if (!error && data) setServiceAvailability(data)
        else setServiceAvailability([])
        setAvailLoading(false)
      }
    }).catch(() => { if (live) { setServiceAvailability([]); setAvailLoading(false) } })
    return () => { live = false }
  }, [biz.id, selectedService, date])

  // Return from Paystack: the client was redirected here after paying for this
  // booking. Verify server-side (amount, appointment, Paystack status) and only
  // then show the confirmation — a "confirmed" state must never be shown for an
  // unverified payment.
  useEffect(() => {
    const ref = searchParams.get('reference') || searchParams.get('trxref')
    if (!ref) return
    let cancelled = false
    async function handleReturn() {
      try {
        const res = await fetch('/api/verify-booking-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reference: ref }),
        })
        const data = await res.json().catch(() => ({}))
        window.history.replaceState({}, '', window.location.pathname)
        if (!cancelled) {
          if (!res.ok) {
            toast.show(data.error || 'Could not confirm your payment. If you were charged, keep your reference and contact support.', { type: 'error' })
            return
          }
          setDone(true)
          toast.show('Payment confirmed — the business will confirm your appointment.', { type: 'success' })
        }
      } catch (err) {
        if (!cancelled) {
          window.history.replaceState({}, '', window.location.pathname)
          toast.show('Could not confirm payment. If you were charged, keep your reference and contact support.', { type: 'error' })
        }
      }
    }
    handleReturn()
    return () => { cancelled = true }
  }, [searchParams])

  const today = new Date().toLocaleDateString('en-CA')
  const isToday = date === today

  const selectedSvc = services.find(s => s.id === selectedService) || null
  // Per-service price takes precedence; fallback to consultation fee for backward compat
  // Price is snapshotted server-side — displayed price is for review only, not trusted for payment.
  const feeKobo = selectedSvc?.price_kobo != null ? selectedSvc.price_kobo : (apptType === 'online' ? biz.online_consultation_fee : biz.physical_consultation_fee)
  const coinCost = feeKobo ? Math.ceil(feeKobo / 20000) : 0

  // booking_slots may arrive as a real array OR as a raw comma-separated string
  const rawSlots = biz.booking_slots
  const slotList = Array.isArray(rawSlots)
    ? rawSlots
    : typeof rawSlots === 'string'
      ? rawSlots.split(',').map((s) => s.trim()).filter(Boolean)
      : []

  // Prefer service-specific availability when it exists for the selected service+date; otherwise fallback to daily slots
  const hasServiceSpecificSlots = selectedService && serviceAvailability.length > 0
  const effectiveSlotList = hasServiceSpecificSlots
    ? serviceAvailability.filter(a => a.status !== 'booked' && !a.is_booked).map(a => a.time || a.start_time)
    : slotList

  // Drop already-passed times when booking for today and filter out booked slots; also guard malformed times
  const slots = effectiveSlotList.filter((t) => {
    if (!t || !/^\d{2}:\d{2}$/.test(String(t))) return false
    const [hh, mm] = String(t).split(':').map(Number)
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return false
    if (!isToday) return true
    const now = new Date()
    return hh * 60 + mm > now.getHours() * 60 + now.getMinutes()
  })

  async function payWithCredits(appointmentId) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('not-signed-in')
    const res = await fetch('/api/booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action: 'pay-credits', appointment_id: appointmentId }),
    })
    return res
  }

  function openReview(e) {
    e.preventDefault()
    if (!date || !slot || !name.trim() || !phone.trim()) { toast.show('Please fill date, time, name and phone.'); return }
    if (services.length > 0 && !selectedService) { toast.show('Please select a service.'); return }
    // Show review screen with snapshot of current selections (spec §5 review)
    setReviewData({
      businessName: biz.name,
      serviceName: selectedSvc ? selectedSvc.name : (biz.booking_type === 'online' ? 'Online Consultation' : 'Consultation'),
      date,
      time: slot,
      priceKobo: feeKobo,
      priceLabel: feeKobo != null ? `₦${(feeKobo/100).toLocaleString()}` : 'Free',
    })
    setShowReview(true)
  }

  async function submitBooking() {
    if (!date || !slot || !name.trim() || !phone.trim()) return
    if (services.length > 0 && !selectedService) { toast.show('Please select a service.'); return }
    setBooking(true)
    setShowReview(false)
    try {
      const res = await fetch('/api/booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          business_id: biz.id,
          date,
          time: slot,
          booking_type: apptType,
          name: name.trim(),
          phone: phone.trim(),
          service_id: selectedService || null,
          service: selectedSvc ? selectedSvc.name : undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const errMsg = data.error || 'Could not send booking request.'
        toast.show(errMsg)
        // If slot just taken (409), refresh availability
        if (errMsg.toLowerCase().includes('taken') || errMsg.toLowerCase().includes('booked')) {
          if (selectedService && date) {
            supabase.from('service_availability').select('id,date,time,status,is_booked').eq('business_id', biz.id).eq('service_id', selectedService).eq('date', date).then(({ data }) => {
              if (data) setServiceAvailability(data)
            })
          }
          setSlot('')
        }
        setBooking(false)
        return
      }

      // Paid booking: settle immediately with CareCoins, or hand off to the
      // Paystack checkout. "Pay at the business" keeps the request as-is.
      if (data.paymentRequired && payMethod === 'coins') {
        const payRes = await payWithCredits(data.id)
        const payData = await payRes.json().catch(() => ({}))
        if (!payRes.ok) {
          toast.show(payData.error || 'Could not complete payment.')
          return
        }
        setDone(true)
        toast.show('Booking paid with your CareCoins — the business will confirm.')
        return
      }
      if (data.paymentRequired && payMethod === 'card' && data.authorization_url) {
        window.location.href = data.authorization_url
        return
      }

      setDone(true)
      toast.show('Request sent — the business will confirm your appointment.')
    } catch (err) {
      console.error('Booking error:', err)
      toast.show('Could not send booking request.')
    }
    setBooking(false)
  }

  return (
    <Card style={{ padding: 14, marginBottom: 26 }}>
      <p style={{ fontSize: 11, fontWeight: 800, color: theme.tealDeep, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px 0' }}>
        Book an Appointment
      </p>
      <p style={{ margin: '0 0 12px 0', fontSize: 12.5, color: theme.textLight }}>
        Pick a date and time — the business will confirm your request.
      </p>

      {done ? (
        <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: theme.success }}>Request sent — we'll notify you once the business confirms.</p>
      ) : (
        <form onSubmit={openReview}>
          {services.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11.5, fontWeight: 800, color: theme.textMid, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>Service</label>
              <select value={selectedService} onChange={e => setSelectedService(e.target.value)} required={services.length > 0} style={{ width: '100%', padding: '10px 12px', borderRadius: 12, border: `1px solid ${theme.border}`, background: '#fff', fontSize: 13, color: theme.navy }}>
                <option value="">Select a service</option>
                {services.map(s => (
                  <option key={s.id} value={s.id}>{s.name} {s.price_kobo != null ? `— ₦${(s.price_kobo / 100).toLocaleString()}` : '— Free'} {s.duration_minutes ? `· ${s.duration_minutes} min` : ''}</option>
                ))}
              </select>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <Inp
                label="Date"
                type="date"
                value={date}
                onChange={setDate}
                min={today}
                required
              />
            </div>
            <div style={{ flex: 1 }}>
              <Inp
                label="Your name"
                value={name}
                onChange={setName}
                placeholder="Full name"
                required
              />
            </div>
          </div>

          <Inp
            label="Phone number"
            type="tel"
            value={phone}
            onChange={setPhone}
            placeholder="e.g. 08012345678"
            required
            style={{ marginBottom: 10 }}
          />

          {biz.booking_type === 'both' && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {['physical', 'online'].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setApptType(t)}
                  style={{
                    flex: 1, padding: '8px 10px', borderRadius: 10, border: '1px solid',
                    borderColor: apptType === t ? theme.tealDeep : theme.border,
                    background: apptType === t ? theme.tealMist : '#fff',
                    color: apptType === t ? theme.tealDeep : theme.textMid,
                    fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  {t === 'physical' ? 'Visit in person' : 'Online visit'}
                </button>
              ))}
            </div>
          )}

          {feeKobo > 0 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              {user ? (
                <>
                  <button type="button" onClick={() => setPayMethod('coins')} style={{ flex: 1, padding: '8px 10px', borderRadius: 10, border: '1px solid', borderColor: payMethod === 'coins' ? theme.tealDeep : theme.border, background: payMethod === 'coins' ? theme.tealMist : '#fff', color: payMethod === 'coins' ? theme.tealDeep : theme.textMid, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                    Pay with CareCoins ({coinCost} coins)
                  </button>
                  <button type="button" onClick={() => setPayMethod('card')} style={{ flex: 1, padding: '8px 10px', borderRadius: 10, border: '1px solid', borderColor: payMethod === 'card' ? theme.tealDeep : theme.border, background: payMethod === 'card' ? theme.tealMist : '#fff', color: payMethod === 'card' ? theme.tealDeep : theme.textMid, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                    Pay with card
                  </button>
                </>
              ) : (
                <span style={{ fontSize: 12.5, color: theme.textMid, fontWeight: 600 }}>₦{(feeKobo / 100).toLocaleString()} — you'll pay securely by card after booking.</span>
              )}
            </div>
          )}

          <p style={{ margin: '0 0 6px 0', fontSize: 11.5, fontWeight: 800, color: theme.textMid, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Preferred time {availLoading && <span style={{ fontWeight: 400, textTransform: 'none', color: theme.textLight }}>(loading...)</span>}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }} role="group" aria-label="Available time slots">
            {slots.length === 0 && !availLoading && <span style={{ fontSize: 12.5, color: theme.textLight }}>{hasServiceSpecificSlots ? 'No available times for this service on this date — try another day.' : 'No times left for this date — pick another day.'}</span>}
            {availLoading && <span style={{ fontSize: 12.5, color: theme.textLight }}>Loading availability...</span>}
            {slots.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={slot === t}
                aria-label={`Select time ${t}`}
                onClick={() => setSlot(t)}
                style={{
                  padding: '7px 12px', borderRadius: 10, border: '1px solid',
                  borderColor: slot === t ? theme.tealDeep : theme.border,
                  background: slot === t ? theme.tealMist : '#fff',
                  color: slot === t ? theme.tealDeep : theme.textMid,
                  fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                }}
              >
                {t}
              </button>
            ))}
          </div>

          <TealBtn type="submit" disabled={booking || slots.length === 0}>
            Review Booking
          </TealBtn>
        </form>
      )}
      {showReview && reviewData && (
        <div role="dialog" aria-modal="true" aria-label="Review booking details" onClick={() => setShowReview(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 20, maxWidth: 420, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
            <h3 style={{ margin: '0 0 4px 0', fontSize: 16, fontWeight: 800, color: theme.navy }}>Review your booking</h3>
            <p style={{ margin: '0 0 14px 0', fontSize: 12.5, color: theme.textLight }}>Please confirm details before paying. Price is fixed at booking time and won't change later.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16, padding: 12, borderRadius: 12, background: theme.bg, border: `1px solid ${theme.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: theme.textMid, fontWeight: 600 }}>Business</span><span style={{ fontWeight: 700, color: theme.navy }}>{reviewData.businessName}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: theme.textMid, fontWeight: 600 }}>Service</span><span style={{ fontWeight: 700, color: theme.navy }}>{reviewData.serviceName}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: theme.textMid, fontWeight: 600 }}>Date</span><span style={{ fontWeight: 700 }}>{reviewData.date}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: theme.textMid, fontWeight: 600 }}>Time</span><span style={{ fontWeight: 700 }}>{reviewData.time}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, borderTop: `1px solid ${theme.border}`, paddingTop: 8 }}><span style={{ color: theme.textMid, fontWeight: 700 }}>Price</span><span style={{ fontWeight: 800, color: theme.tealDeep }}>{reviewData.priceLabel}</span></div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button ref={reviewCancelRef} onClick={() => setShowReview(false)} style={{ flex: 1, padding: '10px', borderRadius: 10, border: `1px solid ${theme.border}`, background: '#fff', color: theme.textMid, fontWeight: 700, cursor: 'pointer' }}>Back</button>
              <button onClick={submitBooking} disabled={booking} style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', background: theme.tealDeep, color: '#fff', fontWeight: 800, cursor: booking ? 'wait' : 'pointer', opacity: booking ? 0.7 : 1 }}>{booking ? 'Processing...' : (reviewData.priceKobo > 0 ? 'Pay Now' : 'Confirm Booking')}</button>
            </div>
            <p style={{ margin: '10px 0 0 0', fontSize: 11, color: theme.textLight, textAlign: 'center' }}>{reviewData.priceKobo > 0 ? 'You will be redirected to secure payment. Your slot is held only after verified payment.' : 'Free booking — no payment needed.'}</p>
          </div>
        </div>
      )}
    </Card>
  )
}

function BusinessProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { isMobile } = useBreakpoint()
  const { myUsername, myAvatar, unreadNotifs } = useHeaderIdentity(user)
  const [biz, setBiz] = useState(null)
  const [products, setProducts] = useState([])
  const [reviews, setReviews] = useState([])
  const [reviewers, setReviewers] = useState({})
  const [loading, setLoading] = useState(true)
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const toast = useToast()
  const { coords: userCoords } = useGeolocation()

  async function loadAll() {
    setLoading(true)

    const { data: bizData } = await supabase
      .from('businesses')
      .select('id, name, address, city, state, business_type, whatsapp, phone, website, hours, maps_link, cover_url, logo_url, description, booking_enabled, booking_type, booking_slots, status, visible_on_carefind, latitude, longitude, lat, lng, online_consultation_fee, physical_consultation_fee')
      .eq('id', id)
      .maybeSingle()

    // Public eligibility, same rule the directory and the booking endpoint
    // enforce: the business must be approved (status 'active') and not opted
    // out of the public directory. A pending or suspended business reached by
    // a direct URL must not render as a live profile.
    if (!bizData || bizData.status !== 'active' || bizData.visible_on_carefind === false) {
      setBiz(null)
      setProducts([])
      setReviews([])
      setLoading(false)
      return
    }

    const { data: productData } = await supabase
      .from('products')
      .select('id, name, generic_name, price, show_price, stock, emoji, image_url, price_unit, sale_type, min_purchase, list_on_carefind, latitude, longitude, businesses(show_prices, latitude, longitude, lat, lng)')
      .eq('business_id', id)

    // list_on_carefind may be NULL on legacy CareHub rows — treat anything but
    // an explicit false as listed, matching MedMarket search semantics.
    const listed = (productData || []).filter((p) => p.list_on_carefind !== false)

    // Only hide products explicitly out of stock (stock may be null for some listings)
    const visibleProducts = listed.filter((p) => p.stock == null || p.stock > 0)

    const { data: reviewData } = await supabase
      .from('reviews')
      .select('id, rating, comment, created_at, user_id')
      .eq('business_id', id)
      .order('created_at', { ascending: false })

    const rv = reviewData || []

    // Reviewer names (separate query so it works without a FK join)
    const userIds = [...new Set(rv.map((r) => r.user_id).filter(Boolean))]
    if (userIds.length) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, full_name, display_name, is_verified, specialty, verification_label')
        .in('id', userIds)
      const map = {}
      ;(profs || []).forEach((pr) => { map[pr.id] = pr })
      setReviewers(map)
    } else {
      setReviewers({})
    }

    setBiz(bizData)
    setProducts(visibleProducts)
    setReviews(rv)
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line
  }, [id])

  async function handleSubmitReview(e) {
    e.preventDefault()
    if (!user) return
    setSubmitting(true)

    const { error } = await supabase.from('reviews').insert({
      business_id: id,
      user_id: user.id,
      rating,
      comment,
    })

    if (!error) {
      // Issue #7: business reviews emitted no notification. The recipient is
      // whoever claimed the business, not a profile with this id.
      const sent = await notifyReview(supabase, {
        kind: 'business', actorId: user.id, businessId: id, rating, link: `/business/${id}`,
      })
      if (!sent.sent) console.warn('[review] no notification sent', sent.reason)
      setComment('')
      setRating(5)
      toast.show('Review posted — thank you!')
      loadAll()
    } else {
      console.error('Review error:', error)
      toast.show('Could not post your review: ' + error.message)
    }
    setSubmitting(false)
  }

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 20, maxWidth: 560, margin: '0 auto' }}>
      <CardSkeleton />
      <CardSkeleton />
      <CardSkeleton />
    </div>
  )
  if (!biz) return <Empty icon={<Building2 size={44} color={theme.gray300} strokeWidth={1.5} />} message="This business is not currently listed on CareFind." action="Back to search" onAction={() => navigate('/search')} />

  const avgRating = reviews.length
    ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
    : null

  const ratingBreakdown = [5, 4, 3, 2, 1].map((n) => ({
    star: n,
    count: reviews.filter((r) => r.rating === n).length,
    pct: reviews.length ? Math.round((reviews.filter((r) => r.rating === n).length / reviews.length) * 100) : 0,
  }))

  // Build a proper wa.me link (handles Nigerian 080... numbers)
  const waLink = whatsappLink(biz.whatsapp, `Hi ${biz.name}, I found you on CareFind.`)
  const callLink = telLink(biz.phone)

  // Google Maps link for the Directions button: the business-supplied map URL
  // wins; otherwise fall back to the exact GPS coordinates set in Settings
  // (lat/lng is the live shape, latitude/longitude is the legacy shape);
  // without either, the button is not rendered.
  const bizCoords = coordsFrom(biz)
  const mapHref = biz.maps_link
    || (bizCoords
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${bizCoords.lat},${bizCoords.lng}`)}`
      : null)

  // Website field accepts bare domains or handles — normalize to a usable href
  const websiteHref = biz.website && (biz.website.startsWith('http') ? biz.website : 'https://' + biz.website)

  // Business-type icons, matching CareHub's `businessLucideIcon()` vocabulary
  // so the same business type reads the same in both products.
  const TYPE_ICON = { pharmacy: PillIcon, hospital: Hospital, dental: Smile, optical: Eye, wellness: Leaf, skincare: Sparkles }
  const TypeIcon = TYPE_ICON[biz.business_type] || Store

  // Desktop only: the hero's key facts + primary actions, as a persistent
  // sidebar card instead of a one-time scroll-past block (LAYOUTS.md's
  // "Profile Detail" template — "trust signal and primary action both above
  // the fold" holds even better on desktop as a sticky panel, since the main
  // column here is a long scroll of products + reviews).
  const sidebarContent = (
    <StickySidebar width={300}>
      <SidebarSection title="At a glance">
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 900, color: theme.navy }}>{avgRating || '—'}</p>
            <p style={{ margin: 0, fontSize: 10.5, color: theme.textLight, fontWeight: 700 }}>Avg Rating</p>
          </div>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 900, color: theme.navy }}>{reviews.length}</p>
            <p style={{ margin: 0, fontSize: 10.5, color: theme.textLight, fontWeight: 700 }}>Reviews</p>
          </div>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 900, color: theme.navy }}>{products.length}</p>
            <p style={{ margin: 0, fontSize: 10.5, color: theme.textLight, fontWeight: 700 }}>Products</p>
          </div>
        </div>
      </SidebarSection>

      <SidebarSection title="Contact">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
          <p style={{ margin: 0, fontSize: 13, color: theme.textMid }}>{biz.address}</p>
          {biz.hours && <p style={{ margin: 0, color: theme.textLight, fontSize: 12 }}>Hours: {biz.hours}</p>}
          {biz.phone && <p style={{ margin: 0, color: theme.textMid, fontSize: 13 }}>Phone: {biz.phone}</p>}
          {websiteHref && (
            <p style={{ margin: 0, fontSize: 12.5, overflowWrap: 'anywhere' }}>
              <a href={websiteHref} target="_blank" rel="noreferrer" style={{ color: theme.tealDeep, textDecoration: 'none', fontWeight: 700 }}>{biz.website}</a>
            </p>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {waLink && (
            <div style={{ display: 'flex', gap: 8 }}>
              <a
                href={waLink}
                target="_blank"
                rel="noreferrer"
                style={{ flex: 1, textAlign: 'center', minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '11px 16px', background: '#25D366', color: '#fff', borderRadius: 12, textDecoration: 'none', fontSize: 13.5, fontWeight: 700, boxSizing: 'border-box' }}
              >
                <MessageCircle size={16} aria-hidden="true" style={{ marginRight: 7 }} /> WhatsApp
              </a>
              {callLink && (
                <a
                  href={callLink}
                  style={{ flex: 1, textAlign: 'center', minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '11px 16px', background: theme.tealDeep, color: '#fff', borderRadius: 12, textDecoration: 'none', fontSize: 13.5, fontWeight: 700, boxSizing: 'border-box' }}
                >
                  <Phone size={16} aria-hidden="true" style={{ marginRight: 7 }} /> Call
                </a>
              )}
            </div>
          )}
          {mapHref && (
            <a
              href={mapHref}
              target="_blank"
              rel="noreferrer"
              style={{ textAlign: 'center', minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '11px 16px', background: theme.tealDeep, color: '#fff', borderRadius: 12, textDecoration: 'none', fontSize: 13.5, fontWeight: 700, boxSizing: 'border-box' }}
            >
              Directions
            </a>
          )}
        </div>
      </SidebarSection>
    </StickySidebar>
  )

  const bodyContent = (
    <div style={isMobile ? { fontFamily: theme.fontFamily, maxWidth: 480, margin: '0 auto', paddingBottom: 40 } : { fontFamily: theme.fontFamily }}>
      <div role="img" aria-label={`${biz.name} — Black-owned ${biz.business_type} in ${biz.city}, Nigeria, verified on CareHub`} style={{
        background: `linear-gradient(135deg, ${theme.deepTeal}E6 0%, ${theme.tealDeep}D9 100%), url(${biz.cover_url || 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=800&q=80&auto=format&fit=crop'}) center/cover`,
        color: '#fff', position: 'relative', overflow: 'hidden',
        ...(isMobile
          ? { padding: '20px 20px 26px 20px', borderRadius: '0 0 28px 28px' }
          : { padding: '28px 32px', borderRadius: theme.radius.xl, marginBottom: 20 }),
      }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 30%, rgba(255,255,255,0.06) 0%, transparent 60%)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          {isMobile && (
            <Link to="/search" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'rgba(255,255,255,0.82)', textDecoration: 'none', fontSize: 13, fontWeight: 700, marginBottom: 14 }}>
              <ArrowLeft size={15} aria-hidden="true" /> Back to search
            </Link>
          )}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 999, background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.92)', fontSize: 11, fontWeight: 700, letterSpacing: '0.03em', backdropFilter: 'blur(6px)', marginBottom: 12 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px rgba(34,197,94,0.7)' }} /> Verified on CareHub · {biz.business_type} · {biz.city}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 4 }}>
            <span style={{
              width: 52, height: 52, borderRadius: theme.radius.lg, background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.18)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden', backdropFilter: 'blur(6px)', boxShadow: '0 4px 16px rgba(0,0,0,0.12)'
            }}>
              {biz.logo_url
                ? <img src={biz.logo_url} alt={`${biz.name} logo — Black-owned business in Nigeria`} width={52} height={52} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.currentTarget.style.display = 'none' }} />
                : <TypeIcon size={24} aria-hidden="true" />}
            </span>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ fontSize: isMobile ? 20 : 24, fontWeight: 900, margin: '0 0 3px 0', letterSpacing: '-0.02em', lineHeight: 1.15, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{biz.name} <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 999, background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.18)', fontSize: 10, fontWeight: 800, letterSpacing: '0.04em' }}>✓ Verified</span></h1>
              <p style={{ margin: 0, fontSize: 12.5, color: 'rgba(255,255,255,0.78)', textTransform: 'capitalize', fontWeight: 600 }}>
                {biz.business_type} · {biz.city}, {biz.state} {biz.hours ? `· ${biz.hours}` : ''}
              </p>
            </div>
          </div>

          {isMobile && (
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <div style={{ flex: 1, background: 'rgba(255,255,255,0.13)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 16, padding: '12px 12px', textAlign: 'center', backdropFilter: 'blur(6px)' }}>
                <p style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>{avgRating || '—'}</p>
                <p style={{ margin: 0, fontSize: 10.5, color: 'rgba(255,255,255,0.72)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Avg Rating</p>
              </div>
              <div style={{ flex: 1, background: 'rgba(255,255,255,0.13)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 16, padding: '12px 12px', textAlign: 'center', backdropFilter: 'blur(6px)' }}>
                <p style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>{reviews.length}</p>
                <p style={{ margin: 0, fontSize: 10.5, color: 'rgba(255,255,255,0.72)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Reviews</p>
              </div>
              <div style={{ flex: 1, background: 'rgba(255,255,255,0.13)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 16, padding: '12px 12px', textAlign: 'center', backdropFilter: 'blur(6px)' }}>
                <p style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>{products.length}</p>
                <p style={{ margin: 0, fontSize: 10.5, color: 'rgba(255,255,255,0.72)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Products</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={isMobile ? { padding: '20px 20px 0 20px' } : {}}>
        {isMobile && (
          <>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
              <p style={{ margin: 0, fontSize: 13.5, color: theme.textMid }}>{biz.address}</p>
              {biz.hours && <p style={{ margin: 0, color: theme.textLight, fontSize: 12.5 }}>Hours: {biz.hours}</p>}
              {biz.phone && <p style={{ margin: 0, fontSize: 13.5, color: theme.textMid }}>Phone: {biz.phone}</p>}
              {websiteHref && (
                <p style={{ margin: 0, fontSize: 13, overflowWrap: 'anywhere' }}>
                  <a href={websiteHref} target="_blank" rel="noreferrer" style={{ color: theme.tealDeep, textDecoration: 'none', fontWeight: 700 }}>{biz.website}</a>
                </p>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
              {waLink && (
                <a
                  href={waLink}
                  target="_blank"
                  rel="noreferrer"
                  style={{ flex: 1, textAlign: 'center', minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '11px 16px', background: '#25D366', color: '#fff', borderRadius: 14, textDecoration: 'none', fontSize: 13.5, fontWeight: 700, boxSizing: 'border-box' }}
                >
                  <MessageCircle size={16} aria-hidden="true" style={{ marginRight: 7 }} /> WhatsApp
                </a>
              )}
              {callLink && (
                <a
                  href={callLink}
                  style={{ flex: 1, textAlign: 'center', minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '11px 16px', background: theme.tealDeep, color: '#fff', borderRadius: 14, textDecoration: 'none', fontSize: 13.5, fontWeight: 700, boxSizing: 'border-box' }}
                >
                  <Phone size={16} aria-hidden="true" style={{ marginRight: 7 }} /> Call
                </a>
              )}
              {mapHref && (
                <a
                  href={mapHref}
                  target="_blank"
                  rel="noreferrer"
                  style={{ flex: 1, textAlign: 'center', minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '11px 16px', background: theme.tealDeep, color: '#fff', borderRadius: 14, textDecoration: 'none', fontSize: 13.5, fontWeight: 700, boxSizing: 'border-box' }}
                >
                  Directions
                </a>
              )}
            </div>
          </>
        )}

        {biz.description && (
          <>
            <p style={{ fontSize: 11, fontWeight: 800, color: theme.tealDeep, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px 0' }}>
              About
            </p>
            <Card style={{ padding: 14, marginBottom: 26 }}>
              <p style={{ margin: 0, fontSize: 13.5, color: theme.textMid, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{biz.description}</p>
            </Card>
          </>
        )}

        {biz.booking_enabled && <BookingCard biz={biz} />}

        <p style={{ fontSize: 11, fontWeight: 800, color: theme.tealDeep, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px 0' }}>
          Available Products
        </p>
        {products.length === 0 && <Empty icon={<PillIcon size={40} color={theme.gray300} strokeWidth={1.5} />} message="No products listed yet." />}

        <div style={isMobile
          ? { display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 26 }
          : { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 10, marginBottom: 26 }}>
          {products.map((p) => (
            <Link key={p.id} to={`/drug/${encodeURIComponent(p.name)}`} style={{ textDecoration: 'none' }}>
              <Card style={{ padding: 13, display: 'flex', gap: 12, alignItems: 'center' }}>
                {p.image_url
                  ? <div style={{ width: 44, height: 44, borderRadius: 10, background: `url(${p.image_url}) center/cover`, flexShrink: 0 }} />
                  : <div style={{
                      width: 44, height: 44, borderRadius: theme.radius.md, flexShrink: 0,
                      background: theme.tealMist, color: theme.tealDeep,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}><PillIcon size={21} aria-hidden="true" /></div>}
                <div style={{ flex: 1 }}>
                  <p style={{ margin: '0 0 2px 0', fontWeight: 700, fontSize: 14, color: theme.navy }}>{p.name}</p>
                  {p.generic_name && <p style={{ margin: '0 0 2px 0', color: theme.textLight, fontSize: 12, fontStyle: 'italic' }}>{p.generic_name}</p>}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
                    {p.sale_type && <Pill label={p.sale_type === 'retail' ? 'Retail' : (p.sale_type === 'distributor' ? 'Distributor' : 'Wholesale')} type={p.sale_type === 'retail' ? 'teal' : 'purple'} style={{ fontSize: 9.5, textTransform: 'uppercase' }} />}
                    {p.min_purchase && <Pill label={`Min ${p.min_purchase} ${p.price_unit || ''}${p.min_purchase > 1 ? 's' : ''}`} type="gray" style={{ fontSize: 9.5 }} />}
                    {(() => { const dist = distanceLabel(p, userCoords); return dist ? <Pill label={dist} type="gray" style={{ fontSize: 9.5 }} /> : null })()}
                  </div>
                  <p style={{ margin: '3px 0 0 0', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: theme.tealDeep, fontWeight: 700 }}>
                    <Star size={11} aria-hidden="true" /> See reviews
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {canShowPrice(p)
                    ? <>
                        <p style={{ margin: 0, fontSize: 14, fontWeight: 900, color: theme.tealDeep }}>₦{Number(p.price).toLocaleString()}</p>
                        {p.price_unit && <p style={{ margin: 0, fontSize: 10, color: theme.textLight }}>per {p.price_unit}</p>}
                      </>
                    : <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: theme.textLight }}>Ask for price</p>}
                  {p.stock != null && <p style={{ margin: 0, fontSize: 10.5, color: theme.textLight }}>Stock: {p.stock}</p>}
                </div>
              </Card>
            </Link>
          ))}
        </div>

        <p style={{ fontSize: 11, fontWeight: 800, color: theme.tealDeep, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px 0' }}>
          Reviews
        </p>

        {reviews.length > 0 && (
          <Card style={{ padding: 14, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ fontSize: 28, fontWeight: 900, color: theme.navy }}>{avgRating}</span>
              <div>
                <Stars value={Number(avgRating)} size={15} />
                <p style={{ margin: 0, fontSize: 11.5, color: theme.textLight }}>{reviews.length} review{reviews.length !== 1 ? 's' : ''} from users</p>
              </div>
            </div>

            {ratingBreakdown.map((r) => (
              <div key={r.star} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11.5, color: theme.textMid, width: 26 }}>
                  {r.star}<Star size={11} color={theme.warning} fill={theme.warning} aria-hidden="true" />
                </span>
                <div style={{ flex: 1, height: 6, background: theme.bg, borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${r.pct}%`, height: '100%', background: r.star >= 4 ? theme.success : r.star === 3 ? theme.warning : theme.alert, borderRadius: 4 }} />
                </div>
                <span style={{ fontSize: 11, color: theme.textLight, width: 24 }}>{r.count}</span>
              </div>
            ))}
          </Card>
        )}

        {reviews.length > 0 && (() => {
          const { positive, negative, neutral, themes } = getSentimentSummary(reviews)
          return (
            <Card style={{ padding: 14, marginBottom: 16 }}>
              <p style={{ margin: '0 0 10px 0', fontSize: 12, fontWeight: 800, color: theme.textMid, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Sentiment</p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <div style={{ flex: 1, background: theme.tealMist, borderRadius: 12, padding: '10px 8px', textAlign: 'center' }}>
                  <p style={{ margin: 0, fontSize: 16, fontWeight: 900, color: theme.success }}>{positive.length}</p>
                  <p style={{ margin: 0, fontSize: 10.5, color: theme.success, fontWeight: 700 }}>Positive</p>
                </div>
                <div style={{ flex: 1, background: theme.amberSoft, borderRadius: 12, padding: '10px 8px', textAlign: 'center' }}>
                  <p style={{ margin: 0, fontSize: 16, fontWeight: 900, color: theme.warning }}>{neutral.length}</p>
                  <p style={{ margin: 0, fontSize: 10.5, color: theme.warning, fontWeight: 700 }}>Neutral</p>
                </div>
                <div style={{ flex: 1, background: theme.dangerBg, borderRadius: 12, padding: '10px 8px', textAlign: 'center' }}>
                  <p style={{ margin: 0, fontSize: 16, fontWeight: 900, color: theme.alert }}>{negative.length}</p>
                  <p style={{ margin: 0, fontSize: 10.5, color: theme.alert, fontWeight: 700 }}>Negative</p>
                </div>
              </div>
              {themes.length > 0 && (
                <>
                  <p style={{ margin: '0 0 6px 0', fontSize: 11, fontWeight: 800, color: theme.textMid, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Common themes</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {themes.map((t) => <Pill key={t} label={t} type="gray" style={{ fontSize: 12, fontWeight: 600 }} />)}
                  </div>
                </>
              )}
            </Card>
          )
        })()}

        {user ? (
          <form onSubmit={handleSubmitReview} style={{ marginBottom: 18, border: `1px solid ${theme.border}`, borderRadius: theme.radius.lg, padding: 14, background: theme.cardBg, boxShadow: theme.elevation[1] }}>
            <div style={{ marginBottom: 10 }}>
              <StarPicker value={rating} onChange={setRating} />
            </div>
            <Textarea
              value={comment}
              onChange={setComment}
              placeholder="Share your experience..."
              rows={3}
            />
            <TealBtn type="submit" disabled={submitting} style={{ marginTop: 10 }}>
              {submitting ? 'Posting...' : 'Post Review'}
            </TealBtn>
          </form>
        ) : (
          <p style={{ color: theme.textLight, fontSize: 13, marginBottom: 18 }}>
            <Link to="/login" style={{ color: theme.tealDeep, fontWeight: 700 }}>Log in</Link> to leave a review.
          </p>
        )}

        {reviews.length === 0 && <Empty icon={<Star size={40} color={theme.gray300} strokeWidth={1.5} />} message="No reviews yet. Be the first!" />}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {reviews.map((r) => {
            const who = reviewers[r.user_id]
            const whoName = who?.full_name || who?.display_name || 'CareFind user'
            return (
              <Card key={r.id} style={{ padding: 13 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  {r.user_id ? (
                    <Link to={`/u/${r.user_id}`} style={{ fontSize: 13, fontWeight: 800, color: theme.navy, textDecoration: 'none' }}>
                      {whoName}
                      {<VerifiedBadge profile={who} size={14} style={{ marginLeft: 4 }} />}
                    </Link>
                  ) : (
                    <span style={{ fontSize: 13, fontWeight: 800, color: theme.navy }}>{whoName}</span>
                  )}
                  <Stars value={r.rating} size={13} />
                </div>
                {r.comment && <p style={{ margin: 0, fontSize: 13.5, color: theme.textMid, lineHeight: 1.5 }}>{r.comment}</p>}
                <p style={{ margin: '4px 0 0 0', fontSize: 10.5, color: theme.textLight }}>
                  {new Date(r.created_at).toLocaleDateString()}
                </p>
              </Card>
            )
          })}
        </div>
      </div>
      <Toast msg={toast.msg} />
    </div>
  )

  if (isMobile) return bodyContent

  return (
    <AppShell
      user={user}
      myUsername={myUsername}
      myAvatar={myAvatar}
      unreadNotifs={unreadNotifs}
      rightSidebar={sidebarContent}
    >
      {bodyContent}
    </AppShell>
  )
}

export default BusinessProfile
