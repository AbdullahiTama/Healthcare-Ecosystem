import { Link } from 'react-router-dom'
import { BadgeCheck } from 'lucide-react'
import { theme } from '../styles/theme'

// Shared identity header for a (verified) professional, used on both feed
// posts and the public profile page so the trust signals stay pixel-consistent
// and the broken-badge bug (name and badge drifting apart) can only be fixed
// in one place.
//
// Spec behaviour:
//  - Name + verification checkmark are ONE inline unit (inline-flex + nowrap):
//    a long name can never wrap away from the badge. The unit wraps as a whole
//    if it doesn't fit; the name truncates with an ellipsis before the badge
//    ever separates from it.
//  - Exactly one checkmark per card: it lives next to the name. The role tag
//    below carries NO icon of its own (text-only) — repeating the check would
//    read as unprofessional/redundant.
//  - The role tag is text-only ("Pharmacist", "Nurse", …) and only renders when
//    the user has a verified role. It is surfaced dynamically from the
//    verification record, never hardcoded.
//  - `context="post"` hides the @username (feed clutter); `context="profile"`
//    shows it — the one place the handle is genuinely useful.
export default function ProfileHeader({ profile, name, context = 'post', size = 14.5, nameHref }) {
  // The role is the verified profession (verification_label preferred,
  // specialty fallback). When neither is set we still elevate the account with a
  // plain "Verified" tag so verified professionals are always visually
  // distinguished from unverified users. Text-only — the checkmark next to the
  // name is the only verification icon on the card.
  const role = profile?.verification_label || profile?.specialty || 'Verified'
  const verified = !!profile?.is_verified
  const showHandle = context === 'profile' && profile?.display_name

  // The profile name is a top-level heading; in feed context it is a plain span.
  const NameTag = context === 'profile' ? 'h1' : 'span'

  const nameEl = (
    <NameTag
      style={{
        margin: 0,
        fontSize: size, fontWeight: 800, color: theme.navy,
        minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}
    >
      {name}
    </NameTag>
  )

  return (
    <div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', maxWidth: '100%' }}>
        {nameHref
          ? <Link to={nameHref} style={{ textDecoration: 'none', display: 'inline-flex', minWidth: 0, maxWidth: '100%' }}>{nameEl}</Link>
          : nameEl}
        {verified && (
          <BadgeCheck size={Math.max(12, Math.round(size * 1.05))} color={theme.tealDeep} style={{ flexShrink: 0 }} role="img" aria-label="Verified" />
        )}
      </div>

      {showHandle && (
        <div style={{ fontSize: 12.5, color: theme.gray400, fontWeight: 600, marginTop: 1 }}>@{profile.display_name}</div>
      )}

      {verified && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', marginTop: 4,
          fontSize: 11, fontWeight: 700, color: theme.tealDeep,
          background: theme.tealMist, padding: '2px 8px', borderRadius: theme.radius.full,
          whiteSpace: 'nowrap',
        }}>
          {role}
        </div>
      )}
    </div>
  )
}
