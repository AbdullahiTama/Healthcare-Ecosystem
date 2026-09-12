import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { theme } from '../styles/theme'

const SORT_OPTIONS = [
  { value: 'popular', label: 'Popular' },
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price ↑' },
  { value: 'price_desc', label: 'Price ↓' },
  { value: 'rating', label: 'Rating' },
]

export default function FilterSheet({
  open,
  onClose,
  saleType,
  onSaleTypeChange,
  priceMin,
  onPriceMinChange,
  priceMax,
  onPriceMaxChange,
  category,
  onCategoryChange,
  categories = [],
  showRxOnly,
  onShowRxOnlyChange,
  inStockOnly,
  onInStockOnlyChange,
  sort,
  onSortChange,
  onClear,
}) {
  const overlayRef = useRef(null)
  const sheetRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  const activeCount = [
    saleType !== 'all',
    priceMin !== '',
    priceMax !== '',
    category !== 'all',
    showRxOnly,
    !inStockOnly,
    sort !== 'popular',
  ].filter(Boolean).length

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        animation: 'fs-fade-in 0.2s ease',
      }}
    >
      <style>{`
        @keyframes fs-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes fs-slide-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
      `}</style>
      <div
        ref={sheetRef}
        style={{
          width: '100%',
          maxWidth: 480,
          maxHeight: '80vh',
          background: '#fff',
          borderRadius: '20px 20px 0 0',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          animation: 'fs-slide-up 0.25s ease',
        }}
      >
        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 0' }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: theme.border }} />
        </div>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: theme.navy }}>Filters</span>
            {activeCount > 0 && (
              <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: theme.tealDeep, borderRadius: 999, padding: '2px 8px', lineHeight: '16px' }}>{activeCount}</span>
            )}
          </div>
          <button onClick={onClose} aria-label="Close filters" style={{ width: 32, height: 32, borderRadius: 999, border: `1px solid ${theme.border}`, background: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
            <X size={16} color={theme.textMid} />
          </button>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Sale Type */}
          <section>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 800, color: theme.navy, marginBottom: 10 }}>Sale Type</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {['all', 'retail', 'wholesale', 'distributor'].map(s => (
                <button key={s} onClick={() => onSaleTypeChange(s)}
                  style={{
                    padding: '8px 16px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer', minHeight: 40,
                    border: `2px solid ${saleType === s ? theme.tealDeep : theme.border}`,
                    background: saleType === s ? theme.tealDeep : '#fff',
                    color: saleType === s ? '#fff' : theme.textMid,
                  }}>
                  {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </section>

          {/* Price Range */}
          <section>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 800, color: theme.navy, marginBottom: 10 }}>Price Range</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                placeholder="Min ₦"
                value={priceMin}
                onChange={(e) => onPriceMinChange(e.target.value)}
                inputMode="numeric"
                aria-label="Minimum price"
                style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.border}`, fontSize: 13, minHeight: 44, boxSizing: 'border-box' }}
              />
              <span style={{ color: theme.textMid, fontSize: 13 }}>–</span>
              <input
                placeholder="Max ₦"
                value={priceMax}
                onChange={(e) => onPriceMaxChange(e.target.value)}
                inputMode="numeric"
                aria-label="Maximum price"
                style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.border}`, fontSize: 13, minHeight: 44, boxSizing: 'border-box' }}
              />
            </div>
          </section>

          {/* Category */}
          {categories.length > 1 && (
            <section>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 800, color: theme.navy, marginBottom: 10 }}>Category</label>
              <select
                value={category}
                onChange={(e) => onCategoryChange(e.target.value)}
                aria-label="Filter by category"
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.border}`, fontSize: 13, minHeight: 44, background: '#fff' }}
              >
                {categories.map(c => <option key={c} value={c}>{c === 'all' ? 'All categories' : c}</option>)}
              </select>
            </section>
          )}

          {/* Toggles */}
          <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: theme.navy, minHeight: 44, cursor: 'pointer' }}>
              <input type="checkbox" checked={inStockOnly} onChange={(e) => onInStockOnlyChange(e.target.checked)}
                style={{ width: 18, height: 18, accentColor: theme.tealDeep }} />
              In stock only
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: theme.navy, minHeight: 44, cursor: 'pointer' }}>
              <input type="checkbox" checked={showRxOnly} onChange={(e) => onShowRxOnlyChange(e.target.checked)}
                style={{ width: 18, height: 18, accentColor: theme.tealDeep }} />
              Rx only (prescription required)
            </label>
          </section>

          {/* Sort */}
          <section>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 800, color: theme.navy, marginBottom: 10 }}>Sort by</label>
            <select
              value={sort}
              onChange={(e) => onSortChange(e.target.value)}
              aria-label="Sort products"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.border}`, fontSize: 13, minHeight: 44, background: '#fff' }}
            >
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </section>
        </div>

        {/* Footer actions */}
        <div style={{ padding: '12px 20px calc(12px + env(safe-area-inset-bottom))', borderTop: `1px solid ${theme.border}`, display: 'flex', gap: 10, background: '#fff' }}>
          {activeCount > 0 && (
            <button onClick={onClear} style={{ flex: 1, minHeight: 48, borderRadius: 12, border: `1px solid ${theme.border}`, background: '#fff', color: theme.tealDeep, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              Clear all
            </button>
          )}
          <button onClick={onClose} style={{ flex: activeCount > 0 ? 1 : 2, minHeight: 48, borderRadius: 12, border: 'none', background: theme.tealDeep, color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
            Show results
          </button>
        </div>
      </div>
    </div>
  )
}
