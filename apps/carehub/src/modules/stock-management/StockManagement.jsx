import { useSearchParams } from 'react-router-dom'
import Inventory from '../inventory/Inventory'
import StockValidation from './StockValidation'
import StockHistory from './StockHistory'
import { theme } from '../../styles/theme'

const TABS = [
  { id: 'inventory', label: 'Inventory' },
  { id: 'validation', label: 'Stock Validation' },
  { id: 'history', label: 'Stock History' },
]

export default function StockManagement(props) {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') || 'inventory'

  const handleTabChange = (tabId) => {
    setSearchParams({ tab: tabId })
  }

  return (
    <>
      <div style={{ 
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
    </>
  )
}
