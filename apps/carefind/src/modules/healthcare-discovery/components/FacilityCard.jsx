import { Link } from 'react-router-dom'
import { Building2, MapPin } from 'lucide-react'
import { theme } from '../../../styles/theme'

// The healthcare-facility result row on the /search "Facilities" tab.
// Extracted from Search.jsx so the search results and the marketing landing
// page show the same card from one definition.
//
// Presentational only. `distance` is a preformatted label (the landing page
// supplies one from its fixtures; /search computes it from geolocation) and
// `onBook` is supplied by the owner — Search.jsx routes bookable facilities to
// their profile anchor and registers booking interest for the rest, while the
// landing page points every tile at facility discovery.
export default function FacilityCard({ business: b, distance = null, onBook }) {
  const isBookable = !!b.booking_enabled

  return (
    <div style={{ padding: 16, border: `1px solid ${theme.border}`, borderRadius: 14, background: '#fff' }}>
      <Link to={`/business/${b.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', gap: 12 }}>
        <div
          style={{
            width: 48, height: 48, borderRadius: 12, flexShrink: 0,
            background: b.cover_url ? `url(${b.cover_url})` : theme.navy,
            backgroundSize: 'cover', backgroundPosition: 'center',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 800,
          }}
        >
          {!b.cover_url && (b.name?.[0]?.toUpperCase() || <Building2 size={20} aria-hidden="true" />)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: '0 0 2px 0', fontSize: 15, fontWeight: 800, color: theme.navy }}>{b.name}</p>
          <p style={{ margin: 0, fontSize: 13, color: theme.textMid, textTransform: 'capitalize' }}>
            {b.business_type} · {b.city}{b.state ? `, ${b.state}` : ''}
          </p>
          {distance && (
            <p style={{ margin: '3px 0 0 0', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: theme.tealDeep, fontWeight: 600 }}>
              <MapPin size={11} aria-hidden="true" /> {distance}
            </p>
          )}
        </div>
      </Link>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Link
          to={`/business/${b.id}`}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            minHeight: 44, padding: '9px 12px', background: '#fff', color: theme.tealDeep,
            border: `1px solid ${theme.border}`, borderRadius: 10, fontWeight: 700, fontSize: 13,
            textDecoration: 'none', boxSizing: 'border-box',
          }}
        >
          View Profile
        </Link>
        <button
          type="button"
          onClick={onBook}
          aria-label={isBookable ? 'Book Appointment' : 'Book Appointment unavailable'}
          aria-disabled={!isBookable}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            minHeight: 44, padding: '9px 12px', background: isBookable ? theme.tealDeep : '#e2e8f0',
            color: isBookable ? '#fff' : theme.textMid, border: 'none', borderRadius: 10,
            fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: isBookable ? 1 : 0.9,
            boxSizing: 'border-box',
          }}
        >
          Book Appointment
        </button>
      </div>
    </div>
  )
}
