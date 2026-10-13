import { useEffect, useId, useRef, useState } from 'react'
import { Eye, EyeOff, UserPlus } from 'lucide-react'
import { Button, Input, Select } from '@care-ecosystem/design-system/components/ui'
import SourceNotice, { isOk } from './SourceNotice.jsx'
import { assignableCustomRoles, spaced, SYSTEM_ROLES, SYSTEM_ROLE_LABELS } from './roleNames.js'
import { useStaffActions } from '../../hooks/useStaffActions'
import { useAdmin } from '../../provider/AdminProvider.jsx'
import '../../ui/admin.css'

// Create a console account for a staff member.
//
// Security: this creates a privileged account with a password the admin types.
// The password lives only in this component's state and goes to createStaff and
// nowhere else: it is never rendered as text or put in a title, aria-label or
// data attribute, and it is cleared after every attempt, success or failure, so
// a retry needs it typed again. super_admin is never offered (the hook refuses
// it as well). A failure keeps name, email, role and team so only the password
// is retyped; success clears the whole form.

const MIN_PASSWORD = 8

// The five system roles are always offered (as the legacy form did); custom
// roles come from the roles source. A failed roles read leaves only the five.
const customRoles = (roles) => (isOk(roles) ? assignableCustomRoles(roles.data) : [])

export default function CreateStaffPanel({ teams, roles, onRetry }) {
  const { busy, createStaff } = useStaffActions()
  const { showToast } = useAdmin()
  const ids = useId()

  const mounted = useRef(true)
  const inFlight = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [roleValue, setRoleValue] = useState('')
  const [teamId, setTeamId] = useState('')
  const [error, setError] = useState('')
  const [created, setCreated] = useState(false)

  const custom = customRoles(roles)
  const roleOptions = [
    ...SYSTEM_ROLES.map(r => ({ value: r, label: SYSTEM_ROLE_LABELS[r] })),
    ...custom.map(r => ({ value: String(r.id), label: spaced(r.name) })),
  ]
  const customChoice = custom.find(r => String(r.id) === roleValue)
  const isSystemChoice = SYSTEM_ROLES.includes(roleValue)
  const rolesFailed = !isOk(roles) && roles?.status !== 'loading' && roles != null
  const teamsOk = isOk(teams)

  // A custom role that vanishes on a refresh must not stay chosen unseen.
  useEffect(() => {
    if (roleValue && !SYSTEM_ROLES.includes(roleValue) && !custom.some(r => String(r.id) === roleValue)) setRoleValue('')
  }, [roleValue, custom])

  const running = busy === 'createStaff'
  const valid = !!name.trim() && !!email.trim() && password.length >= MIN_PASSWORD && (isSystemChoice || !!customChoice)

  // Typing again dismisses the last success message.
  const edit = (setter) => (value) => { setCreated(false); setter(value) }

  const submit = async (e) => {
    e.preventDefault()
    if (!valid || running || inFlight.current) return
    inFlight.current = true
    setError(''); setCreated(false)
    const typed = password
    let res
    try {
      res = await createStaff({
        name, email, password: typed,
        role: customChoice ? customChoice.name : roleValue,
        roleId: customChoice ? customChoice.id : undefined,
        teamId,
      })
    } catch (err) {
      // The hook resolves failures, but a throw must not leave the password behind.
      res = { ok: false, error: err?.message || 'Something went wrong' }
    } finally {
      inFlight.current = false
    }
    if (!mounted.current) {
      if (!res.ok) showToast(`Couldn't create the staff account: ${res.error}`, { type: 'error' })
      return
    }
    // The password is dropped whatever happened.
    setPassword('')
    setShowPassword(false)
    if (res.ok) {
      setName(''); setEmail(''); setRoleValue(''); setTeamId('')
      setCreated(true)
    } else {
      setError(`Couldn't create the staff account: ${res.error}`)
    }
  }

  return (
    <section className="adm-panel adm-staff-create" aria-label="Create staff">
      <div className="adm-live-heading">
        <h3>Create staff account</h3>
        <p className="adm-note">Gives someone a sign-in to the admin console with the role you choose.</p>
      </div>
      <form onSubmit={submit} aria-label="Create a staff account" className="adm-staff-form">
        <Input id={`${ids}-name`} label="Full name" value={name} onChange={edit(setName)} autoComplete="off"
          required disabled={running} />
        <Input id={`${ids}-email`} label="Email" type="email" value={email} onChange={edit(setEmail)} autoComplete="off"
          required disabled={running} />
        <div className="adm-password-row">
          <Input id={`${ids}-password`} label="Password" type={showPassword ? 'text' : 'password'} value={password}
            onChange={edit(setPassword)} autoComplete="new-password" required disabled={running}
            helperText={`At least ${MIN_PASSWORD} characters`} />
          <Button type="button" variant="ghost" size="sm" aria-pressed={showPassword} disabled={running}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            leftIcon={showPassword ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
            onClick={() => setShowPassword(s => !s)}>
            {showPassword ? 'Hide' : 'Show'}
          </Button>
        </div>
        <div>
          <Select id={`${ids}-role`} label="Role" value={roleValue} onChange={edit(setRoleValue)} placeholder="Choose a role"
            options={roleOptions} required disabled={running} />
          {rolesFailed && (
            <div className="adm-live-warn">
              <span>Couldn't load custom roles</span>
              <Button type="button" variant="ghost" size="sm" onClick={onRetry} aria-label="Retry loading roles">Retry</Button>
            </div>
          )}
        </div>
        <div>
          <Select id={`${ids}-team`} label="Team" value={teamId} onChange={edit(setTeamId)} placeholder="No team"
            options={teamsOk ? teams.data.map(t => ({ value: String(t.id), label: t.name })) : []}
            disabled={running || !teamsOk} />
          {!teamsOk && <SourceNotice source={teams} noun="teams" onRetry={onRetry} />}
        </div>
        {error && <p role="alert" className="adm-live-alert">{error}</p>}
        {created && <p role="status" className="adm-note">Staff account created</p>}
        <Button type="submit" variant="primary" fullWidth disabled={!valid || running} loading={running} loadingText="Creating…"
          leftIcon={<UserPlus size={14} aria-hidden="true" />}>
          Create staff account
        </Button>
      </form>
    </section>
  )
}
