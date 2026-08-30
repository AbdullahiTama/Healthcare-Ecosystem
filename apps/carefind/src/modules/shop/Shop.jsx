import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShoppingBag, Package, Star, ShoppingCart } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Card, Empty, Pill } from '../../components/ui'
import { createShopRepository } from './shopRepository'
import { useCart } from './CartProvider'

const shopRepository = createShopRepository()

export default function Shop({ segment: initialSegment = 'all', query: externalQuery = '' }) {
  const { count } = useCart()
  const [segment, setSegment] = useState(initialSegment)
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { setSegment(initialSegment) }, [initialSegment])
  useEffect(() => { load() }, [segment, externalQuery])

  async function load() {
    setLoading(true); setError('')
    try {
      const rows = await shopRepository.getActiveProducts({ segment, query: externalQuery, limit: 50 })
      setProducts(rows || [])
    } catch (e) {
      setError('Could not load Shop products')
    }
    setLoading(false)
  }

  const featured = products.slice(0, 6)
  const grid = products

  if (loading) return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} style={{ padding: 12, height: 180, background: theme.bg, border: `1px solid ${theme.border}` }}>
          <div style={{ height: 80, background: theme.gray100, borderRadius: 8, marginBottom: 8 }} />
          <div style={{ height: 12, background: theme.gray100, borderRadius: 4, marginBottom: 6 }} />
          <div style={{ height: 12, background: theme.gray100, borderRadius: 4, width: '60%' }} />
        </Card>
      ))}
    </div>
  )

  if (error) return (
    <div role="alert" style={{ padding: 16, borderRadius: 12, background: theme.dangerBg, border: `1px solid ${theme.dangerBorder}`, color: theme.danger, textAlign: 'center' }}>
      {error} <button onClick={load} style={{ marginLeft: 8, background: 'none', border: `1px solid ${theme.danger}`, color: theme.danger, borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>Retry</button>
    </div>
  )

  return (
    <div style={{ padding: 16 }}>
      {/* Cart link */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Link 
          to="/cart" 
          style={{ 
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            borderRadius: 8,
            background: theme.tealDeep,
            color: '#fff',
            textDecoration: 'none',
            fontWeight: 600
          }}
        >
          <ShoppingCart size={20} />
          Cart
          {count > 0 && (
            <span style={{
              position: 'absolute',
              top: -8,
              right: -8,
              background: theme.danger,
              color: '#fff',
              borderRadius: '50%',
              width: 24,
              height: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 700
            }}>
              {count}
            </span>
          )}
        </Link>
      </div>
      {/* Segment filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }} role="group" aria-label="Segment filter">
        {[
          { value: 'all', label: 'All' },
          { value: 'retail', label: 'Retail' },
          { value: 'wholesale', label: 'Wholesale' },
          { value: 'distributor', label: 'Distributor' },
        ].map(s => (
          <button
            key={s.value}
            onClick={() => setSegment(s.value)}
            aria-pressed={segment === s.value}
            style={{
              padding: '6px 12px', borderRadius: 20, border: `1px solid ${segment === s.value ? theme.tealDeep : theme.border}`,
              background: segment === s.value ? theme.tealDeep : '#fff',
              color: segment === s.value ? '#fff' : theme.textMid,
              fontSize: 12, fontWeight: 700, cursor: 'pointer'
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Featured horizontal row */}
      {featured.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: theme.navy, marginBottom: 8 }}>Featured</div>
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8, scrollbarWidth: 'thin' }} role="list" aria-label="Featured products">
            {featured.map(row => {
              const p = row.products
              const priceKobo = row.ecommerce_price_kobo ?? (p.price != null ? Math.round(p.price * 100) : null)
              const priceLabel = priceKobo != null ? `₦${(priceKobo/100).toLocaleString()}` : 'Ask for price'
              return (
                <Link key={row.id} to={`/shop/${row.id}`} style={{ textDecoration: 'none', flex: '0 0 160px' }} role="listitem">
                  <Card style={{ padding: 10, height: 180, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ height: 80, borderRadius: 8, background: p.image_url ? `url(${p.image_url}) center/cover` : theme.tealMist, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.tealDeep }}>
                      {!p.image_url && <Package size={24} />}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: theme.navy, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: theme.tealDeep }}>{priceLabel}</div>
                    {p.sale_type && <Pill label={p.sale_type} type="gray" style={{ fontSize: 9, alignSelf: 'flex-start' }} />}
                  </Card>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Grid catalog - 2 per row minimum */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }} role="list" aria-label="Shop catalog">
        {grid.map(row => {
          const p = row.products
          const priceKobo = row.ecommerce_price_kobo ?? (p.price != null ? Math.round(p.price * 100) : null)
          const priceLabel = priceKobo != null ? `₦${(priceKobo/100).toLocaleString()}` : 'Ask for price'
          return (
            <Link key={row.id} to={`/shop/${row.id}`} style={{ textDecoration: 'none' }} role="listitem">
              <Card style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6, height: '100%' }}>
                <div style={{ height: 120, borderRadius: 8, background: p.image_url ? `url(${p.image_url}) center/cover` : theme.tealMist, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.tealDeep }}>
                  {!p.image_url && <Package size={28} />}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: theme.navy, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 32 }}>{p.name}</div>
                {p.generic_name && <div style={{ fontSize: 11, color: theme.textLight, fontStyle: 'italic', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.generic_name}</div>}
                <div style={{ fontSize: 13, fontWeight: 800, color: theme.tealDeep, marginTop: 'auto' }}>{priceLabel}</div>
                {p.sale_type && <Pill label={p.sale_type === 'retail' ? 'Retail' : p.sale_type === 'wholesale' ? 'Wholesale' : 'Distributor'} type="gray" style={{ fontSize: 9, alignSelf: 'flex-start' }} />}
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
