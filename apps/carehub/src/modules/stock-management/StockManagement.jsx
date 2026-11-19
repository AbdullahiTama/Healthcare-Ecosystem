import { useSearchParams } from 'react-router-dom'
import Inventory from '../inventory/Inventory'
import StockValidation from './StockValidation'
import StockHistory from './StockHistory'
import SalesVelocity from './SalesVelocity'
import ExpiryBreakdown from './ExpiryBreakdown'
import { theme } from '../../styles/theme'

const TABS = [
  { id: 'inventory', label: 'Inventory' },
  { id: 'validation', label: 'Stock Validation' },
  { id: 'history', label: 'Stock History' },
  { id: 'velocity', label: 'Sales velocity' },
  { id: 'expiry', label: 'Expiry' },
]
const TAB_IDS = new Set(TABS.map(t => t.id))

export default function StockManagement(props) {
  const [searchParams, setSearchParams] = useSearchParams()
  // Read from the URL on every render, so a notification opened while this page is already showing switches the
  // tab and its list. An older expiry notification linked to ?expiry=… without a tab: it opens the Expiry tab.
  const requested = searchParams.get('tab')
  const activeTab = TAB_IDS.has(requested) ? requested : (!requested && searchParams.get('expiry') ? 'expiry' : 'inventory')
  const expirySection = ['expiring', 'expired'].includes(searchParams.get('expiry')) ? searchParams.get('expiry') : ''
  const velocityGroup = ['fast', 'steady', 'slow', 'none'].includes(searchParams.get('group')) ? searchParams.get('group') : ''

  const handleTabChange = (tabId) => {
    setSearchParams({ tab: tabId })
  }
  const setParam = (key, value) => {
    const next = { tab: activeTab }
    if (value) next[key] = value
    setSearchParams(next)
  }

  return (
    <>
      <div role="tablist" aria-label="Stock Management" style={{ overflowX: 'auto', 
        display: 'flex', 
        gap: '8px', 
        marginBottom: '20px',
        borderBottom: `1px solid ${theme.border}`,
        paddingBottom: '12px'
      }}>
        {TABS.map(tab => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => handleTabChange(tab.id)}
              style={{
                padding: '10px 16px',
                borderRadius: `${theme.radius.md} ${theme.radius.md} 0 0`,
                border: 'none',
                borderBottom: isActive ? `2px solid ${theme.tealDeep}` : '2px solid transparent',
                background: isActive ? theme.tealMist : 'transparent',
                color: isActive ? theme.tealDeep : theme.gray600,
                fontWeight: '700',
                fontSize: '13px',
                cursor: 'pointer',
                flexShrink: 0,
                whiteSpace: 'nowrap',
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'inventory' && <Inventory {...props} />}
      {activeTab === 'validation' && <StockValidation {...props} />}
      {activeTab === 'history' && <StockHistory brand={props.brand} />}
      {activeTab === 'velocity' && <SalesVelocity {...props} group={velocityGroup} onGroupChange={g => setParam('group', g)} />}
      {activeTab === 'expiry' && <ExpiryBreakdown {...props} section={expirySection} onSectionChange={s => setParam('expiry', s)} />}
    </>
  )
}
