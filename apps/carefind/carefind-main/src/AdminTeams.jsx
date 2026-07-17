import { useState, useEffect } from 'react'
import { supabase } from './lib/supabaseClient'
import { theme } from './lib/theme'

const ROLES = [
  { key: 'moderator', label: '🛡️ Content Moderator', desc: 'Reviews reports, deletes content' },
  { key: 'verification_officer', label: '🩺 Verification Officer', desc: 'Approves professional verifications' },
  { key: 'business_manager', label: '🏥 Business Manager', desc: 'Approves business claims' },
  { key: 'support_agent', label: '💬 Support Agent', desc: 'Manages users and complaints' },
  { key: 'analytics_manager', label: '📊 Analytics Manager', desc: 'Views revenue and drug intelligence' },
]

function hashPassword(password) {
  return `cf_hashed_${password}`
}

function AdminTeams({ adminUser }) {
  const [teams, setTeams] = useState([])
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [creatingTeam, setCreatingTeam] = useState(false)
  const [creatingStaff, setCreatingStaff] = useState(false)
  const [selectedTeam, setSelectedTeam] = useState(null)
  const [teamForm, setTeamForm] = useState({ name: '', description: '' })
  const [staffForm, setStaffForm] = useState({ email: '', password: '', name: '', role: 'moderator', team_id: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [teamsRes, staffRes] = await Promise.all([
      supabase.from('admin_teams').select('*').order('created_at'),
      supabase.from('admin_users').select('*').order('created_at'),
    ])
    setTeams(teamsRes.data || [])
    setStaff(staffRes.data || [])
    setLoading(false)
  }

  async function createTeam(e) {
    e.preventDefault()
    setSaving(true); setError(''); setSuccess('')
    const { error: err } = await supabase.from('admin_teams').insert({
      name: teamForm.name,
      description: teamForm.description,
      created_by: adminUser?.id,
    })
    if (err) { setError(err.message) } else {
      setSuccess(`Team "${teamForm.name}" created!`)
      setTeamForm({ name: '', description: '' })
      setCreatingTeam(false)
      loadAll()
    }
    setSaving(false)
  }

  async function createStaff(e) {
    e.preventDefault()
    setSaving(true); setError(''); setSuccess('')
    const { error: err } = await supabase.from('admin_users').insert({
      email: staffForm.email.toLowerCase(),
      password_hash: hashPassword(staffForm.password),
      full_name: staffForm.name,
      role: staffForm.role,
      team_id: staffForm.team_id || null,
      created_by: adminUser?.id,
    })
    if (err) { setError(err.message) } else {
      setSuccess(`Staff account created for ${staffForm.email}`)
      setStaffForm({ email: '', password: '', name: '', role: 'moderator', team_id: '' })
      setCreatingStaff(false)
      loadAll()
    }
    setSaving(false)
  }

  async function toggleStaff(id, isActive) {
    await supabase.from('admin_users').update({ is_active: isActive }).eq('id', id)
    loadAll()
  }

  async function deleteTeam(id) {
    if (!window.confirm('Delete this team? Members will be unassigned.')) return
    await supabase.from('admin_users').update({ team_id: null }).eq('team_id', id)
    await supabase.from('admin_teams').delete().eq('id', id)
    loadAll()
  }

  function timeAgo(d) {
    if (!d) return 'Never'
    const diff = Math.floor((Date.now() - new Date(d)) / 1000)
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  }

  const ROLE_LABELS = {
    super_admin: '👑 Super Admin',
    moderator: '🛡️ Content Moderator',
    verification_officer: '🩺 Verification Officer',
    business_manager: '🏥 Business Manager',
    support_agent: '💬 Support Agent',
    analytics_manager: '📊 Analytics Manager',
  }

  if (loading) return <p style={{ color: theme.textLight, fontSize: 13 }}>Loading...</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => { setCreatingTeam(!creatingTeam); setCreatingStaff(false) }}
          style={{ flex: 1, padding: '9px', background: creatingTeam ? theme.bg : theme.tealGradient, color: creatingTeam ? theme.textMid : '#fff', border: creatingTeam ? `1px solid ${theme.border}` : 'none', borderRadius: 12, fontWeight: 700, fontSize: 13 }}>
          {creatingTeam ? 'Cancel' : '+ New Team'}
        </button>
        <button onClick={() => { setCreatingStaff(!creatingStaff); setCreatingTeam(false) }}
          style={{ flex: 1, padding: '9px', background: creatingStaff ? theme.bg : theme.navy, color: '#fff', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 13 }}>
          {creatingStaff ? 'Cancel' : '+ Add Staff'}
        </button>
      </div>

      {error && <p style={{ color: theme.alert, fontSize: 13, margin: 0 }}>⚠️ {error}</p>}
      {success && <p style={{ color: theme.success, fontSize: 13, margin: 0 }}>✓ {success}</p>}

      {/* Create Team Form */}
      {creatingTeam && (
        <form onSubmit={createTeam} style={{ border: `1px solid ${theme.tealBright}`, borderRadius: 16, padding: 16, background: '#ecfdf5', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: theme.tealDeep }}>Create New Team</h4>
          <div>
            <label style={{ fontSize: 11, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 3 }}>Team Name</label>
            <input value={teamForm.name} onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })} placeholder="e.g. Content Team" required
              style={{ width: '100%', padding: 10, fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: 10 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 3 }}>Description (optional)</label>
            <input value={teamForm.description} onChange={(e) => setTeamForm({ ...teamForm, description: e.target.value })} placeholder="What does this team do?"
              style={{ width: '100%', padding: 10, fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: 10 }} />
          </div>
          <button type="submit" disabled={saving} style={{ padding: 11, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 13 }}>
            {saving ? 'Creating...' : 'Create Team'}
          </button>
        </form>
      )}

      {/* Create Staff Form */}
      {creatingStaff && (
        <form onSubmit={createStaff} style={{ border: `1px solid ${theme.border}`, borderRadius: 16, padding: 16, background: theme.cardBg, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: theme.navy }}>Add Staff Member</h4>
          {[
            { label: 'Full Name', key: 'name', placeholder: 'e.g. Fatima Aliyu', type: 'text' },
            { label: 'Email', key: 'email', placeholder: 'staff@carefind.app', type: 'email' },
            { label: 'Password', key: 'password', placeholder: 'Strong password', type: 'password' },
          ].map(f => (
            <div key={f.key}>
              <label style={{ fontSize: 11, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 3 }}>{f.label}</label>
              <input type={f.type} value={staffForm[f.key]} onChange={(e) => setStaffForm({ ...staffForm, [f.key]: e.target.value })} placeholder={f.placeholder} required
                style={{ width: '100%', padding: 10, fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: 10 }} />
            </div>
          ))}
          <div>
            <label style={{ fontSize: 11, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 3 }}>Role</label>
            <select value={staffForm.role} onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value })}
              style={{ width: '100%', padding: 10, fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: 10, background: '#fff' }}>
              {ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: theme.textLight }}>
              {ROLES.find(r => r.key === staffForm.role)?.desc}
            </p>
          </div>
          <div>
            <label style={{ fontSize: 11, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 3 }}>Assign to Team (optional)</label>
            <select value={staffForm.team_id} onChange={(e) => setStaffForm({ ...staffForm, team_id: e.target.value })}
              style={{ width: '100%', padding: 10, fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: 10, background: '#fff' }}>
              <option value="">No team</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <button type="submit" disabled={saving} style={{ padding: 11, background: theme.navy, color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 13 }}>
            {saving ? 'Creating...' : 'Create Staff Account'}
          </button>
        </form>
      )}

      {/* Teams List */}
      {teams.length > 0 && (
        <>
          <p style={{ fontSize: 11, fontWeight: 800, color: theme.tealDeep, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '4px 0 0 0' }}>
            Teams ({teams.length})
          </p>
          {teams.map(t => {
            const teamMembers = staff.filter(s => s.team_id === t.id)
            return (
              <div key={t.id} style={{ border: `1px solid ${theme.border}`, borderRadius: 16, overflow: 'hidden', background: theme.cardBg, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <div style={{ padding: '12px 14px', background: '#f8fafc', borderBottom: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p style={{ margin: '0 0 2px 0', fontWeight: 800, fontSize: 14, color: theme.navy }}>{t.name}</p>
                    {t.description && <p style={{ margin: 0, fontSize: 12, color: theme.textLight }}>{t.description}</p>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: theme.tealDeep, background: '#ecfdf5', padding: '2px 8px', borderRadius: 20 }}>
                      {teamMembers.length} member{teamMembers.length !== 1 ? 's' : ''}
                    </span>
                    <button onClick={() => deleteTeam(t.id)} style={{ background: 'none', border: 'none', color: theme.alert, fontSize: 14, cursor: 'pointer' }}>🗑️</button>
                  </div>
                </div>
                <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {teamMembers.length === 0 && <p style={{ color: theme.textLight, fontSize: 12, margin: 0 }}>No members yet — add staff and assign to this team</p>}
                  {teamMembers.map(m => (
                    <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${theme.border}` }}>
                      <div>
                        <p style={{ margin: '0 0 1px 0', fontSize: 13, fontWeight: 700, color: theme.navy }}>{m.full_name}</p>
                        <p style={{ margin: '0 0 1px 0', fontSize: 11, color: theme.textLight }}>{m.email}</p>
                        <p style={{ margin: 0, fontSize: 11, color: theme.tealDeep, fontWeight: 700 }}>{ROLE_LABELS[m.role] || m.role}</p>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 20, background: m.is_active ? '#ecfdf5' : '#fef2f2', color: m.is_active ? theme.success : theme.alert }}>
                          {m.is_active ? 'Active' : 'Suspended'}
                        </span>
                        <span style={{ fontSize: 10, color: theme.textLight }}>Login: {timeAgo(m.last_login)}</span>
                        {m.role !== 'super_admin' && (
                          <button onClick={() => toggleStaff(m.id, !m.is_active)}
                            style={{ padding: '3px 8px', background: m.is_active ? '#fef2f2' : '#ecfdf5', color: m.is_active ? theme.alert : theme.success, border: 'none', borderRadius: 6, fontSize: 10, fontWeight: 700 }}>
                            {m.is_active ? 'Suspend' : 'Reactivate'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </>
      )}

      {/* Unassigned staff */}
      {staff.filter(s => !s.team_id && s.role !== 'super_admin').length > 0 && (
        <>
          <p style={{ fontSize: 11, fontWeight: 800, color: theme.textLight, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '4px 0 0 0' }}>
            Unassigned Staff
          </p>
          {staff.filter(s => !s.team_id && s.role !== 'super_admin').map(m => (
            <div key={m.id} style={{ border: `1px solid ${theme.border}`, borderRadius: 14, padding: 12, background: theme.cardBg, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ margin: '0 0 2px 0', fontWeight: 700, fontSize: 13, color: theme.navy }}>{m.full_name}</p>
                <p style={{ margin: '0 0 2px 0', fontSize: 11, color: theme.textLight }}>{m.email}</p>
                <p style={{ margin: 0, fontSize: 11, color: theme.tealDeep, fontWeight: 700 }}>{ROLE_LABELS[m.role] || m.role}</p>
              </div>
              <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 20, background: m.is_active ? '#ecfdf5' : '#fef2f2', color: m.is_active ? theme.success : theme.alert }}>
                {m.is_active ? 'Active' : 'Suspended'}
              </span>
            </div>
          ))}
        </>
      )}

      {/* Super admin */}
      <p style={{ fontSize: 11, fontWeight: 800, color: theme.textLight, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '4px 0 0 0' }}>Super Admin</p>
      {staff.filter(s => s.role === 'super_admin').map(m => (
        <div key={m.id} style={{ border: `1px solid #e9d5ff`, borderRadius: 14, padding: 12, background: '#faf5ff' }}>
          <p style={{ margin: '0 0 2px 0', fontWeight: 800, fontSize: 13, color: '#7c3aed' }}>👑 {m.full_name}</p>
          <p style={{ margin: '0 0 2px 0', fontSize: 11, color: theme.textLight }}>{m.email}</p>
          <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>Full platform access · Last login: {timeAgo(m.last_login)}</p>
        </div>
      ))}
    </div>
  )
}

export default AdminTeams
