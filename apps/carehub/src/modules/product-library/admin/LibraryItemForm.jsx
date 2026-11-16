import { useEffect, useState } from 'react'
import { theme } from '../../../styles/theme'
import { Modal, Inp, Sel, Textarea, GhostBtn, TealBtn, RedBtn } from '../../../components/ui'
import { useBreakpoint } from '../../../hooks/useBreakpoint'
import { DOSE_FORMS } from '../../master-catalog/catalogueRules'
import { RX_STATUSES, formFromLibrary, validateLibraryForm, libraryLabel } from '../libraryRules'
import LibrarySearch from '../LibrarySearch'

const { gray600, tealDeep, tealMist, danger } = theme

// Add or edit a library item (CareHub admins). For an existing item, "Merge into another item" moves its business
// links to an approved duplicate and retires it. `title` and `saveLabel` let the suggestion review reuse the form.
export default function LibraryItemForm({ show, item, categories, saving, onSave, onMerge, onClose, title, saveLabel }) {
  const [form, setForm] = useState(formFromLibrary(item))
  const [errors, setErrors] = useState({})
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeInto, setMergeInto] = useState(null)
  const { isMobile } = useBreakpoint()
  useEffect(() => { if (show) { setForm(formFromLibrary(item)); setErrors({}); setMergeOpen(false); setMergeInto(null) } }, [show, item])

  const f = (k) => (v) => setForm((p) => ({ ...p, [k]: v }))
  const grid = { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '12px' }
  const editing = !!item?.id

  function submit() {
    const r = validateLibraryForm(form, { categories })
    if (r.errors) { setErrors(r.errors); return }
    onSave(r.payload)
  }

  const footer = mergeInto
    ? <><GhostBtn onClick={() => setMergeInto(null)} style={{ flex: 1, padding: '12px' }}>Back</GhostBtn>
        <RedBtn onClick={() => onMerge(mergeInto, item)} disabled={saving} style={{ flex: 1, padding: '12px' }}>{saving ? 'Merging…' : 'Merge'}</RedBtn></>
    : <><GhostBtn onClick={onClose} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
        <TealBtn onClick={submit} disabled={saving} style={{ flex: 1, padding: '12px' }}>{saving ? 'Saving…' : saveLabel || (editing ? 'Save item' : 'Add item')}</TealBtn></>

  return (
    <Modal show={show} onClose={onClose} title={title || (editing ? 'Edit library item' : 'Add library item')} wide footer={footer}>
      {mergeInto ? (
        <div role='alertdialog' aria-label='Confirm merge' style={{ fontSize: '13px', color: gray600, lineHeight: 1.6 }}>
          <p style={{ margin: 0 }}><strong>{libraryLabel(item)}</strong> will be merged into <strong>{libraryLabel(mergeInto)}</strong>.</p>
          <p style={{ margin: '8px 0 0' }}>Businesses linked to it move to {libraryLabel(mergeInto)}, which keeps its own details and gains any barcodes and details it is missing. {libraryLabel(item)} is retired.</p>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); submit() }} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={grid}>
            <Inp id='lib-name' label='Product name' value={form.brand_name} onChange={f('brand_name')} placeholder='e.g. Amoxil' required error={errors.brand_name} />
            <Inp id='lib-strength' label='Strength' value={form.strength} onChange={f('strength')} placeholder='e.g. 500mg' helperText='Leave empty if the name already includes it.' />
            <Inp id='lib-generic' label='Generic name' value={form.generic_name} onChange={f('generic_name')} placeholder='e.g. Amoxicillin' />
            <Sel id='lib-form' label='Form' value={form.dose_form} onChange={f('dose_form')} options={DOSE_FORMS} placeholder='Choose…' />
            <Inp id='lib-pack' label='Pack size' value={form.pack_size} onChange={f('pack_size')} placeholder='e.g. 10 x 10' />
            <Inp id='lib-maker' label='Manufacturer' value={form.manufacturer} onChange={f('manufacturer')} />
            <Inp id='lib-nafdac' label='NAFDAC number' value={form.nafdac_no} onChange={f('nafdac_no')} placeholder='e.g. A4-1234' error={errors.nafdac_no} />
            <Inp id='lib-barcodes' label='Barcodes' value={form.barcodes} onChange={f('barcodes')} placeholder='Separate with commas' error={errors.barcodes} />
            <Sel id='lib-category' label='Category' value={form.category_code} onChange={f('category_code')} error={errors.category_code}
              options={categories.map((c) => ({ value: c.code, label: c.label }))} placeholder='Choose…' />
            <Sel id='lib-rx' label='Prescription status' value={form.rx_status} onChange={f('rx_status')} error={errors.rx_status}
              options={RX_STATUSES.map((s) => ({ value: s.value, label: s.label }))} placeholder='Category default'
              helperText='Linked business items can never be less strict than this. Making it stricter updates them.' />
          </div>
          <Textarea id='lib-description' label='Description' value={form.description} onChange={f('description')} placeholder='Optional' />
          {editing && onMerge && (
            <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 12 }}>
              {mergeOpen ? (
                <LibrarySearch label='Merge into which approved item?' exclude={item.id} onPick={setMergeInto} autoFocus />
              ) : (
                <GhostBtn type='button' onClick={() => setMergeOpen(true)}>This is a duplicate: merge into another item…</GhostBtn>
              )}
              {mergeOpen && <div style={{ fontSize: '12px', color: tealDeep, background: tealMist, padding: '8px 10px', borderRadius: theme.radius.md, marginTop: 8 }}>Only approved items can be kept. Approve the one to keep first if it is waiting for review.</div>}
            </div>
          )}
          {errors.form && <div role='alert' style={{ fontSize: '13px', color: danger }}>{errors.form}</div>}
        </form>
      )}
    </Modal>
  )
}
