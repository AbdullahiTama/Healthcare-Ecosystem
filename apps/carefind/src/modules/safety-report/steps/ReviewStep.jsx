import { STEPS, STEP_LABELS } from '../constants.js'
import { s } from '../ui.jsx'

const COMPANY_SUMMARY = {
  verified: (c) => `Company: ${c.businessName || 'selected company'}`,
  unknown: () => 'Company: unknown',
  unverified_candidate: (c) => `Company (as printed): ${c.candidateName || '—'}`,
}

export default function ReviewStep({ draft, missing, onEdit, onSubmit, submitting, submitError }) {
  const { reporter, patient, products, reactions, meds } = draft

  const section = (step, title, children) => (
    <div style={s.card}>
      <div style={{ ...s.row, justifyContent: 'space-between', marginBottom: 6 }}>
        <strong style={{ fontSize: 14 }}>{title}</strong>
        <button type="button" onClick={() => onEdit(step)} style={s.btnGhost} aria-label={`Edit ${STEP_LABELS[step]}`}>Edit</button>
      </div>
      {children}
    </div>
  )

  const line = (label, value) => (
    <p key={label} style={{ ...s.muted, margin: '2px 0' }}><span style={{ fontWeight: 700, color: 'var(--fg)' }}>{label}:</span> {value || '—'}</p>
  )

  return (
    <section aria-labelledby="sr-review-h">
      <h2 id="sr-review-h" style={s.h2}>Review and submit</h2>
      <p style={s.muted}>
        Check your answers. Fields marked <span style={s.req}>*</span> are required for a valid report;
        the rest are optional. Anything missing is listed below with a direct edit link.
      </p>

      {missing.length > 0 && (
        <div style={s.error} role="alert" aria-label="Missing information">
          <strong>Still needed ({missing.length}):</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {missing.map((m, i) => (
              <li key={`${m.step}-${m.label}-${i}`}>
                {m.label} — <button type="button" onClick={() => onEdit(m.step)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--teal)', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>Edit {STEP_LABELS[m.step]}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {section(STEPS.REPORTER, 'About you', <>
        {line('Name', reporter.anonymousConfirmed ? `Withheld (via ${reporter.facilityName || 'facility'})` : reporter.name)}
        {line('Contact', [reporter.phone, reporter.email].filter(Boolean).join(' · '))}
        {line('Follow-up contact', reporter.consentFollowup === true ? 'Yes' : reporter.consentFollowup === false ? 'No' : '—')}
      </>)}

      {section(STEPS.PATIENT, 'Person affected', <>
        {line('Identifier', patient.identifier)}
        {line('Gender', patient.gender)}
        {line('Age', patient.age || patient.dob || patient.ageGroup)}
      </>)}

      {section(STEPS.PRODUCTS, `Suspect products (${products.length})`, <>
        {products.map((p, i) => (
          <p key={p.product_id || i} style={{ ...s.muted, margin: '2px 0' }}>
            <span style={{ fontWeight: 700, color: 'var(--fg)' }}>{p.brandName || 'Unnamed product'}</span>
            {' — '}{(COMPANY_SUMMARY[p.company?.kind || 'unknown'] || COMPANY_SUMMARY.unknown)(p.company || {})}
          </p>
        ))}
      </>)}

      {section(STEPS.REACTIONS, `Reactions (${reactions.length})`, <>
        {reactions.map((r, i) => (
          <p key={r.reaction_id || i} style={{ ...s.muted, margin: '2px 0' }}>
            <span style={{ fontWeight: 700, color: 'var(--fg)' }}>{r.description || 'Undescribed reaction'}</span>
            {` — ${r.severity || '—'} / ${r.outcome || '—'}`}
          </p>
        ))}
      </>)}

      {section(STEPS.ADDITIONAL, 'Additional information', <>
        {line('Other medicines', meds.length > 0 ? meds.map((m) => m.name).filter(Boolean).join(', ') : 'None added')}
        {line('Attachments', `${draft.attachments.length} photo(s)`, )}
      </>)}

      {submitError && <p style={s.error} role="alert">{submitError}</p>}

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting || missing.length > 0}
        style={{ ...s.btnPrimary, opacity: submitting || missing.length > 0 ? 0.55 : 1 }}
      >
        {submitting ? 'Submitting…' : 'Submit safety report'}
      </button>
      {missing.length > 0 && <p style={s.help}>Complete the missing items above to enable submission. Incomplete reports stay as drafts and are never treated as valid.</p>}
    </section>
  )
}

