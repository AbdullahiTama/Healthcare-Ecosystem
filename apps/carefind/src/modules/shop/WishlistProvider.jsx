import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { wishlistRepository } from './wishlistRepository'
const Ctx = createContext(null)
export function WishlistProvider({ children }) {
  const [ids, setIds] = useState([])
  useEffect(() => { wishlistRepository.getAllAsync().then(setIds).catch(()=> setIds(wishlistRepository.getAll())) }, [])
  const toggle = useCallback((id) => setIds(wishlistRepository.toggle(id)), [])
  const has = useCallback((id) => ids.includes(id), [ids])
  // Hydrate from DB in background and merge
  useEffect(() => {
    let cancelled=false
    wishlistRepository.getAllAsync().then(dbIds => { if(!cancelled && dbIds && dbIds.length) setIds(dbIds) })
    return ()=> { cancelled=true }
  }, [])
  const value = useMemo(() => ({ ids, toggle, has, count: ids.length }), [ids, toggle, has])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
export function useWishlist() { const v = useContext(Ctx); if(!v) throw new Error('useWishlist within provider'); return v }
