import { useState, useEffect } from 'react'
import { AlertTriangle, Bell, Check, X, User, CheckCircle, Pause, Shield, Plus, Mail, Crown, Lock } from 'lucide-react'
import { staffRepository } from './repositories'
import { invitationService, readableError } from './services/invitations'
import {
  INVITE_TTL_DAYS, customRoleMap, grantsStaffManagement, assignableRoles, canActOnMember,
  invitationState, seatsUsed, seatLimit, validateInvite, validateRole,
} from './services/staffPolicy'
import { useAuth } from '../../providers/AuthProvider'
import { getModulesForType, isReservedRoleName } from '../../lib/permissions'
import { PLAN_LABELS } from '../../lib/planLimits'
import { theme } from '../../styles/theme'
import { Card, StatCard, SectionHead, Modal, ConfirmDialog, Pill, Inp, Sel, GhostBtn, TealBtn, RedBtn, Avatar, Loading, Empty, ErrorState, useToast, Toast } from '../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, border, danger, dangerBg, success, warning, warningBg } = theme

// Staff management follows standard organisation-membership practice:
//   * The Owner is the business account itself — shown here, never editable.
//   * People join by INVITATION: they get an emailed single-use link and set
//     their own password. Nobody else ever chooses or sees it. (The old flow
//     had the owner type a password, and could attach the "staff member" to an
//     existing login — the owner's own — so the staff's password reset changed
//     the owner's password. See sql/20261009_staff_invitations_and_role_governance.sql.)
//   * Anyone whose role has "Manage staff" can invite and manage; only the
//     Owner can grant "Manage staff" or act on someone who holds it; nobody
//     acts on their own membership. The database enforces all of this —
//     services/staffPolicy.js mirrors it so the page only offers what works.

const actionBtn = { minHeight: 36, padding: '7px 12px', borderRadius: theme.radius.sm, border: `1px solid ${border}`, background: 'white', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }

export default function Staff({ brand, role, perms }) {
  const { auth } = useAuth() || {}
  const me = auth?.staff || null
  const [staff, setStaff] = useState([])
  const [claims, setClaims] = useState([])
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [roleDeleteTarget, setRoleDeleteTarget] = useState(null)
  const [roleEditorOpen, setRoleEditorOpen] = useState(false)
  const [editingRole, setEditingRole] = useState(null)
  // "Edit role" on a staff row: roles are otherwise immutable after creation,
  // and the FK-backed delete is blocked for anyone with usage history — so a
  // mis-assigned role used to be permanent.
  const [editTarget, setEditTarget] = useState(null)
  const [editRole, setEditRole] = useState('')
  const [savingRoleEdit, setSavingRoleEdit] = useState(false)
  const [roleForm, setRoleForm] = useState({ name: '', label: '', nav: [], flags: {} })
  const [savingRole, setSavingRole] = useState(false)
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const f = (k, v) => { setFormError(''); setForm(p => ({ ...p, [k]: v })) }

  const isOwnerLevel = role === 'Owner' && !me
  const canManage = !!perms?.canManageStaff
  const bType = brand?.business_type || brand?.type
  const isEnterprise = bType === 'manufacturer_importer' || bType === 'wholesale'

  useEffect(() => { load() }, [brand?.id])

  async function load() {
    setLoading(true)
    setLoadError('')
    try {
      const [s, r] = await Promise.all([staffRepository.getAll(brand.id), staffRepository.getRoles(brand.id)])
      setStaff(s || [])
      setRoles(r || [])
    } catch (e) {
      console.error('[Staff] load failed', e)
      setLoadError(readableError(e, 'We could not load your team. Please try again.'))
    }
    // Claims are secondary — a failure here must not hide the team list.
    try { setClaims((await staffRepository.getPendingClaims(brand.id)) || []) } catch (e) { setClaims([]) }
    setLoading(false)
  }

  const customRoles = customRoleMap(roles)
  const roleContext = { businessType: bType, customRoles, isOwnerLevel }
  const roleOptions = assignableRoles(roleContext)
  const validationContext = { assignable: roleOptions, isEnterprise, customRoles, isOwnerLevel }
  // Every role already used at this company — enterprise suggestion list, so
  // the company's own hierarchy naturally builds itself as they add people.
  const usedRoles = [...new Set(staff.map(s => s.role).filter(r => r && !isReservedRoleName(r)))]
    .filter(r => isOwnerLevel || !grantsStaffManagement(r, customRoles))
  // Modules the Roles & Permissions editor may offer: only what this business
  // type can actually use, straight from the registry.
  const typeModules = getModulesForType(bType || 'skincare')
  const typeModuleIds = typeModules.map(m => m[0])
  const actOn = (s) => canActOnMember({ member: s, me, canManage, isOwnerLevel, customRoles })
  const limit = seatLimit(brand?.plan)
  const used = seatsUsed(staff)

  const FLAG_META = [
    ['canEditPrice', 'Edit prices', 'Can change selling prices in Inventory and POS.'],
    ['canEditStock', 'Edit stock', 'Can adjust stock levels and record purchases.'],
    ['canDelete', 'Delete records', 'Can delete products, sales, clients and other records.'],
    ['canViewReports', 'View reports', 'Can open the Reports page and see business analytics.'],
    ['canExportReports', 'Export reports', 'Can download/export report data.'],
    ['canManageStaff', 'Manage staff', 'Can invite, remove or change staff members and roles. Only the Owner can grant this.'],
    ['canViewFinance', 'View finance', 'Can see expenses, debts and financial figures.'],
    ['canMakeSales', 'Make sales', 'Can record sales at the POS / counter.'],
    ['canViewSettings', 'View settings', 'Can open Settings and change business configuration.'],
  ]

  function openRoleEditor(roleRow) {
    if (roleRow) {
      const p = roleRow.permissions || {}
      setEditingRole(roleRow)
      setRoleForm({ name: roleRow.name, label: p.label || '', nav: Array.isArray(p.nav) ? p.nav : [], flags: Object.fromEntries(FLAG_META.map(([k]) => [k, !!p[k]])) })
    } else {
      setEditingRole(null)
      setRoleForm({ name: '', label: '', nav: ['dashboard'], flags: { canViewReports: false, canMakeSales: false } })
    }
    setRoleEditorOpen(true)
  }

  async function saveRole() {
    if (!roleForm.name.trim()) { showToast('Give the role a name.', { type: 'warning' }); return }
    // "Owner" is reserved for the business account — getPerms always resolves
    // it to the full-access preset, so a custom role by that name could never
    // take effect and would only mislead. The database refuses it too.
    if (isReservedRoleName(roleForm.name)) { showToast('"Owner" is reserved for the business account — pick a different name.', { type: 'warning' }); return }
    if (!isOwnerLevel && roleForm.flags.canManageStaff) { showToast('Only the business owner can grant "Manage staff".', { type: 'warning' }); return }
    setSavingRole(true)
    // Modules outside this business type's registry are meaningless (another
    // vertical's gate would neutralise them) — never persist them.
    const nav = roleForm.nav.filter(k => typeModuleIds.includes(k))
    const payload = {
      business_id: brand.id,
      name: roleForm.name.trim(),
      permissions: {
        nav: nav.length > 0 ? nav : ['dashboard'],
        label: roleForm.label.trim() || roleForm.name.trim(),
        ...Object.fromEntries(FLAG_META.map(([k]) => [k, !!roleForm.flags[k]])),
      },
    }
    try {
      if (editingRole) await staffRepository.updateRole(editingRole.id, brand.id, payload)
      else await staffRepository.createRole(brand.id, payload)
      showToast(editingRole ? 'Role updated!' : 'Role created!', { type: 'success' })
      setRoleEditorOpen(false)
      load()
    } catch (e) { showToast(readableError(e, 'Could not save this role. Please try again.'), { type: 'error' }) }
    setSavingRole(false)
  }

  async function handleDeleteRole() {
    const id = roleDeleteTarget?.id
    setRoleDeleteTarget(null)
    try { await staffRepository.deleteRole(id, brand.id); load(); showToast('Role deleted.', { type: 'success' }) } catch (e) { showToast(readableError(e, 'Could not delete this role. Please try again.'), { type: 'error' }) }
  }

  function closeInvite() { setShowAdd(false); setForm({}); setFormError('') }

  async function sendInvite() {
    if (saving) return
    const problem = validateInvite(form, validationContext)
    if (problem) { setFormError(problem); return }
    if (used >= limit) {
      setFormError(`Your ${PLAN_LABELS[brand?.plan] || 'current'} plan allows up to ${limit} active or invited staff. Upgrade in Settings, or deactivate someone first.`)
      return
    }
    setSaving(true)
    try {
      const { invitation, emailSent } = await invitationService.invite(brand.id, form)
      if (emailSent) showToast(`Invitation sent to ${invitation.email}.`, { type: 'success' })
      else showToast(`Invitation created, but the email to ${invitation.email} could not be sent. Use "Resend invite" to try again.`, { type: 'warning' })
      closeInvite(); load()
    } catch (e) {
      // The server's reasons are written for this person ("This email is a
      // business owner's CareHub login…") — show them in the form.
      setFormError(readableError(e, 'Could not send the invitation. Please try again.'))
    }
    setSaving(false)
  }

  async function resendInvite(s) {
    setBusyId(s.id)
    try {
      const { emailSent } = await invitationService.resend(s.id)
      if (emailSent) showToast(`A new invitation link was sent to ${s.email}. The previous link no longer works.`, { type: 'success' })
      else showToast(`A new link was created, but the email to ${s.email} could not be sent. Please try again shortly.`, { type: 'warning' })
      load()
    } catch (e) { showToast(readableError(e, 'Could not resend the invitation.'), { type: 'error' }) }
    setBusyId(null)
  }

  async function toggleStatus(s) {
    setBusyId(s.id)
    try { await staffRepository.update(s.id, brand.id, { status: s.status === 'active' ? 'inactive' : 'active' }); load(); showToast(s.status === 'active' ? `${s.full_name} can no longer sign in.` : `${s.full_name} can sign in again.`, { type: 'success' }) } catch (e) { showToast(readableError(e, 'Could not update status. Please try again.'), { type: 'error' }) }
    setBusyId(null)
  }

  async function toggleCareFind(s) {
    setBusyId(s.id)
    try { await staffRepository.update(s.id, brand.id, { show_on_carefind: !s.show_on_carefind }); load(); showToast(!s.show_on_carefind ? 'Now visible on CareFind' : 'Hidden from CareFind', { type: 'success' }) } catch (e) { showToast(readableError(e, 'Could not update CareFind visibility. Please try again.'), { type: 'error' }) }
    setBusyId(null)
  }

  function openRoleEdit(s) { setEditTarget(s); setEditRole(s.role); setShowAdd(false) }

  async function saveRoleEdit() {
    const problem = validateRole(editRole, validationContext)
    if (problem) { showToast(problem, { type: 'warning' }); return }
    const s = editTarget
    setSavingRoleEdit(true)
    try {
      const updates = { role: editRole.trim() }
      // If the CareFind title was auto-derived from the old role, keep it in
      // sync so the public listing doesn't show a stale title after a change.
      if (s?.public_title && s.public_title === s.role) updates.public_title = editRole.trim()
      await staffRepository.update(s.id, brand.id, updates)
      showToast('Role updated! New access applies immediately.', { type: 'success' })
      setEditTarget(null); load()
    } catch (e) { showToast(readableError(e, 'Could not update this role. Please try again.'), { type: 'error' }) }
    setSavingRoleEdit(false)
  }

  async function handleDelete() {
    const target = deleteTarget
    setDeleteTarget(null)
    // Fifteen tables reference `staff` and none of those foreign keys cascade,
    // so anyone who has actually used the system cannot be deleted. The
    // repository turns that refusal into a reason worth reading — usually
    // "deactivate instead" — so it is surfaced rather than replaced with a
    // generic retry message the user cannot act on.
    try {
      await staffRepository.delete(target.id, brand.id, target.full_name)
      load()
      showToast(target.status === 'invited' ? 'Invitation revoked. The link no longer works.' : 'Staff member removed.', { type: 'success' })
    } catch (e) { showToast(readableError(e, 'Could not remove staff member. Please try again.'), { type: 'error' }) }
  }

  async function handleApproveClaim(claimId) {
    try { await staffRepository.decideClaim(claimId, 'approved'); load(); showToast('Claim approved!', { type: 'success' }) } catch (e) { showToast('Could not approve this claim. Please try again.', { type: 'error' }) }
  }

  async function handleRejectClaim(claimId) {
    try { await staffRepository.decideClaim(claimId, 'rejected'); load(); showToast('Claim rejected.', { type: 'info' }) } catch (e) { showToast('Could not reject this claim. Please try again.', { type: 'error' }) }
  }

  const roleColor = r => (grantsStaffManagement(r, customRoles) ? 'purple' : { Manager: 'blue', Doctor: 'teal', Pharmacist: 'teal', Nurse: 'teal' }[r] || 'gray')
  const fmtDate = d => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '')
  const pendingCount = staff.filter(s => s.status === 'invited').length
  const openInvite = () => { setFormError(''); setShowAdd(true) }

  const roleField = (value, onChange, listId) => isEnterprise ? (
    <div>
      <label htmlFor={listId + '-input'} style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: gray600, marginBottom: '6px' }}>Role <span style={{ color: danger }} aria-hidden='true'>*</span></label>
      <input
        id={listId + '-input'}
        list={listId}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder='e.g. Regional Manager, Medical Rep — type your own'
        required
        style={{ width: '100%', minHeight: 44, padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', boxSizing: 'border-box', color: navy, outline: 'none' }}
      />
      <datalist id={listId}>
        {[...new Set([...usedRoles, ...roleOptions])].map(r => <option key={r} value={r} />)}
      </datalist>
      <div style={{ fontSize: '11px', color: gray400, marginTop: '4px' }}>
        {usedRoles.length > 0 ? 'Start typing to reuse a role you\'ve already created, or type a new one.' : 'Type any role name — your team structure is entirely up to you.'}
      </div>
    </div>
  ) : (
    <div>
      {/* A legacy assignment outside this type's preset list (e.g. a Doctor
          created before the picker was type-scoped) must still render, so it
          is appended rather than silently blanked. */}
      <Sel label='Role' value={value} onChange={onChange} options={!value || roleOptions.includes(value) ? roleOptions : [...roleOptions, value]} required />
      <div style={{ fontSize: '11px', color: gray400, marginTop: '4px' }}>
        {Object.keys(customRoles).length > 0 ? 'Custom roles appear alongside the presets — manage them in Roles & Permissions below.' : 'Need different access? Create a custom role in Roles & Permissions below.'}
        {!isOwnerLevel && ' Roles that can manage staff can only be assigned by the Owner.'}
      </div>
    </div>
  )

  return (
    <div>
      <SectionHead title={isEnterprise ? 'Sales Team' : 'Staff Management'} sub='Invite your team and control what each role can access'
        btn={canManage ? '+ Invite Staff' : undefined} onBtn={canManage ? openInvite : undefined} />

      {!canManage && (
        <div role='note' style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', borderRadius: theme.radius.md, background: warningBg, border: `1px solid ${warning}`, marginBottom: '20px', fontSize: '13px', color: warning }}>
          <AlertTriangle size={15} style={{ flexShrink: 0 }} aria-hidden='true' /> Only the business Owner, or someone whose role can manage staff, can invite or change staff members.
        </div>
      )}

      {canManage && claims.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '800', color: navy, marginBottom: '10px' }}>
            <Bell size={14} aria-hidden='true' /> Pending CareFind claims ({claims.length})
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
                      style={{ display: 'flex', alignItems: 'center', gap: '5px', minHeight: 36, padding: '8px 14px', borderRadius: theme.radius.sm, border: 'none', background: tealDeep, color: 'white', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}>
                      <Check size={13} aria-hidden='true' /> Approve
                    </button>
                    <button onClick={() => handleRejectClaim(c.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: '5px', minHeight: 36, padding: '8px 14px', borderRadius: theme.radius.sm, border: 'none', background: dangerBg, color: danger, fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}>
                      <X size={13} aria-hidden='true' /> Reject
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '14px', marginBottom: '20px' }}>
        <StatCard icon={<User />} label='Seats used' value={Number.isFinite(limit) ? `${used} / ${limit}` : used} sub='Active + pending invites' />
        <StatCard icon={<CheckCircle />} label='Active' value={staff.filter(s => s.status === 'active').length} />
        <StatCard icon={<Mail />} label='Pending invites' value={pendingCount} />
        <StatCard icon={<Pause />} label='Inactive' value={staff.filter(s => s.status === 'inactive').length} />
      </div>

      {/* The Owner is the business account, not a staff row — shown so the
          team list reads as the whole organisation, but never editable here. */}
      <Card style={{ padding: '18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
          <Avatar name={brand?.owner || brand?.name} size={44} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: '800', fontSize: '15px', color: navy }}>{brand?.owner || brand?.name}</div>
            <div style={{ fontSize: '12px', color: gray500, marginTop: '2px', overflowWrap: 'anywhere' }}>{brand?.email}</div>
            <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
              <Pill label='Owner' type='purple' />
              {isOwnerLevel && <Pill label='You' type='gray' />}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: gray500 }}>
          <Crown size={14} aria-hidden='true' /> Full access · account holder
        </div>
      </Card>

      {loading ? <Loading /> : loadError ? (
        <ErrorState message={loadError} onRetry={load} />
      ) : staff.length === 0 ? (
        <Empty icon={<User size={40} />} message='No staff yet. Invite your team — each person sets their own password from the email we send them.' action={canManage ? '+ Invite Staff' : undefined} onAction={openInvite} />
      ) : (
        <ul aria-label='Staff members' style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {staff.map(s => {
            const invite = invitationState(s)
            const allowed = actOn(s)
            const isMe = me && s.id === me.id
            const busy = busyId === s.id
            return (
              <li key={s.id}>
                <Card style={{ padding: '18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', opacity: s.status === 'inactive' ? 0.75 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
                    <Avatar name={s.full_name} size={44} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: '800', fontSize: '15px', color: navy }}>{s.full_name}</div>
                      <div style={{ fontSize: '12px', color: gray500, marginTop: '2px', overflowWrap: 'anywhere' }}>{s.email}{s.phone ? ' · ' + s.phone : ''}</div>
                      {s.public_title && s.show_on_carefind && <div style={{ fontSize: '12px', color: tealDeep, fontWeight: '600', marginTop: '2px' }}>{s.public_title}</div>}
                      <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                        <Pill label={s.role} type={roleColor(s.role)} />
                        {invite === 'pending' && <Pill label={`Invited · expires ${fmtDate(s.invite_expires_at)}`} type='amber' />}
                        {invite === 'expired' && <Pill label='Invitation expired' type='red' />}
                        {!invite && <Pill label={s.status === 'active' ? 'Active' : 'Inactive'} type={s.status === 'active' ? 'green' : 'gray'} />}
                        {s.show_on_carefind && <Pill label='On CareFind' type='teal' />}
                        {isMe && <Pill label='You' type='gray' />}
                      </div>
                    </div>
                  </div>
                  {allowed ? (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {invite ? (
                        <>
                          <button disabled={busy} onClick={() => resendInvite(s)} style={{ ...actionBtn, color: tealDeep }}>{busy ? 'Sending…' : 'Resend invite'}</button>
                          <RedBtn onClick={() => setDeleteTarget(s)} style={{ minHeight: 36, padding: '6px 12px' }}>Revoke</RedBtn>
                        </>
                      ) : (
                        <>
                          <button disabled={busy} onClick={() => openRoleEdit(s)} style={{ ...actionBtn, color: tealDeep }}>Edit role</button>
                          <button disabled={busy} onClick={() => toggleCareFind(s)} style={{ ...actionBtn, color: s.show_on_carefind ? warning : tealDeep }}>
                            {s.show_on_carefind ? 'Hide from CareFind' : 'Show on CareFind'}
                          </button>
                          <button disabled={busy} onClick={() => toggleStatus(s)} style={{ ...actionBtn, color: s.status === 'active' ? warning : success }}>
                            {s.status === 'active' ? 'Deactivate' : 'Activate'}
                          </button>
                          <RedBtn onClick={() => setDeleteTarget(s)} style={{ minHeight: 36, padding: '6px 12px' }}>Remove</RedBtn>
                        </>
                      )}
                    </div>
                  ) : canManage && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: gray400 }}>
                      <Lock size={13} aria-hidden='true' /> {isMe ? 'Your own membership' : 'Only the Owner can change this person'}
                    </div>
                  )}
                </Card>
              </li>
            )
          })}
        </ul>
      )}

      <Modal show={showAdd} onClose={closeInvite} title='Invite Staff Member'
        footer={<><GhostBtn onClick={closeInvite} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={sendInvite} disabled={saving} style={{ flex: 1, padding: '12px' }}>{saving ? 'Sending…' : 'Send Invitation'}</TealBtn></>}>
        <form onSubmit={e => { e.preventDefault(); sendInvite() }} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }} noValidate>
          {formError && (
            <div role='alert' style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', padding: '10px 12px', borderRadius: theme.radius.md, background: dangerBg, color: danger, fontSize: '12.5px', lineHeight: 1.5 }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden='true' /> <span>{formError}</span>
            </div>
          )}
          <Inp id='invite-name' label='Full Name' value={form.fullName} onChange={v => f('fullName', v)} placeholder='Staff full name' autoComplete='off' required />
          <Inp id='invite-email' label='Email Address' value={form.email} onChange={v => f('email', v)} type='email' placeholder='their.own@email.com' autoComplete='off' required />
          <Inp id='invite-phone' label='Phone Number' value={form.phone} onChange={v => f('phone', v)} placeholder='08012345678' />
          {roleField(form.role, v => f('role', v), 'invite-role-suggestions')}

          <div style={{ padding: '12px', borderRadius: theme.radius.md, border: `1px solid ${border}` }}>
            <label style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', cursor: 'pointer' }}>
              <input type='checkbox' checked={form.showOnCareFind || false} onChange={e => f('showOnCareFind', e.target.checked)} style={{ marginTop: '2px', accentColor: tealDeep }} />
              <span>
                <span style={{ display: 'block', fontWeight: '700', fontSize: '13px', color: navy }}>Show this person on CareFind</span>
                <span style={{ display: 'block', fontSize: '12px', color: gray500, marginTop: '2px' }}>They can claim this position on CareFind and post, respond to reviews, and add products on the company's behalf.</span>
              </span>
            </label>
            {form.showOnCareFind && (
              <div style={{ marginTop: '10px' }}>
                <Inp id='invite-title' label='Public Title' value={form.publicTitle} onChange={v => f('publicTitle', v)} placeholder='e.g. Regional Manager (defaults to their role if left blank)' />
              </div>
            )}
          </div>

          <div style={{ padding: '12px', borderRadius: theme.radius.md, background: tealMist, fontSize: '12px', color: tealDeep, lineHeight: '1.7' }}>
            We'll email them a secure link (valid {INVITE_TTL_DAYS} days, single use) to set <strong>their own</strong> password — you never choose or see it.
            If they already have a CareHub or CareFind login with this email, they'll sign in with it instead; their password is never changed.
            <br /><span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><AlertTriangle size={12} aria-hidden='true' /> Use the person's <strong>own</strong> email — not yours, and not a shared inbox.</span>
          </div>
          {/* Lets Enter in any field submit; the visible button lives in the modal footer. */}
          <button type='submit' style={{ display: 'none' }} />
        </form>
      </Modal>

      <Modal show={!!editTarget} onClose={() => setEditTarget(null)} title={'Edit role — ' + (editTarget?.full_name || 'Staff member')}
        footer={<><GhostBtn onClick={() => setEditTarget(null)} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={saveRoleEdit} disabled={savingRoleEdit} style={{ flex: 1, padding: '12px' }}>{savingRoleEdit ? 'Saving...' : 'Save Role'}</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {roleField(editRole, setEditRole, 'edit-role-suggestions')}
          <div style={{ padding: '12px', borderRadius: theme.radius.md, background: tealMist, fontSize: '12px', color: tealDeep, lineHeight: '1.7' }}>
            The new role's access applies to this staff member immediately. If their CareFind title was set from the old role, it is updated to match.
          </div>
        </div>
      </Modal>

      {canManage && (
        <div style={{ marginTop: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Shield size={17} color={navy} aria-hidden='true' />
              <div>
                <div style={{ fontSize: '15px', fontWeight: '800', color: navy }}>Roles &amp; Permissions</div>
                <div style={{ fontSize: '12px', color: gray500 }}>Define your own roles with exactly the modules and actions each one can use</div>
              </div>
            </div>
            <TealBtn onClick={() => openRoleEditor(null)} style={{ padding: '10px 16px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Plus size={14} aria-hidden='true' /> New Role</TealBtn>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {roles.length === 0 && (
              <Card style={{ padding: '16px', fontSize: '13px', color: gray500 }}>No custom roles yet. Preset roles (Manager, Pharmacist, Cashier…) are always available — create your first custom role to tailor access.</Card>
            )}
            {roles.map(r => {
              const p = r.permissions || {}
              const navCount = Array.isArray(p.nav) ? p.nav.length : 0
              const flagCount = FLAG_META.filter(([k]) => p[k]).length
              const locked = !isOwnerLevel && !!p.canManageStaff
              return (
                <Card key={r.id} style={{ padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontWeight: '800', fontSize: '14px', color: navy }}>{r.name}</div>
                    <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{p.label || r.name} · {navCount} modules · {flagCount} actions{p.canManageStaff ? ' · manages staff' : ''}</div>
                  </div>
                  {locked ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: gray400 }}><Lock size={13} aria-hidden='true' /> Owner only</div>
                  ) : (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => openRoleEditor(r)} style={{ ...actionBtn, color: tealDeep }}>Edit</button>
                      <RedBtn onClick={() => setRoleDeleteTarget(r)} style={{ minHeight: 36, padding: '6px 12px' }}>Delete</RedBtn>
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        </div>
      )}

      <Modal show={roleEditorOpen} onClose={() => setRoleEditorOpen(false)} title={editingRole ? 'Edit Role' : 'Create Custom Role'}
        footer={<><GhostBtn onClick={() => setRoleEditorOpen(false)} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={saveRole} disabled={savingRole} style={{ flex: 1, padding: '12px' }}>{savingRole ? 'Saving...' : 'Save Role'}</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Inp id='role-name' label='Role Name' value={roleForm.name} onChange={v => setRoleForm(p => ({ ...p, name: v }))} placeholder='e.g. Regional Manager, Lab Supervisor' required />
          <Inp id='role-label' label='Display Label (optional)' value={roleForm.label} onChange={v => setRoleForm(p => ({ ...p, label: v }))} placeholder='Shown in the app if you want a friendlier label' />

          <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
            <legend style={{ fontSize: '11px', fontWeight: '700', color: gray600, marginBottom: '6px', padding: 0 }}>Modules this role can open</legend>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: '8px', maxHeight: 220, overflowY: 'auto', padding: '12px', border: `1px solid ${border}`, borderRadius: theme.radius.md }}>
              {typeModules.map(([key, , label]) => (
                <label key={key} style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12.5px', color: navy, cursor: 'pointer' }}>
                  <input type='checkbox' checked={roleForm.nav.includes(key)} onChange={e => setRoleForm(p => ({ ...p, nav: e.target.checked ? [...p.nav, key] : p.nav.filter(k => k !== key) }))} style={{ accentColor: tealDeep }} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
            <legend style={{ fontSize: '11px', fontWeight: '700', color: gray600, marginBottom: '6px', padding: 0 }}>Actions</legend>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {FLAG_META.map(([key, label, desc]) => {
                const disabled = key === 'canManageStaff' && !isOwnerLevel
                return (
                  <label key={key} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
                    <input type='checkbox' disabled={disabled} checked={!!roleForm.flags[key]} onChange={e => setRoleForm(p => ({ ...p, flags: { ...p.flags, [key]: e.target.checked } }))} style={{ marginTop: '2px', accentColor: tealDeep }} />
                    <span>
                      <span style={{ display: 'block', fontWeight: '700', fontSize: '12.5px', color: navy }}>{label}</span>
                      <span style={{ display: 'block', fontSize: '11.5px', color: gray500 }}>{desc}</span>
                    </span>
                  </label>
                )
              })}
            </div>
          </fieldset>
          <div style={{ padding: '12px', borderRadius: theme.radius.md, background: tealMist, fontSize: '12px', color: tealDeep, lineHeight: '1.7' }}>
            Staff assigned this role see only the modules and actions you check. Roles apply immediately to everyone already using them.
          </div>
        </div>
      </Modal>

      <ConfirmDialog show={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete}
        title={deleteTarget?.status === 'invited' ? 'Revoke this invitation?' : 'Remove this staff member?'}
        consequence={deleteTarget?.status === 'invited'
          ? `The invitation link sent to ${deleteTarget?.email || 'this person'} stops working immediately. You can invite them again later.`
          : `This removes ${deleteTarget?.full_name || 'this staff member'} from your business and revokes their access immediately. Their personal login is not deleted. If they have records in the system, deactivate them instead.`}
        confirmLabel={deleteTarget?.status === 'invited' ? 'Revoke' : 'Remove'} />

      <ConfirmDialog show={!!roleDeleteTarget} onClose={() => setRoleDeleteTarget(null)} onConfirm={handleDeleteRole}
        title='Delete this role?'
        consequence={`Staff currently assigned the "${roleDeleteTarget?.name || 'custom'}" role will lose their custom access and fall back to the default staff permissions until you assign them another role.`}
        confirmLabel='Delete Role' />

      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}
