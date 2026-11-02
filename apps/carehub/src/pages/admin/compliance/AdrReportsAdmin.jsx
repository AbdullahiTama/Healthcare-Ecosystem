import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Search, RefreshCw, Download, FileText, Printer, ChevronRight, Image as ImageIcon } from 'lucide-react'
import { Card, GhostBtn, Sel, Pill, Loading, Empty, ErrorState, useToast, Toast } from '../../../components/ui'
import Sheet from '../../../components/ui/Sheet'
import { useBreakpoint } from '../../../hooks/useBreakpoint'
import { adrReportRepository as defaultRepository } from '../../../modules/adr/repositories'
import { ADR_FORM } from '../../../modules/adr/formEngine'
import { ADR_MODULE_TYPES, ADR_MODULE_TYPE_LABELS } from '../../../modules/adr/types'
import { sourceBadge, logBulkExport } from '../../../modules/adr/pvWorkflow'
import { caseBodyHtml, buildPdfHtml, buildE2bXml, buildAdrCsv, csvRowsFromCases, buildBulkPdfHtml, openPrintView, downloadTextFile, exportFilename, BULK_PDF_CAP } from '../../../modules/adr/exports'
import { exportStamp } from '../../../lib/carefindhubExports'
import RecordFields from '../shared/RecordFields'
import { useAuditedExport } from '../shared/AuditedExport'

// Admin > ADR Reports: every submitted adverse drug reaction report on the platform (business and public), each
// openable in full, with the same PDF / E2B XML / CSV documents the reporting business produces.
//
// Access: gated by the 'Compliance' permission here; the database is the boundary (can_access_adr_report_row lets
// platform admins read every case). The full case contains patient and reporter details, so:
//   * the case body is the shared print fragment (caseBodyHtml, escaped) shown in a sandboxed iframe that cannot run
//     scripts, so reporter-typed text can never execute in the admin console;
//   * every export asks for a reason and is written to export_logs before the file is made, and each exported case
//     also gets an 'exported' event on its own timeline (adr_log_event), as exports from the Hub do;
//   * the CSV leaves out reporter identity (includeReporter: false) pending the privacy lead's ruling on reporter
//     masking (docs/architecture/ADR-Privacy-Security-Audit.md). The PDF matches what the reporting business prints.

const STATUS_OPTIONS = [
  { value: '', label: 'All submitted' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'follow_up_required', label: 'Follow-up required' },
  { value: 'draft', label: 'Drafts only' },
]
const SOURCE_OPTIONS = [
  { value: 'business_facility', label: 'Business report' },
  { value: 'public', label: 'Public report' },
  { value: 'health_facility', label: 'Health facility report' },
  { value: 'unknown', label: 'Source not recorded' },
]
const MODULE_OPTIONS = Object.values(ADR_MODULE_TYPES).map(v => ({ value: v, label: ADR_MODULE_TYPE_LABELS[v] || v }))
const toneOf = { info: 'blue', success: 'green', neutral: 'gray', warning: 'amber' }
const statusTone = (s) => (s === 'submitted' ? 'green' : s === 'follow_up_required' ? 'amber' : 'gray')
const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not set')
// The report number exactly as issued (ADR-2026-000123): what admins search for and what appears on file names.
const numberOf = (r) => r?.report_number || 'Unnumbered draft'
const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null)

function bundleOf(full, fallback) {
  return {
    report: full || fallback,
    products: full?.adr_products || [],
    meds: full?.adr_concomitant_meds || [],
    reactions: full?.adr_reactions || [],
    reactionExpected: full?.reaction_expected ?? null,
  }
}

// The full case rendered from the shared print fragment, isolated: sandbox without allow-scripts means nothing in
// it can run; allow-same-origin only lets this frame measure its height so it never scrolls inside the sheet.
const CASE_DOC_STYLE = `body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#182722;margin:0;padding:4px 2px;line-height:1.5;font-size:13px;background:#fff}
h2{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#0E6F5A;margin:18px 0 6px;border-bottom:1px solid #ECEAE0;padding-bottom:4px}
table{width:100%;border-collapse:collapse;margin-bottom:6px}th{text-align:left;width:40%;color:#5B6B63;font-weight:600;vertical-align:top;padding:3px 8px 3px 0}
td{vertical-align:top;padding:3px 0;overflow-wrap:anywhere}p{margin:4px 0;color:#5B6B63}`
export function caseDocument(bundle) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${CASE_DOC_STYLE}</style></head><body>${caseBodyHtml(bundle)}</body></html>`
}

function CaseFrame({ html, title }) {
  const ref = useRef(null)
  const [height, setHeight] = useState(480)
  const measure = () => {
    try { const doc = ref.current?.contentDocument; if (doc) setHeight(doc.documentElement.scrollHeight + 12) } catch { /* keep the default height */ }
  }
  return <iframe ref={ref} title={title} sandbox="allow-same-origin" srcDoc={html} onLoad={measure} style={{ width: '100%', height, border: '1px solid var(--border)', borderRadius: 10, background: '#fff' }} />
}

function ReportDetail({ summary, businessName, repository, onClose, requestExport, showToast }) {
  const [full, setFull] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!summary) return
    setFull(null); setError('')
    try {
      const data = await repository.getReportWithDetails(summary.report_id)
      if (!data) setError('This report could not be found, or you no longer have access to it.')
      else setFull(data)
    } catch (e) {
      console.error('[admin-adr] report load failed', summary.report_id, e)
      setError(e?.message || 'The report could not be loaded.')
    }
  }, [repository, summary?.report_id])
  useEffect(() => { load() }, [load])

  if (!summary) return null
  const report = full || summary
  const bundle = full ? bundleOf(full, summary) : null
  const number = numberOf(report)
  const logCase = (format) => logBulkExport((id, t, meta) => repository.logEvent(id, t, meta), [report.report_id], { format, via: 'platform-admin' })
    .then(({ failed }) => { if (failed) showToast('The file was produced, but the case timeline could not record the export.', { type: 'warning' }) })

  const exportPdf = () => requestExport({
    exportType: 'admin.adr_report.pdf', label: number, rowCount: 1, format: 'printable PDF',
    note: 'Includes patient and reporter details, exactly as the reporting business prints them.',
    run: async () => { if (!openPrintView(buildPdfHtml(bundle))) throw new Error('Your browser blocked the print window. Allow pop-ups for this site.'); await logCase('pdf') },
  })
  const exportXml = () => requestExport({
    exportType: 'admin.adr_report.e2b.xml', label: number, rowCount: 1, format: 'E2B XML',
    run: async () => { downloadTextFile(exportFilename(report, 'xml'), buildE2bXml(bundle)); await logCase('e2b-xml') },
  })
  const exportCsv = () => requestExport({
    exportType: 'admin.adr_report.csv', label: number, rowCount: 1, format: 'CSV',
    note: 'One row per product and reaction. Reporter identity is left out.',
    run: async () => {
      const csv = buildAdrCsv(csvRowsFromCases([{ ...full, adr_products: bundle.products, adr_reactions: bundle.reactions }]), { includeReporter: false }).join('\n')
      downloadTextFile(exportFilename(report, 'csv'), csv, 'text/csv'); await logCase('csv')
    },
  })

  const photos = (full?.adr_evidence_photos || []).filter(p => safeUrl(p.evidence_photo_file))
  const source = sourceBadge(report.report_source)
  return (
    <Sheet show onClose={onClose} title={number} footer={full && (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', width: '100%' }}>
        <GhostBtn onClick={exportPdf} style={{ flex: '1 1 120px' }}><Printer size={13} style={{ marginRight: 6 }} aria-hidden="true" />PDF</GhostBtn>
        <GhostBtn onClick={exportXml} style={{ flex: '1 1 120px' }}><FileText size={13} style={{ marginRight: 6 }} aria-hidden="true" />E2B XML</GhostBtn>
        <GhostBtn onClick={exportCsv} style={{ flex: '1 1 120px' }}><Download size={13} style={{ marginRight: 6 }} aria-hidden="true" />CSV</GhostBtn>
      </div>
    )}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Pill label={ADR_FORM.getStatusLabel(report.status)} type={statusTone(report.status)} />
          <Pill label={source.label} type={toneOf[source.tone] || 'gray'} />
          <Pill label={ADR_FORM.getModuleTitle(report.module_type)} type="teal" />
        </div>
        <RecordFields sections={[{ title: 'Case', fields: [
          ['Report number', number],
          ['Business', businessName || (report.business_id ? report.business_id : 'Public report (no business)')],
          ['Reporting facility', report.reporter_facility_name],
          ['Created', report.created_at],
          ['Last updated', report.updated_at],
          ['Submission deadline', report.submission_deadline],
          ['Follow-up of', report.follow_up_of_report_id],
          ['Report ID', report.report_id],
        ] }]} />
        {error ? <ErrorState message={error} onRetry={load} />
          : !full ? <Loading text="Loading the full report…" />
          : (
            <>
              <CaseFrame html={caseDocument(bundle)} title={`Full details of ${number}`} />
              <section aria-label="Evidence photos">
                <h3 style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--teal)' }}>Evidence photos</h3>
                {photos.length === 0 ? <div style={{ fontSize: 13, color: 'var(--muted)' }}>No evidence photos were attached.</div> : (
                  <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
                    {photos.map(p => (
                      <a key={p.photo_id} href={safeUrl(p.evidence_photo_file)} target="_blank" rel="noopener noreferrer" style={{ display: 'block', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', textDecoration: 'none', color: 'var(--fg)' }}>
                        <img src={safeUrl(p.evidence_photo_file)} alt={p.evidence_photo_caption || 'Evidence photo'} loading="lazy" style={{ width: '100%', height: 96, objectFit: 'cover', display: 'block', background: 'var(--hairline)' }} />
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '6px 8px', color: 'var(--muted)' }}><ImageIcon size={11} aria-hidden="true" />Open full size</span>
                      </a>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
      </div>
    </Sheet>
  )
}

export default function AdrReportsAdmin({ repository = defaultRepository, businesses = [] }) {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({ search: '', status: '', source: '', moduleType: '' })
  const [selectedId, setSelectedId] = useState(null)
  const [preparing, setPreparing] = useState(false)
  const { msg, type, show: showToast } = useToast()
  const { requestExport, exportDialog } = useAuditedExport({ onExported: () => showToast('Export recorded and produced.', { type: 'success' }) })
  const { isMobile } = useBreakpoint()
  const nameOf = useMemo(() => new Map((businesses || []).map(b => [b.id, b.name])), [businesses])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await repository.getPlatformReports({ status: filters.status || undefined, source: filters.source || undefined, moduleType: filters.moduleType || undefined, search: filters.search.trim() || undefined })
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error('[admin-adr] list failed', e)
      setError(e?.message || 'The reports could not be loaded.')
    }
    setLoading(false)
  }, [repository, filters])
  useEffect(() => { const t = setTimeout(load, filters.search ? 300 : 0); return () => clearTimeout(t) }, [load, filters.search])

  const setFilter = (patch) => setFilters(f => ({ ...f, ...patch }))
  const list = rows || []
  const selected = list.find(r => r.report_id === selectedId) || null
  const filtersLabel = [STATUS_OPTIONS.find(o => o.value === filters.status)?.label, filters.source && sourceBadge(filters.source).label, filters.moduleType && ADR_MODULE_TYPE_LABELS[filters.moduleType], filters.search && `“${filters.search}”`].filter(Boolean).join(' · ')

  // Full cases for the list exports, ten at a time so a large selection does not flood the database.
  const loadBundles = async (cap) => {
    const shown = list.slice(0, cap)
    const out = []
    for (let i = 0; i < shown.length; i += 10) {
      const chunk = await Promise.all(shown.slice(i, i + 10).map(async r => bundleOf(await repository.getReportWithDetails(r.report_id), r)))
      out.push(...chunk)
    }
    return out
  }
  const logAll = (bundles, format) => logBulkExport((id, t, meta) => repository.logEvent(id, t, meta), bundles.map(b => b.report.report_id), { format, via: 'platform-admin', total: list.length })
  const runWithProgress = async (fn) => { setPreparing(true); try { await fn() } finally { setPreparing(false) } }

  const exportCsv = () => requestExport({
    exportType: 'admin.adr_reports.csv', label: 'ADR reports', rowCount: list.length, format: 'CSV',
    note: 'One row per product and reaction. Reporter identity is left out.',
    run: () => runWithProgress(async () => {
      const bundles = await loadBundles(list.length)
      const csv = buildAdrCsv(csvRowsFromCases(bundles.map(b => ({ ...b.report, adr_products: b.products, adr_reactions: b.reactions }))), { includeReporter: false }).join('\n')
      downloadTextFile(`adr-reports_${exportStamp()}.csv`, csv, 'text/csv')
      await logAll(bundles, 'csv')
    }),
  })
  const exportPdf = () => requestExport({
    exportType: 'admin.adr_reports.pdf', label: 'ADR reports', rowCount: Math.min(list.length, BULK_PDF_CAP), format: 'printable PDF',
    note: list.length > BULK_PDF_CAP ? `The PDF holds the first ${BULK_PDF_CAP} of ${list.length} reports. Use CSV for the full set.` : 'Includes patient and reporter details.',
    run: () => runWithProgress(async () => {
      const bundles = await loadBundles(BULK_PDF_CAP)
      if (!openPrintView(buildBulkPdfHtml({ cases: bundles, filtersLabel: filtersLabel || 'All submitted', orgName: 'CareHub platform', cap: BULK_PDF_CAP }))) throw new Error('Your browser blocked the print window. Allow pop-ups for this site.')
      await logAll(bundles, 'bulk-pdf')
    }),
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', flex: '1 1 520px' }}>
          <div style={{ position: 'relative', flex: '1 1 220px' }}>
            <Search size={14} aria-hidden="true" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
            <input value={filters.search} onChange={e => setFilter({ search: e.target.value })} placeholder="Report number or facility" aria-label="Search ADR reports"
              style={{ width: '100%', padding: '9px 12px 9px 30px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13, boxSizing: 'border-box' }} />
          </div>
          <Sel aria-label="Filter by status" value={filters.status} onChange={v => setFilter({ status: v })} placeholder="All submitted" options={STATUS_OPTIONS.slice(1)} style={{ flex: '1 1 150px' }} />
          <Sel aria-label="Filter by source" value={filters.source} onChange={v => setFilter({ source: v })} placeholder="Any source" options={SOURCE_OPTIONS} style={{ flex: '1 1 150px' }} />
          <Sel aria-label="Filter by module" value={filters.moduleType} onChange={v => setFilter({ moduleType: v })} placeholder="Any module" options={MODULE_OPTIONS} style={{ flex: '1 1 150px' }} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <GhostBtn onClick={load} disabled={loading}><RefreshCw size={12} style={{ marginRight: 6 }} aria-hidden="true" />Refresh</GhostBtn>
          <GhostBtn onClick={exportCsv} disabled={!list.length || preparing}><Download size={12} style={{ marginRight: 6 }} aria-hidden="true" />CSV</GhostBtn>
          <GhostBtn onClick={exportPdf} disabled={!list.length || preparing}><Printer size={12} style={{ marginRight: 6 }} aria-hidden="true" />PDF</GhostBtn>
        </div>
      </Card>
      {preparing && <div role="status" style={{ fontSize: 12, color: 'var(--muted)' }}>Preparing the export…</div>}

      {loading && rows == null ? <Loading text="Loading ADR reports…" />
        : error && rows == null ? <ErrorState message={error} onRetry={load} />
        : (
          <>
            {error && <div role="alert" style={{ fontSize: 12, color: 'var(--red)' }}>{error}</div>}
            <div style={{ fontSize: 12, color: 'var(--muted)' }} aria-live="polite">{list.length} report{list.length === 1 ? '' : 's'}{list.length >= 500 ? ' (showing the newest 500, narrow the filters to see older ones)' : ''}</div>
            {list.length === 0 ? (
              <Card style={{ padding: 32, background: 'var(--panel)', border: '1px solid var(--border)' }}>
                <Empty icon={<FileText size={24} />} message={filters.search || filters.status || filters.source || filters.moduleType ? 'No reports match these filters.' : 'No adverse drug reaction reports have been submitted yet.'} />
              </Card>
            ) : isMobile ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {list.map(r => (
                  <button key={r.report_id} type="button" onClick={() => setSelectedId(r.report_id)} aria-label={`Open ${numberOf(r)}`}
                    style={{ textAlign: 'left', padding: 14, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--panel)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--fg)', fontFamily: 'var(--font-mono)' }}>{numberOf(r)}</span>
                      <Pill label={ADR_FORM.getStatusLabel(r.status)} type={statusTone(r.status)} />
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{nameOf.get(r.business_id) || r.reporter_facility_name || sourceBadge(r.report_source).label}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{ADR_MODULE_TYPE_LABELS[r.module_type] || r.module_type} · {fmtDay(r.created_at)}</div>
                  </button>
                ))}
              </div>
            ) : (
              <Card style={{ padding: 0, overflow: 'hidden', background: 'var(--panel)', border: '1px solid var(--border)' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <caption className="sr-only">Adverse drug reaction reports. Select one to see the full report.</caption>
                    <thead style={{ borderBottom: '1px solid var(--border)' }}>
                      <tr style={{ height: 36 }}>
                        {['Report', 'Business / reporter', 'Module', 'Source', 'Status', 'Created', 'Deadline', ''].map(h => (
                          <th key={h || 'open'} scope="col" style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h || <span className="sr-only">Open</span>}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {list.map(r => {
                        const src = sourceBadge(r.report_source)
                        return (
                          <tr key={r.report_id} onClick={() => setSelectedId(r.report_id)} className="ds-data-row" style={{ borderBottom: '1px solid var(--hairline)', cursor: 'pointer', height: 44 }}>
                            <td style={{ padding: '0 12px' }}>
                              <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedId(r.report_id) }} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--fg)', fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{numberOf(r)}</button>
                            </td>
                            <td style={{ padding: '0 12px', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf.get(r.business_id) || r.reporter_facility_name || '—'}</td>
                            <td style={{ padding: '0 12px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{ADR_MODULE_TYPE_LABELS[r.module_type] || r.module_type}</td>
                            <td style={{ padding: '0 12px' }}><Pill label={src.label} type={toneOf[src.tone] || 'gray'} /></td>
                            <td style={{ padding: '0 12px' }}><Pill label={ADR_FORM.getStatusLabel(r.status)} type={statusTone(r.status)} /></td>
                            <td style={{ padding: '0 12px', color: 'var(--muted)', whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDay(r.created_at)}</td>
                            <td style={{ padding: '0 12px', color: 'var(--muted)', whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDay(r.submission_deadline)}</td>
                            <td style={{ padding: '0 12px', color: 'var(--muted)' }} aria-hidden="true"><ChevronRight size={14} /></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </>
        )}

      <ReportDetail summary={selected} businessName={selected ? nameOf.get(selected.business_id) : null} repository={repository} onClose={() => setSelectedId(null)} requestExport={requestExport} showToast={showToast} />
      {exportDialog}
      <Toast msg={msg} type={type} />
    </div>
  )
}
