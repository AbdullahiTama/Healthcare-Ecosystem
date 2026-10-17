import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../providers/AuthContext'
import { ensureProfile } from '../../services/ensureProfile.js'
import { Gift, MessageSquare, Mic, Palette, Radio, X } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Toast, useToast } from '../../components/ui'
import { postRepository } from './repositories'

// "What viewers can do" list. Each row is a real list item so a screen reader
// announces how many capabilities there are, instead of running the four
// sentences together inside one paragraph.
const featureRow = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  fontSize: 12.5,
  color: theme.navy,
  lineHeight: 1.5,
}

const featureIcon = { flexShrink: 0, marginTop: 2, color: theme.tealDeep }

export default function GoLive({ onClose }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [topic, setTopic] = useState('')
  const [description, setDescription] = useState('')
  const [starting, setStarting] = useState(false)
  const { msg: toastMsg, type: toastType, actionLabel: toastActionLabel, onAction: toastOnAction, show: showToast } = useToast()

  async function startLive() {
    if (!topic.trim()) return
    setStarting(true)
    try {
      const data = await postRepository.createLiveSession({
        host_id: user.id,
        topic: topic.trim(),
        description: description.trim(),
        status: 'live',
        board_strokes: [],
        likes: 0,
        started_at: new Date().toISOString(),
      })

      // Post to feed so followers see it
      await ensureProfile(user)
      await postRepository.createPost({
        user_id: user.id,
        content: `🔴 LIVE NOW: ${topic.trim()}${description ? '\n' + description.trim() : ''}\n\nJoin here 👇`,
        post_type: 'text',
        live_session_id: data.id,
      })

      onClose()
      navigate(`/live/${data.id}`)
    } catch (error) {
      showToast('Could not start session: ' + error.message, { type: 'error' })
      setStarting(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', fontFamily: theme.fontFamily }}>
      <div style={{ width: '100%', maxWidth: 480, background: '#fff', borderRadius: '24px 24px 0 0', padding: '20px 20px 40px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 9, fontSize: 18, fontWeight: 900, color: theme.navy }}><Radio size={18} color={theme.danger} aria-hidden="true" /> Go live</h2>
          <button onClick={onClose} aria-label="Close" style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', color: theme.gray400, cursor: 'pointer' }}><X size={20} aria-hidden="true" /></button>
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

        <div style={{ background: theme.tealMist, borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
          <p style={{ margin: '0 0 8px 0', fontSize: 11, fontWeight: 800, color: theme.tealDeep, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            What viewers can do
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
            <li style={featureRow}>
              <Palette size={14} aria-hidden="true" style={featureIcon} />
              <span><strong>Shared drawing board.</strong> Viewers see you draw as you go.</span>
            </li>
            <li style={featureRow}>
              <Mic size={14} aria-hidden="true" style={featureIcon} />
              <span><strong>Voice notes.</strong> Record and send audio messages.</span>
            </li>
            <li style={featureRow}>
              <Gift size={14} aria-hidden="true" style={featureIcon} />
              <span><strong>Gifts.</strong> Viewers can send CareCoins during your session.</span>
            </li>
            <li style={featureRow}>
              <MessageSquare size={14} aria-hidden="true" style={featureIcon} />
              <span><strong>Live chat.</strong> Viewers ask questions while you are live.</span>
            </li>
          </ul>
        </div>

        <button onClick={startLive} disabled={!topic.trim() || starting}
          style={{ width: '100%', padding: 15, background: theme.alert, color: '#fff', border: 'none', borderRadius: 14, fontWeight: 900, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {starting ? 'Starting…' : <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><Radio size={15} aria-hidden="true" /> Start live session</span>}
        </button>
      </div>

      <Toast msg={toastMsg} type={toastType} actionLabel={toastActionLabel} onAction={toastOnAction} />
    </div>
  )
}
