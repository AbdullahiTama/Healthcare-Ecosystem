import { BadgeCheck, AlertTriangle, Clock, HelpCircle } from 'lucide-react'
import { FACILITY_VERIFICATION } from '../../lib/geo'
import { theme } from '../../styles/theme'

const { success, successBg, info, infoBg, warning, warningBg } = theme

// Whether the GPS pin sits close to the place the report names. That is all it
// says: it compares two positions. It is not proof that a visit or a conversation
// took place, so the wording is about the location, never about the visit.
const VIEW = {
  [FACILITY_VERIFICATION.VERIFIED]: { text: 'Location matches', Icon: BadgeCheck, color: success, bg: successBg },
  [FACILITY_VERIFICATION.PENDING]: { text: 'Pending review', Icon: Clock, color: info, bg: infoBg },
  [FACILITY_VERIFICATION.UNVERIFIED]: { text: 'Not matched', Icon: AlertTriangle, color: warning, bg: warningBg },
  [FACILITY_VERIFICATION.UNCERTAIN]: { text: 'Location uncertain', Icon: HelpCircle, color: info, bg: infoBg },
}

const EXPLAIN = {
  [FACILITY_VERIFICATION.VERIFIED]: 'The GPS pin is close to this place. It compares positions only and does not prove a visit took place.',
  [FACILITY_VERIFICATION.PENDING]: 'A place added by a rep sits at their own GPS pin, so it cannot be compared until a manager reviews it.',
  [FACILITY_VERIFICATION.UNVERIFIED]: 'The GPS pin is missing or not close to this place. That does not mean no visit took place.',
  [FACILITY_VERIFICATION.UNCERTAIN]: 'The GPS fix was too imprecise to tell whether the phone was at this place. That does not mean it was elsewhere.',
}

// The badge's words for a location-match state, for places that show it as text (the Team map's popups).
export function matchText(state) {
  return (VIEW[state] || VIEW[FACILITY_VERIFICATION.UNVERIFIED]).text
}

export default function LocationMatchBadge({ state }) {
  const v = VIEW[state] || VIEW[FACILITY_VERIFICATION.UNVERIFIED]
  const key = VIEW[state] ? state : FACILITY_VERIFICATION.UNVERIFIED
  return (
    <span title={EXPLAIN[key]} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', fontWeight: '800', padding: '2px 8px', borderRadius: '20px', background: v.bg, color: v.color }}>
      <v.Icon size={10} aria-hidden='true' /> {v.text}
    </span>
  )
}
