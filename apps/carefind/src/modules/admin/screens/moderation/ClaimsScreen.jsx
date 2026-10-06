import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle, XCircle, Shield } from 'lucide-react'
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
const businessOf = (c) => c.businesses?.name || 'Unknown business'

// The claim row is `business_claims.*`; its columns beyond these are shown
// generically so the reviewer sees whatever evidence the claimant supplied.
const HIDDEN = new Set(['id', 'business_id', 'user_id', 'status', 'created_at', 'updated_at', 'businesses'])
const labelFor = (key) => { const s = key.replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1) }
const extraFields = (claim) => Object.entries(claim)
  .filter(([key, value]) => !HIDDEN.has(key) && value !== null && value !== undefined && value !== '' && typeof value !== 'object')
  .map(([key, value]) => ({ key, label: labelFor(key), value: String(value) }))

export default function ClaimsScreen() {
  const { data: rows = [], isLoading, error, refetch } = useQueue('claims')
  const [f, setF] = useUrlFilters(DEFAULTS)
  const qc = useQueryClient()
  const showToast = useAdminToast()
  const { recordAction } = useAdminActivity()
  const audit = useAuditLog()
  const [busy, setBusy] = useState(null)

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
      return !q || businessOf(r).toLowerCase().includes(q)
    })
  }, [rows, f.status, f.q])

  const selected = f.id ? rows.find(r => String(r.id) === f.id) : null
  const open = (row) => setF({ id: row.id }, { replace: false })
  const close = () => setF({ id: null })

  async function decide(kind) {
    if (busy || !selected) return
    setBusy(kind)
    const verb = kind === 'approve' ? 'approve' : 'reject'
    try {
      if (kind === 'approve') {
        await callAdminAuth('approve_claim', { claimId: selected.id, businessId: selected.business_id })
        audit('approve', 'claim', selected.id, { businessId: selected.business_id })
      } else {
        await callAdminAuth('reject_claim', { claimId: selected.id })
        audit('reject', 'claim', selected.id, {})
      }
      recordAction({ action: verb, target: 'claim', id: selected.id })
      showToast(kind === 'approve' ? 'Claim approved' : 'Claim rejected', { type: 'success' })
      close()
      qc.invalidateQueries({ queryKey: ['admin'] })
    } catch (err) {
      showToast(`Couldn't ${verb} the claim: ${err.message}`, { type: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const columns = [
    { key: 'business', label: 'Business', sortable: true, sortValue: r => businessOf(r).toLowerCase(), render: r => primaryCell({ title: businessOf(r), onOpen: () => open(r), openLabel: `Open claim for ${businessOf(r)}` }) },
    { key: 'created_at', label: 'Submitted', sortable: true, sortValue: r => r.created_at || '', render: r => (r.created_at ? timeAgo(r.created_at) : '—') },
    { key: 'status', label: 'Status', render: r => <StatusPill status={r.status} /> },
  ]

  return (
    <div>
      <AdminPageHeader title="Claims" subtitle={`${counts.pending} pending · ${counts.all} total`} />

      <FilterBar label="Claim filters" style={{ marginBottom: theme.space[8] }}>
        <SearchBar label="Search claims" value={f.q} onChange={(q) => setF({ q })} placeholder="Search business name…" />
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
        error={error ? 'The business claims could not be loaded.' : null}
        onRetry={refetch}
        empty={<Empty icon={<Shield size={40} strokeWidth={1.5} color={theme.gray300} />} message="No business claims match these filters" />}
      />

      <DetailDrawer
        open={!!f.id && !isLoading}
        onClose={close}
        title={selected ? businessOf(selected) : 'Business claim'}
        footer={selected?.status === 'pending' ? (
          <>
            <Button variant="danger" fullWidth leftIcon={<XCircle size={14} />} onClick={() => decide('reject')} disabled={!!busy} loading={busy === 'reject'}>Reject</Button>
            <Button variant="primary" fullWidth leftIcon={<CheckCircle size={14} />} onClick={() => decide('approve')} disabled={!!busy} loading={busy === 'approve'}>Approve</Button>
          </>
        ) : null}
      >
        {!selected ? (
          <p style={{ margin: 0, fontSize: 13, color: theme.textMid }}>This claim could not be found. It may already have been handled.</p>
        ) : (
          <div>
            <DetailField label="Status"><StatusPill status={selected.status} /></DetailField>
            <DetailField label="Submitted">{selected.created_at ? new Date(selected.created_at).toLocaleString() : null}</DetailField>
            {extraFields(selected).map(field => (
              <DetailField key={field.key} label={field.label}>{field.value}</DetailField>
            ))}
          </div>
        )}
      </DetailDrawer>
    </div>
  )
}
