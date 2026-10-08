import { memo } from 'react'
import { Link } from 'react-router-dom'
import { BadgeCheck, Heart, ShoppingCart, Package, Star, Phone, MessageCircle } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Avatar, Pill } from '../../components/ui'
import { whatsappLink, telLink, distanceLabel } from '../utils/marketplace.js'
import { sellerContact, sellerPhone, sellerName } from '../utils/sellerLookup.js'
import { stockStatus, sellerLine } from './productCardModel.js'

// Text/background pairs chosen for AA contrast at 11px (the theme's success/warning tints are too light for small text).
const STOCK_BADGE = {
  in: { label: 'In stock', color: '#166534', background: '#dcfce7' },
  low: { label: 'Low stock', color: theme.amberText, background: '#fef3c7' },
  out: { label: 'Out of stock', color: '#374151', background: '#e5e7eb' },
}

function ProductCard({ row, onAddToCart, onToggleWishlist, wished, rating, userCoords, variant = 'shop' }) {
  const p = row.products || row
  const rowId = row.id || p.id
  const priceKobo = row.ecommerce_price_kobo ?? (p.price != null ? Math.round(p.price * 100) : null)
  const priceLabel = priceKobo != null ? `₦${(priceKobo / 100).toLocaleString()}` : null
  const thumb = row.primary_image_url || p.image_url || null
  const isAskForPrice = priceLabel == null
  const isEcommerce = variant === 'shop'
  const showContact = variant === 'products' || !isEcommerce

  const stock = isEcommerce ? stockStatus(p) : null
  const outOfStock = stock === 'out'
  const seller = row.businesses
  // A row only reaches the shop if its vendor passed ecommerce approval, so the badge is truthful whenever we can name
  // the seller; with the business hidden by RLS we show a neutral name and no badge.
  const sellerSubline = isEcommerce ? sellerLine(seller?.business_type, distanceLabel(row, userCoords)) : null
  const inset = isEcommerce ? 16 : 8

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Link to={isEcommerce ? `/shop/${row.id}` : `/drug/${encodeURIComponent(p.name)}`} style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', flex: 1 }}>
        <div
          style={{
            background: '#fff',
            border: `1px solid ${theme.border}`,
            borderRadius: isEcommerce ? 16 : 14,
            boxShadow: isEcommerce ? theme.elevation[1] : 'none',
            padding: isEcommerce ? 10 : 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
          }}
        >
          {/* Image — 1:1 for legacy cards (consistent row heights); the shop shows pack shots whole on a soft tile */}
          <div
            style={{
              aspectRatio: isEcommerce ? '4 / 3' : '1 / 1',
              background: thumb ? `url(${thumb}) center/${isEcommerce ? 'contain' : 'cover'} no-repeat` : theme.tealMist,
              backgroundColor: isEcommerce && thumb ? theme.bg : undefined,
              borderRadius: isEcommerce ? 12 : 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: theme.tealDeep,
              flexShrink: 0,
              borderBottom: isEcommerce ? 'none' : `1px solid ${theme.hairline}`,
            }}
            role="img"
            aria-label={p.name}
          >
            {!thumb && <Package size={28} aria-hidden="true" />}
          </div>

          <div style={{ padding: isEcommerce ? '10px 2px 2px' : 12, display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
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

            {/* Generic name — legacy cards only; the shop card leaves it to the product page */}
            {!isEcommerce && p.generic_name && (
              <div style={{ fontSize: 12, color: theme.textMid, fontStyle: 'italic', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                {p.generic_name}
              </div>
            )}

            {/* Seller — shop: logo, name, verified badge, type • distance. Legacy: name · location */}
            {isEcommerce ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span aria-hidden="true" style={{ display: 'inline-flex' }}>
                  <Avatar name={sellerName(row)} src={seller?.logo_url} size={28} />
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: theme.navy, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sellerName(row)}</span>
                    {seller?.name && <BadgeCheck size={14} color={theme.tealDeep} aria-label="Verified seller" role="img" style={{ flexShrink: 0 }} />}
                  </div>
                  {sellerSubline && (
                    <div style={{ fontSize: 11.5, color: theme.textMid, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sellerSubline}</div>
                  )}
                </div>
              </div>
            ) : (
              (p.seller_location || row.business_id || p.businesses?.name) && (
                <div style={{ fontSize: 12, color: theme.textMid, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                  {row.businesses?.name || p.businesses?.name || ''}{p.seller_location ? ` · ${p.seller_location}` : row.businesses?.state ? ` · ${row.businesses.state}` : ''}
                </div>
              )
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
                <span style={{ fontSize: 16, fontWeight: 800, color: theme.tealDeep, letterSpacing: '-0.01em' }}>{priceLabel}</span>
              )}
              {p.price_unit && !isAskForPrice && <span style={{ fontSize: 10, color: theme.textMid, marginLeft: 4 }}>per {p.price_unit}</span>}
            </div>

            {/* Rating — trust signal on card; only when real reviews exist */}
            {rating?.count ? (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Star size={12} fill={theme.starAmber} color={theme.starAmber} aria-hidden="true" />
                <span style={{ fontSize: 12, fontWeight: 700, color: theme.navy }}>{rating.avg}</span>
                <span style={{ fontSize: 11.5, color: theme.textMid }}>({rating.count} {rating.count === 1 ? 'review' : 'reviews'})</span>
              </div>
            ) : null}

            {/* Add to Cart — shop/ecommerce only; Contact buttons for CareFind products */}
            <div style={{ marginTop: 4 }}>
              {showContact ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <a
                    href={telLink(sellerPhone(row))}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Call ${sellerName(row)}`}
                    style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      minHeight: 44, borderRadius: 10, background: theme.tealDeep, color: '#fff',
                      fontSize: 12, fontWeight: 700, padding: '0 10px', border: 'none', cursor: 'pointer',
                      touchAction: 'manipulation', textDecoration: 'none',
                    }}
                  >
                    <Phone size={14} aria-hidden="true" /> Call
                  </a>
                  <a
                    href={whatsappLink(sellerContact(row), `Hi, I'm interested in "${p.name}" on CareFind.`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`WhatsApp ${sellerName(row)}`}
                    style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      minHeight: 44, borderRadius: 10, background: '#25D366', color: '#fff',
                      fontSize: 12, fontWeight: 700, padding: '0 10px', border: 'none', cursor: 'pointer',
                      touchAction: 'manipulation', textDecoration: 'none',
                    }}
                  >
                    <MessageCircle size={14} aria-hidden="true" /> WhatsApp
                  </a>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={outOfStock}
                  onClick={(e) => {
                    e.preventDefault(); e.stopPropagation()
                    const k = row.ecommerce_price_kobo ?? (p.price != null ? Math.round(p.price * 100) : null)
                    if (k != null) onAddToCart?.({ ecommerce_product_id: row.id || p.id, product_name: p.name, unit_price_kobo: k, quantity: 1, image_url: thumb, vendor_id: row.business_id, sale_type: p.sale_type })
                  }}
                  aria-label={outOfStock ? `${p.name} is out of stock` : `Add ${p.name} to cart`}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    minHeight: 44,
                    borderRadius: 10,
                    background: outOfStock ? theme.gray100 : theme.tealMist,
                    color: outOfStock ? theme.textMid : theme.tealDeep,
                    fontSize: 12.5,
                    fontWeight: 700,
                    padding: '0 10px',
                    border: 'none',
                    cursor: outOfStock ? 'not-allowed' : 'pointer',
                    touchAction: 'manipulation',
                  }}
                >
                  <ShoppingCart size={14} aria-hidden="true" />
                  {outOfStock ? 'Out of stock' : 'Add to cart'}
                </button>
              )}
            </div>
          </div>
        </div>
      </Link>

      {/* Stock badge — over the image, top-left */}
      {stock && (
        <span
          style={{
            position: 'absolute', top: inset, left: inset,
            padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, lineHeight: 1.3,
            color: STOCK_BADGE[stock].color, background: STOCK_BADGE[stock].background,
          }}
        >
          {STOCK_BADGE[stock].label}
        </span>
      )}

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
          top: inset,
          right: inset,
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

// Memoized: a cart or wishlist change on one card must not re-render every card in the grid.
export default memo(ProductCard)
