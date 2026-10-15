import { GENDERS, AGE_GROUPS } from '../constants.js'
import { Field, TextInput, SelectInput, TextArea, s } from '../ui.jsx'

export default function PatientStep({ value, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch })
  return (
    <section aria-labelledby="sr-patient-h">
      <h2 id="sr-patient-h" style={s.h2}>About the person affected</h2>
      <p style={s.muted}>Who experienced the suspected side effect? This can be you or someone else.</p>

      <Field
        label="Patient initials or identifier"
        required
        htmlFor="sr-pat-id"
        help="Use initials or a private code (e.g. AB). Do not enter a full name — initials are enough for safety monitoring."
      >
        <TextInput id="sr-pat-id" value={value.identifier} onChange={(e) => set({ identifier: e.target.value })} maxLength={64} autoComplete="off" />
      </Field>

      <Field label="Gender" required htmlFor="sr-pat-gender">
        <SelectInput id="sr-pat-gender" value={value.gender} onChange={(e) => set({ gender: e.target.value })} options={GENDERS} />
      </Field>

      <Field label="Age (years)" htmlFor="sr-pat-age" help="Give at least one: age, date of birth, or age group. Enter 0 for a newborn.">
        <TextInput id="sr-pat-age" value={value.age} onChange={(e) => set({ age: e.target.value })} inputMode="numeric" maxLength={4} placeholder="e.g. 34" />
      </Field>

      <Field label="Date of birth" htmlFor="sr-pat-dob">
        <TextInput id="sr-pat-dob" type="date" value={value.dob} onChange={(e) => set({ dob: e.target.value })} max={new Date().toISOString().slice(0, 10)} />
      </Field>

      <Field label="Age group" htmlFor="sr-pat-agegroup">
        <SelectInput id="sr-pat-agegroup" value={value.ageGroup} onChange={(e) => set({ ageGroup: e.target.value })} options={AGE_GROUPS} />
      </Field>

      <Field label="Weight (kg, if known)" htmlFor="sr-pat-weight">
        <TextInput id="sr-pat-weight" value={value.weightKg} onChange={(e) => set({ weightKg: e.target.value })} inputMode="decimal" maxLength={7} placeholder="e.g. 68" />
      </Field>

      <Field label="Relevant medical history" htmlFor="sr-pat-history" help="Optional. Anything the reviewers should know (e.g. asthma, pregnancy).">
        <TextArea id="sr-pat-history" value={value.medicalHistory} onChange={(e) => set({ medicalHistory: e.target.value })} maxLength={2000} />
      </Field>
    </section>
  )
}

