import { useState, useMemo, useRef } from 'react'
import { Search, Plus, Minus, Package } from 'lucide-react'
import { stockValidationRepository } from './repositories'
import { useAuth } from '../../providers/AuthProvider'
import { authClient } from '../../lib/authClient'
import { theme } from '../../styles/theme'
import { Pill, Modal, GhostBtn, TealBtn, Empty, useToast, Toast } from '../../components/ui'
import { fmt } from '../../lib/utils'

const REASONS = [
  'Physical stock discrepancy',
  'Damaged stock',
  'Expired stock',
  'Missing stock',
  'Excess stock found',
  'Returned stock',
  'Data correction',
  'Other',
]

// ── Pure helpers (exported for tests / parity verification) ────────────────
export function parseAdjustmentQty(val) {
  const parsed = parseInt(val, 10)
  const n = Number.isNaN(parsed) ? 0 : parsed
  return Math.max(0, Math.min(n, 10000))
}

export function buildValidationItems(worksheet) {
  return worksheet.map(w => {
    const qty = parseAdjustmentQty(w.adjustmentQty)
    const prev = Math.max(0, parseInt(w.currentStock, 10) || 0)
    const rawNewStock = w.direction === '+' ? prev + qty : prev - qty
    const newStock = Math.min(rawNewStock, 10000)
    return {
      product_id: w.product.id,
      product_name: w.product.name,
      shelf_label: w.product.shelf_label || null,
      previous_stock: prev,
      adjustment_qty: qty,
      adjustment_direction: w.direction === '-' ? '-' : '+',
      new_stock: newStock,
      reason: w.reason || null,
      unit_price: w.product.price,
    }
  })
}

export default function StockValidation({ brand, products, loadProducts }) {
  const { auth } = useAuth()
  const { msg: toastMsg, type: toastType, show: showToast } = useToast()
  const [worksheet, setWorksheet] = useState([])
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [showSummary, setShowSummary] = useState(false)
  const [saving, setSaving] = useState(false)
  const [inlineError, setInlineError] = useState('')
  const rowRefs = useRef({})

  const categories = useMemo(() => {
    const cats = new Set(products.map(p => p.cat || p.category))
    return ['All', ...Array.from(cats).sort()]
  }, [products])

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const pCat = p.cat || p.category || ''
      if (categoryFilter !== 'All' && pCat !== categoryFilter) return false
      if (search) {
        const q = search.toLowerCase()
        const inName = (p.name || '').toLowerCase().includes(q)
        const inGeneric = (p.generic_name || '').toLowerCase().includes(q)
        const inBarcode = (p.barcode || '').toLowerCase().includes(q)
        if (!inName && !inGeneric && !inBarcode) return false
      }
      return true
    })
  }, [products, categoryFilter, search])

  function addProduct(product) {
    const alreadyExists = worksheet.some(w => w.product.id === product.id)
    if (alreadyExists) {
      showToast('This product is already on the validation screen', { type: 'warning' })
      const rowIndex = worksheet.findIndex(w => w.product.id === product.id)
      const rowEl = rowRefs.current[rowIndex]
      if (rowEl) {
        rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
        rowEl.style.transition = 'background 0.3s'
        rowEl.style.background = theme.warningBg
        setTimeout(() => { rowEl.style.background = '' }, 1500)
      }
      return
    }
    setWorksheet([...worksheet, {
      product,
      currentStock: product.stock,
      adjustmentQty: 0,
      direction: '+',
      reason: '',
    }])
  }

  function addAllInCategory() {
    const newItems = filteredProducts.filter(p =>
      !worksheet.some(w => w.product.id === p.id)
    ).map(p => ({
      product: p,
      currentStock: p.stock,
      adjustmentQty: 0,
      direction: '+',
      reason: '',
    }))
    if (newItems.length === 0) {
      showToast('All products in this category are already on the worksheet', { type: 'info' })
      return
    }
    setWorksheet([...worksheet, ...newItems])
    showToast(`Added ${newItems.length} product(s)`, { type: 'success' })
  }

  function updateWorksheetItem(index, updates) {
    setWorksheet(worksheet.map((item, i) => i === index ? { ...item, ...updates } : item))
    if (inlineError) setInlineError('')
  }

  function adjustQty(index, delta) {
    const item = worksheet[index]
    const current = parseAdjustmentQty(item.adjustmentQty)
    const newQty = Math.max(0, Math.min(current + delta, 10000))
    updateWorksheetItem(index, { adjustmentQty: newQty })
  }

  async function confirmSave() {
    if (saving) return
    if (!brand?.id) {
      showToast('Missing business — please reload and try again', { type: 'error' })
      return
    }

    const rawItems = buildValidationItems(worksheet)
    const negative = rawItems.find(it => it.new_stock < 0)
    if (negative) {
      setInlineError('Cannot go below 0')
      showToast('Cannot go below 0 — check adjustment quantities', { type: 'error' })
      return
    }
    setInlineError('')
    const items = rawItems.filter(it => it.adjustment_qty !== 0)

    // Pre-save session check: ensure auth is fresh, otherwise laptop would fall back to anon and get RLS 42501
    try {
      const { data: { session } } = await authClient.auth.getSession()
      if (!session) {
        try {
          const { data: refreshed } = await authClient.auth.refreshSession()
          if (!refreshed?.session) {
            showToast('Session expired, please re-login', { type: 'error' })
            return
          }
        } catch {
          showToast('Session expired, please re-login', { type: 'error' })
          return
        }
      }
    } catch {
      showToast('Session expired, please re-login', { type: 'error' })
      return
    }

    setSaving(true)
    try {
      await stockValidationRepository.saveSession(
        brand.id,
        {
          user_name: auth.staff?.full_name || 'Owner',
          products_checked: worksheet.length,
          products_adjusted: worksheet.filter(w => parseAdjustmentQty(w.adjustmentQty) > 0).length,
        },
        items,
        auth.staff?.id || null
      )
      showToast('Validation saved successfully', { type: 'success' })
      setWorksheet([])
      setShowSummary(false)
      setInlineError('')
      if (typeof loadProducts === 'function') loadProducts()
    } catch (error) {
      const msg = error?.message || String(error)
      const code = String(error?.code || '')
      const isCheckViolation = msg.includes('23514') || code === '23514'
      if (isCheckViolation) {
        showToast('Quantity cannot be negative — was blocked', { type: 'error' })
      } else {
        const isAuthError = msg.includes('42501') || code === '42501' || /permission|not authenticated|JWT|auth|not allowed/i.test(msg)
        if (isAuthError) {
        // Retry once after refreshSession — covers laptop stale session case
        try {
          const { data: refreshed } = await authClient.auth.refreshSession()
          if (refreshed?.session) {
            await stockValidationRepository.saveSession(
              brand.id,
              {
                user_name: auth.staff?.full_name || 'Owner',
                products_checked: worksheet.length,
                products_adjusted: worksheet.filter(w => parseAdjustmentQty(w.adjustmentQty) > 0).length,
              },
              items,
              auth.staff?.id || null
            )
            showToast('Validation saved successfully', { type: 'success' })
            setWorksheet([])
            setShowSummary(false)
            setInlineError('')
            if (typeof loadProducts === 'function') loadProducts()
            return
          }
        } catch {}
        showToast('Session expired, please re-login', { type: 'error' })
        } else {
          showToast('Could not save validation: ' + msg, { type: 'error' })
        }
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '200px', display: 'flex', alignItems: 'center', gap: 8, background: 'white', border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, padding: '0 14px' }}>
            <Search size={15} color={theme.gray400} style={{ flexShrink: 0 }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder='Search products...'
              style={{ flex: 1, padding: '10px 0', border: 'none', fontSize: '13px', outline: 'none', background: 'transparent', color: theme.navy, minWidth: 0 }} />
          </div>
          {categoryFilter !== 'All' && (
            <TealBtn onClick={addAllInCategory}>Add All in {categoryFilter}</TealBtn>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
          {categories.map(c => {
            const on = categoryFilter === c
            return (
              <button key={c} onClick={() => setCategoryFilter(c)}
                style={{ padding: '8px 14px', borderRadius: theme.radius.full, border: `1px solid ${on ? theme.tealDeep : theme.border}`, cursor: 'pointer', fontSize: '12px', fontWeight: '700', background: on ? theme.tealDeep : 'white', color: on ? 'white' : theme.gray600 }}>
                {c}
              </button>
            )
          })}
        </div>
        {filteredProducts.length > 0 && (
          <div style={{ maxHeight: '300px', overflowY: 'auto', border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, background: 'white' }}>
            {filteredProducts.slice(0, 20).map(p => (
              <div key={p.id} onClick={() => addProduct(p)}
                style={{ padding: '12px', borderBottom: `1px solid ${theme.gray100}`, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: '700', fontSize: '13px', color: theme.navy }}>{p.name}</div>
                  {p.generic_name && <div style={{ fontSize: '12px', color: theme.gray500 }}>{p.generic_name}</div>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '13px', fontWeight: '700' }}>{fmt(p.price)}</div>
                  <div style={{ fontSize: '12px', color: theme.gray500 }}>Stock: {p.stock}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {worksheet.length === 0 ? (
        <Empty icon={<Package size={80} />} message="Search or choose a category to start your stock validation" />
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
            {worksheet.map((item, index) => {
              const hasChange = parseAdjustmentQty(item.adjustmentQty) > 0
              const bg = !hasChange ? 'white' : item.direction === '+' ? theme.successBg : theme.dangerBg
              const qtyParsed = parseAdjustmentQty(item.adjustmentQty)
              const rawComputedNewStock = item.direction === '+' ? Math.max(0, parseInt(item.currentStock,10)||0) + qtyParsed : Math.max(0, parseInt(item.currentStock,10)||0) - qtyParsed
              const computedNewStock = Math.min(rawComputedNewStock, 10000)
              const isNegative = computedNewStock < 0
              const errorId = `stock-validation-error-${index}`
              const showInlineError = isNegative || (inlineError && hasChange)
              return (
                <div key={item.product.id} ref={el => rowRefs.current[index] = el}
                  style={{ padding: '16px', borderRadius: theme.radius.lg, border: `1px solid ${isNegative ? theme.danger : theme.border}`, background: bg }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                    <div>
                      <div style={{ fontWeight: '800', fontSize: '15px', color: theme.navy }}>{item.product.name}</div>
                      {item.product.shelf_label && <div style={{ fontSize: '12px', color: theme.gray500, marginTop: '2px' }}>Shelf: {item.product.shelf_label}</div>}
                      <Pill label={item.product.cat || item.product.category} type="teal" />
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: theme.navy }}>Current Stock: {item.currentStock}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                    <button onClick={() => adjustQty(index, -1)} aria-label="Decrease quantity"
                      style={{ width: '36px', height: '36px', borderRadius: theme.radius.md, border: `1px solid ${theme.border}`, background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Minus size={18} />
                    </button>
                    <input type="number" value={item.adjustmentQty}
                      onChange={e => {
                        const parsed = parseAdjustmentQty(e.target.value)
                        updateWorksheetItem(index, { adjustmentQty: parsed })
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                        }
                      }}
                      aria-label="Adjustment quantity"
                      aria-describedby={showInlineError ? errorId : undefined}
                      id={`adjustment-qty-${index}`}
                      style={{ width: '80px', padding: '8px', borderRadius: theme.radius.md, border: `1px solid ${isNegative ? theme.danger : theme.border}`, fontSize: '16px', fontWeight: '700', textAlign: 'center' }} />
                    <button onClick={() => adjustQty(index, 1)} aria-label="Increase quantity"
                      style={{ width: '36px', height: '36px', borderRadius: theme.radius.md, border: `1px solid ${theme.border}`, background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Plus size={18} />
                    </button>
                    <select value={item.direction} onChange={e => updateWorksheetItem(index, { direction: e.target.value })}
                      aria-label={`Adjustment direction for ${item.product.name}`}
                      style={{ padding: '8px 12px', borderRadius: theme.radius.md, border: `1px solid ${theme.border}`, fontSize: '13px', fontWeight: '700' }}>
                      <option value="+">Add</option>
                      <option value="-">Remove</option>
                    </select>
                  </div>
                  {isNegative && (
                    <div id={errorId} role="alert" style={{ color: theme.danger, fontSize: '12px', fontWeight: '700', marginBottom: '8px' }}>{inlineError || 'Cannot go below 0'}</div>
                  )}
                  {!isNegative && inlineError && hasChange && (
                    <div id={errorId} role="alert" style={{ color: theme.danger, fontSize: '12px', fontWeight: '700', marginBottom: '8px' }}>{inlineError}</div>
                  )}
                  <div style={{ display: 'flex', gap: '20px', marginBottom: '12px', fontSize: '13px', flexWrap: 'wrap' }}>
                    <div>Unit Price: <strong>{fmt(item.product.price)}</strong></div>
                    <div>Subtotal: <strong>{fmt(qtyParsed * item.product.price)}</strong></div>
                    <div aria-live="polite">New Stock: <strong style={{ color: isNegative ? theme.danger : theme.navy }}>{computedNewStock}</strong></div>
                  </div>
                  <select value={item.reason} onChange={e => updateWorksheetItem(index, { reason: e.target.value })}
                    aria-label={`Reason for ${item.product.name}`}
                    style={{ width: '100%', padding: '10px', borderRadius: theme.radius.md, border: `1px solid ${theme.border}`, fontSize: '13px' }}>
                    <option value="">Select reason...</option>
                    {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <TealBtn onClick={() => setShowSummary(true)} style={{ padding: '12px 24px', fontSize: '14px' }}>Save Validation</TealBtn>
          </div>
        </>
      )}

      <Modal show={showSummary} onClose={() => setShowSummary(false)} title="Validation Summary">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
            <div style={{ padding: '12px', borderRadius: theme.radius.md, background: theme.gray50 }}>
              <div style={{ fontSize: '12px', color: theme.gray500 }}>Products checked</div>
              <div style={{ fontSize: '24px', fontWeight: '900', color: theme.navy }}>{worksheet.length}</div>
            </div>
            <div style={{ padding: '12px', borderRadius: theme.radius.md, background: theme.gray50 }}>
              <div style={{ fontSize: '12px', color: theme.gray500 }}>Products adjusted</div>
              <div style={{ fontSize: '24px', fontWeight: '900', color: theme.navy }}>{worksheet.filter(w => parseAdjustmentQty(w.adjustmentQty) > 0).length}</div>
            </div>
            <div style={{ padding: '12px', borderRadius: theme.radius.md, background: theme.successBg }}>
              <div style={{ fontSize: '12px', color: theme.gray500 }}>Excess</div>
              <div style={{ fontSize: '24px', fontWeight: '900', color: theme.success }}>{worksheet.filter(w => w.direction === '+' && parseAdjustmentQty(w.adjustmentQty) > 0).length}</div>
            </div>
            <div style={{ padding: '12px', borderRadius: theme.radius.md, background: theme.dangerBg }}>
              <div style={{ fontSize: '12px', color: theme.gray500 }}>Shortage</div>
              <div style={{ fontSize: '24px', fontWeight: '900', color: theme.danger }}>{worksheet.filter(w => w.direction === '-' && parseAdjustmentQty(w.adjustmentQty) > 0).length}</div>
            </div>
          </div>
          {inlineError && (
            <div id="stock-validation-inline-error" role="alert" style={{ color: theme.danger, fontSize: '13px', fontWeight: '700', textAlign: 'center' }}>{inlineError}</div>
          )}
          <div style={{ display: 'flex', gap: '10px' }}>
            <GhostBtn onClick={() => setShowSummary(false)} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
            <TealBtn onClick={confirmSave} disabled={saving} aria-busy={saving || undefined} style={{ flex: 1, padding: '12px' }}>{saving ? 'Saving...' : 'Save Validation'}</TealBtn>
          </div>
        </div>
      </Modal>

      <Toast msg={toastMsg} type={toastType} />
    </>
  )
}
