import { blankProduct } from '../useSafetyDraft.js'
import { Field, TextInput, s } from '../ui.jsx'
import CompanyPicker from '../CompanyPicker.jsx'

export default function ProductsStep({ value, onChange, searchCompanies }) {
  const list = value && value.length > 0 ? value : [{ ...blankProduct() }]

  const patch = (index, next) => {
    const copy = list.map((p, i) => (i === index ? { ...p, ...next } : p))
    onChange(copy)
  }
  const add = () => onChange([...list, { ...blankProduct() }])
  const remove = (index) => {
    if (list.length <= 1) return
    onChange(list.filter((_, i) => i !== index))
  }

  return (
    <section aria-labelledby="sr-products-h">
      <h2 id="sr-products-h" style={s.h2}>Medicine or product</h2>
      <p style={s.muted}>Which medicine or product do you suspect? Add each suspect product separately — at least one is required.</p>

      {list.map((p, i) => (
        <div key={p.product_id || `new-${i}`} style={s.card}>
          <div style={{ ...s.row, justifyContent: 'space-between' }}>
            <strong style={{ fontSize: 14 }}>Suspect product {list.length > 1 ? i + 1 : ''}</strong>
            {list.length > 1 && (
              <button type="button" onClick={() => remove(i)} style={s.btnGhost} aria-label={`Remove suspect product ${i + 1}`}>Remove</button>
            )}
          </div>

          <Field label="Product / brand name" required htmlFor={`sr-brand-${i}`}>
            <TextInput id={`sr-brand-${i}`} value={p.brandName} onChange={(e) => patch(i, { brandName: e.target.value })} maxLength={160} placeholder="As printed on the pack" autoComplete="off" />
          </Field>

          <CompanyPicker value={p.company} onChange={(company) => patch(i, { company })} searchCompanies={searchCompanies} />

          <details style={{ marginTop: 10 }}>
            <summary style={{ fontSize: 13.5, fontWeight: 700, cursor: 'pointer', color: 'var(--teal)' }}>More product details (optional)</summary>
            <Field label="Generic name" htmlFor={`sr-gen-${i}`}>
              <TextInput id={`sr-gen-${i}`} value={p.genericName} onChange={(e) => patch(i, { genericName: e.target.value })} maxLength={160} autoComplete="off" />
            </Field>
            <Field label="Manufacturer (if known)" htmlFor={`sr-mfr-${i}`}>
              <TextInput id={`sr-mfr-${i}`} value={p.manufacturer} onChange={(e) => patch(i, { manufacturer: e.target.value })} maxLength={160} autoComplete="off" />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Field label="Batch / lot number" htmlFor={`sr-batch-${i}`}>
                <TextInput id={`sr-batch-${i}`} value={p.batchLot} onChange={(e) => patch(i, { batchLot: e.target.value })} maxLength={64} autoComplete="off" />
              </Field>
              <Field label="Expiry date" htmlFor={`sr-exp-${i}`}>
                <TextInput id={`sr-exp-${i}`} type="date" value={p.expiryDate} onChange={(e) => patch(i, { expiryDate: e.target.value })} />
              </Field>
              <Field label="Dose" htmlFor={`sr-dose-${i}`}>
                <TextInput id={`sr-dose-${i}`} value={p.dose} onChange={(e) => patch(i, { dose: e.target.value })} maxLength={64} placeholder="e.g. 500mg" autoComplete="off" />
              </Field>
              <Field label="How often" htmlFor={`sr-freq-${i}`}>
                <TextInput id={`sr-freq-${i}`} value={p.frequency} onChange={(e) => patch(i, { frequency: e.target.value })} maxLength={64} placeholder="e.g. twice daily" autoComplete="off" />
              </Field>
              <Field label="Route" htmlFor={`sr-route-${i}`}>
                <TextInput id={`sr-route-${i}`} value={p.route} onChange={(e) => patch(i, { route: e.target.value })} maxLength={64} placeholder="e.g. by mouth" autoComplete="off" />
              </Field>
              <Field label="Reason for taking it" htmlFor={`sr-ind-${i}`}>
                <TextInput id={`sr-ind-${i}`} value={p.indication} onChange={(e) => patch(i, { indication: e.target.value })} maxLength={160} autoComplete="off" />
              </Field>
              <Field label="Started on" htmlFor={`sr-start-${i}`}>
                <TextInput id={`sr-start-${i}`} type="date" value={p.startDate} onChange={(e) => patch(i, { startDate: e.target.value })} max={new Date().toISOString().slice(0, 10)} />
              </Field>
              <Field label="Stopped on" htmlFor={`sr-stop-${i}`}>
                <TextInput id={`sr-stop-${i}`} type="date" value={p.stopDate} onChange={(e) => patch(i, { stopDate: e.target.value })} max={new Date().toISOString().slice(0, 10)} />
              </Field>
            </div>
          </details>
        </div>
      ))}

      <button type="button" onClick={add} style={s.btnGhost}>+ Add another suspect product</button>
    </section>
  )
}

