import { theme } from '../../../../styles/theme'
import { resolveIcon } from '../components/icons.js'
import { PREVIEW } from '../data/landingContent.js'

// The floating ecosystem preview cards.
//
// Deliberately decorative: the whole group is aria-hidden and pointer-events
// none, so it can never take focus, never blocks the headline or the CTAs, and
// never pretends to be a live surface (ACCESSIBILITY.md — decorative imagery
// stays out of the accessibility tree). The visible disclaimer under the group
// is what tells a sighted visitor these are samples.
//
// Four layouts:
//   * `tilt` — desktop and phones. A tight, equal-width column; Hero.jsx pins it
//     to the right edge below the subject's chin and scales and tilts it so it
//     reads as floating beside her rather than over her face.
//   * `inline` — cards side by side in an equal-width row.
//   * `stack` — a right-hand column, each card nudged a little further right
//     than the last so the group reads as layered.
//   * `row`  — mobile. A single horizontal scroll strip so the cards never
//     push the headline or the feature strip out of the hero.

const STACK_OFFSETS = [0, 30, 12, 42]

function Rating({ avg, count }) {
  const StarIcon = resolveIcon('Star')
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span
        role="img"
        aria-label={`${avg} out of 5`}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 800, color: theme.navy }}
      >
        <StarIcon size={14} color="#E8A317" fill="#E8A317" aria-hidden="true" />
        {avg}
      </span>
      <span style={{ fontSize: 12.5, color: theme.navySoft }}>{count} reviews</span>
    </div>
  )
}

function PreviewCard({ card, offset, wrapName }) {
  const Icon = card.icon ? resolveIcon(card.icon) : null
  const nudged = typeof offset === 'number'

  return (
    <article
      style={{
        width: nudged ? `calc(100% - ${offset}px)` : undefined,
        marginLeft: nudged ? offset : undefined,
        flex: '0 0 auto',
        background: '#fff',
        borderRadius: theme.radius.xl,
        border: `1px solid rgba(255,255,255,0.7)`,
        boxShadow: '0 18px 40px rgba(7, 32, 26, 0.35)',
        padding: '13px 15px',
        color: theme.textDark,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {card.kind === 'discussion' ? (
          <span
            aria-hidden="true"
            style={{
              width: 34,
              height: 34,
              borderRadius: theme.radius.full,
              background: theme.tealMist,
              color: theme.tealDeep,
              display: 'grid',
              placeItems: 'center',
              fontSize: 12,
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            {card.avatar}
          </span>
        ) : (
          <span
            aria-hidden="true"
            style={{
              width: 34,
              height: 34,
              borderRadius: theme.radius.md,
              background: theme.tealMist,
              color: theme.tealDeep,
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <Icon size={17} />
          </span>
        )}

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
            <span style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: '-0.01em', whiteSpace: wrapName ? 'normal' : 'nowrap', lineHeight: wrapName ? 1.25 : undefined, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {card.name}
            </span>
          </div>
          {/* Medicine and booking cards carry `meta` in their footer row
              (price/slot on the left, seller/venue on the right), so the
              subtitle is omitted there to avoid printing it twice. */}
          {(card.kind === 'discussion' || card.kind === 'provider') && (
            <div style={{ fontSize: 11.5, color: theme.navySoft, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {card.kind === 'discussion' ? card.role : card.meta}
            </div>
          )}
        </div>

        <span
          style={{
            flexShrink: 0,
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: theme.tealDeep,
            background: theme.tealMist,
            borderRadius: theme.radius.full,
            padding: '4px 8px',
          }}
        >
          {card.badge}
        </span>
      </div>

      {card.kind === 'discussion' && (
        <>
          <p style={{ margin: '9px 0 0', fontSize: 13, lineHeight: 1.5, color: theme.textDark }}>
            {card.body}
          </p>
          <div style={{ display: 'flex', gap: 14, marginTop: 9 }}>
            {card.meta.map(({ icon, label }) => {
              const MetaIcon = resolveIcon(icon)
              return (
                <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: theme.navySoft }}>
                  <MetaIcon size={13} aria-hidden="true" />
                  {label}
                </span>
              )
            })}
          </div>
        </>
      )}

      {card.kind === 'provider' && (
        <div style={{ marginTop: 9 }}>
          <Rating avg={card.rating.avg} count={card.rating.count} />
        </div>
      )}

      {card.kind === 'medicine' && (
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginTop: 9 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: theme.tealDeep }}>{card.price}</span>
          <span style={{ fontSize: 11.5, color: theme.navySoft, textAlign: 'right' }}>{card.meta}</span>
        </div>
      )}

      {card.kind === 'booking' && (
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginTop: 9 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: theme.navySoft }}>{card.meta}</span>
          <span style={{ fontSize: 11.5, color: theme.navySoft, textAlign: 'right' }}>{card.venue}</span>
        </div>
      )}
    </article>
  )
}

export default function FloatingPreviews({ variant = 'stack', limit }) {
  const stack = variant === 'stack'
  const inline = variant === 'inline'
  const tilt = variant === 'tilt'
  // The desktop stack deliberately shows fewer cards than the mobile row: it
  // is bottom-aligned under the photo's faces, and a fourth card would grow the
  // stack upward into them.
  const cards = limit ? PREVIEW.cards.slice(0, limit) : PREVIEW.cards

  return (
    <div
      data-hero-group
      aria-hidden="true"
      style={
        tilt
          ? { display: 'flex', flexDirection: 'column', gap: 10, width: 300 }
          : inline
          ? { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16, minWidth: 0 }
          : stack
          ? { display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }
          : {
              display: 'flex',
              gap: 12,
              overflowX: 'auto',
              overscrollBehaviorX: 'contain',
              scrollSnapType: 'x mandatory',
              padding: '4px 4px 8px',
              margin: '4px -4px 0',
              minWidth: 0,
            }
      }
    >
      {cards.map((card, index) => (
        <div
          key={card.id}
          style={stack || inline || tilt ? { minWidth: 0 } : { scrollSnapAlign: 'start', flex: '0 0 auto', width: 232 }}
        >
          <PreviewCard card={card} offset={stack ? STACK_OFFSETS[index] : undefined} wrapName={inline} />
        </div>
      ))}
    </div>
  )
}
