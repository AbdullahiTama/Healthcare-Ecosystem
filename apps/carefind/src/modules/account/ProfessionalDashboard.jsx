import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { useAuth } from '../../providers/AuthContext'
import { BadgeCheck, ChevronRight, Stethoscope, Users, Wallet as WalletIcon } from 'lucide-react'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useHeaderIdentity } from '../../hooks/useHeaderIdentity'
import AppShell from '../../components/layout/AppShell.jsx'
import BottomNav from '../../components/BottomNav.jsx'
import { Loading } from '../../components/ui'

function ProfessionalDashboard() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const { isMobile } = useBreakpoint()
  const { myUsername, myAvatar, unreadNotifs } = useHeaderIdentity(user)
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

  if (authLoading || loading) return <Loading />

  if (!user) {
    return (
      <div style={{ padding: 20, fontFamily: theme.fontFamily, maxWidth: 420, margin: '0 auto', textAlign: 'center' }}>
        <p style={{ color: theme.textMid }}>Log in to view your professional dashboard.</p>
        <Link to="/login" style={{ color: theme.tealDeep, fontWeight: 700 }}>Log In</Link>
      </div>
    )
  }

  if (!profile?.is_verified) {
    const verifyRequiredContent = (
      <div style={isMobile ? { fontFamily: theme.fontFamily, maxWidth: 420, margin: '0 auto', paddingBottom: 90 } : { fontFamily: theme.fontFamily }}>
        <div style={{
          background: theme.navy, color: '#fff',
          ...(isMobile ? { padding: '22px 20px 26px 20px', borderRadius: '0 0 28px 28px' } : { padding: '22px 26px', borderRadius: theme.radius.xl }),
        }}>
          {isMobile && <Link to="/profile" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>â† Profile</Link>}
          <h1 style={{ fontSize: 21, fontWeight: 900, margin: isMobile ? '14px 0 4px 0' : 0 }}>Professional Dashboard</h1>
        </div>
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, background: theme.amberBg, display: 'flex',
            alignItems: 'center', justifyContent: 'center', fontSize: 26, margin: '0 auto 14px auto',
          }}>
            <Stethoscope size={28} aria-hidden="true" />
          </div>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: theme.navy, margin: '0 0 4px 0' }}>Verification required</h3>
          <p style={{ fontSize: 13, color: theme.textLight, margin: '0 0 16px 0' }}>
            This dashboard unlocks once you're a verified healthcare professional
          </p>
          <Link to="/verify" style={{
            display: 'inline-block', padding: '10px 20px', background: theme.tealDeep, color: '#fff',
            borderRadius: 14, textDecoration: 'none', fontWeight: 700, fontSize: 13,
          }}>
            Get Verified
          </Link>
        </div>
        {isMobile && <BottomNav />}
      </div>
    )

    if (isMobile) return verifyRequiredContent

    return (
      <AppShell user={user} myUsername={myUsername} myAvatar={myAvatar} unreadNotifs={unreadNotifs} onCompose={() => navigate('/feed')}>
        {verifyRequiredContent}
      </AppShell>
    )
  }

  const bodyContent = (
    <div style={isMobile
      ? { fontFamily: theme.fontFamily, maxWidth: 480, margin: '0 auto', paddingBottom: 90 }
      : { fontFamily: theme.fontFamily, maxWidth: 640, margin: '0 auto' }}>
      <div style={{
        background: theme.navy, color: '#fff',
        ...(isMobile ? { padding: '22px 20px 26px 20px', borderRadius: '0 0 28px 28px' } : { padding: '24px 26px', borderRadius: theme.radius.xl, marginBottom: 20 }),
      }}>
        {isMobile && <Link to="/profile" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>â† Profile</Link>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: isMobile ? 14 : 0, marginBottom: 16 }}>
          <h1 style={{ fontSize: 19, fontWeight: 900, margin: 0 }}>{profile.display_name || 'Professional'}</h1>
          <span style={{
            width: 16, height: 16, borderRadius: '50%', background: theme.tealBright, color: theme.navy,
            fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900,
          }}>
            <BadgeCheck size={18} aria-hidden="true" />
          </span>
        </div>
        <p style={{ margin: '-12px 0 16px 0', fontSize: 12.5, color: 'rgba(255,255,255,0.6)' }}>
          {profile.verification_label || 'Verified Professional'}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
          <div style={{ background: 'rgba(255,255,255,0.12)', borderRadius: 14, padding: '12px 10px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>{followerCount}</p>
            <p style={{ margin: 0, fontSize: 10.5, color: 'rgba(255,255,255,0.65)', fontWeight: 700 }}>Followers</p>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.12)', borderRadius: 14, padding: '12px 10px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>{postCount}</p>
            <p style={{ margin: 0, fontSize: 10.5, color: 'rgba(255,255,255,0.65)', fontWeight: 700 }}>Posts</p>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.12)', borderRadius: 14, padding: '12px 10px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>{questionsAnswered}</p>
            <p style={{ margin: 0, fontSize: 10.5, color: 'rgba(255,255,255,0.65)', fontWeight: 700 }}>Answers Given</p>
          </div>
        </div>
      </div>

      <div style={isMobile ? { padding: '20px 20px 0 20px', display: 'flex', flexDirection: 'column', gap: 10 } : { display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Link to="/earn" style={{ textDecoration: 'none' }}>
          <div style={{ border: `1px solid ${theme.tealDeep}`, borderRadius: 16, padding: 14, display: 'flex', alignItems: 'center', gap: 12, background: theme.tealMist, boxShadow: theme.elevation[1] }}>
            <span style={{ width: 34, height: 34, borderRadius: theme.radius.md, background: theme.tealMist, color: theme.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><WalletIcon size={17} aria-hidden="true" /></span>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: 13.5, color: theme.tealDeep, fontWeight: 800 }}>Earn on CareFind</p>
              <p style={{ margin: 0, fontSize: 11, color: theme.tealDeep }}>Subscriptions, consultations & tasks</p>
            </div>
            <ChevronRight size={17} color={theme.tealDeep} aria-hidden="true" />
          </div>
        </Link>

        {[
          { Icon: Users, label: 'Invite Staff/Assistant', desc: 'Coming in a future update' },
        ].map((item) => (
          <div key={item.label} style={{
            border: `1px solid ${theme.border}`, borderRadius: 16, padding: 14, display: 'flex',
            alignItems: 'center', gap: 12, background: theme.cardBg, boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
          }}>
            <span style={{ width: 34, height: 34, borderRadius: theme.radius.md, background: theme.gray50, color: theme.gray500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <item.Icon size={17} aria-hidden="true" />
            </span>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: 13.5, color: theme.textMid, fontWeight: 600 }}>{item.label}</p>
              <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>{item.desc}</p>
            </div>
            <span style={{ fontSize: 10, fontWeight: 800, color: theme.textLight, background: theme.bg, padding: '3px 8px', borderRadius: 10, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Soon</span>
          </div>
        ))}
      </div>

      {isMobile && <BottomNav />}
    </div>
  )

  if (isMobile) return bodyContent

  return (
    <AppShell user={user} myUsername={myUsername} myAvatar={myAvatar} unreadNotifs={unreadNotifs} onCompose={() => navigate('/feed')}>
      {bodyContent}
    </AppShell>
  )
}

export default ProfessionalDashboard
