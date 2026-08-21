import { useState, useEffect, useMemo } from 'react'
import { Plus, Check, Upload, Download, FileUp, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react'
import { territoryRepository } from './repositories'
import { parseTerritoryCsv, resolveTerritoryUpload } from './territoryImport'
// Cross-aggregate read: reps assigned to a territory are staff.
import { staffRepository } from '../staff/repositories'
import { theme } from '../../styles/theme'
import { Card, Inp, TealBtn, GhostBtn, Modal, useToast, Toast, ConfirmDialog, Loading } from '../../components/ui'
import { PageHeader } from '@care-ecosystem/design-system/components/layout/PageHeader'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, border, danger, dangerBg, success, warning, warningBg } = theme
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
  const [showUpload, setShowUpload] = useState(false)
  const [uploadData, setUploadData] = useState([])
  const [uploadError, setUploadError] = useState('')
  const [importing, setImporting] = useState(false)

  useEffect(() => { load() }, [brand?.id])

  async function load() {
    if (!brand?.id) return
    setLoading(true)
    try {
      const [terrs, stf] = await Promise.all([territoryRepository.getAll(brand.id), staffRepository.getAll(brand.id)])
      setTerritories(terrs || [])
      setStaff(stf || [])
      const ids = (terrs || []).map(t => t.id)
      const assigns = await territoryRepository.getAssignments(ids)
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
    // business_id is stamped by the repository, not assembled here.
    const payload = {
      name: form.name,
      level: form.level || null,
      parent_territory_id: form.parent_territory_id || null,
    }
    try {
      if (editingId) {
        await territoryRepository.update(editingId, brand.id, payload)
        showToast('Territory updated', { type: 'success' })
      } else {
        await territoryRepository.create(brand.id, payload)
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
      await territoryRepository.delete(territoryToDelete.id, brand.id, territoryToDelete.name)
      setTerritoryToDelete(null)
      showToast('Territory deleted', { type: 'success' })
      load()
    } catch (e) {
      showToast('Delete failed: ' + e.message, { type: 'error' })
    }
  }

  const repsFor = (territoryId) => assignments.filter(a => a.territory_id === territoryId)
  const parentName = (id) => territories.find(t => t.id === id)?.name || null

  // ── Bulk upload (CSV) ────────────────────────────────────────────────────────
  // Mirrors the Inventory product upload: download a template, fill it in
  // Excel, save as CSV, upload here. The parent territory is referenced by
  // NAME in the file and resolved against territories that already exist.
  const resolution = useMemo(
    () => resolveTerritoryUpload(uploadData, territories),
    [uploadData, territories],
  )

  function downloadTerritoryTemplate() {
    const rows = [
      ['Territory Name', 'Level', 'Sits Under (name)'],
      ['Nigeria South', 'Region', ''],
      ['Lagos Region', 'Region', 'Nigeria South'],
      ['Ikeja', 'LGA', 'Lagos Region'],
    ]
    const csv = rows.map(r => r.map(c => '"' + c + '"').join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'CareHub_Territories_Template.csv'; a.click()
    URL.revokeObjectURL(url)
    showToast('Template downloaded! Fill in Excel, save as CSV, then upload.', { type: 'success' })
  }

  function handleTerritoryFileUpload(e) {
    const file = e.target.files[0]; if (!file) return
    setUploadError(''); setUploadData([])
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const { rows, error } = parseTerritoryCsv(ev.target.result)
        if (error) { setUploadError(error); return }
        setUploadData(rows)
      } catch (err) { setUploadError('Error reading file. Use the downloaded template.') }
    }
    reader.readAsText(file); e.target.value = ''
  }

  async function importTerritories() {
    if (resolution.fresh.length === 0) { showToast('Nothing new to import — everything in the file already exists.', { type: 'warning' }); return }
    setImporting(true)
    showToast('Importing ' + resolution.fresh.length + ' territories…', { type: 'info' })
    try {
      const { added, skipped: serverSkipped, failed } = await territoryRepository.createMany(brand.id, resolution.fresh)
      await load()
      setShowUpload(false); setUploadData([]); setUploadError('')
      const skipped = resolution.skipped.length + serverSkipped
      const parts = [added + ' imported']
      if (skipped > 0) parts.push(skipped + ' skipped (already exist)')
      if (resolution.invalid.length > 0) parts.push(resolution.invalid.length + ' invalid')
      if (resolution.unresolvedParents > 0) parts.push(resolution.unresolvedParents + ' added as top-level (parent not found)')
      if (failed.length > 0) parts.push(failed.length + ' failed')
      const summary = parts.join(' · ')
      if (failed.length > 0) {
        showToast(summary + ': ' + failed.slice(0, 3).map(x => x.name + ' (' + x.message + ')').join(', '), { type: 'warning' })
      } else {
        showToast(summary + '!', { type: 'success' })
      }
    } catch (e) {
      showToast('Import failed: ' + e.message, { type: 'error' })
    }
    setImporting(false)
  }

  const toggleRep = async (territoryId, staffId) => {
    const existing = assignments.find(a => a.territory_id === territoryId && a.staff_id === staffId)
    try {
      if (existing) {
        await territoryRepository.unassignRep(existing.id, territoryId)
      } else {
        await territoryRepository.assignRep(staffId, territoryId)
      }
      load()
    } catch (e) {
      showToast('Failed: ' + e.message, { type: 'error' })
    }
  }

  return (
    <>
      <PageHeader
        title="Territories"
        description="Regions, states, or coverage areas — named however your company works. Assign reps to each."
        primaryAction={{ label: 'Add territory', leftIcon: <Plus size={15} />, onClick: openNew }}
        secondaryActions={[{ label: 'Bulk upload', leftIcon: <Upload size={15} />, onClick: () => { setUploadData([]); setUploadError(''); setShowUpload(true) } }]}
      />
      <div style={{ padding: '24px', maxWidth: '760px' }}>
        <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />

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
          <GhostBtn onClick={() => setShowForm(false)} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
          <TealBtn onClick={save} style={{ flex: 1, padding: '12px' }}>{editingId ? 'Save Changes' : 'Add Territory'}</TealBtn>
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
        footer={<GhostBtn onClick={() => setAssigningTerritory(null)} style={{ width: '100%', padding: '12px' }}>Done</GhostBtn>}>
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

      {/* Bulk Upload Modal */}
      <Modal show={showUpload} onClose={() => { setShowUpload(false); setUploadData([]); setUploadError('') }} title='Upload Territories from Excel / CSV'>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ padding: '14px', borderRadius: '12px', background: tealMist, border: `1px solid ${tealDeep}`, fontSize: '13px', color: tealDeep, lineHeight: '1.9' }}>
            1. Tap <strong>Download Template</strong><br />
            2. Open in <strong>Microsoft Excel</strong> or Google Sheets<br />
            3. Fill in your territories row by row — "Sits Under" must match an existing territory's name exactly<br />
            4. Save as <strong>CSV</strong><br />
            5. Upload here
          </div>
          <label style={{ display: 'block', padding: '24px', borderRadius: '12px', border: `2px dashed ${border}`, textAlign: 'center', cursor: 'pointer', background: theme.bg }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px', color: gray500 }}><FileUp size={36} /></div>
            <div style={{ fontWeight: '700', color: gray600, fontSize: '14px' }}>Tap to select CSV file</div>
            <input type='file' accept='.csv,.xlsx,.xls,.txt' onChange={handleTerritoryFileUpload} style={{ display: 'none' }} />
          </label>
          {uploadError && <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '12px', borderRadius: '10px', background: dangerBg, border: `1px solid ${danger}`, fontSize: '13px', color: danger }}><AlertTriangle size={15} /> {uploadError}</div>}
          {uploadData.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '700', color: success, fontSize: '13px', marginBottom: '8px', flexWrap: 'wrap' }}>
                <CheckCircle size={15} /> {resolution.fresh.length} new territories in file
                {resolution.skipped.length > 0 && <span style={{ color: warning, fontWeight: '600' }}> · {resolution.skipped.length} already exist (will be skipped)</span>}
                {resolution.invalid.length > 0 && <span style={{ color: warning, fontWeight: '600' }}> · {resolution.invalid.length} invalid</span>}
                {resolution.unresolvedParents > 0 && <span style={{ color: warning, fontWeight: '600' }}> · {resolution.unresolvedParents} parent name(s) not found</span>}
              </div>
              <div style={{ maxHeight: '180px', overflowY: 'auto', borderRadius: '10px', border: `1px solid ${theme.gray100}` }}>
                {uploadData.map((t, i) => {
                  const isDupe = resolution.skipped.some(s => s.toLowerCase() === t.name.toLowerCase())
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 12px', borderBottom: `1px solid ${theme.gray100}`, fontSize: '12px', background: isDupe ? warningBg : 'transparent' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '600', color: isDupe ? warning : navy }}>
                        {isDupe && <AlertTriangle size={12} />}{t.name}
                      </span>
                      <span style={{ color: isDupe ? warning : gray500 }}>
                        {isDupe ? 'Already exists' : [t.level, t.parent_name ? 'under ' + t.parent_name : ''].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: '10px' }}>
            <GhostBtn onClick={downloadTerritoryTemplate} style={{ flex: 1, padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}><Download size={14} /> Download Template</GhostBtn>
            {uploadData.length > 0 && resolution.fresh.length > 0 && (
              <button onClick={importTerritories} disabled={importing} style={{ flex: 1, padding: '12px', borderRadius: theme.radius.md, border: 'none', background: tealDeep, color: 'white', fontWeight: '800', fontSize: '14px', cursor: importing ? 'wait' : 'pointer', opacity: importing ? 0.7 : 1 }}>
                {importing
                  ? <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><Loader2 size={16} className="spin" aria-hidden="true" /> Importing…</span>
                  : 'Import ' + resolution.fresh.length + ' Territories'}
              </button>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmDialog show={!!territoryToDelete} onClose={() => setTerritoryToDelete(null)} onConfirm={remove}
        title={'Delete "' + (territoryToDelete ? territoryToDelete.name : '') + '"?'}
        consequence={'This permanently removes the territory' + (territoryToDelete && repsFor(territoryToDelete.id).length > 0 ? ' and unassigns the ' + repsFor(territoryToDelete.id).length + ' rep(s) currently covering it' : '') + '. This cannot be undone.'}
        confirmLabel="Delete" />
      </div>
    </>
  )
}
