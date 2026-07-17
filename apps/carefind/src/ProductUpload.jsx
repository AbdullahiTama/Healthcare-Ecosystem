import { useState, useEffect } from 'react'
import { supabase } from './lib/supabaseClient'
import { useAuth } from './lib/AuthContext'
import { theme } from './lib/theme'

const FREE_LIMIT = 15

// Verified users add products to MedMarket. First 15 free; 16+ needs subscription.
function ProductUpload({ businesses, onClose, onAdded }) {
  const { user } = useAuth()
  const [count, setCount] = useState(null)      // how many products they already have
  const [subscribed, setSubscribed] = useState(false)
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [category, setCategory] = useState('')
  const [genericName, setGenericName] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [saleType, setSaleType] = useState('retail')
  const [minPurchase, setMinPurchase] = useState('')
  const [priceUnit, setPriceUnit] = useState('card')
  const [description, setDescription] = useState('')
  const [emoji, setEmoji] = useState('💊')
  const [bizId, setBizId] = useState(businesses && businesses[0] ? businesses[0].id : '')
  const [image, setImage] = useState(null)
  const [sellerLocation, setSellerLocation] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { loadCount() }, [])

  async function loadCount() {
    // Count products owned by this user (by owner_id OR any of their businesses)
    const bizIds = (businesses || []).map(b => b.id)
    let q = supabase.from('products').select('id', { count: 'exact', head: true })
    if (bizIds.length) {
      q = q.or(`owner_id.eq.${user.id},business_id.in.(${bizIds.join(',')})`)
    } else {
      q = q.eq('owner_id', user.id)
    }
    const { count: c } = await q
    setCount(c || 0)
    // Check subscription
    const { data: sub } = await supabase.from('product_subscriptions').select('id, active, expires_at').eq('user_id', user.id).eq('active', true).gt('expires_at', new Date().toISOString()).maybeSingle()
    setSubscribed(!!sub)
    // Pull seller's location from their profile
    const { data: prof } = await supabase.from('profiles').select('location').eq('id', user.id).maybeSingle()
    if (prof?.location) setSellerLocation(prof.location)
  }

  const atLimit = count !== null && count >= FREE_LIMIT && !subscribed

  async function save() {
    if (!name.trim()) { setError('Product name is required.'); return }
    if (!price || isNaN(Number(price))) { setError('Enter a valid price.'); return }
    setSaving(true); setError('')
    let imageUrl = null
    if (image) {
      const ext = image.name.split('.').pop()
      const path = `product-${user.id}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('product-images').upload(path, image)
      if (!upErr) {
        const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(path)
        imageUrl = urlData.publicUrl
      }
    }
    const row = {
      name: name.trim(), price: Number(price), category: category.trim() || null,
      generic_name: genericName.trim() || null,
      whatsapp: whatsapp.trim() || null,
      sale_type: saleType,
      min_purchase: minPurchase ? Number(minPurchase) : null,
      price_unit: priceUnit,
      seller_location: sellerLocation || null,
      description: description.trim() || null, emoji, list_on_carefind: true,
      image_url: imageUrl,
    }
    if (bizId) row.business_id = bizId
    else row.owner_id = user.id
    const { error: insErr } = await supabase.from('products').insert(row)
    if (insErr) { setError('Could not add product: ' + insErr.message); setSaving(false); return }
    setSaving(false)
    if (onAdded) onAdded()
    onClose()
  }

  const inputStyle = { width: '100%', padding: '11px 13px', fontSize: 15, border: `1px solid ${theme.border}`, borderRadius: 10, boxSizing: 'border-box', fontFamily: 'inherit', marginBottom: 10 }
  const EMOJIS = ['💊', '🧴', '🩹', '🌡️', '💉', '🧼', '🪥', '🧬', '🩺', '👁️', '🦷', '🧫']

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, maxHeight: '88vh', overflowY: 'auto', padding: 20, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 900, color: theme.navy }}>Add Product to MedMarket</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: theme.textLight }}>✕</button>
        </div>
        {count !== null && (
          <p style={{ margin: '0 0 14px 0', fontSize: 12, color: atLimit ? theme.alert : theme.textMid }}>
            {subscribed ? '✓ Subscribed — unlimited products' : `${count} / ${FREE_LIMIT} free products used`}
          </p>
        )}

        {atLimit ? (
          <div style={{ background: '#fef2f2', border: `1px solid ${theme.alert}`, borderRadius: 12, padding: 16, textAlign: 'center' }}>
            <p style={{ margin: '0 0 6px 0', fontSize: 14, fontWeight: 800, color: theme.navy }}>You've used your 15 free products</p>
            <p style={{ margin: '0 0 12px 0', fontSize: 12.5, color: theme.textMid }}>Subscribe for ₦2,500/month to list unlimited products on CareFind.</p>
            <button onClick={() => alert('Subscription coming soon — payment setup in progress.')} style={{ padding: '11px 20px', background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13 }}>Subscribe ₦2,500/mo</button>
          </div>
        ) : (
          <div>
            {error && <p style={{ margin: '0 0 8px 0', fontSize: 12.5, color: theme.alert, fontWeight: 600 }}>{error}</p>}
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Product name (brand)" style={inputStyle} />
            <input value={genericName} onChange={(e) => setGenericName(e.target.value)} placeholder="Generic name / composition (e.g. Paracetamol 500mg)" style={inputStyle} />
            <p style={{ margin: '-4px 0 10px 0', fontSize: 10.5, color: theme.textLight }}>Helps people find your product by its active ingredient.</p>
            {sellerLocation
              ? <p style={{ margin: '0 0 10px 0', fontSize: 11.5, color: theme.tealDeep, fontWeight: 600 }}>📍 Listed in {sellerLocation} (from your profile)</p>
              : <p style={{ margin: '0 0 10px 0', fontSize: 11, color: theme.warning }}>⚠️ Add a location to your profile so buyers know where you are.</p>}
            <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price (₦)" inputMode="numeric" style={inputStyle} />

            {/* Retail or Wholesale */}
            <p style={{ margin: '0 0 6px 0', fontSize: 11, fontWeight: 800, color: theme.textMid, textTransform: 'uppercase' }}>Sale type</p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {['retail', 'wholesale'].map(t => (
                <button key={t} onClick={() => setSaleType(t)} style={{ flex: 1, padding: 10, borderRadius: 10, border: 'none', fontWeight: 800, fontSize: 13, textTransform: 'capitalize', background: saleType === t ? theme.tealDeep : theme.bg, color: saleType === t ? '#fff' : theme.textMid }}>{t}</button>
              ))}
            </div>

            {/* Price per unit */}
            <p style={{ margin: '0 0 6px 0', fontSize: 11, fontWeight: 800, color: theme.textMid, textTransform: 'uppercase' }}>Price is per</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {['card', 'box', 'roll', 'carton', 'bottle', 'sachet', 'pack', 'piece'].map(u => (
                <button key={u} onClick={() => setPriceUnit(u)} style={{ padding: '7px 12px', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 12, textTransform: 'capitalize', background: priceUnit === u ? theme.tealDeep : theme.bg, color: priceUnit === u ? '#fff' : theme.textMid }}>{u}</button>
              ))}
            </div>

            {/* Minimum purchase */}
            <input value={minPurchase} onChange={(e) => setMinPurchase(e.target.value)} placeholder={`Minimum purchase (e.g. 5 ${priceUnit}s)`} inputMode="numeric" style={inputStyle} />
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category (e.g. Skincare, Antibiotics)" style={inputStyle} />
            <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="WhatsApp number (e.g. 08012345678)" inputMode="tel" style={inputStyle} />
            <p style={{ margin: '-4px 0 10px 0', fontSize: 10.5, color: theme.textLight }}>Buyers can message you directly on WhatsApp about this product.</p>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" rows={3} style={{ ...inputStyle, resize: 'none' }} />

            <p style={{ margin: '0 0 6px 0', fontSize: 11, fontWeight: 800, color: theme.textMid, textTransform: 'uppercase' }}>Icon</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {EMOJIS.map(e => (
                <button key={e} onClick={() => setEmoji(e)} style={{ fontSize: 20, padding: 6, borderRadius: 8, border: emoji === e ? `2px solid ${theme.tealDeep}` : `1px solid ${theme.border}`, background: '#fff' }}>{e}</button>
              ))}
            </div>

            {businesses && businesses.length > 0 && (
              <>
                <p style={{ margin: '0 0 6px 0', fontSize: 11, fontWeight: 800, color: theme.textMid, textTransform: 'uppercase' }}>List under</p>
                <select value={bizId} onChange={(e) => setBizId(e.target.value)} style={inputStyle}>
                  {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  <option value="">My personal account</option>
                </select>
              </>
            )}

            <label style={{ display: 'block', fontSize: 12.5, color: theme.tealDeep, fontWeight: 700, cursor: 'pointer', marginBottom: 14 }}>
              📷 {image ? image.name.slice(0, 24) : 'Add product photo (optional)'}
              <input type="file" accept="image/*" onChange={(e) => setImage(e.target.files[0] || null)} style={{ display: 'none' }} />
            </label>

            <button onClick={save} disabled={saving} style={{ width: '100%', padding: 13, background: theme.tealGradient, color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 14 }}>
              {saving ? 'Adding…' : '＋ Add Product'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default ProductUpload
