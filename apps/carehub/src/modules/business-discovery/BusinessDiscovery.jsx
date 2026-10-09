import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Crosshair, Search, List, Map as MapIcon, Download } from 'lucide-react'
import { Card, TealBtn, GhostBtn, Inp, Sel, Pill, Empty, ErrorState, Loading, useToast, Toast } from '../../components/ui'
import { theme } from '../../styles/theme'
import { directoryRepository } from '../business-directory/repositories'
import { useDirectoryLookups } from '../business-directory/components/useDirectoryLookups'
import BusinessProfile from '../business-directory/components/BusinessProfile'
import { VerificationBadge, SourceBadge } from '../business-directory/components/BusinessBadges'
import FieldWorkSwitch from '../field-work/FieldWorkSwitch'
import { parseDiscoveryQuery } from '../business-directory/services/queryParser'
import { searchBusinesses, sortResults, SORTS } from '../business-directory/services/search'
import { geocodePlace } from '../business-directory/services/geocoding'
import { getCurrentPosition } from '../business-directory/services/location'
import { formatDistance } from '../business-directory/services/distance'
import { toExportRow, exportRows } from '../business-directory/services/exportService'
import { NIGERIA_STATES, RADIUS_PRESETS_KM } from '../business-directory/services/constants'

// The map (Leaflet) is only needed when someone opens Map view.
const DiscoveryMap = lazy(() => import('./DiscoveryMap'))

// The map is a nicety: if it fails to load or draw, the list must keep working.
class MapBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) {
      return <div role='alert' style={{ padding: 14, borderRadius: 10, background: theme.warningBg, color: theme.warning, fontSize: 13 }}>The map could not be shown. Your results are still listed below.</div>
    }
    return this.props.children
  }
}

const { navy, gray500, gray600, border, tealDeep, tealMist, danger, info, infoBg } = theme

const EXAMPLES = ['Find pharmacies around me', 'Find hospitals within 5 km', 'Show me 20 cosmetic businesses around Surulere', 'Find eye clinics near me']

function readAuth() {
  try { return JSON.parse(localStorage.getItem('carehub_auth') || '{}') } catch (e) { return {} }
}

/**
 * Business Discovery — SEARCH → RETURN RESULTS → VIEW → EXPORT.
 *
 * Read-only by construction: this component imports no field-activity,
 * notification, attendance or visit function, and the repository calls it makes
 * are GETs plus one "report incorrect information" note. Searching creates no
 * field activity, notifies nobody and marks nothing as visited.
 */
export default function BusinessDiscovery({ brand, perms, allowedModules = [] }) {
  const repo = directoryRepository
  const businessId = brand?.id
  const auth = readAuth()
  const actor = auth?.staff?.email || auth?.brand?.email || brand?.email || null
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const lookups = useDirectoryLookups(businessId, repo)

  const [text, setText] = useState('')
  const [interp, setInterp] = useState(null) // what the parser understood, shown back to the user
  const [categoryId, setCategoryId] = useState('')
  const [subcategoryId, setSubcategoryId] = useState('')
  const [placeText, setPlaceText] = useState('')
  const [useMyLocation, setUseMyLocation] = useState(false)
  const [radiusKm, setRadiusKm] = useState(5)
  const [customRadius, setCustomRadius] = useState('')
  const [quantity, setQuantity] = useState('')
  const [state, setState] = useState('')
  const [lga, setLga] = useState('')
  const [businessType, setBusinessType] = useState('')
  const [verification, setVerification] = useState('')
  const [source, setSource] = useState('')
  const [sort, setSort] = useState('nearest')
  const [includePlatform, setIncludePlatform] = useState(true)

  const [status, setStatus] = useState('idle') // idle | locating | loading | done | error
  const [error, setError] = useState('')
  const [notices, setNotices] = useState([])
  const [out, setOut] = useState(null) // {results,total,truncated,mode}
  const [searchedAt, setSearchedAt] = useState(null) // {center,label,radiusKm}
  const [view, setView] = useState('list')
  const [selectedId, setSelectedId] = useState(null)
  const [profile, setProfile] = useState(null)
  const [exporting, setExporting] = useState(false)
  const listRefs = useRef({})
  const seq = useRef(0)

  const subsForCategory = useMemo(() => lookups.subcategories.filter((s) => s.category_id === categoryId), [lookups.subcategories, categoryId])

  function interpret() {
    const p = parseDiscoveryQuery(text, lookups.categories)
    setInterp(p)
    if (p.category) {
      const c = lookups.categories.find((x) => x.name === p.category)
      setCategoryId(c ? c.id : '')
      setSubcategoryId('')
    }
    if (p.radiusKm) { setRadiusKm(p.radiusKm); setCustomRadius(RADIUS_PRESETS_KM.includes(p.radiusKm) ? '' : String(p.radiusKm)) }
    setQuantity(p.quantity ? String(p.quantity) : '')
    if (p.location?.kind === 'current') { setUseMyLocation(true); setPlaceText('') }
    else if (p.location?.kind === 'named') { setUseMyLocation(false); setPlaceText(p.location.name) }
    return p
  }

  const runSearch = useCallback(async (override) => {
    const mine = ++seq.current
    const params = override || {}
    const wantCurrent = params.useMyLocation ?? useMyLocation
    const place = (params.placeText ?? placeText).trim()
    const catId = params.categoryId ?? categoryId
    const radius = params.radiusKm ?? radiusKm
    const qty = 'quantity' in params ? params.quantity : (quantity ? parseInt(quantity, 10) : null)
    setError('')
    setNotices([])
    setSelectedId(null)
    const notes = []

    try {
      let center = null
      let label = ''
      if (wantCurrent) {
        setStatus('locating')
        const pos = await getCurrentPosition()
        center = { lat: pos.lat, lng: pos.lng }
        label = 'your current location' + (pos.accuracy ? ` (±${Math.round(pos.accuracy)} m)` : '')
      } else if (place) {
        setStatus('locating')
        try {
          const hit = await geocodePlace(place)
          if (hit) { center = { lat: hit.lat, lng: hit.lng }; label = place }
          else notes.push(`“${place}” could not be located on the map, so businesses are matched by the place name in their address instead. Distances are not available.`)
        } catch (e) {
          notes.push(`The map lookup service is unavailable (${e.message}); businesses are matched by place name instead. Distances are not available.`)
        }
      }
      if (mine !== seq.current) return

      setStatus('loading')
      const result = await searchBusinesses(repo, businessId, {
        center, radiusKm: radius, placeName: center ? null : place || null,
        categoryId: catId || undefined, subcategoryId: (params.subcategoryId ?? subcategoryId) || undefined,
        state: (params.state ?? state) || undefined, lga: (params.lga ?? lga).trim() || undefined,
        businessType: (params.businessType ?? businessType).trim() || undefined, verification: (params.verification ?? verification) || undefined,
        source: (params.source ?? source) || undefined, quantity: qty, includePlatform,
        sort: center ? sort : (sort === 'nearest' || sort === 'farthest' ? 'alpha' : sort),
      })
      if (mine !== seq.current) return
      if (result.platformUnavailable) notes.push('The platform registry could not be reached, so only your own directory is shown.')
      if (!center && !place && (sort === 'nearest' || sort === 'farthest')) notes.push('No location was given, so results are listed alphabetically.')
      setNotices(notes)
      setOut(result)
      setSearchedAt(center ? { center, label, radiusKm: radius } : { center: null, label: place, radiusKm: null })
      setStatus('done')
      if (!center) setView('list')
    } catch (e) {
      if (mine !== seq.current) return
      setError(e.message || 'Search failed')
      setStatus('error')
    }
  }, [repo, businessId, useMyLocation, placeText, categoryId, subcategoryId, radiusKm, quantity, state, lga, businessType, verification, source, sort, includePlatform])

  function submitText(e) {
    e && e.preventDefault()
    if (!text.trim()) { showToast('Type what you are looking for, or use the filters below.', { type: 'info' }); return }
    const p = interpret()
    if (!p.understood) {
      showToast('I could not tell what to look for. Try “Find pharmacies near me” — or set the filters below.', { type: 'warning' })
      return
    }
    const cat = p.category ? lookups.categories.find((c) => c.name === p.category) : null
    // A place named in the sentence wins over the controls; otherwise the controls stand.
    // A radius with no place at all ("hospitals within 5 km") means "around me".
    const loc = p.location || (p.radiusKm && !placeText.trim() ? { kind: 'current' } : null)
    runSearch({
      categoryId: cat ? cat.id : categoryId, subcategoryId: '',
      useMyLocation: loc ? loc.kind === 'current' : useMyLocation,
      placeText: loc ? (loc.kind === 'named' ? loc.name : '') : placeText,
      radiusKm: p.radiusKm || radiusKm,
      quantity: p.quantity || null,
    })
    if (loc?.kind === 'current') { setUseMyLocation(true); setPlaceText('') }
  }

  // Changing the sort re-orders what is already on screen — no new GPS fix or network call.
  function changeSort(v) {
    setSort(v)
    setOut((prev) => (prev ? { ...prev, results: sortResults(prev.results, v) } : prev))
  }

  const results = out?.results || []
  const markers = useMemo(() => results.filter((r) => r.latitude != null && r.longitude != null).map((r) => ({
    id: r.id, lat: Number(r.latitude), lng: Number(r.longitude), label: String(results.indexOf(r) + 1), title: r.name,
  })), [results])

  function select(id, fromMap) {
    setSelectedId(id)
    if (fromMap) setTimeout(() => listRefs.current[id]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0)
  }

  async function doExport(format) {
    if (!results.length) return
    setExporting(true)
    try {
      await exportRows(format, results.map((r) => toExportRow(r, lookups.categoryName(r.category_id), lookups.subcategoryName(r.subcategory_id))),
        { baseName: 'business-discovery', title: 'Business Discovery results', subtitle: searchedAt?.label ? 'Near ' + searchedAt.label : brand?.name })
    } catch (e) { showToast('Could not export: ' + e.message, { type: 'error' }) }
    setExporting(false)
  }

  // Copy a platform business into this company's own (private, unverified) directory.
  async function adopt(b) {
    try {
      const { alreadyHad } = await repo.copyFromPlatform(businessId, b, actor)
      showToast(alreadyHad ? 'It is already in your directory.' : 'Added to your directory as an unverified record.', { type: 'success' })
      setProfile(null)
      runSearch() // the platform duplicate now shows as your own record
    } catch (e) { showToast('Could not add it: ' + e.message, { type: 'error' }) }
  }

  async function report(b, message) {
    await repo.reportIncorrect(businessId, b.id, message, actor)
  }

  const noDirectory = status === 'done' && out && out.total === 0 && !categoryId && !placeText && !useMyLocation && !state && !lga.trim() && !businessType.trim() && !verification && !source
  const busy = status === 'locating' || status === 'loading'

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
      <FieldWorkSwitch current='discovery' allowed={allowedModules} />
      <h1 style={{ fontSize: 18, fontWeight: 900, color: navy, margin: 0 }}>Business Discovery</h1>
      <div role='note' style={{ margin: '4px 0 14px', padding: '8px 12px', borderRadius: 10, background: infoBg, color: info, fontSize: 12.5 }}>
        Discovery is for research. Searching does not log a field activity, notify a manager, record attendance or mark any business as visited. To report real field work, use Live Field Report.
      </div>

      <Card style={{ padding: 14, marginBottom: 14 }}>
        <form onSubmit={submitText} role='search' style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label htmlFor='disc-q' style={{ position: 'absolute', left: -9999 }}>Describe what you are looking for</label>
          <input id='disc-q' value={text} onChange={(e) => setText(e.target.value)} placeholder='e.g. Find pharmacies within 3 km of Yaba' maxLength={200}
            style={{ flex: '1 1 320px', minHeight: 44, padding: '9px 12px', borderRadius: 10, border: `1px solid ${border}`, fontSize: 14, boxSizing: 'border-box' }} />
          <TealBtn type='submit' disabled={busy || lookups.loading} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Search size={15} aria-hidden='true' /> Search</TealBtn>
        </form>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {EXAMPLES.map((ex) => (
            <button key={ex} type='button' onClick={() => setText(ex)}
              style={{ fontSize: 11.5, padding: '5px 10px', borderRadius: 20, border: `1px solid ${border}`, background: 'white', color: gray600, cursor: 'pointer' }}>{ex}</button>
          ))}
        </div>

        {interp && (
          <div aria-live='polite' style={{ marginTop: 10, fontSize: 12.5, color: gray600 }}>
            {interp.understood ? <>Understood: <strong>{interp.category || 'any category'}</strong>
              {interp.quantity ? <> · up to <strong>{interp.quantity}</strong></> : null}
              {interp.radiusKm ? <> · within <strong>{interp.radiusKm} km</strong></> : null}
              {interp.location ? <> · near <strong>{interp.location.kind === 'current' ? 'me' : interp.location.name}</strong></> : null}
              {!interp.category && ' — pick a category below to narrow it down'}.</> : 'I could not understand that. Use the filters below.'}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginTop: 12 }}>
          <Sel label='Category' value={categoryId} onChange={(v) => { setCategoryId(v); setSubcategoryId('') }} options={lookups.categories.map((c) => ({ value: c.id, label: c.name }))} placeholder='Any category' id='disc-cat' />
          {subsForCategory.length > 0 && <Sel label='Subcategory' value={subcategoryId} onChange={setSubcategoryId} options={subsForCategory.map((s) => ({ value: s.id, label: s.name }))} placeholder='Any' id='disc-sub' />}
          <Inp label='Search around (place or address)' value={placeText} onChange={(v) => { setPlaceText(v); if (v) setUseMyLocation(false) }} placeholder='e.g. Yaba, Ikeja, Surulere' id='disc-place' />
          <Sel label='State' value={state} onChange={setState} options={NIGERIA_STATES} placeholder='Any state' id='disc-state' />
          <Inp label='LGA' value={lga} onChange={(v) => setLga(v.slice(0, 80))} placeholder='e.g. Ikeja' id='disc-lga' />
          <Inp label='Business type' value={businessType} onChange={(v) => setBusinessType(v.slice(0, 80))} placeholder='e.g. Private, Chain' id='disc-btype' />
          <Sel label='Verification' value={verification} onChange={setVerification} options={[{ value: 'verified', label: 'Verified only' }, { value: 'unverified', label: 'Unverified' }]} placeholder='Any' id='disc-ver' />
          <Sel label='Source' value={source} onChange={setSource} options={[{ value: 'manual', label: 'Manual entry' }, { value: 'import', label: 'Imported' }, { value: 'external', label: 'External source' }, { value: 'demo', label: 'DEMO DATA' }]} placeholder='Any' id='disc-src' />
          <Inp label='Show up to' value={quantity} onChange={(v) => setQuantity(v.replace(/\D/g, '').slice(0, 4))} placeholder='All' inputMode='numeric' id='disc-qty' />
        </div>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: gray600, marginTop: 12 }}>
          <input type='checkbox' checked={includePlatform} onChange={(e) => setIncludePlatform(e.target.checked)} style={{ accentColor: tealDeep }} />
          Include the platform registry (verified businesses shared with every company)
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
          <GhostBtn onClick={() => { setUseMyLocation(true); setPlaceText(''); runSearch({ useMyLocation: true, placeText: '' }) }} disabled={busy}
            style={{ display: 'inline-flex', gap: 6, alignItems: 'center', ...(useMyLocation ? { borderColor: tealDeep, background: tealMist, color: tealDeep } : {}) }}>
            <Crosshair size={14} aria-hidden='true' /> Use my current location
          </GhostBtn>
          <span style={{ fontSize: 12, fontWeight: 700, color: gray600, marginLeft: 6 }}>Radius</span>
          {RADIUS_PRESETS_KM.map((km) => (
            <button key={km} type='button' aria-pressed={radiusKm === km && !customRadius} onClick={() => { setRadiusKm(km); setCustomRadius('') }}
              style={{ fontSize: 12, fontWeight: 700, padding: '7px 12px', borderRadius: 20, cursor: 'pointer', border: `1px solid ${radiusKm === km && !customRadius ? tealDeep : border}`, background: radiusKm === km && !customRadius ? tealDeep : 'white', color: radiusKm === km && !customRadius ? 'white' : gray600 }}>
              {km} km
            </button>
          ))}
          <input aria-label='Custom radius in kilometres' value={customRadius} placeholder='Custom km' inputMode='decimal'
            onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, '').slice(0, 5); setCustomRadius(v); const n = parseFloat(v); if (n > 0 && n <= 500) setRadiusKm(n) }}
            style={{ width: 96, minHeight: 36, padding: '6px 10px', borderRadius: 20, border: `1px solid ${customRadius ? tealDeep : border}`, fontSize: 12 }} />
          <TealBtn onClick={() => runSearch()} disabled={busy || lookups.loading} style={{ marginLeft: 'auto' }}>Search with these filters</TealBtn>
        </div>
      </Card>

      {lookups.error && <ErrorState message={lookups.error} onRetry={lookups.reload} />}

      {busy && <Loading text={status === 'locating' ? 'Finding the location…' : 'Searching the Business Directory…'} />}
      {status === 'error' && <ErrorState message={error} onRetry={() => runSearch()} />}

      {status === 'done' && out && (
        <div aria-live='polite'>
          {notices.map((n) => <div key={n} role='note' style={{ fontSize: 12.5, color: theme.warning, background: theme.warningBg, padding: '8px 12px', borderRadius: 10, marginBottom: 8 }}>{n}</div>)}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <div style={{ fontSize: 13, color: navy, fontWeight: 700 }}>
              {out.total === 0 ? 'No results' : `${results.length} result${results.length === 1 ? '' : 's'}${out.truncated ? ` of ${out.total.toLocaleString()}` : ''}`}
              {searchedAt?.center && <span style={{ fontWeight: 400, color: gray600 }}> within {searchedAt.radiusKm} km of {searchedAt.label}</span>}
              {!searchedAt?.center && searchedAt?.label && <span style={{ fontWeight: 400, color: gray600 }}> matching “{searchedAt.label}”</span>}
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ fontSize: 12, color: gray600, fontWeight: 700 }} htmlFor='disc-sort'>Sort</label>
              <select id='disc-sort' value={sort} onChange={(e) => changeSort(e.target.value)} style={{ padding: '8px', borderRadius: 8, border: `1px solid ${border}`, fontSize: 12.5 }}>
                {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {[['list', 'List', List], ['map', 'Map', MapIcon]].map(([v, l, Icon]) => (
                <button key={v} aria-pressed={view === v} onClick={() => setView(v)} disabled={v === 'map' && markers.length === 0}
                  title={v === 'map' && markers.length === 0 ? 'None of these results have coordinates' : undefined}
                  style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 12.5, fontWeight: 800, padding: '8px 14px', borderRadius: 10, cursor: 'pointer', border: `1px solid ${view === v ? tealDeep : border}`, background: view === v ? navy : 'white', color: view === v ? 'white' : gray600, opacity: v === 'map' && markers.length === 0 ? 0.5 : 1 }}>
                  <Icon size={14} aria-hidden='true' /> {l}
                </button>
              ))}
            </div>
          </div>

          {out.total === 0 ? (
            <Card style={{ padding: 8 }}>
              <Empty cause='filtered'
                message={noDirectory
                  ? 'Your Business Directory has no businesses yet. Ask the Owner to add or import some in Business Directory.'
                  : (verification === 'verified' ? 'No verified result was found for this search.' : 'No matching business was found in your Business Directory.') + ' Nothing is invented to fill the gap — try a wider radius, another category, or ask for more businesses to be added.'}
                action={searchedAt?.center && radiusKm < 25 ? 'Widen radius to 25 km' : undefined}
                onAction={() => { setRadiusKm(25); setCustomRadius(''); runSearch({ radiusKm: 25 }) }} />
            </Card>
          ) : (
            <>
              {view === 'map' && (
                <div style={{ marginBottom: 12 }}>
                  <MapBoundary>
                    <Suspense fallback={<Loading text='Loading map…' />}>
                      <DiscoveryMap markers={markers} center={searchedAt?.center} radiusKm={searchedAt?.radiusKm} selectedId={selectedId} onSelect={(id) => select(id, true)} />
                    </Suspense>
                  </MapBoundary>
                  {results.length > markers.length && <div style={{ fontSize: 12, color: gray500, marginTop: 6 }}>{results.length - markers.length} result(s) have no coordinates and are listed but not on the map.</div>}
                </div>
              )}
              <Card style={{ padding: 0 }}>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {results.map((r, i) => {
                    const on = r.id === selectedId
                    return (
                      <li key={r.id} ref={(el) => { listRefs.current[r.id] = el }}
                        style={{ borderTop: i ? `1px solid ${border}` : 'none', background: on ? tealMist : 'transparent', padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                        <span aria-hidden='true' style={{ width: 26, height: 26, borderRadius: '50%', background: on ? danger : tealDeep, color: 'white', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                        <button onClick={() => { select(r.id); if (view === 'map' && r.latitude == null) showToast('This business has no coordinates.', { type: 'info' }) }}
                          aria-pressed={on} style={{ all: 'unset', cursor: 'pointer', flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 800, color: navy, fontSize: 14 }}>{r.name}</div>
                          <div style={{ fontSize: 12, color: gray600 }}>{[lookups.categoryName(r.category_id), lookups.subcategoryName(r.subcategory_id)].filter(Boolean).join(' · ') || 'Uncategorised'}</div>
                          <div style={{ fontSize: 12.5, color: gray600, marginTop: 2 }}>{[r.address, r.city, r.state].filter(Boolean).join(', ')}</div>
                          <div style={{ fontSize: 12.5, color: gray500, marginTop: 2 }}>{[r.phone, r.email].filter(Boolean).join(' · ')}</div>
                          <div style={{ display: 'flex', gap: 5, marginTop: 6, flexWrap: 'wrap' }}><VerificationBadge status={r.verification_status} />{r.origin === 'platform' ? <Pill label='Platform registry' type='purple' /> : <SourceBadge source={r.data_source} />}</div>
                        </button>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          {r.distance_km != null && <div style={{ fontWeight: 800, color: tealDeep, fontSize: 14 }}>{formatDistance(r.distance_km)}</div>}
                          <GhostBtn onClick={() => { select(r.id); setProfile(r) }} style={{ marginTop: 6 }}>Details</GhostBtn>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </Card>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: gray600 }}>Export {results.length} result{results.length === 1 ? '' : 's'}:</span>
                {[['csv', 'CSV'], ['xlsx', 'Excel'], ['pdf', 'PDF'], ['json', 'JSON']].map(([f, l]) => (
                  <GhostBtn key={f} onClick={() => doExport(f)} disabled={exporting} style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><Download size={13} aria-hidden='true' />{l}</GhostBtn>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {status === 'idle' && !lookups.loading && (
        <Empty icon='🧭' message='Type what you are looking for, or choose a category and a location, then search.' />
      )}

      {profile && (
        <BusinessProfile business={profile} categoryName={lookups.categoryName(profile.category_id)} subcategoryName={lookups.subcategoryName(profile.subcategory_id)}
          onClose={() => setProfile(null)} onToast={showToast} onReport={report} onAdopt={perms?.canManageDirectory ? adopt : undefined}
          onViewOnMap={(b) => { setProfile(null); setView('map'); select(b.id) }} />
      )}
    </div>
  )
}
