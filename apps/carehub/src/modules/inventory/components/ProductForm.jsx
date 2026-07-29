import { useState } from 'react'
import { X } from 'lucide-react'
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
    is_active: true,
  })

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.name.trim()) {
      toast.show('Product name is required', { type: 'error' })
      return
    }
    onSubmit(form)
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: theme.navy }}>Product Name *</label>
          <Inp value={form.name} onChange={e => handleChange('name', e.target.value)} placeholder="e.g. Amoxicillin 500mg" />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: theme.navy }}>Generic Name</label>
          <Inp value={form.generic_name} onChange={e => handleChange('generic_name', e.target.value)} placeholder="e.g. Amoxicillin" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: theme.navy }}>Brand</label>
          <Inp value={form.brand} onChange={e => handleChange('brand', e.target.value)} placeholder="e.g. GSK" />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: theme.navy }}>Category *</label>
          <Sel value={form.category} onChange={e => { handleChange('category', e.target.value); handleChange('cat', e.target.value) }}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </Sel>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: theme.navy }}>Cost Price (₦)</label>
          <Inp type="number" step="0.01" value={form.cost_price} onChange={e => handleChange('cost_price', e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: theme.navy }}>Selling Price (₦)</label>
          <Inp type="number" step="0.01" value={form.selling_price} onChange={e => handleChange('selling_price', e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: theme.navy }}>Initial Stock</label>
          <Inp type="number" min="0" value={form.stock} onChange={e => handleChange('stock', parseInt(e.target.value) || 0)} placeholder="0" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: theme.navy }}>Reorder Level</label>
          <Inp type="number" min="0" value={form.reorder_level} onChange={e => handleChange('reorder_level', parseInt(e.target.value) || 5)} placeholder="5" />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: theme.navy }}>Unit</label>
          <Inp value={form.unit} onChange={e => handleChange('unit', e.target.value)} placeholder="pcs" />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: theme.navy }}>Barcode</label>
          <Inp value={form.barcode} onChange={e => handleChange('barcode', e.target.value)} placeholder="Optional" />
        </div>
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4, color: theme.navy }}>Description</label>
        <Textarea value={form.description} onChange={e => handleChange('description', e.target.value)} rows={3} placeholder="Optional description..." />
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