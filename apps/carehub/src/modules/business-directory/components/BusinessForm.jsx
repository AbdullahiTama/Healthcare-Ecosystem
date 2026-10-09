import { useMemo, useState } from 'react'
import { Modal, Inp, Sel, Textarea, TealBtn, GhostBtn } from '../../../components/ui'
import { theme } from '../../../styles/theme'
import { validateRow } from '../services/importService'
import { NIGERIA_STATES } from '../services/constants'
import { geocodePlace } from '../services/geocoding'
import { DUP_STATUS } from '../services/deduplication'

const { danger, gray500, warning, warningBg, border } = theme

const BLANK = {
  name: '', category_id: '', subcategory_id: '', business_type: '', address: '', state: '', lga: '', city: '',
  latitude: '', longitude: '', phone: '', email: '', website: '', contact_person: '', opening_hours: '', description: '',
  territory_id: '', demo: false,
}

function fromRecord(r) {
  if (!r) return BLANK
  const o = { ...BLANK }
  Object.keys(BLANK).forEach((k) => { if (r[k] !== null && r[k] !== undefined) o[k] = String(r[k]) })
  o.demo = r.data_source === 'demo'
  return o
}

/**
 * Add / edit one business. Validation is the importer's `validateRow` — a
 * record entered by hand obeys exactly the rules a spreadsheet row does.
 *
 * `checkDuplicate(record, ignoreId)` returns {status, match, reasons}; when it
 * reports anything but "new" the admin must confirm before saving.
 */
export default function BusinessForm({ show, initial, categories, subcategories, territories = [], onClose, onSave, checkDuplicate }) {
  const [f, setF] = useState(() => fromRecord(initial))
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [dup, setDup] = useState(null)
  const [geoBusy, setGeoBusy] = useState(false)
  const [geoMsg, setGeoMsg] = useState('')
  const editing = !!initial?.id
  const set = (k) => (v) => { setF((p) => ({ ...p, [k]: v, ...(k === 'category_id' ? { subcategory_id: '' } : {}) })); setDup(null) }

  const subs = useMemo(() => subcategories.filter((s) => s.category_id === f.category_id), [subcategories, f.category_id])
  const stateOptions = useMemo(() => (f.state && !NIGERIA_STATES.includes(f.state) ? [f.state, ...NIGERIA_STATES] : NIGERIA_STATES), [f.state])
  const category = categories.find((c) => c.id === f.category_id)
  const subcategory = subs.find((s) => s.id === f.subcategory_id)

  function build() {
    const v = validateRow({
      name: f.name, category: category?.name || '', subcategory: subcategory?.name || '', business_type: f.business_type,
      address: f.address, state: f.state, lga: f.lga, city: f.city, latitude: f.latitude, longitude: f.longitude,
      phone: f.phone, email: f.email, website: f.website, contact_person: f.contact_person,
      opening_hours: f.opening_hours, description: f.description,
    }, { categories, subcategories })
    const record = { ...v.record, data_source: f.demo ? 'demo' : (initial?.data_source && initial.data_source !== 'demo' ? initial.data_source : 'manual'), territory_id: f.territory_id || null }
    return { ...v, record }
  }

  async function useMyLocation() {
    if (!navigator.geolocation) { setGeoMsg('This browser cannot give a location.'); return }
    setGeoBusy(true); setGeoMsg('')
    navigator.geolocation.getCurrentPosition(
      (pos) => { setF((p) => ({ ...p, latitude: pos.coords.latitude.toFixed(6), longitude: pos.coords.longitude.toFixed(6) })); setGeoBusy(false); setGeoMsg('Location captured from this device — only use this if you are at the business.') },
      () => { setGeoBusy(false); setGeoMsg('Could not get your location. Check the browser permission.') },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  async function lookUpAddress() {
    const q = [f.address, f.city, f.lga, f.state, 'Nigeria'].filter(Boolean).join(', ')
    if (!f.address.trim()) { setGeoMsg('Enter an address first.'); return }
    setGeoBusy(true); setGeoMsg('')
    try {
      const hit = await geocodePlace(q)
      if (hit) { setF((p) => ({ ...p, latitude: hit.lat.toFixed(6), longitude: hit.lng.toFixed(6) })); setGeoMsg('Coordinates found from the address — please check the pin is right: ' + hit.label) }
      else setGeoMsg('No coordinates found for that address. Enter them manually or leave them blank.')
    } catch (e) { setGeoMsg('Location lookup is unavailable right now: ' + e.message) }
    setGeoBusy(false)
  }

  async function submit(force) {
    const v = build()
    const map = {}
    v.errors.forEach((e) => { map[e.field] = e.message })
    setErrors(map)
    if (v.errors.length) return
    if (!force && checkDuplicate) {
      const d = checkDuplicate(v.record, initial?.id)
      if (d && d.status !== DUP_STATUS.NEW) { setDup(d); return }
    }
    setSaving(true)
    try {
      await onSave(v.record, v.pendingSubcategory)
    } catch (e) {
      setErrors({ _form: e.message })
    }
    setSaving(false)
  }

  const E = (k) => errors[k]
  return (
    <Modal show={show} onClose={onClose} wide title={editing ? 'Edit business' : 'Add business'}
      footer={<>
        <GhostBtn onClick={onClose}>Cancel</GhostBtn>
        <TealBtn onClick={() => submit(!!dup)} disabled={saving}>{saving ? 'Saving…' : dup ? 'Save anyway' : editing ? 'Save changes' : 'Add business'}</TealBtn>
      </>}>
      {E('_form') && <div role='alert' style={{ color: danger, fontSize: 13, marginBottom: 10 }}>{E('_form')}</div>}
      {dup && (
        <div role='alert' style={{ padding: '10px 12px', borderRadius: 10, background: warningBg, border: `1px solid ${warning}`, marginBottom: 12, fontSize: 13, color: warning }}>
          <strong>{dup.status === DUP_STATUS.CONFIRMED ? 'This looks like a duplicate' : 'Possible duplicate'}:</strong> “{dup.match?.name}” ({dup.reasons.join(', ')}).
          Review it before saving a second copy.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <Inp label='Business name' required value={f.name} onChange={set('name')} error={E('name')} id='bf-name' />
        <Sel label='Category' required value={f.category_id} onChange={set('category_id')} options={categories.map((c) => ({ value: c.id, label: c.name }))} error={E('category')} id='bf-category' />
        <Sel label='Subcategory' value={f.subcategory_id} onChange={set('subcategory_id')} options={subs.map((s) => ({ value: s.id, label: s.name }))} placeholder={f.category_id ? 'None' : 'Pick a category first'} id='bf-sub' />
        <Inp label='Business type' value={f.business_type} onChange={set('business_type')} placeholder='e.g. Private, Public, Chain' id='bf-type' />
        <Inp label='Address' required value={f.address} onChange={set('address')} error={E('address')} id='bf-address' />
        <Sel label='State' required value={f.state} onChange={set('state')} options={stateOptions} error={E('state')} id='bf-state' />
        <Inp label='LGA' value={f.lga} onChange={set('lga')} id='bf-lga' />
        <Inp label='City/Town' value={f.city} onChange={set('city')} id='bf-city' />
        <Inp label='Latitude' value={f.latitude} onChange={set('latitude')} error={E('latitude')} placeholder='6.5244' inputMode='decimal' id='bf-lat' />
        <Inp label='Longitude' value={f.longitude} onChange={set('longitude')} error={E('longitude')} placeholder='3.3792' inputMode='decimal' id='bf-lng' />
        <Inp label='Phone number' value={f.phone} onChange={set('phone')} error={E('phone')} inputMode='tel' id='bf-phone' />
        <Inp label='Email' value={f.email} onChange={set('email')} error={E('email')} type='email' id='bf-email' />
        <Inp label='Website' value={f.website} onChange={set('website')} error={E('website')} placeholder='https://' id='bf-web' />
        <Inp label='Contact person' value={f.contact_person} onChange={set('contact_person')} id='bf-contact' />
        <Inp label='Opening hours' value={f.opening_hours} onChange={set('opening_hours')} placeholder='Mon–Sat 8am–8pm' id='bf-hours' />
        {territories.length > 0 && (
          <Sel label='Territory' value={f.territory_id} onChange={set('territory_id')} options={territories.map((t) => ({ value: t.id, label: t.name }))} placeholder='None' id='bf-territory' />
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '10px 0' }}>
        <GhostBtn onClick={lookUpAddress} disabled={geoBusy}>Find coordinates from address</GhostBtn>
        <GhostBtn onClick={useMyLocation} disabled={geoBusy}>Use my current location</GhostBtn>
        {geoMsg && <span role='status' style={{ fontSize: 12, color: gray500 }}>{geoMsg}</span>}
      </div>
      <Textarea label='Description' value={f.description} onChange={set('description')} id='bf-desc' />
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${border}` }}>
        <input type='checkbox' checked={f.demo} onChange={(e) => set('demo')(e.target.checked)} style={{ accentColor: theme.tealDeep }} />
        This is demo / test data (it will be labelled “DEMO DATA” everywhere)
      </label>
    </Modal>
  )
}
