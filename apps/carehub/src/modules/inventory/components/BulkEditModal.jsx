import { useId, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle } from 'lucide-react'
import { Modal, GhostBtn, TealBtn } from '../../../components/ui'
import { fmt } from '../../../lib/utils'
import { theme } from '../../../styles/theme'
import { EMPTY_BULK_EDIT, PRICE_MODES, CAREFIND_CHOICES, validateBulkEdit, planBulkEdit, groupBulkUpdates } from '../bulkEdit'

const { navy, gray500, gray600, border, danger, dangerBg, success, successBg, warning, warningBg, bg } = theme

const field = { width: '100%', minHeight: 40, padding: '8px 10px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 13, color: navy, background: 'white', boxSizing: 'border-box' }
const label = { display: 'block', fontSize: 11.5, fontWeight: 700, color: gray600, marginBottom: 6 }
const FIELD_NAMES = { category: 'Category', price: 'Selling price', cost_price: 'Cost price', reorder_level: 'Reorder level', shelf_label: 'Shelf', list_on_carefind: 'CareFind' }
const show = (key, v) => (key === 'price' || key === 'cost_price' ? fmt(v || 0) : key === 'list_on_carefind' ? (v ? 'Listed' : 'Hidden') : v === null || v === '' ? 'Not set' : String(v))

// Changes the same fields on every product the user marked. Each field is "leave as it is" unless filled in. Shows
// how many products will really change and a few before → after lines, then saves (runUpdates does the requests and
// returns { saved, failed }), and reports anything that failed so it can be tried again.
export default function BulkEditModal({ products, perms, categories = [], runUpdates, onClose }) {
  const uid = useId()
  const canEditPrice = !!perms?.canEditPrice
  const [changes, setChanges] = useState(EMPTY_BULK_EDIT)
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const set = (k, v) => setChanges((c) => ({ ...c, [k]: v }))
  const check = validateBulkEdit(changes, { canEditPrice })
  const plan = useMemo(() => planBulkEdit(products, changes, { canEditPrice }), [products, changes, canEditPrice])

  async function apply(groups) {
    setSaving(true); setProgress({ done: 0, total: groups.reduce((n, g) => n + g.ids.length, 0) })
    try {
      const r = await runUpdates(groups, (done, total) => setProgress({ done, total }))
      setResult(r)
    } finally { setSaving(false) }
  }

  const footer = result ? (
    <>
      {result.failed.length > 0 && <GhostBtn onClick={() => apply(result.failed.map(({ ids, updates }) => ({ ids, updates })))} disabled={saving} style={{ flex: 1, padding: 12 }}>Try the failed ones again</GhostBtn>}
      <TealBtn onClick={onClose} style={{ flex: 1, padding: 12 }}>Done</TealBtn>
    </>
  ) : (
    <>
      <GhostBtn onClick={onClose} disabled={saving} style={{ flex: 1, padding: 12 }}>Cancel</GhostBtn>
      <TealBtn onClick={() => apply(groupBulkUpdates(plan))} disabled={saving || !check.ok || plan.length === 0} aria-busy={saving || undefined} style={{ flex: 1, padding: 12 }}>
        {saving ? `Saving ${progress?.done || 0} of ${progress?.total || plan.length}…` : `Update ${plan.length} product${plan.length === 1 ? '' : 's'}`}
      </TealBtn>
    </>
  )

  const savedCount = result ? result.saved.length : 0
  const failedCount = result ? result.failed.reduce((n, f) => n + f.ids.length, 0) : 0

  return (
    <Modal show onClose={() => { if (!saving) onClose() }} title={`Edit ${products.length} product${products.length === 1 ? '' : 's'}`} footer={footer}>
      {result ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {savedCount > 0 && (
            <div role='status' style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 12, borderRadius: theme.radius.md, background: successBg, color: success, fontWeight: 700, fontSize: 13 }}>
              <CheckCircle size={16} aria-hidden='true' /> {savedCount} product{savedCount === 1 ? '' : 's'} updated.
            </div>
          )}
          {failedCount > 0 && (
            <div role='alert' style={{ padding: 12, borderRadius: theme.radius.md, background: dangerBg, color: danger, fontSize: 13 }}>
              <strong>{failedCount} could not be updated.</strong> {result.failed[0].message}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 12.5, color: gray600, padding: 10, borderRadius: theme.radius.md, background: bg }}>
            Fill in only what you want to change; empty fields stay as they are. Stock is not changed here: use Add stock or a stock count, so every change is recorded.
          </div>

          <div>
            <label htmlFor={uid + '-cat'} style={label}>Category</label>
            <input id={uid + '-cat'} list={uid + '-cats'} value={changes.category} onChange={(e) => set('category', e.target.value)} placeholder='Leave as it is' style={field} aria-invalid={!!check.errors.category} />
            <datalist id={uid + '-cats'}>{categories.map((c) => <option key={c} value={c} />)}</datalist>
            {check.errors.category && <div role='alert' style={{ color: danger, fontSize: 12, marginTop: 4 }}>{check.errors.category}</div>}
          </div>

          {['price', 'cost_price'].map((key) => (
            <fieldset key={key} style={{ border: 'none', margin: 0, padding: 0 }} disabled={!canEditPrice}>
              <legend style={{ ...label, padding: 0 }}>{FIELD_NAMES[key]}</legend>
              <div style={{ display: 'flex', gap: 8 }}>
                <select aria-label={FIELD_NAMES[key] + ': how to change it'} value={changes[key].mode} onChange={(e) => set(key, { ...changes[key], mode: e.target.value })} style={{ ...field, flex: '1 1 50%' }}>
                  <option value=''>Leave as it is</option>
                  {PRICE_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                {changes[key].mode && (
                  <input aria-label={FIELD_NAMES[key] + (changes[key].mode === 'set' ? ' (₦)' : ' (%)')} type='number' inputMode='decimal' min='0' value={changes[key].value}
                    onChange={(e) => set(key, { ...changes[key], value: e.target.value })} placeholder={changes[key].mode === 'set' ? '₦' : '%'} style={{ ...field, flex: '1 1 50%' }} aria-invalid={!!check.errors[key]} />
                )}
              </div>
              {check.errors[key] && <div role='alert' style={{ color: danger, fontSize: 12, marginTop: 4 }}>{check.errors[key]}</div>}
            </fieldset>
          ))}
          {!canEditPrice && <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: warning, background: warningBg, padding: '8px 10px', borderRadius: theme.radius.md }}><AlertTriangle size={13} aria-hidden='true' /> Only roles allowed to edit prices can change prices.</div>}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 12 }}>
            <div>
              <label htmlFor={uid + '-reorder'} style={label}>Reorder level</label>
              <input id={uid + '-reorder'} type='number' min='0' step='1' value={changes.reorder_level} onChange={(e) => set('reorder_level', e.target.value)} placeholder='Leave as it is' style={field} aria-invalid={!!check.errors.reorder_level} />
              {check.errors.reorder_level && <div role='alert' style={{ color: danger, fontSize: 12, marginTop: 4 }}>{check.errors.reorder_level}</div>}
            </div>
            <div>
              <label htmlFor={uid + '-shelf'} style={label}>Shelf</label>
              <input id={uid + '-shelf'} value={changes.shelf_label} onChange={(e) => set('shelf_label', e.target.value)} placeholder='Leave as it is' style={field} aria-invalid={!!check.errors.shelf_label} />
              {check.errors.shelf_label && <div role='alert' style={{ color: danger, fontSize: 12, marginTop: 4 }}>{check.errors.shelf_label}</div>}
            </div>
            <div>
              <label htmlFor={uid + '-cf'} style={label}>CareFind listing</label>
              <select id={uid + '-cf'} value={changes.list_on_carefind} onChange={(e) => set('list_on_carefind', e.target.value)} style={field}>
                <option value=''>Leave as it is</option>
                {CAREFIND_CHOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>

          {check.hasChanges && check.ok && (
            <div role='status' aria-live='polite' style={{ padding: 12, borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 12.5, color: gray600 }}>
              {plan.length === 0 ? 'These products already have these values; nothing would change.' : (
                <>
                  <strong style={{ color: navy }}>{plan.length} of {products.length} product{products.length === 1 ? '' : 's'} will change.</strong>
                  <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                    {plan.slice(0, 4).map((item) => (
                      <li key={item.id} style={{ marginBottom: 2 }}>
                        <strong style={{ color: navy }}>{item.name}</strong>: {Object.keys(item.updates).map((k) => `${FIELD_NAMES[k]} ${show(k, item.before[k])} → ${show(k, item.updates[k])}`).join('; ')}
                      </li>
                    ))}
                  </ul>
                  {plan.length > 4 && <div style={{ color: gray500, marginTop: 4 }}>and {plan.length - 4} more.</div>}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
