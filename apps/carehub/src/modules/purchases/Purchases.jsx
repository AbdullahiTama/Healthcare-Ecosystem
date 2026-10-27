import { useState, useEffect } from 'react'
import { Truck, CreditCard, Hourglass, Search, Plus, X, ChevronDown } from 'lucide-react'
import { purchaseRepository } from './repositories'
// Product writes go through the inventory seam: replenishment must be atomic
// now that sales decrement stock server-side (C5/C12).
import { productRepository } from '../inventory/repositories'
// Batch/expiry capture goes through the stock seam: stock_batches is a stock
// aggregate table, so purchases must not assemble its rows itself.
import { stockRepository } from '../stock/repositories'
// Recording a purchase composes three aggregates: the purchase record (above),
// inventory replenishment, and the debt raised by any shortfall. Each is owned
// by its own module's repository rather than re-derived here.
import { debtRepository } from '../debts/repositories'
import { fmt, fmtDate, todayDate } from '../../lib/utils'
import { purchaseExpirySummary } from './expirySummary'
import { findDuplicate } from '../../lib/productMatches'
import { upsertProducts } from '../inventory/productListState'
import { PurchasePaymentModal, SupplierBalances, purchaseStatus } from './SupplierPayments'
import PurchaseDetailModal from './PurchaseDetail'
import { purchaseItemsFromForm } from './purchaseInvoice'
import { usePlanGate } from '../../hooks/usePlanGate'
import { restrictedMessage } from '../../lib/planStatus'
import { PRODUCT_CATS } from '../../config/constants'
import { theme } from '../../styles/theme'
import { Card, StatCard, SectionHead, Modal, Pill, Inp, Textarea, GhostBtn, TealBtn, Loading, Empty, ErrorState, useToast, Toast } from '../../components/ui'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, gray100, gray50, border, danger, success, bg } = theme

// Margin applied to newly created products from a purchase so they are
// immediately sellable (stock is also set). Existing products keep their
// own selling price; only stock and cost are updated.
const NEW_PRODUCT_MARKUP = 1.5
const PAGE_SIZE = 50

const blankItem = () => ({ name: '', qty: '', cost: '', sell: '', batch: '', expiry: '', cat: 'Medicines' })

// `products`/`setProducts`/`catalog` are the dashboard's shared catalog
// (inventory/hooks/useProductCatalog.js). Purchased items are matched against
// it, and the stock and products a purchase changes are written back into it,
// so Inventory and POS show the new stock at once without a re-download.
export default function Purchases({ brand, role, perms, products = [], setProducts, catalog, staffName }) {
  const [purchases, setPurchases] = useState([])
  // 'purchases' (the list) or 'suppliers' (totals and payment history per supplier).
  const [view, setView] = useState('purchases')
  // The purchase whose "Record payment" dialog is open.
  const [paying, setPaying] = useState(null)
  // The purchase opened as a supplier invoice (PurchaseDetailModal).
  const [viewing, setViewing] = useState(null)
  const inventory = products
  // Matching a purchase against a half-loaded catalog would create duplicates.
  const catalogLoading = catalog?.status === 'loading' || catalog?.status === 'error'
  const [loading, setLoading] = useState(true)
  // A failed load used to be swallowed and shown as "No purchases recorded"
  // with zero totals, which hid a broken get_purchases_page for every business.
  const [loadError, setLoadError] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [search, setSearch] = useState('')
  const [filterMonth, setFilterMonth] = useState('')
  const [filterYear, setFilterYear] = useState('')
  const [totals, setTotals] = useState({ purchase_count: 0, total_paid: 0, total_owed: 0 })
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ supplyDate: todayDate(), items: [blankItem()] })
  const [saving, setSaving] = useState(false)
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const plan = usePlanGate(showToast)
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const setItem = (i, k, v) => setForm(p => {
    const items = p.items.map((it, idx) => idx === i ? { ...it, [k]: v } : it)
    return { ...p, items }
  })
  const addItem = () => setForm(p => ({ ...p, items: [...p.items, blankItem()] }))
  const removeItem = (i) => setForm(p => ({ ...p, items: p.items.filter((_, idx) => idx !== i) }))

  useEffect(() => { load() }, [brand?.id, filterMonth, filterYear, search])

  async function load() {
    setLoading(true)
    setLoadError('')
    setPurchases([])
    setHasMore(true)
    try {
      const [page, totalData] = await Promise.all([
        purchaseRepository.getPage(brand.id, { search, month: filterMonth, year: filterYear, offset: 0, limit: PAGE_SIZE }),
        purchaseRepository.getTotals(brand.id),
      ])
      setPurchases(page || [])
      setTotals(totalData?.[0] || { purchase_count: 0, total_paid: 0, total_owed: 0 })
      setHasMore((page || []).length === PAGE_SIZE)
    } catch (e) {
      console.error('[purchases] load failed:', e)
      setHasMore(false)
      setLoadError(e?.message?.startsWith('Session expired') ? e.message : "We couldn't load your purchases. Check your connection and try again.")
    }
    setLoading(false)
  }

  async function loadMore() {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const more = await purchaseRepository.getPage(brand.id, { search, month: filterMonth, year: filterYear, offset: purchases.length, limit: PAGE_SIZE })
      setPurchases(p => [...p, ...(more || [])])
      setHasMore((more || []).length === PAGE_SIZE)
    } catch (e) {
      console.error('[purchases] load more failed:', e)
      showToast('Could not load more purchases. Please try again.', { type: 'error' })
    }
    setLoadingMore(false)
  }

  const validItems = form.items.filter(i => i.name.trim() && Number(i.qty) > 0 && Number(i.cost) > 0)
  // Quantities must be whole numbers: every stock column is integral, and a
  // decimal would previously truncate silently via parseInt (2.5 → 2 in stock
  // while 0.5 dropped the row entirely with a "success" toast).
  const badQty = form.items.some(i => i.name.trim() && i.qty !== '' && (!Number.isInteger(Number(i.qty)) || Number(i.qty) <= 0))
  const computedTotal = validItems.reduce((s, i) => s + Number(i.qty) * Number(i.cost), 0)

  async function save() {
    if (!form.supplier) { showToast('Please enter the supplier name.', { type: 'warning' }); return }
    if (badQty) { showToast('Quantities must be whole numbers (e.g. 2, not 2.5).', { type: 'warning' }); return }
    if (validItems.length === 0) { showToast('Enter at least one item with a name, quantity and unit cost.', { type: 'warning' }); return }
    if (catalogLoading) { showToast('Your products are still loading. Try again in a moment so items match your existing products.', { type: 'warning' }); return }
    // An expired (restricted) plan still records purchases that restock products already in stock, but cannot create
    // new products (the database refuses them); say which lines before anything is saved, not halfway through.
    if (plan.restricted) {
      const newNames = [...new Set(validItems.map(i => i.name.trim()).filter(n => !findDuplicate(inventory, n, '', null)))]
      if (newNames.length) {
        showToast(restrictedMessage('adding new products') + ' Remove or rename these lines to match products you already stock: ' + newNames.join(', ') + '.', { type: 'warning' })
        return
      }
    }
    setSaving(true)
    try {
      const total = computedTotal
      const paid = parseFloat(form.amountPaid) || 0
      // Clamp at zero: overpaying a supplier must not persist a negative
      // balance that the list would mis-render as a green "owed" figure.
      const balance = Math.max(0, total - paid)
      const totalQty = validItems.reduce((s, i) => s + Number(i.qty), 0)
      const productNames = validItems.map(i => i.name.trim())
      const { expiry, batch } = purchaseExpirySummary(validItems)
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
        expiry: expiry,
        batch: batch,
        // Each line's quantity and price, for the invoice view.
        items: purchaseItemsFromForm(validItems),
      })
      const purchaseId = (purchase[0] || {}).id || ''

      // INVENTORY SYNC: every purchased item is added to Inventory instantly.
      // Existing products get stock added (and the new unit cost recorded);
      // new products are created with stock and a default sell price.
      // Rows that name the same product are merged first — otherwise two
      // "Amoxicillin 500mg" lines would each hit the create branch against the
      // stale inventory snapshot and produce two duplicate catalog entries.
      const synced = new Map()
      for (const item of validItems) {
        const name = item.name.trim()
        const key = name.toLowerCase()
        const qty = Number(item.qty)
        const cost = Number(item.cost)
        const sell = Number(item.sell) > 0 ? Number(item.sell) : null
        if (synced.has(key)) { const prev = synced.get(key); prev.qty += qty; prev.cost = cost; if (sell) prev.sell = sell; prev.batch = prev.batch || item.batch; prev.expiry = prev.expiry || item.expiry; continue }
        synced.set(key, { name, qty, cost, sell, cat: item.cat || 'Medicines', batch: item.batch, expiry: item.expiry })
      }
      let created = 0
      let updated = 0
      let batchFailures = 0
      const changedRows = []
      for (const { name, qty, cost, sell, cat, batch, expiry } of synced.values()) {
        const existing = findDuplicate(inventory, name, '', null)
        try {
          let productId = null
          if (existing) {
            // Stock is incremented in the database, not read-modify-written
            // here — a till selling this product concurrently must not have its
            // decrement clobbered. cost_price is a plain overwrite, so it has
            // no such race and stays a normal scoped update. A selling price
            // typed on the form is an explicit repricing intent; an empty one
            // leaves the current price untouched.
            const updates = { cost_price: cost }
            if (sell && sell !== existing.price) updates.price = sell
            const newStock = await productRepository.incrementStock(existing.id, brand.id, qty)
            const saved = await productRepository.update(existing.id, brand.id, updates)
            changedRows.push({ ...(saved || { id: existing.id, ...updates }), ...(newStock != null ? { stock: newStock } : {}) })
            productId = existing.id
            updated++
          } else {
            const createdRow = await productRepository.create(brand.id, {
              name,
              category: cat,
              price: sell || Math.ceil(cost * NEW_PRODUCT_MARKUP),
              cost_price: cost,
              stock: qty,
              reorder_level: 5,
              list_on_carefind: true,
            })
            const row = Array.isArray(createdRow) ? createdRow[0] : createdRow
            productId = row?.id || null
            if (row?.id) changedRows.push(row)
            created++
          }
          // BATCH/EXPIRY: only when the user supplied either. Non-fatal — a
          // batch insert must never fail the purchase itself.
          if ((batch || expiry) && productId) {
            try {
              await stockRepository.createBatch(brand.id, {
                location_id: null,
                product_id: productId,
                product_name: name,
                batch_number: batch || null,
                quantity: qty,
                expiry_date: expiry || null,
                date_received: form.supplyDate || todayDate(),
                supplier_source: form.supplier || null,
                status: 'available',
              })
            } catch (e) {
              batchFailures++
              console.error('Batch creation failed for:', name, e.message)
            }
          }
        } catch (e) {
          console.error('Inventory sync failed for:', name, e.message)
        }
      }
      // One update to the shared catalog with the rows the database returned.
      if (changedRows.length > 0 && setProducts) setProducts(prev => upsertProducts(prev, changedRows))

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
        if (created > 0 && !form.items.some(i => Number(i.sell) > 0)) parts.push('new items priced at a ' + Math.round((NEW_PRODUCT_MARKUP - 1) * 100) + '% markup: adjust in Inventory anytime')
      }
      if (batchFailures > 0) parts.push(batchFailures + ' batch record(s) could not be saved')
      if (balance > 0) parts.push('Debt of ' + fmt(balance) + ' added to Debts automatically')
      showToast(parts.join(' · '), { type: 'success' })
      setForm({ supplyDate: todayDate(), items: [blankItem()] }); setShowAdd(false); load()
    } catch (e) { showToast('Could not save purchase. Please try again.', { type: 'error' }) }
    setSaving(false)
  }

  const years = [...new Set(purchases.map(p => p.created_at?.slice(0, 4)).filter(Boolean))].sort().reverse()

  // Autocomplete suggestions for the product-name inputs: existing catalogue
  // names, deduplicated, so a purchase line can pick the product it is
  // replenishing rather than retyping it (and risking a near-miss duplicate).
  const nameSuggestions = [...new Set((inventory || []).map(p => p.name).filter(Boolean))]

  return (
    <div>
      <SectionHead title='Purchases' sub='Record supplier purchases and the payments you make on them' btn='+ Record Purchase' onBtn={() => setShowAdd(true)} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard icon={<Truck />} label='Total Purchases' value={totals.purchase_count || 0} />
        <StatCard icon={<CreditCard />} label='Total Paid' value={fmt(Number(totals.total_paid) || 0)} />
        <StatCard icon={<Hourglass />} label='Balance Owed' value={fmt(Number(totals.total_owed) || 0)} alert={(Number(totals.total_owed) || 0) > 0} />
      </div>

      <div role='tablist' aria-label='Purchases views' style={{ display: 'flex', gap: 24, borderBottom: `1px solid ${border}`, marginBottom: 16 }}>
        {[['purchases', 'Purchases'], ['suppliers', 'Suppliers & payments']].map(([v, label]) => {
          const on = view === v
          return (
            <button key={v} type='button' role='tab' aria-selected={on} onClick={() => setView(v)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '10px 2px', marginBottom: -1, fontSize: 13, fontWeight: on ? 800 : 600, color: on ? tealDeep : gray600, borderBottom: on ? `2px solid ${tealDeep}` : '2px solid transparent' }}>
              {label}
            </button>
          )
        })}
      </div>

      {view === 'suppliers' ? (
        <SupplierBalances brand={brand} staffName={staffName} showToast={showToast} onPaid={load} />
      ) : (<>
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

      {loading ? <Loading /> : loadError ? <ErrorState message={loadError} onRetry={load} /> : purchases.length === 0 ? (
        <Empty icon={<Truck size={40} />} message='No purchases recorded' action='+ Record Purchase' onAction={() => setShowAdd(true)} />
      ) : (
        <Card>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${border}`, background: gray50 }}>
                  {['Supplier', 'Product', 'Qty', 'Unit Cost', 'Total', 'Paid', 'Balance', 'Supply Date', 'Due Date', 'Expiry Date', 'Status', 'Action'].map(h => (
                    <th key={h} style={{ padding: '12px 12px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: gray400, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {purchases.map(p => (
                  // The whole row opens the purchase as an invoice; the supplier
                  // name is its keyboard-reachable button.
                  <tr key={p.id} onClick={() => setViewing(p)} style={{ borderBottom: `1px solid ${gray100}`, cursor: 'pointer' }}>
                    <td style={{ padding: '12px 12px', fontWeight: '700', fontSize: '13px', color: navy }}>
                      <button type='button' onClick={(e) => { e.stopPropagation(); setViewing(p) }} aria-label={`View purchase from ${p.supplier_name}`}
                        style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, color: navy, cursor: 'pointer', textAlign: 'left', textDecoration: 'underline', textDecorationColor: gray100, textUnderlineOffset: 3 }}>
                        {p.supplier_name}
                      </button>
                    </td>
                    <td style={{ padding: '12px 12px', fontSize: '13px', color: gray600, maxWidth: '260px' }}>{p.product_name || 'Not set'}</td>
                    <td style={{ padding: '12px 12px', fontSize: '13px', color: navy }}>{p.quantity || 'Not set'}</td>
                    <td style={{ padding: '12px 12px', fontSize: '13px', color: navy }}>{p.cost_price ? fmt(p.cost_price) : 'Not set'}</td>
                    <td style={{ padding: '12px 12px', fontSize: '13px', fontWeight: '700', color: navy }}>{fmt(p.total_cost || 0)}</td>
                    <td style={{ padding: '12px 12px', fontSize: '13px', color: success }}>{fmt(p.amount_paid || 0)}</td>
                    <td style={{ padding: '12px 12px', fontSize: '13px', fontWeight: '900', color: (p.balance || 0) > 0 ? danger : success }}>{fmt(p.balance || 0)}</td>
                    <td style={{ padding: '12px 12px', fontSize: '12px', color: gray500 }}>{p.supply_date || 'Not set'}</td>
                    <td style={{ padding: '12px 12px', fontSize: '12px', color: gray400 }}>{p.due_date || 'Not set'}</td>
                    <td style={{ padding: '12px 12px', fontSize: '12px', color: gray500 }}>{fmtDate(p.expiry)}</td>
                    <td style={{ padding: '12px 12px' }}>{(() => { const st = purchaseStatus(p); return <Pill label={st.label} type={st.type} /> })()}</td>
                    <td style={{ padding: '12px 12px' }}>
                      {(Number(p.balance) || 0) > 0 ? (
                        <button type='button' onClick={(e) => { e.stopPropagation(); setPaying(p) }} aria-label={`Record payment to ${p.supplier_name}`} style={{ padding: '6px 12px', borderRadius: theme.radius.sm, border: 'none', background: tealDeep, color: 'white', fontWeight: '700', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap', minHeight: 32 }}>Record payment</button>
                      ) : (
                        <button type='button' onClick={(e) => { e.stopPropagation(); setPaying(p) }} aria-label={`Payment history for ${p.supplier_name}`} style={{ padding: '6px 12px', borderRadius: theme.radius.sm, border: `1px solid ${border}`, background: 'white', color: gray600, fontWeight: '700', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap', minHeight: 32 }}>History</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <div style={{ padding: '16px', textAlign: 'center' }}>
              <button onClick={loadMore} disabled={loadingMore}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 20px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', color: navy, fontWeight: '700', fontSize: '13px', cursor: loadingMore ? 'wait' : 'pointer' }}>
                {loadingMore ? 'Loading...' : <><ChevronDown size={14} /> Load more</>}
              </button>
            </div>
          )}
        </Card>
      )}

      </>)}

      {viewing && !paying && <PurchaseDetailModal brand={brand} purchase={viewing} onClose={() => setViewing(null)} onPay={(p) => { setViewing(null); setPaying(p) }} />}
      {paying && <PurchasePaymentModal brand={brand} purchase={paying} staffName={staffName} showToast={showToast} onPaid={load} onClose={() => setPaying(null)} />}

      <Modal show={showAdd} onClose={() => { setShowAdd(false); setForm({ supplyDate: todayDate(), items: [blankItem()] }) }} title='Record Purchase'
        footer={<><GhostBtn onClick={() => { setShowAdd(false); setForm({ supplyDate: todayDate(), items: [blankItem()] }) }} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={save} disabled={saving || catalogLoading} title={catalogLoading ? 'Available once your products have loaded' : undefined} style={{ flex: 1, padding: '12px' }}>{saving ? 'Saving...' : catalogLoading ? 'Loading products…' : 'Save Purchase'}</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Inp label='Supplier Name *' value={form.supplier} onChange={v => f('supplier', v)} placeholder='e.g. MedSupply Ltd' required />

          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: '700', color: gray500 }}>ITEMS PURCHASED *</span>
              <button onClick={addItem} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 10px', borderRadius: theme.radius.sm, border: 'none', background: tealMist, color: tealDeep, fontWeight: '700', fontSize: '11px', cursor: 'pointer' }}><Plus size={13} /> Add item</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {form.items.map((item, i) => {
                const sub = (Number(item.qty) || 0) * (Number(item.cost) || 0)
                return (
                  <div key={i} style={{ padding: '12px', borderRadius: theme.radius.md, border: `1px solid ${gray100}`, background: bg }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input value={item.name} onChange={e => setItem(i, 'name', e.target.value)} list='purchase-product-names' placeholder='Product name e.g. Amoxicillin 500mg'
                        aria-label='Product name'
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
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px', marginTop: '8px' }}>
                      <input value={item.sell} onChange={e => setItem(i, 'sell', e.target.value)} type='number' min='0' placeholder='Selling price ₦'
                        aria-label='Selling price'
                        style={{ padding: '8px 10px', borderRadius: theme.radius.sm, border: `1px solid ${border}`, fontSize: '12px', outline: 'none', color: navy, background: 'white' }} />
                      <input value={item.batch} onChange={e => setItem(i, 'batch', e.target.value)} placeholder='Batch no. (optional)'
                        aria-label='Batch number'
                        style={{ padding: '8px 10px', borderRadius: theme.radius.sm, border: `1px solid ${border}`, fontSize: '12px', outline: 'none', color: navy, background: 'white' }} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        <label style={{ fontSize: '11px', fontWeight: '700', color: gray500 }}>Expiry Date</label>
                        <input value={item.expiry} onChange={e => setItem(i, 'expiry', e.target.value)} type='date' aria-label='Expiry date'
                          style={{ padding: '7px 10px', borderRadius: theme.radius.sm, border: `1px solid ${border}`, fontSize: '12px', outline: 'none', color: navy, background: 'white' }} />
                      </div>
                      <select value={item.cat} onChange={e => setItem(i, 'cat', e.target.value)} aria-label='Category'
                        style={{ padding: '7px 10px', borderRadius: theme.radius.sm, border: `1px solid ${border}`, fontSize: '12px', outline: 'none', background: 'white', color: navy }}>
                        {PRODUCT_CATS.map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
                      <span style={{ fontSize: '12px', fontWeight: '700', color: sub > 0 ? tealDeep : gray400 }}>{sub > 0 ? 'Subtotal: ' + fmt(sub) : 'Not set'}</span>
                    </div>
                  </div>
                )
              })}
            </div>
            {form.items.length === 0 && <div style={{ fontSize: '12px', color: gray400 }}>No items yet: tap "Add item" to start.</div>}
          </div>

          <div style={{ padding: '10px 14px', borderRadius: theme.radius.md, background: tealMist, border: `1px solid ${tealDeep}`, fontSize: '12px', color: tealDeep, lineHeight: '1.7' }}>
            Every item you save is added to Inventory instantly: new products are created with stock and your selling price (or a 50% markup if left blank), existing products get more stock. A selling price you type is written to the product so POS charges it immediately. Batch and expiry details create a stock batch for expiry tracking. Adjust prices anytime in Inventory.
          </div>

          <datalist id='purchase-product-names'>
            {nameSuggestions.map(n => <option key={n} value={n} />)}
          </datalist>

          <div style={{ padding: '10px 14px', borderRadius: theme.radius.md, background: bg, display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
            <span style={{ color: gray500 }}>Total Cost (auto)</span>
            <span style={{ fontWeight: '900', color: navy }}>{fmt(computedTotal)}</span>
          </div>
          <Inp label='Amount Paid (₦)' value={form.amountPaid} onChange={v => f('amountPaid', v)} type='number' placeholder='0' />
          {computedTotal > 0 && (
            <div style={{ padding: '10px 14px', borderRadius: theme.radius.md, background: bg, display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
              <span style={{ color: gray500 }}>Balance remaining</span>
              <span style={{ fontWeight: '900', color: danger }}>{fmt(Math.max(0, computedTotal - (parseFloat(form.amountPaid) || 0)))}</span>
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
