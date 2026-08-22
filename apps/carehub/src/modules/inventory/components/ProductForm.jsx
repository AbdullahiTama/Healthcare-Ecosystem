import { useState } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { Card, Inp, Sel, Textarea, TealBtn, GhostBtn, useToast } from '../../../components/ui'
import { theme } from '../../../styles/theme'

const CATEGORIES = [
  'Prescription Drugs', 'OTC Drugs', 'Supplements', 'Medical Devices',
  'Consumables', 'Diagnostics', 'Services', 'Other'
]

export function ProductForm({ product, onClose, onSubmit, isLoading }) {
  const toast = useToast()
  const [form, setForm] = useState({
    name: '',
    generic_name: '',
    brand: '',
    category: CATEGORIES[0],
    cat: CATEGORIES[0],
    cost_price: '',
    selling_price: '',
    stock: 0,
    reorder_level: 5,
    unit: 'pcs',
    barcode: '',
    description: '',
    expiry_date: product?.expiry_date || '',
    is_active: true,
  })

  const isEdit = !!product
  // Non-blocking reminder: a product being edited with no expiry date cannot
  // feed expiry alerts/reports. The user is nudged to add one, but saving is
  // never blocked — expiry stays optional across every business type.
  const missingExpiry = isEdit && !form.expiry_date

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.name.trim()) {
      toast.show('Product name is required', { type: 'error' })
      return
    }
    // expiry_date is optional: blank -> null so it stays nullable on products.
    onSubmit({ ...form, expiry_date: form.expiry_date || null })
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: theme.navy }}>Product Name *</label>
          <Inp value={form.name} onChange={v => handleChange('name', v)} placeholder="e.g. Amoxicillin 500mg" />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: theme.navy }}>Generic Name</label>
          <Inp value={form.generic_name} onChange={v => handleChange('generic_name', v)} placeholder="e.g. Amoxicillin" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: theme.navy }}>Brand</label>
          <Inp value={form.brand} onChange={v => handleChange('brand', v)} placeholder="e.g. GSK" />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: theme.navy }}>Category *</label>
          <Sel value={form.category} onChange={v => { handleChange('category', v); handleChange('cat', v) }}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </Sel>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: theme.navy }}>Cost Price (₦)</label>
          <Inp type="number" step="0.01" value={form.cost_price} onChange={v => handleChange('cost_price', v)} placeholder="0.00" />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: theme.navy }}>Selling Price (₦)</label>
          <Inp type="number" step="0.01" value={form.selling_price} onChange={v => handleChange('selling_price', v)} placeholder="0.00" />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: theme.navy }}>Initial Stock</label>
          <Inp type="number" min="0" value={form.stock} onChange={v => handleChange('stock', parseInt(v) || 0)} placeholder="0" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: theme.navy }}>Reorder Level</label>
          <Inp type="number" min="0" value={form.reorder_level} onChange={v => handleChange('reorder_level', parseInt(v) || 5)} placeholder="5" />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: theme.navy }}>Unit</label>
          <Inp value={form.unit} onChange={v => handleChange('unit', v)} placeholder="pcs" />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: theme.navy }}>Barcode</label>
          <Inp value={form.barcode} onChange={v => handleChange('barcode', v)} placeholder="Optional" />
        </div>
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: theme.navy }}>Description</label>
        <Textarea value={form.description} onChange={v => handleChange('description', v)} rows={3} placeholder="Optional description..." />
      </div>

      {missingExpiry && (
        <div role="status" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '12px 14px', borderRadius: '10px', background: theme.warningBg, border: `1px solid ${theme.warning}`, fontSize: '13px', color: theme.warning, lineHeight: 1.6 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>No expiry date set — add one below to enable expiry alerts and reports.</span>
        </div>
      )}

      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: theme.navy }}>Expiry Date <span style={{ fontWeight: 400, color: theme.gray400 }}>(optional)</span></label>
        <Inp type="date" value={form.expiry_date} onChange={v => handleChange('expiry_date', v)} placeholder="Optional" aria-label="Expiry date" />
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <GhostBtn onClick={onClose} disabled={isLoading}>Cancel</GhostBtn>
        <TealBtn type="submit" disabled={isLoading} style={{ padding: '12px 24px' }}>
          {isLoading ? 'Saving...' : product ? 'Update Product' : 'Add Product'}
        </TealBtn>
      </div>
    </form>
  )
}