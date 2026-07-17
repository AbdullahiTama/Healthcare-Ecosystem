import { useEffect, useState, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import { useAuth } from './lib/AuthContext'
import { theme } from './lib/theme'
import BottomNav from './BottomNav.jsx'
import { notify } from './notify.js'
import { previewText, renderRichText } from './richText.jsx'
import { subscribe, checkAccess, cancelAutoRenew, coinsToNaira } from './subscriptions.js'

function PublicProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [profile, setProfile] = useState(null)
  const [posts, setPosts] = useState([])
  const [followerCount, setFollowerCount] = useState(0)
  const [postCount, setPostCount] = useState(0)
  const [isFollowing, setIsFollowing] = useState(false)
  const [loading, setLoading] = useState(true)

  // Stories for this profile
  const [userStories, setUserStories] = useState([])
  const [viewerIndex, setViewerIndex] = useState(null)
  const [progress, setProgress] = useState(0)
  const [activeTab, setActiveTab] = useState('posts')
  const [playlists, setPlaylists] = useState([])
  const [userReviews, setUserReviews] = useState([])
  const [reviewers, setReviewers] = useState({})
  const [myRating, setMyRating] = useState(5)
  const [myComment, setMyComment] = useState('')
  const [postingReview, setPostingReview] = useState(false)
  const [subActive, setSubActive] = useState(false)
  const [subInfo, setSubInfo] = useState(null)
  const [subscribing, setSubscribing] = useState(false)
  const [openPost, setOpenPost] = useState(null)
  const timerRef = useRef(null)
  const STORY_DURATION = 6000

  const visualThemes = {
    teal: 'linear-gradient(135deg, #0f766e, #134e4a)',
    sunset: 'linear-gradient(135deg, #f97316, #db2777)',
    ocean: 'linear-gradient(135deg, #0ea5e9, #1e3a8a)',
    purple: 'linear-gradient(135deg, #7c3aed, #4c1d95)',
    forest: 'linear-gradient(135deg, #16a34a, #14532d)',
  }

  useEffect(() => {
    async function load() {
      setLoading(true)

      const { data: profileData } = await supabase
        .from('profiles')
        .select('id, full_name, display_name, is_verified, verification_label, location, website, avatar_url, cover_url, subscription_price, bio')
        .eq('id', id)
        .maybeSingle()

      if (!profileData) {
        setLoading(false)
        return
      }

      setProfile(profileData)
      // Notify the profile owner of the view (once per session to avoid spam)
      if (user && user.id !== id) {
        const seenKey = `pv_${user.id}_${id}`
        if (!sessionStorage.getItem(seenKey)) {
          sessionStorage.setItem(seenKey, '1')
          notify({ recipientId: id, actorId: user.id, type: 'profile_view', message: 'viewed your profile', link: `/u/${user.id}` })
        }
      }

      const [postData, followerData, storyData, playlistData] = await Promise.all([
        supabase.from('posts').select('id, content, created_at, post_type, theme, image_url').eq('user_id', id).order('created_at', { ascending: false }).limit(60),
        supabase.from('follows').select('id', { count: 'exact', head: true }).eq('following_id', id),
        supabase.from('stories').select('id, title, body, image_url, bg_color, created_at').eq('user_id', id).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }),
        supabase.from('playlists').select('id, title, description, created_at').eq('owner_id', id).order('created_at', { ascending: false }),
      ])

      setPosts(postData.data || [])
      setFollowerCount(followerData.count || 0)
      setPostCount(postData.data?.length || 0)
      setUserStories(storyData.data || [])
      setPlaylists(playlistData.data || [])

      await loadUserReviews()
      await refreshAccess()

      if (user) {
        const { data: followData } = await supabase.from('follows').select('id').eq('follower_id', user.id).eq('following_id', id).maybeSingle()
        setIsFollowing(!!followData)
      }

      setLoading(false)
    }
    load()
  }, [id, user])

  async function refreshAccess() {
    if (!user || user.id === id) { setSubActive(false); return }
    const res = await checkAccess(user.id, id)
    setSubActive(!!res.active)
    setSubInfo(res.sub || null)
    if (res.renewed) console.log('subscription auto-renewed')
  }

  async function handleSubscribe(priceCoins) {
    if (!user) { navigate('/login'); return }
    const naira = coinsToNaira(priceCoins)
    if (!window.confirm(`Subscribe for ${priceCoins} \ud83e\ude99 (\u20a6${naira.toLocaleString()}) per month?\n\nThis renews automatically from your CareCoins wallet. You can cancel anytime.`)) return
    setSubscribing(true)
    const res = await subscribe(user.id, id, priceCoins)
    setSubscribing(false)
    if (res.insufficient) {
      if (window.confirm('Not enough CareCoins. Top up your wallet now?')) navigate('/wallet')
      return
    }
    if (res.error) { alert('Could not subscribe: ' + res.error); return }
    await refreshAccess()
    notify({ recipientId: id, actorId: user.id, type: 'gift', message: 'subscribed to your content \ud83d\udd13', link: `/u/${user.id}` })
    alert('Subscribed! You can now read all their subscriber-only content.')
  }

  async function handleCancelAutoRenew() {
    if (!window.confirm('Turn off auto-renew? You keep access until the current month ends.')) return
    await cancelAutoRenew(user.id, id)
    await refreshAccess()
  }

  async function loadUserReviews() {
    const { data } = await supabase
      .from('user_reviews')
      .select('id, rating, comment, created_at, user_id')
      .eq('subject_id', id)
      .order('created_at', { ascending: false })
    const rv = data || []
    setUserReviews(rv)

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
  }

  async function submitUserReview(e) {
    e.preventDefault()
    if (!user) { navigate('/login'); return }
    setPostingReview(true)
    const { error } = await supabase.from('user_reviews').insert({
      subject_id: id,
      user_id: user.id,
      rating: myRating,
      comment: myComment.trim() || null,
    })
    setPostingReview(false)
    if (error) { alert('Could not post review: ' + error.message); return }
    setMyRating(5)
    setMyComment('')
    loadUserReviews()
  }

  // Story viewer progress
  useEffect(() => {
    if (viewerIndex === null) return
    setProgress(0)
    const st = userStories[viewerIndex]
    if (st) supabase.rpc('increment_story_view', { story_id: st.id })
    const start = Date.now()
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - start
      const pct = Math.min(100, (elapsed / STORY_DURATION) * 100)
      setProgress(pct)
      if (pct >= 100) { clearInterval(timerRef.current); goNext() }
    }, 50)
    return () => clearInterval(timerRef.current)
  }, [viewerIndex])

  function closeViewer() { setViewerIndex(null); if (timerRef.current) clearInterval(timerRef.current) }
  function goNext() {
    setViewerIndex((prev) => (prev === null ? null : prev + 1 >= userStories.length ? null : prev + 1))
  }
  function goPrev() {
    setViewerIndex((prev) => (prev === null ? null : prev - 1 < 0 ? 0 : prev - 1))
  }

  async function toggleFollow() {
    if (!user) return
    if (isFollowing) {
      await supabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', id)
      setIsFollowing(false)
      setFollowerCount((n) => n - 1)
    } else {
      await supabase.from('follows').insert({ follower_id: user.id, following_id: id })
      setIsFollowing(true)
      setFollowerCount((n) => n + 1)
    }
  }

  function timeAgo(dateStr) {
    const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  }

  if (loading) return <div style={{ padding: 20, fontFamily: 'system-ui' }}>Loading...</div>

  if (!profile) {
    return (
      <div style={{ fontFamily: 'system-ui', maxWidth: 480, margin: '0 auto', paddingBottom: 90 }}>
        <div style={{ background: theme.heroGradient, padding: '22px 20px 26px 20px', borderRadius: '0 0 28px 28px', color: '#fff' }}>
          <Link to="/" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>← Feed</Link>
        </div>
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>👤</div>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: theme.navy, margin: '0 0 6px 0' }}>Profile not found</h3>
          <p style={{ fontSize: 13, color: theme.textLight }}>This user may have deleted their account.</p>
          <Link to="/" style={{ display: 'inline-block', marginTop: 16, padding: '10px 20px', background: theme.tealGradient, color: '#fff', borderRadius: 14, textDecoration: 'none', fontWeight: 700, fontSize: 13 }}>
            Back to Feed
          </Link>
        </div>
        <BottomNav />
      </div>
    )
  }

  const displayName = profile.full_name || profile.display_name || 'CareFind User'
  const isOwnProfile = user?.id === id
  const hasStory = userStories.length > 0

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 480, margin: '0 auto', paddingBottom: 90 }}>
      <div style={{ position: 'relative', marginBottom: 55 }}>
        <div style={{ height: 110, background: profile?.cover_url ? `url(${profile.cover_url}) center/cover` : theme.heroGradient, position: 'relative' }}>
          <Link to="/" style={{ position: 'absolute', top: 16, left: 16, color: 'rgba(255,255,255,0.8)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>← Feed</Link>
        </div>
        <div style={{ position: 'absolute', bottom: -46, left: 16 }}>
          {/* Avatar with optional story ring */}
          <div
            onClick={() => { if (hasStory) setViewerIndex(0) }}
            style={{
              width: 94, height: 94, borderRadius: '50%', padding: hasStory ? 4 : 0,
              background: hasStory ? `linear-gradient(135deg, ${theme.tealBright}, ${theme.tealDeep})` : 'transparent',
              cursor: hasStory ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <div style={{
              width: 86, height: 86, borderRadius: '50%',
              background: profile?.avatar_url ? `url(${profile.avatar_url}) center/cover` : theme.tealGradient,
              border: '4px solid #fff', boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 28, fontWeight: 800, boxSizing: 'border-box',
            }}>
              {!profile?.avatar_url && (displayName[0]?.toUpperCase() || '?')}
            </div>
          </div>
          {hasStory && (
            <span style={{ display: 'block', textAlign: 'center', fontSize: 10, fontWeight: 800, color: theme.tealDeep, marginTop: 2 }}>
              Tap to view story
            </span>
          )}
        </div>
        <div style={{ position: 'absolute', bottom: -40, right: 16 }}>
          {isOwnProfile ? (
            <Link to="/profile" style={{
              border: `1px solid ${theme.border}`, background: '#fff', color: theme.navy,
              borderRadius: 20, padding: '6px 16px', fontSize: 13, fontWeight: 700, textDecoration: 'none',
            }}>
              Edit Profile
            </Link>
          ) : user ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={toggleFollow} style={{
                background: isFollowing ? '#fff' : theme.tealGradient,
                color: isFollowing ? theme.navy : '#fff',
                border: `1px solid ${isFollowing ? theme.border : 'transparent'}`,
                borderRadius: 20, padding: '7px 18px', fontSize: 13, fontWeight: 700,
              }}>
                {isFollowing ? 'Following' : '+ Follow'}
              </button>

              {!(profile?.subscription_price > 0) && profile?.is_verified && (
                <span
                  style={{
                    background: theme.bg, color: theme.textLight,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 20, padding: '7px 14px', fontSize: 12, fontWeight: 700,
                    cursor: 'not-allowed', opacity: 0.75,
                  }}
                >
                  🔒 Not accepting subscriptions
                </span>
              )}

              {profile?.subscription_price > 0 && (
                subActive ? (
                  <button
                    onClick={handleCancelAutoRenew}
                    style={{
                      background: '#fff', color: theme.tealDeep, border: `1px solid ${theme.tealDeep}`,
                      borderRadius: 20, padding: '7px 14px', fontSize: 12.5, fontWeight: 800,
                    }}
                  >
                    ✓ Subscribed
                  </button>
                ) : (
                  <button
                    onClick={() => handleSubscribe(profile.subscription_price)}
                    disabled={subscribing}
                    style={{
                      background: theme.navy, color: '#fff', border: 'none',
                      borderRadius: 20, padding: '7px 14px', fontSize: 12.5, fontWeight: 800,
                    }}
                  >
                    {subscribing ? '…' : `🔒 Subscribe · ${profile.subscription_price} 🪙/mo`}
                  </button>
                )
              )}
            </div>
          ) : (
            <Link to="/login" style={{
              background: theme.tealGradient, color: '#fff', border: 'none',
              borderRadius: 20, padding: '7px 18px', fontSize: 13, fontWeight: 700, textDecoration: 'none',
            }}>
              + Follow
            </Link>
          )}
        </div>
      </div>

      <div style={{ padding: '0 16px 16px 16px' }}>
        <h1 style={{ fontSize: 20, fontWeight: 900, color: theme.navy, margin: '0 0 2px 0' }}>{displayName}</h1>
        {profile.display_name && <p style={{ margin: '0 0 6px 0', fontSize: 13, color: theme.textLight }}>@{profile.display_name}</p>}
        {profile.is_verified && (
          <span style={{ fontSize: 11, fontWeight: 800, color: theme.tealDeep, background: '#ecfdf5', padding: '2px 10px', borderRadius: 20, border: `1px solid ${theme.tealBright}`, display: 'inline-block', marginBottom: 8 }}>
            ✓ Verified {profile.verification_label}
          </span>
        )}
        {profile.bio && (
          <p style={{ margin: '10px 0 0 0', fontSize: 13.5, color: theme.textMid, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {profile.bio}
          </p>
        )}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12, marginTop: 8 }}>
          {profile.location && <span style={{ fontSize: 12.5, color: theme.textLight }}>📍 {profile.location}</span>}
          {profile.website && <a href={profile.website} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: theme.tealDeep, textDecoration: 'none' }}>🔗 {profile.website}</a>}
        </div>

        <div style={{ display: 'flex', gap: 20, borderTop: `1px solid ${theme.border}`, borderBottom: `1px solid ${theme.border}`, padding: '12px 0', marginBottom: 16 }}>
          <div>
            <p style={{ margin: 0, fontWeight: 900, fontSize: 16, color: theme.navy }}>{postCount}</p>
            <p style={{ margin: 0, fontSize: 11, color: theme.textLight, fontWeight: 600 }}>Posts</p>
          </div>
          <div>
            <p style={{ margin: 0, fontWeight: 900, fontSize: 16, color: theme.navy }}>{followerCount}</p>
            <p style={{ margin: 0, fontSize: 11, color: theme.textLight, fontWeight: 600 }}>Followers</p>
          </div>
          <button onClick={() => setActiveTab('reviews')} style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }}>
            <p style={{ margin: 0, fontWeight: 900, fontSize: 16, color: theme.navy }}>
              {userReviews.length ? (userReviews.reduce((s, r) => s + (r.rating || 0), 0) / userReviews.length).toFixed(1) : '—'}
              <span style={{ color: theme.warning, fontSize: 13 }}> ★</span>
            </p>
            <p style={{ margin: 0, fontSize: 11, color: theme.textLight, fontWeight: 600 }}>{userReviews.length} review{userReviews.length !== 1 ? 's' : ''}</p>
          </button>
        </div>

        {/* Content tabs */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${theme.border}`, marginBottom: 12, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {[['posts', '📝 Posts'], ['reposts', '🔁 Reposts'], ['playlists', '🎬 Playlists'], ['reviews', '⭐ Reviews']].map(([key, label]) => (
            <button key={key} onClick={() => setActiveTab(key)} style={{ flexShrink: 0, whiteSpace: 'nowrap', padding: '10px 12px', background: 'none', border: 'none', borderBottom: activeTab === key ? `2px solid ${theme.tealDeep}` : '2px solid transparent', color: activeTab === key ? theme.navy : theme.textLight, fontWeight: 800, fontSize: 12.5, cursor: 'pointer' }}>
              {label}
            </button>
          ))}
        </div>

        {/* Playlists tab */}
        {activeTab === 'playlists' && (
          playlists.length === 0
            ? <p style={{ textAlign: 'center', fontSize: 13, color: theme.textLight, padding: '20px 0' }}>No playlists yet.</p>
            : playlists.map(pl => (
                <Link key={pl.id} to={`/playlist/${pl.id}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: 12, marginBottom: 8, textDecoration: 'none' }}>
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: theme.heroGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>🎬</div>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: theme.navy }}>{pl.title}</p>
                    {pl.description && <p style={{ margin: '2px 0 0 0', fontSize: 11.5, color: theme.textLight, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pl.description}</p>}
                  </div>
                  <span style={{ color: theme.textLight }}>›</span>
                </Link>
              ))
        )}

        {/* Reviews tab — this person's aggregated review profile */}
        {activeTab === 'reviews' && (() => {
          const total = userReviews.length
          const avg = total ? (userReviews.reduce((s, r) => s + (r.rating || 0), 0) / total) : 0
          const breakdown = [5, 4, 3, 2, 1].map((n) => ({
            star: n,
            count: userReviews.filter((r) => r.rating === n).length,
            pct: total ? Math.round((userReviews.filter((r) => r.rating === n).length / total) * 100) : 0,
          }))
          return (
            <div>
              {total > 0 && (
                <div style={{ border: `1px solid ${theme.border}`, borderRadius: 16, padding: 14, background: theme.cardBg, marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <span style={{ fontSize: 28, fontWeight: 900, color: theme.navy }}>{avg.toFixed(1)}</span>
                    <div>
                      <p style={{ margin: 0, color: theme.warning, fontSize: 14 }}>{'★'.repeat(Math.round(avg))}{'☆'.repeat(5 - Math.round(avg))}</p>
                      <p style={{ margin: 0, fontSize: 11.5, color: theme.textLight }}>{total} review{total !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  {breakdown.map((b) => (
                    <div key={b.star} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                      <span style={{ fontSize: 11.5, color: theme.textMid, width: 12 }}>{b.star}</span>
                      <span style={{ fontSize: 11, color: theme.warning }}>★</span>
                      <div style={{ flex: 1, height: 6, background: theme.bg, borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ width: `${b.pct}%`, height: '100%', background: b.star >= 4 ? theme.success : b.star === 3 ? theme.warning : theme.alert, borderRadius: 4 }} />
                      </div>
                      <span style={{ fontSize: 11, color: theme.textLight, width: 24 }}>{b.count}</span>
                    </div>
                  ))}
                </div>
              )}

              {user && user.id !== id && (
                <form onSubmit={submitUserReview} style={{ border: `1px dashed ${theme.border}`, borderRadius: 14, padding: 14, marginBottom: 14 }}>
                  <p style={{ margin: '0 0 8px 0', fontSize: 13, fontWeight: 800, color: theme.navy }}>Leave a review</p>
                  <div style={{ marginBottom: 8 }}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button type="button" key={n} onClick={() => setMyRating(n)} style={{ background: 'none', border: 'none', fontSize: 22, color: n <= myRating ? theme.warning : '#ddd', padding: 0 }}>★</button>
                    ))}
                  </div>
                  <textarea
                    value={myComment}
                    onChange={(e) => setMyComment(e.target.value)}
                    placeholder="Share your experience with this person…"
                    rows={3}
                    style={{ width: '100%', padding: 10, fontSize: 14, border: `1px solid ${theme.border}`, borderRadius: 12, fontFamily: 'inherit', boxSizing: 'border-box', resize: 'none' }}
                  />
                  <button type="submit" disabled={postingReview} style={{ marginTop: 10, width: '100%', padding: 11, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 13 }}>
                    {postingReview ? 'Posting…' : 'Post Review'}
                  </button>
                </form>
              )}

              {total === 0 && <p style={{ textAlign: 'center', fontSize: 13, color: theme.textLight, padding: '20px 0' }}>No reviews yet.</p>}

              {userReviews.map((r) => {
                const who = reviewers[r.user_id]
                const whoName = who?.full_name || who?.display_name || 'CareFind user'
                return (
                  <div key={r.id} style={{ border: `1px solid ${theme.border}`, borderRadius: 14, padding: 13, background: theme.cardBg, marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <Link to={`/u/${r.user_id}`} style={{ fontSize: 13, fontWeight: 800, color: theme.navy, textDecoration: 'none' }}>
                        {whoName}{who?.is_verified && <span style={{ color: theme.tealDeep }}> ✓</span>}
                      </Link>
                      <span style={{ color: theme.warning, fontSize: 13 }}>{'★'.repeat(r.rating || 0)}{'☆'.repeat(5 - (r.rating || 0))}</span>
                    </div>
                    {r.comment && <p style={{ margin: 0, fontSize: 13.5, color: theme.textMid, lineHeight: 1.5 }}>{r.comment}</p>}
                    <p style={{ margin: '4px 0 0 0', fontSize: 10.5, color: theme.textLight }}>{new Date(r.created_at).toLocaleDateString()}</p>
                  </div>
                )
              })}
            </div>
          )
        })()}

        {/* Posts / Reposts grid */}
        {activeTab !== 'playlists' && activeTab !== 'reviews' && (() => {
          const list = activeTab === 'reposts'
            ? posts.filter(p => (p.content || '').startsWith('🔁'))
            : posts.filter(p => !(p.content || '').startsWith('🔁'))
          if (list.length === 0) return <p style={{ textAlign: 'center', fontSize: 13, color: theme.textLight, padding: '24px 0' }}>Nothing here yet.</p>
          const typeIcon = { question: '❓', review: '⭐', article: '📄', premium: '💎', visual: '🎨' }
          return (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {list.map(post => (
                <button key={post.id} onClick={() => setOpenPost(post)} style={{ textAlign: 'left', padding: 0, background: 'none', border: 'none', cursor: 'pointer' }}>
                  <div style={{ border: `1px solid ${theme.border}`, borderRadius: 12, overflow: 'hidden', background: theme.cardBg, height: 150, display: 'flex', flexDirection: 'column' }}>
                    {post.image_url ? (
                      <div style={{ height: 80, background: `url(${post.image_url}) center/cover` }} />
                    ) : (
                      <div style={{ height: 80, background: post.post_type === 'visual' ? (visualThemes[post.theme] || visualThemes.teal) : theme.heroGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>{typeIcon[post.post_type] || '💬'}</div>
                    )}
                    <div style={{ padding: '8px 10px', flex: 1, overflow: 'hidden' }}>
                      {post.post_type && post.post_type !== 'text' && <span style={{ fontSize: 9, fontWeight: 800, color: theme.tealDeep, textTransform: 'uppercase' }}>{typeIcon[post.post_type]} {post.post_type}</span>}
                      <p style={{ margin: '2px 0 0 0', fontSize: 11.5, color: theme.navy, lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{previewText((post.content || '').replace(/^🔁\s*/, ''))}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )
        })()}
      </div>

      {/* Expanded post */}
      {openPost && (
        <div onClick={() => setOpenPost(null)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 18, width: '100%', maxWidth: 440, maxHeight: '80vh', overflowY: 'auto', padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setOpenPost(null)} style={{ background: 'none', border: 'none', fontSize: 22, color: theme.textLight }}>✕</button>
            </div>
            {openPost.image_url && <img src={openPost.image_url} alt="" style={{ width: '100%', borderRadius: 12, marginBottom: 12, display: 'block' }} />}
            {openPost.post_type === 'visual' && !openPost.image_url && (
              <div style={{ background: visualThemes[openPost.theme] || visualThemes.teal, padding: 22, borderRadius: 12, marginBottom: 12 }}>
                <p style={{ color: '#fff', fontSize: 16, fontWeight: 800, textAlign: 'center', margin: 0, whiteSpace: 'pre-wrap' }}>{openPost.content}</p>
              </div>
            )}
            {openPost.post_type !== 'visual' && <p style={{ margin: 0, fontSize: 15, color: theme.navy, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{renderRichText(previewText((openPost.content || '').replace(/^🔁\s*/, '')))}</p>}
            <p style={{ margin: '12px 0 0 0', fontSize: 11, color: theme.textLight }}>{openPost.created_at ? timeAgo(openPost.created_at) : ''}</p>
          </div>
        </div>
      )}

      {/* Story viewer */}
      {viewerIndex !== null && userStories[viewerIndex] && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#000', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', gap: 4, padding: '10px 10px 0' }}>
            {userStories.map((_, i) => (
              <div key={i} style={{ flex: 1, height: 3, borderRadius: 3, background: 'rgba(255,255,255,0.3)', overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 3, background: '#fff', width: i < viewerIndex ? '100%' : i === viewerIndex ? `${progress}%` : '0%', transition: i === viewerIndex ? 'width 0.05s linear' : 'none' }} />
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: theme.tealGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: 14 }}>
              {displayName[0]?.toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, color: '#fff', fontSize: 13, fontWeight: 800 }}>{displayName}</p>
              <p style={{ margin: 0, color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>{timeAgo(userStories[viewerIndex].created_at)}</p>
            </div>
            <button onClick={closeViewer} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 26, lineHeight: 1, padding: '0 6px' }}>✕</button>
          </div>

          <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div onClick={goPrev} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '35%', zIndex: 2 }} />
            <div onClick={goNext} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '35%', zIndex: 2 }} />

            {userStories[viewerIndex].image_url ? (
              <div style={{ width: '100%', height: '100%', background: `url(${userStories[viewerIndex].image_url})`, backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }} />
            ) : (
              <div style={{ width: '100%', height: '100%', background: userStories[viewerIndex].bg_color || theme.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 30, boxSizing: 'border-box' }}>
                <div style={{ textAlign: 'center', maxWidth: 340 }}>
                  {userStories[viewerIndex].title && <h2 style={{ color: '#fff', fontSize: 26, fontWeight: 900, margin: '0 0 14px 0', lineHeight: 1.2 }}>{userStories[viewerIndex].title}</h2>}
                  {userStories[viewerIndex].body && <p style={{ color: 'rgba(255,255,255,0.92)', fontSize: 17, lineHeight: 1.5, margin: 0, whiteSpace: 'pre-wrap' }}>{userStories[viewerIndex].body}</p>}
                </div>
              </div>
            )}

            {userStories[viewerIndex].image_url && (userStories[viewerIndex].title || userStories[viewerIndex].body) && (
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 3, padding: '40px 20px 24px', background: 'linear-gradient(transparent, rgba(0,0,0,0.75))' }}>
                {userStories[viewerIndex].title && <h2 style={{ color: '#fff', fontSize: 20, fontWeight: 900, margin: '0 0 6px 0' }}>{userStories[viewerIndex].title}</h2>}
                {userStories[viewerIndex].body && <p style={{ color: 'rgba(255,255,255,0.92)', fontSize: 14, lineHeight: 1.5, margin: 0, whiteSpace: 'pre-wrap' }}>{userStories[viewerIndex].body}</p>}
              </div>
            )}
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  )
}

export default PublicProfile
