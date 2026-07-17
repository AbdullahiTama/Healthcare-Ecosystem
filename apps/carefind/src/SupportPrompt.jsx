import { useEffect, useState } from 'react'
import { theme } from './lib/theme'

// A gentle, once-per-session bottom banner encouraging support/gifting.
// Respectful: waits a bit before showing, easy to dismiss, never blocks content.
// Pass onGift to open the gift flow; if omitted, the button links to /wallet.
function SupportPrompt({ onGift, creatorName, delay = 12000 }) {
  const [visible, setVisible] = useState(false)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    // Show once per browser session
    let shown = false
    try { shown = sessionStorage.getItem('cf_support_shown') === '1' } catch (e) {}
    if (shown) return
    const t = setTimeout(() => setVisible(true), delay)
    return () => clearTimeout(t)
  }, [delay])

  function dismiss() {
    setLeaving(true)
    try { sessionStorage.setItem('cf_support_shown', '1') } catch (e) {}
    setTimeout(() => setVisible(false), 300)
  }

  function handleGift() {
    try { sessionStorage.setItem('cf_support_shown', '1') } catch (e) {}
    if (onGift) onGift()
    else window.location.href = '/wallet'
    dismiss()
  }

  if (!visible) return null

  return (
    <div style={{
      position: 'fixed', bottom: 84, left: 12, right: 12, maxWidth: 456, margin: '0 auto', zIndex: 900,
      background: theme.heroGradient, color: '#fff', borderRadius: 16, padding: '12px 14px',
      boxShadow: '0 8px 30px rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', gap: 12,
      transform: leaving ? 'translateY(120%)' : 'translateY(0)', opacity: leaving ? 0 : 1,
      transition: 'transform 0.3s ease, opacity 0.3s ease',
    }}>
      <div style={{ fontSize: 26, flexShrink: 0 }}>💚</div>
      <div style={{ flex: 1 }}>
        <p style={{ margin: '0 0 2px 0', fontSize: 13.5, fontWeight: 800 }}>Enjoying {creatorName || 'CareFind'}?</p>
        <p style={{ margin: 0, fontSize: 11.5, color: 'rgba(255,255,255,0.8)' }}>A small gift keeps great health content coming.</p>
      </div>
      <button onClick={handleGift} style={{ flexShrink: 0, background: '#fff', color: theme.tealDeep, border: 'none', borderRadius: 20, padding: '8px 16px', fontWeight: 800, fontSize: 13 }}>
        🎁 Support
      </button>
      <button onClick={dismiss} aria-label="Dismiss" style={{ flexShrink: 0, background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', borderRadius: '50%', width: 26, height: 26, fontSize: 14, lineHeight: 1 }}>✕</button>
    </div>
  )
}

export default SupportPrompt
