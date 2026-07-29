import { useState, useEffect, useCallback } from 'react'
import { clientRepository } from '../repositories'
import { useToast } from '../../../components/ui'

export function useClients(businessId) {
  const toast = useToast()
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const loadClients = useCallback(async () => {
    if (!businessId) return
    setLoading(true)
    try {
      const data = await clientRepository.getAll(businessId)
      setClients(data || [])
    } catch (e) {
      toast.show('Failed to load clients', { type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [businessId, toast])

  useEffect(() => { loadClients() }, [loadClients])

  const filtered = clients.filter(c => 
    c.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    c.phone?.includes(search) ||
    c.email?.toLowerCase().includes(search.toLowerCase())
  )

  const createClient = async (client) => {
    const newClient = await clientRepository.create(businessId, client)
    setClients(prev => [...prev, newClient].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')))
    toast.show('Client added!', { type: 'success' })
    return newClient
  }

  const updateClient = async (clientId, updates) => {
    await clientRepository.update(clientId, businessId, updates)
    setClients(prev => prev.map(c => c.id === clientId ? { ...c, ...updates } : c))
    toast.show('Client updated!', { type: 'success' })
  }

  const deleteClient = async (clientId) => {
    await clientRepository.delete(clientId, businessId)
    setClients(prev => prev.filter(c => c.id !== clientId))
    toast.show('Client deleted', { type: 'success' })
  }

  return {
    clients,
    filtered,
    loading,
    search,
    setSearch,
    loadClients,
    createClient,
    updateClient,
    deleteClient,
  }
}