// Cart Provider - React context for cart state management
// Provides cart state and actions to all components

import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { cartRepository } from './cartRepository'

const CartContext = createContext(null)

export function CartProvider({ children }) {
  const [items, setItems] = useState([])
  const [count, setCount] = useState(0)
  const [total, setTotal] = useState(0)

  // Sync with localStorage on mount
  useEffect(() => {
    const loadedItems = cartRepository.getAll()
    setItems(loadedItems)
    setCount(cartRepository.getCount())
    setTotal(cartRepository.getTotal())
  }, [])

  // Actions are stable (they only touch the repository singleton and state setters) so memoized consumers,
  // such as the product cards, are not re-rendered by an unrelated cart change.
  const refresh = useCallback((updated) => {
    setItems(updated)
    setCount(cartRepository.getCount())
    setTotal(cartRepository.getTotal())
  }, [])

  const addItem = useCallback((item) => refresh(cartRepository.add(item)), [refresh])
  const removeItem = useCallback((ecommerce_product_id) => refresh(cartRepository.remove(ecommerce_product_id)), [refresh])
  const updateQuantity = useCallback((ecommerce_product_id, quantity) => refresh(cartRepository.updateQuantity(ecommerce_product_id, quantity)), [refresh])
  const clearCart = useCallback(() => {
    setItems(cartRepository.clear())
    setCount(0)
    setTotal(0)
  }, [])

  const value = useMemo(() => ({
    items,
    count,
    total,
    addItem,
    removeItem,
    updateQuantity,
    clearCart,
    isEmpty: items.length === 0
  }), [items, count, total, addItem, removeItem, updateQuantity, clearCart])

  return (
    <CartContext.Provider value={value}>
      {children}
    </CartContext.Provider>
  )
}

// Hook to use cart context
export function useCart() {
  const context = useContext(CartContext)
  if (!context) {
    throw new Error('useCart must be used within CartProvider')
  }
  return context
}
