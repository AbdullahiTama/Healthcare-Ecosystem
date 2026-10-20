import { useState } from 'react'
import { Play } from 'lucide-react'
import { theme } from '../../styles/theme'

const { tealDeep, tealMist, danger, border } = theme

// Plays a stored voice note. The stored URL is not played directly: `resolve` turns it into
// a signed link first, so this works the same whether the bucket is public or private. The
// link is asked for only when someone presses play, so a long list of reports does not make
// a signing request per row.
//   resolve(url) -> Promise<string>   (liveActivityRepository.signedVoiceUrl)
export default function VoicePlayer({ url, resolve, compact = false }) {
  const [state, setState] = useState({ status: 'idle', link: null })
  if (!url) return null

  async function open() {
    setState({ status: 'loading', link: null })
    try {
      const link = await resolve(url)
      setState({ status: 'ready', link: link || url })
    } catch (e) {
      setState({ status: 'failed', link: null })
    }
  }

  if (state.status === 'ready') {
    return (
      <audio src={state.link} controls autoPlay preload='auto' aria-label='Voice note'
        onError={function () { setState({ status: 'failed', link: null }) }}
        style={compact ? { height: '30px', maxWidth: '160px' } : { width: '100%', height: '38px' }} />
    )
  }
  if (state.status === 'failed') {
    return (
      <span role='alert' style={{ fontSize: '12px', color: danger }}>
        This voice note could not be played.{' '}
        <button type='button' onClick={open}
          style={{ background: 'none', border: 'none', color: tealDeep, fontWeight: '700', fontSize: '12px', cursor: 'pointer', padding: 0 }}>
          Try again
        </button>
      </span>
    )
  }
  return (
    <button type='button' onClick={open} disabled={state.status === 'loading'} aria-busy={state.status === 'loading'}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', border: `1px solid ${border}`, background: tealMist, color: tealDeep, borderRadius: '20px', padding: compact ? '4px 10px' : '8px 14px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>
      <Play size={12} aria-hidden='true' />
      {state.status === 'loading' ? 'Opening voice note…' : 'Play voice note'}
    </button>
  )
}
