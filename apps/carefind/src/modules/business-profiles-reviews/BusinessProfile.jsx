import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { useAuth } from '../../providers/AuthContext'
import {
  ArrowLeft, BadgeCheck, Building2, Eye, Hospital, Leaf, MapPin, MessageCircle,
  Pill as PillIcon, Smile, Sparkles, Star, Store,
} from 'lucide-react'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useHeaderIdentity } from '../../hooks/useHeaderIdentity'
import AppShell from '../../components/layout/AppShell.jsx'
import { StickySidebar, SidebarSection } from '../../components/layout/SidebarSection.jsx'
import { getSentimentSummary } from './sentiment'
import { Card, Pill, TealBtn, Textarea, Loading, Empty, StarPicker, Stars, Toast, useToast } from '../../components/ui'

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

  async function loadAll() {
    setLoading(true)

    const { data: bizData } = await supabase
      .from('businesses')
      .select('id, name, address, city, state, business_type, whatsapp, hours, maps_link, cover_url')
      .eq('id', id)
      .maybeSingle()

    const { data: productData } = await supabase
      .from('products')
      .select('id, name, generic_name, price, stock, emoji, image_url, price_unit, sale_type, min_purchase')
      .eq('business_id', id)
      .eq('list_on_carefind', true)

    // Only hide products explicitly out of stock (stock may be null for some listings)
    const visibleProducts = (productData || []).filter((p) => p.stock == null || p.stock > 0)

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
        .select('id, full_name, display_name, is_verified')
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

  if (loading) return <Loading text="Loading business…" />
  if (!biz) return <Empty icon={<Building2 size={44} color={theme.gray300} strokeWidth={1.5} />} message="Business not found." action="Back to search" onAction={() => navigate('/search')} />

  const avgRating = reviews.length
    ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
    : null

  const ratingBreakdown = [5, 4, 3, 2, 1].map((n) => ({
    star: n,
    count: reviews.filter((r) => r.rating === n).length,
    pct: reviews.length ? Math.round((reviews.filter((r) => r.rating === n).length / reviews.length) * 100) : 0,
  }))

  // Build a proper wa.me link (handles Nigerian 080... numbers)
  let waLink = null
  if (biz.whatsapp) {
    let num = String(biz.whatsapp).replace(/\D/g, '')
    if (num.startsWith('0')) num = '234' + num.slice(1)
    else if (!num.startsWith('234')) num = '234' + num
    waLink = `https://wa.me/${num}?text=${encodeURIComponent(`Hi ${biz.name}, I found you on CareFind.`)}`
  }

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
        <p style={{ margin: '0 0 4px 0', fontSize: 13, color: theme.textMid }}>{biz.address}</p>
        {biz.hours && <p style={{ margin: '0 0 14px 0', color: theme.textLight, fontSize: 12 }}>Hours: {biz.hours}</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {waLink && (
            <a
              href={waLink}
              target="_blank"
              rel="noreferrer"
              style={{ textAlign: 'center', minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '11px 16px', background: '#25D366', color: '#fff', borderRadius: 12, textDecoration: 'none', fontSize: 13.5, fontWeight: 700, boxSizing: 'border-box' }}
            >
              <MessageCircle size={16} aria-hidden="true" style={{ marginRight: 7 }} /> WhatsApp
            </a>
          )}
          {biz.maps_link && (
            <a
              href={biz.maps_link}
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
      <div style={{
        background: theme.navy, color: '#fff',
        ...(isMobile
          ? { padding: '20px 20px 26px 20px', borderRadius: '0 0 28px 28px' }
          : { padding: '24px 28px', borderRadius: theme.radius.xl, marginBottom: 20 }),
      }}>
        {isMobile && (
          <Link to="/search" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
            <ArrowLeft size={15} aria-hidden="true" /> Back to search
          </Link>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: isMobile ? 16 : 0 }}>
          <span style={{
            width: 46, height: 46, borderRadius: theme.radius.lg, background: 'rgba(255,255,255,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <TypeIcon size={22} aria-hidden="true" />
          </span>
          <div>
            <h1 style={{ fontSize: 19, fontWeight: 900, margin: '0 0 2px 0', letterSpacing: '-0.01em' }}>{biz.name}</h1>
            <p style={{ margin: 0, fontSize: 12.5, color: 'rgba(255,255,255,0.65)', textTransform: 'capitalize' }}>
              {biz.business_type} · {biz.city}, {biz.state}
            </p>
          </div>
        </div>

        {isMobile && (
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <div style={{ flex: 1, background: 'rgba(255,255,255,0.12)', borderRadius: 14, padding: '10px 12px', textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: 17, fontWeight: 900 }}>{avgRating || '—'}</p>
              <p style={{ margin: 0, fontSize: 10.5, color: 'rgba(255,255,255,0.65)', fontWeight: 700 }}>Avg Rating</p>
            </div>
            <div style={{ flex: 1, background: 'rgba(255,255,255,0.12)', borderRadius: 14, padding: '10px 12px', textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: 17, fontWeight: 900 }}>{reviews.length}</p>
              <p style={{ margin: 0, fontSize: 10.5, color: 'rgba(255,255,255,0.65)', fontWeight: 700 }}>Reviews</p>
            </div>
            <div style={{ flex: 1, background: 'rgba(255,255,255,0.12)', borderRadius: 14, padding: '10px 12px', textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: 17, fontWeight: 900 }}>{products.length}</p>
              <p style={{ margin: 0, fontSize: 10.5, color: 'rgba(255,255,255,0.65)', fontWeight: 700 }}>Products</p>
            </div>
          </div>
        )}
      </div>

      <div style={isMobile ? { padding: '20px 20px 0 20px' } : {}}>
        {isMobile && (
          <>
            <p style={{ margin: '0 0 4px 0', fontSize: 13.5, color: theme.textMid }}>{biz.address}</p>
            {biz.hours && <p style={{ margin: '0 0 14px 0', color: theme.textLight, fontSize: 12.5 }}>Hours: {biz.hours}</p>}

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
              {biz.maps_link && (
                <a
                  href={biz.maps_link}
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
                    {p.sale_type && <Pill label={p.sale_type} type={p.sale_type === 'wholesale' ? 'purple' : 'teal'} style={{ fontSize: 9.5, textTransform: 'uppercase' }} />}
                    {p.min_purchase && <Pill label={`Min ${p.min_purchase} ${p.price_unit || ''}${p.min_purchase > 1 ? 's' : ''}`} type="gray" style={{ fontSize: 9.5 }} />}
                  </div>
                  <p style={{ margin: '3px 0 0 0', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: theme.tealDeep, fontWeight: 700 }}>
                    <Star size={11} aria-hidden="true" /> See reviews
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {p.price != null && <p style={{ margin: 0, fontSize: 14, fontWeight: 900, color: theme.tealDeep }}>₦{Number(p.price).toLocaleString()}</p>}
                  {p.price_unit && <p style={{ margin: 0, fontSize: 10, color: theme.textLight }}>per {p.price_unit}</p>}
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
                <div style={{ flex: 1, background: '#ecfdf5', borderRadius: 12, padding: '10px 8px', textAlign: 'center' }}>
                  <p style={{ margin: 0, fontSize: 16, fontWeight: 900, color: theme.success }}>{positive.length}</p>
                  <p style={{ margin: 0, fontSize: 10.5, color: theme.success, fontWeight: 700 }}>Positive</p>
                </div>
                <div style={{ flex: 1, background: '#fef9c3', borderRadius: 12, padding: '10px 8px', textAlign: 'center' }}>
                  <p style={{ margin: 0, fontSize: 16, fontWeight: 900, color: theme.warning }}>{neutral.length}</p>
                  <p style={{ margin: 0, fontSize: 10.5, color: theme.warning, fontWeight: 700 }}>Neutral</p>
                </div>
                <div style={{ flex: 1, background: '#fef2f2', borderRadius: 12, padding: '10px 8px', textAlign: 'center' }}>
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
                      {who?.is_verified && <BadgeCheck size={14} color={theme.tealDeep} aria-label="Verified" style={{ verticalAlign: '-2px', marginLeft: 4 }} />}
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
      onCompose={() => navigate('/')}
      rightSidebar={sidebarContent}
    >
      {bodyContent}
    </AppShell>
  )
}

export default BusinessProfile
