import { useEffect, useState, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Package, ShoppingBag } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Card, Pill, Empty } from '../../components/ui'
import { createShopRepository } from './shopRepository'
import { useCart } from './CartProvider'

const shopRepository = createShopRepository()

export default function ProductDetail() {
  const { productId } = useParams()
  const { addItem } = useCart()
  const [product, setProduct] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [current, setCurrent] = useState(0)
  const [addedToCart, setAddedToCart] = useState(false)
  const touchStartX = useRef(null)

  useEffect(() => { load() }, [productId])

  async function load() {
    setLoading(true); setError('')
    try {
      const data = await shopRepository.getProductDetail(productId)
      if (!data) { setError('Product not available'); setProduct(null) } else { setProduct(data); setCurrent(0) }
    } catch (e) { setError('Could not load product') }
    setLoading(false)
  }

  if (loading) return <div style={{ padding: 20, textAlign: 'center', color: theme.textLight }}>Loading product...</div>
  if (error || !product) return <Empty icon={<Package size={40} color={theme.gray300} />} message={error || 'Product not available'} action="Back to Shop" onAction={() => window.location.href = '/search?tab=shop'} />

  const p = product.products
  const images = product.images || []
  const priceKobo = product.ecommerce_price_kobo ?? (p.price != null ? Math.round(p.price * 100) : null)
  const priceLabel = priceKobo != null ? `₦${(priceKobo/100).toLocaleString()}` : 'Ask for price'

  const next = () => setCurrent(c => (c + 1) % images.length)
  const prev = () => setCurrent(c => (c - 1 + images.length) % images.length)
  const goTo = (idx) => setCurrent(idx)

  const onTouchStart = (e) => { touchStartX.current = e.touches[0].clientX }
  const onTouchEnd = (e) => {
    if (touchStartX.current == null) return
    const diff = e.changedTouches[0].clientX - touchStartX.current
    if (diff > 50) prev()
    else if (diff < -50) next()
    touchStartX.current = null
  }

  const handleAddToCart = () => {
    if (!product || !p) return
    
    addItem({
      ecommerce_product_id: product.id,
      product_name: p.name,
      unit_price_kobo: priceKobo,
      quantity: 1,
      image_url: images[0]?.url || p.image_url || null,
      vendor_id: product.business_id
    })
    
    setAddedToCart(true)
    setTimeout(() => setAddedToCart(false), 2000)
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <Link to="/search?tab=shop" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: theme.tealDeep, textDecoration: 'none', fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
        <ArrowLeft size={14} /> Back to Shop
      </Link>

      {/* Gallery */}
      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }} aria-label="Product gallery">
        {images.length === 0 ? (
          <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme.tealMist, color: theme.tealDeep }}>
            <Package size={40} />
          </div>
        ) : (
          <div style={{ position: 'relative' }} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} role="region" aria-label={`Product gallery, image ${current + 1} of ${images.length}`} aria-live="polite">
            <img src={images[current].url} alt={`${p.name} — image ${current + 1} of ${images.length}`} style={{ width: '100%', height: 320, objectFit: 'cover', display: 'block' }} />
            {images.length > 1 && (
              <>
                <button onClick={prev} aria-label="Previous image" style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', width: 36, height: 36, borderRadius: '50%', border: `1px solid ${theme.border}`, background: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                  <ChevronLeft size={18} />
                </button>
                <button onClick={next} aria-label="Next image" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 36, height: 36, borderRadius: '50%', border: `1px solid ${theme.border}`, background: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                  <ChevronRight size={18} />
                </button>
                <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 6, background: 'rgba(0,0,0,0.6)', padding: '4px 8px', borderRadius: 12 }}>
                  {images.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => goTo(idx)}
                      aria-label={`Go to image ${idx + 1}`}
                      aria-current={idx === current}
                      style={{ width: 8, height: 8, borderRadius: '50%', border: 'none', background: idx === current ? '#fff' : 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: 0 }}
                    />
                  ))}
                </div>
                <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, padding: '2px 6px', borderRadius: 6 }}>
                  {current + 1}/{images.length}
                </div>
              </>
            )}
          </div>
        )}
      </Card>

      {/* Details */}
      <Card style={{ padding: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: theme.navy, marginBottom: 4 }}>{p.name}</div>
        {p.generic_name && <div style={{ fontSize: 13, color: theme.textLight, fontStyle: 'italic', marginBottom: 8 }}>{p.generic_name}</div>}
        <div style={{ fontSize: 18, fontWeight: 800, color: theme.tealDeep, marginBottom: 8 }}>{priceLabel}</div>
        {p.sale_type && <Pill label={p.sale_type} type="gray" style={{ marginBottom: 8 }} />}
        <div style={{ fontSize: 13, color: theme.textMid, lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: 12 }}>{product.description || p.description || 'No description available.'}</div>
        {product.category && <div style={{ fontSize: 12, color: theme.textLight, marginBottom: 4 }}><b>Category:</b> {product.category}</div>}
        {p.stock != null && <div style={{ fontSize: 12, color: theme.textLight, marginBottom: 12 }}><b>Availability:</b> {p.stock > 0 ? `${p.stock} in stock` : 'Out of stock'}</div>}
        <button 
          onClick={handleAddToCart}
          disabled={!p.stock || p.stock <= 0}
          style={{ 
            width: '100%', 
            padding: '12px', 
            borderRadius: 12, 
            border: 'none', 
            background: addedToCart ? theme.success : (p.stock > 0 ? theme.tealDeep : theme.gray200), 
            color: addedToCart ? '#fff' : (p.stock > 0 ? '#fff' : theme.textLight), 
            fontWeight: 700, 
            cursor: p.stock > 0 ? 'pointer' : 'not-allowed', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            gap: 8,
            transition: 'background 0.2s'
          }}
        >
          <ShoppingBag size={16} />
          {addedToCart ? 'Added to Cart!' : (p.stock > 0 ? 'Add to Cart' : 'Out of Stock')}
        </button>
        {p.stock > 0 && <div style={{ fontSize: 11, color: theme.textLight, textAlign: 'center', marginTop: 8 }}>Click to add to cart, then proceed to checkout</div>}
      </Card>
    </div>
  )
}
