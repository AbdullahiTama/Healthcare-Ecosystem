import { Users, Search, MapPin, Phone, Shield, CheckCircle, Ban, Trash2, Globe, ChevronRight } from 'lucide-react'
import { Card, Button, Empty, Input, StatusBadge } from '@care-ecosystem/design-system/components/ui'
import { theme } from '../../../styles/theme'
import { AdminPageHeader, AdminFilterBar, FilterPills } from '../ui'

function timeAgo(d) {
  if (!d) return 'Never'
  const diff = Math.floor((Date.now() - new Date(d)) / 1000)
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function exportCSV(data, filename) {
  if (!data.length) return
  const keys = Object.keys(data[0])
  const csv = [keys.join(','), ...data.map(row => keys.map(k => JSON.stringify(row[k] ?? '')).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function UsersTab({
  users, selectedUser, setSelectedUser, userSearch, setUserSearch,
  userVerifiedFilter, setUserVerifiedFilter, userSpecialtyFilter, setUserSpecialtyFilter,
  phoneMap, viewUserDetails, suspendDays, setSuspendDays, suspendUser,
  deleteUser, deletingUser, userPosts, verifyingUser, setVerifyingUser,
  verifySpecialty, setVerifySpecialty, manualVerify, adminUser,
}) {
  const filtered = users.filter(u => {
    const matchSearch = !userSearch || (u.full_name || u.display_name || '').toLowerCase().includes(userSearch.toLowerCase())
    const matchVerified = userVerifiedFilter === 'all' || (userVerifiedFilter === 'verified' ? u.is_verified : !u.is_verified)
    const matchSpecialty = !userSpecialtyFilter || (u.verification_label || '').toLowerCase().includes(userSpecialtyFilter.toLowerCase())
    return matchSearch && matchVerified && matchSpecialty
  })

  return (
    <div>
      <AdminPageHeader title="Users" subtitle={`${users.length} total users`} />

      {selectedUser && (
        <Card style={{ padding: theme.space[6], marginBottom: theme.space[6], border: `1px solid ${theme.tealBright}`, background: theme.tealMist }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: theme.space[5] }}>
            <div style={{ fontSize: theme.type.h3.size, fontWeight: theme.type.h3.weight, color: theme.textDark, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Users size={16} /> User Details
            </div>
            <button onClick={() => setSelectedUser(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.textLight }}>
              <span style={{ fontSize: 18 }}>×</span>
            </button>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: theme.space[5] }}>
            <div style={{ width: 50, height: 50, borderRadius: '50%', background: selectedUser.cover_url ? `url(${selectedUser.cover_url})` : theme.tealGradient, backgroundSize: 'cover', backgroundPosition: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 18, fontWeight: 800, flexShrink: 0 }}>
              {!selectedUser.cover_url && (selectedUser.full_name || selectedUser.display_name || '?')[0]?.toUpperCase()}
            </div>
            <div>
              <div style={{ fontWeight: 900, fontSize: 15, color: theme.navy }}>{selectedUser.full_name || 'No full name'}</div>
              {selectedUser.display_name && <div style={{ fontSize: 12, color: theme.textLight }}>@{selectedUser.display_name}</div>}
            </div>
          </div>

          <Card style={{ padding: theme.space[4], marginBottom: theme.space[5] }}>
            {[
              { label: 'User ID', value: selectedUser.id?.slice(0, 16) + '...' },
              { label: 'Title', value: selectedUser.verification_label || 'Not set' },
              { label: 'Specialty', value: selectedUser.specialty || 'Not set' },
              { label: 'Location', value: selectedUser.location || 'Not set' },
              { label: 'Verified', value: selectedUser.is_verified ? 'Yes' : 'No' },
              { label: 'Joined', value: new Date(selectedUser.created_at).toLocaleDateString() },
              { label: 'Posts', value: userPosts.length },
            ].map(f => (
              <div key={f.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${theme.gray100}` }}>
                <span style={{ fontSize: 12, color: theme.gray500, fontWeight: 700 }}>{f.label}</span>
                <span style={{ fontSize: 12, color: theme.navy, fontWeight: 600 }}>{f.value}</span>
              </div>
            ))}
          </Card>

          {(phoneMap[selectedUser.id] || selectedUser.website) && (
            <div style={{ display: 'flex', gap: 8, marginBottom: theme.space[4] }}>
              {phoneMap[selectedUser.id] && (
                <a href={`tel:${phoneMap[selectedUser.id]}`} style={{ flex: 1, textAlign: 'center', padding: 10, background: theme.tealGradient, color: '#fff', borderRadius: theme.radius.md, fontWeight: 800, fontSize: 13, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <Phone size={14} /> Call
                </a>
              )}
              {selectedUser.website && (
                <a href={selectedUser.website.startsWith('http') ? selectedUser.website : `https://${selectedUser.website}`} target="_blank" rel="noreferrer" style={{ flex: 1, textAlign: 'center', padding: 10, background: '#fff', color: theme.tealDeep, border: `1px solid ${theme.tealDeep}`, borderRadius: theme.radius.md, fontWeight: 800, fontSize: 13, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <Globe size={14} /> Website
                </a>
              )}
            </div>
          )}

          {!selectedUser.is_verified && (
            verifyingUser === selectedUser.id ? (
              <div style={{ display: 'flex', gap: 6, marginBottom: theme.space[3] }}>
                <Input value={verifySpecialty} onChange={setVerifySpecialty} placeholder="Specialty (e.g. Pharmacist)" style={{ flex: 1 }} />
                <Button variant="primary" size="sm" onClick={() => manualVerify(selectedUser.id, verifySpecialty)} leftIcon={<CheckCircle size={14} />}>Verify</Button>
              </div>
            ) : (
              <Button variant="primary" fullWidth onClick={() => setVerifyingUser(selectedUser.id)} leftIcon={<Shield size={14} />} style={{ marginBottom: theme.space[3] }}>
                Verify This User
              </Button>
            )
          )}

          <div style={{ display: 'flex', gap: 8, marginBottom: theme.space[3] }}>
            <select value={suspendDays} onChange={(e) => setSuspendDays(e.target.value)} style={{ flex: 1, minHeight: 40, padding: '8px 12px', fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, background: '#fff', fontFamily: theme.fontFamily }}>
              <option value="1">Suspend 1 day</option>
              <option value="3">Suspend 3 days</option>
              <option value="7">Suspend 7 days</option>
              <option value="14">Suspend 14 days</option>
              <option value="30">Suspend 30 days</option>
              <option value="365">Suspend 1 year</option>
            </select>
            <Button variant="ghost" size="sm" onClick={() => suspendUser(selectedUser.id, suspendDays)} leftIcon={<Ban size={14} />}>
              Suspend
            </Button>
          </div>

          {selectedUser.id !== adminUser?.id && (
            <Button variant="danger" fullWidth onClick={() => deleteUser(selectedUser.id)} loading={deletingUser} leftIcon={<Trash2 size={14} />}>
              {deletingUser ? 'Deleting...' : 'Permanently Delete Account'}
            </Button>
          )}

          {userPosts.length > 0 && (
            <div style={{ marginTop: theme.space[5] }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: theme.gray400, textTransform: 'uppercase', marginBottom: theme.space[3] }}>Recent Posts ({userPosts.length})</div>
              {userPosts.slice(0, 3).map(p => (
                <div key={p.id} style={{ padding: '8px 0', borderTop: `1px solid ${theme.border}` }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: theme.tealDeep, textTransform: 'uppercase' }}>{p.post_type}</span>
                  <p style={{ margin: '2px 0 0 0', fontSize: 12, color: theme.textMid }}>{p.content?.slice(0, 100)}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <AdminFilterBar search={userSearch} onSearch={setUserSearch} searchPlaceholder="Search by name or username...">
        <div style={{ display: 'flex', gap: theme.space[4], flexDirection: 'column' }}>
          <Input value={userSpecialtyFilter} onChange={setUserSpecialtyFilter} placeholder="Filter by title..." />
          <FilterPills
            options={[{ value: 'all', label: 'All' }, { value: 'verified', label: 'Verified' }, { value: 'unverified', label: 'Unverified' }]}
            value={userVerifiedFilter}
            onChange={setUserVerifiedFilter}
          />
          <Button variant="primary" fullWidth onClick={() => exportCSV(filtered, 'users_export.csv')} leftIcon={<Download size={14} />}>
            Export Filtered CSV
          </Button>
        </div>
      </AdminFilterBar>

      {filtered.length === 0 && <Empty icon={<Users size={40} strokeWidth={1.5} />} message="No users match your filters" />}

      {filtered.map(u => (
        <Card key={u.id} onClick={() => viewUserDetails(u)} style={{ padding: theme.space[5], marginBottom: theme.space[4] }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: u.cover_url ? `url(${u.cover_url})` : theme.tealGradient, backgroundSize: 'cover', backgroundPosition: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 800, flexShrink: 0 }}>
              {!u.cover_url && (u.full_name || u.display_name || '?')[0]?.toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 13.5, color: theme.navy }}>{u.full_name || u.display_name || 'No name'}</span>
                {u.is_verified && <StatusBadge status="confirmed" />}
              </div>
              {u.display_name && u.full_name && <div style={{ fontSize: 11, color: theme.textLight }}>@{u.display_name}</div>}
              {u.verification_label && <div style={{ fontSize: 11, color: theme.tealDeep, fontWeight: 700 }}>{u.verification_label}</div>}
              {u.location && <div style={{ fontSize: 11, color: theme.textLight, display: 'flex', alignItems: 'center', gap: 4 }}><MapPin size={11} /> {u.location}</div>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <span style={{ fontSize: 10, color: theme.textLight }}>{timeAgo(u.created_at)}</span>
              {phoneMap[u.id] && (
                <a href={`tel:${phoneMap[u.id]}`} onClick={(e) => e.stopPropagation()} style={{ fontSize: 10, fontWeight: 800, color: '#fff', background: theme.tealDeep, padding: '3px 10px', borderRadius: theme.radius.full, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Phone size={10} /> Call
                </a>
              )}
              <ChevronRight size={14} color={theme.gray400} />
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
