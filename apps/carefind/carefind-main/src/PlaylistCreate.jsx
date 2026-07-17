import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import { useAuth } from './lib/AuthContext'
import { theme } from './lib/theme'
import BottomNav from './BottomNav.jsx'
import DrawingBoard from './DrawingBoard.jsx'
import { RichTextInput } from './richText.jsx'

const VISUAL_THEMES = {
  teal: 'linear-gradient(135deg, #0d9488, #14b8a6)',
  ocean: 'linear-gradient(135deg, #0369a1, #0ea5e9)',
  night: 'linear-gradient(135deg, #1e293b, #334155)',
  forest: 'linear-gradient(135deg, #166534, #22c55e)',
  pulse: 'linear-gradient(135deg, #be185d, #f43f5e)',
}

// Create a playlist, then add rich parts one by one.
// Part types: text, visual, question, review, article, image, video, drawing.
function PlaylistCreate() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { id: existingId, partId: editPartId } = useParams()
  const [step, setStep] = useState(existingId ? 'parts' : 'info')
  const [editingId, setEditingId] = useState(editPartId || null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [playlistId, setPlaylistId] = useState(existingId || null)
  const [parts, setParts] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Draft part
  const [pTitle, setPTitle] = useState('')
  const [pKind, setPKind] = useState('text')
  const [pText, setPText] = useState('')
  const [pTheme, setPTheme] = useState('teal')
  const [pRating, setPRating] = useState(5)
  const [pFile, setPFile] = useState(null)
  const [drawBlob, setDrawBlob] = useState(null)
  const [showDraw, setShowDraw] = useState(false)
  const [addingPart, setAddingPart] = useState(false)

  useEffect(() => {
    if (existingId) {
      supabase.from('playlist_parts').select('id, title, kind, position').eq('playlist_id', existingId).order('position', { ascending: true }).then(({ data }) => {
        if (data) setParts(data)
      })
    }
    if (editPartId) {
      supabase.from('playlist_parts').select('*').eq('id', editPartId).maybeSingle().then(({ data }) => {
        if (data) {
          setPTitle(data.title || '')
          setPKind(data.kind || 'text')
          // Unpack visual/review JSON content
          if (data.kind === 'visual') {
            try { const d = JSON.parse(data.content || '{}'); setPText(d.text || ''); setPTheme(d.theme || 'teal') } catch (e) { setPText(data.content || '') }
          } else if (data.kind === 'review') {
            try { const d = JSON.parse(data.content || '{}'); setPText(d.text || ''); setPRating(d.rating || 5) } catch (e) { setPText(data.content || '') }
          } else {
            setPText(data.content || '')
          }
        }
      })
    }
  }, [existingId, editPartId])

  const KINDS = [
    ['text', '📝 Text'], ['visual', '🎨 Visual'], ['question', '❓ Question'],
    ['review', '⭐ Review'], ['article', '📄 Article'], ['image', '🖼 Image'],
    ['video', '🎥 Video'], ['drawing', '✏️ Drawing'],
  ]

  async function createPlaylist() {
    if (!title.trim()) { setError('Give your playlist a title.'); return }
    setSaving(true); setError('')
    const { data, error: insErr } = await supabase.from('playlists').insert({
      owner_id: user.id, title: title.trim(), description: description.trim() || null,
    }).select().maybeSingle()
    if (insErr || !data) { setError('Could not create: ' + (insErr?.message || 'unknown')); setSaving(false); return }
    setPlaylistId(data.id)
    setStep('parts')
    setSaving(false)
  }

  function resetDraft() {
    setPTitle(''); setPText(''); setPFile(null); setDrawBlob(null)
    setPKind('text'); setPTheme('teal'); setPRating(5)
  }

  async function addPart() {
    if (!pTitle.trim()) { setError('Give this part a title.'); return }
    setAddingPart(true); setError('')
    let mediaUrl = null
    // Upload media for image/video/drawing
    let uploadBlob = null, ext = 'jpg', ctype = 'image/jpeg'
    if (pKind === 'image' && pFile) { uploadBlob = pFile; ext = pFile.name.split('.').pop() || 'jpg'; ctype = pFile.type }
    else if (pKind === 'video' && pFile) { uploadBlob = pFile; ext = pFile.name.split('.').pop() || 'mp4'; ctype = pFile.type }
    else if (pKind === 'drawing' && drawBlob) { uploadBlob = drawBlob; ext = 'png'; ctype = 'image/png' }
    if (uploadBlob) {
      const path = `playlist-${playlistId}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('live-media').upload(path, uploadBlob, { contentType: ctype })
      if (upErr) { setError('Media upload failed: ' + upErr.message); setAddingPart(false); return }
      const { data: urlData } = supabase.storage.from('live-media').getPublicUrl(path)
      mediaUrl = urlData.publicUrl
    }
    // Store extra styling in content as a JSON prefix for visual/review, else plain text
    let content = pText.trim() || null
    if (pKind === 'visual') content = JSON.stringify({ theme: pTheme, text: pText.trim() })
    if (pKind === 'review') content = JSON.stringify({ rating: pRating, text: pText.trim() })

    if (editingId) {
      // EDIT existing part
      const updates = { title: pTitle.trim(), kind: pKind, content }
      if (mediaUrl) updates.media_url = mediaUrl // only replace media if new one uploaded
      const { error: upErr2 } = await supabase.from('playlist_parts').update(updates).eq('id', editingId)
      if (upErr2) { setError('Could not save: ' + upErr2.message); setAddingPart(false); return }
      setAddingPart(false)
      navigate(`/playlist/${existingId || playlistId}`)
      return
    }

    const { data, error: insErr } = await supabase.from('playlist_parts').insert({
      playlist_id: playlistId, position: parts.length, title: pTitle.trim(),
      kind: pKind, content, media_url: mediaUrl,
    }).select().maybeSingle()
    if (insErr) { setError('Could not add part: ' + insErr.message); setAddingPart(false); return }
    setParts(prev => [...prev, data])
    resetDraft()
    setAddingPart(false)
  }

  const inputStyle = { width: '100%', padding: '12px 14px', fontSize: 15, border: `1px solid ${theme.border}`, borderRadius: 12, boxSizing: 'border-box', fontFamily: 'inherit' }

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 480, margin: '0 auto', paddingBottom: 90, background: '#fff', minHeight: '100vh' }}>
      <div style={{ background: theme.heroGradient, padding: '18px 16px', color: '#fff' }}>
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: 700, marginBottom: 8 }}>← Back</button>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>🎬 Create Playlist</h1>
        <p style={{ margin: '4px 0 0 0', fontSize: 12.5, color: 'rgba(255,255,255,0.7)' }}>Build a series part by part.</p>
      </div>

      <div style={{ padding: 18 }}>
        {error && <p style={{ margin: '0 0 10px 0', fontSize: 12.5, color: theme.alert, fontWeight: 600 }}>{error}</p>}

        {step === 'info' && (
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: theme.textMid, marginBottom: 6, textTransform: 'uppercase' }}>Playlist title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Understanding Diabetes (Series)" style={{ ...inputStyle, marginBottom: 14 }} />
            <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: theme.textMid, marginBottom: 6, textTransform: 'uppercase' }}>Description (optional)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this series about?" rows={3} style={{ ...inputStyle, marginBottom: 18, resize: 'none' }} />
            <button onClick={createPlaylist} disabled={saving} style={{ width: '100%', padding: 14, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 14, fontWeight: 800, fontSize: 15 }}>
              {saving ? 'Creating…' : 'Create & Add Parts →'}
            </button>
          </div>
        )}

        {step === 'parts' && (
          <div>
            {!editingId && parts.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <p style={{ margin: '0 0 8px 0', fontSize: 12, fontWeight: 800, color: theme.navy }}>{parts.length} part{parts.length !== 1 ? 's' : ''} added</p>
                {parts.map((p, i) => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: theme.bg, borderRadius: 10, marginBottom: 6 }}>
                    <span style={{ width: 24, height: 24, borderRadius: '50%', background: theme.tealGradient, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{i + 1}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: theme.navy }}>{p.title}</span>
                    <span style={{ fontSize: 10, color: theme.textLight, marginLeft: 'auto' }}>{p.kind}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ border: `1px dashed ${theme.border}`, borderRadius: 14, padding: 14, marginBottom: 18 }}>
              <p style={{ margin: '0 0 10px 0', fontSize: 13, fontWeight: 800, color: theme.navy }}>{editingId ? '✏️ Edit Part' : `➕ Add Part ${parts.length + 1}`}</p>
              <input value={pTitle} onChange={(e) => setPTitle(e.target.value)} placeholder="Part title (e.g. What is insulin?)" style={{ ...inputStyle, marginBottom: 10 }} />

              {/* Kind picker */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {KINDS.map(([k, label]) => (
                  <button key={k} onClick={() => setPKind(k)} style={{ padding: '6px 10px', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 11.5, background: pKind === k ? theme.tealDeep : theme.bg, color: pKind === k ? '#fff' : theme.textMid }}>{label}</button>
                ))}
              </div>

              {/* Type-specific inputs */}
              {pKind === 'visual' && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ background: VISUAL_THEMES[pTheme], borderRadius: 12, padding: 20, marginBottom: 8 }}>
                    <p style={{ color: '#fff', fontSize: 16, fontWeight: 800, textAlign: 'center', margin: 0, whiteSpace: 'pre-wrap' }}>{pText || 'Your visual text…'}</p>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {Object.keys(VISUAL_THEMES).map(t => (
                      <button key={t} onClick={() => setPTheme(t)} style={{ width: 30, height: 30, borderRadius: '50%', background: VISUAL_THEMES[t], border: pTheme === t ? `3px solid ${theme.navy}` : 'none' }} />
                    ))}
                  </div>
                </div>
              )}

              {pKind === 'review' && (
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  {[1, 2, 3, 4, 5].map(n => (
                    <button key={n} onClick={() => setPRating(n)} style={{ background: 'none', border: 'none', fontSize: 26, cursor: 'pointer' }}>{n <= pRating ? '⭐' : '☆'}</button>
                  ))}
                </div>
              )}

              {(pKind === 'image' || pKind === 'video') && (
                <label style={{ display: 'block', fontSize: 12.5, color: theme.tealDeep, fontWeight: 700, cursor: 'pointer', marginBottom: 10 }}>
                  📎 {pFile ? pFile.name.slice(0, 26) : `Choose ${pKind} file`}
                  <input type="file" accept={pKind === 'image' ? 'image/*' : 'video/*'} onChange={(e) => setPFile(e.target.files[0] || null)} style={{ display: 'none' }} />
                </label>
              )}

              {pKind === 'drawing' && (
                <div style={{ marginBottom: 10 }}>
                  {drawBlob ? (
                    <div>
                      <img src={URL.createObjectURL(drawBlob)} alt="drawing" style={{ width: '100%', maxWidth: 200, borderRadius: 10, border: `1px solid ${theme.border}`, display: 'block', marginBottom: 6 }} />
                      <button onClick={() => setShowDraw(true)} style={{ fontSize: 12, color: theme.tealDeep, background: 'none', border: 'none', fontWeight: 700 }}>Redraw</button>
                    </div>
                  ) : (
                    <button onClick={() => setShowDraw(true)} style={{ padding: '10px 16px', background: theme.bg, color: theme.navy, border: `1px solid ${theme.border}`, borderRadius: 10, fontWeight: 700, fontSize: 13 }}>✏️ Open drawing board</button>
                  )}
                </div>
              )}

              {/* Text / caption — shown for all except pure media without caption need */}
              {pKind !== 'drawing' && (
                (pKind === 'text' || pKind === 'article')
                  ? <div style={{ marginBottom: 10 }}><RichTextInput value={pText} onChange={setPText} placeholder="Write this part… (select text to highlight)" rows={pKind === 'article' ? 6 : 3} /></div>
                  : <textarea value={pText} onChange={(e) => setPText(e.target.value)} placeholder={pKind === 'visual' ? 'Text for the visual card…' : 'Caption (optional)'} rows={3} style={{ ...inputStyle, marginBottom: 10, resize: 'none' }} />
              )}

              <button onClick={addPart} disabled={addingPart} style={{ width: '100%', padding: 11, background: theme.navy, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13 }}>
                {addingPart ? (editingId ? 'Saving…' : 'Adding…') : (editingId ? '✓ Save Changes' : '+ Add this part')}
              </button>
            </div>

            {!editingId && (
              <button onClick={() => navigate(`/playlist/${playlistId}`)} disabled={parts.length === 0} style={{ width: '100%', padding: 14, background: parts.length === 0 ? theme.border : theme.tealGradient, color: '#fff', border: 'none', borderRadius: 14, fontWeight: 800, fontSize: 15 }}>
                {parts.length === 0 ? 'Add at least one part' : '✓ Done — View Playlist'}
              </button>
            )}
          </div>
        )}
      </div>

      {showDraw && (
        <DrawingBoard
          onSave={(blob) => { setDrawBlob(blob); setShowDraw(false) }}
          onCancel={() => setShowDraw(false)}
        />
      )}

      <BottomNav />
    </div>
  )
}

export default PlaylistCreate
