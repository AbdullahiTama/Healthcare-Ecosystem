import { useState, useMemo, useRef } from 'react'
import { Search, Plus, Minus, Package } from 'lucide-react'
import { stockValidationRepository } from './repositories'
import { useAuth } from '../../providers/AuthProvider'
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

export default function StockValidation({ brand, products, loadProducts }) {
  const { auth } = useAuth()
  const { msg: toastMsg, type: toastType, show: showToast } = useToast()
  const [worksheet, setWorksheet] = useState([])
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [showSummary, setShowSummary] = useState(false)
  const [saving, setSaving] = useState(false)
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
  }

  function adjustQty(index, delta) {
    const item = worksheet[index]
    const newQty = Math.max(0, item.adjustmentQty + delta)
    updateWorksheetItem(index, { adjustmentQty: newQty })
  }

  async function confirmSave() {
    setSaving(true)
    try {
      const items = worksheet.map(w => ({
        product_id: w.product.id,
        product_name: w.product.name,
        shelf_label: w.product.shelf_label,
        previous_stock: w.currentStock,
        adjustment_qty: w.adjustmentQty,
        adjustment_direction: w.direction,
        new_stock: w.direction === '+' ? w.currentStock + w.adjustmentQty : w.currentStock - w.adjustmentQty,
        reason: w.reason,
        unit_price: w.product.price,
      }))
      await stockValidationRepository.saveSession(
        brand.id,
        {
          user_name: auth.staff?.full_name || 'Owner',
          products_checked: worksheet.length,
          products_adjusted: worksheet.filter(w => w.adjustmentQty > 0).length,
        },
        items,
        auth.staff?.id || null
      )
      showToast('Validation saved successfully', { type: 'success' })
      setWorksheet([])
      setShowSummary(false)
      loadProducts()
    } catch (error) {
      showToast('Could not save validation: ' + error.message, { type: 'error' })
    }
    setSaving(false)
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
              const hasChange = item.adjustmentQty > 0
              const bg = !hasChange ? 'white' : item.direction === '+' ? theme.successBg : theme.dangerBg
              return (
                <div key={item.product.id} ref={el => rowRefs.current[index] = el}
                  style={{ padding: '16px', borderRadius: theme.radius.lg, border: `1px solid ${theme.border}`, background: bg }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                    <div>
                      <div style={{ fontWeight: '800', fontSize: '15px', color: theme.navy }}>{item.product.name}</div>
                      {item.product.shelf_label && <div style={{ fontSize: '12px', color: theme.gray500, marginTop: '2px' }}>Shelf: {item.product.shelf_label}</div>}
                      <Pill label={item.product.cat || item.product.category} type="teal" />
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: theme.navy }}>Current Stock: {item.currentStock}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                    <button onClick={() => adjustQty(index, -1)}
                      style={{ width: '36px', height: '36px', borderRadius: theme.radius.md, border: `1px solid ${theme.border}`, background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Minus size={18} />
                    </button>
                    <input type="number" value={item.adjustmentQty}
                      onChange={e => updateWorksheetItem(index, { adjustmentQty: Math.max(0, parseInt(e.target.value) || 0) })}
                      style={{ width: '80px', padding: '8px', borderRadius: theme.radius.md, border: `1px solid ${theme.border}`, fontSize: '16px', fontWeight: '700', textAlign: 'center' }} />
                    <button onClick={() => adjustQty(index, 1)}
                      style={{ width: '36px', height: '36px', borderRadius: theme.radius.md, border: `1px solid ${theme.border}`, background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Plus size={18} />
                    </button>
                    <select value={item.direction} onChange={e => updateWorksheetItem(index, { direction: e.target.value })}
                      style={{ padding: '8px 12px', borderRadius: theme.radius.md, border: `1px solid ${theme.border}`, fontSize: '13px', fontWeight: '700' }}>
                      <option value="+">Add</option>
                      <option value="-">Remove</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: '20px', marginBottom: '12px', fontSize: '13px', flexWrap: 'wrap' }}>
                    <div>Unit Price: <strong>{fmt(item.product.price)}</strong></div>
                    <div>Subtotal: <strong>{fmt(item.adjustmentQty * item.product.price)}</strong></div>
                  </div>
                  <select value={item.reason} onChange={e => updateWorksheetItem(index, { reason: e.target.value })}
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
              <div style={{ fontSize: '24px', fontWeight: '900', color: theme.navy }}>{worksheet.filter(w => w.adjustmentQty > 0).length}</div>
            </div>
            <div style={{ padding: '12px', borderRadius: theme.radius.md, background: theme.successBg }}>
              <div style={{ fontSize: '12px', color: theme.gray500 }}>Excess</div>
              <div style={{ fontSize: '24px', fontWeight: '900', color: theme.success }}>{worksheet.filter(w => w.direction === '+' && w.adjustmentQty > 0).length}</div>
            </div>
            <div style={{ padding: '12px', borderRadius: theme.radius.md, background: theme.dangerBg }}>
              <div style={{ fontSize: '12px', color: theme.gray500 }}>Shortage</div>
              <div style={{ fontSize: '24px', fontWeight: '900', color: theme.danger }}>{worksheet.filter(w => w.direction === '-' && w.adjustmentQty > 0).length}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <GhostBtn onClick={() => setShowSummary(false)} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
            <TealBtn onClick={confirmSave} style={{ flex: 1, padding: '12px' }}>{saving ? 'Saving...' : 'Save Validation'}</TealBtn>
          </div>
        </div>
      </Modal>

      <Toast msg={toastMsg} type={toastType} />
    </>
  )
}
