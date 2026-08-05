import { useState, useEffect } from 'react'
import { Truck, CreditCard, Hourglass, Search, Plus, X } from 'lucide-react'
import { purchaseRepository } from './repositories'
// Product writes go through the inventory seam: replenishment must be atomic
// now that sales decrement stock server-side (C5/C12).
import { productRepository } from '../inventory/repositories'
// Recording a purchase composes three aggregates: the purchase record (above),
// inventory replenishment, and the debt raised by any shortfall. Each is owned
// by its own module's repository rather than re-derived here.
import { debtRepository } from '../debts/repositories'
import { fmt, todayDate } from '../../lib/utils'
import { findDuplicate } from '../../lib/productMatches'
import { PRODUCT_CATS } from '../../config/constants'
import { theme } from '../../styles/theme'
import { Card, StatCard, SectionHead, Modal, Pill, Inp, Textarea, GhostBtn, TealBtn, Loading, Empty, useToast, Toast } from '../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, gray100, border, danger, success, bg } = theme

// Margin applied to newly created products from a purchase so they are
// immediately sellable (stock is also set). Existing products keep their
// own selling price; only stock and cost are updated.
const NEW_PRODUCT_MARKUP = 1.5

const blankItem = () => ({ name: '', qty: '', cost: '', cat: 'Medicines' })

export default function Purchases({ brand, role, perms }) {
  const [purchases, setPurchases] = useState([])
  const [inventory, setInventory] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterMonth, setFilterMonth] = useState('')
  const [filterYear, setFilterYear] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ supplyDate: todayDate(), items: [blankItem()] })
  const [saving, setSaving] = useState(false)
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const setItem = (i, k, v) => setForm(p => {
    const items = p.items.map((it, idx) => idx === i ? { ...it, [k]: v } : it)
    return { ...p, items }
  })
  const addItem = () => setForm(p => ({ ...p, items: [...p.items, blankItem()] }))
  const removeItem = (i) => setForm(p => ({ ...p, items: p.items.filter((_, idx) => idx !== i) }))

  useEffect(() => { load() }, [brand?.id])
  useEffect(() => {
    let live = true
    productRepository.getAll(brand.id).then(p => { if (live) setInventory(p || []) }).catch(() => {})
    return () => { live = false }
  }, [brand?.id])

  async function load() {
    setLoading(true)
    try { const p = await purchaseRepository.getAll(brand.id); setPurchases(p || []) } catch (e) {}
    setLoading(false)
  }

  const validItems = form.items.filter(i => i.name.trim() && parseInt(i.qty) > 0 && parseFloat(i.cost) > 0)
  const computedTotal = validItems.reduce((s, i) => s + parseInt(i.qty) * parseFloat(i.cost), 0)

  async function save() {
    if (!form.supplier) { showToast('Please enter the supplier name.', { type: 'warning' }); return }
    if (validItems.length === 0) { showToast('Enter at least one item with a name, quantity and unit cost.', { type: 'warning' }); return }
    setSaving(true)
    try {
      const total = computedTotal
      const paid = parseFloat(form.amountPaid) || 0
      const balance = total - paid
      const totalQty = validItems.reduce((s, i) => s + parseInt(i.qty), 0)
      const productNames = validItems.map(i => i.name.trim())
      const purchase = await purchaseRepository.create(brand.id, {
        supplier_name: form.supplier,
        product_name: productNames.join(', '),
        quantity: totalQty,
        cost_price: totalQty > 0 ? total / totalQty : 0,
        total_cost: total,
        amount_paid: paid,
        balance: balance,
        supply_date: form.supplyDate || todayDate(),
        due_date: form.dueDate || '',
        status: paid >= total ? 'paid' : 'pending',
        notes: form.notes || '',
      })
      const purchaseId = (purchase[0] || {}).id || ''

      // INVENTORY SYNC: every purchased item is added to Inventory instantly.
      // Existing products get stock added (and the new unit cost recorded);
      // new products are created with stock and a default sell price.
      let created = 0
      let updated = 0
      for (const item of validItems) {
        const qty = parseInt(item.qty)
        const cost = parseFloat(item.cost)
        const existing = findDuplicate(inventory, item.name.trim(), '', null)
        try {
          if (existing) {
            // Stock is incremented in the database, not read-modify-written
            // here — a till selling this product concurrently must not have its
            // decrement clobbered. cost_price is a plain overwrite, so it has
            // no such race and stays a normal scoped update.
            await productRepository.incrementStock(existing.id, brand.id, qty)
            await productRepository.update(existing.id, brand.id, { cost_price: cost })
            updated++
          } else {
            await productRepository.create(brand.id, {
              name: item.name.trim(),
              category: item.cat || 'Medicines',
              price: Math.ceil(cost * NEW_PRODUCT_MARKUP),
              cost_price: cost,
              stock: qty,
              reorder_level: 5,
              list_on_carefind: true,
            })
            created++
          }
        } catch (e) {
          console.error('Inventory sync failed for:', item.name, e.message)
        }
      }
      if (created > 0 || updated > 0) {
        productRepository.getAll(brand.id).then(setInventory).catch(() => {})
      }

      // AUTO-CREATE DEBT: if there is a balance, create a "We Owe" debt automatically
      if (balance > 0) {
        await debtRepository.recordUnderpayment({
          businessId: brand.id,
          direction: 'we_owe',
          partyName: form.supplier,
          amount: total,
          amountPaid: paid,
          dueDate: form.dueDate || '',
          description: 'Purchase: ' + (productNames[0] || 'Stock') + (productNames.length > 1 ? ' +' + (productNames.length - 1) + ' more' : '') + ': Due: ' + (form.dueDate || 'Not set'),
          source: 'purchase',
          sourceRef: purchaseId,
        })
      }
      const parts = []
      parts.push('Purchase recorded!')
      if (created > 0 || updated > 0) {
        parts.push(created + ' new product(s) added to Inventory, ' + updated + ' updated')
        if (created > 0) parts.push('new items priced at a ' + Math.round((NEW_PRODUCT_MARKUP - 1) * 100) + '% markup: adjust in Inventory anytime')
      }
      if (balance > 0) parts.push('Debt of ' + fmt(balance) + ' added to Debts automatically')
      showToast(parts.join(' · '), { type: 'success' })
      setForm({ supplyDate: todayDate(), items: [blankItem()] }); setShowAdd(false); load()
    } catch (e) { showToast('Could not save purchase. Please try again.', { type: 'error' }) }
    setSaving(false)
  }

  async function markPaid(p) {
    try {
      await purchaseRepository.update(p.id, brand.id, { amount_paid: p.total_cost, balance: 0, status: 'paid' })
      // AUTO-UPDATE DEBT: settle the debt this purchase raised, if any. The
      // lookup lives in the debt repository — POS's credit collection needs the
      // same one, and the two used to scan every debt in the business by hand.
      try {
        const matchDebt = await debtRepository.findOpenBySource('purchase', p.id, brand.id)
        if (matchDebt) {
          await debtRepository.update(matchDebt.id, brand.id, { amount_paid: p.total_cost, balance: 0, status: 'paid' })
        }
      } catch (e) {}
      load(); showToast('Marked as paid! Debt updated automatically.', { type: 'success' })
    } catch (e) { showToast('Could not mark as paid. Please try again.', { type: 'error' }) }
  }

  const filtered = purchases.filter(p => {
    const matchSearch = !search || p.supplier_name.toLowerCase().includes(search.toLowerCase()) || (p.product_name && p.product_name.toLowerCase().includes(search.toLowerCase()))
    const matchMonth = !filterMonth || p.created_at?.startsWith(filterMonth)
    const matchYear = !filterYear || p.created_at?.startsWith(filterYear)
    return matchSearch && matchMonth && matchYear
  })

  const totalOwed = purchases.reduce((s, p) => s + (p.balance || 0), 0)
  const totalPaid = purchases.reduce((s, p) => s + (p.amount_paid || 0), 0)
  const years = [...new Set(purchases.map(p => p.created_at?.slice(0, 4)).filter(Boolean))].sort().reverse()

  return (
    <div>
      <SectionHead title='Purchases' sub='Record multi-item supplier purchases' btn='+ Record Purchase' onBtn={() => setShowAdd(true)} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard icon={<Truck />} label='Total Purchases' value={purchases.length} />
        <StatCard icon={<CreditCard />} label='Total Paid' value={fmt(totalPaid)} />
        <StatCard icon={<Hourglass />} label='Balance Owed' value={fmt(totalOwed)} alert={totalOwed > 0} />
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '180px', display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '0 14px' }}>
          <Search size={15} color={gray400} style={{ flexShrink: 0 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder='Search supplier or product...'
            style={{ flex: 1, padding: '10px 0', border: 'none', fontSize: '13px', outline: 'none', background: 'transparent', color: navy, minWidth: 0 }} />
        </div>
        <input type='month' value={filterMonth} onChange={e => { setFilterMonth(e.target.value); setFilterYear('') }}
          style={{ padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', outline: 'none', color: navy, background: 'white' }} />
        <select value={filterYear} onChange={e => { setFilterYear(e.target.value); setFilterMonth('') }}
          style={{ padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', outline: 'none', background: 'white', color: navy }}>
          <option value=''>All years</option>
          {years.map(y => <option key={y}>{y}</option>)}
        </select>
        {(filterMonth || filterYear) && <button onClick={() => { setFilterMonth(''); setFilterYear('') }} style={{ padding: '9px 14px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: gray600, cursor: 'pointer', fontSize: '12px', fontWeight: 700 }}>Clear</button>}
      </div>

      {loading ? <Loading /> : filtered.length === 0 ? (
        <Empty icon={<Truck size={40} />} message='No purchases recorded' action='+ Record Purchase' onAction={() => setShowAdd(true)} />
      ) : (
        <Card>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${border}`, background: gray50 }}>
                  {['Supplier', 'Product', 'Qty', 'Unit Cost', 'Total', 'Paid', 'Balance', 'Supply Date', 'Due Date', 'Status', 'Action'].map(h => (
                    <th key={h} style={{ padding: '12px 12px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: gray400, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id} style={{ borderBottom: `1px solid ${gray100}` }}>
                    <td style={{ padding: '12px 12px', fontWeight: '700', fontSize: '13px', color: navy }}>{p.supplier_name}</td>
                    <td style={{ padding: '12px 12px', fontSize: '13px', color: gray600, maxWidth: '260px' }}>{p.product_name || '—'}</td>
                    <td style={{ padding: '12px 12px', fontSize: '13px', color: navy }}>{p.quantity || '—'}</td>
                    <td style={{ padding: '12px 12px', fontSize: '13px', color: navy }}>{p.cost_price ? fmt(p.cost_price) : '—'}</td>
                    <td style={{ padding: '12px 12px', fontSize: '13px', fontWeight: '700', color: navy }}>{fmt(p.total_cost || 0)}</td>
                    <td style={{ padding: '12px 12px', fontSize: '13px', color: success }}>{fmt(p.amount_paid || 0)}</td>
                    <td style={{ padding: '12px 12px', fontSize: '13px', fontWeight: '900', color: (p.balance || 0) > 0 ? danger : success }}>{fmt(p.balance || 0)}</td>
                    <td style={{ padding: '12px 12px', fontSize: '12px', color: gray500 }}>{p.supply_date || '—'}</td>
                    <td style={{ padding: '12px 12px', fontSize: '12px', color: gray400 }}>{p.due_date || '—'}</td>
                    <td style={{ padding: '12px 12px' }}><Pill label={p.status} type={p.status === 'paid' ? 'green' : 'amber'} /></td>
                    <td style={{ padding: '12px 12px' }}>
                      {p.status !== 'paid' && <button onClick={() => markPaid(p)} style={{ padding: '6px 12px', borderRadius: theme.radius.sm, border: 'none', background: tealDeep, color: 'white', fontWeight: '700', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>Mark paid</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal show={showAdd} onClose={() => { setShowAdd(false); setForm({ supplyDate: todayDate(), items: [blankItem()] }) }} title='Record Purchase'
        footer={<><GhostBtn onClick={() => { setShowAdd(false); setForm({ supplyDate: todayDate(), items: [blankItem()] }) }} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={save} style={{ flex: 1, padding: '12px' }}>{saving ? 'Saving...' : 'Save Purchase'}</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Inp label='Supplier Name *' value={form.supplier} onChange={v => f('supplier', v)} placeholder='e.g. MedSupply Ltd' required />

          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: '700', color: gray500 }}>ITEMS PURCHASED *</span>
              <button onClick={addItem} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 10px', borderRadius: theme.radius.sm, border: 'none', background: tealMist, color: tealDeep, fontWeight: '700', fontSize: '11px', cursor: 'pointer' }}><Plus size={13} /> Add item</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {form.items.map((item, i) => {
                const sub = (parseInt(item.qty) || 0) * (parseFloat(item.cost) || 0)
                return (
                  <div key={i} style={{ padding: '12px', borderRadius: theme.radius.md, border: `1px solid ${gray100}`, background: bg }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input value={item.name} onChange={e => setItem(i, 'name', e.target.value)} placeholder='Product name e.g. Amoxicillin 500mg'
                        style={{ flex: 1, minWidth: 0, padding: '9px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', outline: 'none', color: navy, background: 'white' }} />
                      <input value={item.qty} onChange={e => setItem(i, 'qty', e.target.value)} type='number' min='1' placeholder='Qty'
                        aria-label='Quantity'
                        style={{ width: '72px', padding: '9px 10px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', outline: 'none', color: navy, background: 'white' }} />
                      <input value={item.cost} onChange={e => setItem(i, 'cost', e.target.value)} type='number' min='0' placeholder='Unit cost ₦'
                        aria-label='Unit cost'
                        style={{ width: '110px', padding: '9px 10px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', outline: 'none', color: navy, background: 'white' }} />
                      <button onClick={() => removeItem(i)} aria-label={'Remove ' + (item.name || 'item')}
                        style={{ width: '34px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.md, border: 'none', background: 'transparent', color: gray400, cursor: 'pointer' }}>
                        <X size={16} />
                      </button>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginTop: '8px' }}>
                      <select value={item.cat} onChange={e => setItem(i, 'cat', e.target.value)} aria-label='Category'
                        style={{ padding: '6px 10px', borderRadius: theme.radius.sm, border: `1px solid ${border}`, fontSize: '12px', outline: 'none', background: 'white', color: navy }}>
                        {PRODUCT_CATS.map(c => <option key={c}>{c}</option>)}
                      </select>
                      <span style={{ fontSize: '12px', fontWeight: '700', color: sub > 0 ? tealDeep : gray400 }}>{sub > 0 ? 'Subtotal: ' + fmt(sub) : '—'}</span>
                    </div>
                  </div>
                )
              })}
            </div>
            {form.items.length === 0 && <div style={{ fontSize: '12px', color: gray400 }}>No items yet: tap "Add item" to start.</div>}
          </div>

          <div style={{ padding: '10px 14px', borderRadius: theme.radius.md, background: tealMist, border: `1px solid ${tealDeep}`, fontSize: '12px', color: tealDeep, lineHeight: '1.7' }}>
            Every item you save is added to Inventory instantly: new products are created with stock and a 50% markup sell price, existing products get more stock. Adjust prices anytime in Inventory.
          </div>

          <div style={{ padding: '10px 14px', borderRadius: theme.radius.md, background: bg, display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
            <span style={{ color: gray500 }}>Total Cost (auto)</span>
            <span style={{ fontWeight: '900', color: navy }}>{fmt(computedTotal)}</span>
          </div>
          <Inp label='Amount Paid (₦)' value={form.amountPaid} onChange={v => f('amountPaid', v)} type='number' placeholder='0' />
          {computedTotal > 0 && (
            <div style={{ padding: '10px 14px', borderRadius: theme.radius.md, background: bg, display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
              <span style={{ color: gray500 }}>Balance remaining</span>
              <span style={{ fontWeight: '900', color: danger }}>{fmt(computedTotal - (parseFloat(form.amountPaid) || 0))}</span>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Inp label='Supply Date' value={form.supplyDate} onChange={v => f('supplyDate', v)} type='date' />
            <Inp label='Payment Due Date' value={form.dueDate} onChange={v => f('dueDate', v)} type='date' />
          </div>
          <Textarea label='Notes' value={form.notes} onChange={v => f('notes', v)} placeholder='Invoice number, delivery notes...' rows={2} />
        </div>
      </Modal>

      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}
