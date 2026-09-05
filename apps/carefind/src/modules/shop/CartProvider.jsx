// Cart Provider - React context for cart state management
// Provides cart state and actions to all components

import { createContext, useContext, useState, useEffect } from 'react'
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

  // Add item to cart
  function addItem(item) {
    const updated = cartRepository.add(item)
    setItems(updated)
    setCount(cartRepository.getCount())
    setTotal(cartRepository.getTotal())
  }

  // Remove item from cart
  function removeItem(ecommerce_product_id) {
    const updated = cartRepository.remove(ecommerce_product_id)
    setItems(updated)
    setCount(cartRepository.getCount())
    setTotal(cartRepository.getTotal())
  }

  // Update item quantity
  function updateQuantity(ecommerce_product_id, quantity) {
    const updated = cartRepository.updateQuantity(ecommerce_product_id, quantity)
    setItems(updated)
    setCount(cartRepository.getCount())
    setTotal(cartRepository.getTotal())
  }

  // Clear cart
  function clearCart() {
    const updated = cartRepository.clear()
    setItems(updated)
    setCount(0)
    setTotal(0)
  }

  const value = {
    items,
    count,
    total,
    addItem,
    removeItem,
    updateQuantity,
    clearCart,
    isEmpty: items.length === 0
  }

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
