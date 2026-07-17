import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import { useAuth } from './lib/AuthContext'

function App() {
  const { user, signOut } = useAuth()
  const [mode, setMode] = useState('business') // 'business' or 'medication'
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  async function handleSearch(e) {
    e.preventDefault()
    if (!query.trim()) return

    setLoading(true)
    setSearched(true)

    if (mode === 'business') {
      const { data, error } = await supabase
        .from('businesses')
        .select('id, name, address, city, state, business_type, whatsapp')
        .eq('visible_on_carefind', true)
        .ilike('name', `%${query}%`)

      if (error) {
        console.error('Search error:', error)
        setResults([])
      } else {
        setResults(data || [])
      }
    } else {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, generic_name, price, stock, emoji, business_id, businesses(name, address, city, state, whatsapp, visible_on_carefind)')
        .eq('list_on_carefind', true)
        .gt('stock', 0)
        .or(`name.ilike.%${query}%,generic_name.ilike.%${query}%`)

      if (error) {
        console.error('Search error:', error)
        setResults([])
      } else {
        const filtered = (data || []).filter((p) => p.businesses && p.businesses.visible_on_carefind)
        setResults(filtered)
      }
    }

    setLoading(false)
  }

  async function handleCategoryFilter(type) {
    setLoading(true)
    setSearched(true)
    setMode('business')
    setQuery('')

    const { data, error } = await supabase
      .from('businesses')
      .select('id, name, address, city, state, business_type, whatsapp')
      .eq('visible_on_carefind', true)
      .eq('business_type', type)

    if (error) {
      console.error('Category filter error:', error)
      setResults([])
    } else {
      setResults(data || [])
    }
    setLoading(false)
  }

  const categories = ['pharmacy', 'hospital', 'dental', 'optical', 'wellness', 'skincare']

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 480, margin: '0 auto', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Link to="/feed" style={{ color: '#0f766e', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
          Feed
        </Link>
        {user ? (
          <Link to="/profile" style={{ color: '#0f766e', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
            My Profile
          </Link>
        ) : (
          <Link to="/login" style={{ color: '#0f766e', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
            Log In / Sign Up
          </Link>
        )}
      </div>

      <h1 style={{ fontSize: 24, marginBottom: 4 }}>CareFind</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>Find pharmacies, hospitals & clinics near you</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => { setMode('business'); setResults([]); setSearched(false); setQuery('') }}
          style={{
            flex: 1, padding: 10, borderRadius: 8, border: '1px solid #0f766e',
            background: mode === 'business' ? '#0f766e' : '#fff',
            color: mode === 'business' ? '#fff' : '#0f766e', fontWeight: 600,
          }}
        >
          Businesses
        </button>
        <button
          onClick={() => { setMode('medication'); setResults([]); setSearched(false); setQuery('') }}
          style={{
            flex: 1, padding: 10, borderRadius: 8, border: '1px solid #0f766e',
            background: mode === 'medication' ? '#0f766e' : '#fff',
            color: mode === 'medication' ? '#fff' : '#0f766e', fontWeight: 600,
          }}
        >
          Medication
        </button>
      </div>

      <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={mode === 'business' ? 'Search business name...' : 'Search medication name...'}
          style={{ flex: 1, padding: 10, fontSize: 16, border: '1px solid #ccc', borderRadius: 8 }}
        />
        <button
          type="submit"
          style={{ padding: '10px 16px', fontSize: 16, background: '#0f766e', color: '#fff', border: 'none', borderRadius: 8 }}
        >
          Search
        </button>
      </form>

      {mode === 'business' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => handleCategoryFilter(cat)}
              style={{
                padding: '6px 12px', fontSize: 13, borderRadius: 20,
                border: '1px solid #ccc', background: '#f5f5f5', color: '#333', textTransform: 'capitalize',
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {loading && <p>Searching...</p>}

      {!loading && searched && results.length === 0 && (
        <p style={{ color: '#666' }}>No results found for "{query}".</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {mode === 'business' && results.map((biz) => (
          <div key={biz.id} style={{ border: '1px solid #eee', borderRadius: 10, padding: 14 }}>
            <Link to={`/business/${biz.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <h3 style={{ margin: '0 0 4px 0' }}>{biz.name}</h3>
            </Link>
            <p style={{ margin: '0 0 4px 0', color: '#666', fontSize: 14 }}>
              {biz.business_type} · {biz.city}, {biz.state}
            </p>
            <p style={{ margin: '0 0 8px 0', fontSize: 14 }}>{biz.address}</p>
            {biz.whatsapp && (
              <a
                href={`https://wa.me/${biz.whatsapp}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-block', padding: '8px 14px', background: '#25D366',
                  color: '#fff', borderRadius: 8, textDecoration: 'none', fontSize: 14,
                }}
              >
                WhatsApp
              </a>
            )}
          </div>
        ))}

        {mode === 'medication' && results.map((p) => (
          <div key={p.id} style={{ border: '1px solid #eee', borderRadius: 10, padding: 14 }}>
            <h3 style={{ margin: '0 0 4px 0' }}>{p.emoji ? `${p.emoji} ` : ''}{p.name}</h3>
            {p.generic_name && (
              <p style={{ margin: '0 0 4px 0', color: '#666', fontSize: 13 }}>Generic: {p.generic_name}</p>
            )}
            <p style={{ margin: '0 0 4px 0', fontSize: 14 }}>
              ₦{p.price} · In stock: {p.stock}
            </p>
            {p.businesses && (
              <>
                <p style={{ margin: '0 0 4px 0', fontWeight: 600 }}>{p.businesses.name}</p>
                <p style={{ margin: '0 0 8px 0', color: '#666', fontSize: 13 }}>
                  {p.businesses.city}, {p.businesses.state}
                </p>
                {p.businesses.whatsapp && (
                  <a
                    href={`https://wa.me/${p.businesses.whatsapp}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'inline-block', padding: '8px 14px', background: '#25D366',
                      color: '#fff', borderRadius: 8, textDecoration: 'none', fontSize: 14,
                    }}
                  >
                    WhatsApp
                  </a>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default App
