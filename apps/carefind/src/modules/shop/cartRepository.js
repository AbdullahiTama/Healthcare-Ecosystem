// Cart repository - manages cart state with localStorage persistence
// Cart state: localStorage (persist) + React context (reactive UI)

const CART_STORAGE_KEY = 'carefind_cart'

// Cart item structure: { ecommerce_product_id, product_name, unit_price_kobo, quantity, image_url }

export function createCartRepository() {
  // Load cart from localStorage
  function load() {
    try {
      const stored = localStorage.getItem(CART_STORAGE_KEY)
      return stored ? JSON.parse(stored) : []
    } catch (error) {
      console.error('Failed to load cart from localStorage:', error)
      return []
    }
  }

  // Save cart to localStorage
  function save(items) {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items))
    } catch (error) {
      console.error('Failed to save cart to localStorage:', error)
    }
  }

  // Get all cart items
  function getAll() {
    return load()
  }

  // Get cart item count
  function getCount() {
    const items = load()
    return items.reduce((sum, item) => sum + item.quantity, 0)
  }

  // Get cart total in kobo
  function getTotal() {
    const items = load()
    return items.reduce((sum, item) => sum + (item.unit_price_kobo * item.quantity), 0)
  }

  // Add item to cart
  function add(item) {
    const items = load()
    const existing = items.find(i => i.ecommerce_product_id === item.ecommerce_product_id)
    
    if (existing) {
      existing.quantity += item.quantity
    } else {
      items.push({ ...item })
    }
    
    save(items)
    return items
  }

  // Remove item from cart
  function remove(ecommerce_product_id) {
    const items = load()
    const filtered = items.filter(i => i.ecommerce_product_id !== ecommerce_product_id)
    save(filtered)
    return filtered
  }

  // Update item quantity
  function updateQuantity(ecommerce_product_id, quantity) {
    if (quantity <= 0) {
      return remove(ecommerce_product_id)
    }
    
    const items = load()
    const item = items.find(i => i.ecommerce_product_id === ecommerce_product_id)
    
    if (item) {
      item.quantity = quantity
      save(items)
    }
    
    return items
  }

  // Clear cart
  function clear() {
    save([])
    return []
  }

  // Check if cart is empty
  function isEmpty() {
    const items = load()
    return items.length === 0
  }

  return {
    getAll,
    getCount,
    getTotal,
    add,
    remove,
    updateQuantity,
    clear,
    isEmpty
  }
}

// Singleton instance
export const cartRepository = createCartRepository()
