import { useState, useEffect } from 'react'
import { Plus } from 'lucide-react'
import { warehouseRepository } from './repositories'
// Cross-aggregate read: a location has a manager, who is staff.
import { staffRepository } from '../staff/repositories'
import { theme } from '../../styles/theme'
import { Card, Inp, TealBtn, GhostBtn, Modal, useToast, Toast, ConfirmDialog, Loading } from '../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, border, danger, dangerBg } = theme
const TYPE_SUGGESTIONS = ['Headquarters', 'Warehouse', 'Regional Office', 'Branch', 'Distribution Hub']

export default function Warehouses({ brand }) {
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const [locations, setLocations] = useState([])
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({})
  const [locationToDelete, setLocationToDelete] = useState(null)

  useEffect(() => { load() }, [brand?.id])

  async function load() {
    if (!brand?.id) return
    setLoading(true)
    try {
      const [locs, stf] = await Promise.all([warehouseRepository.getAll(brand.id), staffRepository.getAll(brand.id)])
      setLocations(locs || [])
      setStaff(stf || [])
    } catch (e) {
      showToast('Failed to load: ' + e.message, { type: 'error' })
    }
    setLoading(false)
  }

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const openNew = () => {
    setForm({})
    setEditingId(null)
    setShowForm(true)
  }

  const openEdit = (loc) => {
    setForm({
      name: loc.name,
      location_type: loc.location_type,
      country: loc.country || '',
      state: loc.state || '',
      address: loc.address || '',
      parent_location_id: loc.parent_location_id || '',
      manager_staff_id: loc.manager_staff_id || '',
      notes: loc.notes || '',
    })
    setEditingId(loc.id)
    setShowForm(true)
  }

  const save = async () => {
    if (!form.name || !form.location_type) {
      showToast('Please enter a name and a location type.', { type: 'warning' })
      return
    }
    // business_id is stamped by the repository, not assembled here.
    const payload = {
      name: form.name,
      location_type: form.location_type,
      country: form.country || null,
      state: form.state || null,
      address: form.address || null,
      parent_location_id: form.parent_location_id || null,
      manager_staff_id: form.manager_staff_id || null,
      notes: form.notes || null,
    }
    try {
      if (editingId) {
        await warehouseRepository.update(editingId, brand.id, payload)
        showToast('Location updated', { type: 'success' })
      } else {
        await warehouseRepository.create(brand.id, payload)
        showToast('Location added', { type: 'success' })
      }
      setShowForm(false)
      load()
    } catch (e) {
      showToast('Save failed: ' + e.message, { type: 'error' })
    }
  }

  const askRemove = (loc) => {
    const children = locations.filter(l => l.parent_location_id === loc.id)
    if (children.length > 0) {
      showToast('Cannot delete "' + loc.name + '" — it has ' + children.length + ' location(s) under it. Reassign or delete those first.', { type: 'warning' })
      return
    }
    setLocationToDelete(loc)
  }

  const remove = async () => {
    if (!locationToDelete) return
    try {
      await warehouseRepository.delete(locationToDelete.id, brand.id, locationToDelete.name)
      setLocationToDelete(null)
      showToast('Location deleted', { type: 'success' })
      load()
    } catch (e) {
      showToast('Delete failed: ' + e.message, { type: 'error' })
    }
  }

  const parentName = (id) => locations.find(l => l.id === id)?.name || null
  const managerName = (id) => {
    const s = staff.find(s => s.id === id)
    return s ? s.full_name || s.name : null
  }

  return (
    <div style={{ padding: '24px', maxWidth: '760px' }}>
      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: '900', color: navy }}>Warehouses & Branches</div>
          <div style={{ fontSize: '13px', color: gray500, marginTop: '2px' }}>Structure this however your company works — headquarters, regional offices, warehouses, whatever you call them.</div>
        </div>
        <TealBtn onClick={openNew} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Plus size={15} /> Add location</TealBtn>
      </div>

      {loading && <Loading />}

      {!loading && locations.length === 0 && (
        <Card style={{ padding: '32px', textAlign: 'center' }}>
          <div style={{ fontWeight: '800', color: navy, marginBottom: '6px' }}>No locations yet</div>
          <div style={{ fontSize: '13px', color: gray500, marginBottom: '16px' }}>Add your headquarters, warehouses, or regional offices to get started.</div>
          <TealBtn onClick={openNew} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Plus size={15} /> Add your first location</TealBtn>
        </Card>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {locations.map(loc => (
          <Card key={loc.id} style={{ padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: '800', fontSize: '15px', color: navy }}>{loc.name}</span>
                  <span style={{ fontSize: '10px', fontWeight: '700', padding: '3px 8px', borderRadius: theme.radius.full, background: tealMist, color: tealDeep }}>{loc.location_type}</span>
                </div>
                {parentName(loc.parent_location_id) && (
                  <div style={{ fontSize: '12px', color: gray500, marginTop: '4px' }}>Under: {parentName(loc.parent_location_id)}</div>
                )}
                {(loc.state || loc.country) && (
                  <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{[loc.state, loc.country].filter(Boolean).join(', ')}</div>
                )}
                {loc.address && <div style={{ fontSize: '12px', color: gray400, marginTop: '2px' }}>{loc.address}</div>}
                {managerName(loc.manager_staff_id) && (
                  <div style={{ fontSize: '12px', color: tealDeep, marginTop: '4px', fontWeight: '600' }}>Manager: {managerName(loc.manager_staff_id)}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                <button onClick={() => openEdit(loc)} style={{ border: `1px solid ${border}`, background: 'white', color: navy, borderRadius: theme.radius.sm, padding: '6px 12px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>Edit</button>
                <button onClick={() => askRemove(loc)} style={{ border: `1px solid ${danger}`, background: dangerBg, color: danger, borderRadius: theme.radius.sm, padding: '6px 12px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>Delete</button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Modal show={showForm} onClose={() => setShowForm(false)} sheet wide={false} title={editingId ? 'Edit Location' : 'Add Location'}
        footer={<>
          <GhostBtn onClick={() => setShowForm(false)} style={{ flex: 1, padding: '13px' }}>Cancel</GhostBtn>
          <TealBtn onClick={save} style={{ flex: 1, padding: '13px' }}>{editingId ? 'Save Changes' : 'Add Location'}</TealBtn>
        </>}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <Inp label='Location Name' value={form.name} onChange={v => f('name', v)} placeholder='e.g. Lagos Central Warehouse' required />

              <div>
                <div style={{ fontSize: '11px', fontWeight: '700', color: gray600, marginBottom: '6px' }}>Location Type *</div>
                <input value={form.location_type || ''} onChange={e => f('location_type', e.target.value)} placeholder='e.g. Warehouse, HQ, Regional Office'
                  style={{ width: '100%', minHeight: 44, padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', boxSizing: 'border-box', color: navy, outline: 'none' }} />
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                  {TYPE_SUGGESTIONS.map(t => { const on = form.location_type === t; return (
                    <button key={t} type='button' onClick={() => f('location_type', t)}
                      style={{ fontSize: '11px', padding: '6px 12px', borderRadius: theme.radius.full, border: `1px solid ${on ? tealDeep : border}`, background: on ? tealDeep : 'white', color: on ? 'white' : gray600, fontWeight: 600, cursor: 'pointer' }}>
                      {t}
                    </button>
                  )})}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '11px', fontWeight: '700', color: gray600, marginBottom: '6px' }}>Sits Under (optional)</div>
                <select value={form.parent_location_id || ''} onChange={e => f('parent_location_id', e.target.value)}
                  style={{ width: '100%', minHeight: 44, padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', background: 'white', color: navy }}>
                  <option value=''>None (top level)</option>
                  {locations.filter(l => l.id !== editingId).map(l => (
                    <option key={l.id} value={l.id}>{l.name} ({l.location_type})</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <Inp label='State' value={form.state} onChange={v => f('state', v)} placeholder='e.g. Lagos' />
                <Inp label='Country' value={form.country} onChange={v => f('country', v)} placeholder='e.g. Nigeria' />
              </div>

              <Inp label='Address' value={form.address} onChange={v => f('address', v)} placeholder='Street address' />

              <div>
                <div style={{ fontSize: '11px', fontWeight: '700', color: gray600, marginBottom: '6px' }}>Manager (optional)</div>
                <select value={form.manager_staff_id || ''} onChange={e => f('manager_staff_id', e.target.value)}
                  style={{ width: '100%', minHeight: 44, padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', background: 'white', color: navy }}>
                  <option value=''>No manager assigned</option>
                  {staff.map(s => (
                    <option key={s.id} value={s.id}>{s.full_name || s.name} — {s.role}</option>
                  ))}
                </select>
                {staff.length === 0 && <div style={{ fontSize: '11px', color: gray400, marginTop: '4px' }}>No staff added yet — add staff first to assign a manager.</div>}
              </div>

              <Inp label='Notes (optional)' value={form.notes} onChange={v => f('notes', v)} placeholder='Anything else worth noting' />
            </div>
      </Modal>

      <ConfirmDialog show={!!locationToDelete} onClose={() => setLocationToDelete(null)} onConfirm={remove}
        title={'Delete "' + (locationToDelete ? locationToDelete.name : '') + '"?'}
        consequence="This permanently removes the location record. This cannot be undone."
        confirmLabel="Delete" />
    </div>
  )
}
