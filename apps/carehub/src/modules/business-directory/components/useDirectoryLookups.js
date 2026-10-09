import { useCallback, useEffect, useMemo, useState } from 'react'
import { directoryRepository } from '../repositories'

// Categories and subcategories change rarely and every directory screen needs
// them to turn ids into names, so they load once per screen.
export function useDirectoryLookups(businessId, repo = directoryRepository) {
  const [categories, setCategories] = useState([])
  const [subcategories, setSubcategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    if (!businessId) return
    setLoading(true)
    setError('')
    try {
      const [c, s] = await Promise.all([repo.getCategories(businessId), repo.getSubcategories(businessId)])
      setCategories(c || [])
      setSubcategories(s || [])
    } catch (e) {
      setError(e.message || 'Could not load categories')
    }
    setLoading(false)
  }, [businessId, repo])

  useEffect(() => { reload() }, [reload])

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const subById = useMemo(() => new Map(subcategories.map((s) => [s.id, s])), [subcategories])

  return {
    categories, subcategories, loading, error, reload,
    categoryName: (id) => catById.get(id)?.name || '',
    subcategoryName: (id) => subById.get(id)?.name || '',
  }
}
