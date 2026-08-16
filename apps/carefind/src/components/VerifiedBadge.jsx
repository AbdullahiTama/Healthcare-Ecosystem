import { BadgeCheck } from 'lucide-react'
import { theme } from '../styles/theme'

// Role-specific professional verification badge.
//
// CareFind's trust signal is not a bare checkmark: a verified professional's
// specific role (specialty / verification_label) is the whole point of the
// badge (Feature 10). Render it consistently everywhere a verified user
// appears — profile headers, posts, comments, live shows, reviews, followers,
// notifications, sellers. Returns null for anyone not verified.
//
// Props:
//   profile  object with `is_verified` and the role columns
//            (`verification_label` preferred, `specialty` fallback)
//   size     BadgeCheck size in px (default 12)
//   style    extra inline styles merged into the wrapper
export default function VerifiedBadge({ profile, size = 12, style }) {
  if (!profile?.is_verified) return null
  const role = profile.verification_label || profile.specialty
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontSize: Math.max(9, Math.round(size * 0.85)),
        fontWeight: 700,
        color: theme.tealDeep,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <BadgeCheck size={size} aria-hidden="true" aria-label="Verified" />
      {role || 'Verified'}
    </span>
  )
}