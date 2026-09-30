import { Link } from 'react-router-dom'
import {
  ChevronRight, MapPin, MessageCircle, Phone, Pill as PillIcon, Star,
} from 'lucide-react'
import { theme } from '../../../styles/theme'
import { Card, Pill } from '../../../components/ui'
import {
  SALE_TYPE_LABELS, canShowPrice, whatsappLink, telLink,
} from '../../utils/marketplace.js'
import { sellerName, sellerContact, sellerPhone } from '../../utils/sellerLookup.js'

// The list-style medicine result row. Extracted from Search.jsx so the
// /search products tab and the marketing landing page render the same card
// from one definition — the landing page passes an explicit `distance` label
// (fixtures have no user location) while /search computes it from geolocation.
//
// Purely presentational: no data access, no lead recording, no booking. The
// `onContact` callback is how the owner records the lead, so this component
// stays reusable by a screen that doesn't want lead tracking.
export default function ProductResultCard({ product: p, index = 0, distance = null, onContact }) {
  const waLink = whatsappLink(sellerContact(p), `Hi, I'm interested in "${p.name}" on CareFind.`)
  const callLink = telLink(sellerPhone(p))
  const sellerLocation = p.seller_location || p.businesses?.state || p.businesses?.city

  return (
    <Card
      className="mm-card"
      style={{ animationDelay: `${Math.min(index * 0.04, 0.4)}s`, padding: 12 }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {p.image_url
          ? <div
              style={{ width: 46, height: 46, borderRadius: 10, background: `url(${p.image_url}) center/cover`, flexShrink: 0 }}
              role="img"
              aria-label=""
            />
          : <div
              style={{
                width: 46, height: 46, borderRadius: 10, flexShrink: 0,
                background: theme.tealMist, color: theme.tealDeep,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            ><PillIcon size={22} aria-hidden="true" /></div>}

        <div style={{ flex: 1, minWidth: 0 }}>
          <Link to={`/drug/${encodeURIComponent(p.name)}`} style={{ textDecoration: 'none' }}>
            <p style={{ margin: '0 0 2px 0', fontSize: 14, fontWeight: 800, color: theme.navy }}>
              {p.name}
              {p.category && (
                <Pill label={p.category} type="teal" style={{ fontSize: 9, padding: '1px 6px', marginLeft: 6 }} />
              )}
            </p>
            {p.generic_name && (
              <p style={{ margin: '0 0 2px 0', fontSize: 11.5, color: theme.textMid, fontStyle: 'italic' }}>{p.generic_name}</p>
            )}
            <p style={{ margin: '0 0 3px 0', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: theme.tealDeep, fontWeight: 700 }}>
              <Star size={11} aria-hidden="true" /> See reviews <ChevronRight size={11} aria-hidden="true" />
            </p>
          </Link>

          {p.business_id ? (
            <Link
              to={`/business/${p.business_id}`}
              style={{ margin: 0, fontSize: 12, color: theme.tealDeep, fontWeight: 700, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3, minHeight: 44 }}
            >
              {sellerName(p)}
              {sellerLocation && <span style={{ color: theme.gray400, fontWeight: 400 }}> · {sellerLocation}</span>}
              <ChevronRight size={12} aria-hidden="true" />
            </Link>
          ) : p.owner_id ? (
            <Link
              to={`/u/${p.owner_id}`}
              style={{ margin: 0, fontSize: 12, color: theme.tealDeep, fontWeight: 700, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3, minHeight: 44 }}
            >
              {sellerName(p)}
              {sellerLocation && <span style={{ color: theme.gray400, fontWeight: 400 }}> · {sellerLocation}</span>}
              <ChevronRight size={12} aria-hidden="true" />
            </Link>
          ) : (
            <p style={{ margin: 0, fontSize: 12, color: theme.textMid }}>
              {p.seller_location && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <MapPin size={12} aria-hidden="true" /> {p.seller_location}
                </span>
              )}
            </p>
          )}
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {distance && (
            <p style={{ margin: '0 0 4px 0', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: theme.textMid, fontWeight: 600 }}>
              <MapPin size={11} aria-hidden="true" /> {distance}
            </p>
          )}
          {canShowPrice(p) ? (
            <>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: theme.tealDeep }}>₦{Number(p.price).toLocaleString()}</p>
              {p.price_unit && <p style={{ margin: 0, fontSize: 9.5, color: theme.textMid }}>per {p.price_unit}</p>}
            </>
          ) : (
            <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: theme.textMid }}>Ask for price</p>
          )}
        </div>
      </div>

      {(p.sale_type || p.min_purchase) && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {p.sale_type && (
            <Pill
              label={SALE_TYPE_LABELS[p.sale_type] || p.sale_type}
              type={p.sale_type === 'retail' ? 'teal' : 'purple'}
              style={{ fontSize: 9.5, textTransform: 'uppercase' }}
            />
          )}
          {p.min_purchase && (
            <Pill label={`Min ${p.min_purchase} ${p.price_unit || ''}${p.min_purchase > 1 ? 's' : ''}`} type="gray" style={{ fontSize: 9.5 }} />
          )}
        </div>
      )}

      {(waLink || callLink) && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          {waLink && (
            <a
              href={waLink}
              target="_blank"
              rel="noreferrer"
              onClick={() => onContact?.({ businessId: p.business_id, productId: p.id, productName: p.name }, 'whatsapp')}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                minHeight: 44, padding: '9px 12px', background: '#25D366', color: '#fff',
                borderRadius: 10, fontWeight: 800, fontSize: 13, textDecoration: 'none', boxSizing: 'border-box',
              }}
            >
              <MessageCircle size={16} aria-hidden="true" /> WhatsApp
            </a>
          )}
          {callLink && (
            <a
              href={callLink}
              onClick={() => onContact?.({ businessId: p.business_id, productId: p.id, productName: p.name }, 'call')}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                minHeight: 44, padding: '9px 12px', background: theme.tealDeep, color: '#fff',
                borderRadius: 10, fontWeight: 800, fontSize: 13, textDecoration: 'none', boxSizing: 'border-box',
              }}
            >
              <Phone size={16} aria-hidden="true" /> Call
            </a>
          )}
        </div>
      )}
    </Card>
  )
}
