import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import { useAuth } from './lib/AuthContext'
import { theme } from './lib/theme'
import BottomNav from './BottomNav.jsx'

function ProfessionalDashboard() {
  const { user, loading: authLoading } = useAuth()
  const [profile, setProfile] = useState(null)
  const [questionsAnswered, setQuestionsAnswered] = useState(0)
  const [followerCount, setFollowerCount] = useState(0)
  const [postCount, setPostCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      if (!user) {
        setLoading(false)
        return
      }
      setLoading(true)

      const [profileRes, commentsRes, followersRes, postsRes] = await Promise.all([
        supabase.from('profiles').select('display_name, avatar_url, is_verified, verification_label').eq('id', user.id).single(),
        supabase.from('post_comments').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('follows').select('id', { count: 'exact', head: true }).eq('following_id', user.id),
        supabase.from('posts').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      ])

      setProfile(profileRes.data)
      setQuestionsAnswered(commentsRes.count || 0)
      setFollowerCount(followersRes.count || 0)
      setPostCount(postsRes.count || 0)
      setLoading(false)
    }
    if (!authLoading) load()
  }, [user, authLoading])

  if (authLoading || loading) return <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif' }}>Loading...</div>

  if (!user) {
    return (
      <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif', maxWidth: 420, margin: '0 auto', textAlign: 'center' }}>
        <p style={{ color: theme.textMid }}>Log in to view your professional dashboard.</p>
        <Link to="/login" style={{ color: theme.tealDeep, fontWeight: 700 }}>Log In</Link>
      </div>
    )
  }

  if (!profile?.is_verified) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 420, margin: '0 auto', paddingBottom: 90 }}>
        <div style={{ background: theme.heroGradient, padding: '22px 20px 26px 20px', borderRadius: '0 0 28px 28px', color: '#fff' }}>
          <Link to="/profile" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>← Profile</Link>
          <h1 style={{ fontSize: 21, fontWeight: 900, margin: '14px 0 4px 0' }}>Professional Dashboard</h1>
        </div>
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, background: '#fef3c7', display: 'flex',
            alignItems: 'center', justifyContent: 'center', fontSize: 26, margin: '0 auto 14px auto',
          }}>
            🩺
          </div>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: theme.navy, margin: '0 0 4px 0' }}>Verification required</h3>
          <p style={{ fontSize: 13, color: theme.textLight, margin: '0 0 16px 0' }}>
            This dashboard unlocks once you're a verified healthcare professional
          </p>
          <Link to="/verify" style={{
            display: 'inline-block', padding: '10px 20px', background: theme.tealGradient, color: '#fff',
            borderRadius: 14, textDecoration: 'none', fontWeight: 700, fontSize: 13,
          }}>
            Get Verified
          </Link>
        </div>
        <BottomNav />
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 480, margin: '0 auto', paddingBottom: 90 }}>
      <div style={{ background: theme.heroGradient, padding: '22px 20px 26px 20px', borderRadius: '0 0 28px 28px', color: '#fff' }}>
        <Link to="/profile" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>← Profile</Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, marginBottom: 16 }}>
          <h1 style={{ fontSize: 19, fontWeight: 900, margin: 0 }}>{profile.display_name || 'Professional'}</h1>
          <span style={{
            width: 16, height: 16, borderRadius: '50%', background: theme.tealBright, color: theme.navy,
            fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900,
          }}>
            ✓
          </span>
        </div>
        <p style={{ margin: '-12px 0 16px 0', fontSize: 12.5, color: 'rgba(255,255,255,0.6)' }}>
          {profile.verification_label || 'Verified Professional'}
        </p>

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1, background: 'rgba(255,255,255,0.12)', borderRadius: 14, padding: '12px 10px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>{followerCount}</p>
            <p style={{ margin: 0, fontSize: 10.5, color: 'rgba(255,255,255,0.65)', fontWeight: 700 }}>Followers</p>
          </div>
          <div style={{ flex: 1, background: 'rgba(255,255,255,0.12)', borderRadius: 14, padding: '12px 10px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>{postCount}</p>
            <p style={{ margin: 0, fontSize: 10.5, color: 'rgba(255,255,255,0.65)', fontWeight: 700 }}>Posts</p>
          </div>
          <div style={{ flex: 1, background: 'rgba(255,255,255,0.12)', borderRadius: 14, padding: '12px 10px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>{questionsAnswered}</p>
            <p style={{ margin: 0, fontSize: 10.5, color: 'rgba(255,255,255,0.65)', fontWeight: 700 }}>Answers Given</p>
          </div>
        </div>
      </div>

      <div style={{ padding: '20px 20px 0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Link to="/earn" style={{ textDecoration: 'none' }}>
          <div style={{ border: `1px solid ${theme.tealBright}`, borderRadius: 16, padding: 14, display: 'flex', alignItems: 'center', gap: 12, background: '#ecfdf5', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
            <span style={{ width: 34, height: 34, borderRadius: 10, background: theme.tealGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>💰</span>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: 13.5, color: theme.tealDeep, fontWeight: 800 }}>Earn on CareFind</p>
              <p style={{ margin: 0, fontSize: 11, color: theme.tealDeep }}>Subscriptions, consultations & tasks</p>
            </div>
            <span style={{ color: theme.tealDeep, fontSize: 16 }}>›</span>
          </div>
        </Link>

        {[
          { icon: '👥', label: 'Invite Staff/Assistant', desc: 'Coming in a future update' },
        ].map((item) => (
          <div key={item.label} style={{
            border: `1px solid ${theme.border}`, borderRadius: 16, padding: 14, display: 'flex',
            alignItems: 'center', gap: 12, background: theme.cardBg, boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
          }}>
            <span style={{ width: 34, height: 34, borderRadius: 10, background: theme.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
              {item.icon}
            </span>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: 13.5, color: theme.textMid, fontWeight: 600 }}>{item.label}</p>
              <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>{item.desc}</p>
            </div>
            <span style={{ fontSize: 10, fontWeight: 800, color: theme.textLight, background: theme.bg, padding: '3px 8px', borderRadius: 10, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Soon</span>
          </div>
        ))}
      </div>

      <BottomNav />
    </div>
  )
}

export default ProfessionalDashboard
