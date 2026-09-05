import { MapPin } from 'lucide-react'
import { theme } from '../../styles/theme'

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'retail', label: 'Retail' },
  { key: 'wholesale', label: 'Wholesale' },
  { key: 'distributor', label: 'Distributor' },
]

export default function BusinessTypeFilter({ value, onChange, nearMe, onNearMeToggle, userCoords }) {
  return (
    <div style={{ padding: '0 16px' }}>
      {/* Row 1: All | Retail | Wholesale | Distributor — never wrap */}
      <div
        role="group"
        aria-label="Business type filter"
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'nowrap',
          overflowX: 'auto',
          overflowY: 'hidden',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          scrollSnapType: 'x proximity',
          paddingBottom: 6,
          touchAction: 'pan-x',
          overscrollBehaviorX: 'contain',
        }}
      >
        <style>{`
          div[role="group"][aria-label="Business type filter"]::-webkit-scrollbar { display: none; height: 0; }
          div[role="group"][aria-label="Business type filter"] { -webkit-overflow-scrolling: touch; }
        `}</style>
        {FILTERS.map((f) => {
          const active = value === f.key
          return (
            <button
              key={f.key || 'all'}
              onClick={() => onChange(f.key)}
              aria-pressed={active}
              style={{
                flex: '0 0 auto',
                scrollSnapAlign: 'start',
                minHeight: 44,
                padding: '0 14px',
                borderRadius: 999,
                border: active ? `2px solid ${theme.tealDeep}` : `1px solid ${theme.border}`,
                background: active ? theme.tealDeep : '#fff',
                color: active ? '#fff' : theme.textMid,
                fontSize: 12.5,
                fontWeight: 800,
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                touchAction: 'manipulation',
              }}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      {/* Row 2: Near me — naturally below, not boxed */}
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => onNearMeToggle(!nearMe)}
          disabled={!userCoords}
          aria-pressed={nearMe}
          title={userCoords ? 'Sort by distance from you' : 'Allow location to sort by distance'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            minHeight: 44,
            padding: '0 14px',
            borderRadius: 999,
            border: nearMe ? `2px solid ${theme.tealDeep}` : `1px solid ${theme.border}`,
            background: nearMe ? theme.tealMist : '#fff',
            color: nearMe ? theme.tealDeep : userCoords ? theme.textMid : theme.gray300,
            fontSize: 12.5,
            fontWeight: 800,
            cursor: userCoords ? 'pointer' : 'not-allowed',
            whiteSpace: 'nowrap',
            touchAction: 'manipulation',
          }}
        >
          <MapPin size={14} strokeWidth={nearMe ? 2.4 : 2} aria-hidden="true" />
          {nearMe ? 'Nearest first' : 'Near me'}
        </button>
        {!userCoords && (
          <span style={{ marginLeft: 8, fontSize: 11, color: theme.textLight }}>Enable location to use Near me</span>
        )}
      </div>
    </div>
  )
}

export { FILTERS }
