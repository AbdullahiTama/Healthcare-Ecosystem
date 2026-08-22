import { useState, useEffect, useRef } from 'react'
import { MapPin, BadgeCheck, AlertTriangle, Plus, ChevronDown, Search } from 'lucide-react'
import { Button } from '@care-ecosystem/design-system/components/ui'
import { theme } from '../../styles/theme'
import {
  formatDistance, matchesCategory, verifyFacilityMatch,
} from '../../lib/geo.js'
import {
  nearbyHealthFacilities, addRepAddedFacility, FACILITY_FILTERS,
} from '../../lib/places.js'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, gray100, gray50,
  border, danger, dangerBg, success, successBg, warning, warningBg, bg } = theme

// Single source of truth for the facility-capture UI, used by:
//   * the logger (rep is logging a visit, `readOnly=false`) — auto-detects the
//     closest facility on GPS capture and lets the rep swap to any nearby one or
//     add a missing place;
//   * the manager review tool (`readOnly=true`) — opens the SAME filterable
//     nearest-first list centered on the activity's saved GPS so a manager can
//     independently verify what was near, without changing the logged record.
//
// `gps` is required. `value` (controlled) is the chosen facility; `onChange`
// fires when the rep picks one. In readOnly mode onChange is ignored and taps
// only move a local comparison highlight.
export default function FacilityPicker({
  gps, businessId, createdBy, value, onChange, readOnly = false,
}) {
  const [all, setAll] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [fromCache, setFromCache] = useState(false)
  const [filter, setFilter] = useState('all')
  const [listOpen, setListOpen] = useState(false)
  const [customMode, setCustomMode] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customError, setCustomError] = useState(false)
  const [highlight, setHighlight] = useState(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Load the nearest-first list once per GPS fix. The service reads our cache
  // first and only hits Overpass when that cache is thin for this spot.
  useEffect(function () {
    if (!gps) return
    let cancelled = false
    setLoading(true)
    setError(false)
    nearbyHealthFacilities(gps.lat, gps.lng, { radius: 200, category: 'all', businessId })
      .then(function (res) {
        if (cancelled) return
        setAll(res.facilities)
        setFromCache(res.fromCache)
        // Auto-select the single closest facility when nothing is chosen yet.
        if (!readOnly && !value && res.facilities.length > 0) {
          onChangeRef.current(res.facilities[0])
        }
        if (readOnly && value) setHighlight(value)
      })
      .catch(function (e) {
        if (cancelled) return
        console.error('Facility lookup failed:', e)
        setError(true)
      })
      .finally(function () { if (!cancelled) setLoading(false) })
    return function () { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gps && gps.lat, gps && gps.lng, businessId, readOnly])

  const selected = readOnly ? (highlight || value) : value
  const displayed = all.filter(function (f) { return matchesCategory(f, filter) })

  function selectFacility(f) {
    if (readOnly) { setHighlight(f); return }
    onChangeRef.current(f)
    setListOpen(false)
    setCustomMode(false)
  }

  function startCustom() {
    if (readOnly) return
    setCustomMode(true)
    setCustomError(false)
    setCustomName('')
  }

  async function saveCustom() {
    const name = customName.trim()
    if (name.length < 2) { setCustomError(true); return }
    const facility = {
      name: name,
      lat: gps.lat,
      lng: gps.lng,
      category: 'Other health facility',
      address: '',
      source: 'rep_added',
      distanceM: 0,
    }
    // Persist for everyone near here later; failure must not block the log.
    if (businessId) {
      addRepAddedFacility(businessId, facility, createdBy).catch(function () {})
    }
    onChangeRef.current(facility)
    setCustomMode(false)
    setListOpen(false)
  }

  const verified = selected && gps ? verifyFacilityMatch(gps, { lat: selected.lat, lng: selected.lng }) : false

  return (
    <div>
      {/* Selected / auto-detected facility card */}
      <div style={{ padding: '12px', borderRadius: '10px', border: `1px solid ${selected ? border : danger}`,
        background: selected ? bg : dangerBg, marginBottom: '10px' }}>
        {loading && <div style={{ fontSize: '12.5px', color: gray500 }}>Finding facilities near you…</div>}
        {!loading && error && (
          <div style={{ fontSize: '12.5px', color: danger, fontWeight: '700' }}>
            Couldn't reach the facility service. You can still add the place manually below.
          </div>
        )}
        {!loading && !error && !selected && (
          <div style={{ fontSize: '12.5px', color: gray600 }}>
            No health facility detected within 200 m of your GPS.
            {!readOnly && ' Add it below so it is saved with your visit.'}
          </div>
        )}
        {selected && (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <MapPin size={15} style={{ color: tealDeep, flexShrink: 0, marginTop: '2px' }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: '13.5px', fontWeight: '800', color: navy }}>{selected.name}</div>
                <div style={{ fontSize: '11.5px', color: tealDeep, fontWeight: '700', marginTop: '1px' }}>{selected.category}</div>
                {selected.address && (
                  <div style={{ fontSize: '11.5px', color: gray500, marginTop: '2px' }}>{selected.address}</div>
                )}
                <div style={{ fontSize: '11.5px', color: gray500, marginTop: '2px' }}>
                  {gps ? formatDistance(selected.distanceM != null ? selected.distanceM : null) + ' from your GPS' : 'GPS not available'}
                </div>
              </div>
            </div>
            <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              {verified ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', fontWeight: '800', padding: '2px 8px', borderRadius: '20px', background: successBg, color: success }}>
                  <BadgeCheck size={10} /> GPS verified
                </span>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', fontWeight: '800', padding: '2px 8px', borderRadius: '20px', background: warningBg, color: warning }}>
                  <AlertTriangle size={10} /> Unverified
                </span>
              )}
              {fromCache && <span style={{ fontSize: '10px', color: gray400 }}>cached</span>}
              {selected.source === 'rep_added' && (
                <span style={{ fontSize: '10px', color: gray400 }}>rep-added · pending review</span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Controls */}
      {!readOnly && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <Button variant='ghost' size='sm' onClick={function () { setListOpen(function (o) { return !o }) }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Search size={13} /> {listOpen ? 'Hide nearby list' : 'See other facilities nearby'}
            <ChevronDown size={13} style={{ transform: listOpen ? 'rotate(180deg)' : 'none' }} />
          </Button>
          <Button variant='ghost' size='sm' onClick={startCustom}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Plus size={13} /> Not listed? Add this facility
          </Button>
        </div>
      )}

      {readOnly && (
        <Button variant='ghost' size='sm' onClick={function () { setListOpen(function (o) { return !o }) }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
          <Search size={13} /> {listOpen ? 'Hide nearby list' : 'See what else was nearby'}
          <ChevronDown size={13} style={{ transform: listOpen ? 'rotate(180deg)' : 'none' }} />
        </Button>
      )}

      {/* Type filter + scrollable nearest-first list */}
      {listOpen && (
        <div style={{ marginTop: '10px', border: `1px solid ${border}`, borderRadius: '10px', overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', padding: '10px', background: gray50, borderBottom: `1px solid ${border}` }}>
            {FACILITY_FILTERS.map(function (f) {
              const on = filter === f.key
              return (
                <button key={f.key} onClick={function () { setFilter(f.key) }} aria-pressed={on}
                  style={{ fontSize: '11.5px', fontWeight: '700', padding: '6px 11px', borderRadius: '20px', cursor: 'pointer',
                    border: `1px solid ${on ? tealDeep : border}`, background: on ? tealDeep : 'white', color: on ? 'white' : gray500 }}>
                  {f.label}
                </button>
              )
            })}
          </div>
          <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
            {displayed.length === 0 && (
              <div style={{ padding: '18px', fontSize: '12.5px', color: gray400, textAlign: 'center' }}>
                No facilities in this category nearby.
              </div>
            )}
            {displayed.map(function (f, i) {
              const on = selected && selected.name === f.name && selected.lat === f.lat && selected.lng === f.lng
              return (
                <button key={f.id || (f.name + '|' + f.lat + ',' + f.lng)} type='button' onClick={function () { selectFacility(f) }}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', width: '100%',
                    padding: '11px 12px', border: 'none', borderTop: i === 0 ? 'none' : `1px solid ${gray100}`,
                    background: on ? tealMist : 'white', cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: '12.5px', fontWeight: '700', color: navy, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                    <span style={{ display: 'block', fontSize: '11px', color: gray500 }}>{f.category}</span>
                  </span>
                  <span style={{ flexShrink: 0, fontSize: '11.5px', fontWeight: '700', color: tealDeep }}>{formatDistance(f.distanceM)}</span>
                </button>
              )
            })}
          </div>
          {displayed.length >= 150 && (
            <div style={{ padding: '8px', fontSize: '11px', color: gray400, textAlign: 'center', borderTop: `1px solid ${border}` }}>
              Showing the 150 nearest — refine the filter to narrow down.
            </div>
          )}
        </div>
      )}

      {/* Custom (missing) facility */}
      {customMode && (
        <div style={{ marginTop: '10px', padding: '12px', borderRadius: '10px', border: `1px solid ${tealDeep}`, background: tealMist }}>
          <div style={{ fontSize: '11.5px', fontWeight: '800', color: tealDeep, marginBottom: '6px' }}>
            Add a missing facility
          </div>
          <input value={customName} onChange={function (e) { setCustomName(e.target.value); setCustomError(false) }}
            placeholder='Facility name only — your GPS is attached automatically'
            aria-label='Facility name'
            style={{ width: '100%', padding: '11px 12px', borderRadius: '8px', border: `1px solid ${customError ? danger : border}`, fontSize: '13px', boxSizing: 'border-box' }} />
          {customError && <div style={{ fontSize: '11px', color: danger, marginTop: '4px' }}>Enter at least 2 characters.</div>}
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <Button variant='ghost' size='sm' onClick={function () { setCustomMode(false) }}>Cancel</Button>
            <Button variant='primary' size='sm' onClick={saveCustom}>Save facility</Button>
          </div>
        </div>
      )}
    </div>
  )
}
