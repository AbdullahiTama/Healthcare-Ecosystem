import { Users, UserPlus, Shield, Crown, Settings, Trash2, Edit, X, Check } from 'lucide-react'
import { Card, Button, Empty, Input, Select, StatusBadge } from '@care-ecosystem/design-system/components/ui'
import { theme } from '../../../styles/theme'
import { AdminPageHeader, AdminSection } from '../ui'

function timeAgo(d) {
  if (!d) return 'Never'
  const diff = Math.floor((Date.now() - new Date(d)) / 1000)
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const ROLE_OPTIONS = [
  { value: 'moderator', label: 'Content Moderator' },
  { value: 'verification_officer', label: 'Verification Officer' },
  { value: 'business_manager', label: 'Business Manager' },
  { value: 'support_agent', label: 'Support Agent' },
  { value: 'analytics_manager', label: 'Analytics Manager' },
]

export default function TeamsTab({
  teams, staff, teamName, setTeamName, createTeam,
  staffName, setStaffName, staffEmail, setStaffEmail, staffPass, setStaffPass,
  staffRole, setStaffRole, staffTeam, setStaffTeam,
  savingStaff, staffMsg, setStaffMsg, createStaff,
  adminUser, adminRoles, newRoleName, setNewRoleName, newRoleDesc, setNewRoleDesc,
  newRoleTabs, setNewRoleTabs, editingRoleId, setEditingRoleId,
  editingRoleTabs, setEditingRoleTabs, savingRole, loadAdminRoles, showToast, ALL_TABS,
}) {
  const customRoles = adminRoles.filter(r => !r.is_system)
  const superAdmins = staff.filter(s => s.role === 'super_admin')

  return (
    <div>
      <AdminPageHeader title="Teams & Staff" subtitle="Manage teams, staff, and roles" />

      <AdminSection title="Create Team" style={{ marginBottom: theme.space[5] }}>
        <form onSubmit={createTeam} style={{ display: 'flex', gap: 8 }}>
          <Input value={teamName} onChange={setTeamName} placeholder="Team name..." required style={{ flex: 1 }} />
          <Button variant="primary" type="submit" leftIcon={<Users size={14} />}>Add</Button>
        </form>
      </AdminSection>

      <AdminSection title="Add Staff Member" style={{ marginBottom: theme.space[5] }}>
        {staffMsg && (
          <div style={{ padding: theme.space[3], borderRadius: theme.radius.md, background: staffMsg.startsWith('Error') ? theme.dangerBg : theme.successBg, color: staffMsg.startsWith('Error') ? theme.danger : theme.success, fontSize: 12, fontWeight: 600, marginBottom: theme.space[4] }}>
            {staffMsg}
          </div>
        )}
        <form onSubmit={createStaff} style={{ display: 'flex', flexDirection: 'column', gap: theme.space[3] }}>
          <Input label="Full Name" value={staffName} onChange={setStaffName} required />
          <Input label="Email" type="email" value={staffEmail} onChange={setStaffEmail} required />
          <Input label="Password" type="password" value={staffPass} onChange={setStaffPass} required />
          <Select
            label="Role"
            value={staffRole}
            onChange={setStaffRole}
            options={[...ROLE_OPTIONS, ...customRoles.map(r => ({ value: r.name, label: r.name.replace(/_/g, ' ') }))]}
          />
          <Select
            label="Team"
            value={staffTeam}
            onChange={setStaffTeam}
            options={teams.map(t => ({ value: t.id, label: t.name }))}
            placeholder="No team"
          />
          <Button variant="secondary" type="submit" loading={savingStaff} fullWidth leftIcon={<UserPlus size={14} />}>
            {savingStaff ? 'Creating...' : 'Create Staff Account'}
          </Button>
        </form>
      </AdminSection>

      {teams.map(t => (
        <AdminSection key={t.id} title={t.name} style={{ marginBottom: theme.space[5] }}>
          {staff.filter(s => s.team_id === t.id).length === 0 && (
            <div style={{ fontSize: 12, color: theme.textLight }}>No members yet</div>
          )}
          {staff.filter(s => s.team_id === t.id).map(m => (
            <div key={m.id} style={{ padding: `${theme.space[3]}px 0`, borderBottom: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: theme.navy }}>{m.full_name}</div>
                <div style={{ fontSize: 11, color: theme.tealDeep, fontWeight: 700 }}>{m.role}</div>
              </div>
              <StatusBadge status={m.is_active ? 'active' : 'suspended'} />
            </div>
          ))}
        </AdminSection>
      ))}

      {superAdmins.map(m => (
        <Card key={m.id} style={{ padding: theme.space[4], marginTop: theme.space[4], border: '1px solid #e9d5ff', background: '#faf5ff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Crown size={16} color="#7c3aed" />
            <div>
              <div style={{ fontWeight: 800, fontSize: 13, color: '#7c3aed' }}>{m.full_name}</div>
              <div style={{ fontSize: 11, color: theme.textLight }}>{m.email} · Super Admin · Last login: {timeAgo(m.last_login)}</div>
            </div>
          </div>
        </Card>
      ))}

      {adminUser?.role === 'super_admin' && (
        <AdminSection title="Roles & Permissions" subtitle="Create custom roles and control which admin sections each role can access" style={{ marginTop: theme.space[5], border: `1px solid ${theme.tealDeep}20` }}>
          <Card style={{ padding: theme.space[5], marginBottom: theme.space[5], background: theme.tealMist }}>
            <div style={{ fontSize: theme.type.bodySm.size, fontWeight: 700, color: theme.tealDeep, marginBottom: theme.space[3] }}>Create New Role</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[3] }}>
              <Input value={newRoleName} onChange={setNewRoleName} placeholder="Role name..." />
              <Input value={newRoleDesc} onChange={setNewRoleDesc} placeholder="Description..." />
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: theme.navy, marginBottom: theme.space[2] }}>Permitted Sections:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {ALL_TABS.filter(t => t.key !== 'overview').map(t => (
                    <label key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: theme.radius.full, background: newRoleTabs[t.key] ? theme.tealMist : 'white', border: `1px solid ${newRoleTabs[t.key] ? theme.tealDeep : theme.border}`, cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!newRoleTabs[t.key]} onChange={(e) => setNewRoleTabs(prev => ({ ...prev, [t.key]: e.target.checked }))} style={{ width: 12, height: 12 }} />
                      {t.label.replace(/\s*\(\d+\)/g, '')}
                    </label>
                  ))}
                </div>
              </div>
              <Button variant="primary" loading={savingRole} onClick={async () => {
                if (!newRoleName.trim()) return
                try {
                  const tabs = { overview: true, ...newRoleTabs }
                  await (await import('../adminApi')).callAdminAuth('create_admin_role', { token: localStorage.getItem('admin_token'), name: newRoleName.trim(), description: newRoleDesc, carefindTabs: tabs })
                  setNewRoleName(''); setNewRoleDesc(''); setNewRoleTabs({})
                  loadAdminRoles()
                  showToast('Role created', { type: 'success' })
                } catch (e) { showToast(e.message || 'Failed', { type: 'error' }) }
              }} leftIcon={<Shield size={14} />}>
                {savingRole ? 'Creating...' : 'Create Role'}
              </Button>
            </div>
          </Card>

          {adminRoles.map(r => (
            <Card key={r.id} style={{ padding: theme.space[4], marginBottom: theme.space[3], background: r.is_system ? '#faf5ff' : theme.cardBg }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 12, color: theme.navy, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {r.name.replace(/_/g, ' ')}
                    {r.is_system && <span style={{ fontSize: 9, background: '#e9d5ff', color: '#7c3aed', padding: '1px 6px', borderRadius: 8 }}>SYSTEM</span>}
                  </div>
                  <div style={{ fontSize: 10, color: theme.textLight, marginBottom: theme.space[2] }}>{r.description || 'No description'}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {Object.entries(r.carefind_tabs || {}).filter(([, v]) => v).map(([k]) => (
                      <span key={k} style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: theme.tealMist, color: theme.tealDeep }}>{k}</span>
                    ))}
                  </div>
                </div>
                {!r.is_system && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <Button variant="ghost" size="sm" onClick={() => { setEditingRoleId(r.id); setEditingRoleTabs(r.carefind_tabs || {}) }} leftIcon={<Edit size={10} />}>Edit</Button>
                    <Button variant="danger" size="sm" onClick={async () => {
                      try {
                        await (await import('../adminApi')).callAdminAuth('delete_admin_role', { token: localStorage.getItem('admin_token'), roleId: r.id })
                        loadAdminRoles(); showToast('Role deleted', { type: 'success' })
                      } catch (e) { showToast(e.message || 'Failed', { type: 'error' }) }
                    }} leftIcon={<Trash2 size={10} />}>Delete</Button>
                  </div>
                )}
              </div>

              {editingRoleId === r.id && (
                <Card style={{ padding: theme.space[4], marginTop: theme.space[3], background: theme.bg }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: theme.navy, marginBottom: theme.space[2] }}>Edit Permissions:</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: theme.space[3] }}>
                    {ALL_TABS.filter(t => t.key !== 'overview').map(t => (
                      <label key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 10, background: editingRoleTabs[t.key] ? theme.tealMist : theme.cardBg, border: `1px solid ${editingRoleTabs[t.key] ? theme.tealDeep : theme.border}`, cursor: 'pointer' }}>
                        <input type="checkbox" checked={!!editingRoleTabs[t.key]} onChange={(e) => setEditingRoleTabs(prev => ({ ...prev, [t.key]: e.target.checked }))} style={{ width: 10, height: 10 }} />
                        {t.label.replace(/\s*\(\d+\)/g, '').slice(0, 12)}
                      </label>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <Button variant="primary" size="sm" onClick={async () => {
                      try {
                        await (await import('../adminApi')).callAdminAuth('update_admin_role', { token: localStorage.getItem('admin_token'), roleId: r.id, carefindTabs: { overview: true, ...editingRoleTabs } })
                        setEditingRoleId(null); loadAdminRoles(); showToast('Role updated', { type: 'success' })
                      } catch (e) { showToast(e.message || 'Failed', { type: 'error' }) }
                    }} leftIcon={<Check size={10} />}>Save</Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditingRoleId(null)}>Cancel</Button>
                  </div>
                </Card>
              )}
            </Card>
          ))}
        </AdminSection>
      )}
    </div>
  )
}
