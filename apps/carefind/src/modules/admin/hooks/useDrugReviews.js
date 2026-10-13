import { useCallback, useEffect, useRef, useState } from 'react'
import { commerceRepository } from '../repositories/commerceRepository'

// Searches products by name and loads the reviews of every match (as the legacy
// searchDrugs did). `result` is null until a search runs, then
// { status: 'ok', term, product, matches, reviews } or { status: 'error', term }
// so the screen can retry the term. A failed load is an error, never an empty
// review list. A late result from an older search never overwrites a newer one,
// and nothing sets state after unmount.
export function useDrugReviews() {
  const [result, setResult] = useState(null)
  const [searching, setSearching] = useState(false)
  const latest = useRef(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const search = useCallback(async (term) => {
    const q = typeof term === 'string' ? term.trim() : ''
    if (!q) return
    const id = ++latest.current
    const current = () => mounted.current && id === latest.current
    setSearching(true)
    let next
    try {
      const products = await commerceRepository.searchProducts(q)
      // A superseded or unmounted search stops here, before its reviews call.
      if (!current()) return
      if (!Array.isArray(products)) throw new Error('searchProducts returned no list')
      if (products.length === 0) {
        next = { status: 'ok', term: q, product: null, matches: 0, reviews: [] }
      } else {
        const reviews = await commerceRepository.getProductReviews(products.map(p => p.id))
        if (!Array.isArray(reviews)) throw new Error('getProductReviews returned no list')
        next = { status: 'ok', term: q, product: products[0], matches: products.length, reviews }
      }
    } catch {
      next = { status: 'error', term: q }
    }
    if (!current()) return
    setResult(next)
    setSearching(false)
  }, [])

  return { result, searching, search }
}
