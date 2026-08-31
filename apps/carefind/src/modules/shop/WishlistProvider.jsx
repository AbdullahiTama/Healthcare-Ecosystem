import { createContext, useContext, useState, useEffect } from 'react'
import { wishlistRepository } from './wishlistRepository'
const Ctx = createContext(null)
export function WishlistProvider({ children }) {
  const [ids, setIds] = useState([])
  useEffect(() => setIds(wishlistRepository.getAll()), [])
  const toggle = (id) => setIds(wishlistRepository.toggle(id))
  const has = (id) => ids.includes(id)
  return <Ctx.Provider value={{ ids, toggle, has, count: ids.length }}>{children}</Ctx.Provider>
}
export function useWishlist() { const v = useContext(Ctx); if(!v) throw new Error('useWishlist within provider'); return v }
