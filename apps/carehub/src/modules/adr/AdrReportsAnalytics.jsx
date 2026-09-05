import { useState, useEffect } from 'react'
import { TrendingUp } from 'lucide-react'
import { adrReportRepository } from './repositories'
import { ADR_FORM } from './formEngine'
import { bucketCounts, countBy, monthlyVolume, seriousCount } from './analytics'
import { theme } from '../../styles/theme'
import { Card, Loading, ErrorState, Empty, Pill } from '../../components/ui'

const { tealDeep, navy, gray600, gray500, gray400, gray100, danger, success, warning } = theme

const STATUS_PILL = {
  draft: 'amber',
  submitted: 'green',
  exported: 'blue',
  follow_up_required: 'amber',
}

export default function AdrReportsAnalytics({ brand }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => { load() }, [brand?.id])

  async function load() {
    setError(false)
    setRows(null)
    try {
      const data = await adrReportRepository.getAnalytics(brand.id)
      setRows(data || [])
    } catch (e) {
      setError(true)
    }
  }

  if (error) return <ErrorState message="We couldn't load ADR analytics. Check your connection and try again." onRetry={load} />
  if (rows === null) return <Loading text="Loading ADR analytics..." />

  if (rows.length === 0) {
    return (
      <Card style={{ padding: '40px 24px' }}>
        <Empty
          icon={<TrendingUp size={22} />}
          message="No analytics yet. Once you create ADR reports, this tab shows status mix, seriousness and deadline compliance."
        />
      </Card>
    )
  }

  const byStatus = countBy(rows, 'status')
  const byModule = countBy(rows, 'module_type')
  const serious = seriousCount(rows)
  const nonSerious = rows.length - serious
  const buckets = bucketCounts(rows)
  const volume = monthlyVolume(rows)
  const maxVolume = Math.max(...volume.map(([, n]) => n), 1)

  const statCard = (label, value, sub, accent) => (
    <Card style={{ padding: '18px 20px', borderLeft: `4px solid ${accent}` }}>
      <div style={{ fontSize: 12, color: gray500, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 900, color: accent }}>{value}</div>
      <div style={{ fontSize: 12, color: gray400, marginTop: 4 }}>{sub}</div>
    </Card>
  )

  const barRow = (label, count, total, accent) => {
    const pct = total > 0 ? Math.round((count / total) * 100) : 0
    return (
      <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: gray600, width: 150, fontWeight: 600, flexShrink: 0 }}>{label}</span>
        <div style={{ flex: 1, height: 10, background: gray100, borderRadius: 5, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: accent, borderRadius: 5 }} />
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, width: 70, textAlign: 'right', flexShrink: 0, color: navy }}>{count} · {pct}%</span>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 20 }}>
        {statCard('Total ADR reports', rows.length, 'across all statuses', navy)}
        {statCard('Serious', serious, 'any reaction flagged serious', danger)}
        {statCard('Non-serious', nonSerious, 'no seriousness flag', success)}
        {statCard('Overdue', buckets.overdue, 'deadline passed or <20% left', danger)}
        {statCard('Due soon', buckets.due_soon, '20–50% window remaining', warning)}
        {statCard('On track', buckets.on_track, '>50% window remaining', success)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 20 }}>
        <Card style={{ padding: '18px 20px' }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: navy, marginBottom: 14 }}>Reports by status</div>
          {Object.keys(byStatus).length === 0 && <div style={{ fontSize: 12, color: gray400 }}>No reports</div>}
          {Object.entries(byStatus).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
            <div key={status} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${gray100}` }}>
              <span style={{ fontSize: 13, color: gray600, fontWeight: 600 }}>{ADR_FORM.getStatusLabel(status)}</span>
              <Pill label={String(count)} type={STATUS_PILL[status] || 'gray'} />
            </div>
          ))}
        </Card>

        <Card style={{ padding: '18px 20px' }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: navy, marginBottom: 14 }}>Deadline compliance</div>
          {barRow('On track', buckets.on_track, rows.length, success)}
          {barRow('Due soon', buckets.due_soon, rows.length, warning)}
          {barRow('Overdue', buckets.overdue, rows.length, danger)}
          <div style={{ fontSize: 11, color: gray400, marginTop: 6 }}>
            Drafts use the projected deadline from seriousness and expectedness.
          </div>
        </Card>

        <Card style={{ padding: '18px 20px' }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: navy, marginBottom: 14 }}>By module type</div>
          {Object.entries(byModule).sort((a, b) => b[1] - a[1]).map(([m, count]) => (
            <div key={m} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${gray100}` }}>
              <span style={{ fontSize: 13, color: gray600, fontWeight: 600 }}>{ADR_FORM.getModuleTitle(m) || m}</span>
              <Pill label={String(count)} type="teal" />
            </div>
          ))}
        </Card>
      </div>

      <Card style={{ padding: '18px 20px' }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: navy, marginBottom: 14 }}>Report volume — last 6 months</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 120 }}>
          {volume.map(([month, count]) => (
            <div key={month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: navy }}>{count}</div>
              <div style={{ width: '100%', maxWidth: 46, height: `${Math.max((count / maxVolume) * 100, 3)}%`, minHeight: 4, background: tealDeep, borderRadius: '4px 4px 0 0' }} />
              <div style={{ fontSize: 10, color: gray400 }}>{month.slice(2)}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}