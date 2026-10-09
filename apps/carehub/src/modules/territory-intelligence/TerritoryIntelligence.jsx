import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, CheckCircle2, CircleSlash, Percent, ClipboardCheck, Download } from 'lucide-react'
import { Card, StatCard, TealBtn, GhostBtn, Sel, Pill, Empty, ErrorState, Loading, ConfirmDialog, useToast, Toast } from '../../components/ui'
import { theme } from '../../styles/theme'
import { directoryRepository } from '../business-directory/repositories'
import { useDirectoryLookups } from '../business-directory/components/useDirectoryLookups'
import { VerificationBadge } from '../business-directory/components/BusinessBadges'
import { territoryRepository } from '../territories/repositories'
import { toExportRow, exportRows, EXPORT_COLUMNS } from '../business-directory/services/exportService'
import { NIGERIA_STATES } from '../business-directory/services/constants'
import {
  WINDOWS, GROUPS, sinceFor, shapeGroups, totalsOf, visitStats, shapeReps, coverageTone, lastVisitLabel, pct,
} from './coverage'

const { navy, gray500, gray600, border, tealDeep, danger, warning, success, warningBg } = theme
const TONE_COLOR = { green: success, amber: warning, red: danger, gray: gray500 }
const PAGE = 50
const TABS = [['coverage', 'Coverage'], ['unvisited', 'Not visited'], ['reps', 'Representatives'], ['assign', 'Assign territories']]

function CoverageBar({ value, total }) {
  const tone = coverageTone(value, total)
  return (
    <div role='img' aria-label={`${value} percent covered`} style={{ height: 8, borderRadius: 4, background: theme.gray200, overflow: 'hidden', minWidth: 90 }}>
      <div style={{ width: value + '%', height: '100%', background: TONE_COLOR[tone] }} />
    </div>
  )
}

/**
 * Territory Intelligence: where the registered businesses are, which of them
 * field reps have actually reported on, and which have not been reached.
 * Read-only analytics over the Business Directory and confirmed field
 * activity — it creates no activity and notifies nobody.
 */
export default function TerritoryIntelligence({ brand, perms }) {
  const repo = directoryRepository
  const businessId = brand?.id
  const canManage = !!perms?.canManageDirectory
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const lookups = useDirectoryLookups(businessId, repo)

  const [tab, setTab] = useState('coverage')
  const [days, setDays] = useState(90)
  const [group, setGroup] = useState('territory')
  const [categoryId, setCategoryId] = useState('')
  const [state, setState] = useState('')
  const [territories, setTerritories] = useState([])
  const [repsByTerritory, setRepsByTerritory] = useState({})

  const [groups, setGroups] = useState(null)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [uTerritory, setUTerritory] = useState('') // '' all | 'none' unassigned | territory id
  const [uRows, setURows] = useState(null)
  const [uTotal, setUTotal] = useState(0)
  const [uPage, setUPage] = useState(0)
  const [uLoading, setULoading] = useState(false)
  const [reps, setReps] = useState(null)
  const [unassigned, setUnassigned] = useState(null) // [{label,total}] by state
  const [assign, setAssign] = useState({ state: '', territoryId: '' })
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  const since = useMemo(() => sinceFor(days), [days])
  const filters = { categoryId: categoryId || null, state: state || null }

  const loadCoverage = useCallback(async () => {
    if (!businessId) return
    setLoading(true)
    setError('')
    try {
      const [g, v] = await Promise.all([
        repo.coverageSummary(businessId, since, group, filters),
        repo.visitTotals(businessId, since),
      ])
      setGroups(shapeGroups(g, group))
      setStats(visitStats(v))
    } catch (e) {
      setError(e.message || 'Could not load coverage')
    }
    setLoading(false)
  }, [repo, businessId, since, group, categoryId, state]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadCoverage() }, [loadCoverage])

  useEffect(() => {
    if (!businessId) return
    territoryRepository.getAll(businessId).then(async (t) => {
      setTerritories(t || [])
      try {
        const a = await territoryRepository.getAssignments((t || []).map((x) => x.id))
        const map = {}
        ;(a || []).forEach((r) => { (map[r.territory_id] = map[r.territory_id] || []).push(r.staff?.full_name || 'Unknown') })
        setRepsByTerritory(map)
      } catch (e) { /* rep names are a nicety */ }
    }).catch(() => {})
  }, [businessId])

  const loadUnvisited = useCallback(async () => {
    if (!businessId) return
    setULoading(true)
    try {
      const rows = await repo.unvisited(businessId, since, {
        territoryId: uTerritory && uTerritory !== 'none' ? uTerritory : null, unassignedOnly: uTerritory === 'none',
        state: state || null, categoryId: categoryId || null, limit: PAGE, offset: uPage * PAGE,
      })
      setURows(rows)
      setUTotal(rows.length ? Number(rows[0].total_count) : 0)
    } catch (e) { showToast('Could not load the list: ' + e.message, { type: 'error' }) }
    setULoading(false)
  }, [repo, businessId, since, uTerritory, state, categoryId, uPage]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (tab === 'unvisited') loadUnvisited() }, [tab, loadUnvisited])
  useEffect(() => { setUPage(0) }, [since, uTerritory, state, categoryId])

  useEffect(() => {
    if (tab !== 'reps' || !businessId) return
    setReps(null)
    repo.repActivity(businessId, since).then((r) => setReps(shapeReps(r))).catch((e) => { setReps([]); showToast(e.message, { type: 'error' }) })
  }, [tab, businessId, since, repo]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadUnassigned = useCallback(async () => {
    try {
      // Server-side count per state of active businesses with no territory.
      const r = await repo.coverageSummary(businessId, since, 'state', { unassignedOnly: true })
      const byState = {}
      r.forEach((x) => { byState[x.group_label || ''] = Number(x.total) })
      setUnassigned({ total: r.reduce((n, x) => n + Number(x.total), 0), byState })
    } catch (e) { setUnassigned({ total: 0, byState: {} }); showToast(e.message, { type: 'error' }) }
  }, [repo, businessId, since]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'assign' && canManage) loadUnassigned() }, [tab, canManage, loadUnassigned])

  const totals = useMemo(() => totalsOf(groups || []), [groups])
  const windowLabel = WINDOWS.find((w) => w.days === days)?.label.toLowerCase() || `last ${days} days`
  const terrName = (id) => territories.find((t) => t.id === id)?.name || ''

  async function exportUnvisited(format) {
    setBusy(true)
    try {
      const all = []
      for (let off = 0; off < 20000; off += 1000) {
        const page = await repo.unvisited(businessId, since, {
          territoryId: uTerritory && uTerritory !== 'none' ? uTerritory : null, unassignedOnly: uTerritory === 'none',
          state: state || null, categoryId: categoryId || null, limit: 1000, offset: off,
        })
        all.push(...page)
        if (page.length < 1000) break
      }
      if (!all.length) { showToast('Nothing to export.', { type: 'warning' }); setBusy(false); return }
      const columns = [...EXPORT_COLUMNS.filter((c) => !['distance', 'source'].includes(c.key)), { key: 'territory', header: 'Territory' }, { key: 'last_visit', header: 'Last confirmed visit' }]
      await exportRows(format, all.map((r) => ({
        ...toExportRow(r, lookups.categoryName(r.category_id), ''),
        territory: terrName(r.territory_id), last_visit: r.last_visit_at ? new Date(r.last_visit_at).toISOString().slice(0, 10) : 'Never',
      })), { baseName: 'not-visited-businesses', title: 'Businesses not visited — ' + windowLabel, subtitle: brand?.name, columns })
    } catch (e) { showToast('Could not export: ' + e.message, { type: 'error' }) }
    setBusy(false)
  }

  async function doAssign() {
    setConfirm(false)
    setBusy(true)
    try {
      const n = await repo.assignTerritoryToUnassigned(businessId, assign.territoryId, { state: assign.state || null })
      showToast(`${n.toLocaleString()} business${n === 1 ? '' : 'es'} assigned to ${terrName(assign.territoryId)}`, { type: 'success' })
      setAssign({ state: '', territoryId: '' })
      loadUnassigned()
      loadCoverage()
    } catch (e) { showToast('Could not assign: ' + e.message, { type: 'error' }) }
    setBusy(false)
  }

  if (!businessId) return null
  const stateOptions = NIGERIA_STATES
  const assignCount = assign.state ? (unassigned?.byState?.[assign.state] || 0) : (unassigned?.total || 0)

  return (
    <div style={{ padding: 24, maxWidth: 1150 }}>
      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
      <h1 style={{ fontSize: 18, fontWeight: 900, color: navy, margin: 0 }}>Territory Intelligence</h1>
      <div style={{ fontSize: 13, color: gray500, margin: '2px 0 12px' }}>
        Where your registered businesses are, and which of them your reps have actually reported on.
      </div>
      <div role='note' style={{ padding: '8px 12px', borderRadius: 10, background: theme.infoBg, color: theme.info, fontSize: 12.5, marginBottom: 14 }}>
        A business counts as <strong>covered</strong> only when a rep confirmed it in a submitted Live Field Report. GPS position alone never counts, and reports submitted without choosing a business are not included — so coverage is a lower bound.
      </div>

      <Card style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
          <Sel label='Period' value={String(days)} onChange={(v) => setDays(Number(v) || 90)} options={WINDOWS.map((w) => ({ value: String(w.days), label: w.label }))} placeholder='Period' id='ti-days' />
          <Sel label='Category' value={categoryId} onChange={setCategoryId} options={lookups.categories.map((c) => ({ value: c.id, label: c.name }))} placeholder='All categories' id='ti-cat' />
          <Sel label='State' value={state} onChange={setState} options={stateOptions} placeholder='All states' id='ti-state' />
        </div>
      </Card>

      {error ? <ErrorState message={error} onRetry={loadCoverage} /> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 14 }}>
            <StatCard icon={<Building2 />} label='Registered businesses' value={loading ? '…' : totals.total.toLocaleString()} sub='Active in your directory' />
            <StatCard icon={<CheckCircle2 />} label='Covered' value={loading ? '…' : totals.visited.toLocaleString()} sub={`Confirmed in the ${windowLabel}`} />
            <StatCard icon={<CircleSlash />} label='Not covered' value={loading ? '…' : totals.unvisited.toLocaleString()} tone={totals.unvisited > 0 ? 'warning' : undefined} sub='No confirmed report in this period' />
            <StatCard icon={<Percent />} label='Coverage' value={loading ? '…' : totals.pct + '%'} sub={totals.total ? `${totals.visited} of ${totals.total}` : 'Nothing to measure yet'} />
            <StatCard icon={<ClipboardCheck />} label='Reports with a business' value={loading || !stats ? '…' : stats.linkedShare + '%'} tone={stats?.blindSpot ? 'warning' : undefined} sub={stats ? `${stats.linked} of ${stats.activities} reports` : ''} />
          </div>
          {stats?.blindSpot && (
            <div role='alert' style={{ padding: '10px 14px', borderRadius: 10, background: warningBg, border: `1px solid ${warning}`, color: warning, fontSize: 12.5, marginBottom: 14 }}>
              Only {stats.linkedShare}% of field reports in this period confirmed a business, so the coverage below is understated. Ask reps to pick the business in Live Field Report when one is suggested.
            </div>
          )}
        </>
      )}

      <div role='tablist' aria-label='Intelligence sections' style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {TABS.filter(([id]) => id !== 'assign' || canManage).map(([id, label]) => (
          <button key={id} role='tab' aria-selected={tab === id} onClick={() => setTab(id)}
            style={{ fontSize: 12.5, fontWeight: 800, padding: '9px 16px', borderRadius: 10, cursor: 'pointer', border: `1px solid ${tab === id ? tealDeep : border}`, background: tab === id ? navy : 'white', color: tab === id ? 'white' : gray500 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'coverage' && !error && (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: gray600 }}>Group by</span>
            {GROUPS.map((g) => (
              <button key={g.id} aria-pressed={group === g.id} onClick={() => setGroup(g.id)}
                style={{ fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 20, cursor: 'pointer', border: `1px solid ${group === g.id ? tealDeep : border}`, background: group === g.id ? tealDeep : 'white', color: group === g.id ? 'white' : gray600 }}>
                {g.label}
              </button>
            ))}
          </div>
          {loading ? <Loading text='Calculating coverage…' /> : !groups.length ? (
            <Card><Empty message='No businesses in your directory match these filters yet. Add or import businesses in Business Directory.' cause='none' /></Card>
          ) : (
            <Card style={{ padding: 0, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 640 }}>
                <caption style={{ position: 'absolute', left: -9999 }}>Coverage by {group}</caption>
                <thead><tr style={{ background: theme.gray50, textAlign: 'left' }}>
                  {[GROUPS.find((g) => g.id === group).label, 'Businesses', 'Covered', 'Not covered', 'Coverage', group === 'territory' ? 'Reps' : ''].map((h, i) => <th key={i} scope='col' style={{ padding: '9px 12px', fontSize: 11, color: gray500 }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.key || 'none'} style={{ borderTop: `1px solid ${border}`, background: g.none ? theme.warningBg : 'transparent' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 700, color: navy }}>{g.label}</td>
                      <td style={{ padding: '10px 12px' }}>{g.total.toLocaleString()}</td>
                      <td style={{ padding: '10px 12px' }}>{g.visited.toLocaleString()}</td>
                      <td style={{ padding: '10px 12px', color: g.unvisited ? warning : gray500, fontWeight: g.unvisited ? 700 : 400 }}>{g.unvisited.toLocaleString()}</td>
                      <td style={{ padding: '10px 12px', minWidth: 150 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><CoverageBar value={g.pct} total={g.total} /><span style={{ fontWeight: 800, color: TONE_COLOR[coverageTone(g.pct, g.total)] }}>{g.pct}%</span></div>
                      </td>
                      {group === 'territory' && <td style={{ padding: '10px 12px', color: gray600 }}>{g.none ? (canManage
                        ? <button onClick={() => setTab('assign')} style={{ background: 'none', border: 'none', padding: 0, color: warning, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', fontSize: 12.5 }}>Assign a territory →</button>
                        : <span style={{ color: warning }}>Ask the Owner to assign territories</span>) : (repsByTerritory[g.key] || []).join(', ') || <span style={{ color: gray500 }}>No rep assigned</span>}</td>}
                      {group !== 'territory' && <td />}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}

      {tab === 'unvisited' && (
        <>
          <Card style={{ padding: 14, marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Sel label='Territory' value={uTerritory} onChange={setUTerritory} placeholder='All territories' style={{ minWidth: 220 }} id='ti-uterr'
                options={[{ value: 'none', label: 'No territory assigned' }, ...territories.map((t) => ({ value: t.id, label: t.name }))]} />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: gray600 }}>Export all:</span>
                {[['csv', 'CSV'], ['xlsx', 'Excel'], ['pdf', 'PDF'], ['json', 'JSON']].map(([f, l]) => (
                  <GhostBtn key={f} disabled={busy || !uTotal} onClick={() => exportUnvisited(f)} style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><Download size={13} aria-hidden='true' />{l}</GhostBtn>
                ))}
              </div>
            </div>
            <div style={{ fontSize: 12, color: gray500, marginTop: 8 }}>Businesses with no confirmed report in the {windowLabel}, never-visited first, then longest since last visit.</div>
          </Card>
          {uLoading && !uRows ? <Loading /> : !uRows?.length ? (
            <Card><Empty cause='positive' message={totals.total ? 'Every business matching these filters has been covered in this period.' : 'No businesses match these filters.'} /></Card>
          ) : (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: navy, marginBottom: 8 }}>{uTotal.toLocaleString()} not covered</div>
              <Card style={{ padding: 0, overflowX: 'auto', opacity: uLoading ? 0.6 : 1 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 720 }}>
                  <thead><tr style={{ background: theme.gray50, textAlign: 'left' }}>
                    {['Business', 'Location', 'Territory', 'Last confirmed visit', 'Status'].map((h) => <th key={h} scope='col' style={{ padding: '9px 12px', fontSize: 11, color: gray500 }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {uRows.map((r) => (
                      <tr key={r.id} style={{ borderTop: `1px solid ${border}` }}>
                        <td style={{ padding: '10px 12px' }}><div style={{ fontWeight: 700, color: navy }}>{r.name}</div><div style={{ fontSize: 11.5, color: gray500 }}>{lookups.categoryName(r.category_id) || 'Uncategorised'}</div></td>
                        <td style={{ padding: '10px 12px', color: gray600 }}>{[r.address, r.lga, r.state].filter(Boolean).join(', ') || '—'}</td>
                        <td style={{ padding: '10px 12px', color: gray600 }}>{terrName(r.territory_id) || <span style={{ color: warning }}>None</span>}</td>
                        <td style={{ padding: '10px 12px' }}><Pill label={lastVisitLabel(r.last_visit_at)} type={r.last_visit_at ? 'amber' : 'red'} /></td>
                        <td style={{ padding: '10px 12px' }}><VerificationBadge status={r.verification_status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              {uTotal > PAGE && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0', fontSize: 12.5, color: gray600 }}>
                  <GhostBtn disabled={uPage === 0 || uLoading} onClick={() => setUPage((p) => p - 1)}>Previous</GhostBtn>
                  <span>{uPage * PAGE + 1}–{Math.min(uTotal, (uPage + 1) * PAGE)} of {uTotal.toLocaleString()}</span>
                  <GhostBtn disabled={(uPage + 1) * PAGE >= uTotal || uLoading} onClick={() => setUPage((p) => p + 1)}>Next</GhostBtn>
                </div>
              )}
            </>
          )}
        </>
      )}

      {tab === 'reps' && (reps === null ? <Loading /> : !reps.length ? (
        <Card><Empty message={`No field reports were submitted in the ${windowLabel}.`} /></Card>
      ) : (
        <Card style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 560 }}>
            <thead><tr style={{ background: theme.gray50, textAlign: 'left' }}>
              {['Representative', 'Reports', 'With a confirmed business', 'Businesses reached'].map((h) => <th key={h} scope='col' style={{ padding: '9px 12px', fontSize: 11, color: gray500 }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {reps.map((r) => (
                <tr key={r.staffId || r.name} style={{ borderTop: `1px solid ${border}` }}>
                  <td style={{ padding: '10px 12px', fontWeight: 700, color: navy }}>{r.name}</td>
                  <td style={{ padding: '10px 12px' }}>{r.activities}</td>
                  <td style={{ padding: '10px 12px' }}>{r.linked} <span style={{ color: gray500 }}>({r.linkedShare}%)</span></td>
                  <td style={{ padding: '10px 12px', fontWeight: 700 }}>{r.businesses}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      {tab === 'assign' && canManage && (
        <Card style={{ padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: navy, marginBottom: 4 }}>Assign territories in bulk</div>
          <div style={{ fontSize: 12.5, color: gray600, marginBottom: 12 }}>
            Coverage is measured per territory, so every business needs one. This assigns a territory to active businesses that have none — it never changes a territory that is already set.
          </div>
          {unassigned === null ? <Loading /> : unassigned.total === 0 ? <Empty cause='positive' message='Every active business already has a territory.' /> : (
            <>
              <div style={{ fontSize: 13, color: warning, fontWeight: 700, marginBottom: 10 }}>{unassigned.total.toLocaleString()} active business{unassigned.total === 1 ? '' : 'es'} have no territory.</div>
              {territories.length === 0 && <div role='note' style={{ fontSize: 12.5, color: gray600, marginBottom: 10 }}>Create territories first in Territories.</div>}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <Sel label='Only in state' value={assign.state} onChange={(v) => setAssign((a) => ({ ...a, state: v }))} placeholder='All states' style={{ minWidth: 200 }} id='ti-astate'
                  options={Object.keys(unassigned.byState || {}).filter(Boolean).sort().map((s) => ({ value: s, label: `${s} (${unassigned.byState[s]})` }))} />
                <Sel label='Territory' value={assign.territoryId} onChange={(v) => setAssign((a) => ({ ...a, territoryId: v }))} placeholder='Choose a territory' style={{ minWidth: 220 }} id='ti-aterr'
                  options={territories.map((t) => ({ value: t.id, label: t.name }))} />
                <TealBtn disabled={busy || !assign.territoryId || !assignCount} onClick={() => setConfirm(true)}>Assign {assignCount.toLocaleString()}</TealBtn>
              </div>
            </>
          )}
        </Card>
      )}

      <ConfirmDialog show={confirm} onClose={() => setConfirm(false)} title={`Assign ${assignCount.toLocaleString()} businesses to ${terrName(assign.territoryId)}?`}
        consequence='Only businesses with no territory are changed. You can edit any business afterwards.' confirmLabel='Assign' danger={false} onConfirm={doAssign} />
    </div>
  )
}
