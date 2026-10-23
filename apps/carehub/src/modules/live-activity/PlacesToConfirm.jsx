import { useState, useEffect, useCallback } from 'react'
import { getRepAddedFacilities, confirmRepAddedFacility, dismissRepAddedFacility } from '../../lib/places.js'
import { staffRepository } from '../staff/repositories'
import { Loading } from '../../components/ui'
import { fmtStamp } from './formatTime'
import { theme } from '../../styles/theme'

const { tealDeep, navy, gray500, gray400, border, danger, dangerBg, success } = theme

// Places reps added because they were not on the map. A field manager confirms one into a normal entry that
// everyone near it will see, or dismisses it. Loads its own data so it works as a page (Field team > Places
// to confirm) or inside a sheet.
//   people     optional [{ id, full_name }] the page already has, to name who added each place
//   onChanged  called after a confirm or dismiss
export default function PlacesToConfirm({ businessId, people, onChanged }) {
  const [places, setPlaces] = useState(null) // null = loading
  const [loadError, setLoadError] = useState('')
  const [names, setNames] = useState(people || [])
  const [message, setMessage] = useState(null)

  const load = useCallback(async () => {
    setLoadError('')
    setPlaces(null)
    try {
      const rows = await getRepAddedFacilities(businessId, 'pending_review')
      setPlaces(Array.isArray(rows) ? rows : [])
    } catch (e) {
      setLoadError(e && e.message ? e.message : 'request failed')
      setPlaces([])
    }
  }, [businessId])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (people) return
    let alive = true
    staffRepository.getAll(businessId).then((rows) => { if (alive) setNames(rows || []) }).catch(() => {})
    return () => { alive = false }
  }, [businessId, people])

  async function act(fn, okText) {
    setMessage(null)
    try {
      await fn()
      setMessage({ kind: 'ok', text: okText })
      await load()
      if (onChanged) onChanged()
    } catch (e) {
      setMessage({ kind: 'error', text: 'That did not work: ' + e.message })
    }
  }

  return (
    <div>
      <div style={{ fontSize: '11.5px', color: gray500, marginBottom: '14px' }}>
        Facilities reps added because they weren't in the map. Confirm to make one a normal entry everyone near that spot will see, or dismiss it if it's wrong.
      </div>
      {message && (
        <div role={message.kind === 'error' ? 'alert' : 'status'} style={{ fontSize: '12px', color: message.kind === 'error' ? danger : tealDeep, marginBottom: '10px' }}>
          {message.text}
        </div>
      )}
      {places === null ? <Loading text='Loading places to confirm...' /> : loadError ? (
        <div role='alert' style={{ fontSize: '12.5px', color: danger }}>
          Could not load places to confirm: {loadError}.{' '}
          <button type='button' onClick={load} style={{ background: 'none', border: 'none', color: tealDeep, fontWeight: 700, cursor: 'pointer', padding: 0 }}>Try again</button>
        </div>
      ) : places.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: gray400, fontSize: '13px' }}>No facilities awaiting review.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {places.map(function (f) {
            const addedBy = (names.find(function (s) { return s.id === f.created_by }) || {}).full_name
            return (
              <div key={f.id} style={{ padding: '12px 14px', borderRadius: '10px', border: `1px solid ${border}` }}>
                <div style={{ fontSize: '13.5px', fontWeight: '800', color: navy }}>{f.name}</div>
                <div style={{ fontSize: '11.5px', color: gray500, marginTop: '2px' }}>
                  {f.category || 'Other health facility'}
                  {addedBy ? ' · added by ' + addedBy : ''}
                  {f.created_at ? ' · ' + fmtStamp(f.created_at) : ''}
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                  <button type='button' onClick={function () { act(() => confirmRepAddedFacility(f.id, businessId), 'Facility confirmed. It now appears for everyone near it.') }}
                    style={{ border: 'none', background: success, color: 'white', borderRadius: '8px', padding: '8px 16px', fontSize: '12px', fontWeight: '800', cursor: 'pointer', minHeight: '36px' }}>
                    Confirm
                  </button>
                  <button type='button' onClick={function () { act(() => dismissRepAddedFacility(f.id), 'Facility dismissed.') }}
                    style={{ border: `1px solid ${danger}`, background: dangerBg, color: danger, borderRadius: '8px', padding: '8px 16px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', minHeight: '36px' }}>
                    Dismiss
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
