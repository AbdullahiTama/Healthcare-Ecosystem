import { createContext, useContext, useState, useEffect } from 'react'
import { wishlistRepository } from './wishlistRepository'
const Ctx = createContext(null)
export function WishlistProvider({ children }) {
  const [ids, setIds] = useState([])
  useEffect(() => { wishlistRepository.getAllAsync().then(setIds).catch(()=> setIds(wishlistRepository.getAll())) }, [])
  const toggle = (id) => setIds(wishlistRepository.toggle(id))
  const has = (id) => ids.includes(id)
  // Hydrate from DB in background and merge
  useEffect(() => {
    let cancelled=false
    wishlistRepository.getAllAsync().then(dbIds => { if(!cancelled && dbIds && dbIds.length) setIds(dbIds) })
    return ()=> { cancelled=true }
  }, [])
  return <Ctx.Provider value={{ ids, toggle, has, count: ids.length }}>{children}</Ctx.Provider>
}
export function useWishlist() { const v = useContext(Ctx); if(!v) throw new Error('useWishlist within provider'); return v }
