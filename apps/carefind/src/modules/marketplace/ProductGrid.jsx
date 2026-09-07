import { theme } from '../../styles/theme'
import { Card, Empty } from '../../components/ui'

function GridSkeleton() {
  return (
    <div className="mp-grid mp-grid--skeleton" style={{ display: 'grid', gap: 12 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} style={{ padding: 0, background: '#fff', border: `1px solid ${theme.border}`, borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ aspectRatio: '1 / 1', background: theme.gray100 }} />
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ height: 14, background: theme.gray100, borderRadius: 4, width: '85%' }} />
            <div style={{ height: 12, background: theme.gray100, borderRadius: 4, width: '60%' }} />
            <div style={{ height: 15, background: theme.tealMist, borderRadius: 4, width: '40%', marginTop: 4 }} />
            <div style={{ height: 44, background: theme.tealMist, borderRadius: 10, marginTop: 4 }} />
          </div>
        </Card>
      ))}
    </div>
  )
}

function BusinessSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i} style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: theme.gray100, flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ height: 14, background: theme.gray100, borderRadius: 4, width: '70%' }} />
            <div style={{ height: 12, background: theme.gray100, borderRadius: 4, width: '50%' }} />
            <div style={{ height: 12, background: theme.gray100, borderRadius: 4, width: '40%' }} />
          </div>
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
  skeletonType = 'grid',
}) {

  if (loading) {
    if (skeletonType === 'list') return <BusinessSkeleton />
    return <GridSkeleton />
  }
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
    return <Empty cause="empty" message={<><div style={{ fontSize: 14, fontWeight: 800, color: theme.navy, marginBottom: 4 }}>{emptyTitle}</div><div style={{ fontSize: 12.5, color: theme.textMid }}>{emptyHint}</div></>} />
  }

  return (
    <>
      <style>{`
        .mp-grid { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: stretch; }
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


