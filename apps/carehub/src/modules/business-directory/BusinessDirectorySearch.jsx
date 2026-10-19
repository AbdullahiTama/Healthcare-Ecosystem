import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Search, LocateFixed, Download, MapPin, Navigation, Phone, Globe, Mail } from 'lucide-react'
import { Button, Input, Select, Pill, Loading, Empty, ErrorState, Toast, useToast } from '../../components/ui'
import { directoryRepository } from '../directory/repositories'
import { createDiscoveryService, buildDirectoryCsv } from './discoveryService'
import { parseSearchText, interpretationToFilters, parseCustomRadiusKm, radiusLabel, RADIUS_OPTIONS_M, DEFAULT_RADIUS_M, DEFAULT_LIMIT } from './searchQuery'
import { captureLocation } from './locationCapture'
import { directionsUrl, viewOnMapUrl, distanceLabel } from './mapsLinks'
import { isValidLatLng } from '../directory/directoryRecord'
import { NIGERIA_STATES, centreForState } from '../../lib/nigeriaGeo'
import DirectoryMap from './DirectoryMap'

// Business Discovery over the central directory. READ-ONLY by construction:
// the only things this screen calls are directory_search (a read), category
// reads, and a client-side CSV download. Searching, selecting, opening
// directions or exporting never creates a field activity, a visit, attendance
// or a notification.

const VERIF_PILL = { verified: 'green', pending: 'amber', rejected: 'red', unverified: 'gray' }
const VERIF_LABEL = { verified: 'Verified', pending: 'Verification pending', rejected: 'Rejected', unverified: 'Not verified' }
const SORT_LABEL = { name: 'Name (A-Z)', distance: 'Nearest first', verified: 'Verified first', recent: 'Recently added' }

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}

export default function BusinessDirectorySearch({ perms, repo = directoryRepository }) {
  const service = useMemo(() => createDiscoveryService(repo), [repo])
  const canExport = !!(perms && perms.canExportReports)
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()

  const [categories, setCategories] = useState([])
  const [nl, setNl] = useState('')
  const [notes, setNotes] = useState([])
  const [f, setF] = useState({ q: '', categoryId: '', subcategoryId: '', state: '', lga: '', place: '', verification: '', source: '', sort: 'name', radiusM: DEFAULT_RADIUS_M, limit: DEFAULT_LIMIT })
  const [customKm, setCustomKm] = useState('')
  const [origin, setOrigin] = useState(null) // { lat, lng, label, kind, accuracyM, lowAccuracy }
  const [locBusy, setLocBusy] = useState(false)
  const [locError, setLocError] = useState('')
  const [manual, setManual] = useState({ lat: '', lng: '' })
  const [page, setPage] = useState(0)
  const [res, setRes] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [exporting, setExporting] = useState(false)
  const seq = useRef(0)
  const rowRefs = useRef(new Map())

  useEffect(() => { repo.listCategories().then(setCategories).catch(() => {}) }, [repo])

  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }))
  const topCats = categories.filter((c) => !c.parent_id)
  const subCats = categories.filter((c) => c.parent_id && c.parent_id === f.categoryId)

  const run = useCallback(async (pageIndex, nextOrigin, nextFilters) => {
    const o = nextOrigin === undefined ? origin : nextOrigin
    const flt = nextFilters || f
    const mine = ++seq.current
    setLoading(true); setError(''); setPage(pageIndex)
    try {
      const out = await service.search({ ...flt, lat: o ? o.lat : null, lng: o ? o.lng : null, offset: pageIndex * flt.limit })
      if (mine !== seq.current) return // a newer search superseded this one
      setRes(out); setSelectedId(null)
    } catch (e) {
      if (mine !== seq.current) return
      setError(e.message || 'Search failed.'); setRes(null)
    } finally { if (mine === seq.current) setLoading(false) }
  }, [service, origin, f])

  async function findMe() {
    setLocBusy(true); setLocError('')
    const r = await captureLocation()
    setLocBusy(false)
    if (!r.ok) { setLocError(r.message); return null }
    const o = { lat: r.lat, lng: r.lng, kind: 'device', label: 'Your current location', accuracyM: r.accuracyM, lowAccuracy: r.lowAccuracy }
    setOrigin(o)
    return o
  }

  // Opt-in only: choosing a State filter must not silently become a radius
  // search. The centre is a coarse stand-in for the state, and says so.
  function useStateCentre() {
    const c = f.state ? centreForState(f.state) : null
    if (!c) return
    setLocError(''); setOrigin({ lat: c.lat, lng: c.lng, kind: 'state_centre', label: 'Approximate centre of ' + f.state })
    set('sort')('distance')
  }

  function applyManual() {
    const lat = Number(manual.lat), lng = Number(manual.lng)
    if (manual.lat === '' || manual.lng === '' || !isValidLatLng(lat, lng)) { setLocError('Enter a latitude between -90 and 90 and a longitude between -180 and 180.'); return }
    setLocError(''); setOrigin({ lat, lng, kind: 'manual', label: 'Location you entered' })
  }

  async function interpret() {
    const parsed = parseSearchText(nl)
    const next = { ...f, ...interpretationToFilters(parsed, categories), sort: f.sort }
    setNotes(parsed.needsReview ? ['I could not tell what to search for. Check the filters below.', ...parsed.notes] : parsed.notes)
    setF(next)
    let o = origin
    if (parsed.near === 'me') o = (await findMe()) || null
    run(0, o, { ...next, sort: o ? 'distance' : next.sort })
    if (o) set('sort')('distance')
  }

  async function exportCsv() {
    setExporting(true)
    try {
      const out = await service.exportAll({ ...f, lat: origin ? origin.lat : null, lng: origin ? origin.lng : null })
      download('business-directory-' + new Date().toISOString().slice(0, 10) + '.csv', buildDirectoryCsv(out.rows, categories))
      showToast('Exported ' + out.rows.length + ' of ' + out.total + (out.truncated ? '. Limited to the first ' + out.rows.length + '; narrow the filters for the rest.' : ''), { type: out.truncated ? 'warning' : 'success', duration: 7000 })
    } catch (e) { showToast('Could not export: ' + e.message, { type: 'error' }) }
    finally { setExporting(false) }
  }

  const rows = res ? res.rows : []
  const mapMarkers = useMemo(() => rows.filter((r) => isValidLatLng(r.latitude, r.longitude)).map((r) => ({ id: r.id, lat: r.latitude, lng: r.longitude, name: r.name })), [rows])
  const selected = rows.find((r) => r.id === selectedId) || null
  const catName = (id) => (categories.find((c) => c.id === id) || {}).name || ''
  const select = (id) => { setSelectedId(id); const el = rowRefs.current.get(id); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }) }
  const hasPoint = !!origin

  return (
    <div style={{ padding: 20, maxWidth: 1100, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
        Search the shared business directory. Finding or opening a business does not log a visit or notify anyone; record real visits in Live Field Activity.
      </p>

      <form onSubmit={(e) => { e.preventDefault(); interpret() }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Input label="Describe what you need" value={nl} onChange={setNl} placeholder='e.g. "pharmacies within 5 km around me" or "hospitals in Lagos"' style={{ flex: '1 1 320px' }} />
        <Button type="submit" variant="primary" size="md"><Search size={14} aria-hidden="true" /> Interpret and search</Button>
      </form>
      {notes.length > 0 && <ul aria-label="How your request was interpreted" style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--muted)' }}>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}

      <fieldset style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--panel)' }}>
        <legend style={{ fontSize: 12, fontWeight: 700 }}>Filters</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Input label="Business name" value={f.q} onChange={set('q')} style={{ flex: '2 1 180px' }} />
          <Select label="Category" value={f.categoryId} onChange={(v) => setF((x) => ({ ...x, categoryId: v, subcategoryId: '' }))} placeholder="All" options={topCats.map((c) => ({ value: c.id, label: c.name }))} style={{ flex: '1 1 170px' }} />
          {subCats.length > 0 && <Select label="Subcategory" value={f.subcategoryId} onChange={set('subcategoryId')} placeholder="All" options={subCats.map((c) => ({ value: c.id, label: c.name }))} style={{ flex: '1 1 170px' }} />}
          <Select label="State" value={f.state} onChange={set('state')} placeholder="Any" options={NIGERIA_STATES.map((s) => s.name)} style={{ flex: '1 1 150px' }} />
          <Input label="LGA" value={f.lga} onChange={set('lga')} style={{ flex: '1 1 130px' }} />
          <Input label="Town, area or address" value={f.place} onChange={set('place')} style={{ flex: '1 1 170px' }} />
          <Select label="Verification" value={f.verification} onChange={set('verification')} placeholder="Any" options={Object.entries(VERIF_LABEL).map(([v, l]) => ({ value: v, label: l }))} style={{ flex: '1 1 150px' }} />
          <Select label="Data source" value={f.source} onChange={set('source')} placeholder="Any" options={['manual', 'import', 'osm', 'google', 'regulatory', 'partner', 'other']} style={{ flex: '1 1 130px' }} />
          <Select label="Sort by" value={f.sort} onChange={(v) => set('sort')(v || 'name')} placeholder="Name (A-Z)" options={Object.entries(SORT_LABEL).filter(([k]) => k !== 'distance' || hasPoint).map(([v, l]) => ({ value: v, label: l }))} style={{ flex: '1 1 150px' }} />
        </div>
      </fieldset>

      <fieldset style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--panel)' }}>
        <legend style={{ fontSize: 12, fontWeight: 700 }}>Location and radius</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
          <Button variant="ghost" size="md" disabled={locBusy} onClick={async () => { const o = await findMe(); if (o) set('sort')('distance') }}><LocateFixed size={14} aria-hidden="true" /> {locBusy ? 'Finding you...' : 'Use my location'}</Button>
          <Button variant="ghost" size="md" disabled={!f.state} onClick={useStateCentre}>{f.state ? 'Use centre of ' + f.state : 'Use centre of state'}</Button>
          <Input label="Latitude" value={manual.lat} onChange={(v) => setManual((m) => ({ ...m, lat: v }))} style={{ width: 110 }} />
          <Input label="Longitude" value={manual.lng} onChange={(v) => setManual((m) => ({ ...m, lng: v }))} style={{ width: 110 }} />
          <Button variant="ghost" size="md" onClick={applyManual}>Use these coordinates</Button>
          <Select label="Radius" value={String(RADIUS_OPTIONS_M.includes(f.radiusM) ? f.radiusM : 'custom')} onChange={(v) => { if (v && v !== 'custom') set('radiusM')(Number(v)) }} placeholder="Radius"
            options={[...RADIUS_OPTIONS_M.map((m) => ({ value: String(m), label: radiusLabel(m) })), { value: 'custom', label: 'Custom' }]} style={{ width: 120 }} />
          <Input label="Custom km" value={customKm} onChange={(v) => { setCustomKm(v); const m = parseCustomRadiusKm(v); if (m) set('radiusM')(m) }} error={customKm && !parseCustomRadiusKm(customKm) ? '0.1 to 100 km' : undefined} style={{ width: 110 }} />
        </div>
        <div style={{ fontSize: 12, marginTop: 8, color: 'var(--muted)' }} aria-live="polite">
          {locError && <span role="alert" style={{ color: 'var(--danger, #b91c1c)' }}>{locError} </span>}
          {origin ? <>Searching from: <strong>{origin.label}</strong> ({origin.lat.toFixed(4)}, {origin.lng.toFixed(4)}){origin.kind === 'device' && origin.accuracyM != null ? ' accuracy about ' + origin.accuracyM + ' m' : ''}. Within {radiusLabel(f.radiusM)} (straight-line).
            {origin.lowAccuracy && <strong> Low accuracy: nearby results may be off.</strong>}
            {' '}<button type="button" onClick={() => { setOrigin(null); if (f.sort === 'distance') set('sort')('name') }} style={{ background: 'none', border: 'none', color: 'var(--teal)', cursor: 'pointer', fontSize: 12, padding: 0 }}>Clear location</button></>
            : 'No location chosen: the radius is not applied. Use your location, enter coordinates, pick a state, or click the map.'}
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
          <Button variant="primary" size="md" disabled={loading} onClick={() => run(0)}>{loading ? 'Searching...' : 'Search'}</Button>
          {canExport && <Button variant="ghost" size="md" disabled={exporting || !res || res.total === 0} onClick={exportCsv}><Download size={14} aria-hidden="true" /> {exporting ? 'Exporting...' : 'Export CSV'}</Button>}
        </div>
      </fieldset>

      <DirectoryMap markers={mapMarkers} origin={origin ? { lat: origin.lat, lng: origin.lng } : null} selectedId={selectedId} onSelect={select}
        onPick={(p) => { setOrigin({ ...p, kind: 'map', label: 'Point you picked on the map' }); set('sort')('distance') }} />

      <section aria-live="polite" aria-busy={loading}>
        {loading ? <Loading text="Searching the directory..." />
          : error ? <ErrorState message={error} onRetry={() => run(page)} />
          : !res ? <Empty title="Search the directory" description="Choose filters or describe what you need, then search." />
          : rows.length === 0 ? <Empty title="No businesses found" description="Nothing in the directory matches. Widen the radius or relax a filter. Results are never invented." />
          : (
            <>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{res.total} {res.total === 1 ? 'business' : 'businesses'} found{hasPoint ? ' within ' + radiusLabel(f.radiusM) : ''}. Showing {page * f.limit + 1} to {page * f.limit + rows.length}.</div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {rows.map((r) => {
                  const dir = directionsUrl(r.latitude, r.longitude)
                  const isSel = r.id === selectedId
                  return (
                    <li key={r.id} ref={(el) => { if (el) rowRefs.current.set(r.id, el); else rowRefs.current.delete(r.id) }}
                      style={{ border: isSel ? '2px solid var(--teal)' : '1px solid var(--border)', borderRadius: 10, background: 'var(--panel)', padding: 12 }}>
                      <button type="button" aria-pressed={isSel} onClick={() => select(isSel ? null : r.id)}
                        style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          <strong style={{ fontSize: 14, overflowWrap: 'anywhere' }}>{r.name}</strong>
                          <Pill label={VERIF_LABEL[r.verification_status] || r.verification_status} type={VERIF_PILL[r.verification_status] || 'gray'} />
                          <span style={{ fontSize: 11, color: 'var(--muted)' }}>Source: {r.data_source}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', overflowWrap: 'anywhere' }}>{[catName(r.category_id), r.address, r.city, r.state].filter(Boolean).join(' · ') || 'No address on record'}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.distance_m != null ? distanceLabel(r.distance_m) : r.latitude == null ? 'No coordinates: not shown on the map' : ''}</div>
                      </button>
                      {isSel && (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                          {r.description && <div>{r.description}</div>}
                          {r.phone && <div><Phone size={12} aria-hidden="true" /> <a href={'tel:' + r.phone}>{r.phone}</a></div>}
                          {r.email && <div><Mail size={12} aria-hidden="true" /> <a href={'mailto:' + r.email}>{r.email}</a></div>}
                          {r.website && <div><Globe size={12} aria-hidden="true" /> <a href={/^https?:\/\//i.test(r.website) ? r.website : 'https://' + r.website} target="_blank" rel="noopener noreferrer">{r.website}</a></div>}
                          {r.opening_hours && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Opening hours are on record for this business.</div>}
                          {r.verification_status === 'verified' && r.verified_at && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Verified by directory administrators on {new Date(r.verified_at).toLocaleDateString()}.</div>}
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                            {dir ? <a href={dir} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700 }}><Navigation size={13} aria-hidden="true" /> Directions in Google Maps</a> : <span style={{ color: 'var(--muted)' }}>No coordinates, so no directions.</span>}
                            {viewOnMapUrl(r.latitude, r.longitude) && <a href={viewOnMapUrl(r.latitude, r.longitude)} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MapPin size={13} aria-hidden="true" /> View on Google Maps</a>}
                          </div>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
              {(page > 0 || res.hasMore) && (
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', marginTop: 10 }}>
                  <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => run(page - 1)}>Previous</Button>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>Page {page + 1}</span>
                  <Button variant="ghost" size="sm" disabled={!res.hasMore} onClick={() => run(page + 1)}>Next</Button>
                </div>
              )}
            </>
          )}
      </section>
      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}
