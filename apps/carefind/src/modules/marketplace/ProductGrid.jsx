import { useEffect, useState } from 'react'
import { theme } from '../../styles/theme'
import { Card, CardSkeleton, Empty, Pill } from '../../components/ui'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import ProductCard from './ProductCard'

function GridSkeleton() {
  return (
    <div className="mp-grid mp-grid--skeleton" style={{ display: 'grid', gap: 10 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} style={{ padding: 10, background: theme.cardBg, border: `1px solid ${theme.border}` }}>
          <div style={{ height: 122, background: theme.gray100, borderRadius: 8, marginBottom: 8 }} />
          <div style={{ height: 12, background: theme.gray100, borderRadius: 4, marginBottom: 6 }} />
          <div style={{ height: 12, background: theme.gray100, borderRadius: 4, width: '70%', marginBottom: 8 }} />
          <div style={{ height: 14, background: theme.tealMist, borderRadius: 999, width: '40%' }} />
          <div style={{ height: 36, background: theme.gray100, borderRadius: 10, marginTop: 10 }} />
        </Card>
      ))}
    </div>
  )
}

export default function ProductGrid({
  rows,
  loading,
  error,
  onRetry,
  onAddToCart,
  onToggleWishlist,
  hasWishlist,
  ratings,
  emptyTitle = 'No products found',
  emptyHint = 'Try another search or filter.',
}) {

  if (loading) return <GridSkeleton />
  if (error)
    return (
      <div role="alert" style={{ padding: 16, borderRadius: 12, background: theme.dangerBg, border: `1px solid ${theme.dangerBorder}`, color: theme.danger, textAlign: 'center', fontSize: 13 }}>
        {error}{' '}
        {onRetry && (
          <button onClick={onRetry} style={{ marginLeft: 8, background: '#fff', border: `1px solid ${theme.danger}`, color: theme.danger, borderRadius: 8, padding: '6px 12px', fontWeight: 700, cursor: 'pointer' }}>
            Retry
          </button>
        )}
      </div>
    )
  if (!rows || rows.length === 0) {
    return <Empty cause="empty" message={<><div style={{ fontSize: 14, fontWeight: 800, color: theme.navy, marginBottom: 4 }}>{emptyTitle}</div><div style={{ fontSize: 12.5, color: theme.textLight }}>{emptyHint}</div></>} />
  }

  return (
    <>
      <style>{`
        .mp-grid { display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: stretch; }
        @media (min-width: 768px) { .mp-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        @media (min-width: 1024px) { .mp-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
        .mp-grid > * { min-width: 0; }
      `}</style>
      <div role="list" aria-label="Products" className="mp-grid" style={{ alignItems: 'stretch' }}>

      {rows.map((row) => {
        const id = row.id || row.products?.id
        return (
          <div key={id} role="listitem" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <ProductCard
              row={row}
              onAddToCart={onAddToCart}
              onToggleWishlist={onToggleWishlist}
              wished={hasWishlist ? hasWishlist(id) : false}
              rating={ratings?.[id]}
            />
          </div>
        )
      })}
      </div>
    </>
  )
}
