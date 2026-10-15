import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Factory } from 'lucide-react'
import { adrReportRepository } from './repositories'
import { adrValidation } from './validation'
import { getDeadlineStatus } from './services'
import { bucketTrackerCounts, sourceBadge, companyStatusLabel, allowedCompanyTransitions, logBulkExport } from './pvWorkflow'
import { buildAdrCsv, buildBulkPdfHtml, buildAnalyticsHtml, csvRowsFromCases, downloadTextFile, openPrintView, BULK_PDF_CAP } from './exports'
import { outcomeCounts, topReactionTerms, suppressCounts } from './analytics'
import PvAnalytics from './PvAnalytics'
import { theme } from '../../styles/theme'
import { Card, Loading, Empty, ErrorState, Button, useToast } from '../../components/ui'

const { tealDeep, gray500, border } = theme

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' })
}

const TONE_BG = { info: '#e8f1fd', success: '#e9f7ef', neutral: '#f1f1ee', warning: '#fff7e6' }
const TONE_FG = { info: '#1d4ed8', success: '#0E6F5A', neutral: '#5B6B63', warning: '#b45309' }

export function SourcePill({ source }) {
  const b = sourceBadge(source)
  return (
    <span style={{ fontSize: 11.5, fontWeight: 700, background: TONE_BG[b.tone] || TONE_BG.neutral, color: TONE_FG[b.tone] || TONE_FG.neutral, borderRadius: 999, padding: '2px 10px', whiteSpace: 'nowrap' }}>
      {b.label}
    </span>
  )
}

// Cards always count the same array the list renders (pass the filtered set).
export function TrackerSummary({ cases }) {
  const c = bucketTrackerCounts(cases)
  const cards = [
    ['Total accessible', c.total],
    ['New', c.new],
    ['Serious', c.serious],
    ['Follow-up required', c.followUpRequired],
    ['Under assessment', c.underAssessment],
    ['Closed', c.closed],
    ['Overdue', c.overdue],
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8, marginBottom: 12 }} role="status" aria-label="PV Tracker summary">
      {cards.map(([label, n]) => (
        <Card key={label} style={{ padding: '10px 12px' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: theme.textDark }}>{n}</div>
          <div style={{ fontSize: 12, color: theme.textLight }}>{label}</div>
        </Card>
      ))}
    </div>
  )
}

export function TrackerList({ cases, onOpen }) {
  if (!cases || cases.length === 0) {
    return <Empty title="No routed cases" description="Cases appear here after a report is routed to your verified organisation and passes validation." />
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} role="list" aria-label="Routed safety cases">
      {cases.map((k) => (
        <Card key={k.report_id} style={{ padding: '12px 14px' }}>
          <div role="listitem">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => onOpen(k.report_id)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 15, fontWeight: 800, color: tealDeep, textAlign: 'left' }}>
                {k.report_number || k.report_id}
              </button>
              <SourcePill source={k.report_source} />
            </div>
            <div style={{ fontSize: 13, color: theme.textDark, marginTop: 4 }}>
              {(k.products || []).map((p) => p.product_brand_name).filter(Boolean).join(', ') || '—'}
            </div>
            <div style={{ fontSize: 13, color: theme.textLight }}>
              {(k.reactions || []).map((r) => r.reaction_description).filter(Boolean).join('; ') || '—'}
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 12, color: gray500, flexWrap: 'wrap' }}>
              <span>{k.is_serious ? 'Serious' : 'Non-serious'}</span>
              <span>{companyStatusLabel(k.company_status)}</span>
              <span>Submitted {fmtDate(k.created_at)}</span>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}

// Case header for the detail page: masked-identity notice lives here so no
// reader can mistake masked fields for missing data.
export function CaseHeader({ kase }) {
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 20, fontWeight: 800, color: theme.textDark }}>{kase.report_number || kase.report_id}</span>
        <SourcePill source={kase.report_source} />
      </div>
      <p style={{ fontSize: 13, color: theme.textLight, marginTop: 6 }}>
        Reporter identity and contact details are masked for responsible companies under the interim
        privacy policy — masked fields are hidden by policy, not missing from the case.
      </p>
    </div>
  )
}

// Workflow actions only: status transitions + acknowledgement. No inputs here
// are bound to case tables, so company users cannot edit case data, only
// advance their own workflow state.
export function WorkflowActions({ route, onTransition, busy }) {
  const allowed = allowedCompanyTransitions(route.company_status)
  const ack = (s) => (s === 'acknowledged' ? 'Acknowledge receipt' : companyStatusLabel(s))
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {allowed.map((s) => (
          <Button key={s} variant={s === 'closed' ? 'secondary' : 'primary'} size="md" disabled={busy} onClick={() => onTransition(s)}>
            {ack(s)}
          </Button>
        ))}
      </div>
      <p style={{ fontSize: 12.5, color: theme.textLight, marginTop: 6 }}>
        Internal acknowledgement confirms your team received this case in CareFind. It is not a
        submission to NAFDAC or any regulator.
      </p>
    </div>
  )
}

// Export bar: CSV + bulk PDF + analytics report for the currently filtered
// set. Builders receive masked view data only (includeReporter:false); every
// export is audit-logged per included report.
export function TrackerExportBar({ count, busy, onCsv, onBulk, onAnalytics }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
      <Button variant="secondary" size="md" disabled={busy || count === 0} onClick={onCsv}>Export filtered CSV</Button>
      <Button variant="secondary" size="md" disabled={busy || count === 0} onClick={onBulk}>Export combined PDF</Button>
      <Button variant="secondary" size="md" disabled={busy || count === 0} onClick={onAnalytics}>Download analytics report</Button>
      <span style={{ fontSize: 12, color: theme.textLight }}>
        {count === 0 ? 'Nothing to export.' : `Exports cover the ${count} filtered cases. Combined PDF caps at ${BULK_PDF_CAP} cases with an explicit note.`}
      </span>
    </div>
  )
}

export function filterTrackerCases(cases, f) {
  const q = (f.query || '').trim().toLowerCase()
  return cases.filter((k) => {
    if (f.source && k.report_source !== f.source) return false
    if (f.seriousness === 'serious' && !k.is_serious) return false
    if (f.seriousness === 'non_serious' && k.is_serious) return false
    if (f.companyStatus && k.company_status !== f.companyStatus) return false
    if (f.outcome && !(k.reactions || []).some((r) => r.outcome === f.outcome)) return false
    if (f.reporterType && k.reporter_qualification !== f.reporterType) return false
    if (f.from && new Date(k.created_at) < new Date(f.from)) return false
    if (f.to && new Date(k.created_at) > new Date(f.to + 'T23:59:59')) return false
    if (!q) return true
    const hay = [
      k.report_number,
      ...(k.products || []).map((p) => `${p.product_brand_name} ${p.product_generic_name} ${p.batch_lot_number}`),
      ...(k.reactions || []).map((r) => r.reaction_description),
    ].filter(Boolean).join(' ').toLowerCase()
    return hay.includes(q)
  })
}

export default function PvTracker({ brand }) {
  const navigate = useNavigate()
  const { show: showToast } = useToast()
  const [cases, setCases] = useState(null)
  const [error, setError] = useState(null)
  const [filters, setFilters] = useState({ query: '', source: '', seriousness: '', companyStatus: '', outcome: '', reporterType: '', from: '', to: '' })
  const [tab, setTab] = useState('cases')

  useEffect(() => { load() }, [brand?.id])

  async function load() {
    if (!brand?.id) return
    setError(null)
    try {
      const assigned = await adrReportRepository.getRoutedRoutes(brand.id)
      const full = await Promise.all((assigned || []).map(async (rt) => {
        const kase = await adrReportRepository.getPvCase(rt.report_id)
        if (!kase) return null
        return {
          ...kase,
          route_id: rt.route_id,
          company_status: rt.company_status || 'new',
          report_status: kase.status,
          is_serious: adrValidation.computeIsSerious(kase.adr_reactions || []),
          deadlineBucket: kase.submission_deadline ? getDeadlineStatus(kase.submission_deadline, kase.created_at) : null,
        }
      }))
      // One route row per product: collapse to one card per report, keeping
      // the most advanced company status for the summary.
      const byReport = new Map()
      for (const c of full.filter(Boolean)) {
        if (!byReport.has(c.report_id)) byReport.set(c.report_id, c)
      }
      setCases([...byReport.values()])
    } catch (e) {
      setError(e?.message || 'Unknown error')
    }
  }

  const visible = useMemo(() => filterTrackerCases(cases || [], filters), [cases, filters])
  const [exporting, setExporting] = useState(false)

  const logExport = (ids, format) =>
    logBulkExport((id, type, meta) => adrReportRepository.logEvent(id, type, meta), ids, { format, via: 'pv-tracker', filters: activeFilterLabel })

  async function handleExportCsv() {
    if (visible.length === 0) return
    setExporting(true)
    try {
      const csv = buildAdrCsv(csvRowsFromCases(visible), { includeReporter: false }).join('\n')
      downloadTextFile(`pv-tracker-${Date.now()}.csv`, csv, 'text/csv')
      const { failed } = await logExport(visible.map((c) => c.report_id), 'csv')
      showToast(failed > 0 ? `CSV downloaded, but ${failed} audit events failed to record.` : 'CSV downloaded and audit-logged.', { type: failed > 0 ? 'warning' : 'success' })
    } catch (e) {
      showToast('CSV export failed: ' + (e?.message || 'unknown error'), { type: 'error' })
    } finally {
      setExporting(false)
    }
  }

  async function handleExportBulk() {
    if (visible.length === 0) return
    setExporting(true)
    try {
      const bundles = visible.map((c) => ({
        report: c, products: c.adr_products || [], meds: c.adr_concomitant_meds || [],
        reactions: c.adr_reactions || [], reactionExpected: c.reaction_expected ?? null,
      }))
      const shown = bundles.slice(0, BULK_PDF_CAP)
      openPrintView(buildBulkPdfHtml({ cases: bundles, filtersLabel: activeFilterLabel, orgName: brand?.name || '', cap: BULK_PDF_CAP }))
      const { failed } = await logExport(shown.map((b) => b.report.report_id), 'bulk-pdf')
      showToast(failed > 0 ? `PDF opened, but ${failed} audit events failed to record.` : 'Combined PDF opened and audit-logged.', { type: failed > 0 ? 'warning' : 'success' })
    } catch (e) {
      showToast('PDF export failed: ' + (e?.message || 'unknown error'), { type: 'error' })
    } finally {
      setExporting(false)
    }
  }

  function handleExportAnalytics() {
    if (visible.length === 0) return
    const mapped = visible.map((c) => ({ ...c, reactions: c.adr_reactions || [], products: c.adr_products || [] }))
    const serious = mapped.filter((c) => c.is_serious).length
    const figures = {
      total: mapped.length,
      serious,
      outcomes: outcomeCounts(mapped),
      terms: suppressCounts(topReactionTerms(mapped, 10)),
    }
    openPrintView(buildAnalyticsHtml({ figures, filtersLabel: activeFilterLabel, periodLabel: 'Last 6 months', orgName: brand?.name || '' }))
    logExport(visible.map((c) => c.report_id), 'analytics').catch(() => {})
  }

  const activeFilterLabel = useMemo(() => {
    const parts = []
    if (filters.query.trim()) parts.push(`search “${filters.query.trim()}”`)
    if (filters.source) parts.push(sourceBadge(filters.source).label)
    if (filters.seriousness) parts.push(filters.seriousness === 'serious' ? 'Serious' : 'Non-serious')
    if (filters.companyStatus) parts.push(companyStatusLabel(filters.companyStatus))
    if (filters.outcome) parts.push(`outcome: ${filters.outcome}`)
    if (filters.reporterType) parts.push(`reporter: ${filters.reporterType}`)
    if (filters.from) parts.push(`from ${filters.from}`)
    if (filters.to) parts.push(`to ${filters.to}`)
    return parts.length > 0 ? parts.join(' · ') : 'All routed cases'
  }, [filters])

  const drill = (patch) => {
    setFilters((f) => ({ ...f, ...patch }))
    setTab('cases')
  }

  if (error) return <ErrorState message={`We couldn't load your PV Tracker: ${error}`} onRetry={load} />
  if (!cases) return <Loading text="Loading routed cases…" />

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: theme.space[8] }}>
        <Factory size={22} color={tealDeep} aria-hidden="true" />
        <div>
          <div style={{ fontSize: theme.type.h1.size, fontWeight: theme.type.h1.weight, color: theme.textDark }}>PV Tracker</div>
          <div style={{ fontSize: theme.type.body.size, color: theme.textLight, marginTop: 3 }}>
            Safety cases routed to {brand?.name || 'your organisation'} — confidential, internal use only.
          </div>
        </div>
      </div>

      <TrackerExportBar
        count={visible.length}
        busy={exporting}
        onCsv={handleExportCsv}
        onBulk={handleExportBulk}
        onAnalytics={handleExportAnalytics}
      />
      <TrackerSummary cases={visible} />

      <Card style={{ padding: '10px 12px', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input aria-label="Search cases" placeholder="Report no., product, reaction…" value={filters.query}
            onChange={(e) => setFilters({ ...filters, query: e.target.value })} style={inputStyle} />
          <select aria-label="Report source" value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value })} style={inputStyle}>
            <option value="">All sources</option>
            <option value="public">Public report</option>
            <option value="health_facility">Health-facility report</option>
            <option value="business_facility">Business report</option>
            <option value="unknown">Source not recorded</option>
          </select>
          <select aria-label="Seriousness" value={filters.seriousness} onChange={(e) => setFilters({ ...filters, seriousness: e.target.value })} style={inputStyle}>
            <option value="">Serious + non-serious</option>
            <option value="serious">Serious only</option>
            <option value="non_serious">Non-serious only</option>
          </select>
          <select aria-label="Workflow status" value={filters.companyStatus} onChange={(e) => setFilters({ ...filters, companyStatus: e.target.value })} style={inputStyle}>
            <option value="">Any workflow status</option>
            {['new', 'acknowledged', 'under_assessment', 'follow_up_requested', 'closed'].map((s) => (
              <option key={s} value={s}>{companyStatusLabel(s)}</option>
            ))}
          </select>
          <select aria-label="Outcome" value={filters.outcome} onChange={(e) => setFilters({ ...filters, outcome: e.target.value })} style={inputStyle}>
            <option value="">Any outcome</option>
            {['recovered', 'recovering', 'not_recovered', 'recovered_with_sequelae', 'fatal', 'unknown'].map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <select aria-label="Reporter type" value={filters.reporterType} onChange={(e) => setFilters({ ...filters, reporterType: e.target.value })} style={inputStyle}>
            <option value="">Any reporter type</option>
            {['physician', 'pharmacist', 'nurse', 'other_hcp', 'consumer', 'caregiver', 'lawyer'].map((q) => (
              <option key={q} value={q}>{q}</option>
            ))}
          </select>
          <input aria-label="From date" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} style={inputStyle} />
          <input aria-label="To date" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} style={inputStyle} />
        </div>
      </Card>

      <div role="tablist" aria-label="PV Tracker views" style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: `1px solid ${border}` }}>
        {['cases', 'analytics'].map((t) => {
          const on = tab === t
          return (
            <button
              key={t}
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t)}
              style={{
                padding: '9px 16px', background: 'none', border: 'none', borderBottom: `2px solid ${on ? tealDeep : 'transparent'}`,
                color: on ? tealDeep : gray500, fontWeight: 700, fontSize: 13, cursor: 'pointer', textTransform: 'capitalize',
              }}
            >
              {t}
            </button>
          )
        })}
      </div>

      {tab === 'analytics' ? (
        <PvAnalytics cases={visible} periodLabel="Last 6 months" activeFilters={activeFilterLabel} onDrill={drill} />
      ) : (
        <TrackerList cases={visible} onOpen={(id) => navigate(`/dashboard/reports/pv-tracker/${id}`)} />
      )}
    </div>
  )
}

const inputStyle = {
  fontSize: 13, border: `1px solid ${border}`, borderRadius: 8, padding: '7px 10px',
  background: '#fff', color: theme.textDark, minWidth: 150,
}
