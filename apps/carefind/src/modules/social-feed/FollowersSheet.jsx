import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { useAuth } from '../../providers/AuthContext'
import { UserX, X } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Avatar, Empty, Toast, useToast } from '../../components/ui'
import StoryAvatar from '../../components/StoryAvatar.jsx'
import StoryViewer from './components/StoryViewer.jsx'
import VerifiedBadge from '../../components/VerifiedBadge.jsx'
import { fetchFollowList } from './followers'
import { fetchViewedStoryIds, markStoriesViewed } from './storyViews.js'

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
  const [stories, setStories] = useState([])
  const [viewedIds, setViewedIds] = useState(() => new Set())
  const [viewer, setViewer] = useState(null)
  const { msg: toastMsg, type: toastType, actionLabel: toastActionLabel, onAction: toastOnAction, show: showToast } = useToast()

  const isOwner = user?.id === profileId

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true); setError('')
      try {
        const isFollowers = kind === 'followers'
        const { data, error: err } = await fetchFollowList({ supabase, profileId, kind })
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

        // Batch stories for all people in sheet (avoid N+1 per avatar)
        const userIds = list.map((p) => p.id)
        if (userIds.length) {
          const { data: storyRows } = await supabase.from('stories').select('id, user_id, expires_at').in('user_id', userIds).gt('expires_at', new Date().toISOString())
          const s = storyRows || []
          if (active) setStories(s)
          if (s.length && user?.id) {
            const seen = await fetchViewedStoryIds(supabase, s.map((x) => x.id))
            if (active) setViewedIds(seen)
          }
        } else {
          if (active) setStories([])
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

  async function openStoryForUser(targetId) {
    const { data } = await supabase.from('stories').select('id, title, body, image_url, bg_color, created_at, user_id, view_count, is_platform, expires_at').eq('user_id', targetId).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false })
    const list = data || []
    if (!list.length) return
    setViewer({ stories: list, index: 0, userId: targetId })
  }

  function handleViewStory(st) {
    supabase.rpc('increment_story_view', { story_id: st.id }).catch(() => {})
    if (user?.id) {
      markStoriesViewed(supabase, { storyIds: [st.id], userId: user.id }).catch(() => {})
      setViewedIds((prev) => {
        if (prev.has(st.id)) return prev
        const next = new Set(prev); next.add(st.id); return next
      })
    }
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
                  <StoryAvatar userId={p.id} stories={stories} viewedIds={viewedIds} size={42} src={p.avatar_url} name={p.full_name || p.display_name} onClick={() => openStoryForUser(p.id)} />
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 5, fontSize: 13.5, fontWeight: 800, color: theme.navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.full_name || p.display_name || 'CareFind user'}
                      {<VerifiedBadge profile={p} size={14} />}
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
      {viewer && (
        <StoryViewer stories={viewer.stories} index={viewer.index} onNavigate={(n) => setViewer((prev) => n === null || n < 0 || n >= prev.stories.length ? null : { ...prev, index: n })} onClose={() => setViewer(null)} onViewStory={handleViewStory} renderHeader={(s) => (
          <>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: theme.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 900, fontSize: 14 }}>{(people.find((pp) => pp.id === viewer.userId)?.full_name?.[0] || '?').toUpperCase()}</div>
            <div style={{ flex: 1 }}><p style={{ margin: 0, color: '#fff', fontSize: 13, fontWeight: 800 }}>{people.find((pp) => pp.id === viewer.userId)?.full_name || people.find((pp) => pp.id === viewer.userId)?.display_name || 'User'}</p><p style={{ margin: 0, color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>{new Date(s.created_at).toLocaleDateString()}</p></div>
          </>
        )} />
      )}
      <Toast msg={toastMsg} type={toastType} actionLabel={toastActionLabel} onAction={toastOnAction} />
    </div>
  )
}

export default FollowersSheet
