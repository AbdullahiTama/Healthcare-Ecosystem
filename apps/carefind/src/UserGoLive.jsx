import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import { useAuth } from './lib/AuthContext'
import { theme } from './lib/theme'

// Full user Go Live: go live now, invite co-hosts, or schedule an upcoming
// show with an optional trailer. Mirrors the admin's Go Live features.
// Creates shows in the live_shows system so all engagement features work.
function UserGoLive({ onClose }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState('now') // 'now' | 'schedule'
  const [title, setTitle] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [trailerFile, setTrailerFile] = useState(null)
  const [guestSearch, setGuestSearch] = useState('')
  const [guestResults, setGuestResults] = useState([])
  const [guests, setGuests] = useState([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  async function searchGuests(q) {
    setGuestSearch(q)
    if (q.trim().length < 2) { setGuestResults([]); return }
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, display_name, is_verified')
      .or(`full_name.ilike.%${q}%,display_name.ilike.%${q}%`)
      .limit(6)
    setGuestResults((data || []).filter(p => p.id !== user.id))
  }

  function toggleGuest(p) {
    setGuests(prev => prev.some(g => g.id === p.id) ? prev.filter(g => g.id !== p.id) : [...prev, p])
  }

  async function inviteGuests(showId, showTitle) {
    for (const g of guests) {
      await supabase.from('live_participants').insert({ show_id: showId, user_id: g.id, role: 'guest' })
      await supabase.from('notifications').insert({
        recipient_id: g.id, type: 'live_invite',
        message: `invited you to co-host a live: "${showTitle}"`,
        link: `/live-dashboard/${showId}`,
      })
    }
  }

  async function uploadTrailer() {
    if (!trailerFile) return null
    const ext = trailerFile.name.split('.').pop() || 'mp4'
    const path = `trailer-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('live-media').upload(path, trailerFile, { contentType: trailerFile.type || 'video/mp4' })
    if (upErr) return null
    const { data: urlData } = supabase.storage.from('live-media').getPublicUrl(path)
    return urlData.publicUrl
  }

  async function goLiveNow() {
    if (!title.trim()) { setError('Give your show a title.'); return }
    setCreating(true); setError('')
    const { data: show, error: insErr } = await supabase.from('live_shows').insert({
      title: title.trim(), status: 'live', host_id: user.id, is_platform: false,
      started_at: new Date().toISOString(),
    }).select().maybeSingle()
    if (insErr || !show) { setError('Could not start: ' + (insErr?.message || 'unknown')); setCreating(false); return }
    await supabase.from('live_participants').insert({ show_id: show.id, user_id: user.id, role: 'host', joined: true })
    await inviteGuests(show.id, show.title)
    setCreating(false)
    onClose && onClose()
    navigate(`/live-dashboard/${show.id}`)
  }

  async function scheduleShow() {
    if (!title.trim()) { setError('Give your show a title.'); return }
    if (!scheduledAt) { setError('Pick a date & time.'); return }
    setCreating(true); setError('')
    const trailerUrl = await uploadTrailer()
    const { data: show, error: insErr } = await supabase.from('live_shows').insert({
      title: title.trim(), status: 'scheduled', host_id: user.id, is_platform: false,
      scheduled_at: new Date(scheduledAt).toISOString(), trailer_url: trailerUrl,
    }).select().maybeSingle()
    if (insErr || !show) { setError('Could not schedule: ' + (insErr?.message || 'unknown')); setCreating(false); return }
    await inviteGuests(show.id, show.title)
    setCreating(false)
    onClose && onClose()
    alert('Show scheduled! Your audience will see a countdown. Start it from your live dashboard when ready.')
    navigate(`/live-dashboard/${show.id}`)
  }

  const inputStyle = { width: '100%', padding: '12px 14px', fontSize: 15, border: `1px solid ${theme.border}`, borderRadius: 12, boxSizing: 'border-box', fontFamily: 'inherit' }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '22px 22px 0 0', width: '100%', maxWidth: 480, maxHeight: '88vh', overflowY: 'auto', padding: 22, boxSizing: 'border-box' }}>
        <div style={{ width: 40, height: 4, background: theme.border, borderRadius: 2, margin: '0 auto 18px' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#dc2626' }} />
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, color: theme.navy }}>Go Live</h2>
        </div>

        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button onClick={() => setMode('now')} style={{ flex: 1, padding: 10, borderRadius: 10, border: 'none', fontWeight: 800, fontSize: 13, background: mode === 'now' ? '#dc2626' : theme.bg, color: mode === 'now' ? '#fff' : theme.textMid }}>🔴 Go Live Now</button>
          <button onClick={() => setMode('schedule')} style={{ flex: 1, padding: 10, borderRadius: 10, border: 'none', fontWeight: 800, fontSize: 13, background: mode === 'schedule' ? theme.navy : theme.bg, color: mode === 'schedule' ? '#fff' : theme.textMid }}>📅 Schedule</button>
        </div>

        {error && <p style={{ margin: '0 0 10px 0', fontSize: 12.5, color: theme.alert, fontWeight: 600 }}>{error}</p>}

        {/* Title */}
        <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: theme.textMid, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Show title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Managing Diabetes: Live Q&A" style={{ ...inputStyle, marginBottom: 16 }} />

        {/* Schedule fields */}
        {mode === 'schedule' && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: theme.textMid, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Date & time</label>
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }} />
            <label style={{ display: 'block', fontSize: 12.5, color: theme.tealDeep, fontWeight: 700, cursor: 'pointer' }}>
              🎬 {trailerFile ? trailerFile.name.slice(0, 26) : 'Add trailer video (optional)'}
              <input type="file" accept="video/*" onChange={(e) => setTrailerFile(e.target.files[0] || null)} style={{ display: 'none' }} />
            </label>
          </div>
        )}

        {/* Invite co-hosts */}
        <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: theme.textMid, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Invite co-hosts (optional)</label>
        <input value={guestSearch} onChange={(e) => searchGuests(e.target.value)} placeholder="Search people by name…" style={{ ...inputStyle, marginBottom: 8 }} />
        {guests.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {guests.map(g => (
              <span key={g.id} onClick={() => toggleGuest(g)} style={{ fontSize: 12, fontWeight: 700, background: theme.tealGradient, color: '#fff', padding: '4px 10px', borderRadius: 14, cursor: 'pointer' }}>
                {g.full_name || g.display_name} ✕
              </span>
            ))}
          </div>
        )}
        {guestResults.length > 0 && (
          <div style={{ border: `1px solid ${theme.border}`, borderRadius: 10, marginBottom: 16, overflow: 'hidden' }}>
            {guestResults.map(p => {
              const picked = guests.some(g => g.id === p.id)
              return (
                <button key={p.id} onClick={() => toggleGuest(p)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: picked ? theme.bg : '#fff', border: 'none', borderBottom: `1px solid ${theme.border}`, cursor: 'pointer' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: theme.navy }}>{p.full_name || p.display_name}{p.is_verified && <span style={{ color: theme.tealDeep }}> ✓</span>}</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: picked ? theme.tealDeep : theme.textLight }}>{picked ? '✓ Added' : '+ Add'}</span>
                </button>
              )
            })}
          </div>
        )}

        {/* Action */}
        {mode === 'now' ? (
          <button onClick={goLiveNow} disabled={creating} style={{ width: '100%', padding: 14, background: '#dc2626', color: '#fff', border: 'none', borderRadius: 14, fontWeight: 800, fontSize: 15 }}>
            {creating ? 'Starting…' : '🔴 Go Live Now'}
          </button>
        ) : (
          <button onClick={scheduleShow} disabled={creating} style={{ width: '100%', padding: 14, background: theme.navy, color: '#fff', border: 'none', borderRadius: 14, fontWeight: 800, fontSize: 15 }}>
            {creating ? 'Scheduling…' : '📅 Schedule Show'}
          </button>
        )}
        <button onClick={onClose} style={{ display: 'block', margin: '12px auto 0', background: 'none', border: 'none', color: theme.textLight, fontSize: 13, fontWeight: 600 }}>Cancel</button>
      </div>
    </div>
  )
}

export default UserGoLive
