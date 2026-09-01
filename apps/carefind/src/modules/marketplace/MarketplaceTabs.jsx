import { ShoppingBag, Pill as PillIcon, Building2, Stethoscope } from 'lucide-react'
import { theme } from '../../styles/theme'

const TAB_CONFIG = [
  { key: 'shop', label: 'Shop', Icon: ShoppingBag },
  { key: 'products', label: 'Products', Icon: PillIcon },
  { key: 'businesses', label: 'Facilities', Icon: Building2 },
  { key: 'professionals', label: 'Professionals', Icon: Stethoscope },
]

export default function MarketplaceTabs({ activeTab, onChange }) {
  return (
    <div
      role="tablist"
      aria-label="Marketplace categories"
      style={{
        display: 'flex',
        gap: 8,
        flexWrap: 'nowrap',
        overflowX: 'auto',
        overflowY: 'hidden',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        padding: '2px 16px 2px',
        scrollSnapType: 'x proximity',
        // hide scrollbar visually but keep scroll
      }}
    >
      <style>{`
        div[role="tablist"]::-webkit-scrollbar { display: none; height: 0; }
      `}</style>
      {TAB_CONFIG.map(({ key, label, Icon }) => {
        const active = activeTab === key
        return (
          <button
            key={key}
            role="tab"
            aria-selected={active}
            aria-controls={`marketplace-panel-${key}`}
            id={`marketplace-tab-${key}`}
            onClick={() => onChange(key)}
            style={{
              flex: '0 0 auto',
              scrollSnapAlign: 'start',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              minHeight: 36,
              padding: '0 16px',
              borderRadius: 999,
              border: active ? `2px solid ${theme.tealDeep}` : `1px solid ${theme.border}`,
              background: active ? theme.tealDeep : '#fff',
              color: active ? '#fff' : theme.textMid,
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: '-0.01em',
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              transition: `background ${theme.motion.fast} ${theme.motion.easeOut}, color ${theme.motion.fast} ${theme.motion.easeOut}, border-color ${theme.motion.fast} ${theme.motion.easeOut}`,
            }}
          >
            <Icon size={16} strokeWidth={active ? 2.4 : 2} aria-hidden="true" color={active ? '#fff' : theme.gray500} />
            {label}
          </button>
        )
      })}
    </div>
  )
}

export { TAB_CONFIG }
