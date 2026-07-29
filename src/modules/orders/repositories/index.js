import { sbFetch } from '../../../services/supabase'

export const orderRepository = {
  async getAll(businessId) {
    return sbFetch(`orders?business_id=eq.${businessId}&order=created_at.desc&select=*`)
  },

  async getById(orderId, businessId) {
    const results = await sbFetch(`orders?id=eq.${orderId}&business_id=eq.${businessId}&select=*`)
    return results[0] || null
  },

  async create(businessId, order) {
    return sbFetch('orders', {
      method: 'POST',
      body: JSON.stringify({ ...order, business_id: businessId }),
    })
  },

  async update(orderId, businessId, updates) {
    return sbFetch(`orders?id=eq.${orderId}&business_id=eq.${businessId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
      prefer: 'return=minimal',
    })
  },

  async advance(orderId, businessId, stage, note, actorId) {
    return sbFetch('orders', {
      method: 'PATCH',
      body: JSON.stringify({ 
        stage, 
        action_note: note,
        updated_by: actorId,
        updated_at: new Date().toISOString()
      }),
      prefer: 'return=minimal',
    })
  },

  async getItems(orderId) {
    return sbFetch(`order_items?order_id=eq.${orderId}&select=*`)
  },

  async addItem(orderId, item) {
    return sbFetch('order_items', {
      method: 'POST',
      body: JSON.stringify({ ...item, order_id: orderId }),
    })
  },

  async getWatchers(orderId) {
    return sbFetch(`order_watchers?order_id=eq.${orderId}&select=*`)
  },

  async addWatcher(orderId, staffId) {
    return sbFetch('order_watchers', {
      method: 'POST',
      body: JSON.stringify({ order_id: orderId, staff_id: staffId }),
    })
  },

  async getFiles(orderId) {
    return sbFetch(`order_files?order_id=eq.${orderId}&order=created_at.desc&select=*`)
  },

  async uploadFile(orderId, path, file, contentType) {
    return sbFetch(`order_files`, {
      method: 'POST',
      body: JSON.stringify({ order_id: orderId, file_path: path, file_name: file.name, content_type: contentType }),
    })
  },

  async getEvents(orderId) {
    return sbFetch(`order_events?order_id=eq.${orderId}&order=created_at.desc&select=*`)
  },
}

export const territoryRepository = {
  async getAll(businessId) {
    return sbFetch(`territories?business_id=eq.${businessId}&order=created_at.asc&select=*`)
  },

  async create(businessId, territory) {
    return sbFetch('territories', {
      method: 'POST',
      body: JSON.stringify({ ...territory, business_id: businessId }),
    })
  },

  async update(territoryId, businessId, updates) {
    return sbFetch(`territories?id=eq.${territoryId}&business_id=eq.${businessId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
      prefer: 'return=minimal',
    })
  },

  async delete(territoryId, businessId) {
    return sbFetch(`territories?id=eq.${territoryId}&business_id=eq.${businessId}`, {
      method: 'DELETE',
      prefer: 'return=minimal',
    })
  },
}

export const locationRepository = {
  async getAll(businessId) {
    return sbFetch(`enterprise_locations?business_id=eq.${businessId}&order=created_at.asc&select=*`)
  },

  async create(businessId, location) {
    return sbFetch('enterprise_locations', {
      method: 'POST',
      body: JSON.stringify({ ...location, business_id: businessId }),
    })
  },
}