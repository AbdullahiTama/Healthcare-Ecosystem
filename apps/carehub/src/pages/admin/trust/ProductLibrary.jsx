import { useCallback, useEffect, useState } from 'react'
import { masterCatalogRepository } from '../../../modules/master-catalog/repositories'
import { libraryRepository } from '../../../modules/product-library/repositories'
import LibraryReview from '../../../modules/product-library/admin/LibraryReview'
import LibrarySuggestions from '../../../modules/product-library/admin/LibrarySuggestions'
import LibraryImport from '../../../modules/product-library/admin/LibraryImport'

const VIEWS = [
  { id: 'pending', label: 'Review queue' },
  { id: 'suggestions', label: 'Suggestions' },
  { id: 'active', label: 'Approved' },
  { id: 'import', label: 'Import list' },
  { id: 'retired', label: 'Retired' },
]

// The shared CareHub product library (Product-Catalogue-Design.md, phase 4), for CareHub admins: review candidates
// from business catalogues, decide what businesses suggest, browse the approved library, import an official list,
// and see retired items. Every change goes through admin-only database functions.
export default function ProductLibrary({ repository = libraryRepository, categoriesRepository = masterCatalogRepository }) {
  const [view, setView] = useState('pending')
  const [categories, setCategories] = useState([])
  const [counts, setCounts] = useState({})

  useEffect(() => {
    categoriesRepository.getCategories().then((c) => setCategories(c || [])).catch((e) => console.error('[library] categories:', e))
  }, [categoriesRepository])

  const refreshCounts = useCallback(async () => {
    try {
      const [queue, suggestions] = await Promise.all([repository.adminPage({ status: 'pending', limit: 1 }), repository.suggestions({ limit: 1 })])
      setCounts({ pending: queue.total, suggestions: suggestions.total })
    } catch (e) { console.error('[library] counts:', e) }
  }, [repository])
  useEffect(() => { refreshCounts() }, [refreshCounts])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 16, color: 'var(--fg)' }}>Product library</h2>
        <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>
          One shared list of real products. Businesses link their items to it; a linked item can never be less strict than the library’s prescription status.
        </p>
      </div>
      <div role='tablist' aria-label='Product library' style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
        {VIEWS.map((v) => (
          <button key={v.id} role='tab' aria-selected={view === v.id} onClick={() => setView(v.id)}
            style={{ padding: '7px 12px', minHeight: 36, borderRadius: 8, whiteSpace: 'nowrap', border: view === v.id ? '1px solid var(--teal)' : '1px solid var(--border)', background: view === v.id ? 'var(--teal-mist)' : 'var(--panel)', color: view === v.id ? 'var(--teal)' : 'var(--muted)', fontWeight: 700, fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>
            {v.label}{counts[v.id] ? ` (${counts[v.id].toLocaleString()})` : ''}
          </button>
        ))}
      </div>
      <div role='tabpanel' aria-label={VIEWS.find((v) => v.id === view).label}>
        {view === 'suggestions' ? <LibrarySuggestions categories={categories} repository={repository} onChanged={refreshCounts} />
          : view === 'import' ? <LibraryImport repository={repository} onChanged={refreshCounts} />
          : <LibraryReview key={view} status={view} categories={categories} repository={repository} onChanged={refreshCounts} />}
      </div>
    </div>
  )
}
