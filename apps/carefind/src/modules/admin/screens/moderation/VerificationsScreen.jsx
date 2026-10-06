import { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle, XCircle, FileText, ExternalLink, UserCheck } from 'lucide-react'
import { Button, DataTable, Empty, FilterBar, SearchBar } from '@care-ecosystem/design-system/components/ui'
import { theme } from '../../../../styles/theme'
import { callAdminAuth } from '../../adminApi'
import { useQueue } from '../../data/queues'
import { useAdminToast, useAdminActivity, useAuditLog } from '../../AdminFeedback.jsx'
import AdminPageHeader from '../../ui/AdminPageHeader.jsx'
import { FilterPills } from '../../ui/FilterPills.jsx'
import { timeAgo } from '../../ui/adminHelpers.js'
import { useUrlFilters } from '../../ui/useUrlFilters.js'
import { DetailDrawer, DetailField } from '../../ui/DetailDrawer.jsx'
import { StatusPill } from '../../ui/StatusPill.jsx'
import { primaryCell } from '../../ui/tableHelpers.jsx'

const DEFAULTS = { status: 'pending', q: '', id: '' }
const nameOf = (v) => v.full_name || 'Unnamed applicant'

export default function VerificationsScreen() {
  const { data: rows = [], isLoading, error, refetch } = useQueue('verifications')
  const [f, setF] = useUrlFilters(DEFAULTS)
  const qc = useQueryClient()
  const showToast = useAdminToast()
  const { recordAction } = useAdminActivity()
  const audit = useAuditLog()
  const [busy, setBusy] = useState(null) // 'approve' | 'reject' | 'credential' | null
  const [credentialError, setCredentialError] = useState('')

  const counts = useMemo(() => ({
    all: rows.length,
    pending: rows.filter(r => r.status === 'pending').length,
    approved: rows.filter(r => r.status === 'approved').length,
    rejected: rows.filter(r => r.status === 'rejected').length,
  }), [rows])

  const filtered = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    return rows.filter(r => {
      if (f.status !== 'all' && r.status !== f.status) return false
      if (!q) return true
      return [r.full_name, r.profession, r.workplace, r.phone].some(v => (v || '').toLowerCase().includes(q))
    })
  }, [rows, f.status, f.q])

  const selected = f.id ? rows.find(r => String(r.id) === f.id) : null
  const open = (row) => { setCredentialError(''); setF({ id: row.id }, { replace: false }) }
  const close = () => { setCredentialError(''); setF({ id: null }) }

  // The record open right now. An action that finishes later closes the
  // drawer only if it is still showing the record that was acted on.
  const openId = useRef(f.id)
  openId.current = f.id
  const closeIf = (id) => { if (openId.current === String(id)) close() }

  async function decide(kind) {
    if (busy || !selected) return
    const record = selected
    setBusy(kind)
    const verb = kind === 'approve' ? 'approve' : 'reject'
    try {
      if (kind === 'approve') {
        await callAdminAuth('approve_verification', { id: record.id, userId: record.user_id, profession: record.profession })
        audit('approve', 'verification', record.id, { userId: record.user_id, profession: record.profession })
      } else {
        await callAdminAuth('reject_verification', { id: record.id })
        audit('reject', 'verification', record.id, {})
      }
      recordAction({ action: verb, target: 'verification', id: record.id })
      showToast(kind === 'approve' ? 'Verification approved' : 'Verification rejected', { type: 'success' })
      closeIf(record.id)
      qc.invalidateQueries({ queryKey: ['admin'] })
    } catch (err) {
      showToast(`Couldn't ${verb} the verification: ${err.message}`, { type: 'error' })
    } finally {
      setBusy(null)
    }
  }

  // The tab is opened synchronously, inside the click's user-activation
  // window, and pointed at the signed URL once it arrives. Calling
  // window.open() after the await is blocked by Chrome and Safari.
  async function openCredential() {
    if (busy || !selected) return
    setBusy('credential')
    setCredentialError('')
    // Not opened with the noopener feature: that makes window.open return
    // null, so the tab could never be sent to the document. The opener link
    // is cut by hand before the tab is pointed anywhere.
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    try {
      const { url } = await callAdminAuth('credential_url', { requestId: selected.id })
      if (tab) tab.location = url
      else setCredentialError('Your browser blocked the document window. Allow popups for this site and try again.')
    } catch (err) {
      if (tab) tab.close()
      setCredentialError(`Could not open the document: ${err.message}`)
    } finally {
      setBusy(null)
    }
  }

  const columns = [
    { key: 'full_name', label: 'Applicant', sortable: true, sortValue: r => nameOf(r).toLowerCase(), render: r => primaryCell({ title: nameOf(r), sub: r.phone, onOpen: () => open(r), openLabel: `Open ${nameOf(r)}` }) },
    { key: 'profession', label: 'Profession', sortable: true, render: r => r.profession || '—' },
    { key: 'workplace', label: 'Workplace', render: r => r.workplace || '—' },
    { key: 'created_at', label: 'Submitted', sortable: true, sortValue: r => r.created_at || '', render: r => (r.created_at ? timeAgo(r.created_at) : '—') },
    { key: 'status', label: 'Status', render: r => <StatusPill status={r.status} /> },
  ]

  return (
    <div>
      <AdminPageHeader title="Verifications" subtitle={`${counts.pending} pending · ${counts.all} total`} />

      <FilterBar label="Verification filters" style={{ marginBottom: theme.space[8] }}>
        <SearchBar label="Search verifications" value={f.q} onChange={(q) => setF({ q })} placeholder="Search name, profession, workplace…" />
        <FilterPills
          value={f.status}
          onChange={(status) => setF({ status })}
          options={[
            { value: 'pending', label: `Pending ${counts.pending}` },
            { value: 'approved', label: `Approved ${counts.approved}` },
            { value: 'rejected', label: `Rejected ${counts.rejected}` },
            { value: 'all', label: `All ${counts.all}` },
          ]}
        />
      </FilterBar>

      <DataTable
        rows={filtered}
        columns={columns}
        onRowClick={open}
        loading={isLoading}
        error={error ? 'The verification requests could not be loaded.' : null}
        onRetry={refetch}
        empty={<Empty icon={<UserCheck size={40} strokeWidth={1.5} color={theme.gray300} />} message="No verification requests match these filters" />}
      />

      <DetailDrawer
        open={!!f.id && !isLoading}
        onClose={close}
        title={selected ? nameOf(selected) : 'Verification request'}
        footer={selected?.status === 'pending' ? (
          <>
            <Button variant="danger" fullWidth leftIcon={<XCircle size={14} />} onClick={() => decide('reject')} disabled={!!busy} loading={busy === 'reject'}>Reject</Button>
            <Button variant="primary" fullWidth leftIcon={<CheckCircle size={14} />} onClick={() => decide('approve')} disabled={!!busy} loading={busy === 'approve'}>Approve</Button>
          </>
        ) : null}
      >
        {!selected ? (
          <p style={{ margin: 0, fontSize: 13, color: theme.textMid }}>This request could not be found. It may already have been handled.</p>
        ) : (
          <div>
            <DetailField label="Status"><StatusPill status={selected.status} /></DetailField>
            <DetailField label="Profession">{selected.profession}</DetailField>
            <DetailField label="Workplace">{selected.workplace}</DetailField>
            <DetailField label="Phone">{selected.phone}</DetailField>
            <DetailField label="Submitted">{selected.created_at ? new Date(selected.created_at).toLocaleString() : null}</DetailField>
            <div style={{ marginTop: theme.space[8] }}>
              {selected.credential_url ? (
                <Button variant="ghost" size="sm" leftIcon={<FileText size={14} />} rightIcon={<ExternalLink size={12} />} onClick={openCredential} disabled={!!busy} loading={busy === 'credential'} loadingText="Opening…">
                  View credential
                </Button>
              ) : (
                <p style={{ margin: 0, fontSize: 12, color: theme.textLight }}>No credential document was uploaded.</p>
              )}
              {credentialError && (
                <p role="alert" style={{ margin: `${theme.space[4]}px 0 0`, padding: theme.space[4], background: theme.dangerBg, color: theme.danger, borderRadius: theme.radius.sm, fontSize: 12 }}>
                  {credentialError}
                </p>
              )}
            </div>
          </div>
        )}
      </DetailDrawer>
    </div>
  )
}
