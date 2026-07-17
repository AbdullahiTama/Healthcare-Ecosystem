// The on-screen Voice Card / Visual Post.
// The gradients here are deliberately identical to the ones in voiceCard.js,
// so the exported PNG/video looks exactly like what the user sees on screen.

export const CARD_TEMPLATES = {
  'teal-depth': {
    label: '🌊 Ocean',
    background: 'linear-gradient(135deg, #0F766E 0%, #0D9488 100%)',
    color: '#FFFFFF',
  },
  'navy-clinical': {
    label: '✨ Sky',
    background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
    color: '#FFFFFF',
  },
  'midnight-teal': {
    label: '🌃 Night',
    background: 'linear-gradient(135deg, #042F2E 0%, #134E4A 100%)',
    color: '#FFFFFF',
  },
  'forest-wellness': {
    label: '🌿 Forest',
    background: 'linear-gradient(135deg, #14532D 0%, #166534 100%)',
    color: '#FFFFFF',
  },
  'slate-pulse': {
    label: '❤️ Pulse',
    background: 'linear-gradient(135deg, #7F1D1D 0%, #9F1239 100%)',
    color: '#FFFFFF',
  },
}

function VisualCard({ templateKey = 'teal-depth', content = '', preview = false, hasVoice = false, imageUrl = null, videoUrl = null, username = '' }) {
  const t = CARD_TEMPLATES[templateKey] || CARD_TEMPLATES['teal-depth']
  const text = String(content || '')
  const empty = !text.trim()

  // Long messages step down in size so they always fit the card
  const len = text.length
  const fontSize = len > 220 ? 17 : len > 140 ? 20 : len > 70 ? 24 : 28

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '1 / 1',
        background: imageUrl ? `#0b1220 url(${imageUrl}) center/cover` : t.background,
        borderRadius: 16,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 26,
        boxSizing: 'border-box',
      }}
    >
      {!imageUrl && videoUrl && (
        <video
          src={videoUrl}
          autoPlay
          loop
          muted
          playsInline
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}

      {(imageUrl || videoUrl) && (
        <div
          style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.35), rgba(0,0,0,0.30) 55%, rgba(0,0,0,0.62))',
          }}
        />
      )}

      <p
        style={{
          position: 'relative',
          margin: 0,
          color: empty ? 'rgba(255,255,255,0.45)' : t.color,
          fontSize: empty ? 20 : fontSize,
          fontWeight: 800,
          lineHeight: 1.35,
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          textShadow: '0 1px 12px rgba(0,0,0,0.18)',
        }}
      >
        {empty ? (preview ? 'Type your message here…' : '') : text}
      </p>

      {/* Sound-wave hint, so a card with a voice reads as one at a glance */}
      {hasVoice && (
        <div
          style={{
            position: 'absolute',
            bottom: 62,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'flex-end',
            gap: 3,
            height: 20,
          }}
        >
          {[8, 14, 20, 12, 17, 9, 15, 19, 11, 16, 8, 13].map((h, i) => (
            <span
              key={i}
              style={{
                width: 3,
                height: h,
                borderRadius: 2,
                background: 'rgba(255,255,255,0.4)',
                display: 'block',
              }}
            />
          ))}
        </div>
      )}

      {/* CareFind logo — the brand travels with every shared card */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          left: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 8,
            background: 'linear-gradient(135deg, #0D9488, #14B8A6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 900,
            fontSize: 14,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          C
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span
            style={{
              fontSize: 9,
              fontWeight: 800,
              letterSpacing: '0.16em',
              color: 'rgba(255,255,255,0.7)',
              textTransform: 'uppercase',
              lineHeight: 1.1,
            }}
          >
            CareFind
          </span>
          {username && (
            <span style={{ fontSize: 10.5, fontWeight: 800, color: 'rgba(255,255,255,0.95)', lineHeight: 1.1 }}>
              @{String(username).replace(/^@/, '')}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export default VisualCard
