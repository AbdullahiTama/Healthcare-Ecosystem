import { MapPin, Search } from 'lucide-react'
import { theme } from '../../../../styles/theme'
import MarketplaceTabs from '../../../marketplace/MarketplaceTabs.jsx'
import FacilityCard from '../../../healthcare-discovery/components/FacilityCard.jsx'
import { FIXTURES } from '../data/landingContent.js'

// The hero's visual centrepiece: the real CareFind search bar and the real
// FacilityCard, driven by illustrative fixtures.
//
// These are the same components /search renders (Search.jsx:242-289 for the
// input, FacilityCard for the rows) — not a redrawn mock-up. That is the whole
// point: if the product card changes, this preview changes with it.
//
// The frame is presentational chrome only. The input is rendered read-only so
// it cannot be mistaken for a live field, and the whole block is labelled with
// a disclaimer by the caller.

function PreviewBar({ query, location }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 8px 8px 14px',
        background: '#fff',
        border: `1px solid ${theme.border}`,
        borderRadius: theme.radius.full,
        minHeight: 48,
      }}
    >
      <Search size={17} color={theme.gray400} aria-hidden="true" style={{ flexShrink: 0 }} />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 14,
          fontWeight: 500,
          color: theme.textDark,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {query}
      </span>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '6px 10px',
          borderRadius: theme.radius.full,
          background: theme.tealMist,
          color: theme.tealDeep,
          fontSize: 12,
          fontWeight: 700,
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        <MapPin size={12} aria-hidden="true" />
        {location}
      </span>
    </div>
  )
}

export default function ProductPreview({ query, location, disclaimer, facilityCount = 3 }) {
  const facilities = FIXTURES.facilities.slice(0, facilityCount)

  return (
    <div>
      <PreviewBar query={query} location={location} />

      <div style={{ marginTop: 14 }}>
        <MarketplaceTabs activeTab="businesses" onChange={() => {}} />
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          marginTop: 12,
          // The real cards sit on white; the landing surface is warm off-white,
          // so give the stack its own panel rather than bleeding into the page.
          padding: 14,
          background: theme.cardBg,
          border: `1px solid ${theme.hairline}`,
          borderRadius: theme.radius.lg,
        }}
      >
        {facilities.map((f) => (
          <FacilityCard
            key={f.id}
            business={f}
            distance={FIXTURES.facilityDistances[f.id]}
            // The preview is illustrative, so the action routes to the real
            // discovery surface rather than to a fixture id that has no page.
            onBook={() => {}}
          />
        ))}
      </div>

      {disclaimer && (
        <p
          style={{
            margin: '12px 0 0',
            fontSize: 11.5,
            lineHeight: 1.5,
            color: theme.textLight,
            textAlign: 'center',
          }}
        >
          {disclaimer}
        </p>
      )}
    </div>
  )
}
