import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { wishlistRepository } from './wishlistRepository'
const Ctx = createContext(null)
export function WishlistProvider({ children }) {
  const [ids, setIds] = useState([])
  // What the user chose while the database request was in flight (product id -> now in the wishlist?). The
  // database answer is applied underneath these choices instead of replacing them.
  const touchedRef = useRef(new Map())

  // Hydrate once from the database; fall back to the local list if it cannot be read.
  useEffect(() => {
    let cancelled = false
    wishlistRepository.getAllAsync()
      .then(dbIds => {
        if (cancelled) return
        const merged = new Set(dbIds || [])
        touchedRef.current.forEach((inList, id) => { if (inList) merged.add(id); else merged.delete(id) })
        setIds([...merged])
      })
      .catch(() => { if (!cancelled) setIds(wishlistRepository.getAll()) })
    return () => { cancelled = true }
  }, [])

  const toggle = useCallback((id) => {
    const next = wishlistRepository.toggle(id)
    touchedRef.current.set(id, next.includes(id))
    setIds(next)
  }, [])
  const has = useCallback((id) => ids.includes(id), [ids])
  const value = useMemo(() => ({ ids, toggle, has, count: ids.length }), [ids, toggle, has])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
export function useWishlist() { const v = useContext(Ctx); if(!v) throw new Error('useWishlist within provider'); return v }
