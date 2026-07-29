import { useState, useEffect } from 'react'
import { AlertTriangle, Bell, Check, X, User, CheckCircle, Pause } from 'lucide-react'
import { getStaff, addStaff, updateStaff, deleteStaff, getStaffClaims, approveStaffClaim, rejectStaffClaim } from '../../services/supabase'
import { emailStaffWelcome } from '../../lib/email'
import { ROLE_LIST } from '../../lib/permissions'
import { planLimitsFor, PLAN_LABELS } from '../../lib/planLimits'
import { theme } from '../../styles/theme'
import { Card, StatCard, SectionHead, Modal, ConfirmDialog, Pill, Inp, Sel, GhostBtn, TealBtn, RedBtn, Avatar, Loading, Empty, useToast, Toast } from '../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, gray100, border, danger, dangerBg, success, successBg, warning, warningBg, bg } = theme

export default function Staff({ brand, role, perms }) {
  const [staff, setStaff] = useState([])
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const isOwner = role === 'Owner'
  const bType = brand?.business_type || brand?.type
  const isEnterprise = bType === 'manufacturer_importer' || bType === 'wholesale'

  useEffect(() => { load() }, [brand?.id])

  async function load() {
    setLoading(true)
    try {
      const s = await getStaff(brand.id)
      setStaff(s || [])
    } catch (e) {}
    try {
      const c = await getStaffClaims(brand.id)
      setClaims(c || [])
    } catch (e) {}
    setLoading(false)
  }

  // Every role already used at this company — becomes the suggestion list,
  // so the company's own hierarchy naturally builds itself as they add people.
  const usedRoles = [...new Set(staff.map(s => s.role).filter(Boolean))]

  async function save() {
    if (!form.fullName || !form.email || !form.password || !form.role) { showToast('Please fill in all required fields.', { type: 'warning' }); return }
    const limit = planLimitsFor(brand?.plan).maxStaff
    if (staff.length >= limit) {
      showToast(`Your ${PLAN_LABELS[brand?.plan] || 'current'} plan allows up to ${limit} staff. Upgrade your plan in Settings to add more.`, { type: 'warning' })
      return
    }
    setSaving(true)
    try {
      await addStaff({
        business_id: brand.id,
        full_name: form.fullName,
        email: form.email.toLowerCase(),
        password: form.password,
        role: form.role,
        phone: form.phone || '',
        status: 'active',
        show_on_carefind: form.showOnCareFind || false,
        public_title: form.publicTitle || form.role,
      })
      // Send welcome email to staff
      try {
        await emailStaffWelcome({
          staffName: form.fullName,
          staffEmail: form.email,
          businessName: brand.name,
          role: form.role,
          password: form.password,
        })
      } catch (e) {}
      showToast('Staff member added! Welcome email sent.', { type: 'success' })
      setForm({}); setShowAdd(false); load()
    } catch (e) { showToast('Could not add staff member. Email may already be registered.', { type: 'error' }) }
    setSaving(false)
  }

  async function toggleStatus(s) {
    try { await updateStaff(s.id, { status: s.status === 'active' ? 'inactive' : 'active' }); load(); showToast('Status updated!', { type: 'success' }) } catch (e) { showToast('Could not update status. Please try again.', { type: 'error' }) }
  }

  async function toggleCareFind(s) {
    try { await updateStaff(s.id, { show_on_carefind: !s.show_on_carefind }); load(); showToast(!s.show_on_carefind ? 'Now visible on CareFind' : 'Hidden from CareFind', { type: 'success' }) } catch (e) { showToast('Could not update CareFind visibility. Please try again.', { type: 'error' }) }
  }

  function askDelete(s) { setDeleteTarget(s) }
  async function handleDelete() {
    const id = deleteTarget?.id
    setDeleteTarget(null)
    try { await deleteStaff(id); load(); showToast('Staff member removed.', { type: 'success' }) } catch (e) { showToast('Could not remove staff member. Please try again.', { type: 'error' }) }
  }

  async function handleApproveClaim(claimId) {
    try { await approveStaffClaim(claimId); load(); showToast('Claim approved!', { type: 'success' }) } catch (e) { showToast('Could not approve this claim. Please try again.', { type: 'error' }) }
  }

  async function handleRejectClaim(claimId) {
    try { await rejectStaffClaim(claimId); load(); showToast('Claim rejected.', { type: 'info' }) } catch (e) { showToast('Could not reject this claim. Please try again.', { type: 'error' }) }
  }

  const roleColor = r => ({ Owner: 'purple', Manager: 'blue', Doctor: 'teal', Pharmacist: 'teal', Nurse: 'teal' }[r] || 'gray')

  return (
    <div>
      <SectionHead title={isEnterprise ? 'Sales Team' : 'Staff Management'} sub='Manage your team and their access levels'
        btn={isOwner ? '+ Add Staff Member' : undefined} onBtn={isOwner ? () => setShowAdd(true) : undefined} />

      {!isOwner && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', borderRadius: theme.radius.md, background: warningBg, border: `1px solid ${warning}`, marginBottom: '20px', fontSize: '13px', color: warning }}>
          <AlertTriangle size={15} style={{ flexShrink: 0 }} /> Only the business Owner can add or remove staff members.
        </div>
      )}

      {isOwner && claims.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '800', color: navy, marginBottom: '10px' }}>
            <Bell size={14} /> Pending CareFind claims ({claims.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {claims.map(c => (
              <Card key={c.id} style={{ padding: '14px', border: `1px solid ${warning}`, background: warningBg }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                  <div>
                    <div style={{ fontWeight: '800', fontSize: '14px', color: navy }}>{c.staff?.full_name}</div>
                    <div style={{ fontSize: '12px', color: gray600, marginTop: '2px' }}>
                      wants to claim <strong>{c.staff?.public_title || 'their position'}</strong> on CareFind
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => handleApproveClaim(c.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '8px 14px', borderRadius: theme.radius.sm, border: 'none', background: tealDeep, color: 'white', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}>
                      <Check size={13} /> Approve
                    </button>
                    <button onClick={() => handleRejectClaim(c.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '8px 14px', borderRadius: theme.radius.sm, border: 'none', background: dangerBg, color: danger, fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}>
                      <X size={13} /> Reject
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '14px', marginBottom: '20px' }}>
        <StatCard icon={<User />} label='Total Staff' value={staff.length} />
        <StatCard icon={<CheckCircle />} label='Active' value={staff.filter(s => s.status === 'active').length} />
        <StatCard icon={<Pause />} label='Inactive' value={staff.filter(s => s.status !== 'active').length} />
      </div>

      {loading ? <Loading /> : staff.length === 0 ? (
        <Empty icon={<User size={40} />} message='No staff added yet' action={isOwner ? '+ Add Staff Member' : undefined} onAction={() => setShowAdd(true)} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {staff.map(s => (
            <Card key={s.id} style={{ padding: '18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <Avatar name={s.full_name} size={44} />
                <div>
                  <div style={{ fontWeight: '800', fontSize: '15px', color: navy }}>{s.full_name}</div>
                  <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{s.email}{s.phone ? ' · ' + s.phone : ''}</div>
                  {s.public_title && <div style={{ fontSize: '12px', color: tealDeep, fontWeight: '600', marginTop: '2px' }}>{s.public_title}</div>}
                  <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                    <Pill label={s.role} type={roleColor(s.role)} />
                    <Pill label={s.status === 'active' ? 'Active' : 'Inactive'} type={s.status === 'active' ? 'green' : 'gray'} />
                    {s.show_on_carefind && <Pill label='On CareFind' type='teal' />}
                  </div>
                </div>
              </div>
              {isOwner && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button onClick={() => toggleCareFind(s)}
                    style={{ padding: '7px 12px', borderRadius: theme.radius.sm, border: `1px solid ${border}`, background: 'white', color: s.show_on_carefind ? warning : tealDeep, fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}>
                    {s.show_on_carefind ? 'Hide from CareFind' : 'Show on CareFind'}
                  </button>
                  <button onClick={() => toggleStatus(s)}
                    style={{ padding: '7px 12px', borderRadius: theme.radius.sm, border: `1px solid ${border}`, background: 'white', color: s.status === 'active' ? warning : success, fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}>
                    {s.status === 'active' ? 'Deactivate' : 'Activate'}
                  </button>
                  <RedBtn onClick={() => askDelete(s)} style={{ padding: '6px 12px' }}>Remove</RedBtn>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal show={showAdd} onClose={() => { setShowAdd(false); setForm({}) }} title='Add Staff Member'
        footer={<><GhostBtn onClick={() => { setShowAdd(false); setForm({}) }} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={save} style={{ flex: 1, padding: '12px' }}>{saving ? 'Saving...' : 'Add Staff'}</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Inp label='Full Name *' value={form.fullName} onChange={v => f('fullName', v)} placeholder='Staff full name' required />
          <Inp label='Email Address *' value={form.email} onChange={v => f('email', v)} type='email' placeholder='staff@yourbusiness.ng' required />
          <Inp label='Phone Number' value={form.phone} onChange={v => f('phone', v)} placeholder='08012345678' />

          {isEnterprise ? (
            <div>
              <div style={{ fontSize: '11px', fontWeight: '700', color: gray600, marginBottom: '6px' }}>Role *</div>
              <input
                list='enterprise-role-suggestions'
                value={form.role || ''}
                onChange={e => f('role', e.target.value)}
                placeholder='e.g. Regional Manager, Medical Rep — type your own'
                style={{ width: '100%', minHeight: 44, padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', boxSizing: 'border-box', color: navy, outline: 'none' }}
              />
              <datalist id='enterprise-role-suggestions'>
                {usedRoles.map(r => <option key={r} value={r} />)}
              </datalist>
              <div style={{ fontSize: '11px', color: gray400, marginTop: '4px' }}>
                {usedRoles.length > 0 ? 'Start typing to reuse a role you\'ve already created, or type a new one.' : 'Type any role name — your team structure is entirely up to you.'}
              </div>
            </div>
          ) : (
            <Sel label='Role *' value={form.role} onChange={v => f('role', v)} options={ROLE_LIST} required />
          )}

          <Inp label='Password *' value={form.password} onChange={v => f('password', v)} type='password' placeholder='Set a password for them' required />

          <div style={{ padding: '12px', borderRadius: theme.radius.md, border: `1px solid ${border}` }}>
            <label style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', cursor: 'pointer' }}>
              <input type='checkbox' checked={form.showOnCareFind || false} onChange={e => f('showOnCareFind', e.target.checked)} style={{ marginTop: '2px', accentColor: tealDeep }} />
              <span>
                <div style={{ fontWeight: '700', fontSize: '13px', color: navy }}>Show this person on CareFind</div>
                <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>They can claim this position on CareFind and post, respond to reviews, and add products on the company's behalf.</div>
              </span>
            </label>
            {form.showOnCareFind && (
              <div style={{ marginTop: '10px' }}>
                <Inp label='Public Title' value={form.publicTitle} onChange={v => f('publicTitle', v)} placeholder='e.g. Regional Manager (defaults to their role if left blank)' />
              </div>
            )}
          </div>

          <div style={{ padding: '12px', borderRadius: theme.radius.md, background: tealMist, fontSize: '12px', color: tealDeep, lineHeight: '1.7' }}>
            Staff log in with their email and this password. They will only see pages their role allows.
            <br /><span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><AlertTriangle size={12} /> <strong>Only Owner role</strong> can edit stock prices and delete records.</span>
          </div>
        </div>
      </Modal>

      <ConfirmDialog show={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete}
        title='Remove this staff member?'
        consequence={`This permanently deletes ${deleteTarget?.full_name || 'this staff member'}'s account and revokes their login access immediately. This cannot be undone — you'll need to add them again from scratch if you change your mind.`}
        confirmLabel='Remove' />

      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}
