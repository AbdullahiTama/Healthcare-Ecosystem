import { SERIOUSNESS_QUESTIONS, SEVERITIES, OUTCOMES } from '../constants.js'
import { blankReaction } from '../useSafetyDraft.js'
import { Field, TextInput, TextArea, SelectInput, RadioRow, s } from '../ui.jsx'

const TERNARY = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'not_sure', label: 'Not sure' },
]

export default function ReactionsStep({ value, onChange }) {
  const list = value && value.length > 0 ? value : [{ ...blankReaction() }]

  const patch = (index, next) => {
    onChange(list.map((r, i) => (i === index ? { ...r, ...next } : r)))
  }
  const patchSeriousness = (index, key, answer) => {
    patch(index, { seriousness: { ...list[index].seriousness, [key]: answer } })
  }
  const add = () => onChange([...list, { ...blankReaction() }])
  const remove = (index) => {
    if (list.length <= 1) return
    onChange(list.filter((_, i) => i !== index))
  }

  return (
    <section aria-labelledby="sr-reactions-h">
      <h2 id="sr-reactions-h" style={s.h2}>What happened</h2>
      <p style={s.muted}>Describe the suspected side effect. Answer each question as best you can. “Not sure” is a valid answer and is never treated as “No”.</p>

      {list.map((r, i) => (
        <div key={r.reaction_id || `new-${i}`} style={s.card}>
          <div style={{ ...s.row, justifyContent: 'space-between' }}>
            <strong style={{ fontSize: 14 }}>Reaction {list.length > 1 ? i + 1 : ''}</strong>
            {list.length > 1 && (
              <button type="button" onClick={() => remove(i)} style={s.btnGhost} aria-label={`Remove reaction ${i + 1}`}>Remove</button>
            )}
          </div>

          <Field label="Describe the reaction" required htmlFor={`sr-desc-${i}`} help="What happened, in your own words.">
            <TextArea id={`sr-desc-${i}`} value={r.description} onChange={(e) => patch(i, { description: e.target.value })} maxLength={2000} />
          </Field>

          <Field label="How severe was it?" required htmlFor={`sr-sev-${i}`}>
            <SelectInput id={`sr-sev-${i}`} value={r.severity} onChange={(e) => patch(i, { severity: e.target.value })} options={SEVERITIES} />
          </Field>

          <Field label="What was the outcome?" required htmlFor={`sr-out-${i}`}>
            <SelectInput id={`sr-out-${i}`} value={r.outcome} onChange={(e) => patch(i, { outcome: e.target.value })} options={OUTCOMES} />
          </Field>

          <fieldset style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, margin: '12px 0 0' }}>
            <legend style={{ fontSize: 13, fontWeight: 800, padding: '0 6px' }}>Seriousness. Please answer all six.</legend>
            {SERIOUSNESS_QUESTIONS.map((q) => (
              <RadioRow
                key={q.key}
                name={`sr-ser-${i}-${q.key}`}
                legend={q.label}
                value={r.seriousness[q.key] || ''}
                onChange={(v) => patchSeriousness(i, q.key, v)}
                options={TERNARY}
              />
            ))}
            <p style={s.help}>Not sure about birth defects? Choose “Not sure”. It is recorded as unknown, never as “No”.</p>
          </fieldset>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
            <Field label="When it started" htmlFor={`sr-onset-${i}`}>
              <TextInput id={`sr-onset-${i}`} type="date" value={r.onsetDate} onChange={(e) => patch(i, { onsetDate: e.target.value })} max={new Date().toISOString().slice(0, 10)} />
            </Field>
            <Field label="How long it lasted" htmlFor={`sr-dur-${i}`}>
              <TextInput id={`sr-dur-${i}`} value={r.duration} onChange={(e) => patch(i, { duration: e.target.value })} maxLength={64} placeholder="e.g. 3 days" autoComplete="off" />
            </Field>
          </div>
        </div>
      ))}

      <button type="button" onClick={add} style={s.btnGhost}>+ Add another reaction</button>
    </section>
  )
}

