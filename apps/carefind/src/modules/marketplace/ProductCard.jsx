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
            borderRadius: 14,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
          }}
        >
          {/* Image — 1:1 aspect ratio for consistent row heights */}
          <div
            style={{
              aspectRatio: '1 / 1',
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

          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
            {/* Product name — 2 line clamp */}
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: theme.navy,
                lineHeight: 1.3,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                minHeight: 36,
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
              }}
              title={p.name}
            >
              {p.name}
            </div>

            {/* Generic name */}
            {p.generic_name && (
              <div style={{ fontSize: 12, color: theme.textMid, fontStyle: 'italic', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                {p.generic_name}
              </div>
            )}

            {/* Seller / location */}
            {(p.seller_location || row.business_id || p.businesses?.name) && (
              <div style={{ fontSize: 12, color: theme.textMid, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                {row.businesses?.name || p.businesses?.name || ''}{p.seller_location ? ` · ${p.seller_location}` : row.businesses?.state ? ` · ${row.businesses.state}` : ''}
              </div>
            )}

            {/* Rx / sale type pills */}
            {(row.prescription_required || p.sale_type) && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', minHeight: 18, alignItems: 'center' }}>
                {row.prescription_required && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: theme.warning, border: `1px solid ${theme.warning}30`, background: '#fffbeb', padding: '2px 6px', borderRadius: 6 }}>Rx</span>
                )}
                {p.sale_type && <Pill label={p.sale_type} type="gray" style={{ fontSize: 9, textTransform: 'capitalize' }} />}
              </div>
            )}

            {/* Price */}
            <div style={{ marginTop: 'auto', paddingTop: 4 }}>
              {isAskForPrice ? (
                <span style={{ fontSize: 13, fontWeight: 800, color: theme.textMid }}>Ask for price</span>
              ) : (
                <span style={{ fontSize: 15, fontWeight: 800, color: theme.tealDeep, letterSpacing: '-0.01em' }}>{priceLabel}</span>
              )}
              {p.price_unit && !isAskForPrice && <span style={{ fontSize: 10, color: theme.textMid, marginLeft: 4 }}>per {p.price_unit}</span>}
            </div>

            {/* Rating — trust signal on card */}
            {rating?.count ? (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Star size={12} fill={theme.starAmber} color={theme.starAmber} aria-hidden="true" />
                <span style={{ fontSize: 12, fontWeight: 700, color: theme.textMid }}>{rating.avg}</span>
                <span style={{ fontSize: 11, color: theme.textMid }}>({rating.count})</span>
              </div>
            ) : null}

            {/* Add to Cart */}
            <div style={{ marginTop: 4 }}>
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
                  fontSize: 12,
                  fontWeight: 700,
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

      {/* Wishlist — 36px touch target */}
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
          width: 36,
          height: 36,
          borderRadius: 999,
          border: `1px solid ${theme.border}`,
          background: wished ? theme.tealDeep : 'rgba(255,255,255,0.92)',
          color: wished ? '#fff' : theme.navy,
          display: 'grid',
          placeItems: 'center',
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        }}
      >
        <Heart size={16} fill={wished ? '#fff' : 'none'} aria-hidden="true" />
      </button>
    </div>
  )
}
