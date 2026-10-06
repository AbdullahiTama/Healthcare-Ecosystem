import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

// Keeps a screen's filters and open record in the query string so a view
// survives a refresh and can be shared. `defaults` must be a module-level
// constant: it is a dependency of both memoised values.
//
// Safe to use setSearchParams here because the admin console has its own,
// un-keyed router. Do not copy this into pages under the keyed public router.
export function useUrlFilters(defaults) {
  const [params, setParams] = useSearchParams()

  const values = useMemo(() => {
    const out = {}
    for (const key of Object.keys(defaults)) out[key] = params.get(key) ?? defaults[key]
    return out
  }, [params, defaults])

  const set = useCallback((patch, { replace = true } = {}) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined || value === '' || value === defaults[key]) next.delete(key)
        else next.set(key, String(value))
      }
      return next
    }, { replace })
  }, [setParams, defaults])

  return [values, set]
}
