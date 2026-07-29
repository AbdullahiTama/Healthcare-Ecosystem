import { useState, useEffect } from 'react'
import { Plus, Check } from 'lucide-react'
import { getTerritories, addTerritory, updateTerritory, deleteTerritory, getStaff, getRepAssignments, assignRepToTerritory, removeRepFromTerritory } from '../../services/supabase'
import { theme } from '../../styles/theme'
import { Card, Inp, TealBtn, GhostBtn, Modal, useToast, Toast, ConfirmDialog, Loading } from '../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, border, danger, dangerBg } = theme
const LEVEL_SUGGESTIONS = ['Region', 'State', 'City', 'LGA', 'Zone']

export default function Territories({ brand }) {
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const [territories, setTerritories] = useState([])
  const [staff, setStaff] = useState([])
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({})
  const [assigningTerritory, setAssigningTerritory] = useState(null)
  const [territoryToDelete, setTerritoryToDelete] = useState(null)

  useEffect(() => { load() }, [brand?.id])

  async function load() {
    if (!brand?.id) return
    setLoading(true)
    try {
      const [terrs, stf] = await Promise.all([getTerritories(brand.id), getStaff(brand.id)])
      setTerritories(terrs || [])
      setStaff(stf || [])
      const ids = (terrs || []).map(t => t.id)
      const assigns = await getRepAssignments(ids)
      setAssignments(assigns || [])
    } catch (e) {
      showToast('Failed to load: ' + e.message, { type: 'error' })
    }
    setLoading(false)
  }

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const openNew = () => { setForm({}); setEditingId(null); setShowForm(true) }

  const openEdit = (t) => {
    setForm({ name: t.name, level: t.level || '', parent_territory_id: t.parent_territory_id || '' })
    setEditingId(t.id)
    setShowForm(true)
  }

  const save = async () => {
    if (!form.name) { showToast('Please enter a territory name.', { type: 'warning' }); return }
    const payload = {
      business_id: brand.id,
      name: form.name,
      level: form.level || null,
      parent_territory_id: form.parent_territory_id || null,
    }
    try {
      if (editingId) {
        await updateTerritory(editingId, payload)
        showToast('Territory updated', { type: 'success' })
      } else {
        await addTerritory(payload)
        showToast('Territory added', { type: 'success' })
      }
      setShowForm(false)
      load()
    } catch (e) {
      showToast('Save failed: ' + e.message, { type: 'error' })
    }
  }

  const askRemove = (t) => setTerritoryToDelete(t)

  const remove = async () => {
    if (!territoryToDelete) return
    try {
      await deleteTerritory(territoryToDelete.id)
      setTerritoryToDelete(null)
      showToast('Territory deleted', { type: 'success' })
      load()
    } catch (e) {
      showToast('Delete failed: ' + e.message, { type: 'error' })
    }
  }

  const repsFor = (territoryId) => assignments.filter(a => a.territory_id === territoryId)
  const parentName = (id) => territories.find(t => t.id === id)?.name || null

  const toggleRep = async (territoryId, staffId) => {
    const existing = assignments.find(a => a.territory_id === territoryId && a.staff_id === staffId)
    try {
      if (existing) {
        await removeRepFromTerritory(existing.id)
      } else {
        await assignRepToTerritory(staffId, territoryId)
      }
      load()
    } catch (e) {
      showToast('Failed: ' + e.message, { type: 'error' })
    }
  }

  return (
    <div style={{ padding: '24px', maxWidth: '760px' }}>
      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: '900', color: navy }}>Territories</div>
          <div style={{ fontSize: '13px', color: gray500, marginTop: '2px' }}>Regions, states, or coverage areas — named however your company works. Assign reps to each.</div>
        </div>
        <TealBtn onClick={openNew} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Plus size={15} /> Add territory</TealBtn>
      </div>

      {loading && <Loading />}

      {!loading && territories.length === 0 && (
        <Card style={{ padding: '32px', textAlign: 'center' }}>
          <div style={{ fontWeight: '800', color: navy, marginBottom: '6px' }}>No territories yet</div>
          <div style={{ fontSize: '13px', color: gray500, marginBottom: '16px' }}>Add regions or states, then assign reps to cover them.</div>
          <TealBtn onClick={openNew} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Plus size={15} /> Add your first territory</TealBtn>
        </Card>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {territories.map(t => (
          <Card key={t.id} style={{ padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: '800', fontSize: '15px', color: navy }}>{t.name}</span>
                  {t.level && <span style={{ fontSize: '10px', fontWeight: '700', padding: '3px 8px', borderRadius: theme.radius.full, background: tealMist, color: tealDeep }}>{t.level}</span>}
                </div>
                {parentName(t.parent_territory_id) && (
                  <div style={{ fontSize: '12px', color: gray500, marginTop: '4px' }}>Under: {parentName(t.parent_territory_id)}</div>
                )}
                <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {repsFor(t.id).length === 0 && <span style={{ fontSize: '11px', color: gray400 }}>No reps assigned</span>}
                  {repsFor(t.id).map(a => (
                    <span key={a.id} style={{ fontSize: '11px', fontWeight: '600', padding: '3px 9px', borderRadius: theme.radius.full, background: tealMist, color: tealDeep }}>
                      {a.staff?.full_name || 'Rep'}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button onClick={() => setAssigningTerritory(t)} style={{ border: `1px solid ${tealDeep}`, background: tealMist, color: tealDeep, borderRadius: theme.radius.sm, padding: '6px 12px', fontSize: '12px', cursor: 'pointer', fontWeight: '700' }}>Assign reps</button>
                <button onClick={() => openEdit(t)} style={{ border: `1px solid ${border}`, background: 'white', color: navy, borderRadius: theme.radius.sm, padding: '6px 12px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>Edit</button>
                <button onClick={() => askRemove(t)} style={{ border: `1px solid ${danger}`, background: dangerBg, color: danger, borderRadius: theme.radius.sm, padding: '6px 12px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>Delete</button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Modal show={showForm} onClose={() => setShowForm(false)} sheet title={editingId ? 'Edit Territory' : 'Add Territory'}
        footer={<>
          <GhostBtn onClick={() => setShowForm(false)} style={{ flex: 1, padding: '13px' }}>Cancel</GhostBtn>
          <TealBtn onClick={save} style={{ flex: 1, padding: '13px' }}>{editingId ? 'Save Changes' : 'Add Territory'}</TealBtn>
        </>}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <Inp label='Territory Name' value={form.name} onChange={v => f('name', v)} placeholder='e.g. Lagos Mainland' required />

              <div>
                <div style={{ fontSize: '11px', fontWeight: '700', color: gray600, marginBottom: '6px' }}>Level (optional)</div>
                <input value={form.level || ''} onChange={e => f('level', e.target.value)} placeholder='e.g. Region, State, City'
                  style={{ width: '100%', minHeight: 44, padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', boxSizing: 'border-box', color: navy, outline: 'none' }} />
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                  {LEVEL_SUGGESTIONS.map(l => { const on = form.level === l; return (
                    <button key={l} type='button' onClick={() => f('level', l)}
                      style={{ fontSize: '11px', padding: '6px 12px', borderRadius: theme.radius.full, border: `1px solid ${on ? tealDeep : border}`, background: on ? tealDeep : 'white', color: on ? 'white' : gray600, fontWeight: 600, cursor: 'pointer' }}>
                      {l}
                    </button>
                  )})}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '11px', fontWeight: '700', color: gray600, marginBottom: '6px' }}>Sits Under (optional)</div>
                <select value={form.parent_territory_id || ''} onChange={e => f('parent_territory_id', e.target.value)}
                  style={{ width: '100%', minHeight: 44, padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', background: 'white', color: navy }}>
                  <option value=''>None (top level)</option>
                  {territories.filter(t => t.id !== editingId).map(t => (
                    <option key={t.id} value={t.id}>{t.name}{t.level ? ' (' + t.level + ')' : ''}</option>
                  ))}
                </select>
              </div>
            </div>
      </Modal>

      <Modal show={!!assigningTerritory} onClose={() => setAssigningTerritory(null)} sheet title={'Assign Reps — ' + (assigningTerritory?.name || '')}
        footer={<GhostBtn onClick={() => setAssigningTerritory(null)} style={{ width: '100%', padding: '13px' }}>Done</GhostBtn>}>
            <div style={{ fontSize: '12px', color: gray500, marginBottom: '16px' }}>Tap to toggle who covers this territory.</div>

            {staff.length === 0 && <div style={{ fontSize: '13px', color: gray400 }}>No staff added yet.</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {staff.map(s => {
                const assigned = assignments.some(a => a.territory_id === assigningTerritory?.id && a.staff_id === s.id)
                return (
                  <button key={s.id} onClick={() => toggleRep(assigningTerritory?.id, s.id)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderRadius: theme.radius.md, border: `1px solid ${assigned ? tealDeep : border}`, background: assigned ? tealMist : 'white', cursor: 'pointer', textAlign: 'left' }}>
                    <div>
                      <div style={{ fontWeight: '700', fontSize: '13px', color: navy }}>{s.full_name}</div>
                      <div style={{ fontSize: '11px', color: gray500 }}>{s.public_title || s.role}</div>
                    </div>
                    {assigned && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '13px', fontWeight: '800', color: tealDeep }}><Check size={14} /> Assigned</span>}
                  </button>
                )
              })}
            </div>
      </Modal>

      <ConfirmDialog show={!!territoryToDelete} onClose={() => setTerritoryToDelete(null)} onConfirm={remove}
        title={'Delete "' + (territoryToDelete ? territoryToDelete.name : '') + '"?'}
        consequence={'This permanently removes the territory' + (territoryToDelete && repsFor(territoryToDelete.id).length > 0 ? ' and unassigns the ' + repsFor(territoryToDelete.id).length + ' rep(s) currently covering it' : '') + '. This cannot be undone.'}
        confirmLabel="Delete" />
    </div>
  )
}
