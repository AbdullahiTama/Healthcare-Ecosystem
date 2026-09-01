import { useState, useEffect } from 'react'
import { History, ArrowLeft } from 'lucide-react'
import { stockValidationRepository } from './repositories'
import { theme } from '../../styles/theme'
import { DataTable, Pill, Empty } from '../../components/ui'

export default function StockHistory({ brand }) {
  const [sessions, setSessions] = useState([])
  const [selectedSession, setSelectedSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!brand?.id) return
    loadSessions()
  }, [brand?.id])

  async function loadSessions() {
    setLoading(true)
    try {
      const data = await stockValidationRepository.getSessions(brand.id)
      setSessions(data || [])
    } catch (error) {
      console.error('loadSessions error:', error)
    }
    setLoading(false)
  }

  async function handleSessionClick(session) {
    try {
      const detail = await stockValidationRepository.getSessionById(session.id, brand.id)
      setSelectedSession(detail)
    } catch (error) {
      console.error('handleSessionClick error:', error)
    }
  }

  if (selectedSession) {
    return <SessionDetail session={selectedSession} onBack={() => setSelectedSession(null)} />
  }

  return (
    <>
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '20px', fontWeight: '900', color: theme.navy }}>Stock History</div>
        <div style={{ fontSize: '13px', color: theme.gray500, marginTop: '3px' }}>Completed validation sessions</div>
      </div>

      {sessions.length === 0 && !loading ? (
        <Empty icon={<History size={80} />} message="No validation sessions yet. Complete your first stock validation to see history here." />
      ) : (
        <DataTable
          rows={sessions}
          loading={loading}
          columns={[
            {
              key: 'created_at', label: 'Date', sortable: true,
              render: s => new Date(s.created_at).toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
            },
            { key: 'user_name', label: 'User', render: s => s.user_name },
            { key: 'products_checked', label: 'Checked', align: 'right', render: s => s.products_checked },
            { key: 'products_adjusted', label: 'Adjusted', align: 'right', render: s => s.products_adjusted },
            { key: 'status', label: 'Status', render: s => <Pill label={s.status} type="green" /> }
          ]}
          actions={s => (
            <button onClick={() => handleSessionClick(s)}
              style={{ padding: '5px 10px', borderRadius: theme.radius.sm, border: 'none', background: theme.tealDeep, color: 'white', fontWeight: '700', fontSize: '11px', cursor: 'pointer' }}>
              View Details
            </button>
          )}
        />
      )}
    </>
  )
}

function SessionDetail({ session, onBack }) {
  const fmt = (n) => '\u20A6' + Number(n || 0).toLocaleString()

  return (
    <>
      <button onClick={onBack}
        style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: theme.radius.md, border: `1px solid ${theme.border}`, background: 'white', color: theme.gray600, fontWeight: '700', fontSize: '13px', cursor: 'pointer', marginBottom: '20px' }}>
        <ArrowLeft size={16} />
        Back to History
      </button>

      <div style={{ padding: '16px', borderRadius: theme.radius.lg, border: `1px solid ${theme.border}`, background: 'white', marginBottom: '20px' }}>
        <div style={{ fontSize: '18px', fontWeight: '900', color: theme.navy, marginBottom: '12px' }}>Session Details</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '12px', color: theme.gray500 }}>Date</div>
            <div style={{ fontSize: '14px', fontWeight: '700', color: theme.navy }}>{new Date(session.created_at).toLocaleString('en-NG')}</div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: theme.gray500 }}>User</div>
            <div style={{ fontSize: '14px', fontWeight: '700', color: theme.navy }}>{session.user_name}</div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: theme.gray500 }}>Products Checked</div>
            <div style={{ fontSize: '14px', fontWeight: '700', color: theme.navy }}>{session.products_checked}</div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: theme.gray500 }}>Products Adjusted</div>
            <div style={{ fontSize: '14px', fontWeight: '700', color: theme.navy }}>{session.products_adjusted}</div>
          </div>
        </div>
      </div>

      <DataTable
        rows={session.items || []}
        columns={[
          {
            key: 'product_name', label: 'Product',
            render: i => (
              <>
                <div style={{ fontWeight: '700', fontSize: '13px', color: theme.navy }}>{i.product_name}</div>
                {i.shelf_label && <div style={{ fontSize: '12px', color: theme.gray500 }}>Shelf: {i.shelf_label}</div>}
              </>
            )
          },
          { key: 'previous_stock', label: 'Previous', align: 'right', render: i => i.previous_stock },
          {
            key: 'adjustment', label: 'Adjustment', align: 'right',
            render: i => (
              <span style={{ fontWeight: '700', color: i.adjustment_direction === '+' ? theme.success : theme.danger }}>
                {i.adjustment_direction}{i.adjustment_qty}
              </span>
            )
          },
          { key: 'new_stock', label: 'New', align: 'right', render: i => i.new_stock },
          { key: 'reason', label: 'Reason', render: i => i.reason || '\u2014' },
          { key: 'unit_price', label: 'Unit Price', align: 'right', render: i => fmt(i.unit_price) }
        ]}
      />
    </>
  )
}
