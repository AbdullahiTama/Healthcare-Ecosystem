import { useState, useEffect } from 'react'
import { theme } from '../../styles/theme'
import { Input, Button } from '../../components/ui'

const NIGERIAN_STATES = [
  'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno',
  'Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT','Gombe','Imo',
  'Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa',
  'Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba',
  'Yobe','Zamfara'
]

const LABEL_OPTIONS = ['Home', 'Work', 'Other']

export default function AddressForm({ initialData, onSubmit, onCancel, saving }) {
  const [label, setLabel] = useState(initialData?.label || 'Home')
  const [customLabel, setCustomLabel] = useState('')
  const [street, setStreet] = useState(initialData?.street || '')
  const [city, setCity] = useState(initialData?.city || '')
  const [state, setState] = useState(initialData?.state || '')
  const [postalCode, setPostalCode] = useState(initialData?.postal_code || '')
  const [isDefault, setIsDefault] = useState(initialData?.is_default ?? false)
  const [errors, setErrors] = useState({})

  useEffect(() => {
    if (initialData) {
      setLabel(initialData.label || 'Home')
      setStreet(initialData.street || '')
      setCity(initialData.city || '')
      setState(initialData.state || '')
      setPostalCode(initialData.postal_code || '')
      setIsDefault(initialData.is_default ?? false)
      if (!LABEL_OPTIONS.includes(initialData.label)) {
        setCustomLabel(initialData.label)
        setLabel('Other')
      }
    }
  }, [initialData])

  function validate() {
    const errs = {}
    if (!street.trim()) errs.street = 'Street address is required'
    if (!city.trim()) errs.city = 'City is required'
    if (!state) errs.state = 'State is required'
    if (label === 'Other' && !customLabel.trim()) errs.customLabel = 'Please enter a label'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!validate()) return
    const finalLabel = label === 'Other' ? customLabel.trim() : label
    onSubmit({
      label: finalLabel,
      street: street.trim(),
      city: city.trim(),
      state,
      postal_code: postalCode.trim() || null,
      country: 'Nigeria',
      is_default: isDefault,
    })
  }

  const fieldGap = { display: 'flex', flexDirection: 'column', gap: 4 }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={fieldGap}>
        <label style={{ fontSize: 12, fontWeight: 700, color: theme.textMid }}>Label</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {LABEL_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setLabel(opt)}
              style={{
                padding: '8px 16px',
                borderRadius: 10,
                border: `1px solid ${label === opt ? theme.tealDeep : theme.border}`,
                background: label === opt ? theme.tealDeep : '#fff',
                color: label === opt ? '#fff' : theme.textMid,
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {opt}
            </button>
          ))}
        </div>
        {label === 'Other' && (
          <div style={{ marginTop: 4 }}>
            <Input
              label="Custom label"
              value={customLabel}
              onChange={setCustomLabel}
              placeholder="e.g., Parents' house"
              required
            />
            {errors.customLabel && <p style={{ margin: '2px 0 0 0', fontSize: 12, color: theme.danger }}>{errors.customLabel}</p>}
          </div>
        )}
      </div>

      <div>
        <Input label="Street Address *" value={street} onChange={setStreet} placeholder="123 Main Street" required />
        {errors.street && <p style={{ margin: '2px 0 0 0', fontSize: 12, color: theme.danger }}>{errors.street}</p>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <Input label="City *" value={city} onChange={setCity} placeholder="Lagos" required />
          {errors.city && <p style={{ margin: '2px 0 0 0', fontSize: 12, color: theme.danger }}>{errors.city}</p>}
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 700, color: theme.textMid, display: 'block', marginBottom: 4 }}>State *</label>
          <select
            value={state}
            onChange={(e) => setState(e.target.value)}
            required
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 10,
              border: `1px solid ${state && errors.state ? theme.danger : theme.border}`,
              background: '#fff',
              fontSize: 13,
              fontFamily: 'inherit',
              color: theme.textDark,
            }}
          >
            <option value="">Select state</option>
            {NIGERIAN_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {errors.state && <p style={{ margin: '2px 0 0 0', fontSize: 12, color: theme.danger }}>{errors.state}</p>}
        </div>
      </div>

      <Input label="Postal Code" value={postalCode} onChange={setPostalCode} placeholder="Optional" />

      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
          style={{ width: 18, height: 18 }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, color: theme.textMid }}>Set as default address</span>
      </label>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
        <Button variant="ghost" onClick={onCancel} type="button">Cancel</Button>
        <Button variant="primary" type="submit" disabled={saving}>
          {saving ? 'Saving...' : initialData ? 'Update Address' : 'Save Address'}
        </Button>
      </div>
    </form>
  )
}
