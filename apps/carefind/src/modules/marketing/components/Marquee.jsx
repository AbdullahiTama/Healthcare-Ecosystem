import { theme } from '../../../styles/theme'

const { textLight } = theme

// Infinite horizontal marquee. Duplicated list is aria-hidden; accessible name
// comes from `label` so screen readers hear one copy. Reduced motion stops it.
export default function Marquee({ items = [], label, speed = 30 }) {
  return (
    <div role="group" aria-label={label} style={{ overflow: 'hidden', padding: '8px 0' }}>
      <style>{`
        @keyframes cf-marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .cf-marquee-track { animation: cf-marquee ${speed}s linear infinite; }
        .cf-marquee-track:hover { animation-play-state: paused; }
        @media (prefers-reduced-motion: reduce) { .cf-marquee-track { animation: none; } }
      `}</style>
      <div style={{
        display: 'flex', overflow: 'hidden',
        maskImage: 'linear-gradient(90deg, transparent 0%, black 8%, black 92%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, black 8%, black 92%, transparent 100%)',
      }}>
        {[false, true].map((hidden) => (
          <div key={hidden} className="cf-marquee-track" aria-hidden={hidden || undefined}
            style={{ display: 'flex', gap: 48, flexShrink: 0, padding: '0 24px' }}>
            {items.map((item) => (
              <span key={item} style={{ flexShrink: 0, fontSize: 14, fontWeight: 700, color: textLight, letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
                {item}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
