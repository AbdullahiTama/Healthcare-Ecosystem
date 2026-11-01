import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react'
import { Plus, X, AlertTriangle, Package, ScanLine, Lock } from 'lucide-react'
import { fmt, todayDate } from '../../lib/utils'
import { normalize } from '../../lib/productMatches'
import { canScanWithCamera, startCameraScan } from '../../lib/barcodeScanner'
import { PRODUCT_CATS } from '../../config/constants'
import { theme } from '../../styles/theme'
import { Inp, Textarea } from '../../components/ui'
import { blankItem, isBlankItem, findProductForEntry, findProductByBarcode, applyProduct, itemProblems, isPastExpiry, looksLikeBarcode } from './lineItems'
import SupplierField from './SupplierField'
import ProductInsight from './ProductInsight'

const { tealDeep, tealMist, navy, gray600, gray500, gray400, gray100, gray50, border, danger, dangerBg, warning, success, bg } = theme

const lineInput = (invalid, readOnly) => ({
  width: '100%', boxSizing: 'border-box', minHeight: 40, padding: '8px 10px', borderRadius: theme.radius.sm,
  border: `1px solid ${invalid ? danger : border}`, fontSize: '13px', outline: 'none', color: navy,
  background: readOnly ? gray50 : 'white', fontFamily: theme.fontFamily,
})

function LineField({ id, label, error, children }) {
  return (
    <div style={{ minWidth: 0 }}>
      <label htmlFor={id} style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: gray500, marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</label>
      {children}
      {error && <div id={id + '-error'} style={{ fontSize: '11px', color: danger, marginTop: '3px' }}>{error}</div>}
    </div>
  )
}

export const formTotal = (form) => form.items.filter(i => !isBlankItem(i)).reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.cost) || 0), 0)

// Field problems for every started line of the form ([{ idx, problems }],
// empty when it can be saved). One definition for what the form outlines and
// what blocks the save. `editLines` (editing only) maps a line id to what
// get_purchase_for_edit said about it.
export function formLineProblems(form, inventory, editLines = null) {
  return form.items.map((it, idx) => {
    const product = it.productId ? inventory.find(p => p.id === it.productId) || null : null
    const info = editLines?.[it.id]
    const sameProduct = info && info.product_id && info.product_id === it.productId
    const problems = itemProblems(it, product, {
      barcodeOwner: findProductByBarcode(inventory, it.barcode),
      minQty: sameProduct ? info.min_qty : null,
      locked: !!info?.locked,
    })
    return { idx, problems }
  }).filter(x => Object.keys(x.problems).length > 0)
}

// The Record Purchase form, also used to edit a recorded purchase. Purely the
// form: the caller owns the state (`form`/`setForm`), the dialog and the save.
//
// mode 'edit' adds what the database said about each line (`editLines`):
// locked lines keep their product and quantity, a line cannot go below what is
// still in stock, and selling prices of existing products are changed in
// Inventory, not here. The caller can focus a line field through the ref
// (focusLine(id, field)) to point at a problem.
const PurchaseForm = forwardRef(function PurchaseForm({
  form, setForm, inventory = [], inventoryStatus = 'ready', catalog, canReprice = false, showErrors = false,
  brandId, suppliers = [], suppliersStatus = 'ready', insights, mode = 'record', editLines = null,
}, ref) {
  const [focusTarget, setFocusTarget] = useState(null)
  const [scanningId, setScanningId] = useState(null)
  const fieldRefs = useRef({})
  const stopScan = useRef(null)
  const editing = mode === 'edit'
  const today = todayDate()

  useImperativeHandle(ref, () => ({ focusLine: (id, field) => setFocusTarget({ id, field }) }), [])

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const setItem = (id, k, v) => setForm(p => ({ ...p, items: p.items.map(it => it.id === id ? { ...it, [k]: v } : it) }))
  const lockedLine = (id) => !!editLines?.[id]?.locked

  // Lines typed (or restored from a draft) before the catalog arrived are
  // linked once it does. Values the user already typed are kept, except a
  // selling price they are not allowed to change, which reverts to the
  // product's own rather than sitting in a read-only field the save ignores.
  useEffect(() => {
    if (inventoryStatus !== 'ready') return
    setForm(p => {
      let changed = false
      const items = p.items.map(it => {
        if (it.productId || !String(it.name).trim() || lockedLine(it.id)) return it
        const match = findProductForEntry(inventory, it.name)
        if (!match) return it
        changed = true
        const linked = { ...it, productId: match.id, name: match.name, barcode: match.barcode ? String(match.barcode).trim() : (it.barcode || '') }
        if (!canReprice) linked.sell = Number(match.price) > 0 ? String(match.price) : ''
        return linked
      })
      return changed ? { ...p, items } : p
    })
  }, [inventoryStatus, inventory, canReprice])

  useEffect(() => {
    if (!focusTarget) return
    fieldRefs.current[focusTarget.id + ':' + focusTarget.field]?.focus()
    setFocusTarget(null)
  }, [focusTarget])

  useEffect(() => () => stopScan.current?.(), [])

  function addItem() {
    const item = blankItem()
    setForm(p => ({ ...p, items: [...p.items, item] }))
    setFocusTarget({ id: item.id, field: 'name' })
  }

  function removeItem(id) {
    setForm(p => {
      const items = p.items.filter(it => it.id !== id)
      return { ...p, items: items.length ? items : [blankItem()] }
    })
  }

  // Typing, picking from the list or scanning a barcode into the product
  // field. An exact match links the line to that product and fills in its
  // details; anything else is a new product.
  function changeName(item, value) {
    const match = inventoryStatus === 'ready' ? findProductForEntry(inventory, value) : null
    // A pick from the suggestions (or a paste or scan) changes the value by
    // more than one character at once. Only then does focus jump to Quantity,
    // never while someone is still typing a longer name.
    const picked = Math.abs(value.length - item.name.length) > 1
    setForm(p => ({
      ...p,
      items: p.items.map(it => {
        if (it.id !== item.id) return it
        if (!match) return { ...it, name: value, productId: null }
        // Same product still: keep what was typed unless it was the barcode.
        if (match.id === it.productId) return { ...it, name: normalize(value) === normalize(match.name) ? value : match.name }
        return applyProduct(it, match)
      }),
    }))
    if (match && picked) setFocusTarget({ id: item.id, field: 'qty' })
  }

  // The barcode field: a scan or a typed code that belongs to a product links
  // the line to it (its details fill in); otherwise the code stays on the line
  // and is saved onto the product, which must not already have one.
  function changeBarcode(item, value) {
    const match = inventoryStatus === 'ready' ? findProductByBarcode(inventory, value) : null
    const picked = Math.abs(String(value).length - String(item.barcode || '').length) > 1
    setForm(p => ({
      ...p,
      items: p.items.map(it => {
        if (it.id !== item.id) return it
        if (match && match.id !== it.productId && !lockedLine(it.id)) return applyProduct(it, match)
        return { ...it, barcode: value }
      }),
    }))
    if (match && picked) setFocusTarget({ id: item.id, field: 'qty' })
  }

  function scan(item) {
    setScanningId(item.id)
    stopScan.current = startCameraScan({
      getVideo: () => document.getElementById('pi-cam-' + item.id),
      onCode: (code) => changeBarcode(item, code),
      onEnd: () => setScanningId(null),
      onError: () => setFocusTarget({ id: item.id, field: 'barcode' }),
    })
  }

  // Enter moves through the sheet like a spreadsheet: from the product field
  // to its quantity, from any other field to the next line's product, adding
  // a new line when this is the last one.
  function onLineKeyDown(e, index, field) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const item = form.items[index]
    if (field === 'name' || field === 'barcode') { setFocusTarget({ id: item.id, field: 'qty' }); return }
    const next = form.items[index + 1]
    if (next) setFocusTarget({ id: next.id, field: 'name' })
    else addItem()
  }

  const startedItems = form.items.filter(i => !isBlankItem(i))
  const draftLines = startedItems.length
  const computedTotal = formTotal(form)
  const paid = parseFloat(form.amountPaid) || 0
  const overpaid = editing && paid > computedTotal + 0.005
  const problemsByIdx = showErrors ? Object.fromEntries(formLineProblems(form, inventory, editLines).map(x => [x.idx, x.problems])) : {}
  const cameraAvailable = canScanWithCamera()

  // Autocomplete suggestions for the product-name inputs: existing catalogue
  // names, deduplicated, labelled with generic name and stock.
  const suggestions = []
  const seenNames = new Set()
  for (const p of inventory || []) {
    if (!p.name || seenNames.has(p.name)) continue
    seenNames.add(p.name)
    suggestions.push(p)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', alignItems: 'start' }}>
        <SupplierField id={editing ? 'edit-purchase-supplier' : 'purchase-supplier'} value={form.supplier} onChange={v => f('supplier', v)}
          suppliers={suppliers} status={suppliersStatus}
          error={showErrors && !String(form.supplier || '').trim() ? 'Enter the supplier name' : undefined} />
        <Inp label='Supply Date' id={editing ? 'edit-purchase-supply-date' : 'purchase-supply-date'} value={form.supplyDate} onChange={v => f('supplyDate', v)} type='date' max={today}
          error={showErrors && editing && !form.supplyDate ? 'Enter the supply date' : undefined} />
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
          <span id={editing ? 'edit-purchase-items-label' : 'purchase-items-label'} style={{ fontSize: '12px', fontWeight: '700', color: gray500 }}>ITEMS RECEIVED *</span>
          <span style={{ fontSize: '11px', color: gray400 }}>{draftLines} item{draftLines === 1 ? '' : 's'}</span>
        </div>

        {inventoryStatus === 'loading' && (
          <div role='status' style={{ fontSize: '12px', color: gray500, marginBottom: '8px' }}>Loading your products…</div>
        )}
        {inventoryStatus === 'error' && (
          <div role='alert' style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: '8px 12px', marginBottom: '8px', borderRadius: theme.radius.sm, background: dangerBg, border: `1px solid ${danger}`, fontSize: '12px', color: danger }}>
            <AlertTriangle size={14} aria-hidden='true' />
            <span style={{ flex: 1, minWidth: '160px' }}>Could not load your products, so existing items cannot be matched yet.</span>
            {catalog?.reload && <button type='button' onClick={() => catalog.reload()} style={{ border: `1px solid ${danger}`, background: 'white', color: danger, borderRadius: theme.radius.sm, padding: '4px 10px', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}>Retry</button>}
          </div>
        )}
        {inventoryStatus === 'ready' && (
          <div style={{ fontSize: '12px', color: gray500, marginBottom: '8px', lineHeight: 1.5 }}>
            Pick a product from your inventory, or scan or type its barcode, and its details fill in. Enter the quantity and change only what is different, then press Enter for the next item.
          </div>
        )}

        <div role='list' aria-labelledby={editing ? 'edit-purchase-items-label' : 'purchase-items-label'} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {form.items.map((item, i) => {
            const product = item.productId ? inventory.find(p => p.id === item.productId) : null
            const info = editLines?.[item.id] || null
            const locked = !!info?.locked
            const sameProduct = !!info?.product_id && info.product_id === item.productId
            const problems = problemsByIdx[i] || {}
            const hasProblems = Object.keys(problems).length > 0
            const qtyNum = Number(item.qty)
            const qtyValid = Number.isInteger(qtyNum) && qtyNum > 0
            const sub = (Number(item.qty) || 0) * (Number(item.cost) || 0)
            const priceLocked = !!product && (!canReprice || editing)
            const isService = (product?.category || product?.cat) === 'Services'
            const tracking = product?.tracking_mode || 'none'
            const productBarcode = product?.barcode ? String(product.barcode).trim() : ''
            // Live purchases show barcodes typed into "Batch no.". Offer to move it,
            // unless the product already has a different barcode (then the digits
            // may well be a real batch number).
            const batchIsBarcode = looksLikeBarcode(item.batch) && (productBarcode ? productBarcode === String(item.batch).trim() : !String(item.barcode || '').trim())
            // What saving does to this product's stock: the whole quantity for
            // a new line; when editing, only the difference from what it added.
            const stockDelta = !qtyValid ? null : (editing && sameProduct ? qtyNum - (Number(info.received) || 0) : qtyNum)
            const removable = !locked && !(sameProduct && Number(info.received) > Math.max(Number(info.product_stock) || 0, 0))
            const sameAs = !isBlankItem(item) && String(item.name).trim()
              ? form.items.findIndex((o, j) => j < i && (item.productId ? o.productId === item.productId : (!o.productId && normalize(o.name) === normalize(item.name))))
              : -1
            const fid = (k) => (editing ? 'epi-' : 'pi-') + item.id + '-' + k
            const reg = (k) => (el) => { fieldRefs.current[item.id + ':' + k] = el }
            const described = (k) => problems[k] ? fid(k) + '-error' : undefined
            return (
              <div key={item.id} role='listitem' aria-label={'Item ' + (i + 1) + (item.name ? ': ' + item.name : '')}
                style={{ padding: '12px', borderRadius: theme.radius.md, border: `1px solid ${hasProblems ? danger : gray100}`, background: bg }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                  <div style={{ width: '24px', height: '40px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '800', color: gray400 }} aria-hidden='true'>{i + 1}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <LineField id={fid('name')} label='Product' error={problems.name}>
                      <input id={fid('name')} ref={reg('name')} value={item.name} list={locked ? undefined : (editing ? 'edit-purchase-product-names' : 'purchase-product-names')} autoComplete='off'
                        onChange={e => changeName(item, e.target.value)} onKeyDown={e => onLineKeyDown(e, i, 'name')} readOnly={locked}
                        placeholder='Type, pick or scan e.g. Amoxicillin 500mg'
                        aria-invalid={!!problems.name} aria-describedby={described('name')}
                        style={lineInput(problems.name, locked)} />
                    </LineField>
                  </div>
                  <button type='button' onClick={() => removeItem(item.id)} disabled={!removable}
                    aria-label={'Remove item ' + (i + 1) + (item.name ? ' (' + item.name + ')' : '')}
                    title={removable ? undefined : locked ? 'This line is not linked to a product, so it cannot be removed here' : 'Some of these units are already sold, so the line cannot be removed'}
                    style={{ width: '40px', height: '40px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.md, border: 'none', background: 'transparent', color: removable ? gray400 : gray100, cursor: removable ? 'pointer' : 'not-allowed' }}>
                    <X size={16} />
                  </button>
                </div>

                {locked ? (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', margin: '8px 0 0 32px', fontSize: '12px', color: gray600 }}>
                    <Lock size={13} aria-hidden='true' style={{ marginTop: 2, flexShrink: 0 }} />
                    <span>Recorded before stock tracking under a name that matches no product, so its product and quantity cannot change here. You can still correct its prices, batch and dates.</span>
                  </div>
                ) : product ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', margin: '8px 0 0 32px', fontSize: '12px', color: gray600 }}>
                    <Package size={13} color={tealDeep} aria-hidden='true' />
                    <span style={{ fontWeight: '700', color: tealDeep }}>In inventory</span>
                    <span>· {product.category || product.cat || 'Uncategorised'}</span>
                    {product.generic_name && <span>· {product.generic_name}</span>}
                    {tracking !== 'none' && <span>· tracked by batch{tracking === 'batch_expiry' ? ' and expiry' : ''}</span>}
                    {!isService && (
                      <span>· Stock <strong style={{ color: navy }}>{product.stock || 0}</strong>{stockDelta != null && stockDelta !== 0 && <> → <strong style={{ color: stockDelta > 0 ? success : warning }}>{(product.stock || 0) + stockDelta}</strong> after saving</>}</span>
                    )}
                  </div>
                ) : String(item.name).trim() ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', margin: '8px 0 0 32px', fontSize: '12px', color: gray600 }}>
                    <span><strong style={{ fontWeight: '700', color: warning }}>New product</strong>, added to Inventory as</span>
                    <select value={item.cat} onChange={e => setItem(item.id, 'cat', e.target.value)} aria-label={'Category for item ' + (i + 1)}
                      style={{ padding: '4px 8px', borderRadius: theme.radius.sm, border: `1px solid ${border}`, fontSize: '12px', background: 'white', color: navy }}>
                      {PRODUCT_CATS.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                ) : null}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '8px', marginTop: '10px', marginLeft: '32px' }}>
                  <LineField id={fid('qty')} label='Quantity *' error={problems.qty}>
                    <input id={fid('qty')} ref={reg('qty')} value={item.qty} onChange={e => setItem(item.id, 'qty', e.target.value)} onKeyDown={e => onLineKeyDown(e, i, 'qty')}
                      type='number' inputMode='numeric' min={sameProduct ? info.min_qty || 1 : 1} step='1' placeholder='0' readOnly={locked}
                      aria-invalid={!!problems.qty} aria-describedby={[described('qty'), sameProduct && info.min_qty > 1 ? fid('qty') + '-min' : null].filter(Boolean).join(' ') || undefined}
                      style={lineInput(problems.qty, locked)} />
                  </LineField>
                  <LineField id={fid('cost')} label='Unit cost (₦) *' error={problems.cost}>
                    <input id={fid('cost')} ref={reg('cost')} value={item.cost} onChange={e => setItem(item.id, 'cost', e.target.value)} onKeyDown={e => onLineKeyDown(e, i, 'cost')}
                      type='number' inputMode='decimal' min='0' placeholder='0'
                      aria-invalid={!!problems.cost} aria-describedby={described('cost')} style={lineInput(problems.cost)} />
                  </LineField>
                  <LineField id={fid('sell')} label='Selling price (₦)'>
                    <input id={fid('sell')} ref={reg('sell')} value={item.sell} onChange={e => setItem(item.id, 'sell', e.target.value)} onKeyDown={e => onLineKeyDown(e, i, 'sell')}
                      type='number' inputMode='decimal' min='0' placeholder={product ? '0' : 'Auto +50%'} readOnly={priceLocked}
                      aria-describedby={priceLocked ? fid('sell') + '-locked' : undefined} style={lineInput(false, priceLocked)} />
                  </LineField>
                  <LineField id={fid('barcode')} label='Barcode' error={problems.barcode}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input id={fid('barcode')} ref={reg('barcode')} value={productBarcode || item.barcode || ''} onChange={e => changeBarcode(item, e.target.value)} onKeyDown={e => onLineKeyDown(e, i, 'barcode')}
                        inputMode='numeric' autoComplete='off' placeholder={cameraAvailable ? 'Scan or type' : 'Type or scan'} readOnly={!!productBarcode}
                        aria-invalid={!!problems.barcode} aria-describedby={described('barcode')} style={lineInput(problems.barcode, !!productBarcode)} />
                      {cameraAvailable && !productBarcode && (
                        <button type='button' onClick={() => scan(item)} aria-label={'Scan the barcode for item ' + (i + 1)}
                          style={{ width: 40, minHeight: 40, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.sm, border: `1px solid ${border}`, background: 'white', color: tealDeep, cursor: 'pointer' }}>
                          <ScanLine size={16} />
                        </button>
                      )}
                    </div>
                  </LineField>
                  <LineField id={fid('batch')} label={tracking !== 'none' ? 'Batch no. *' : 'Batch no.'} error={problems.batch}>
                    <input id={fid('batch')} ref={reg('batch')} value={item.batch} onChange={e => setItem(item.id, 'batch', e.target.value)} onKeyDown={e => onLineKeyDown(e, i, 'batch')}
                      placeholder={tracking !== 'none' ? 'Required' : 'Optional'} aria-invalid={!!problems.batch} aria-describedby={described('batch')} style={lineInput(problems.batch)} />
                  </LineField>
                  <LineField id={fid('expiry')} label={tracking === 'batch_expiry' ? 'Expiry date *' : 'Expiry date'} error={problems.expiry}>
                    <input id={fid('expiry')} ref={reg('expiry')} value={item.expiry} onChange={e => setItem(item.id, 'expiry', e.target.value)} onKeyDown={e => onLineKeyDown(e, i, 'expiry')}
                      type='date' aria-invalid={!!problems.expiry} aria-describedby={described('expiry')} style={lineInput(problems.expiry)} />
                  </LineField>
                </div>

                {scanningId === item.id && (
                  <div style={{ marginTop: 10, marginLeft: 32, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <video id={'pi-cam-' + item.id} muted playsInline aria-label='Camera view for scanning a barcode'
                      style={{ width: '100%', maxWidth: 320, borderRadius: theme.radius.md, background: '#000' }} />
                    <button type='button' onClick={() => stopScan.current?.()}
                      style={{ alignSelf: 'flex-start', padding: '6px 12px', borderRadius: theme.radius.sm, border: `1px solid ${border}`, background: 'white', color: gray600, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                      Stop scanning
                    </button>
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginTop: '8px', marginLeft: '32px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '11.5px', flex: '1 1 220px', minWidth: 0 }}>
                    {priceLocked && <span id={fid('sell') + '-locked'} style={{ color: gray500 }}>{editing ? 'Selling prices of existing products are changed in Inventory.' : 'Selling price can only be changed by roles with price permission.'}</span>}
                    {sameProduct && info.min_qty > 1 && (
                      <span id={fid('qty') + '-min'} style={{ color: gray500 }}>{(Number(info.received) || 0) - Math.max(Number(info.product_stock) || 0, 0)} of the {info.received} from this purchase are already sold: the lowest quantity is {info.min_qty}.</span>
                    )}
                    {batchIsBarcode && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', color: warning, fontWeight: 700 }}>
                        <AlertTriangle size={12} aria-hidden='true' /> The batch number looks like a barcode.
                        <button type='button' onClick={() => { const code = String(item.batch).trim(); setItem(item.id, 'batch', ''); if (!productBarcode) changeBarcode({ ...item, batch: '' }, code) }}
                          style={{ padding: '2px 8px', borderRadius: theme.radius.sm, border: `1px solid ${warning}`, background: 'white', color: navy, fontWeight: 700, fontSize: 11.5, cursor: 'pointer' }}>
                          {productBarcode && productBarcode === String(item.batch).trim() ? 'It is the barcode: clear it' : 'Move it to Barcode'}
                        </button>
                      </span>
                    )}
                    {isPastExpiry(item, today) && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: warning, fontWeight: '700' }}><AlertTriangle size={12} aria-hidden='true' /> This expiry date has already passed: check the year.</span>}
                    {sameAs >= 0 && <span style={{ color: gray500 }}>Same product as line {sameAs + 1}: stock is combined, each batch is kept separately.</span>}
                    {product && insights && brandId && <ProductInsight id={fid('insight')} brandId={brandId} product={product} cost={item.cost} insights={insights} />}
                  </div>
                  <span style={{ fontSize: '12px', fontWeight: '700', color: sub > 0 ? tealDeep : gray400, marginLeft: 'auto' }}>{sub > 0 ? 'Subtotal: ' + fmt(sub) : 'Not set'}</span>
                </div>
              </div>
            )
          })}
        </div>

        <button type='button' onClick={addItem} style={{ width: '100%', marginTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', minHeight: '44px', borderRadius: theme.radius.md, border: `1px dashed ${tealDeep}`, background: tealMist, color: tealDeep, fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>
          <Plus size={15} aria-hidden='true' /> Add another item
        </button>
      </div>

      <datalist id={editing ? 'edit-purchase-product-names' : 'purchase-product-names'}>
        {suggestions.map(p => {
          const isSvc = (p.category || p.cat) === 'Services'
          const label = [p.generic_name, isSvc ? null : (p.stock || 0) + ' in stock', p.barcode ? 'barcode ' + p.barcode : null].filter(Boolean).join(' · ')
          return <option key={p.id} value={p.name}>{label}</option>
        })}
      </datalist>

      <div style={{ padding: '10px 14px', borderRadius: theme.radius.md, background: bg, display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
        <span style={{ color: gray500 }}>Total Cost (auto)</span>
        <span style={{ fontWeight: '900', color: navy }}>{fmt(computedTotal)}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
        <Inp label='Amount Paid (₦)' id={editing ? 'edit-purchase-amount-paid' : 'purchase-amount-paid'} value={form.amountPaid} onChange={v => f('amountPaid', v)} type='number' placeholder='0'
          error={overpaid ? 'More than the total. Lower it, or record the refund from the supplier first.' : undefined}
          helperText={editing ? 'A change is recorded in the payment history as a correction.' : undefined} />
        <Inp label='Payment Due Date' id={editing ? 'edit-purchase-due-date' : 'purchase-due-date'} value={form.dueDate} onChange={v => f('dueDate', v)} type='date' />
      </div>
      {computedTotal > 0 && (
        <div style={{ padding: '10px 14px', borderRadius: theme.radius.md, background: bg, display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
          <span style={{ color: gray500 }}>Balance remaining</span>
          <span style={{ fontWeight: '900', color: Math.max(0, computedTotal - paid) > 0 ? danger : success }}>{fmt(Math.max(0, computedTotal - paid))}</span>
        </div>
      )}
      <Textarea label='Notes' id={editing ? 'edit-purchase-notes' : 'purchase-notes'} value={form.notes} onChange={v => f('notes', v)} placeholder='Invoice number, delivery notes...' rows={2} />

      <div style={{ padding: '10px 14px', borderRadius: theme.radius.md, background: tealMist, border: `1px solid ${tealDeep}`, fontSize: '12px', color: tealDeep, lineHeight: '1.7' }}>
        {editing
          ? 'Saving moves stock by the difference on each line (removed lines give their units back, new lines add theirs), updates the supplier debt and the payment history, and records who changed what and why.'
          : 'Saving adds every item to Inventory: existing products get the extra stock and the new unit cost; new products are created with your selling price (or a 50% markup if left blank). A barcode entered for a product without one is saved on it. Batch and expiry details create a stock batch for expiry tracking.'}
      </div>
    </div>
  )
})

export default PurchaseForm
