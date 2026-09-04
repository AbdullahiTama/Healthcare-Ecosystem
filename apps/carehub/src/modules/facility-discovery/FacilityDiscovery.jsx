import { useState, useEffect, useMemo, useRef } from 'react'
import { Search, MapPin, Download, Filter, Building2, Phone, BadgeCheck, AlertTriangle, Clock, Loader2, Database } from 'lucide-react'
import { Card, TealBtn, GhostBtn, Loading } from '../../components/ui'
import { theme } from '../../styles/theme'
import { PageHeader } from '@care-ecosystem/design-system/components/layout/PageHeader'
import { FACILITY_CATEGORY } from '../../lib/geo.js'
import { FACILITY_FILTERS } from '../../lib/places.js'
import { NIGERIA_STATES, getLgasForState, normalizeState } from '../../lib/nigeriaGeo.js'
import { discoverFacilities, VERIFICATION_LEVEL, FACILITY_SOURCE } from '../../lib/facilityDiscovery.js'
import { downloadCSV, exportToPDF, createExportJob } from './export.js'
import { useToast, Toast } from '../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, gray200, gray100, border, success, successBg, warning, warningBg, info, infoBg, bg, danger } = theme

const MODE_OPTIONS = [
  { value: 'current', label: 'Current Location' },
  { value: 'state', label: 'State' },
  { value: 'lga', label: 'LGA' },
  { value: 'city', label: 'City / Area' },
  { value: 'nigeria', label: 'Nigeria-wide' },
]

const VERIFICATION_OPTIONS = [
  { value: 'all', label: 'All Verifications' },
  { value: 'verified', label: 'Verified' },
  { value: 'pending', label: 'Pending Review' },
  { value: 'unverified', label: 'Unverified' },
  { value: 'external_unverified', label: 'External Unverified' },
  { value: 'no_gps', label: 'No GPS' },
  { value: 'regulatory', label: 'Regulatory' },
]

const SOURCE_OPTIONS = [
  { value: 'all', label: 'All Sources' },
  { value: 'carefind', label: 'CareFind' },
  { value: 'osm', label: 'OSM' },
  { value: 'google', label: 'Google' },
  { value: 'regulatory', label: 'Regulatory' },
  { value: 'other', label: 'Other' },
]

const SORT_OPTIONS = [
  { value: 'distance', label: 'Distance' },
  { value: 'name', label: 'Name' },
  { value: 'category', label: 'Category' },
  { value: 'verification', label: 'Verification' },
  { value: 'updated', label: 'Updated' },
]

export default function FacilityDiscovery({ brand }) {
  const { msg, type, show: showToast } = useToast()
  const [mode, setMode] = useState('state')
  const [stateSel, setStateSel] = useState('')
  const [lgaSel, setLgaSel] = useState('')
  const [city, setCity] = useState('')
  const [category, setCategory] = useState('all')
  const [distance, setDistance] = useState('') // optional for point search
  const [verification, setVerification] = useState('all')
  const [source, setSource] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [sort, setSort] = useState('distance')
  const [gps, setGps] = useState(null)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [facilities, setFacilities] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(null)

  const lgas = useMemo(() => getLgasForState(stateSel), [stateSel])
  const pageSize = 20

  function captureGps() {
    if (!navigator.geolocation) {
      showToast('Geolocation not supported', { type: 'error' })
      return
    }
    setGpsLoading(true)
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setGpsLoading(false)
      },
      function (e) {
        showToast('Could not get GPS: ' + (e.message || 'denied'), { type: 'error' })
        setGpsLoading(false)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  async function doSearch(reset = true) {
    const p = reset ? 0 : page + 1
    if (reset) {
      setFacilities([])
      setTotal(0)
      setPage(0)
      setHasMore(false)
    }
    setLoading(true)
    setError(null)
    try {
      const res = await discoverFacilities({
        mode,
        state: stateSel || null,
        lga: lgaSel || null,
        city: city || null,
        coords: gps,
        category,
        keyword,
        verification,
        source,
        sort,
        page: p,
        pageSize,
        businessId: brand?.id || null,
        radius: (distance && Number.isFinite(Number(distance)) && Number(distance) > 0) ? Number(distance) : null,
      })
      if (reset) {
        setFacilities(res.facilities)
      } else {
        setFacilities(prev => [...prev, ...res.facilities])
      }
      setTotal(res.total)
      setHasMore(res.hasMore)
      setPage(p)
    } catch (e) {
      console.error('Discovery failed:', e)
      setError(e.message || 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  function handleStateChange(v) {
    setStateSel(v)
    setLgaSel('')
  }

  async function handleExport(format) {
    if (facilities.length === 0) {
      showToast('No results to export', { type: 'warning' })
      return
    }
    setExporting(true)
    setExportProgress(null)
    try {
      const filters = { mode, state: stateSel, lga: lgaSel, city, category, verification, source, keyword, sort }
      if (total > 1000) {
        // Large as background job with progress
        await createExportJob(facilities, filters, function (prog) { setExportProgress(prog) })
        if (format === 'pdf') exportToPDF(facilities, filters)
        else downloadCSV(facilities, filters)
        showToast('Export complete (' + total + ' rows)', { type: 'success' })
      } else {
        if (format === 'pdf') exportToPDF(facilities, filters)
        else downloadCSV(facilities, filters)
        showToast('Exported ' + facilities.length + ' rows', { type: 'success' })
      }
    } catch (e) {
      showToast('Export failed: ' + e.message, { type: 'error' })
    } finally {
      setExporting(false)
      setExportProgress(null)
    }
  }

  const showDistance = mode === 'current' || mode === 'state' || distance

  return (
    <>
      <PageHeader
        title="Facility Discovery"
        description="Find health facilities across Nigeria — by State, LGA, city or Nigeria-wide. MERGED, DEDUPED, RANKED."
        primaryAction={{ label: 'Search', onClick: () => doSearch(true) }}
      />
      <div style={{ padding: '20px', maxWidth: '1100px' }}>
        <Toast msg={msg} type={type} />

        {/* Filter Bar */}
        <Card style={{ padding: '16px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <Filter size={16} color={tealDeep} />
            <span style={{ fontSize: '13px', fontWeight: '800', color: navy }}>Filters</span>
            <span style={{ fontSize: '11px', color: gray400, marginLeft: 'auto' }}>{total > 0 ? total + ' results' : 'Set filters and search'}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            {/* Mode */}
            <div>
              <label style={{ fontSize: '11px', fontWeight: '700', color: gray500, display: 'block', marginBottom: '4px' }}>Mode</label>
              <select value={mode} onChange={e => setMode(e.target.value)} aria-label="Search mode"
                style={{ width: '100%', padding: '9px 10px', borderRadius: '8px', border: `1px solid ${border}`, fontSize: '13px', background: 'white' }}>
                {MODE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* State - searchable */}
            <div>
              <label style={{ fontSize: '11px', fontWeight: '700', color: gray500, display: 'block', marginBottom: '4px' }}>State (37)</label>
              <input list="state-list" value={stateSel} onChange={e => handleStateChange(e.target.value)} placeholder="Select or type state" aria-label="State"
                style={{ width: '100%', padding: '9px 10px', borderRadius: '8px', border: `1px solid ${border}`, fontSize: '13px', boxSizing: 'border-box' }} />
              <datalist id="state-list">
                {NIGERIA_STATES.map(s => <option key={s.name} value={s.name} />)}
              </datalist>
            </div>

            {/* LGA - dynamic */}
            <div>
              <label style={{ fontSize: '11px', fontWeight: '700', color: gray500, display: 'block', marginBottom: '4px' }}>LGA {stateSel ? '(' + lgas.length + ')' : ''}</label>
              <input list="lga-list" value={lgaSel} onChange={e => setLgaSel(e.target.value)} placeholder={stateSel ? 'Select LGA' : 'Select state first'} disabled={!stateSel} aria-label="LGA"
                style={{ width: '100%', padding: '9px 10px', borderRadius: '8px', border: `1px solid ${border}`, fontSize: '13px', background: !stateSel ? bg : 'white', boxSizing: 'border-box' }} />
              <datalist id="lga-list">
                {lgas.map(l => <option key={l} value={l} />)}
              </datalist>
            </div>

            {/* City/Area searchable */}
            <div>
              <label style={{ fontSize: '11px', fontWeight: '700', color: gray500, display: 'block', marginBottom: '4px' }}>City / Area</label>
              <input value={city} onChange={e => setCity(e.target.value)} placeholder="e.g., Ikeja, Wuse" aria-label="City or area"
                style={{ width: '100%', padding: '9px 10px', borderRadius: '8px', border: `1px solid ${border}`, fontSize: '13px', boxSizing: 'border-box' }} />
            </div>

            {/* Category 16 */}
            <div>
              <label style={{ fontSize: '11px', fontWeight: '700', color: gray500, display: 'block', marginBottom: '4px' }}>Category</label>
              <select value={category} onChange={e => setCategory(e.target.value)} aria-label="Category"
                style={{ width: '100%', padding: '9px 10px', borderRadius: '8px', border: `1px solid ${border}`, fontSize: '13px', background: 'white' }}>
                <option value="all">All Categories</option>
                {FACILITY_FILTERS.filter(f=>f.key!=='all').map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </div>

            {/* Distance optional for point search */}
            <div>
              <label style={{ fontSize: '11px', fontWeight: '700', color: gray500, display: 'block', marginBottom: '4px' }}>Distance (m, optional)</label>
              <input value={distance} onChange={e => setDistance(e.target.value)} placeholder="e.g., 1000" type="number" aria-label="Distance"
                style={{ width: '100%', padding: '9px 10px', borderRadius: '8px', border: `1px solid ${border}`, fontSize: '13px', boxSizing: 'border-box' }} />
            </div>

            {/* Verification 6 */}
            <div>
              <label style={{ fontSize: '11px', fontWeight: '700', color: gray500, display: 'block', marginBottom: '4px' }}>Verification</label>
              <select value={verification} onChange={e => setVerification(e.target.value)} aria-label="Verification"
                style={{ width: '100%', padding: '9px 10px', borderRadius: '8px', border: `1px solid ${border}`, fontSize: '13px', background: 'white' }}>
                {VERIFICATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Source */}
            <div>
              <label style={{ fontSize: '11px', fontWeight: '700', color: gray500, display: 'block', marginBottom: '4px' }}>Source</label>
              <select value={source} onChange={e => setSource(e.target.value)} aria-label="Source"
                style={{ width: '100%', padding: '9px 10px', borderRadius: '8px', border: `1px solid ${border}`, fontSize: '13px', background: 'white' }}>
                {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Sort */}
            <div>
              <label style={{ fontSize: '11px', fontWeight: '700', color: gray500, display: 'block', marginBottom: '4px' }}>Sort</label>
              <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort"
                style={{ width: '100%', padding: '9px 10px', borderRadius: '8px', border: `1px solid ${border}`, fontSize: '13px', background: 'white' }}>
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Keyword */}
            <div>
              <label style={{ fontSize: '11px', fontWeight: '700', color: gray500, display: 'block', marginBottom: '4px' }}>Keyword</label>
              <input value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="Name, category..." aria-label="Keyword"
                style={{ width: '100%', padding: '9px 10px', borderRadius: '8px', border: `1px solid ${border}`, fontSize: '13px', boxSizing: 'border-box' }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '14px', alignItems: 'center' }}>
            <TealBtn onClick={() => doSearch(true)} style={{ padding: '10px 18px' }} disabled={loading}>
              {loading ? 'Searching...' : 'Search'} <Search size={14} style={{ marginLeft: '6px', verticalAlign: '-2px' }} />
            </TealBtn>
            {mode === 'current' && (
              <GhostBtn onClick={captureGps} style={{ padding: '10px 14px' }} disabled={gpsLoading}>
                <MapPin size={14} style={{ marginRight: '6px', verticalAlign: '-2px' }} />
                {gps ? 'GPS captured' : (gpsLoading ? 'Locating...' : 'Use current location')}
              </GhostBtn>
            )}
            <GhostBtn onClick={() => { setStateSel(''); setLgaSel(''); setCity(''); setCategory('all'); setKeyword(''); setVerification('all'); setSource('all'); setDistance(''); }} style={{ padding: '10px 14px' }}>
              Clear
            </GhostBtn>
            <div style={{ flex: 1 }} />
            <button onClick={() => handleExport('csv')} disabled={exporting || facilities.length === 0}
              style={{ border: `1px solid ${border}`, background: 'white', color: navy, borderRadius: '8px', padding: '9px 14px', fontSize: '12px', fontWeight: '700', cursor: facilities.length===0||exporting?'not-allowed':'pointer', opacity: facilities.length===0||exporting?0.5:1, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Download size={14} /> {exporting && exportProgress ? exportProgress.percent + '%' : 'Export CSV'}
            </button>
            <button onClick={() => handleExport('pdf')} disabled={exporting || facilities.length === 0}
              style={{ border: `1px solid ${tealDeep}`, background: tealMist, color: tealDeep, borderRadius: '8px', padding: '9px 14px', fontSize: '12px', fontWeight: '700', cursor: facilities.length===0||exporting?'not-allowed':'pointer', opacity: facilities.length===0||exporting?0.5:1, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Download size={14} /> PDF
            </button>
          </div>
          {gps && <div style={{ fontSize: '11px', color: gray500, marginTop: '8px' }}>GPS: {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}</div>}
        </Card>

        {/* Results */}
        {loading && <Loading />}

        {error && (
          <Card style={{ padding: '16px', background: '#fef2f2', border: '1px solid #fecaca', marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: '700', color: danger }}>Error: {error}</div>
            <div style={{ fontSize: '12px', color: gray600, marginTop: '4px' }}>Provider may be temporarily unavailable — degraded to cache + internal.</div>
          </Card>
        )}

        {!loading && !error && facilities.length === 0 && total === 0 && (
          <Card style={{ padding: '32px', textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '12px' }}><Building2 size={36} color={gray400} /></div>
            <div style={{ fontWeight: '800', color: navy, marginBottom: '6px' }}>No facilities found</div>
            <div style={{ fontSize: '13px', color: gray500, marginBottom: '12px' }}>Try a different State, LGA or category, or broaden your filters.</div>
            <div style={{ fontSize: '12px', color: gray400 }}>Add this facility if you know it exists — it will be queued for manager review.</div>
          </Card>
        )}

        {facilities.length > 0 && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {facilities.map(function (f) {
                return (
                  <Card key={f.id || f.name + f.lat} style={{ padding: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: '15px', fontWeight: '800', color: navy, display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {f.name}
                          {f.confidence != null && <span style={{ fontSize: '10px', fontWeight: '800', background: tealMist, color: tealDeep, padding: '2px 6px', borderRadius: '20px' }}>{f.confidence}% confidence</span>}
                        </div>
                        <div style={{ fontSize: '12px', fontWeight: '700', color: tealDeep, marginTop: '2px' }}>{f.category}</div>
                        <div style={{ fontSize: '12px', color: gray600, marginTop: '4px', lineHeight: '1.4' }}>
                          {[f.address, f.lga, f.state].filter(Boolean).join(', ') || 'Address not available'}
                        </div>
                        {(f.phone || f.lga || f.state) && (
                          <div style={{ fontSize: '11.5px', color: gray500, marginTop: '4px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            {f.phone && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Phone size={11} /> {f.phone}</span>}
                            {(f.lga || f.state) && <span>{[f.lga, f.state].filter(Boolean).join(', ')}</span>}
                            {f.lat != null && f.lng != null && <span>{Number(f.lat).toFixed(5)}, {Number(f.lng).toFixed(5)}</span>}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px', alignItems: 'center' }}>
                          {/* Verification badge 6-level */}
                          {f.verification === 'verified' && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', fontWeight: '800', padding: '2px 8px', borderRadius: '20px', background: successBg, color: success }}><BadgeCheck size={10} /> Verified</span>}
                          {f.verification === 'pending' && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', fontWeight: '800', padding: '2px 8px', borderRadius: '20px', background: infoBg, color: info }}><Clock size={10} /> Pending</span>}
                          {f.verification === 'unverified' && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', fontWeight: '800', padding: '2px 8px', borderRadius: '20px', background: warningBg, color: warning }}><AlertTriangle size={10} /> Unverified</span>}
                          {f.verification === 'external_unverified' && <span style={{ fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px', background: bg, color: gray500, border: `1px solid ${border}` }}>External</span>}
                          {f.verification === 'no_gps' && <span style={{ fontSize: '10px', color: gray400 }}>No GPS</span>}
                          {f.verification === 'regulatory' && <span style={{ fontSize: '10px', fontWeight: '700', background: '#eff6ff', color: '#2563eb', padding: '2px 8px', borderRadius: '20px' }}>Regulatory</span>}
                          {/* Source */}
                          <span style={{ fontSize: '10px', fontWeight: '700', color: gray500, textTransform: 'uppercase', border: `1px solid ${gray100}`, padding: '2px 6px', borderRadius: '20px' }}>{f.source}</span>
                          {f.distanceM != null && !f.pendingReview && !(f.verification === 'pending') && (
                            <span style={{ fontSize: '11px', color: gray400 }}>{f.distanceM < 1000 ? f.distanceM + ' m' : (f.distanceM/1000).toFixed(1) + ' km'} away</span>
                          )}
                          {f.merged && f.sourceRefs && <span style={{ fontSize: '10px', color: gray400 }}>{f.sourceRefs.length} sources merged</span>}
                        </div>
                      </div>
                      {f.lat != null && f.lng != null && (
                        <a href={'https://www.google.com/maps?q=' + f.lat + ',' + f.lng} target="_blank" rel="noreferrer"
                          style={{ flexShrink: 0, fontSize: '11px', fontWeight: '700', color: tealDeep, background: tealMist, border: `1px solid ${tealMist}`, borderRadius: '20px', padding: '6px 12px', textDecoration: 'none', height: 'fit-content' }}>
                          View on map
                        </a>
                      )}
                    </div>
                  </Card>
                )
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginTop: '16px', alignItems: 'center' }}>
              <div style={{ fontSize: '12px', color: gray500 }}>Showing {facilities.length} of {total}</div>
              {hasMore && (
                <TealBtn onClick={() => doSearch(false)} style={{ padding: '9px 16px' }}>
                  Load more
                </TealBtn>
              )}
            </div>
          </>
        )}

        {/* Accessibility: live region */}
        <div aria-live="polite" style={{ position: 'absolute', left: '-9999px' }}>
          {loading ? 'Loading facilities' : facilities.length + ' facilities found'}
        </div>
      </div>
    </>
  )
}
