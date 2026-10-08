import { theme } from '../../theme'

// Unified form primitives (Stage 3 / 3.2). Validation is on blur/submit, never
// on keystroke (UX_PATTERNS.md → Validation). `error` renders an adjacent,
// specific message and marks the field aria-invalid; required indicators are
// programmatic, not color-only (ACCESSIBILITY.md).
//
// Field composition:
//   <Input label="Email" value onChange error helperText />
//   <Select label="Role" options={[{ value, label }]} />
//   <Textarea label="Notes" rows={4} />
//   <Toggle label="Notify" desc="..." value onChange />
// `Label` / `HelperText` / `ErrorMessage` are exported for custom compositions.

export function Label({ htmlFor, required, children }) {
  return (
    <label htmlFor={htmlFor} style={{ display: 'block', fontSize: 11, fontWeight: 700, color: theme.gray600, marginBottom: 6 }}>
      {children}{required && <span style={{ color: theme.danger }} aria-hidden="true"> *</span>}
    </label>
  )
}

export function HelperText({ id, children }) {
  return <div id={id} style={{ fontSize: 11, color: theme.gray500, marginTop: 4 }}>{children}</div>
}

export function ErrorMessage({ id, children }) {
  return <div id={id} style={{ fontSize: 11, color: theme.danger, marginTop: 4 }}>{children}</div>
}

const fieldBase = {
  width: '100%',
  minHeight: 44,
  padding: '9px 12px',
  borderRadius: theme.radius.md,
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: theme.fontFamily,
  transition: `border-color ${theme.motion.fast} ${theme.motion.easeOut}, box-shadow ${theme.motion.fast} ${theme.motion.easeOut}`,
}

function describedBy(id, error, helperText) {
  if (error) return `${id}-error`
  if (helperText) return `${id}-help`
  return undefined
}

// ── INPUT ─────────────────────────────────────────────────────────────────────
// `fill` lets a caller swap the field background (CareHub's auth screens sit
// cream fields inside a white card); defaults to white, gray50 when readOnly.
export function Input({ label, value, onChange, onBlur, type = 'text', placeholder = '', required, style = {}, readOnly, min, error, id, fill, helperText, ...rest }) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <div style={style}>
      {label && <Label htmlFor={inputId} required={required}>{label}</Label>}
      <input id={inputId} type={type} value={value || ''} onChange={e => onChange && onChange(e.target.value)} onBlur={onBlur} placeholder={placeholder} readOnly={readOnly} min={min} {...rest}
        required={required} aria-invalid={!!error} aria-describedby={describedBy(inputId, error, helperText)}
        style={{ ...fieldBase, border: `1px solid ${error ? theme.danger : theme.gray200}`, background: readOnly ? theme.gray50 : (fill || 'white') }} />
      {error && <ErrorMessage id={`${inputId}-error`}>{error}</ErrorMessage>}
      {!error && helperText && <HelperText id={`${inputId}-help`}>{helperText}</HelperText>}
    </div>
  )
}

// ── SELECT ────────────────────────────────────────────────────────────────────
// `options` accepts a flat string array or `{ value, label }` objects; an
// empty-value placeholder option is always first.
export function Select({ label, value, onChange, options = [], required, style = {}, error, id, placeholder = 'Select...', fill, helperText, ...rest }) {
  const selectId = id || label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <div style={style}>
      {label && <Label htmlFor={selectId} required={required}>{label}</Label>}
      <select id={selectId} value={value || ''} onChange={e => onChange && onChange(e.target.value)} required={required} {...rest}
        aria-invalid={!!error} aria-describedby={describedBy(selectId, error, helperText)}
        style={{ ...fieldBase, border: `1px solid ${error ? theme.danger : theme.gray200}`, background: fill || 'white', color: value ? theme.navy : theme.textLight }}>
        <option value=''>{placeholder}</option>
        {options.map(o => typeof o === 'string' ? <option key={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && <ErrorMessage id={`${selectId}-error`}>{error}</ErrorMessage>}
      {!error && helperText && <HelperText id={`${selectId}-help`}>{helperText}</HelperText>}
    </div>
  )
}

// ── TEXTAREA ──────────────────────────────────────────────────────────────────
export function Textarea({ label, value, onChange, rows = 3, placeholder = '', id, error, required, helperText, ...rest }) {
  const areaId = id || label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <div>
      {label && <Label htmlFor={areaId} required={required}>{label}</Label>}
      <textarea id={areaId} value={value || ''} onChange={e => onChange && onChange(e.target.value)} rows={rows} placeholder={placeholder} required={required} aria-invalid={!!error} aria-describedby={describedBy(areaId, error, helperText)} {...rest}
        style={{ ...fieldBase, resize: 'vertical', border: `1px solid ${error ? theme.danger : theme.gray200}` }} />
      {error && <ErrorMessage id={`${areaId}-error`}>{error}</ErrorMessage>}
      {!error && helperText && <HelperText id={`${areaId}-help`}>{helperText}</HelperText>}
    </div>
  )
}

// ── TOGGLE ────────────────────────────────────────────────────────────────────
// A real switch control (role=switch) in a settings-row layout, not a checkbox
// restyled — every touch target here is 44px (ACCESSIBILITY.md).
export function Toggle({ label, desc, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: `1px solid ${theme.gray100}` }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: theme.textDark }}>{label}</div>
        {desc && <div style={{ fontSize: 11, color: theme.textLight, marginTop: 2 }}>{desc}</div>}
      </div>
      <button role="switch" aria-checked={!!value} aria-label={label} onClick={() => onChange(!value)}
        style={{ width: 44, height: 24, borderRadius: theme.radius.full, border: 'none', cursor: 'pointer', position: 'relative', background: value ? theme.tealDeep : theme.gray200, flexShrink: 0, transition: `background ${theme.motion.fast}` }}>
        <div style={{ position: 'absolute', top: 2, left: value ? 22 : 2, width: 20, height: 20, borderRadius: theme.radius.full, background: 'white', transition: `left ${theme.motion.fast}`, boxShadow: theme.elevation[1] }} />
      </button>
    </div>
  )
}