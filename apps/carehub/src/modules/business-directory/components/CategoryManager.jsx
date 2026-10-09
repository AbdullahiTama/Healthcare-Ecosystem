import { useState } from 'react'
import { Card, Inp, Sel, TealBtn, GhostBtn, Pill } from '../../../components/ui'
import { theme } from '../../../styles/theme'

const { navy, gray500, border } = theme
const KINDS = [{ value: 'facility', label: 'Facility' }, { value: 'supplier', label: 'Supplier / company' }, { value: 'other', label: 'Other' }]

/**
 * Category and subcategory administration. Built-in categories are shared by
 * every business and read-only here; a business adds its own and may
 * deactivate them (deactivated categories stay on existing records).
 */
export default function CategoryManager({ businessId, repo, categories, subcategories, canManage, onChanged, showToast }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState('facility')
  const [subFor, setSubFor] = useState(null)
  const [subName, setSubName] = useState('')
  const [busy, setBusy] = useState(false)

  async function run(fn, ok) {
    setBusy(true)
    try { await fn(); showToast(ok, { type: 'success' }); await onChanged() } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusy(false)
  }

  const subsOf = (id) => subcategories.filter((s) => s.category_id === id)

  return (
    <div>
      {canManage && (
        <Card style={{ padding: 14, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: navy, marginBottom: 8 }}>Add a category</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Inp label='Category name' value={name} onChange={setName} style={{ flex: '1 1 220px' }} id='cm-name' />
            <Sel label='Type' value={kind} onChange={setKind} options={KINDS} style={{ width: 200 }} id='cm-kind' placeholder='Type' />
            <TealBtn disabled={busy || !name.trim()} onClick={() => run(async () => { await repo.addCategory(businessId, { name, kind }); setName('') }, 'Category added')}>Add</TealBtn>
          </div>
        </Card>
      )}
      <Card style={{ padding: 0 }}>
        {categories.map((c) => {
          const own = c.business_id === businessId
          return (
            <div key={c.id} style={{ padding: '10px 14px', borderTop: `1px solid ${border}` }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, color: navy, fontSize: 13 }}>{c.name}</span>
                <Pill label={own ? 'Custom' : 'Built-in'} type={own ? 'teal' : 'gray'} />
                <span style={{ fontSize: 11.5, color: gray500 }}>{subsOf(c.id).length} subcategor{subsOf(c.id).length === 1 ? 'y' : 'ies'}</span>
                {canManage && (
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <GhostBtn onClick={() => setSubFor(subFor === c.id ? null : c.id)}>Subcategories</GhostBtn>
                    {own && <GhostBtn disabled={busy} onClick={() => run(() => repo.updateCategory(c.id, businessId, { is_active: false }), 'Category deactivated')}>Deactivate</GhostBtn>}
                  </span>
                )}
              </div>
              {subFor === c.id && (
                <div style={{ marginTop: 8, paddingLeft: 12 }}>
                  {subsOf(c.id).map((s) => (
                    <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, padding: '3px 0' }}>
                      <span>{s.name}</span>
                      {s.business_id === businessId && <GhostBtn disabled={busy} onClick={() => run(() => repo.updateSubcategory(s.id, businessId, { is_active: false }), 'Subcategory removed')}>Remove</GhostBtn>}
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 6 }}>
                    <Inp label='New subcategory' value={subName} onChange={setSubName} style={{ flex: 1 }} id={'cm-sub-' + c.id} />
                    <TealBtn disabled={busy || !subName.trim()} onClick={() => run(async () => { await repo.addSubcategory(businessId, c.id, subName); setSubName('') }, 'Subcategory added')}>Add</TealBtn>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </Card>
    </div>
  )
}
