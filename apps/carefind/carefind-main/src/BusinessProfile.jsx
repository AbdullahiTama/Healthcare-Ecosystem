import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import { useAuth } from './lib/AuthContext'
import { theme } from './lib/theme'
import { getSentimentSummary } from './lib/sentiment'

function BusinessProfile() {
  const { id } = useParams()
  const { user } = useAuth()
  const [biz, setBiz] = useState(null)
  const [products, setProducts] = useState([])
  const [reviews, setReviews] = useState([])
  const [reviewers, setReviewers] = useState({})
  const [loading, setLoading] = useState(true)
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)

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
      loadAll()
    } else {
      console.error('Review error:', error)
    }
    setSubmitting(false)
  }

  if (loading) return <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif' }}>Loading...</div>
  if (!biz) return <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif' }}>Business not found.</div>

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

  const typeIcons = { pharmacy: '💊', hospital: '🏥', dental: '🦷', optical: '👁️', wellness: '🌿', skincare: '✨' }

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 480, margin: '0 auto', paddingBottom: 40 }}>
      <div style={{ background: theme.heroGradient, padding: '20px 20px 26px 20px', borderRadius: '0 0 28px 28px', color: '#fff' }}>
        <Link to="/search" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>← Back to search</Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
          <span style={{
            width: 46, height: 46, borderRadius: 14, background: 'rgba(255,255,255,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0,
          }}>
            {typeIcons[biz.business_type] || '🏪'}
          </span>
          <div>
            <h1 style={{ fontSize: 19, fontWeight: 900, margin: '0 0 2px 0', letterSpacing: '-0.01em' }}>{biz.name}</h1>
            <p style={{ margin: 0, fontSize: 12.5, color: 'rgba(255,255,255,0.65)', textTransform: 'capitalize' }}>
              {biz.business_type} · {biz.city}, {biz.state}
            </p>
          </div>
        </div>

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
      </div>

      <div style={{ padding: '20px 20px 0 20px' }}>
        <p style={{ margin: '0 0 4px 0', fontSize: 13.5, color: theme.textMid }}>{biz.address}</p>
        {biz.hours && <p style={{ margin: '0 0 14px 0', color: theme.textLight, fontSize: 12.5 }}>Hours: {biz.hours}</p>}

        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {waLink && (
            <a
              href={waLink}
              target="_blank"
              rel="noreferrer"
              style={{ flex: 1, textAlign: 'center', padding: '11px 16px', background: '#25D366', color: '#fff', borderRadius: 14, textDecoration: 'none', fontSize: 13.5, fontWeight: 700 }}
            >
              💬 WhatsApp
            </a>
          )}
          {biz.maps_link && (
            <a
              href={biz.maps_link}
              target="_blank"
              rel="noreferrer"
              style={{ flex: 1, textAlign: 'center', padding: '11px 16px', background: theme.tealGradient, color: '#fff', borderRadius: 14, textDecoration: 'none', fontSize: 13.5, fontWeight: 700 }}
            >
              Directions
            </a>
          )}
        </div>

        <p style={{ fontSize: 11, fontWeight: 800, color: theme.tealDeep, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px 0' }}>
          Available Products
        </p>
        {products.length === 0 && <p style={{ color: theme.textLight, fontSize: 13 }}>No products listed yet.</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 26 }}>
          {products.map((p) => (
            <Link
              key={p.id}
              to={`/drug/${encodeURIComponent(p.name)}`}
              style={{ textDecoration: 'none', border: `1px solid ${theme.border}`, borderRadius: 14, padding: 13, background: theme.cardBg, boxShadow: '0 1px 4px rgba(0,0,0,0.05)', display: 'flex', gap: 12, alignItems: 'center' }}
            >
              {p.image_url
                ? <div style={{ width: 44, height: 44, borderRadius: 10, background: `url(${p.image_url}) center/cover`, flexShrink: 0 }} />
                : <div style={{ fontSize: 24, flexShrink: 0 }}>{p.emoji || '💊'}</div>}
              <div style={{ flex: 1 }}>
                <p style={{ margin: '0 0 2px 0', fontWeight: 700, fontSize: 14, color: theme.navy }}>{p.name}</p>
                {p.generic_name && <p style={{ margin: '0 0 2px 0', color: theme.textLight, fontSize: 12, fontStyle: 'italic' }}>{p.generic_name}</p>}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
                  {p.sale_type && (
                    <span style={{ fontSize: 9.5, fontWeight: 800, color: p.sale_type === 'wholesale' ? '#7c3aed' : theme.tealDeep, background: p.sale_type === 'wholesale' ? '#f3e8ff' : '#ecfdf5', padding: '2px 8px', borderRadius: 10, textTransform: 'uppercase' }}>{p.sale_type}</span>
                  )}
                  {p.min_purchase && (
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: theme.textMid, background: theme.bg, padding: '2px 8px', borderRadius: 10 }}>
                      Min {p.min_purchase} {p.price_unit || ''}{p.min_purchase > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <p style={{ margin: '3px 0 0 0', fontSize: 10.5, color: theme.tealDeep, fontWeight: 700 }}>⭐ See reviews ›</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                {p.price != null && <p style={{ margin: 0, fontSize: 14, fontWeight: 900, color: theme.tealDeep }}>₦{Number(p.price).toLocaleString()}</p>}
                {p.price_unit && <p style={{ margin: 0, fontSize: 10, color: theme.textLight }}>per {p.price_unit}</p>}
                {p.stock != null && <p style={{ margin: 0, fontSize: 10.5, color: theme.textLight }}>Stock: {p.stock}</p>}
              </div>
            </Link>
          ))}
        </div>

        <p style={{ fontSize: 11, fontWeight: 800, color: theme.tealDeep, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px 0' }}>
          Reviews
        </p>

        {reviews.length > 0 && (
          <div style={{ border: `1px solid ${theme.border}`, borderRadius: 16, padding: 14, background: theme.cardBg, boxShadow: '0 1px 4px rgba(0,0,0,0.05)', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ fontSize: 28, fontWeight: 900, color: theme.navy }}>{avgRating}</span>
              <div>
                <p style={{ margin: 0, color: theme.warning, fontSize: 14 }}>{'★'.repeat(Math.round(Number(avgRating)))}{'☆'.repeat(5 - Math.round(Number(avgRating)))}</p>
                <p style={{ margin: 0, fontSize: 11.5, color: theme.textLight }}>{reviews.length} review{reviews.length !== 1 ? 's' : ''} from users</p>
              </div>
            </div>

            {ratingBreakdown.map((r) => (
              <div key={r.star} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                <span style={{ fontSize: 11.5, color: theme.textMid, width: 12 }}>{r.star}</span>
                <span style={{ fontSize: 11, color: theme.warning }}>★</span>
                <div style={{ flex: 1, height: 6, background: theme.bg, borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${r.pct}%`, height: '100%', background: r.star >= 4 ? theme.success : r.star === 3 ? theme.warning : theme.alert, borderRadius: 4 }} />
                </div>
                <span style={{ fontSize: 11, color: theme.textLight, width: 24 }}>{r.count}</span>
              </div>
            ))}
          </div>
        )}

        {reviews.length > 0 && (() => {
          const { positive, negative, neutral, themes } = getSentimentSummary(reviews)
          return (
            <div style={{ border: `1px solid ${theme.border}`, borderRadius: 16, padding: 14, background: theme.cardBg, boxShadow: '0 1px 4px rgba(0,0,0,0.05)', marginBottom: 16 }}>
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
                    {themes.map((t) => (
                      <span key={t} style={{ padding: '4px 10px', background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 20, fontSize: 12, color: theme.textMid, fontWeight: 600 }}>
                        {t}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          )
        })()}

        {user ? (
          <form onSubmit={handleSubmitReview} style={{ marginBottom: 18, border: `1px solid ${theme.border}`, borderRadius: 16, padding: 14, background: theme.cardBg, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
            <div style={{ marginBottom: 8 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  type="button"
                  key={n}
                  onClick={() => setRating(n)}
                  style={{ background: 'none', border: 'none', fontSize: 22, color: n <= rating ? theme.warning : '#ddd' }}
                >
                  ★
                </button>
              ))}
            </div>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Share your experience..."
              rows={3}
              style={{ width: '100%', padding: 10, fontSize: 14, border: `1px solid ${theme.border}`, borderRadius: 12, fontFamily: 'inherit' }}
            />
            <button
              type="submit"
              disabled={submitting}
              style={{ marginTop: 10, padding: '9px 18px', background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 13 }}
            >
              {submitting ? 'Posting...' : 'Post Review'}
            </button>
          </form>
        ) : (
          <p style={{ color: theme.textLight, fontSize: 13, marginBottom: 18 }}>
            <Link to="/login" style={{ color: theme.tealDeep, fontWeight: 700 }}>Log in</Link> to leave a review.
          </p>
        )}

        {reviews.length === 0 && <p style={{ color: theme.textLight, fontSize: 13 }}>No reviews yet. Be the first!</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {reviews.map((r) => {
            const who = reviewers[r.user_id]
            const whoName = who?.full_name || who?.display_name || 'CareFind user'
            return (
              <div key={r.id} style={{ border: `1px solid ${theme.border}`, borderRadius: 14, padding: 13, background: theme.cardBg, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  {r.user_id ? (
                    <Link to={`/u/${r.user_id}`} style={{ fontSize: 13, fontWeight: 800, color: theme.navy, textDecoration: 'none' }}>
                      {whoName}{who?.is_verified && <span style={{ color: theme.tealDeep }}> ✓</span>}
                    </Link>
                  ) : (
                    <span style={{ fontSize: 13, fontWeight: 800, color: theme.navy }}>{whoName}</span>
                  )}
                  <span style={{ color: theme.warning, fontSize: 13 }}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                </div>
                {r.comment && <p style={{ margin: 0, fontSize: 13.5, color: theme.textMid, lineHeight: 1.5 }}>{r.comment}</p>}
                <p style={{ margin: '4px 0 0 0', fontSize: 10.5, color: theme.textLight }}>
                  {new Date(r.created_at).toLocaleDateString()}
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default BusinessProfile
