import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Bookmark } from 'lucide-react'
import { supabase } from '../../config/supabaseClient'
import { useAuth } from '../../providers/AuthContext'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useHeaderIdentity } from '../../hooks/useHeaderIdentity'
import AppShell from '../../components/layout/AppShell.jsx'
import { renderArticleHtml } from '../news-publishing/articleFormat'
import { renderMarkdown } from './markdown.jsx'
import BottomNav from '../../components/BottomNav.jsx'
import { Avatar, Card, CardSkeleton, Empty } from '../../components/ui'
import VerifiedBadge from '../../components/VerifiedBadge.jsx'

function SavedPosts() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const { isMobile } = useBreakpoint()
  const { myUsername, myAvatar, unreadNotifs } = useHeaderIdentity(user)
  const [posts, setPosts] = useState([])
  const [profiles, setProfiles] = useState({})
  const [loading, setLoading] = useState(true)

  const visualThemes = {
    teal: 'linear-gradient(135deg, #0E6F5A, #0B4A3E)',
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
        .select('id, display_name, full_name, is_verified, specialty, verification_label, avatar_url')
        .in('id', userIds)
      const profileMap = {}
      ;(profileData || []).forEach((p) => { profileMap[p.id] = p })
      setProfiles(profileMap)

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

  function authorName(post) {
    const p = profiles[post.user_id]
    return p?.full_name || p?.display_name || 'CareFind user'
  }

  function inShell(content) {
    if (isMobile) return content
    return (
      <AppShell user={user} myUsername={myUsername} myAvatar={myAvatar} unreadNotifs={unreadNotifs}>
        {content}
      </AppShell>
    )
  }

  if (authLoading || loading) {
    return inShell(
      <div role="status" aria-live="polite" style={{ maxWidth: isMobile ? 480 : 640, margin: '0 auto', padding: isMobile ? '20px 16px 90px' : 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Loading saved posts</span>
        <CardSkeleton />
        <CardSkeleton />
      </div>
    )
  }

  if (!user) {
    return inShell(
      <div style={{ maxWidth: isMobile ? 480 : 640, margin: '0 auto', padding: isMobile ? '20px 16px 90px' : 0 }}>
        <Empty
          icon={<Bookmark size={44} color={theme.gray300} strokeWidth={1.5} />}
          message={
            <>
              <div style={{ fontSize: 15, fontWeight: 800, color: theme.navy, marginBottom: 4 }}>Log in to see your saved posts</div>
              <div style={{ fontSize: 13, color: theme.gray500 }}>Anything you save from the feed is kept here.</div>
            </>
          }
          action="Log in"
          onAction={() => navigate('/login')}
        />
      </div>
    )
  }

  const bodyContent = (
    <div style={isMobile
      ? { fontFamily: theme.fontFamily, maxWidth: 480, margin: '0 auto', paddingBottom: 'calc(90px + env(safe-area-inset-bottom))' }
      : { fontFamily: theme.fontFamily, maxWidth: 640, margin: '0 auto' }}>
      <div style={{
        background: theme.navy, color: '#fff',
        ...(isMobile ? { padding: '22px 20px 26px 20px', borderRadius: '0 0 28px 28px' } : { padding: '22px 26px', borderRadius: theme.radius.xl, marginBottom: 20 }),
      }}>
        {isMobile && (
          <Link to="/profile" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
            <ArrowLeft size={15} aria-hidden="true" /> Profile
          </Link>
        )}
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 22, fontWeight: 900, margin: isMobile ? '14px 0 4px 0' : '0 0 4px 0' }}>
          <Bookmark size={21} aria-hidden="true" /> Saved posts
        </h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', margin: 0 }}>
          {posts.length} post{posts.length !== 1 ? 's' : ''} saved
        </p>
      </div>

      <div style={isMobile ? { padding: '20px 16px 0' } : {}}>
        {posts.length === 0 && (
          <Empty
            icon={<Bookmark size={44} color={theme.gray300} strokeWidth={1.5} />}
            message={
              <>
                <div style={{ fontSize: 15, fontWeight: 800, color: theme.navy, marginBottom: 4 }}>No saved posts yet</div>
                <div style={{ fontSize: 13, color: theme.gray500 }}>Save any post from the feed to keep it here.</div>
              </>
            }
            action="Go to the feed"
            onAction={() => navigate('/feed')}
          />
        )}

        <div style={isMobile
          ? { display: 'flex', flexDirection: 'column', gap: 12 }
          : { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {posts.map((post) => (
            <Card key={post.id} style={{ padding: post.post_type === 'visual' ? 0 : 16, overflow: 'hidden' }}>
              {/* Same identity order as the feed's post card: who, then
                  whether they're verified, then when. */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: post.post_type === 'visual' ? '14px 16px 0 16px' : 0,
                marginBottom: post.post_type === 'visual' ? 0 : 10,
              }}>
                <Link to={`/u/${post.user_id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', minWidth: 0 }}>
                  <Avatar name={authorName(post)} src={profiles[post.user_id]?.avatar_url} size={34} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 800, color: theme.navy }}>{authorName(post)}</span>
                      {<VerifiedBadge profile={profiles[post.user_id]} size={14} />}
                    </span>
                    <span style={{ display: 'block', fontSize: 11.5, color: theme.gray400, fontWeight: 600 }}>
                      <time dateTime={post.created_at}>{timeAgo(post.created_at)}</time>
                    </span>
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
                  style={{ fontSize: 14, color: theme.textMid, lineHeight: 1.7, fontFamily: theme.fontFamily }}
                  dangerouslySetInnerHTML={{ __html: renderArticleHtml(post.content) }}
                />
              ) : (
                <div style={{ margin: 0, fontSize: 14.5, color: theme.textMid, lineHeight: 1.6 }}>{renderMarkdown(post.content)}</div>
              )}
            </Card>
          ))}
        </div>
      </div>

      {isMobile && <BottomNav />}
    </div>
  )

  return inShell(bodyContent)
}

export default SavedPosts
