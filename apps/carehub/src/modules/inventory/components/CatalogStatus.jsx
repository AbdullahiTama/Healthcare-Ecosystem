import { RefreshCw, WifiOff, AlertTriangle, Loader2 } from 'lucide-react'
import { Card, Skeleton } from '../../../components/ui'
import { theme } from '../../../styles/theme'

// Presentation for the shared product catalog's loading states
// (hooks/useProductCatalog.js). Used by Inventory and POS so both describe the
// same situation in the same words.

const { navy, gray500, border, warning, warningBg, tealDeep, tealMist } = theme

const SPIN_CSS = '.catalog-spin{animation:catalog-spin .8s linear infinite}@keyframes catalog-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion: reduce){.catalog-spin{animation:none}}'

const STALE_COPY = {
  offline: "You're offline. Showing the products saved on this device; changes you make will need a connection.",
  failed: "We couldn't refresh your products. Showing the copy saved on this device, which may be out of date.",
  unconfirmed: "We couldn't confirm your latest products (your sign-in may have expired). Showing the copy saved on this device.",
}

export function loadingLabel(loadedCount) {
  return loadedCount > 0 ? `Loading products… ${loadedCount.toLocaleString()} loaded` : 'Loading products…'
}

// A thin line above the page while a fresh list loads behind products already
// on screen, or a warning when the products shown are the saved offline copy.
export function CatalogStatusBanner({ catalog }) {
  if (!catalog) return null
  const { stale, staleReason, refreshing, loadedCount, status, reload } = catalog
  if (status !== 'ready') return null

  if (refreshing) {
    return (
      <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, padding: '8px 12px', borderRadius: theme.radius.md, background: tealMist, color: tealDeep, fontSize: 12, fontWeight: 700 }}>
        <Loader2 size={14} className="catalog-spin" aria-hidden="true" />
        {loadedCount > 0 ? `Updating your product list… ${loadedCount.toLocaleString()} loaded` : 'Updating your product list…'}
        <style>{SPIN_CSS}</style>
      </div>
    )
  }

  if (stale) {
    const Icon = staleReason === 'offline' ? WifiOff : AlertTriangle
    return (
      <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14, padding: '10px 14px', borderRadius: theme.radius.md, background: warningBg, border: `1px solid ${warning}`, color: warning, fontSize: 13 }}>
        <Icon size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 200, fontWeight: 600 }}>{STALE_COPY[staleReason] || STALE_COPY.failed}</span>
        {staleReason !== 'offline' && reload && (
          <button type="button" onClick={reload} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: theme.radius.md, border: `1px solid ${warning}`, background: 'white', color: warning, fontWeight: 700, fontSize: 12, cursor: 'pointer', minHeight: 32 }}>
            <RefreshCw size={13} aria-hidden="true" /> Try again
          </button>
        )}
      </div>
    )
  }
  return null
}

// Placeholder for the summary tiles and product rows while the first load runs.
export function CatalogSkeleton({ loadedCount = 0, tiles = 6, rows = 8 }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>{loadingLabel(loadedCount)}</span>
      {tiles > 0 && (
        <div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 20 }}>
          {Array.from({ length: tiles }, (_, i) => (
            <Card key={i} style={{ padding: 16 }}>
              <Skeleton width={28} height={28} radius={theme.radius.md} style={{ marginBottom: 12 }} />
              <Skeleton width="55%" height={12} style={{ marginBottom: 8 }} />
              <Skeleton width="40%" height={20} />
            </Card>
          ))}
        </div>
      )}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', borderBottom: `1px solid ${border}`, color: navy, fontSize: 13, fontWeight: 700 }} aria-hidden="true">
          <Loader2 size={15} className="catalog-spin" color={tealDeep} />
          {loadingLabel(loadedCount)}
          <style>{SPIN_CSS}</style>
        </div>
        <div aria-hidden="true">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: i < rows - 1 ? `1px solid ${border}` : 'none' }}>
              <Skeleton width={32} height={32} radius={theme.radius.md} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Skeleton width={`${50 + ((i * 17) % 35)}%`} height={12} style={{ marginBottom: 6 }} />
                <Skeleton width="30%" height={10} />
              </div>
              <Skeleton width={60} height={12} />
            </div>
          ))}
        </div>
        <div style={{ padding: '10px 16px', fontSize: 12, color: gray500 }} aria-hidden="true">Large catalogs can take a few seconds on a slow connection.</div>
      </Card>
    </div>
  )
}
