import { Search, XCircle, EyeOff, Clock, MessageCircle, Check, Package, Clipboard } from 'lucide-react'
import { fmt, businessLucideIcon, businessName } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { Card, StatCard, Pill, Toggle } from '../../components/ui'
import { updateProduct } from '../../services/supabase'

const { tealDeep, tealMist, tealBright, navy, gray600, gray500, gray400, gray100, border, danger, success, bg } = theme
const productIcon = (p) => ((p.cat || p.category) === 'Services' ? Clipboard : Package)

export default function CareFind({ brand, products, setProducts, loadProducts }) {
  const bType = brand?.business_type || brand?.type || 'skincare'
  const listed = products.filter(p => p.list_on_carefind !== false && p.stock > 0)
  const unlisted = products.filter(p => p.list_on_carefind === false)
  const outOfStock = products.filter(p => p.list_on_carefind !== false && p.stock <= 0)
  const waLink = 'https://wa.me/' + ((brand?.whatsapp || '').replace(/[^0-9]/g, '') || '')

  async function toggleCareFind(product) {
    try {
      await updateProduct(product.id, { list_on_carefind: !product.list_on_carefind })
      loadProducts && loadProducts()
    } catch (e) {}
  }

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '20px', fontWeight: '900', color: navy }}>CareFind Profile</div>
        <div style={{ fontSize: '13px', color: gray500, marginTop: '3px' }}>How your business appears to patients searching on CareFind</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard icon={<Search />} label='Listed Products' value={listed.length} sub='Visible to patients' />
        <StatCard icon={<XCircle />} label='Out of Stock' value={outOfStock.length} alert={outOfStock.length > 0} sub='Hidden from search' />
        <StatCard icon={<EyeOff />} label='Hidden' value={unlisted.length} sub='Manually hidden' />
      </div>

      {/* Public profile preview */}
      <Card style={{ marginBottom: '20px', overflow: 'hidden' }}>
        <div style={{ padding: '16px', background: 'white', borderBottom: `1px solid ${border}` }}>
          <div style={{ fontSize: '11px', color: gray400, marginBottom: '8px', letterSpacing: '1.5px', fontWeight: '700' }}>CAREFIND PUBLIC VIEW</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{ width: '52px', height: '52px', borderRadius: theme.radius.lg, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {(() => { const Icon = businessLucideIcon(bType); return <Icon size={26} /> })()}
            </div>
            <div>
              <div style={{ fontWeight: '900', fontSize: '18px', color: navy }}>{brand?.name}</div>
              <div style={{ fontSize: '12px', color: tealDeep, marginTop: '2px', fontWeight: '600' }}>{businessName(bType)}</div>
              <div style={{ fontSize: '11px', color: gray500, marginTop: '2px' }}>{brand?.address || 'Address not set'}{brand?.state ? ', ' + brand.state : ''}</div>
            </div>
          </div>
        </div>
        <div style={{ padding: '16px', display: 'flex', gap: '12px', flexWrap: 'wrap', borderBottom: `1px solid ${border}` }}>
          {brand?.hours && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: gray600 }}><Clock size={12} /> {brand.hours}</span>}
          {brand?.whatsapp && <a href={waLink} target='_blank' rel='noreferrer' style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: success, textDecoration: 'none', fontWeight: '700' }}><MessageCircle size={12} /> WhatsApp: {brand.whatsapp}</a>}
          {(brand?.visible_on_carefind !== false) ? <Pill label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Check size={10} /> Live on CareFind</span>} type='green' /> : <Pill label='Not Listed' type='red' />}
        </div>
        {listed.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: gray400, fontSize: '13px' }}>No products listed on CareFind yet</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: '10px', padding: '14px' }}>
            {listed.slice(0, 9).map(p => { const Icon = productIcon(p); return (
              <div key={p.id} style={{ background: bg, border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '12px', textAlign: 'center' }}>
                <div style={{ width: 30, height: 30, borderRadius: theme.radius.sm, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px' }}><Icon size={15} /></div>
                <div style={{ fontSize: '11px', fontWeight: '700', color: navy, marginBottom: '2px' }}>{p.name}</div>
                <div style={{ fontSize: '12px', fontWeight: '900', color: navy }}>{fmt(p.price)}</div>
                <div style={{ fontSize: '9px', color: gray400, marginTop: '2px' }}>{p.stock > 0 ? p.stock + ' in stock' : 'Out of stock'}</div>
              </div>
            )})}
          </div>
        )}
      </Card>

      {/* Product toggle list */}
      <Card>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${border}`, fontWeight: '800', fontSize: '15px', color: navy }}>Manage product visibility</div>
        {products.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: gray400, fontSize: '13px' }}>No products in inventory yet</div>
        ) : products.map(p => {
          const cat = p.cat || p.category
          const Icon = productIcon(p)
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', borderBottom: `1px solid ${gray100}`, gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                <div style={{ width: 30, height: 30, borderRadius: theme.radius.sm, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon size={15} /></div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: '700', fontSize: '13px', color: navy, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                  <div style={{ fontSize: '11px', color: gray400 }}>{fmt(p.price)} · {cat === 'Services' ? 'Service' : p.stock + ' in stock'}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                {p.stock <= 0 && cat !== 'Services' && <span style={{ fontSize: '10px', color: danger, fontWeight: '700' }}>OUT</span>}
                <button onClick={() => toggleCareFind(p)} aria-label='Toggle CareFind listing'
                  style={{ width: '40px', height: '22px', borderRadius: '11px', border: 'none', cursor: 'pointer', position: 'relative', background: p.list_on_carefind !== false ? tealDeep : theme.gray200, transition: 'background 0.2s' }}>
                  <div style={{ position: 'absolute', top: '2px', left: p.list_on_carefind !== false ? '20px' : '2px', width: '18px', height: '18px', borderRadius: '50%', background: 'white', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                </button>
              </div>
            </div>
          )
        })}
      </Card>
    </div>
  )
}
