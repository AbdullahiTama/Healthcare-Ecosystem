import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import { useAuth } from './lib/AuthContext'
import { theme } from './lib/theme'
import { renderArticleHtml } from './lib/articleFormat'
import BottomNav from './BottomNav.jsx'

function SavedPosts() {
  const { user, loading: authLoading } = useAuth()
  const [posts, setPosts] = useState([])
  const [profiles, setProfiles] = useState({})
  const [loading, setLoading] = useState(true)

  const visualThemes = {
    teal: 'linear-gradient(135deg, #0f766e, #134e4a)',
    sunset: 'linear-gradient(135deg, #f97316, #db2777)',
    ocean: 'linear-gradient(135deg, #0ea5e9, #1e3a8a)',
    purple: 'linear-gradient(135deg, #7c3aed, #4c1d95)',
    forest: 'linear-gradient(135deg, #16a34a, #14532d)',
  }

  useEffect(() => {
    async function load() {
      if (!user) {
        setLoading(false)
        return
      }
      setLoading(true)

      const { data: savedData } = await supabase
        .from('saved_posts')
        .select('post_id, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      const postIds = (savedData || []).map((s) => s.post_id)
      if (postIds.length === 0) {
        setPosts([])
        setLoading(false)
        return
      }

      const { data: postData } = await supabase
        .from('posts')
        .select('id, content, created_at, user_id, post_type, theme')
        .in('id', postIds)

      const ordered = postIds.map((id) => (postData || []).find((p) => p.id === id)).filter(Boolean)
      setPosts(ordered)

      const userIds = [...new Set(ordered.map((p) => p.user_id))]
      const { data: profileData } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', userIds)
      const profileMap = {}
      ;(profileData || []).forEach((p) => { profileMap[p.id] = p })
      setProfiles(profileMap)

      setLoading(false)
    }
    if (!authLoading) load()
  }, [user, authLoading])

  if (authLoading || loading) return <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif' }}>Loading...</div>

  if (!user) {
    return (
      <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif', maxWidth: 420, margin: '0 auto', textAlign: 'center' }}>
        <p style={{ color: theme.textMid }}>Log in to see your saved posts.</p>
        <Link to="/login" style={{ color: theme.tealDeep, fontWeight: 700 }}>Log In</Link>
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 480, margin: '0 auto', paddingBottom: 90 }}>
      <div style={{
        background: theme.heroGradient, padding: '22px 20px 26px 20px',
        borderRadius: '0 0 28px 28px', color: '#fff',
      }}>
        <Link to="/profile" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>← Profile</Link>
        <h1 style={{ fontSize: 22, fontWeight: 900, margin: '14px 0 4px 0' }}>Saved Posts</h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', margin: 0 }}>
          {posts.length} post{posts.length !== 1 ? 's' : ''} saved
        </p>
      </div>

      <div style={{ padding: '20px 20px 0 20px' }}>
        {posts.length === 0 && (
          <div style={{ textAlign: 'center', padding: '30px 10px' }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16, background: '#ecfdf5', display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 26, margin: '0 auto 14px auto',
            }}>
              🔖
            </div>
            <h3 style={{ fontSize: 15, fontWeight: 800, color: theme.navy, margin: '0 0 4px 0' }}>No saved posts yet</h3>
            <p style={{ fontSize: 13, color: theme.textLight, margin: 0 }}>Tap Save on any post in the feed to keep it here</p>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {posts.map((post) => (
            <div key={post.id} style={{
              border: `1px solid ${theme.border}`, borderRadius: 16, padding: post.post_type === 'visual' ? 0 : 14,
              overflow: 'hidden', background: theme.cardBg, boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: post.post_type === 'visual' ? '12px 14px 0 14px' : 0, marginBottom: post.post_type === 'visual' ? 0 : 8 }}>
                <Link to={`/u/${post.user_id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
                  <div style={{
                    width: 30, height: 30, borderRadius: '50%',
                    background: profiles[post.user_id]?.avatar_url ? `url(${profiles[post.user_id].avatar_url})` : theme.tealGradient,
                    backgroundSize: 'cover', backgroundPosition: 'center', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 800,
                  }}>
                    {!profiles[post.user_id]?.avatar_url && (profiles[post.user_id]?.display_name?.[0]?.toUpperCase() || '?')}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: theme.navy }}>
                    {profiles[post.user_id]?.display_name || 'CareFind User'}
                  </span>
                </Link>
              </div>

              {post.post_type === 'visual' ? (
                <div style={{ background: visualThemes[post.theme] || visualThemes.teal, padding: 24, minHeight: 110, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <p style={{ color: '#fff', fontSize: 17, fontWeight: 800, textAlign: 'center', margin: 0, whiteSpace: 'pre-wrap' }}>
                    {post.content}
                  </p>
                </div>
              ) : post.post_type === 'article' ? (
                <div
                  style={{ fontSize: 14, color: theme.textDark, lineHeight: 1.7, fontFamily: 'Georgia, serif' }}
                  dangerouslySetInnerHTML={{ __html: renderArticleHtml(post.content) }}
                />
              ) : (
                <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 14, color: theme.textMid, lineHeight: 1.5 }}>{post.content}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      <BottomNav />
    </div>
  )
}

export default SavedPosts
