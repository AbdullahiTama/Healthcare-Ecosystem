import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Ban, Download, Globe, Phone, ShieldCheck, Trash2 } from 'lucide-react'
import { Button, Input, StatusBadge } from '@care-ecosystem/design-system/components/ui'
import DirectoryTable from '../ui/DirectoryTable.jsx'
import { useDebounced } from '../ui/useDebounced.js'
import { FilterPills, exportCSV, timeAgo } from '../ui'
import { useUsersDirectory } from '../hooks/useUsersDirectory'
import { useUserActions } from '../hooks/useUserActions'
import { useTrustQueues } from '../hooks/useTrustQueues'
import { useAdmin } from '../provider/AdminProvider.jsx'
import { callAdminAuth } from '../adminApi'

const FILTER_DELAY_MS = 300
const NO_FILTERS = { search: '', verified: 'all', specialty: '', page: 0 }
const VERIFIED_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'verified', label: 'Verified' },
  { value: 'unverified', label: 'Unverified' },
]
const SUSPEND_OPTIONS = [
  { value: '1', label: '1 day' },
  { value: '3', label: '3 days' },
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '365', label: '1 year' },
]

const nameOf = (u) => u.full_name || u.display_name || 'No name'

const columns = [
  {
    key: 'full_name', label: 'Name',
    render: u => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span aria-hidden="true" style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--teal, #0e6f5a)', color: 'white', fontSize: 13, fontWeight: 700 }}>
          {nameOf(u)[0]?.toUpperCase()}
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span>{nameOf(u)}</span>
          {u.full_name && u.display_name && <span style={{ fontSize: 12, color: 'var(--adm-ink-soft)' }}>@{u.display_name}</span>}
        </span>
      </span>
    ),
  },
  { key: 'verification_label', label: 'Title', render: u => u.verification_label || '—' },
  { key: 'location', label: 'Location', render: u => u.location || '—' },
  { key: 'is_verified', label: 'Verified', render: u => (u.is_verified ? <StatusBadge status="confirmed" /> : '—') },
  { key: 'created_at', label: 'Joined', sortable: true, sortValue: u => new Date(u.created_at).getTime(), render: u => timeAgo(u.created_at) },
]

const shortId = (id) => (id && id.length > 16 ? `${id.slice(0, 16)}…` : id || '—')
const joinedDate = (d) => {
  const t = d ? new Date(d) : null
  return t && !isNaN(t) ? t.toLocaleDateString() : '—'
}
const websiteHref = (w) => (w.startsWith('http') ? w : `https://${w}`)

// The 3 most recent posts, loaded while the drawer is open. A failed or
// malformed response is shown as failed, never as "no posts".
function RecentPosts({ userId }) {
  const posts = useQuery({
    queryKey: ['admin', 'user-posts', userId],
    queryFn: async () => {
      const res = await callAdminAuth('get_user_posts', { userId, limit: 3 })
      if (!Array.isArray(res?.data)) throw new Error('get_user_posts returned no list')
      return res.data
    },
    enabled: !!userId,
  })

  return (
    <section aria-label="Recent posts" style={{ marginTop: 16 }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>Recent posts</h3>
      {posts.isLoading ? <p className="adm-note">Loading posts…</p>
        : posts.isError ? <p className="adm-note">Couldn't load posts</p>
          : posts.data.length === 0 ? <p className="adm-note">No posts yet</p>
            : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {posts.data.slice(0, 3).map(p => (
                  <li key={p.id} style={{ padding: '8px 0', borderTop: '1px solid var(--adm-line-soft)' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--adm-ink-soft)' }}>{p.post_type}</span>
                    <p style={{ margin: '2px 0 0', fontSize: 13, overflowWrap: 'anywhere' }}>{p.content?.slice(0, 100)}</p>
                  </li>
                ))}
              </ul>
            )}
    </section>
  )
}

function UserBody({ u, phone }) {
  return (
    <>
      <dl className="adm-drawer-grid">
        <dt>User ID</dt><dd>{shortId(u.id)}</dd>
        <dt>Title</dt><dd>{u.verification_label || '—'}</dd>
        <dt>Specialty</dt><dd>{u.specialty || '—'}</dd>
        <dt>Location</dt><dd>{u.location || '—'}</dd>
        <dt>Verified</dt><dd>{u.is_verified ? 'Yes' : 'No'}</dd>
        <dt>Joined</dt><dd>{joinedDate(u.created_at)}</dd>
      </dl>
      {(phone || u.website) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {phone && (
            <a href={`tel:${phone}`} style={linkStyle}><Phone size={14} aria-hidden="true" /> Call</a>
          )}
          {u.website && (
            <a href={websiteHref(u.website)} target="_blank" rel="noreferrer" style={linkStyle}><Globe size={14} aria-hidden="true" /> Website</a>
          )}
        </div>
      )}
      <RecentPosts userId={u.id} />
    </>
  )
}

const linkStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, padding: '0 14px',
  borderRadius: 8, border: '1px solid var(--adm-line)', color: 'var(--teal-deep, #0e6f5a)',
  fontSize: 13, fontWeight: 600, textDecoration: 'none',
}
const selectStyle = {
  flex: 1, minHeight: 44, padding: '0 12px', font: 'inherit', color: 'var(--adm-ink)',
  background: 'var(--adm-panel)', border: '1px solid var(--adm-line)', borderRadius: 8,
}

// Verify, Suspend and Delete. Suspend and Delete are not offered on your own
// account. `isSelf` compares the profile id (profiles.id is the sign-in user's
// id) with the session's sign-in user id, and also with adminUser.id, which is
// the admin_users row id and only equals the sign-in id where they coincide
// (the QA seed). It fails closed: while the sign-in id is unknown, Suspend and
// Delete are hidden. This is UI only: suspend_user and delete_user
// (api/_handlers/admin-auth.js) do NOT prevent an admin acting on their own
// account; hiding the buttons only prevents an accidental lock-out or
// self-delete from this screen.
function UserActions({ u, isSelf, actions, askConfirm, close, setError }) {
  const [verifying, setVerifying] = useState(false)
  const [specialty, setSpecialty] = useState('')
  const [days, setDays] = useState('7')
  const name = nameOf(u)
  const busy = actions.busy === u.id
  const finish = (res) => { if (res.ok) close(); else setError(res.error) }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
      {!u.is_verified && (verifying ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
          <Input id="users-verify-specialty" label="Specialty" value={specialty} onChange={setSpecialty} placeholder="e.g. Pharmacist" style={{ flex: 1, minWidth: 180 }} />
          <Button variant="primary" loading={busy}
            onClick={async () => finish(await actions.verifyUser({ id: u.id, specialty: specialty.trim() }))}>
            Verify user
          </Button>
        </div>
      ) : (
        <Button variant="primary" fullWidth leftIcon={<ShieldCheck size={14} />} onClick={() => setVerifying(true)}>
          Verify
        </Button>
      ))}

      {!isSelf && (
        <>
          <div style={{ display: 'flex', gap: 8 }}>
            <select aria-label="Suspend duration" value={days} onChange={(e) => setDays(e.target.value)} style={selectStyle}>
              {SUSPEND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <Button variant="ghost" disabled={busy} leftIcon={<Ban size={14} />}
              onClick={() => askConfirm({
                title: 'Suspend this user?',
                // suspend_user sets suspended_until and also clears is_verified.
                consequence: `${name} is marked as suspended for ${days} day${days === '1' ? '' : 's'} and loses their verified status; they must be verified again afterwards.`,
                confirmLabel: 'Suspend',
                action: async () => finish(await actions.suspendUser({ id: u.id, days })),
              })}>
              Suspend
            </Button>
          </div>
          <Button variant="danger" fullWidth disabled={busy} leftIcon={<Trash2 size={14} />}
            onClick={() => askConfirm({
              title: 'Delete this user?',
              // delete_user removes the profile row and the user's posts, comments,
              // reactions, saved posts and follows; it does not delete the auth user.
              consequence: `This permanently deletes ${name}'s profile, their posts, and their comments, reactions, saved posts and follows. Their sign-in account itself is not removed. This cannot be undone.`,
              confirmLabel: 'Delete',
              action: async () => finish(await actions.deleteUser({ id: u.id, name })),
            })}>
            Delete user
          </Button>
        </>
      )}
    </div>
  )
}

export default function UsersSection() {
  const [filters, setFilters] = useState(NO_FILTERS)
  const { search, verified, specialty, page } = filters
  // A filter change always returns to the first page; an unchanged value is a no-op.
  const update = (patch) => setFilters(prev => (
    Object.keys(patch).every(k => prev[k] === patch[k]) ? prev : { ...prev, ...patch, page: 0 }
  ))

  // The Specialty box is local text, applied (trimmed) once typing stops. It is
  // applied only when the debounced value has caught up with the box, so after
  // Clear filters a stale debounced value is never re-applied, and retyping the
  // value that was cleared still applies it.
  const [specialtyText, setSpecialtyText] = useState('')
  const debouncedSpecialty = useDebounced(specialtyText, FILTER_DELAY_MS)
  useEffect(() => {
    if (debouncedSpecialty !== specialtyText) return
    const next = debouncedSpecialty.trim()
    setFilters(prev => (prev.specialty === next ? prev : { ...prev, specialty: next, page: 0 }))
  }, [debouncedSpecialty, specialtyText])

  const clear = () => { setSpecialtyText(''); setFilters(NO_FILTERS) }

  const query = useUsersDirectory({ search, verified, specialty, page })
  const rows = query.data?.rows || []
  const actions = useUserActions()
  const { adminUser, authUserId, askConfirm } = useAdmin()
  const isSelf = (u) => !authUserId || u.id === authUserId || u.id === adminUser?.id
  const { data: trust } = useTrustQueues(true)
  const phoneMap = Object.fromEntries((trust?.verifications?.data || []).filter(v => v.phone).map(v => [v.user_id, v.phone]))

  const renderDrawer = (u, { close, setError }) => ({
    title: nameOf(u),
    status: u.is_verified ? 'confirmed' : undefined,
    body: <UserBody u={u} phone={phoneMap[u.id]} />,
    footer: (
      <UserActions key={u.id} u={u} isSelf={isSelf(u)}
        actions={actions} askConfirm={askConfirm} close={close} setError={setError} />
    ),
  })

  return (
    <DirectoryTable
      title="Users"
      noun="user"
      query={query}
      columns={columns}
      search={search}
      onSearch={(s) => update({ search: s })}
      searchPlaceholder="Search by name or username"
      filters={(
        <>
          <FilterPills options={VERIFIED_OPTIONS} value={verified} onChange={(v) => update({ verified: v })} />
          <Input id="users-specialty-filter" label="Specialty" value={specialtyText} onChange={setSpecialtyText} placeholder="e.g. Pharmacist" style={{ minWidth: 180 }} />
        </>
      )}
      filtersActive={!!(search || specialty || verified !== 'all')}
      onClear={clear}
      page={page}
      onPage={(p) => setFilters(prev => ({ ...prev, page: p }))}
      renderDrawer={renderDrawer}
      rowLabel={nameOf}
      toolbar={(
        <Button variant="ghost" size="sm" leftIcon={<Download size={14} />}
          disabled={rows.length === 0 || query.isPlaceholderData}
          onClick={() => exportCSV(rows, 'users_page.csv')}>
          Export this page (CSV)
        </Button>
      )}
    />
  )
}
