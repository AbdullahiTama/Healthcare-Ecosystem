import { useState, useEffect } from 'react'
import { supabase } from './lib/supabaseClient'
import { theme } from './lib/theme'

const ROLES = ['moderator', 'verification_officer', 'support', 'content_manager']
const ROLE_LABELS = {
  super_admin: '👑 Super Admin',
  moderator: '🛡️ Moderator',
  verification_officer: '🩺 Verification Officer',
  support: '💬 Support',
  content_manager: '📝 Content Manager',
}

function hashPassword(password) {
  return `cf_hashed_${password}`
}

function AdminStaff({ adminUser }) {
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'moderator' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => { loadStaff() }, [])

  async function loadStaff() {
    setLoading(true)
    const { data } = await supabase.from('admin_users').select('id, email, full_name, role, is_active, last_login, created_at').order('created_at')
    setStaff(data || [])
    setLoading(false)
  }

  async function createStaff(e) {
    e.preventDefault()
    setError(''); setSuccess('')
    setSaving(true)
    const hash = hashPassword(form.password)
    const { error: insertError } = await supabase.from('admin_users').insert({
      email: form.email.toLowerCase(),
      password_hash: hash,
      full_name: form.name,
      role: form.role,
      created_by: adminUser?.id,
    })
    if (insertError) {
      setError(insertError.message)
    } else {
      setSuccess(`Staff account created for ${form.email}`)
      setForm({ email: '', password: '', name: '', role: 'moderator' })
      setCreating(false)
      loadStaff()
    }
    setSaving(false)
  }

  async function toggleStaff(staffId, isActive) {
    await supabase.from('admin_users').update({ is_active: isActive }).eq('id', staffId)
    loadStaff()
  }

  function timeAgo(d) {
    if (!d) return 'Never'
    const diff = Math.floor((Date.now() - new Date(d)) / 1000)
    if (diff < 3600) return `${Math.floor(diff/60)}m ago`
    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`
    return `${Math.floor(diff/86400)}d ago`
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: theme.navy }}>Staff Accounts</h3>
        <button onClick={() => setCreating(!creating)} style={{ padding: '8px 14px', background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13 }}>
          {creating ? 'Cancel' : '+ Add Staff'}
        </button>
      </div>

      {creating && (
        <form onSubmit={createStaff} style={{ border: `1px solid ${theme.tealBright}`, borderRadius: 16, padding: 16, background: '#ecfdf5', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h4 style={{ margin: '0 0 4px 0', fontSize: 14, fontWeight: 800, color: theme.tealDeep }}>New Staff Account</h4>
          {[
            { label: 'Full Name', key: 'name', placeholder: 'e.g. Fatima Aliyu', type: 'text' },
            { label: 'Email', key: 'email', placeholder: 'staff@carefind.ng', type: 'email' },
            { label: 'Password', key: 'password', placeholder: 'Strong password', type: 'password' },
          ].map(f => (
            <div key={f.key}>
              <label style={{ fontSize: 11, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 3 }}>{f.label}</label>
              <input type={f.type} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} placeholder={f.placeholder} required
                style={{ width: '100%', padding: 10, fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: 10 }} />
            </div>
          ))}
          <div>
            <label style={{ fontSize: 11, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 3 }}>Role</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
              style={{ width: '100%', padding: 10, fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: 10, background: '#fff' }}>
              {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>
          {error && <p style={{ color: theme.alert, fontSize: 13, margin: 0 }}>{error}</p>}
          {success && <p style={{ color: theme.success, fontSize: 13, margin: 0 }}>✓ {success}</p>}
          <button type="submit" disabled={saving} style={{ padding: 12, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 14 }}>
            {saving ? 'Creating...' : 'Create Staff Account'}
          </button>
        </form>
      )}

      {success && !creating && <p style={{ color: theme.success, fontSize: 13 }}>✓ {success}</p>}

      {loading ? <p style={{ color: theme.textLight, fontSize: 13 }}>Loading staff...</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {staff.map(s => (
            <div key={s.id} style={{ border: `1px solid ${theme.border}`, borderRadius: 14, padding: 14, background: theme.cardBg }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div>
                  <p style={{ margin: '0 0 2px 0', fontWeight: 800, fontSize: 14, color: theme.navy }}>{s.full_name}</p>
                  <p style={{ margin: '0 0 2px 0', fontSize: 12, color: theme.textLight }}>{s.email}</p>
                  <p style={{ margin: '0 0 4px 0', fontSize: 11.5, color: theme.tealDeep, fontWeight: 700 }}>{ROLE_LABELS[s.role] || s.role}</p>
                  <p style={{ margin: 0, fontSize: 11, color: theme.textLight }}>Last login: {timeAgo(s.last_login)}</p>
                </div>
                <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 20, background: s.is_active ? '#ecfdf5' : '#fef2f2', color: s.is_active ? theme.success : theme.alert }}>
                  {s.is_active ? 'Active' : 'Suspended'}
                </span>
              </div>
              {s.role !== 'super_admin' && (
                <button onClick={() => toggleStaff(s.id, !s.is_active)}
                  style={{ padding: '6px 12px', background: s.is_active ? '#fef2f2' : '#ecfdf5', color: s.is_active ? theme.alert : theme.success, border: 'none', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>
                  {s.is_active ? 'Suspend' : 'Reactivate'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default AdminStaff
