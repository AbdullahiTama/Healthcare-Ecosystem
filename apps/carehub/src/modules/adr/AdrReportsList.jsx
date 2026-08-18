import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Plus } from 'lucide-react'
import { adrReportRepository } from './repositories'
import { ADR_FORM } from './formEngine'
import AdrReportsAnalytics from './AdrReportsAnalytics'
import { theme } from '../../styles/theme'
import { useAuth } from '../../providers/AuthProvider'
import { Card, Loading, Empty, ErrorState, Pill, useToast, Toast, Button } from '../../components/ui'

const { tealDeep, navy, gray600, gray500, gray400, border } = theme

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function AdrReportsList({ brand }) {
  const navigate = useNavigate()
  const { auth } = useAuth()
  const { msg: toastMsg, type: toastType, show: showToast } = useToast()
  const [tab, setTab] = useState('list')
  const [reports, setReports] = useState(null)
  const [error, setError] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => { load() }, [brand?.id])

  async function load() {
    setError(false)
    try {
      const data = await adrReportRepository.getReports(brand.id)
      setReports(data || [])
    } catch (e) {
      setError(true)
    }
  }

  async function handleNewReport() {
    setCreating(true)
    try {
      const moduleType = ADR_FORM.getModuleType(brand.business_type || brand.type || 'pharmacy')
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
        showToast('Could not start a new ADR report', { type: 'warning' })
        setCreating(false)
      }
    } catch (e) {
      showToast('Error creating ADR report', { type: 'warning' })
      setCreating(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: theme.space[10], flexWrap: 'wrap', gap: theme.space[6] }}>
        <div>
          <div style={{ fontSize: theme.type.h1.size, fontWeight: theme.type.h1.weight, color: theme.textDark }}>ADR Reports</div>
          <div style={{ fontSize: theme.type.body.size, color: theme.textLight, marginTop: 3 }}>
            Adverse drug reaction reports for {brand?.name || 'your business'}
          </div>
        </div>
        <Button variant="primary" size="md" onClick={handleNewReport} disabled={creating}>
          <Plus size={15} /> New ADR Report
        </Button>
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
          message="We couldn't load your ADR reports. Check your connection and try again."
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
