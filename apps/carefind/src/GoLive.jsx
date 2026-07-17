import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import { useAuth } from './lib/AuthContext'
import { theme } from './lib/theme'

export default function GoLive({ onClose }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [topic, setTopic] = useState('')
  const [description, setDescription] = useState('')
  const [starting, setStarting] = useState(false)

  async function startLive() {
    if (!topic.trim()) return
    setStarting(true)
    const { data, error } = await supabase.from('live_sessions').insert({
      host_id: user.id,
      topic: topic.trim(),
      description: description.trim(),
      status: 'live',
      board_strokes: [],
      likes: 0,
      started_at: new Date().toISOString(),
    }).select().single()

    if (error) { alert('Could not start session'); setStarting(false); return }

    // Post to feed so followers see it
    await supabase.from('posts').insert({
      user_id: user.id,
      content: `🔴 LIVE NOW: ${topic.trim()}${description ? '\n' + description.trim() : ''}\n\nJoin here 👇`,
      post_type: 'text',
      live_session_id: data.id,
    })

    onClose()
    navigate(`/live/${data.id}`)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', fontFamily: 'system-ui' }}>
      <div style={{ width: '100%', maxWidth: 480, background: '#fff', borderRadius: '24px 24px 0 0', padding: '20px 20px 40px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: theme.navy }}>🔴 Go Live</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: theme.textLight }}>✕</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: theme.textLight, display: 'block', marginBottom: 4 }}>Session Topic *</label>
            <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Ask me about hypertension medications"
              style={{ width: '100%', padding: 12, fontSize: 14, border: `1px solid ${theme.border}`, borderRadius: 12, boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: theme.textLight, display: 'block', marginBottom: 4 }}>Description (optional)</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What will you cover in this session?"
              rows={2} style={{ width: '100%', padding: 12, fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: 12, fontFamily: 'inherit', boxSizing: 'border-box', resize: 'none' }} />
          </div>
        </div>

        <div style={{ background: '#ecfdf5', borderRadius: 12, padding: 12, marginBottom: 16 }}>
          <p style={{ margin: 0, fontSize: 12, color: theme.tealDeep, lineHeight: 1.5 }}>
            🎨 <strong>Shared drawing board</strong> — viewers see you draw in real time<br/>
            🎙️ <strong>Voice notes</strong> — record and send audio messages<br/>
            🎁 <strong>Gifts</strong> — viewers can send CareCoins during your session<br/>
            💬 <strong>Live chat</strong> — questions and answers in real time
          </p>
        </div>

        <button onClick={startLive} disabled={!topic.trim() || starting}
          style={{ width: '100%', padding: 15, background: theme.alert, color: '#fff', border: 'none', borderRadius: 14, fontWeight: 900, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {starting ? 'Starting...' : '🔴 Start Live Session'}
        </button>
      </div>
    </div>
  )
}
