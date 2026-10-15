import { QUALIFICATIONS } from '../constants.js'
import { Field, TextInput, SelectInput, RadioRow, s } from '../ui.jsx'

export default function ReporterStep({ value, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch })
  return (
    <section aria-labelledby="sr-reporter-h">
      <h2 id="sr-reporter-h" style={s.h2}>About you (the reporter)</h2>
      <p style={s.muted}>We need a way to reach you if safety reviewers have follow-up questions. Your contact details stay confidential.</p>

      <Field label="Your name" required htmlFor="sr-rep-name" help="If you cannot give your name, use the facility option below.">
        <TextInput id="sr-rep-name" value={value.name} onChange={(e) => set({ name: e.target.value })} autoComplete="name" maxLength={120} />
      </Field>

      <Field label="You are reporting as" required htmlFor="sr-rep-qual">
        <SelectInput id="sr-rep-qual" value={value.qualification} onChange={(e) => set({ qualification: e.target.value })} options={QUALIFICATIONS} />
      </Field>

      <Field label="Phone number" htmlFor="sr-rep-phone" help="At least one contact route is required: phone or email.">
        <TextInput id="sr-rep-phone" value={value.phone} onChange={(e) => set({ phone: e.target.value })} inputMode="tel" autoComplete="tel" maxLength={32} placeholder="e.g. 0803 123 4567" />
      </Field>

      <Field label="Email address" htmlFor="sr-rep-email">
        <TextInput id="sr-rep-email" value={value.email} onChange={(e) => set({ email: e.target.value })} inputMode="email" autoComplete="email" maxLength={160} placeholder="you@example.com" />
      </Field>

      <RadioRow
        name="sr-consent"
        legend="May safety reviewers contact you for follow-up?"
        value={value.consentFollowup === true ? 'yes' : value.consentFollowup === false ? 'no' : ''}
        onChange={(v) => set({ consentFollowup: v === 'yes' })}
        options={[
          { value: 'yes', label: 'Yes, you may contact me' },
          { value: 'no', label: 'No, do not contact me' },
        ]}
      />

      <div style={{ marginTop: 12 }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={value.anonymousConfirmed}
            onChange={(e) => set({ anonymousConfirmed: e.target.checked })}
            style={{ marginTop: 3 }}
          />
          <span>I am reporting through a health facility and do not wish to give my name.</span>
        </label>
        {value.anonymousConfirmed && (
          <Field label="Facility name" required htmlFor="sr-facility" help="The hospital, clinic or pharmacy submitting on your behalf. Their contact above is used for follow-up.">
            <TextInput id="sr-facility" value={value.facilityName} onChange={(e) => set({ facilityName: e.target.value })} maxLength={160} />
          </Field>
        )}
      </div>
    </section>
  )
}

