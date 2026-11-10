import { useEffect, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { Modal, GhostBtn, Loading, Empty, ErrorState } from '../../../components/ui'
import { theme } from '../../../styles/theme'
import { businessDateTime } from '../../../lib/businessDay'

const { navy, gray500, gray600, border, success } = theme

// Products deleted in bulk at this location, one line per deletion, with Restore. Restoring puts the products back
// with their prices and stock; any whose name has been taken since (for example by a re-upload) is skipped so nothing
// is duplicated. `loadDeletions()` and `onRestore(deletionId)` come from the product repository.
export default function RecentlyDeletedModal({ loadDeletions, onRestore, onClose }) {
  const [state, setState] = useState({ status: 'loading', rows: [] })
  const [busyId, setBusyId] = useState(null)
  const [message, setMessage] = useState('')

  async function load() {
    setState((s) => ({ ...s, status: 'loading' }))
    try { setState({ status: 'ready', rows: await loadDeletions() }) } catch (e) {
      console.error('[inventory] recently deleted failed:', e?.message)
      setState({ status: e?.code === 'DELETE_UNAVAILABLE' || /deleted_products/.test(String(e?.message)) ? 'unavailable' : 'error', rows: [] })
    }
  }
  useEffect(() => { load() }, [])

  async function restore(d) {
    setBusyId(d.deletion_id); setMessage('')
    try {
      const r = await onRestore(d.deletion_id)
      setMessage(`${r.restored} product${r.restored === 1 ? '' : 's'} restored` +
        (r.skipped_name_taken ? `; ${r.skipped_name_taken} skipped because a product with the same name exists now` : '') +
        (r.skipped_plan_limit ? `; ${r.skipped_plan_limit} not restored because your plan's product limit is reached` : '') + '.')
      await load()
    } catch (e) {
      setMessage(e?.message || 'Could not restore. Please try again.')
    } finally { setBusyId(null) }
  }

  return (
    <Modal show onClose={onClose} title='Recently deleted products' footer={<GhostBtn onClick={onClose} style={{ flex: 1, padding: 12 }}>Close</GhostBtn>}>
      {message && <div role='status' style={{ fontSize: 13, color: success, fontWeight: 700, marginBottom: 10 }}>{message}</div>}
      {state.status === 'loading' ? <Loading text='Loading deleted products…' /> : state.status === 'unavailable' ? (
        <Empty icon={<Trash2 size={36} />} message='Recently deleted will be available once the latest CareHub update is installed.' />
      ) : state.status === 'error' ? (
        <ErrorState message="We couldn't load deleted products." onRetry={load} />
      ) : state.rows.length === 0 ? (
        <Empty icon={<Trash2 size={36} />} message='Nothing has been deleted in bulk here.' />
      ) : (
        <ul aria-label='Deletions' style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {state.rows.map((d) => {
            const left = d.count - d.restored
            return (
              <li key={d.deletion_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', padding: 12, borderRadius: theme.radius.md, border: `1px solid ${border}` }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: navy }}>{d.all ? 'All products cleared' : `${d.count} product${d.count === 1 ? '' : 's'} deleted`}</div>
                  <div style={{ fontSize: 12, color: gray600 }}>{businessDateTime(d.deleted_at)}{d.by ? ' · ' + d.by : ''}{d.all ? ` · ${d.count} products` : ''}</div>
                  <div style={{ fontSize: 11.5, color: gray500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.names.join(', ')}{d.count > d.names.length ? '…' : ''}</div>
                  {d.restored > 0 && <div style={{ fontSize: 11.5, color: success }}>{d.restored} restored</div>}
                </div>
                {left > 0 && (
                  <GhostBtn onClick={() => restore(d)} disabled={!!busyId} aria-label={`Restore ${left} deleted product${left === 1 ? '' : 's'}`} style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                    <RotateCcw size={13} aria-hidden='true' /> {busyId === d.deletion_id ? 'Restoring…' : `Restore ${left}`}
                  </GhostBtn>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}
