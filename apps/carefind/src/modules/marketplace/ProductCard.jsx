import { Link } from 'react-router-dom'
import { Heart, ShoppingCart, Package, Star } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Pill } from '../../components/ui'

export default function ProductCard({ row, onAddToCart, onToggleWishlist, wished, rating }) {
  const p = row.products || row
  const rowId = row.id || p.id
  const priceKobo = row.ecommerce_price_kobo ?? (p.price != null ? Math.round(p.price * 100) : null)
  const priceLabel = priceKobo != null ? `₦${(priceKobo / 100).toLocaleString()}` : null
  const thumb = row.primary_image_url || p.image_url || null
  const isAskForPrice = priceLabel == null

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Link to={row.ecommerce_product_id ? `/shop/${row.id}` : `/drug/${encodeURIComponent(p.name)}`} style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', flex: 1 }}>
        <div
          style={{
            background: '#fff',
            border: `1px solid ${theme.border}`,
            borderRadius: theme.radius.md,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            // consistent card height via flex
          }}
        >
          {/* Image area — fixed height, consistent aspect */}
          <div
            style={{
              height: 122,
              borderRadius: 0,
              background: thumb ? `url(${thumb}) center/cover` : theme.tealMist,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: theme.tealDeep,
              flexShrink: 0,
              borderBottom: `1px solid ${theme.hairline}`,
            }}
            role="img"
            aria-label={p.name}
          >
            {!thumb && <Package size={28} aria-hidden="true" />}
          </div>

          <div style={{ padding: '10px 10px 12px', display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
            {/* Name — 2 line clamp, break long tokens on mobile */}
            <div
              style={{
                fontSize: 13,
                fontWeight: 800,
                color: theme.navy,
                lineHeight: 1.32,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                minHeight: 34,
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
              }}
              title={p.name}
            >
              {p.name}
            </div>
            {p.generic_name && (
              <div style={{ fontSize: 11, color: theme.textLight, fontStyle: 'italic', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                {p.generic_name}
              </div>
            )}

            {/* Seller / location compact */}
            {(p.seller_location || row.business_id || p.businesses?.name) && (
              <div style={{ fontSize: 11, color: theme.textLight, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                {row.businesses?.name || p.businesses?.name || ''}{p.seller_location ? ` · ${p.seller_location}` : row.businesses?.state ? ` · ${row.businesses.state}` : ''}
              </div>
            )}

            {/* Rx / pills row */}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', minHeight: 18, alignItems: 'center' }}>
              {row.prescription_required && (
                <span style={{ fontSize: 10, fontWeight: 700, color: theme.warning, border: `1px solid ${theme.warning}30`, background: '#fffbeb', padding: '2px 6px', borderRadius: 6 }}>Rx</span>
              )}
              {p.sale_type && <Pill label={p.sale_type} type="gray" style={{ fontSize: 9, textTransform: 'capitalize' }} />}
            </div>

            {/* Price row — pushed to bottom */}
            <div style={{ marginTop: 'auto', paddingTop: 6, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              {isAskForPrice ? (
                <span style={{ fontSize: 12, fontWeight: 800, color: theme.textLight }}>Ask for price</span>
              ) : (
                <span style={{ fontSize: 14, fontWeight: 900, color: theme.tealDeep, letterSpacing: '-0.01em' }}>{priceLabel}</span>
              )}
              {p.price_unit && !isAskForPrice && <span style={{ fontSize: 10, color: theme.textLight }}>per {p.price_unit}</span>}
            </div>

            {/* Rating compact */}
            {rating?.count ? (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: theme.textMid }}>
                <Star size={11} fill={theme.starAmber} color={theme.starAmber} aria-hidden="true" />
                <span style={{ fontWeight: 700 }}>{rating.avg}</span>
                <span style={{ color: theme.textLight }}>· {rating.count}</span>
              </div>
            ) : null}

            {/* Add to Cart bar — tappable 44h min on mobile */}
            <div style={{ marginTop: 6 }}>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault(); e.stopPropagation()
                  const k = row.ecommerce_price_kobo ?? (p.price != null ? Math.round(p.price * 100) : null)
                  if (k != null) onAddToCart?.({ ecommerce_product_id: row.id || p.id, product_name: p.name, unit_price_kobo: k, quantity: 1, image_url: thumb, vendor_id: row.business_id, sale_type: p.sale_type })
                }}
                aria-label={`Add ${p.name} to cart`}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  minHeight: 44,
                  borderRadius: 10,
                  background: theme.tealDeep,
                  color: '#fff',
                  fontSize: 12.5,
                  fontWeight: 800,
                  padding: '0 10px',
                  border: 'none',
                  cursor: 'pointer',
                  touchAction: 'manipulation',
                }}
              >
                <ShoppingCart size={14} aria-hidden="true" />
                Add to Cart
              </button>
            </div>
          </div>
        </div>
      </Link>

      {/* Wishlist top-right */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          onToggleWishlist?.(rowId)
        }}
        aria-label={wished ? 'Remove from wishlist' : 'Add to wishlist'}
        aria-pressed={!!wished}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          width: 30,
          height: 30,
          borderRadius: 999,
          border: `1px solid ${theme.border}`,
          background: wished ? theme.tealDeep : 'rgba(255,255,255,0.96)',
          color: wished ? '#fff' : theme.navy,
          display: 'grid',
          placeItems: 'center',
          cursor: 'pointer',
          boxShadow: theme.elevation[1],
        }}
      >
        <Heart size={14} fill={wished ? '#fff' : 'none'} aria-hidden="true" />
      </button>

      {/* Remove transparent overlay — it intercepted scroll/taps on narrow 2-col cards on mobile. Cart action is now the visible button below. */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault(); e.stopPropagation()
          const k = row.ecommerce_price_kobo ?? (p.price != null ? Math.round(p.price * 100) : null)
          if (k != null) onAddToCart?.({ ecommerce_product_id: row.id || p.id, product_name: p.name, unit_price_kobo: k, quantity: 1, image_url: thumb, vendor_id: row.business_id, sale_type: p.sale_type })
        }}
        aria-label={`Add ${p.name} to cart`}
        tabIndex={-1}
        style={{
          position: 'absolute',
          left: 10,
          right: 10,
          bottom: 12,
          height: 36,
          borderRadius: 10,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          // keep hit-target but not block scroll — pointerEvents only on visible bar area handled by the Link's span; this is now non-blocking
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
