import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import { useAuth } from './lib/AuthContext'
import { theme } from './lib/theme'
import BottomNav from './BottomNav.jsx'

function Dashboard() {
  const { user, loading: authLoading } = useAuth()
  const [myPosts, setMyPosts] = useState([])
  const [myReviews, setMyReviews] = useState([])
  const [savedCount, setSavedCount] = useState(0)
  const [followingCount, setFollowingCount] = useState(0)
  const [verification, setVerification] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('posts')

  useEffect(() => {
    async function load() {
      if (!user) {
        setLoading(false)
        return
      }
      setLoading(true)

      const [postsRes, reviewsRes, savedRes, followRes, verifyRes] = await Promise.all([
        supabase.from('posts').select('id, content, created_at, post_type').eq('user_id', user.id).order('created_at', { ascending: false }),
        supabase.from('reviews').select('id, rating, comment, created_at, business_id, businesses(name)').eq('user_id', user.id).order('created_at', { ascending: false }),
        supabase.from('saved_posts').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('follows').select('id', { count: 'exact', head: true }).eq('follower_id', user.id),
        supabase.from('verification_requests').select('status').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ])

      setMyPosts(postsRes.data || [])
      setMyReviews(reviewsRes.data || [])
      setSavedCount(savedRes.count || 0)
      setFollowingCount(followRes.count || 0)
      setVerification(verifyRes.data)
      setLoading(false)
    }
    if (!authLoading) load()
  }, [user, authLoading])

  function timeAgo(dateStr) {
    const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  }

  if (authLoading || loading) return <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif' }}>Loading...</div>

  if (!user) {
    return (
      <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif', maxWidth: 420, margin: '0 auto', textAlign: 'center' }}>
        <p style={{ color: theme.textMid }}>Log in to see your dashboard.</p>
        <Link to="/login" style={{ color: theme.tealDeep, fontWeight: 700 }}>Log In</Link>
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 480, margin: '0 auto', paddingBottom: 90 }}>
      <div style={{ background: theme.heroGradient, padding: '22px 20px 26px 20px', borderRadius: '0 0 28px 28px', color: '#fff' }}>
        <Link to="/profile" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>← Profile</Link>
        <h1 style={{ fontSize: 21, fontWeight: 900, margin: '14px 0 16px 0' }}>My Activity</h1>

        <div style={{ display: 'flex', gap: 10 }}>
          <Link to="/saved" style={{ flex: 1, textDecoration: 'none' }}>
            <div style={{ background: 'rgba(255,255,255,0.12)', borderRadius: 14, padding: '12px 10px', textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>{savedCount}</p>
              <p style={{ margin: 0, fontSize: 10.5, color: 'rgba(255,255,255,0.65)', fontWeight: 700 }}>Saved</p>
            </div>
          </Link>
          <div style={{ flex: 1, background: 'rgba(255,255,255,0.12)', borderRadius: 14, padding: '12px 10px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>{myPosts.length}</p>
            <p style={{ margin: 0, fontSize: 10.5, color: 'rgba(255,255,255,0.65)', fontWeight: 700 }}>Posts</p>
          </div>
          <div style={{ flex: 1, background: 'rgba(255,255,255,0.12)', borderRadius: 14, padding: '12px 10px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>{followingCount}</p>
            <p style={{ margin: 0, fontSize: 10.5, color: 'rgba(255,255,255,0.65)', fontWeight: 700 }}>Following</p>
          </div>
        </div>
      </div>

      {verification && (
        <div style={{ padding: '16px 20px 0 20px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${theme.border}`,
            borderRadius: 14, padding: 12, background: theme.cardBg, boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
          }}>
            <span style={{ fontSize: 18 }}>
              {verification.status === 'approved' ? '✅' : verification.status === 'rejected' ? '❌' : '⏳'}
            </span>
            <span style={{ fontSize: 13, color: theme.textMid, fontWeight: 600 }}>
              Verification: <span style={{ textTransform: 'capitalize', fontWeight: 800, color: theme.navy }}>{verification.status}</span>
            </span>
          </div>
        </div>
      )}

      <div style={{ padding: '20px 20px 0 20px' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            onClick={() => setTab('posts')}
            style={{
              flex: 1, padding: 9, borderRadius: 12, border: tab === 'posts' ? 'none' : `1px solid ${theme.border}`,
              background: tab === 'posts' ? theme.tealGradient : theme.bg,
              color: tab === 'posts' ? '#fff' : theme.textMid, fontWeight: 700, fontSize: 13,
            }}
          >
            My Posts
          </button>
          <button
            onClick={() => setTab('reviews')}
            style={{
              flex: 1, padding: 9, borderRadius: 12, border: tab === 'reviews' ? 'none' : `1px solid ${theme.border}`,
              background: tab === 'reviews' ? theme.tealGradient : theme.bg,
              color: tab === 'reviews' ? '#fff' : theme.textMid, fontWeight: 700, fontSize: 13,
            }}
          >
            My Reviews
          </button>
        </div>

        {tab === 'posts' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {myPosts.length === 0 && <p style={{ color: theme.textLight, fontSize: 13 }}>You haven't posted anything yet.</p>}
            {myPosts.map((p) => (
              <div key={p.id} style={{ border: `1px solid ${theme.border}`, borderRadius: 14, padding: 13, background: theme.cardBg, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <span style={{
                  fontSize: 10, fontWeight: 800, color: theme.tealDeep, textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>
                  {p.post_type}
                </span>
                <p style={{ margin: '4px 0 6px 0', fontSize: 13.5, color: theme.textMid, lineHeight: 1.5 }}>
                  {p.content.length > 120 ? p.content.slice(0, 120) + '...' : p.content}
                </p>
                <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>{timeAgo(p.created_at)}</p>
              </div>
            ))}
          </div>
        )}

        {tab === 'reviews' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {myReviews.length === 0 && <p style={{ color: theme.textLight, fontSize: 13 }}>You haven't left any reviews yet.</p>}
            {myReviews.map((r) => (
              <div key={r.id} style={{ border: `1px solid ${theme.border}`, borderRadius: 14, padding: 13, background: theme.cardBg, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <p style={{ margin: '0 0 4px 0', fontWeight: 700, fontSize: 13.5, color: theme.navy }}>{r.businesses?.name}</p>
                <p style={{ margin: '0 0 4px 0', color: theme.warning, fontSize: 13 }}>
                  {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                </p>
                {r.comment && <p style={{ margin: '0 0 4px 0', fontSize: 13, color: theme.textMid }}>{r.comment}</p>}
                <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>{timeAgo(r.created_at)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  )
}

export default Dashboard
