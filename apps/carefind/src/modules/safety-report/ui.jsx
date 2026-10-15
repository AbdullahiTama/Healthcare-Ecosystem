// ── Safety-report shared UI (CareFind, Phase 2) ────────────────────────────
// Plain labelled elements on the CareFind CSS-var tokens. One styling source
// for the wizard so steps stay consistent without depending on component
// library prop shapes.

export const s = {
  page: { maxWidth: 640, margin: '0 auto', padding: '16px 16px 96px' },
  card: {
    background: 'var(--panel)', border: '1px solid var(--border)',
    borderRadius: 12, padding: 16, marginBottom: 12,
  },
  h1: { fontSize: 22, fontWeight: 800, color: 'var(--fg)', margin: '4px 0 8px' },
  h2: { fontSize: 17, fontWeight: 750, color: 'var(--fg)', margin: '0 0 4px' },
  body: { fontSize: 14, lineHeight: 1.55, color: 'var(--fg)', margin: '0 0 8px' },
  muted: { fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' },
  label: { display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--fg)', margin: '12px 0 4px' },
  req: { color: 'var(--red)', fontWeight: 800 },
  input: {
    width: '100%', boxSizing: 'border-box', fontSize: 15, color: 'var(--fg)',
    background: '#fff', border: '1px solid var(--border)', borderRadius: 10,
    padding: '10px 12px', marginTop: 2,
  },
  help: { fontSize: 12.5, color: 'var(--muted)', marginTop: 3, lineHeight: 1.45 },
  error: {
    fontSize: 13, color: 'var(--red)', background: 'var(--red-bg)',
    border: '1px solid var(--red)', borderRadius: 10, padding: '8px 12px', marginTop: 8,
  },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  nav: {
    position: 'sticky', bottom: 0, display: 'flex', gap: 8, padding: '12px 16px calc(12px + env(safe-area-inset-bottom))',
    background: 'var(--bg)', borderTop: '1px solid var(--border)', margin: '16px -16px -96px',
  },
  btnPrimary: {
    flex: 1, fontSize: 15, fontWeight: 750, color: '#fff', background: 'var(--teal)',
    border: '1px solid var(--teal)', borderRadius: 10, padding: '12px', cursor: 'pointer',
  },
  btnGhost: {
    fontSize: 15, fontWeight: 650, color: 'var(--fg)', background: 'var(--panel)',
    border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', cursor: 'pointer',
  },
  progress: { display: 'flex', gap: 4, margin: '8px 0 4px' },
  banner: {
    fontSize: 13, background: 'var(--amber-bg)', border: '1px solid var(--amber)',
    borderRadius: 10, padding: '10px 12px', marginBottom: 12, color: 'var(--fg)', lineHeight: 1.5,
  },
}

export function Field({ label, required, htmlFor, help, error, children }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <label htmlFor={htmlFor} style={s.label}>
        {label} {required && <span style={s.req} aria-hidden="true">*</span>}
        {required && <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>(required)</span>}
      </label>
      {children}
      {help && <p style={s.help}>{help}</p>}
      {error && <p style={s.error} role="alert">{error}</p>}
    </div>
  )
}

export function TextInput(props) {
  return <input {...props} style={{ ...s.input, ...props.style }} />
}

export function TextArea(props) {
  return <textarea {...props} rows={props.rows || 3} style={{ ...s.input, ...props.style }} />
}

export function SelectInput({ options = [], ...props }) {
  return (
    <select {...props} style={{ ...s.input, ...props.style }}>
      <option value="">Select…</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

// Radio group with real inputs (keyboard + screen-reader operable).
export function RadioRow({ name, value, onChange, options, legend }) {
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: '8px 0 0' }}>
      {legend && <legend style={{ ...s.label, margin: '0 0 4px', padding: 0 }}>{legend}</legend>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {options.map((o) => (
          <label key={o.value} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, color: 'var(--fg)', cursor: 'pointer' }}>
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              style={{ marginTop: 3 }}
            />
            <span>
              <span style={{ fontWeight: 650 }}>{o.label}</span>
              {o.help && <span style={{ display: 'block', ...s.help, marginTop: 1 }}>{o.help}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function ProgressDots({ steps, current }) {
  const idx = steps.indexOf(current)
  return (
    <div style={s.progress} role="progressbar" aria-valuenow={idx + 1} aria-valuemin={1} aria-valuemax={steps.length} aria-label={`Step ${idx + 1} of ${steps.length}`}>
      {steps.map((st, i) => (
        <span
          key={st}
          aria-hidden="true"
          style={{
            flex: 1, height: 4, borderRadius: 2,
            background: i <= idx ? 'var(--teal)' : 'var(--hairline)',
          }}
        />
      ))}
    </div>
  )
}
