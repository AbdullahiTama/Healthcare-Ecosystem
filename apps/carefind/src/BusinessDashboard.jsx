import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import { useAuth } from './lib/AuthContext'
import { theme } from './lib/theme'
import BottomNav from './BottomNav.jsx'

function BusinessDashboard() {
  const { user, loading: authLoading } = useAuth()
  const [businesses, setBusinesses] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [products, setProducts] = useState([])
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [csvUploading, setCsvUploading] = useState(false)
  const [csvResult, setCsvResult] = useState(null)
  const [showCsvUpload, setShowCsvUpload] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null)
  const [editPrice, setEditPrice] = useState('')
  const [editStock, setEditStock] = useState('')
  const [savingProduct, setSavingProduct] = useState(false)

  async function loadBusinesses() {
    if (!user) return
    const { data: claims } = await supabase
      .from('business_claims')
      .select('business_id, businesses(id, name, business_type, visible_on_carefind)')
      .eq('user_id', user.id)
      .eq('status', 'approved')

    const list = (claims || []).map((c) => c.businesses).filter(Boolean)
    setBusinesses(list)
    if (list.length > 0 && !selectedId) setSelectedId(list[0].id)
  }

  async function loadBusinessData(businessId) {
    const { data: productData } = await supabase
      .from('products')
      .select('id, name, price, stock, list_on_carefind')
      .eq('business_id', businessId)

    const { data: reviewData } = await supabase
      .from('reviews')
      .select('id, rating, comment, created_at')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })

    setProducts(productData || [])
    setReviews(reviewData || [])
  }

  useEffect(() => {
    async function init() {
      setLoading(true)
      await loadBusinesses()
      setLoading(false)
    }
    if (!authLoading) init()
    // eslint-disable-next-line
  }, [user, authLoading])

  useEffect(() => {
    if (selectedId) loadBusinessData(selectedId)
  }, [selectedId])

  async function toggleBusinessVisibility(biz) {
    await supabase.from('businesses').update({ visible_on_carefind: !biz.visible_on_carefind }).eq('id', biz.id)
    loadBusinesses()
  }

  async function toggleProductVisibility(product) {
    await supabase.from('products').update({ list_on_carefind: !product.list_on_carefind }).eq('id', product.id)
    loadBusinessData(selectedId)
  }

  const avgRating = reviews.length
    ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
    : null

  const selectedBiz = businesses.find((b) => b.id === selectedId)

  if (authLoading || loading) return <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif' }}>Loading...</div>

  if (!user) {
    async function saveProduct(productId) {
    setSavingProduct(true)
    await supabase.from('products').update({
      price: parseInt(editPrice),
      stock: parseInt(editStock),
    }).eq('id', productId)
    setEditingProduct(null)
    await loadBusinessData(selectedId)
    setSavingProduct(false)
  }

  async function toggleProductVisibility(productId, currentVal) {
    await supabase.from('products').update({ list_on_carefind: !currentVal }).eq('id', productId)
    await loadBusinessData(selectedId)
  }

  function downloadTemplate() {
    const template = [
      'name,generic_name,price,stock,category,emoji',
      'Paracetamol 500mg,Acetaminophen,150,100,analgesic,💊',
      'Amoxicillin 250mg,Amoxicillin,450,50,antibiotic,💊',
      'Vitamin C 1000mg,Ascorbic Acid,800,200,supplement,🍊',
    ].join('\n')
    const blob = new Blob([template], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'carefind_stock_template.csv'
    a.click()
  }

  async function handleCSVUpload(e) {
    const file = e.target.files[0]
    if (!file || !selectedId) return
    setCsvUploading(true)
    setCsvResult(null)

    const text = await file.text()
    const lines = text.trim().split('\n')
    const headers = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''))

    const nameIdx = headers.indexOf('name')
    const genericIdx = headers.indexOf('generic_name')
    const priceIdx = headers.indexOf('price')
    const stockIdx = headers.indexOf('stock')
    const categoryIdx = headers.indexOf('category')
    const emojiIdx = headers.indexOf('emoji')

    if (nameIdx === -1 || priceIdx === -1 || stockIdx === -1) {
      setCsvResult({ error: 'CSV must have columns: name, price, stock' })
      setCsvUploading(false)
      return
    }

    const rows = lines.slice(1).filter(l => l.trim())
    let added = 0; let updated = 0; let errors = 0

    for (const row of rows) {
      try {
        const cols = row.split(',').map(c => c.trim().replace(/"/g, ''))
        const name = cols[nameIdx]
        const price = parseInt(cols[priceIdx]) || 0
        const stock = parseInt(cols[stockIdx]) || 0
        if (!name || price <= 0) { errors++; continue }

        // Check if product exists
        const { data: existing } = await supabase
          .from('products')
          .select('id')
          .eq('business_id', selectedId)
          .ilike('name', name)
          .maybeSingle()

        const productData = {
          name,
          price,
          stock,
          business_id: selectedId,
          list_on_carefind: true,
          generic_name: genericIdx >= 0 ? cols[genericIdx] : null,
          category: categoryIdx >= 0 ? cols[categoryIdx] : null,
          emoji: emojiIdx >= 0 ? cols[emojiIdx] : '💊',
        }

        if (existing) {
          await supabase.from('products').update({ price, stock, list_on_carefind: true }).eq('id', existing.id)
          updated++
        } else {
          await supabase.from('products').insert(productData)
          added++
        }
      } catch { errors++ }
    }

    setCsvResult({ added, updated, errors, total: rows.length })
    await loadBusinessData(selectedId)
    setCsvUploading(false)
  }

  return (
      <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif', maxWidth: 420, margin: '0 auto', textAlign: 'center' }}>
        <p style={{ color: theme.textMid }}>Log in to manage your business.</p>
        <Link to="/login" style={{ color: theme.tealDeep, fontWeight: 700 }}>Log In</Link>
      </div>
    )
  }

  if (businesses.length === 0) {
    async function saveProduct(productId) {
    setSavingProduct(true)
    await supabase.from('products').update({
      price: parseInt(editPrice),
      stock: parseInt(editStock),
    }).eq('id', productId)
    setEditingProduct(null)
    await loadBusinessData(selectedId)
    setSavingProduct(false)
  }

  async function toggleProductVisibility(productId, currentVal) {
    await supabase.from('products').update({ list_on_carefind: !currentVal }).eq('id', productId)
    await loadBusinessData(selectedId)
  }

  function downloadTemplate() {
    const template = [
      'name,generic_name,price,stock,category,emoji',
      'Paracetamol 500mg,Acetaminophen,150,100,analgesic,💊',
      'Amoxicillin 250mg,Amoxicillin,450,50,antibiotic,💊',
      'Vitamin C 1000mg,Ascorbic Acid,800,200,supplement,🍊',
    ].join('\n')
    const blob = new Blob([template], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'carefind_stock_template.csv'
    a.click()
  }

  async function handleCSVUpload(e) {
    const file = e.target.files[0]
    if (!file || !selectedId) return
    setCsvUploading(true)
    setCsvResult(null)

    const text = await file.text()
    const lines = text.trim().split('\n')
    const headers = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''))

    const nameIdx = headers.indexOf('name')
    const genericIdx = headers.indexOf('generic_name')
    const priceIdx = headers.indexOf('price')
    const stockIdx = headers.indexOf('stock')
    const categoryIdx = headers.indexOf('category')
    const emojiIdx = headers.indexOf('emoji')

    if (nameIdx === -1 || priceIdx === -1 || stockIdx === -1) {
      setCsvResult({ error: 'CSV must have columns: name, price, stock' })
      setCsvUploading(false)
      return
    }

    const rows = lines.slice(1).filter(l => l.trim())
    let added = 0; let updated = 0; let errors = 0

    for (const row of rows) {
      try {
        const cols = row.split(',').map(c => c.trim().replace(/"/g, ''))
        const name = cols[nameIdx]
        const price = parseInt(cols[priceIdx]) || 0
        const stock = parseInt(cols[stockIdx]) || 0
        if (!name || price <= 0) { errors++; continue }

        // Check if product exists
        const { data: existing } = await supabase
          .from('products')
          .select('id')
          .eq('business_id', selectedId)
          .ilike('name', name)
          .maybeSingle()

        const productData = {
          name,
          price,
          stock,
          business_id: selectedId,
          list_on_carefind: true,
          generic_name: genericIdx >= 0 ? cols[genericIdx] : null,
          category: categoryIdx >= 0 ? cols[categoryIdx] : null,
          emoji: emojiIdx >= 0 ? cols[emojiIdx] : '💊',
        }

        if (existing) {
          await supabase.from('products').update({ price, stock, list_on_carefind: true }).eq('id', existing.id)
          updated++
        } else {
          await supabase.from('products').insert(productData)
          added++
        }
      } catch { errors++ }
    }

    setCsvResult({ added, updated, errors, total: rows.length })
    await loadBusinessData(selectedId)
    setCsvUploading(false)
  }

  return (
      <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 420, margin: '0 auto', paddingBottom: 90 }}>
        <div style={{ background: theme.heroGradient, padding: '22px 20px 26px 20px', borderRadius: '0 0 28px 28px', color: '#fff' }}>
          <Link to="/profile" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>← Profile</Link>
          <h1 style={{ fontSize: 21, fontWeight: 900, margin: '14px 0 4px 0' }}>Business Dashboard</h1>
        </div>
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, background: '#fef3c7', display: 'flex',
            alignItems: 'center', justifyContent: 'center', fontSize: 26, margin: '0 auto 14px auto',
          }}>
            🏥
          </div>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: theme.navy, margin: '0 0 4px 0' }}>No approved business yet</h3>
          <p style={{ fontSize: 13, color: theme.textLight, margin: '0 0 16px 0' }}>
            Once your business claim is approved, it'll show up here
          </p>
          <Link to="/claim-business" style={{
            display: 'inline-block', padding: '10px 20px', background: theme.tealGradient, color: '#fff',
            borderRadius: 14, textDecoration: 'none', fontWeight: 700, fontSize: 13,
          }}>
            Claim a Business
          </Link>
        </div>
        <BottomNav />
      </div>
    )
  }

  async function saveProduct(productId) {
    setSavingProduct(true)
    await supabase.from('products').update({
      price: parseInt(editPrice),
      stock: parseInt(editStock),
    }).eq('id', productId)
    setEditingProduct(null)
    await loadBusinessData(selectedId)
    setSavingProduct(false)
  }

  async function toggleProductVisibility(productId, currentVal) {
    await supabase.from('products').update({ list_on_carefind: !currentVal }).eq('id', productId)
    await loadBusinessData(selectedId)
  }

  function downloadTemplate() {
    const template = [
      'name,generic_name,price,stock,category,emoji',
      'Paracetamol 500mg,Acetaminophen,150,100,analgesic,💊',
      'Amoxicillin 250mg,Amoxicillin,450,50,antibiotic,💊',
      'Vitamin C 1000mg,Ascorbic Acid,800,200,supplement,🍊',
    ].join('\n')
    const blob = new Blob([template], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'carefind_stock_template.csv'
    a.click()
  }

  async function handleCSVUpload(e) {
    const file = e.target.files[0]
    if (!file || !selectedId) return
    setCsvUploading(true)
    setCsvResult(null)

    const text = await file.text()
    const lines = text.trim().split('\n')
    const headers = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''))

    const nameIdx = headers.indexOf('name')
    const genericIdx = headers.indexOf('generic_name')
    const priceIdx = headers.indexOf('price')
    const stockIdx = headers.indexOf('stock')
    const categoryIdx = headers.indexOf('category')
    const emojiIdx = headers.indexOf('emoji')

    if (nameIdx === -1 || priceIdx === -1 || stockIdx === -1) {
      setCsvResult({ error: 'CSV must have columns: name, price, stock' })
      setCsvUploading(false)
      return
    }

    const rows = lines.slice(1).filter(l => l.trim())
    let added = 0; let updated = 0; let errors = 0

    for (const row of rows) {
      try {
        const cols = row.split(',').map(c => c.trim().replace(/"/g, ''))
        const name = cols[nameIdx]
        const price = parseInt(cols[priceIdx]) || 0
        const stock = parseInt(cols[stockIdx]) || 0
        if (!name || price <= 0) { errors++; continue }

        // Check if product exists
        const { data: existing } = await supabase
          .from('products')
          .select('id')
          .eq('business_id', selectedId)
          .ilike('name', name)
          .maybeSingle()

        const productData = {
          name,
          price,
          stock,
          business_id: selectedId,
          list_on_carefind: true,
          generic_name: genericIdx >= 0 ? cols[genericIdx] : null,
          category: categoryIdx >= 0 ? cols[categoryIdx] : null,
          emoji: emojiIdx >= 0 ? cols[emojiIdx] : '💊',
        }

        if (existing) {
          await supabase.from('products').update({ price, stock, list_on_carefind: true }).eq('id', existing.id)
          updated++
        } else {
          await supabase.from('products').insert(productData)
          added++
        }
      } catch { errors++ }
    }

    setCsvResult({ added, updated, errors, total: rows.length })
    await loadBusinessData(selectedId)
    setCsvUploading(false)
  }

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 480, margin: '0 auto', paddingBottom: 90 }}>
      <div style={{ background: theme.heroGradient, padding: '22px 20px 26px 20px', borderRadius: '0 0 28px 28px', color: '#fff' }}>
        <Link to="/profile" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>← Profile</Link>
        <h1 style={{ fontSize: 21, fontWeight: 900, margin: '14px 0 4px 0' }}>Business Dashboard</h1>

        {businesses.length > 1 && (
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            style={{ marginTop: 10, padding: 8, borderRadius: 10, border: 'none', fontSize: 13, fontWeight: 700 }}
          >
            {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </div>

      {selectedBiz && (
        <div style={{ padding: '20px 20px 0 20px' }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            border: `1px solid ${theme.border}`, borderRadius: 16, padding: 14, marginBottom: 20,
            background: theme.cardBg, boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
          }}>
            <div>
              <p style={{ margin: '0 0 2px 0', fontWeight: 800, fontSize: 15, color: theme.navy }}>{selectedBiz.name}</p>
              <p style={{ margin: 0, fontSize: 12.5, color: theme.textLight }}>
                {avgRating ? `⭐ ${avgRating} · ${reviews.length} reviews` : 'No reviews yet'}
              </p>
            </div>
            <button
              onClick={() => toggleBusinessVisibility(selectedBiz)}
              style={{
                padding: '7px 14px', borderRadius: 12, border: 'none', fontSize: 12, fontWeight: 700,
                background: selectedBiz.visible_on_carefind ? '#ecfdf5' : '#fef2f2',
                color: selectedBiz.visible_on_carefind ? theme.success : theme.alert,
              }}
            >
              {selectedBiz.visible_on_carefind ? '● Visible' : '○ Hidden'}
            </button>
          </div>

          <p style={{ fontSize: 11, fontWeight: 800, color: theme.tealDeep, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px 0' }}>
            Products ({products.length})
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
            {products.length === 0 && <p style={{ color: theme.textLight, fontSize: 13 }}>No products yet — add them in CareHub.</p>}
            {products.map((p) => (
              <div key={p.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                border: `1px solid ${theme.border}`, borderRadius: 14, padding: 12,
                background: theme.cardBg, boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
              }}>
                <div>
                  <p style={{ margin: '0 0 2px 0', fontWeight: 700, fontSize: 13.5, color: theme.navy }}>{p.name}</p>
                  <p style={{ margin: 0, fontSize: 12, color: theme.textLight }}>₦{p.price} · Stock: {p.stock}</p>
                </div>
                <button
                  onClick={() => toggleProductVisibility(p)}
                  style={{
                    padding: '6px 12px', borderRadius: 10, border: 'none', fontSize: 11, fontWeight: 700,
                    background: p.list_on_carefind ? '#ecfdf5' : theme.bg,
                    color: p.list_on_carefind ? theme.success : theme.textLight,
                  }}
                >
                  {p.list_on_carefind ? 'Listed' : 'Hidden'}
                </button>
              </div>
            ))}
          </div>

          <p style={{ fontSize: 11, fontWeight: 800, color: theme.tealDeep, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px 0' }}>
            Reviews
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {reviews.length === 0 && <p style={{ color: theme.textLight, fontSize: 13 }}>No reviews yet.</p>}
            {reviews.map((r) => (
              <div key={r.id} style={{ border: `1px solid ${theme.border}`, borderRadius: 14, padding: 13, background: theme.cardBg, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <p style={{ margin: '0 0 4px 0', color: theme.warning, fontSize: 13 }}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</p>
                {r.comment && <p style={{ margin: 0, fontSize: 13, color: theme.textMid }}>{r.comment}</p>}
              </div>
            ))}
          </div>

          <div style={{
            marginTop: 20, border: `1px solid ${theme.border}`, borderRadius: 14, padding: 14,
            background: theme.bg, textAlign: 'center',
          }}>
            <p style={{ margin: 0, fontSize: 12, color: theme.textLight }}>
              📈 Detailed analytics, review replies, and staff invites are coming soon
            </p>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  )
}

export default BusinessDashboard
