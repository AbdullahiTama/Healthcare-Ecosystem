import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import { useAuth } from './lib/AuthContext'
import { theme } from './lib/theme'
import BottomNav from './BottomNav.jsx'
import { renderRichText } from './richText.jsx'

// Watch a playlist: a list of parts, tap to view; an "Up next" prompt to continue.
function PlaylistView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [playlist, setPlaylist] = useState(null)
  const [parts, setParts] = useState([])
  const [current, setCurrent] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [id])

  async function load() {
    setLoading(true)
    const { data: pl } = await supabase.from('playlists').select('*, profiles:owner_id(full_name, display_name, is_verified)').eq('id', id).maybeSingle()
    const { data: pts } = await supabase.from('playlist_parts').select('*').eq('playlist_id', id).order('position', { ascending: true })
    setPlaylist(pl)
    setParts(pts || [])
    setLoading(false)
  }

  async function deletePart(partId) {
    if (!window.confirm('Delete this part? This cannot be undone.')) return
    await supabase.from('playlist_parts').delete().eq('id', partId)
    if (current >= parts.length - 1) setCurrent(Math.max(0, current - 1))
    load()
  }

  async function editPartTitle(part) {
    const newTitle = window.prompt('Edit part title:', part.title)
    if (newTitle == null || !newTitle.trim()) return
    await supabase.from('playlist_parts').update({ title: newTitle.trim() }).eq('id', part.id)
    load()
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: theme.textLight }}>Loading…</div>
  if (!playlist) return <div style={{ padding: 40, textAlign: 'center', color: theme.textLight }}>Playlist not found.</div>

  const part = parts[current]
  const hasNext = current < parts.length - 1

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 480, margin: '0 auto', paddingBottom: 90, background: '#fff', minHeight: '100vh' }}>
      <div style={{ background: theme.heroGradient, padding: '18px 16px', color: '#fff' }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: 700, marginBottom: 8 }}>← Back</button>
        <div style={{ display: 'inline-block', background: 'rgba(255,255,255,0.15)', padding: '3px 10px', borderRadius: 12, fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', marginBottom: 8 }}>🎬 PLAYLIST · {parts.length} PARTS</div>
        <h1 style={{ margin: 0, fontSize: 21, fontWeight: 900 }}>{playlist.title}</h1>
        <p style={{ margin: '4px 0 0 0', fontSize: 12.5, color: 'rgba(255,255,255,0.75)' }}>
          By {playlist.profiles?.full_name || playlist.profiles?.display_name || 'CareFind'}{playlist.profiles?.is_verified && ' ✓'}
        </p>
        {playlist.description && <p style={{ margin: '8px 0 0 0', fontSize: 13, color: 'rgba(255,255,255,0.85)', lineHeight: 1.4 }}>{playlist.description}</p>}
      </div>

      {/* Now playing */}
      {part && (
        <div style={{ padding: 18 }}>
          <p style={{ margin: '0 0 4px 0', fontSize: 11, fontWeight: 800, color: theme.tealDeep, textTransform: 'uppercase' }}>Part {current + 1} of {parts.length}</p>
          <h2 style={{ margin: '0 0 12px 0', fontSize: 18, fontWeight: 800, color: theme.navy }}>{part.title}</h2>
          {(part.kind === 'image' || part.kind === 'drawing') && part.media_url && <img src={part.media_url} alt="" style={{ width: '100%', borderRadius: 12, marginBottom: 12, display: 'block' }} />}
          {part.kind === 'video' && part.media_url && <video src={part.media_url} controls playsInline style={{ width: '100%', borderRadius: 12, marginBottom: 12, display: 'block' }} />}
          {(() => {
            // Visual and review store JSON in content
            if (part.kind === 'visual') {
              let d = {}; try { d = JSON.parse(part.content || '{}') } catch (e) { d = { text: part.content } }
              const themes = { teal: 'linear-gradient(135deg, #0d9488, #14b8a6)', ocean: 'linear-gradient(135deg, #0369a1, #0ea5e9)', night: 'linear-gradient(135deg, #1e293b, #334155)', forest: 'linear-gradient(135deg, #166534, #22c55e)', pulse: 'linear-gradient(135deg, #be185d, #f43f5e)' }
              return <div style={{ background: themes[d.theme] || themes.teal, borderRadius: 12, padding: 26, marginBottom: 12 }}><p style={{ color: '#fff', fontSize: 18, fontWeight: 800, textAlign: 'center', margin: 0, whiteSpace: 'pre-wrap' }}>{d.text}</p></div>
            }
            if (part.kind === 'review') {
              let d = {}; try { d = JSON.parse(part.content || '{}') } catch (e) { d = { text: part.content, rating: 0 } }
              return <div><p style={{ fontSize: 22, margin: '0 0 8px 0' }}>{'⭐'.repeat(d.rating || 0)}{'☆'.repeat(5 - (d.rating || 0))}</p><p style={{ margin: 0, fontSize: 15, color: theme.navy, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{d.text}</p></div>
            }
            if (part.content) return <p style={{ margin: 0, fontSize: 15, color: theme.navy, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{renderRichText(part.content)}</p>
            return null
          })()}

          {/* Up next */}
          {hasNext ? (
            <button onClick={() => setCurrent(current + 1)} style={{ width: '100%', marginTop: 20, padding: 14, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 14, fontWeight: 800, fontSize: 14, textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>▶️ Up next: {parts[current + 1].title}</span>
              <span>→</span>
            </button>
          ) : (
            <p style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: theme.textLight, fontWeight: 600 }}>🎉 You've finished this series!</p>
          )}
        </div>
      )}

      {/* All parts list */}
      <div style={{ padding: '0 18px 18px' }}>
        <p style={{ margin: '0 0 10px 0', fontSize: 12, fontWeight: 800, color: theme.navy, textTransform: 'uppercase', letterSpacing: '0.04em' }}>All parts</p>
        {user && playlist.owner_id === user.id && (
          <Link to={`/playlist/${id}/add`} style={{ display: 'block', textAlign: 'center', padding: 11, background: theme.tealGradient, color: '#fff', borderRadius: 10, fontWeight: 800, fontSize: 13, textDecoration: 'none', marginBottom: 10 }}>
            ➕ Add another part
          </Link>
        )}
        {parts.map((p, i) => {
          const isOwner = user && playlist.owner_id === user.id
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <button onClick={() => setCurrent(i)} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', background: i === current ? theme.bg : '#fff', border: `1px solid ${theme.border}`, borderRadius: 10, textAlign: 'left', cursor: 'pointer' }}>
                <span style={{ width: 28, height: 28, borderRadius: '50%', background: i === current ? theme.tealGradient : theme.bg, color: i === current ? '#fff' : theme.textMid, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>{i + 1}</span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: theme.navy, flex: 1 }}>{p.title}</span>
                {p.kind !== 'text' && <span style={{ fontSize: 14 }}>{p.kind === 'video' ? '🎥' : p.kind === 'drawing' ? '✏️' : p.kind === 'image' ? '🖼' : ''}</span>}
              </button>
              {isOwner && (
                <>
                  <button onClick={() => navigate(`/playlist/${id}/edit/${p.id}`)} style={{ background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 8, padding: '8px 9px', fontSize: 13 }}>✏️</button>
                  <button onClick={() => deletePart(p.id)} style={{ background: '#fef2f2', border: `1px solid ${theme.alert}`, borderRadius: 8, padding: '8px 9px', fontSize: 13 }}>🗑</button>
                </>
              )}
            </div>
          )
        })}
      </div>

      <BottomNav />
    </div>
  )
}

export default PlaylistView
