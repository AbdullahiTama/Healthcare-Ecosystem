import { useState, useEffect, useCallback } from 'react'
import { liveActivityRepository } from './repositories'
import { TealBtn, ConfirmDialog, Loading } from '../../components/ui'
import { theme } from '../../styles/theme'

const { tealDeep, navy, gray600, gray500, gray400, border, danger, dangerBg, bg } = theme

const FIELD_TYPES = ['text', 'long text', 'number', 'date', 'choice']
const EMPTY_FIELD = { label: '', field_type: 'text', required: false, options: '' }
const inputStyle = { width: '100%', padding: '12px 12px', borderRadius: '10px', border: `1px solid ${border}`, fontSize: '13px', boxSizing: 'border-box' }

// What every visit report asks for. The owner adds and removes fields; reps see them on the Log Activity
// form. Loads its own data so it works as a page (Field team > Report fields) or inside a sheet.
//   onChanged()  called after a field is added or removed, so a page that shows the form can reload
export default function ReportFieldsSetup({ businessId, onChanged }) {
  const [fields, setFields] = useState(null) // null = loading
  const [loadError, setLoadError] = useState('')
  const [newField, setNewField] = useState(EMPTY_FIELD)
  const [message, setMessage] = useState(null) // { kind: 'ok' | 'error', text }
  const [busy, setBusy] = useState(false)
  const [fieldToRemove, setFieldToRemove] = useState(null)

  const load = useCallback(async () => {
    setLoadError('')
    setFields(null)
    try {
      const rows = await liveActivityRepository.getActivityFields(businessId)
      setFields(Array.isArray(rows) ? rows : [])
    } catch (e) {
      setLoadError(e && e.message ? e.message : 'request failed')
      setFields([])
    }
  }, [businessId])
  useEffect(() => { load() }, [load])

  async function saveField() {
    if (!newField.label.trim()) { setMessage({ kind: 'error', text: 'Give the field a name.' }); return }
    setBusy(true)
    setMessage(null)
    try {
      await liveActivityRepository.addActivityField({
        business_id: businessId,
        label: newField.label.trim(),
        field_type: newField.field_type,
        required: newField.required,
        options: newField.field_type === 'choice' ? (newField.options || null) : null,
        sort_order: (fields || []).length,
      })
      setMessage({ kind: 'ok', text: 'Field added.' })
      setNewField(EMPTY_FIELD)
      await load()
      if (onChanged) onChanged()
    } catch (e) {
      setMessage({ kind: 'error', text: 'Could not add field: ' + e.message })
    } finally {
      setBusy(false)
    }
  }

  async function removeField() {
    if (!fieldToRemove) return
    try {
      await liveActivityRepository.deleteActivityField(fieldToRemove.id)
      setFieldToRemove(null)
      setMessage({ kind: 'ok', text: 'Field removed.' })
      await load()
      if (onChanged) onChanged()
    } catch (e) {
      setFieldToRemove(null)
      setMessage({ kind: 'error', text: 'Could not remove: ' + e.message })
    }
  }

  return (
    <div>
      <div style={{ fontSize: '11.5px', color: gray500, marginBottom: '16px' }}>
        Decide what your reps record on every visit. Name them whatever suits your company.
      </div>

      {fields === null ? <Loading text='Loading report fields...' /> : loadError ? (
        <div role='alert' style={{ fontSize: '12.5px', color: danger, marginBottom: '16px' }}>
          Could not load the report fields: {loadError}.{' '}
          <button type='button' onClick={load} style={{ background: 'none', border: 'none', color: tealDeep, fontWeight: 700, cursor: 'pointer', padding: 0 }}>Try again</button>
        </div>
      ) : fields.length === 0 ? (
        <div style={{ fontSize: '12.5px', color: gray400, marginBottom: '16px' }}>
          No fields yet. Until you add some, reps log each visit with one simple "What happened" note.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '18px' }}>
          {fields.map(function (f) {
            return (
              <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', padding: '12px 12px', borderRadius: '10px', border: `1px solid ${border}` }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: navy }}>
                    {f.label}{f.required ? ' *' : ''}
                  </div>
                  <div style={{ fontSize: '11px', color: gray400, textTransform: 'capitalize' }}>
                    {f.field_type}{f.options ? ': ' + f.options : ''}
                  </div>
                </div>
                <button type='button' onClick={function () { setFieldToRemove(f) }}
                  style={{ flexShrink: 0, border: `1px solid ${danger}`, background: dangerBg, color: danger, borderRadius: '8px', padding: '6px 10px', fontSize: '11.5px', fontWeight: '700', cursor: 'pointer' }}>
                  Remove
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ padding: '14px', borderRadius: '10px', border: `1px solid ${border}`, background: bg }}>
        <div style={{ fontSize: '12px', fontWeight: '800', color: gray600, marginBottom: '10px' }}>Add a field</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <input value={newField.label} aria-label='Field name'
            onChange={function (e) { setNewField({ ...newField, label: e.target.value }) }}
            placeholder='Field name, for example Customer, Products discussed or Outcome'
            style={inputStyle} />
          <select value={newField.field_type} aria-label='Field type'
            onChange={function (e) { setNewField({ ...newField, field_type: e.target.value }) }}
            style={{ ...inputStyle, background: 'white', textTransform: 'capitalize' }}>
            {FIELD_TYPES.map(function (t) { return <option key={t} value={t}>{t}</option> })}
          </select>
          {newField.field_type === 'choice' && (
            <input value={newField.options} aria-label='Options'
              onChange={function (e) { setNewField({ ...newField, options: e.target.value }) }}
              placeholder='Options separated by commas, for example Sold, Follow-up or No interest'
              style={inputStyle} />
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: '9px', cursor: 'pointer' }}>
            <input type='checkbox' checked={newField.required}
              onChange={function (e) { setNewField({ ...newField, required: e.target.checked }) }} />
            <span style={{ fontSize: '12.5px', color: gray600, fontWeight: '600' }}>Required. The rep must fill this in.</span>
          </label>
          <TealBtn onClick={saveField} disabled={busy} style={{ width: '100%', padding: '12px' }}>Add Field</TealBtn>
          {message && (
            <div role={message.kind === 'error' ? 'alert' : 'status'} style={{ fontSize: '12px', color: message.kind === 'error' ? danger : tealDeep }}>
              {message.text}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog show={!!fieldToRemove} onClose={function () { setFieldToRemove(null) }} onConfirm={removeField}
        title={'Remove "' + (fieldToRemove ? fieldToRemove.label : '') + '"?'}
        consequence="This field disappears from the Log Activity form for everyone. Past records that already have a value for it keep that value, but you will not be able to see or filter by it going forward unless you add the field back."
        confirmLabel="Remove Field" />
    </div>
  )
}
