import { forwardRef } from 'react'
import { theme } from '../../theme'

// Unified Card — one card for the whole ecosystem (Stage 3 / 3.6).
// forwardRef so CareHub's Modal can focus-trap its content.
// `onClick` makes the Card act like a button for keyboard users, but only
// when the Card ITSELF is focused — a keydown bubbling up from a child input
// must NOT be prevented, or the spacebar can never be typed into fields
// inside the Card. Interactive cards get a subtle elevation lift on hover.
export const Card = forwardRef(function Card({ children, style = {}, onClick, className }, ref) {
  const interactive = !!onClick
  return (
    <div
      ref={ref}
      onClick={onClick}
      className={className}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.currentTarget === e.target) { e.preventDefault(); onClick(e) }
      } : undefined}
      onMouseEnter={interactive ? (e) => { e.currentTarget.style.boxShadow = theme.elevation[2] } : undefined}
      onMouseLeave={interactive ? (e) => { e.currentTarget.style.boxShadow = theme.elevation[1] } : undefined}
      style={{
        background: theme.cardBg,
        borderRadius: theme.radius.lg,
        border: `1px solid ${theme.border}`,
        boxShadow: theme.elevation[1],
        cursor: interactive ? 'pointer' : 'default',
        transition: `box-shadow ${theme.motion.base} ${theme.motion.easeOut}`,
        ...style,
      }}
    >
      {children}
    </div>
  )
})

Card.displayName = 'Card'

export default Card
