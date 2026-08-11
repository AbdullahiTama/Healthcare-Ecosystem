import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { useAuth } from '../../providers/AuthContext'
import { BadgeCheck, UserX, X } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Avatar, Empty, Toast, useToast } from '../../components/ui'

// Bottom sheet listing a profile's followers or following. Privacy: profiles
// with show_followers = false do not appear in the list unless the viewer is
// the profile owner (who always sees their own lists).
function FollowersSheet({ profileId, kind, count, onClose, onCountChange }) {
  const { user } = useAuth()
  const [people, setPeople] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [followingMap, setFollowingMap] = useState({})
  const [busyId, setBusyId] = useState(null)
  const { msg: toastMsg, type: toastType, actionLabel: toastActionLabel, onAction: toastOnAction, show: showToast } = useToast()

  const isOwner = user?.id === profileId

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true); setError('')
      try {
        const isFollowers = kind === 'followers'
        let q = supabase
          .from('follows')
          .select(
            isFollowers
              ? 'follower_id, follower:follower_id(id, full_name, display_name, is_verified, avatar_url, show_followers)'
              : 'following_id, following:following_id(id, full_name, display_name, is_verified, avatar_url, show_followers)'
          )
          .eq(isFollowers ? 'following_id' : 'follower_id', profileId)
          .order('created_at', { ascending: false })
          .limit(200)
        const { data, error: err } = await q
        if (err) throw err

        let list = (data || [])
          .map((r) => (isFollowers ? r.follower : r.following))
          .filter(Boolean)
        if (!isOwner) list = list.filter((p) => p.show_followers !== false)

        if (active) setPeople(list)

        // Which of these do I already follow?
        if (user && !isOwner) {
          const ids = list.map((p) => p.id)
          if (ids.length) {
            const { data: myFollows } = await supabase.from('follows').select('following_id').eq('follower_id', user.id).in('following_id', ids)
            const map = {}
            ;(myFollows || []).forEach((f) => { map[f.following_id] = true })
            if (active) setFollowingMap(map)
          }
        }
      } catch (e) {
        if (active) setError('Could not load this list. Please try again.')
      }
      if (active) setLoading(false)
    }
    load()
    return () => { active = false }
  }, [profileId, kind, user, isOwner])

  async function toggleFollow(targetId) {
    if (!user) return
    setBusyId(targetId)
    const currentlyFollowing = !!followingMap[targetId]
    if (currentlyFollowing) {
      const { error: err } = await supabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', targetId)
      if (!err) {
        setFollowingMap((m) => { const n = { ...m }; delete n[targetId]; return n })
        if (onCountChange) onCountChange(-1)
      } else showToast('Could not unfollow: ' + err.message, { type: 'error' })
    } else {
      const { error: err } = await supabase.from('follows').insert({ follower_id: user.id, following_id: targetId })
      if (!err) {
        setFollowingMap((m) => ({ ...m, [targetId]: true }))
        if (onCountChange) onCountChange(1)
      } else showToast('Could not follow: ' + err.message, { type: 'error' })
    }
    setBusyId(null)
  }

  const title = kind === 'followers' ? 'Followers' : 'Following'

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${title} list`} style={{ background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, maxHeight: '75vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px 10px', borderBottom: `1px solid ${theme.border}` }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: theme.navy }}>{title} <span style={{ fontWeight: 600, color: theme.textLight, fontSize: 13 }}>({count})</span></h3>
          <button onClick={onClose} aria-label="Close" style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', color: theme.gray400, cursor: 'pointer' }}><X size={20} aria-hidden="true" /></button>
        </div>

        <div style={{ overflowY: 'auto', padding: '12px 16px 20px' }}>
          {loading && (
            <div role="status" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Loading {title.toLowerCase()}</span>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 42, height: 42, borderRadius: '50%', background: theme.bg }} />
                  <div style={{ flex: 1, height: 14, borderRadius: 6, background: theme.bg }} />
                </div>
              ))}
            </div>
          )}

          {!loading && error && <p style={{ fontSize: 13, color: theme.alert, textAlign: 'center', padding: '24px 0' }}>{error}</p>}

          {!loading && !error && people.length === 0 && (
            <Empty icon={<UserX size={40} color={theme.gray300} strokeWidth={1.5} />} message={kind === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'} />
          )}

          {!loading && !error && people.map((p) => {
            const isMe = user?.id === p.id
            const following = !!followingMap[p.id]
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0' }}>
                <Link to={`/u/${p.id}`} onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, textDecoration: 'none', minWidth: 0 }}>
                  <Avatar name={p.full_name || p.display_name} src={p.avatar_url} size={42} />
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 5, fontSize: 13.5, fontWeight: 800, color: theme.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.full_name || p.display_name || 'CareFind user'}
                      {p.is_verified && <BadgeCheck size={14} color={theme.tealDeep} aria-label="Verified" />}
                    </p>
                    {p.display_name && p.full_name && <p style={{ margin: 0, fontSize: 11.5, color: theme.textLight }}>@{p.display_name}</p>}
                  </div>
                </Link>
                {user && !isMe && kind === 'followers' && (
                  <button
                    onClick={() => toggleFollow(p.id)}
                    disabled={busyId === p.id}
                    style={{
                      flexShrink: 0, padding: '6px 14px', borderRadius: 20, border: 'none',
                      fontSize: 12, fontWeight: 800, cursor: 'pointer', minHeight: 36,
                      background: following ? theme.bg : theme.tealDeep,
                      color: following ? theme.textMid : '#fff',
                    }}
                  >
                    {busyId === p.id ? '…' : following ? 'Following' : 'Follow'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <Toast msg={toastMsg} type={toastType} actionLabel={toastActionLabel} onAction={toastOnAction} />
    </div>
  )
}

export default FollowersSheet
