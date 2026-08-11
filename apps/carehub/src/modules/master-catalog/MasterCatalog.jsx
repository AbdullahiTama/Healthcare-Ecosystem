import { useState, useEffect } from 'react'
import { Lock, Layers, Building2, Trash2, RefreshCw } from 'lucide-react'
import { masterCatalogRepository } from './repositories'
import { getAllLocations } from '../../services/supabase'
import { fmt } from '../../lib/utils'
import { PRODUCT_CATS } from '../../config/constants'
import { theme } from '../../styles/theme'
import { Card, SectionHead, Modal, ConfirmDialog, Pill, Inp, Sel, Textarea, GhostBtn, TealBtn, RedBtn, Loading, Empty, useToast, Toast } from '../../components/ui'

const { tealDeep, tealBright, tealMist, navy, gray600, gray500, gray400, border, warning, bg } = theme

export default function MasterCatalog({ brand, role }) {
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const [masters, setMasters] = useState([])
  const [locs, setLocs] = useState([])
  // links: branchId → { masterProductId → link row }. Indexed per branch because
  // the page renders a branch × product matrix and every read is one lookup.
  const [links, setLinks] = useState({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [editing, setEditing] = useState(null) // master product being edited, null = new
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [manageTarget, setManageTarget] = useState(null) // master product whose branch matrix is open
  const [overrides, setOverrides] = useState({}) // branchId → draft override string in the matrix
  const [pushTarget, setPushTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const isOwner = role === 'Owner'
  // Master rows live on the PARENT business (ADR-004): from the main location
  // brand.parent_business_id is absent and brand.id IS the parent; from a
  // branch view the parent is explicit. Same resolution Locations.jsx uses.
  const mainId = brand?.parent_business_id || brand?.id

  useEffect(() => { load() }, [brand?.id])

  async function load() {
    setLoading(true)
    try {
      const [m, l] = await Promise.all([
        masterCatalogRepository.getAll(mainId),
        getAllLocations(mainId),
      ])
      setMasters(m || [])
      setLocs(l || [])
      const linkMap = {}
      await Promise.all((l || []).map(async (loc) => {
        const rows = await masterCatalogRepository.getLinks(loc.id)
        linkMap[loc.id] = Object.fromEntries((rows || []).map(r => [r.master_product_id, r]))
      }))
      setLinks(linkMap)
    } catch (e) { /* links stay empty; the toast-less failure keeps the page usable */ }
    setLoading(false)
  }

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const branchName = (loc) => loc.branch_name || (!loc.parent_business_id ? 'Main Location' : loc.name)

  // ── Master product CRUD ─────────────────────────────────────────────────────
  function openAdd() {
    setEditing(null)
    setForm({})
    setShowEdit(true)
  }

  function openEdit(master) {
    setEditing(master)
    setForm({ name: master.name, category: master.category || '', default_price: master.default_price || '', description: master.description || '' })
    setShowEdit(true)
  }

  async function saveProduct() {
    if (!form.name) { showToast('Please enter a product name.', { type: 'warning' }); return }
    const price = Number(form.default_price) || 0
    if (price < 0) { showToast('Price cannot be negative.', { type: 'warning' }); return }
    const payload = { name: form.name, category: form.category || '', default_price: price, description: form.description || '' }
    setSaving(true)
    try {
      if (editing) {
        await masterCatalogRepository.update(editing.id, mainId, payload)
        showToast('Product updated. Use Push to send changes to branches.', { type: 'success' })
      } else {
        await masterCatalogRepository.create(mainId, payload)
        showToast('Product added to the master catalog.', { type: 'success' })
      }
      setShowEdit(false); setForm({}); setEditing(null)
      load()
    } catch (e) { showToast('Could not save the product. Please try again.', { type: 'error' }) }
    setSaving(false)
  }

  async function deleteMaster() {
    if (!deleteTarget) return
    try {
      await masterCatalogRepository.remove(deleteTarget.id, mainId)
      showToast('Product removed from the master catalog.', { type: 'success' })
      setDeleteTarget(null)
      load()
    } catch (e) { showToast('Could not delete the product.', { type: 'error' }) }
  }

  // ── Branch activation matrix ────────────────────────────────────────────────
  function openManage(master) {
    setManageTarget(master)
    const drafts = {}
    ;(locs || []).forEach((loc) => {
      const link = links[loc.id]?.[master.id]
      drafts[loc.id] = link?.override_price != null ? String(link.override_price) : ''
    })
    setOverrides(drafts)
  }

  async function toggleBranch(master, loc) {
    const link = links[loc.id]?.[master.id]
    const overrideText = (overrides[loc.id] || '').trim()
    if (!link?.active) {
      // A typed override is only sent when valid; empty means "inherit the
      // master default". The RPC rejects 0 and negatives server-side, so we
      // catch it here with a clear message first.
      if (overrideText && Number(overrideText) <= 0) {
        showToast('Override price must be greater than zero.', { type: 'warning' })
        return
      }
    }
    setBusy(true)
    try {
      if (link?.active) {
        await masterCatalogRepository.deactivate(loc.id, master.id)
        showToast(`Deactivated at ${branchName(loc)}. Stock stays with the branch.`, { type: 'success' })
      } else {
        await masterCatalogRepository.activate(loc.id, master.id, overrideText ? Number(overrideText) : null)
        showToast(`Activated at ${branchName(loc)} with stock 0 — add stock in Inventory.`, { type: 'success' })
      }
      load()
    } catch (e) { showToast('Could not update this branch. Please try again.', { type: 'error' }) }
    setBusy(false)
  }

  async function pushMaster() {
    if (!pushTarget) return
    try {
      const count = await masterCatalogRepository.push(pushTarget.id, mainId)
      const n = typeof count === 'number' ? count : null
      showToast(n != null ? `Pushed to ${n} branch(es).` : 'Pushed to all active branches.', { type: 'success' })
      setPushTarget(null)
    } catch (e) { showToast('Could not push changes.', { type: 'error' }) }
  }

  const activeLinkCount = (master) =>
    Object.values(links).filter((byMaster) => byMaster?.[master.id]?.active).length

  const totalActiveLinks = Object.values(links)
    .reduce((s, byMaster) => s + Object.values(byMaster).filter(l => l.active).length, 0)

  if (!isOwner) return (
    <div style={{ padding: '40px', textAlign: 'center', color: gray400 }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}><Lock size={40} /></div>
      <div style={{ fontSize: '16px', fontWeight: '700', color: gray600 }}>The master catalog is managed by the business Owner</div>
    </div>
  )

  const manageMaster = manageTarget ? masters.find(m => m.id === manageTarget.id) : null

  return (
    <div>
      <SectionHead title='Master Catalog' sub='One canonical product list — choose which branches carry each product' btn='+ Add Product' onBtn={openAdd} />

      <div style={{ marginBottom: '20px', padding: '20px', borderRadius: theme.radius.lg, background: navy, color: 'white' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: '16px' }}>
          <div>
            <div style={{ fontSize: '24px', fontWeight: '900', color: tealBright }}>{masters.length}</div>
            <div style={{ fontSize: '11px', opacity: 0.5 }}>Master products</div>
          </div>
          <div>
            <div style={{ fontSize: '24px', fontWeight: '900' }}>{totalActiveLinks}</div>
            <div style={{ fontSize: '11px', opacity: 0.5 }}>Active branch links</div>
          </div>
          <div>
            <div style={{ fontSize: '24px', fontWeight: '900' }}>{locs.length}</div>
            <div style={{ fontSize: '11px', opacity: 0.5 }}>Locations</div>
          </div>
        </div>
      </div>

      {loading ? <Loading /> : masters.length === 0 ? (
        <Empty icon={<Layers size={40} />} message='No master products yet' action='+ Add First Product' onAction={openAdd} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {masters.map(master => {
            const activeCount = activeLinkCount(master)
            return (
              <Card key={master.id} style={{ padding: '18px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', minWidth: 0 }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: theme.radius.md, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Layers size={22} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: '800', fontSize: '15px', color: navy }}>{master.name}</span>
                        {master.category && <Pill label={master.category} type='blue' />}
                        {activeCount === 0 && <Pill label='No active branches' type='red' />}
                      </div>
                      <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{master.description || 'No description'}</div>
                      <div style={{ display: 'flex', gap: '12px', marginTop: '8px', flexWrap: 'wrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: tealDeep, fontWeight: '700' }}>Default {fmt(master.default_price || 0)}</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: gray500 }}><Building2 size={12} /> {activeCount} active branch{activeCount === 1 ? '' : 'es'}</span>
                      </div>
                      {activeCount > 0 && (
                        <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
                          {locs.filter(loc => links[loc.id]?.[master.id]?.active).map(loc => {
                            const link = links[loc.id][master.id]
                            return (
                              <span key={loc.id} style={{ fontSize: '11px', padding: '3px 10px', borderRadius: 999, background: tealMist, color: tealDeep, fontWeight: '600' }}>
                                {branchName(loc)}{link.override_price != null ? ' · ' + fmt(link.override_price) : ''}
                              </span>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <GhostBtn onClick={() => openManage(master)} style={{ padding: '8px 14px', fontSize: '12px' }}>Manage branches</GhostBtn>
                    <TealBtn onClick={() => { setPushTarget(master) }} style={{ padding: '8px 14px', fontSize: '12px' }}>
                      <RefreshCw size={13} style={{ marginRight: 5 }} /> Push
                    </TealBtn>
                    <GhostBtn onClick={() => openEdit(master)} style={{ padding: '8px 14px', fontSize: '12px' }}>Edit</GhostBtn>
                    <RedBtn onClick={() => { setDeleteTarget(master) }} style={{ padding: '8px 12px', fontSize: '12px' }}>
                      <Trash2 size={13} />
                    </RedBtn>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Add / edit product */}
      <Modal show={showEdit} onClose={() => { setShowEdit(false); setForm({}); setEditing(null) }}
        title={editing ? 'Edit Product' : 'Add Master Product'}
        footer={<><GhostBtn onClick={() => { setShowEdit(false); setForm({}); setEditing(null) }} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={saveProduct} style={{ flex: 1, padding: '12px' }}>{saving ? 'Saving...' : editing ? 'Save Product' : 'Add Product'}</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {editing && (
            <div style={{ padding: '12px', borderRadius: theme.radius.md, background: tealMist, fontSize: '12px', color: tealDeep }}>
              Branches match master products by name. After renaming, re-activate the product at each branch (or delete and re-add) so branches pick up the new name.
            </div>
          )}
          <Inp label='Product Name *' value={form.name} onChange={v => f('name', v)} placeholder='e.g. Paracetamol 500mg' required />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Sel label='Category' value={form.category} onChange={v => f('category', v)} options={PRODUCT_CATS} />
            <Inp label='Default Price (₦) *' type='number' value={form.default_price} onChange={v => f('default_price', v)} placeholder='0' required />
          </div>
          <Textarea label='Description' value={form.description} onChange={v => f('description', v)} placeholder='Brief description shown to branches' />
        </div>
      </Modal>

      {/* Branch activation matrix */}
      <Modal show={!!manageMaster} onClose={() => { setManageTarget(null) }}
        title={manageMaster ? `Branches carrying ${manageMaster.name}` : ''}
        footer={<GhostBtn onClick={() => { setManageTarget(null) }} style={{ flex: 1, padding: '12px' }}>Done</GhostBtn>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ padding: '12px', borderRadius: theme.radius.md, background: tealMist, fontSize: '12px', color: tealDeep }}>
            Activating a branch creates its sellable product at stock 0 — add stock in that branch's Inventory. Set a price to override the default; leave it blank to inherit.
          </div>
          {(locs || []).map(loc => {
            const link = links[loc.id]?.[manageMaster?.id]
            const active = !!link?.active
            return (
              <div key={loc.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: bg }}>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <div style={{ fontWeight: '700', fontSize: '13px', color: navy }}>{branchName(loc)}</div>
                  <div style={{ fontSize: '11px', color: gray500, marginTop: '2px' }}>
                    {active
                      ? (link.override_price != null ? `Sells at ${fmt(link.override_price)} (override)` : `Sells at master default ${fmt(manageMaster?.default_price || 0)}`)
                      : 'Not carried'}
                  </div>
                </div>
                <div style={{ width: 130 }}>
                  <Inp type='number' value={overrides[loc.id] || ''} onChange={v => setOverrides(p => ({ ...p, [loc.id]: v }))} placeholder='Override ₦' aria-label={`Override price at ${branchName(loc)}`} />
                </div>
                {active
                  ? <GhostBtn onClick={() => toggleBranch(manageMaster, loc)} disabled={busy} style={{ padding: '8px 14px', fontSize: '12px' }}>Deactivate</GhostBtn>
                  : <TealBtn onClick={() => toggleBranch(manageMaster, loc)} disabled={busy} style={{ padding: '8px 14px', fontSize: '12px' }}>Activate</TealBtn>}
              </div>
            )
          })}
          {(!locs || locs.length === 0) && (
            <div style={{ textAlign: 'center', color: gray400, fontSize: '13px', padding: '16px 0' }}>No locations found.</div>
          )}
        </div>
      </Modal>

      <ConfirmDialog show={!!pushTarget} onClose={() => setPushTarget(null)} onConfirm={pushMaster}
        title='Push to branches?' consequence={`Sends the name, category and price of "${pushTarget?.name}" to every branch carrying it. Branches with their own override price keep it.`}
        confirmLabel='Push' danger={false} />

      <ConfirmDialog show={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={deleteMaster}
        title='Delete this master product?'
        consequence={`Removes "${deleteTarget?.name}" from the master catalog and its links at every branch. Branches keep existing stock — they just stop receiving pushes.`} />

      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}
