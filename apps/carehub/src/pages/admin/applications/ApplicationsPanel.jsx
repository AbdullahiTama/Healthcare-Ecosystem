import { useState, useEffect, useCallback, useMemo } from 'react'
import { RefreshCw, FileText, Download, Search, Check, X, ChevronRight } from 'lucide-react'
import { Card, GhostBtn, TealBtn, Sel, Textarea, Pill, Loading, Empty, ErrorState, useToast, Toast } from '../../../components/ui'
import Sheet from '../../../components/ui/Sheet'
import { theme } from '../../../styles/theme'
import { fmtDate } from '../../../lib/utils'
import * as api from '../../../services/supabase'
import { toCsv, recordToCsv, downloadCsv, exportStamp, fileSlug } from '../../../lib/carefindhubExports'
import RecordFields from '../shared/RecordFields'
import { useAuditedExport } from '../shared/AuditedExport'
import { normalizeApplications, filterApplications, applicationSections, applicationRecordFields, typeLabel, APPLICATION_EXPORT_COLUMNS } from './applicationRecords'

// Admin > Applications: ambassador (agent), online-store and team applications. Every application opens in full
// (applicant, location and selected areas, every answer on the form, review history) and can be exported.
// Approve / Reject keep their existing effects: an approved unified agent application creates the agent row, an
// approved unified online-store application enables the store. Online-store applications from the store flow are
// reviewed in CareFind Admin > Shop, where terms and commission are set, so they are view-only here (this screen used
// to show "approved" for them without changing anything).

const STATUS_TONE = { approved: 'green', rejected: 'red', pending: 'amber' }
const TYPES = ['all', 'agent', 'ecommerce', 'team']

async function loadAll(service) {
  const [unified, agentLegacy, ecommerce] = await Promise.all([
    service.getApplications().catch((e) => { console.error('[admin-applications] applications', e); return null }),
    service.getAgentApplications().catch((e) => { console.error('[admin-applications] agent_applications', e); return null }),
    service.sbFetch('ecommerce_applications?select=*&order=created_at.desc&limit=200').catch((e) => { console.error('[admin-applications] ecommerce_applications', e); return null }),
  ])
  const failed = [unified, agentLegacy, ecommerce].filter(r => r === null).length
  return { unified: unified || [], agentLegacy: agentLegacy || [], ecommerce: ecommerce || [], failed }
}

function ApplicationDetail({ app, onClose, onReview, busy, requestExport }) {
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { setNotes(''); setError('') }, [app?.key])
  if (!app) return null

  const review = async (status) => {
    if (status === 'rejected' && notes.trim().length < 3) { setError('Say why the application is rejected (the applicant may ask).'); return }
    setError('')
    await onReview(app, status, notes.trim())
  }
  const exportOne = () => requestExport({
    exportType: 'admin.application.csv', label: `${typeLabel(app.type).toLowerCase()} application — ${app.name || app.id}`, rowCount: 1,
    run: () => downloadCsv(`application_${fileSlug(app.name)}_${exportStamp()}.csv`, recordToCsv(applicationRecordFields(app))),
  })

  return (
    <Sheet show onClose={onClose} title={app.name || 'Application'} footer={
      <div style={{ display: 'flex', gap: 8, width: '100%', flexWrap: 'wrap' }}>
        {app.reviewable && app.status === 'pending' && (
          <>
            <TealBtn disabled={busy} onClick={() => review('approved')} style={{ flex: '1 1 120px' }}><Check size={14} aria-hidden="true" /> Approve</TealBtn>
            <button type="button" disabled={busy} onClick={() => review('rejected')} style={{ flex: '1 1 120px', padding: 10, borderRadius: 12, border: 'none', background: 'var(--red-bg)', color: 'var(--red)', fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}><X size={14} aria-hidden="true" /> Reject</button>
          </>
        )}
        <GhostBtn onClick={exportOne} style={{ flex: '1 1 120px' }}><Download size={13} style={{ marginRight: 6 }} aria-hidden="true" />Export</GhostBtn>
      </div>
    }>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Pill label={typeLabel(app.type)} type="teal" />
          <Pill label={app.status} type={STATUS_TONE[app.status] || 'gray'} />
        </div>
        <RecordFields sections={applicationSections(app)} />
        {!app.reviewable && (
          <div style={{ fontSize: 12, color: 'var(--muted)', padding: '10px 12px', background: 'var(--hairline)', borderRadius: 8 }}>
            Online-store applications are reviewed in CareFind Admin › Shop, where the commission and terms are confirmed.
          </div>
        )}
        {app.reviewable && app.status === 'pending' && (
          <Textarea id="application-review-notes" label="Review notes" rows={3} value={notes} onChange={(v) => { setNotes(v); setError('') }}
            placeholder="Optional for approval; required when rejecting" error={error || undefined} helperText="Saved on the application." />
        )}
      </div>
    </Sheet>
  )
}

export default function ApplicationsPanel({ service = api, businesses = [] }) {
  const { msg, type, show: showToast } = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadWarning, setLoadWarning] = useState('')
  const [filters, setFilters] = useState({ type: 'all', status: '', search: '' })
  const [selectedKey, setSelectedKey] = useState(null)
  const [busy, setBusy] = useState(false)
  const { requestExport, exportDialog } = useAuditedExport({ onExported: () => showToast('Export recorded and downloaded.', { type: 'info' }) })
  const businessNames = useMemo(() => new Map((businesses || []).map(b => [b.id, b.name])), [businesses])

  const load = useCallback(async () => {
    setLoading(true)
    const res = await loadAll(service)
    setData(res)
    setLoadWarning(res.failed === 3 ? 'Applications could not be loaded.' : res.failed ? 'Some application sources could not be loaded, so this list may be incomplete.' : '')
    setLoading(false)
  }, [service])
  useEffect(() => { load() }, [load])

  const apps = useMemo(() => (data ? normalizeApplications({ ...data, businessNames }) : []), [data, businessNames])
  const filtered = useMemo(() => filterApplications(apps, filters), [apps, filters])
  const selected = apps.find(a => a.key === selectedKey) || null
  const setFilter = (patch) => setFilters(f => ({ ...f, ...patch }))

  const handleReview = async (app, status, notes) => {
    if (busy || !app.reviewable) return
    setBusy(true)
    const now = new Date().toISOString()
    try {
      if (app.source === 'agent_applications') {
        await service.reviewAgentApplication(app.id, { status, reviewed_at: now, review_notes: notes || null })
      } else {
        await service.reviewApplication(app.id, { status, reviewed_at: now, review_notes: notes || 'Reviewed in the admin console' })
        if (app.type === 'ecommerce' && status === 'approved' && app.reference) {
          await service.updateBusiness(app.reference, { ecommerce_enabled: true }).catch((e) => { console.error('[admin-applications] enable store', e); showToast('Approved, but the online store could not be enabled. Enable it from Businesses.', { type: 'warning' }) })
        }
        if (app.type === 'agent' && status === 'approved') {
          await service.addAgentRow({ name: app.name || 'Agent', contact_email: app.email, contact_phone: app.phone, status: 'approved_pending_onboarding', city: app.city || '', area: app.areas.join(', ') })
            .catch((e) => { console.error('[admin-applications] create agent', e); showToast('Approved, but the agent record could not be created. Add it under Team › Agents.', { type: 'warning' }) })
        }
      }
      showToast(`Application ${status}.`, { type: 'success' })
      setSelectedKey(null)
      await load()
    } catch (e) {
      console.error('[admin-applications] review failed', e)
      showToast(e?.message?.includes('42501') || /permission/i.test(e?.message || '') ? 'You do not have permission to review applications.' : (e?.message || 'The review could not be saved.'), { type: 'error' })
    }
    setBusy(false)
  }

  const exportList = () => requestExport({
    exportType: 'admin.applications.csv', label: 'applications', rowCount: filtered.length,
    run: () => downloadCsv(`applications_${filters.type}_${exportStamp()}.csv`, toCsv(APPLICATION_EXPORT_COLUMNS, filtered)),
  })

  if (loading && !data) return <Loading text="Loading applications…" />
  if (data && data.failed === 3) return <ErrorState message="Applications could not be loaded." onRetry={load} />

  const countOf = (t) => apps.filter(a => a.type === t).length
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div role="tablist" aria-label="Application type" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {TYPES.map(t => (
          <button key={t} type="button" role="tab" aria-selected={filters.type === t} onClick={() => setFilter({ type: t })}
            style={{ padding: '8px 14px', borderRadius: theme.radius.md, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: filters.type === t ? 'var(--teal)' : 'var(--hairline)', color: filters.type === t ? 'white' : 'var(--muted)' }}>
            {t === 'all' ? `All (${apps.length})` : `${typeLabel(t)} (${countOf(t)})`}
          </button>
        ))}
      </div>
      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flex: '1 1 360px', alignItems: 'flex-end' }}>
          <div style={{ position: 'relative', flex: '1 1 220px' }}>
            <Search size={14} aria-hidden="true" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
            <input value={filters.search} onChange={e => setFilter({ search: e.target.value })} placeholder="Name, email, phone, city or area" aria-label="Search applications"
              style={{ width: '100%', padding: '9px 12px 9px 30px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13, boxSizing: 'border-box' }} />
          </div>
          <Sel aria-label="Filter by status" value={filters.status} onChange={v => setFilter({ status: v })} placeholder="Any status" options={[{ value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }]} style={{ flex: '1 1 140px' }} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostBtn onClick={load} disabled={loading}><RefreshCw size={13} style={{ marginRight: 6 }} aria-hidden="true" />Refresh</GhostBtn>
          <GhostBtn onClick={exportList} disabled={filtered.length === 0}><Download size={13} style={{ marginRight: 6 }} aria-hidden="true" />Export</GhostBtn>
        </div>
      </Card>
      {loadWarning && <div role="alert" style={{ fontSize: 12, color: 'var(--amber)', fontWeight: 600 }}>{loadWarning}</div>}

      {filtered.length === 0 ? (
        <Empty icon={<FileText size={28} />} message={apps.length ? 'No applications match these filters.' : 'No applications yet. Every application needs an explicit admin review; nothing is approved automatically.'} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(a => (
            <button key={a.key} type="button" onClick={() => setSelectedKey(a.key)} aria-label={`Open ${typeLabel(a.type)} application from ${a.name || 'an applicant'}`}
              style={{ textAlign: 'left', width: '100%', padding: 14, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--panel)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name || 'Unnamed applicant'}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{typeLabel(a.type)} · {fmtDate(a.submittedAt)}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {[a.email, [a.city, a.state].filter(Boolean).join(', '), a.areas.length ? `${a.areas.length} area${a.areas.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
                </div>
              </div>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <Pill label={a.status} type={STATUS_TONE[a.status] || 'gray'} />
                <ChevronRight size={14} aria-hidden="true" style={{ color: 'var(--muted)' }} />
              </span>
            </button>
          ))}
        </div>
      )}

      <ApplicationDetail app={selected} onClose={() => setSelectedKey(null)} onReview={handleReview} busy={busy} requestExport={requestExport} />
      {exportDialog}
      <Toast msg={msg} type={type} />
    </div>
  )
}
