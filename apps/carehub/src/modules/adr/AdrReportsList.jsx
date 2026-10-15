import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Plus } from 'lucide-react'
import { adrReportRepository, getModuleTypeFromBusinessType } from './repositories'
import { ADR_FORM } from './formEngine'
import { buildAdrCsv, buildBulkPdfHtml, csvRowsFromCases, downloadTextFile, openPrintView, BULK_PDF_CAP } from './exports'
import { sourceBadge, logBulkExport } from './pvWorkflow'
import AdrReportsAnalytics from './AdrReportsAnalytics'
import { theme } from '../../styles/theme'
import { useAuth } from '../../providers/AuthProvider'
import { Card, Loading, Empty, ErrorState, Pill, useToast, Toast, Button } from '../../components/ui'

const { tealDeep, navy, gray600, gray500, gray400, border } = theme

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function AdrReportsList({ brand, embedded = false }) {
  const navigate = useNavigate()
  const { auth } = useAuth()
  const { msg: toastMsg, type: toastType, show: showToast } = useToast()
  const [tab, setTab] = useState('list')
  const [reports, setReports] = useState(null)
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => { load() }, [brand?.id])

  async function load() {
    if (!brand?.id) return
    setError(null)
    try {
      const data = await adrReportRepository.getReports(brand.id)
      setReports(data || [])
    } catch (e) {
      const detail = e?.message || 'Unknown error'
      console.error('ADR load error:', detail, e)
      setError(detail)
    }
  }

  async function loadBundles() {
    const list = reports || []
    const shown = list.slice(0, BULK_PDF_CAP)
    const bundles = await Promise.all(shown.map(async (r) => {
      const full = await adrReportRepository.getReportWithDetails(r.report_id)
      return {
        report: full || r,
        products: (full && full.adr_products) || [],
        meds: (full && full.adr_concomitant_meds) || [],
        reactions: (full && full.adr_reactions) || [],
        reactionExpected: (full && full.reaction_expected) ?? null,
      }
    }))
    return { bundles, total: list.length }
  }

  async function handleExportCsv() {
    if (!reports || reports.length === 0 || exporting) return
    setExporting(true)
    try {
      const { bundles, total } = await loadBundles()
      const csv = buildAdrCsv(csvRowsFromCases(bundles.map((b) => ({ ...b.report, adr_products: b.products, adr_reactions: b.reactions }))), { includeReporter: true }).join('\n')
      downloadTextFile(`adr-reports-${Date.now()}.csv`, csv, 'text/csv')
      const { failed } = await logBulkExport(
        (id, type, meta) => adrReportRepository.logEvent(id, type, meta),
        bundles.map((b) => b.report.report_id),
        { format: 'csv', via: 'hub-list', total }
      )
      showToast(failed > 0 ? `CSV downloaded, but ${failed} audit events failed.` : 'CSV downloaded and audit-logged.', { type: failed > 0 ? 'warning' : 'success' })
    } catch (e) {
      showToast('CSV export failed: ' + (e?.message || 'unknown error'), { type: 'error' })
    } finally {
      setExporting(false)
    }
  }

  async function handleExportBulk() {
    if (!reports || reports.length === 0 || exporting) return
    setExporting(true)
    try {
      const { bundles, total } = await loadBundles()
      openPrintView(buildBulkPdfHtml({ cases: bundles, filtersLabel: 'All own reports', orgName: brand?.name || '', cap: BULK_PDF_CAP }))
      const { failed } = await logBulkExport(
        (id, type, meta) => adrReportRepository.logEvent(id, type, meta),
        bundles.map((b) => b.report.report_id),
        { format: 'bulk-pdf', via: 'hub-list', total }
      )
      showToast(failed > 0 ? `PDF opened, but ${failed} audit events failed.` : `Combined PDF opened (${bundles.length} of ${total}) and audit-logged.`, { type: failed > 0 ? 'warning' : 'success' })
    } catch (e) {
      showToast('PDF export failed: ' + (e?.message || 'unknown error'), { type: 'error' })
    } finally {
      setExporting(false)
    }
  }

  async function handleNewReport() {
    if (!brand?.id) {
      showToast('Business not loaded yet — try again', { type: 'warning' })
      return
    }
    setCreating(true)
    try {
      const moduleType = getModuleTypeFromBusinessType(brand.business_type || brand.type || 'pharmacy')
      const staffId = (auth && auth.staff && auth.staff.id) ? auth.staff.id : null
      const result = await adrReportRepository.createReport(brand.id, {
        module_type: moduleType,
        status: 'draft',
        created_by_user_id: staffId,
      })
      const id = (result && result[0] && result[0].report_id) || (result && result.report_id)
      if (id) {
        navigate(`/dashboard/adr-reports/${id}/detail`)
      } else {
        showToast('Could not start a new ADR report — no ID returned', { type: 'warning' })
        setCreating(false)
      }
    } catch (e) {
      const detail = e?.message || 'Unknown error'
      showToast('Error creating ADR report: ' + detail, { type: 'error' })
      setCreating(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: embedded ? 'flex-end' : 'space-between', marginBottom: theme.space[10], flexWrap: 'wrap', gap: theme.space[6] }}>
        {!embedded && (
          <div>
            <div style={{ fontSize: theme.type.h1.size, fontWeight: theme.type.h1.weight, color: theme.textDark }}>Pharmacovigilance (ADR)</div>
            <div style={{ fontSize: theme.type.body.size, color: theme.textLight, marginTop: 3 }}>
              Adverse drug reaction reports for {brand?.name || 'your business'}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" size="md" disabled={exporting || !reports || reports.length === 0} onClick={handleExportCsv}>Export CSV</Button>
          <Button variant="secondary" size="md" disabled={exporting || !reports || reports.length === 0} onClick={handleExportBulk}>Export combined PDF</Button>
          <Button variant="primary" size="md" onClick={handleNewReport} disabled={creating}>
            <Plus size={15} /> New ADR Report
          </Button>
        </div>
      </div>

      <div role="tablist" aria-label="ADR report views" style={{ display: 'flex', gap: 4, marginBottom: theme.space[8], borderBottom: `1px solid ${border}` }}>
        {['list', 'analytics'].map(t => {
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
        <AdrReportsAnalytics brand={brand} />
      ) : error ? (
        <ErrorState
          message={`We couldn't load your ADR reports: ${error}`}
          onRetry={load}
        />
      ) : reports === null ? (
        <Loading text="Loading ADR reports..." />
      ) : reports.length === 0 ? (
        <Card style={{ padding: '40px 24px' }}>
          <Empty
            icon={<AlertTriangle size={22} />}
            message="No ADR reports yet. Start a new adverse drug reaction report to record a suspected reaction, product, or event."
            action="New ADR Report"
            onAction={handleNewReport}
          />
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[4] }}>
          {reports.map(r => {
            const statusToken = ADR_FORM.getStatusToken(r.status)
            return (
              <Card key={r.report_id} style={{ padding: '16px 18px' }} >
                <button
                  onClick={() => navigate(`/dashboard/adr-reports/${r.report_id}/detail`)}
                  aria-label={`Open ADR report ${r.report_number || r.report_id}`}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexWrap: 'wrap' }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 13.5, color: navy }}>
                      {ADR_FORM.formatReportNumber(r.report_number)}
                    </div>
                    <div style={{ fontSize: 12, color: gray500, marginTop: 3 }}>
                      {ADR_FORM.getModuleTitle ? ADR_FORM.getModuleTitle(r.module_type) : r.module_type}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Pill label={sourceBadge(r.report_source).label} type={sourceBadge(r.report_source).tone === 'info' ? 'blue' : sourceBadge(r.report_source).tone === 'success' ? 'green' : sourceBadge(r.report_source).tone === 'warning' ? 'amber' : 'gray'} />
                    <Pill label={ADR_FORM.getStatusLabel(r.status)} type={statusToken === 'info' ? 'blue' : statusToken === 'success' ? 'green' : statusToken === 'warning' ? 'amber' : 'gray'} />
                    <span style={{ fontSize: 12, color: gray400 }}>{fmtDate(r.created_at)}</span>
                  </div>
                </button>
              </Card>
            )
          })}
        </div>
      )}

      <Toast msg={toastMsg} type={toastType} />
    </div>
  )
}
