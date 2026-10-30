import { useEffect, useState } from 'react'
import { theme } from '../../styles/theme'
import { BadgeCheck } from 'lucide-react'
import { Modal, Inp, Sel, Textarea, GhostBtn, TealBtn } from '../../components/ui'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { RX_STATUSES, DOSE_FORMS, formFromMaster, validateMasterForm, rxOptionsFor, applyLibraryToForm } from './catalogueRules'
import LibrarySearch from '../product-library/LibrarySearch'
import { libraryLabel } from '../product-library/libraryRules'

const { tealDeep, tealMist } = theme

// Add or edit a master item. Saving an edit changes the catalogue only; the page then offers Push to send it to the
// locations. Before carehub_20261215 (`upgraded` false) only the original fields are shown. With the CareHub library
// (`libraryAvailable`), a new item can start from a library item: its details fill the form and the item is linked.
// A linked item cannot be less strict than the library's prescription status.
export default function MasterItemForm({ show, item, categories, upgraded, libraryAvailable = false, saving, onSave, onClose }) {
  const [form, setForm] = useState(formFromMaster(item))
  const [errors, setErrors] = useState({})
  const [lib, setLib] = useState(item?.library || null)
  const { isMobile } = useBreakpoint()
  useEffect(() => { if (show) { setForm(formFromMaster(item)); setErrors({}); setLib(item?.library || null) } }, [show, item])

  const f = (k) => (v) => setForm((p) => ({ ...p, [k]: v }))
  const grid = { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '12px' }
  const category = categories.find((c) => c.code === form.category_code)
  const rxDefault = RX_STATUSES.find((s) => s.value === category?.rx_default)

  function submit() {
    const result = validateMasterForm(form, { categories, upgraded })
    if (result.errors) { setErrors(result.errors); return }
    onSave(!item && lib ? { ...result.payload, catalog_item_id: lib.id } : result.payload)
  }

  const pickFromLibrary = (picked) => { setLib(picked); setForm((p) => applyLibraryToForm(p, picked)) }
  const rxChoices = rxOptionsFor(lib?.rx_status)

  return (
    <Modal show={show} onClose={onClose} title={item ? 'Edit catalogue item' : 'Add catalogue item'}
      footer={<><GhostBtn onClick={onClose} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
        <TealBtn onClick={submit} disabled={saving} style={{ flex: 1, padding: '12px' }}>{saving ? 'Saving…' : item ? 'Save item' : 'Add item'}</TealBtn></>}>
      <form onSubmit={(e) => { e.preventDefault(); submit() }} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {item && (
          <div role='note' style={{ padding: '12px', borderRadius: theme.radius.md, background: tealMist, fontSize: '12px', color: tealDeep }}>
            Every location's product is linked to this item, so a new name or price reaches them when you press Push. Locations with their own price keep it.
          </div>
        )}
        {upgraded && libraryAvailable && !item && !lib && (
          <LibrarySearch label='Start from the CareHub library (optional)' onPick={pickFromLibrary} />
        )}
        {lib && (
          <div role='note' style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 12px', borderRadius: theme.radius.md, background: tealMist, fontSize: '12.5px', color: tealDeep }}>
            <BadgeCheck size={16} aria-hidden='true' />
            <span style={{ flex: 1 }}>Linked to the CareHub library: <strong>{libraryLabel(lib)}</strong></span>
            {!item && <GhostBtn type='button' onClick={() => setLib(null)}>Don’t link</GhostBtn>}
          </div>
        )}
        <Inp id='mc-name' label='Product name' value={form.name} onChange={f('name')} placeholder='e.g. Amoxil 500mg capsules' required error={errors.name} />
        {upgraded && (
          <>
            <div style={grid}>
              <Inp id='mc-generic' label='Generic name' value={form.generic_name} onChange={f('generic_name')} placeholder='e.g. Amoxicillin' />
              <Inp id='mc-strength' label='Strength' value={form.strength} onChange={f('strength')} placeholder='e.g. 500mg' />
              <Sel id='mc-form' label='Form' value={form.dose_form} onChange={f('dose_form')} options={DOSE_FORMS} placeholder='Choose…' />
              <Inp id='mc-pack' label='Pack size' value={form.pack_size} onChange={f('pack_size')} placeholder='e.g. 10 x 10' />
            </div>
            <Inp id='mc-barcode' label='Barcode' value={form.barcode} onChange={f('barcode')} placeholder='Scan or type' error={errors.barcode} inputMode='numeric' />
          </>
        )}
        <div style={grid}>
          <Sel id='mc-category' label='Category' value={form.category_code} onChange={f('category_code')} error={errors.category_code}
            options={categories.map((c) => ({ value: c.code, label: c.label }))} placeholder={categories.length ? 'Choose…' : 'Available after the update'} disabled={!categories.length} />
          {upgraded && (
            <Sel id='mc-rx' label='Prescription status' value={form.rx_status} onChange={f('rx_status')} error={errors.rx_status}
              options={rxChoices.map((s) => ({ value: s.value, label: s.label }))}
              placeholder={lib ? `Library (${RX_STATUSES.find((s) => s.value === lib.rx_status)?.label || 'set by the library'})` : rxDefault ? `Category default (${rxDefault.label})` : 'Category default'}
              helperText={lib && rxChoices.length < RX_STATUSES.length
                ? 'The CareHub library sets the least strict status this item can have.'
                : 'Prescription-only and controlled items will show on CareFind without a price.'} />
          )}
        </div>
        <div style={grid}>
          <Inp id='mc-price' label='Default selling price (₦)' type='number' min='0' value={form.default_price} onChange={f('default_price')} placeholder='0' required error={errors.default_price} />
          {upgraded && <Inp id='mc-cost' label='Default cost (₦)' type='number' min='0' value={form.default_cost} onChange={f('default_cost')} placeholder='0' error={errors.default_cost} />}
        </div>
        {upgraded && <Inp id='mc-reorder' label='Reorder level' type='number' min='0' value={form.reorder_level} onChange={f('reorder_level')} error={errors.reorder_level} helperText='New locations start with this low-stock level.' />}
        <Textarea label='Description' value={form.description} onChange={f('description')} placeholder='Optional' />
      </form>
    </Modal>
  )
}
