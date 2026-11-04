import { useEffect, useState } from 'react'
import { representativesRepository } from './repositories'

// Debounced search of the company's own products, shared by the entry forms and the register's product filter.
// Returns { results, searching }. A failed search logs and shows no results rather than breaking the form.
export function useProductSearch(companyId, search, enabled = true, delay = 250) {
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!enabled || !companyId) return undefined
    let alive = true
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await representativesRepository.searchProducts(companyId, search)
        if (alive) setResults(r || [])
      } catch (e) {
        console.error('[representatives] product search failed:', e)
        if (alive) setResults([])
      }
      if (alive) setSearching(false)
    }, delay)
    return () => { alive = false; clearTimeout(t) }
  }, [companyId, search, enabled, delay])

  return { results, searching }
}
