import { useState, useEffect, useCallback } from 'react'
import { sbFetch } from '../../../services/supabase'

export const clientRepository = {
  async getAll(businessId) {
    return sbFetch(`clients?business_id=eq.${businessId}&order=full_name.asc&select=*`)
  },

  async create(businessId, client) {
    return sbFetch('clients', {
      method: 'POST',
      body: JSON.stringify({ ...client, business_id: businessId }),
    })
  },

  async update(clientId, businessId, updates) {
    return sbFetch(`clients?id=eq.${clientId}&business_id=eq.${businessId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
      prefer: 'return=minimal',
    })
  },

  async delete(clientId, businessId) {
    return sbFetch(`clients?id=eq.${clientId}&business_id=eq.${businessId}`, {
      method: 'DELETE',
      prefer: 'return=minimal',
    })
  },

  async getPrescriptions(businessId, clientId) {
    return sbFetch(`prescriptions?business_id=eq.${businessId}&client_id=eq.${clientId}&order=created_at.desc&select=*`)
  },

  async createPrescription(prescription) {
    return sbFetch('prescriptions', {
      method: 'POST',
      body: JSON.stringify(prescription),
    })
  },

  async getAppointments(businessId, clientId) {
    return sbFetch(`appointments?business_id=eq.${businessId}&client_id=eq.${clientId}&order=date.asc&select=*`)
  },
}