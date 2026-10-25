import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { theme } from '../../../styles/theme'
import LeafletMap from '../../../components/maps/LeafletMap.jsx'
import { fetchOsmBusinesses, safeWebsite } from './osmBusinesses.js'
import { matchToDirectory, OSM_SOURCE_PREFIX } from './matchListings.js'

const { navy, gray500, gray600, border, danger, tealDeep, warning, bg } = theme

// Searching is only allowed close in (about a town or a neighbourhood): small Overpass requests, fair use.
export const MIN_SEARCH_ZOOM = 13
const STATUS_TEXT = { new: 'Not in the directory', listed: 'Already listed', duplicate: 'May already be listed' }
const TONE = { new: 'new', listed: 'listed', duplicate: 'duplicate' }

// Centre and radius (km) that cover the visible box, for the directory's existing area search.
function circleAround(b) {
  const lat = (b.south + b.north) / 2
  const lng = (b.west + b.east) / 2
  const dLat = (b.north - b.south) / 2 * 111
  const dLng = (b.east - b.west) / 2 * 111 * Math.cos(lat * Math.PI / 180)
  return { lat, lng, radiusKm: Math.sqrt(dLat * dLat + dLng * dLng) }
}

export function prefillFromOsm(b) {
  return {
    fromMap: b.ref, name: b.name, category_id: b.category.id, address: b.address, state: b.state, lga: b.lga, city: b.city,
    latitude: b.lat, longitude: b.lng, phone: b.phone, website: safeWebsite(b.website) || '', opening_hours: b.openingHours,
    data_source: 'external', source_detail: OSM_SOURCE_PREFIX + b.ref,
  }
}

// Platform admin > Directory > Map. One search per press of the button; each business found on OpenStreetMap is
// matched against the directory and can be added through the usual business form (onAdd opens it pre-filled).
// reloadKey changes after a save, so the listings are read again and the added business shows as listed.
export default function MapTab({ repo, scopeId, categories, onAdd, reloadKey = 0, fetchOsm = fetchOsmBusinesses }) {
  const [view, setView] = useState(null) // { bounds, zoom }
  const [state, setState] = useState({ phase: 'idle', osm: [], listings: [], bounds: null, error: '' })
  const [selected, setSelected] = useState(null)
  const [categoryId, setCategoryId] = useState('')
  const [hideListed, setHideListed] = useState(false)
  const latest = useRef(0)

  const search = useCallback(async (bounds) => {
    const request = ++latest.current
    setState((s) => ({ ...s, phase: 'searching', error: '' }))
    setSelected(null)
    try {
      const [osm, listings] = await Promise.all([fetchOsm(bounds), repo.searchWithinBox(scopeId, circleAround(bounds), {}, { limit: 2000 })])
      if (latest.current === request) setState({ phase: 'done', osm, listings: listings || [], bounds, error: '' })
    } catch (e) {
      if (latest.current === request) setState((s) => ({ ...s, phase: 'error', bounds, error: (e && e.message) || 'request failed' }))
    }
  }, [fetchOsm, repo, scopeId])
  useEffect(() => () => { latest.current = -1 }, [])

  // After an add, read the listings of the searched area again (OpenStreetMap is not asked again).
  useEffect(() => {
    if (!reloadKey || !state.bounds || state.phase !== 'done') return
    const request = ++latest.current
    repo.searchWithinBox(scopeId, circleAround(state.bounds), {}, { limit: 2000 })
      .then((listings) => { if (latest.current === request) setState((s) => ({ ...s, listings: listings || [] })) })
      .catch(() => {})
  }, [reloadKey]) // dependencies deliberately limited: only a save re-reads (no react-hooks lint plugin, docs/architecture/Linting.md section 5)

  const matched = useMemo(() => matchToDirectory(state.osm, state.listings, categories), [state.osm, state.listings, categories])
  const shown = matched.filter((b) => (!categoryId || b.category.id === categoryId) && !(hideListed && b.status === 'listed'))
  const foundCategories = useMemo(() => {
    const m = new Map()
    matched.forEach((b) => m.set(b.category.id, b.category.name))
    return [...m.entries()]
  }, [matched])
  const pins = shown.map((b) => ({ id: b.ref, kind: 'business', tone: TONE[b.status], lat: b.lat, lng: b.lng, title: b.name, lines: [b.category.name, STATUS_TEXT[b.status]] }))
  const current = selected ? matched.find((b) => b.ref === selected) : null
  const zoomedIn = view && view.zoom >= MIN_SEARCH_ZOOM

  const btn = { fontSize: '12.5px', fontWeight: 800, padding: '9px 14px', borderRadius: '8px', cursor: 'pointer', minHeight: '38px' }
  const primary = { ...btn, border: 'none', background: tealDeep, color: 'white' }
  const row = { width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', padding: '9px 10px', border: '1px solid ' + border, borderRadius: '8px', background: 'white', cursor: 'pointer', fontSize: '12.5px', color: navy }

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '8px' }}>
        <button type='button' disabled={!zoomedIn || state.phase === 'searching'} onClick={() => search(view.bounds)} style={{ ...primary, opacity: zoomedIn ? 1 : 0.5 }}>Show businesses here</button>
        <select aria-label='Category' value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid ' + border, fontSize: '13px', background: 'white', color: navy }}>
          <option value=''>All managed kinds</option>
          {foundCategories.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: gray500 }}>
          <input type='checkbox' checked={hideListed} onChange={(e) => setHideListed(e.target.checked)} /> Hide already listed
        </label>
      </div>
      <div role='status' style={{ fontSize: '12px', color: gray500, marginBottom: '8px' }}>
        {!zoomedIn ? 'Zoom in closer (to a town or neighbourhood) to search.'
          : state.phase === 'idle' ? 'Move the map to an area and press Show businesses here.'
          : state.phase === 'searching' ? 'Looking for businesses…'
          : state.phase === 'done' ? (matched.length === 1 ? '1 business found' : matched.length + ' businesses found') + ' of the kinds the directory manages.'
          : ''}
      </div>
      {state.phase === 'error' && (
        <div role='alert' style={{ fontSize: '12.5px', color: danger, marginBottom: '8px' }}>
          {state.error}{' '}
          <button type='button' onClick={() => search(state.bounds)} style={{ background: 'none', border: 'none', color: tealDeep, fontWeight: 700, cursor: 'pointer', padding: 0 }}>Try again</button>
        </div>
      )}

      <LeafletMap pins={pins} fit={false} height={typeof window !== 'undefined' && window.innerWidth < 640 ? 320 : 460}
        onViewChange={(bounds, zoom) => setView({ bounds, zoom })} onPinClick={(p) => setSelected(p.id)} />
      <div style={{ fontSize: '11px', color: gray500, margin: '6px 0 12px' }}>
        Business data © <a href='https://www.openstreetmap.org/copyright' target='_blank' rel='noopener noreferrer' style={{ color: gray500 }}>OpenStreetMap contributors</a> (ODbL). Added businesses come in unverified.
      </div>

      {current && (
        <section aria-label='Business details' style={{ padding: '14px', borderRadius: '10px', border: '1px solid ' + border, background: 'white', marginBottom: '12px' }}>
          <div style={{ fontWeight: 800, color: navy, fontSize: '14px' }}>{current.name}</div>
          <div style={{ fontSize: '12px', color: gray600, marginTop: '2px' }}>{current.category.name}</div>
          {current.address && <div style={{ fontSize: '12.5px', color: gray600, marginTop: '6px' }}>{current.address}{current.state ? ', ' + current.state : ''}</div>}
          {current.phone && <div style={{ fontSize: '12.5px', color: gray600 }}>Phone: {current.phone}</div>}
          {current.website && (
            <div style={{ fontSize: '12.5px', color: gray600 }}>Website: {safeWebsite(current.website)
              ? <a href={safeWebsite(current.website)} target='_blank' rel='noopener noreferrer'>{current.website}</a>
              : current.website}</div>
          )}
          {current.openingHours && <div style={{ fontSize: '12.5px', color: gray600 }}>Opening hours: {current.openingHours}</div>}
          <div style={{ fontSize: '12px', marginTop: '4px' }}>
            <a href={'https://www.openstreetmap.org/' + current.ref} target='_blank' rel='noopener noreferrer' style={{ color: tealDeep }}>View on OpenStreetMap</a>
          </div>
          {current.status === 'listed' ? (
            <div role='status' style={{ marginTop: '10px', padding: '8px 10px', borderRadius: '8px', background: bg, fontSize: '12.5px', color: gray500 }}>
              Already in the directory as {current.match ? current.match.name : 'a listing'}.
            </div>
          ) : (
            <>
              {current.status === 'duplicate' && (
                <div role='status' style={{ marginTop: '10px', fontSize: '12.5px', color: warning }}>
                  May already be listed as {current.match ? current.match.name : 'another listing'}. Check before adding.
                </div>
              )}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                <button type='button' style={primary} onClick={() => onAdd(prefillFromOsm(current))}>{current.status === 'duplicate' ? 'Add anyway' : 'Add to directory'}</button>
                <button type='button' style={{ ...btn, border: '1px solid ' + border, background: 'white', color: navy }} onClick={() => setSelected(null)}>Close</button>
              </div>
            </>
          )}
        </section>
      )}

      {state.phase === 'done' && matched.length === 0 && (
        <div style={{ padding: '16px', borderRadius: '10px', background: bg, fontSize: '13px', color: gray500 }}>No businesses of the kinds the directory manages were found here.</div>
      )}
      {shown.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {shown.map((b) => (
            <li key={b.ref}>
              <button type='button' onClick={() => setSelected(b.ref)} style={row}>
                <span><b>{b.name}</b> · {b.category.name}</span>
                <span style={{ color: b.status === 'listed' ? gray500 : b.status === 'duplicate' ? warning : tealDeep }}>{STATUS_TEXT[b.status]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
