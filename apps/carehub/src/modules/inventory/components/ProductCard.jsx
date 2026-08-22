import { X, Edit, Trash2, Package, Clipboard, AlertTriangle, ArrowRight, Search } from 'lucide-react'
import { useState } from 'react'
import { Card, TealBtn, GhostBtn, Pill, Modal, useToast } from '../../../components/ui'
import { theme } from '../../../styles/theme'

const productIcon = (p) => ((p.cat || p.category) === 'Services' ? Clipboard : Package)

export function ProductCard({ product, onEdit, onDelete, onRestock, onToggleCareFind, role, perms }) {
  const toast = useToast()
  const [showDelete, setShowDelete] = useState(false)

  const isService = (product.cat || product.category) === 'Services'
  const isLowStock = !isService && product.stock > 0 && product.stock <= (product.reorder_level || 5)
  const isOutOfStock = !isService && product.stock <= 0

  const statusBadge = isService ? (
    <Pill color={theme.info}>Service</Pill>
  ) : isOutOfStock ? (
    <Pill color={theme.danger}>Out of Stock</Pill>
  ) : isLowStock ? (
    <Pill color={theme.warning}>Low Stock</Pill>
  ) : (
    <Pill color={theme.success}>In Stock</Pill>
  )

  const canManage = perms?.inventory_write || perms?.all || role === 'owner'

  return (
    <Card style={{ background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ 
          width: 56, height: 56, borderRadius: 12, 
          background: isService ? `${theme.info}15` : `${theme.tealDeep}15`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
        }}>
          {isService ? <Clipboard size={24} color={theme.info} /> : <Package size={24} color={theme.tealDeep} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: theme.navy }}>{product.name}</h4>
            {statusBadge}
          </div>
          {product.generic_name && (
            <p style={{ margin: '0 0 4px', fontSize: 12, color: theme.gray600 }}>Generic: {product.generic_name}</p>
          )}
          {product.brand && (
            <p style={{ margin: '0 0 4px', fontSize: 12, color: theme.gray600 }}>Brand: {product.brand}</p>
          )}
          <div style={{ display: 'flex', gap: 12, fontSize: 12, color: theme.gray600, flexWrap: 'wrap' }}>
            {!isService && <span>Stock: <strong style={{ color: isOutOfStock ? theme.danger : isLowStock ? theme.warning : theme.navy }}>{product.stock || 0}</strong>{product.reorder_level && ` (Reorder: ${product.reorder_level})`}</span>}
            {product.cost_price && <span>Cost: <strong>₦{Number(product.cost_price).toLocaleString()}</strong></span>}
            {product.selling_price && <span>Sell: <strong>₦{Number(product.selling_price).toLocaleString()}</strong></span>}
            {product.cat && <span>Cat: <strong>{product.cat}</strong></span>}
          </div>
        </div>
        {canManage && (
          <div style={{ display: 'flex', gap: 4, flexDirection: 'column' }}>
            <button onClick={() => onEdit(product)} style={{ padding: 6, background: 'none', border: 'none', cursor: 'pointer', color: theme.gray600, borderRadius: 6 }} title="Edit"><Edit size={16} /></button>
            <button onClick={() => setShowDelete(true)} style={{ padding: 6, background: 'none', border: 'none', cursor: 'pointer', color: theme.danger, borderRadius: 6 }} title="Delete"><Trash2 size={16} /></button>
          </div>
        )}
      </div>
      {showDelete && (
        <Modal show onClose={() => setShowDelete(false)} title="Delete Product" sheet>
          <p style={{ margin: '0 0 16px', color: theme.gray600 }}>Delete "{product.name}"? This cannot be undone.</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <GhostBtn onClick={() => setShowDelete(false)}>Cancel</GhostBtn>
            <TealBtn onClick={() => { onDelete(product.id); setShowDelete(false) }} style={{ background: theme.danger }}>Delete</TealBtn>
          </div>
        </Modal>
      )}
    </Card>
  )
}