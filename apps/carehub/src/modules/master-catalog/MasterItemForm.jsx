import { useEffect, useRef, useState } from 'react'
import { useDialogKeyboardScanner } from '../../hooks/useKeyboardScanner'
import { theme } from '../../styles/theme'
import { Modal, Inp, Sel, Textarea, GhostBtn, TealBtn } from '../../components/ui'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { RX_STATUSES, DOSE_FORMS, formFromMaster, validateMasterForm } from './catalogueRules'

const { tealDeep, tealMist } = theme

// Add or edit a master item. Saving an edit changes the catalogue only; the page then offers Push to send it to the
// locations. Before carehub_20261215 (`upgraded` false) only the original fields are shown.
export default function MasterItemForm({ show, item, categories, upgraded, saving, onSave, onClose }) {
  const [form, setForm] = useState(formFromMaster(item))
  const [errors, setErrors] = useState({})
  const { isMobile } = useBreakpoint()
  const [scanNotice, setScanNotice] = useState('')
  useEffect(() => { if (show) { setForm(formFromMaster(item)); setErrors({}); setScanNotice('') } }, [show, item])

  // A USB scanner types into whichever field has focus, then presses Enter,
  // which submitted this form with the code in the price, cost or name. A scan
  // anywhere in the dialog now goes into Barcode (everything else as it was)
  // and its Enter submits nothing. Before the catalogue update there is no
  // Barcode field: the scan is undone and explained.
  const scanArea = useRef(null)
  useDialogKeyboardScanner(scanArea, {
    snapshot: () => form,
    onScan: (code, before) => {
      if (!upgraded) {
        setForm(before)
        setScanNotice('Scan ignored (' + code + '): barcodes can be added once the catalogue update is installed.')
        return
      }
      setForm({ ...before, barcode: code })
      setErrors((e) => ({ ...e, barcode: undefined }))
      setScanNotice('Scanned ' + code + ' into Barcode.')
    },
  }, { enabled: show })

  const f = (k) => (v) => setForm((p) => ({ ...p, [k]: v }))
  const grid = { display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '12px' }
  const category = categories.find((c) => c.code === form.category_code)
  const rxDefault = RX_STATUSES.find((s) => s.value === category?.rx_default)

  function submit() {
    const result = validateMasterForm(form, { categories, upgraded })
    if (result.errors) { setErrors(result.errors); return }
    onSave(result.payload)
  }

  return (
    <Modal show={show} onClose={onClose} title={item ? 'Edit catalogue item' : 'Add catalogue item'}
      footer={<><GhostBtn onClick={onClose} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
        <TealBtn onClick={submit} disabled={saving} style={{ flex: 1, padding: '12px' }}>{saving ? 'Saving…' : item ? 'Save item' : 'Add item'}</TealBtn></>}>
      <form ref={scanArea} onSubmit={(e) => { e.preventDefault(); submit() }} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div role='status' aria-live='polite' style={{ fontSize: '12px', fontWeight: 700, color: tealDeep, display: scanNotice ? 'block' : 'none' }}>{scanNotice}</div>
        {item && (
          <div role='note' style={{ padding: '12px', borderRadius: theme.radius.md, background: tealMist, fontSize: '12px', color: tealDeep }}>
            Every location's product is linked to this item, so a new name or price reaches them when you press Push. Locations with their own price keep it.
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
              options={RX_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
              placeholder={rxDefault ? `Category default (${rxDefault.label})` : 'Category default'}
              helperText='Prescription-only and controlled items will show on CareFind without a price.' />
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
