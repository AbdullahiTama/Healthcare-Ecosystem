import { sbFetch } from '../../../services/supabase'

export const productRepository = {
  async getAll(businessId) {
    return sbFetch(`products?business_id=eq.${businessId}&order=name.asc&select=*`)
  },

  async getById(productId, businessId) {
    const results = await sbFetch(`products?id=eq.${productId}&business_id=eq.${businessId}&select=*`)
    return results[0] || null
  },

  async create(businessId, product) {
    return sbFetch('products', {
      method: 'POST',
      body: JSON.stringify({ ...product, business_id: businessId }),
    })
  },

  async update(productId, businessId, updates) {
    return sbFetch(`products?id=eq.${productId}&business_id=eq.${businessId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
      prefer: 'return=minimal',
    })
  },

  async delete(productId, businessId) {
    return sbFetch(`products?id=eq.${productId}&business_id=eq.${businessId}`, {
      method: 'DELETE',
      prefer: 'return=minimal',
    })
  },

  async getStockBatches(businessId) {
    return sbFetch(`stock_batches?business_id=eq.${businessId}&order=expiry_date.asc.nullslast&select=*`)
  },

  async addStockBatch(businessId, batch) {
    return sbFetch('stock_batches', {
      method: 'POST',
      body: JSON.stringify({ ...batch, business_id: businessId }),
    })
  },

  async updateStock(productId, businessId, quantityChange) {
    return sbFetch('products', {
      method: 'PATCH',
      body: JSON.stringify({ stock: { increment: quantityChange } }),
      prefer: 'return=representation',
    })
  },
}

export const purchaseRepository = {
  async getAll(businessId) {
    return sbFetch(`purchases?business_id=eq.${businessId}&order=created_at.desc&select=*`)
  },

  async create(businessId, purchase) {
    return sbFetch('purchases', {
      method: 'POST',
      body: JSON.stringify({ ...purchase, business_id: businessId }),
    })
  },

  async update(purchaseId, businessId, updates) {
    return sbFetch(`purchases?id=eq.${purchaseId}&business_id=eq.${businessId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
      prefer: 'return=minimal',
    })
  },
}

export const expenseRepository = {
  async getAll(businessId) {
    return sbFetch(`expenses?business_id=eq.${businessId}&order=created_at.desc&select=*`)
  },

  async create(businessId, expense) {
    return sbFetch('expenses', {
      method: 'POST',
      body: JSON.stringify({ ...expense, business_id: businessId }),
    })
  },

  async delete(expenseId, businessId) {
    return sbFetch(`expenses?id=eq.${expenseId}&business_id=eq.${businessId}`, {
      method: 'DELETE',
      prefer: 'return=minimal',
    })
  },
}

export const debtRepository = {
  async getAll(businessId) {
    return sbFetch(`debts?business_id=eq.${businessId}&order=created_at.desc&select=*`)
  },

  async create(businessId, debt) {
    return sbFetch('debts', {
      method: 'POST',
      body: JSON.stringify({ ...debt, business_id: businessId }),
    })
  },

  async update(debtId, businessId, updates) {
    return sbFetch(`debts?id=eq.${debtId}&business_id=eq.${businessId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
      prefer: 'return=minimal',
    })
  },
}