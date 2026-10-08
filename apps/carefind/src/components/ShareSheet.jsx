import { useEffect, useRef, useState } from 'react'
import { X, Link2, MessageSquare, Share2 } from 'lucide-react'
import { theme } from '../styles/theme'
import { shareOrCopy } from '../utils/share'
import { composeShareText } from '../utils/shareWithNote'

const TARGETS = [
  { key: 'whatsapp', label: 'WhatsApp', color: '#25D366', buildUrl: (url) => `https://wa.me/?text=${encodeURIComponent(url)}` },
  { key: 'twitter', label: 'X', color: '#1DA1F2', buildUrl: (url, text) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(text || url)}&url=${encodeURIComponent(url)}` },
  { key: 'telegram', label: 'Telegram', color: '#0088cc', buildUrl: (url, text) => `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text || '')}` },
]

export default function ShareSheet({
  open,
  onClose,
  url,
  title,
  text,
  mediaUrl,
  files,
  onShareComplete,
}) {
  const [note, setNote] = useState('')
  const [copied, setCopied] = useState(false)
  const [sharing, setSharing] = useState(false)
  const overlayRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setNote('')
    setCopied(false)
    setSharing(false)
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus()
    }
  }, [open])

  if (!open) return null

  const shareText = composeShareText({ note, url, defaultText: text || title })

  async function handleShare() {
    setSharing(true)
    const result = await shareOrCopy({ title, text: shareText, url, files, mediaUrl })
    setSharing(false)
    if (onShareComplete) onShareComplete(result)
    if (result === 'shared' || result === 'copied') onClose()
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      if (onShareComplete) onShareComplete('copied')
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  function handleTargetClick(target) {
    const composed = composeShareText({ note, url, defaultText: text || title })
    const targetUrl = target.buildUrl(url, composed)
    window.open(targetUrl, '_blank', 'noopener,noreferrer')
    if (onShareComplete) onShareComplete('shared')
    onClose()
  }

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label="Share"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: theme.overlay,
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center',
        animation: 'ss-fade-in 0.2s ease',
      }}
    >
      <style>{`
        @keyframes ss-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes ss-slide-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes ss-scale-in { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
      `}</style>
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          maxHeight: '70vh',
          background: theme.cardBg,
          borderRadius: isMobile ? '20px 20px 0 0' : theme.radius.lg,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          animation: isMobile ? 'ss-slide-up 0.25s ease' : 'ss-scale-in 0.2s ease',
          boxShadow: theme.elevation[3],
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 12px' }}>
          <span style={{ fontSize: theme.type.h3.size, fontWeight: theme.type.h3.weight, color: theme.navy }}>Share</span>
          <button
            onClick={onClose}
            aria-label="Close share sheet"
            style={{
              width: 32, height: 32, borderRadius: theme.radius.full, border: `1px solid ${theme.border}`,
              background: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer',
            }}
          >
            <X size={16} color={theme.textMid} />
          </button>
        </div>

        <div style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16 }}>
            {TARGETS.map((target) => (
              <button
                key={target.key}
                onClick={() => handleTargetClick(target)}
                aria-label={`Share on ${target.label}`}
                style={{
                  width: 48, height: 48, borderRadius: theme.radius.full, border: 'none',
                  background: target.color, display: 'grid', placeItems: 'center', cursor: 'pointer',
                  transition: `transform ${theme.motion.fast} ease`,
                }}
              >
                <TargetIcon targetKey={target.key} />
              </button>
            ))}
            <button
              onClick={handleCopyLink}
              aria-label="Copy link"
              style={{
                width: 48, height: 48, borderRadius: theme.radius.full,
                border: `1px solid ${theme.border}`, background: '#fff',
                display: 'grid', placeItems: 'center', cursor: 'pointer',
              }}
            >
              <Link2 size={20} color={copied ? theme.success : theme.textMid} />
            </button>
          </div>

          {copied && (
            <p style={{ margin: 0, textAlign: 'center', fontSize: theme.type.bodySm.size, fontWeight: theme.type.bodySm.weight, color: theme.success }}>
              Link copied!
            </p>
          )}

          <div style={{ position: 'relative' }}>
            <MessageSquare size={16} color={theme.textMuted} style={{ position: 'absolute', left: 12, top: 12 }} />
            <textarea
              ref={inputRef}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a thought..."
              aria-label="Add a personal note to your share"
              rows={3}
              style={{
                width: '100%', padding: '12px 12px 12px 36px', borderRadius: theme.radius.md,
                border: `1px solid ${theme.border}`, fontSize: theme.type.body.size,
                fontFamily: theme.fontFamily, color: theme.textDark, background: '#fff',
                resize: 'none', boxSizing: 'border-box', lineHeight: theme.type.body.lineHeight,
                outline: 'none',
              }}
            />
          </div>

          <button
            onClick={handleShare}
            disabled={sharing}
            aria-label="Share"
            style={{
              width: '100%', minHeight: 48, borderRadius: theme.radius.md, border: 'none',
              background: theme.tealDeep, color: '#fff', fontSize: theme.type.bodyLg.size,
              fontWeight: theme.type.bodyLg.weight, cursor: sharing ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              opacity: sharing ? 0.7 : 1, transition: `opacity ${theme.motion.fast} ease`,
            }}
          >
            <Share2 size={18} />
            {sharing ? 'Sharing...' : 'Share'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TargetIcon({ targetKey }) {
  const size = 22
  if (targetKey === 'whatsapp') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
      </svg>
    )
  }
  if (targetKey === 'twitter') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    )
  }
  if (targetKey === 'telegram') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
        <path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
      </svg>
    )
  }
  return null
}
