import { useState, useEffect, useCallback, useRef } from 'react'
import { Modal } from '../../../components/ui'
import { theme } from '../../../styles/theme'
import { customerRepository } from './repository.js'
import LocationMatchBadge from '../LocationMatchBadge.jsx'
import { storedVerification } from '../activityTarget'
import { fmtStamp } from '../formatTime'
import { STAGE_LABEL } from '../../orders/stages'

const { navy, gray500, gray400, border, danger, tealDeep } = theme

// One customer's visits, newest first, each with the orders raised from it. Only visits the viewer may read are
// returned (field_customer_visits runs under the caller's own row level security).
export default function CustomerHistory({ businessId, customer, onClose }) {
  const [state, setState] = useState(null) // null = loading
  const latest = useRef(0)

  const load = useCallback(async () => {
    const request = ++latest.current
    setState(null)
    try {
      const rows = await customerRepository.visits(businessId, customer.key)
      if (latest.current === request) setState({ rows })
    } catch (e) {
      if (latest.current === request) setState({ error: (e && e.message) || 'request failed' })
    }
  }, [businessId, customer.key])
  useEffect(() => { load() }, [load])
  useEffect(() => () => { latest.current = -1 }, [])

  const row = { padding: '10px 0', borderBottom: '1px solid ' + border, fontSize: '12.5px', color: navy }

  return (
    <Modal show onClose={onClose} sheet title={customer.name}>
      {customer.address && <div style={{ fontSize: '12px', color: gray500, marginBottom: '10px' }}>{customer.address}</div>}
      {state === null ? (
        <div role='status' style={{ fontSize: '13px', color: gray500 }}>Loading visits…</div>
      ) : state.error ? (
        <div role='alert' style={{ fontSize: '12.5px', color: danger }}>
          Could not load the visits: {state.error}.{' '}
          <button type='button' onClick={load} style={{ background: 'none', border: 'none', color: tealDeep, fontWeight: 700, cursor: 'pointer', padding: 0 }}>Try again</button>
        </div>
      ) : state.rows.length === 0 ? (
        <div style={{ fontSize: '13px', color: gray400 }}>No visits you can see.</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {state.rows.map((v) => (
            <li key={v.id} style={row}>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontWeight: 800 }}>{fmtStamp(v.created_at)}</span>
                <span>{v.rep_name || 'Unknown rep'}</span>
                <LocationMatchBadge state={storedVerification(v)} />
                {v.photo_count > 0 && <span style={{ color: gray500 }}>{v.photo_count === 1 ? '1 photo' : v.photo_count + ' photos'}</span>}
              </div>
              <div style={{ marginTop: '4px', color: gray500 }}>
                {(v.orders || []).length === 0 ? 'No order from this visit' : (v.orders || []).map((o) => (
                  <div key={o.id}>Order {o.order_ref || '(no reference)'} · {STAGE_LABEL[o.status] || o.status}</div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
