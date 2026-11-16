import { useState } from 'react'
import { Modal, Input, Select, Textarea, GhostBtn, TealBtn } from '../../../components/ui'
import { isDuplicateError } from '../../../lib/dbErrors'
import { todayDate } from '../../../lib/utils'
import { theme } from '../../../styles/theme'
import { CLIENT_GENDERS } from '../clientBulkEdit'
import { clientEditForm, validateClientEdit, clientEditChanges, describeClientChanges } from '../clientEdit'

const { gray600, bg, danger } = theme

// Edit Client: one client's name, phone, email, address, gender, date of birth and notes. Saves only what changed.
// Sales, payments, debts and history are not touched: they stay linked to the client, and every screen shows the new
// name (lib/clientNames.js). `save(changes)` resolves to the saved client. Docs: docs/architecture/Client-Edit.md.
export default function ClientEditModal({ client, clients, save, onSaved, onClose, canAdjustTotals = false }) {
  const [form, setForm] = useState(() => clientEditForm(client))
  const [errors, setErrors] = useState({})
  const [failure, setFailure] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k, v) => { setForm((p) => ({ ...p, [k]: v })); setErrors((e) => ({ ...e, [k]: undefined })); setFailure('') }
  const changes = clientEditChanges(client, form, { totals: canAdjustTotals })
  const changed = Object.keys(changes).length > 0

  async function submit() {
    const found = validateClientEdit(form, { client, clients, today: todayDate(), totals: canAdjustTotals })
    if (Object.keys(found).length) { setErrors(found); return }
    if (!changed) { onClose(); return }
    setSaving(true)
    try {
      const saved = await save(changes)
      console.info('[clients] client edited', { client: client.id, fields: Object.keys(changes) })
      onSaved?.(saved, describeClientChanges(changes))
      onClose()
    } catch (e) {
      console.error('[clients] edit failed:', e?.message)
      if (isDuplicateError(e)) setErrors({ phone: 'Another client already has this phone number.' })
      else setFailure(/could not be found/.test(e?.message || '') ? e.message : 'Could not save the changes. Check your connection and try again.')
      setSaving(false)
    }
  }

  const close = () => { if (!saving) onClose() }
  return (
    <Modal show onClose={close} title={`Edit ${client.full_name || 'client'}`} preventClose={saving}
      footer={<><GhostBtn onClick={close} disabled={saving} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={submit} disabled={saving || !changed} style={{ flex: 1, padding: '12px' }}>{saving ? 'Saving…' : 'Save changes'}</TealBtn></>}>
      <form onSubmit={(e) => { e.preventDefault(); submit() }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }} noValidate>
        <div style={{ fontSize: 12.5, color: gray600, padding: 10, borderRadius: theme.radius.md, background: bg, lineHeight: 1.5 }}>
          Changes show everywhere this client appears, including the POS and Debts. Past sales, payments and debts are kept exactly as recorded.
        </div>
        <Input id='client-edit-name' label='Full name' required value={form.full_name} onChange={(v) => set('full_name', v)} error={errors.full_name} autoComplete='off' />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 12 }}>
          <Input id='client-edit-phone' label='Phone number' required type='tel' value={form.phone} onChange={(v) => set('phone', v)} error={errors.phone} helperText='Also how the client is found at the POS.' />
          <Input id='client-edit-email' label='Email' type='email' value={form.email} onChange={(v) => set('email', v)} error={errors.email} />
        </div>
        <Input id='client-edit-address' label='Address' value={form.address} onChange={(v) => set('address', v)} error={errors.address} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 12 }}>
          <Input id='client-edit-dob' label='Date of birth' type='date' value={form.date_of_birth} onChange={(v) => set('date_of_birth', v)} error={errors.date_of_birth} />
          <Select id='client-edit-gender' label='Gender' value={form.gender} onChange={(v) => set('gender', v)} options={CLIENT_GENDERS} placeholder='Not set' error={errors.gender} />
        </div>
        <Textarea label='Notes' value={form.notes} onChange={(v) => set('notes', v)} rows={3} />
        {canAdjustTotals && (
          <fieldset style={{ border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, padding: '10px 12px 12px', margin: 0 }}>
            <legend style={{ fontSize: 12, fontWeight: 700, color: gray600, padding: '0 4px' }}>Visits and total spent</legend>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 12 }}>
              <Input id='client-edit-visits' label='Visits' type='number' min='0' value={form.visit_count} onChange={(v) => set('visit_count', v)} error={errors.visit_count} />
              <Input id='client-edit-spend' label='Total spent (₦)' type='number' min='0' value={form.total_spend} onChange={(v) => set('total_spend', v)} error={errors.total_spend} />
            </div>
            <div style={{ fontSize: 11.5, color: gray600, marginTop: 6, lineHeight: 1.5 }}>Kept from sales: the client's next sale recalculates both from their CareHub sales.</div>
          </fieldset>
        )}
        {errors.notes && <div role='alert' style={{ fontSize: 12, color: danger, marginTop: -8 }}>{errors.notes}</div>}
        {failure && <div role='alert' style={{ fontSize: 12.5, color: danger }}>{failure}</div>}
        <button type='submit' hidden aria-hidden='true' tabIndex={-1} />
      </form>
    </Modal>
  )
}
