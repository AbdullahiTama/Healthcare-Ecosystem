// Full-record display for admin detail sheets: titled sections of label/value pairs, as an accessible
// description list that stacks on narrow screens. The same `sections` value feeds the single-record CSV export
// (flattenSections), so what an admin sees and what they download never drift apart.

const NOT_PROVIDED = 'Not provided'

// A value as readable text. Arrays become comma lists, booleans Yes/No, plain objects "key: value" lines,
// ISO timestamps a local date and time. Empty values are null (rendered as "Not provided").
export function formatValue(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) {
    const parts = value.map(formatValue).filter(Boolean)
    return parts.length ? parts.join(', ') : null
  }
  if (typeof value === 'object') {
    const parts = Object.entries(value).map(([k, v]) => {
      const f = formatValue(v)
      return f == null ? null : `${humanizeKey(k)}: ${f}`
    }).filter(Boolean)
    return parts.length ? parts.join('\n') : null
  }
  const s = String(value).trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const d = new Date(s)
    if (!Number.isNaN(d.getTime())) return d.toLocaleString('en-NG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  return s
}

// "requested_area" → "Requested area"
export function humanizeKey(key) {
  const s = String(key || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

// Every key of a free-form JSON answer object as fields, so application answers added later still show up.
export function fieldsFromObject(obj, { exclude = [] } = {}) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return []
  return Object.entries(obj).filter(([k]) => !exclude.includes(k)).map(([k, v]) => [humanizeKey(k), v])
}

// [[label, value]] across sections, formatted, for recordToCsv.
export function flattenSections(sections) {
  const out = []
  for (const s of sections || []) {
    for (const [label, value] of s.fields || []) out.push([s.title ? `${s.title}: ${label}` : label, formatValue(value) ?? ''])
  }
  return out
}

export default function RecordFields({ sections }) {
  const visible = (sections || []).filter(s => (s.fields || []).length > 0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {visible.map(section => (
        <section key={section.title} aria-label={section.title}>
          {section.title && <h3 style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--teal)' }}>{section.title}</h3>}
          <dl style={{ margin: 0 }}>
            {section.fields.map(([label, value]) => {
              const text = formatValue(value)
              return (
                <div key={label} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '2px 12px', padding: '8px 0', borderBottom: '1px solid var(--hairline)', fontSize: 13 }}>
                  <dt style={{ color: 'var(--muted)', fontWeight: 600, flex: '0 1 160px', minWidth: 120 }}>{label}</dt>
                  <dd style={{ margin: 0, flex: '1 1 200px', minWidth: 0, textAlign: 'right', color: text == null ? 'var(--muted)' : 'var(--fg)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontStyle: text == null ? 'italic' : 'normal' }}>
                    {text ?? NOT_PROVIDED}
                  </dd>
                </div>
              )
            })}
          </dl>
        </section>
      ))}
    </div>
  )
}
