import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { saleRepository } from '../modules/pos/repositories'
import { appointmentRepository } from '../modules/appointments/repositories'
import { clientRepository } from '../modules/clients/repositories'
import { settingsRepository } from '../modules/settings/repositories'

// ── Query Keys ───────────────────────────────────────────────────────────────
export const keys = {
  todaySales: (brandId) => ['sales', 'today', brandId],
  openSales: (brandId) => ['sales', 'open', brandId],
  recentSales: (brandId) => ['sales', 'recent', brandId],
  appointments: (brandId) => ['appointments', brandId],
  clients: (brandId) => ['clients', brandId],
  settings: (brandId) => ['settings', brandId],
  products: (brandId) => ['products', brandId],
  clientSales: (clientId, brandId) => ['clients', 'sales', clientId, brandId],
  clientConsults: (clientId, brandId) => ['clients', 'consults', clientId, brandId],
  clientHistory: (clientId, brandId, tab) => ['clients', 'history', clientId, brandId, tab],
}

// ── Dashboard Queries ─────────────────────────────────────────────────────────

export function useTodaySales(brandId) {
  return useQuery({
    queryKey: keys.todaySales(brandId),
    queryFn: () => saleRepository.getToday(brandId),
    enabled: !!brandId,
    staleTime: 30_000,
  })
}

// Held sales and credit sales with a balance owed — the sales that still need
// action. Replaces an "all sales" download that grew with every sale and was
// silently capped at 1000 rows.
export function useOpenSales(brandId) {
  return useQuery({
    queryKey: keys.openSales(brandId),
    queryFn: () => saleRepository.getOpen(brandId),
    enabled: !!brandId,
    staleTime: 30_000,
  })
}

// The latest completed sales, for the POS "Recent" list.
export function useRecentSales(brandId, limit = 50) {
  return useQuery({
    queryKey: [...keys.recentSales(brandId), limit],
    queryFn: () => saleRepository.getRecent(brandId, limit),
    enabled: !!brandId,
    staleTime: 30_000,
  })
}

export function useAppointments(brandId, enabled = true) {
  return useQuery({
    queryKey: keys.appointments(brandId),
    queryFn: () => appointmentRepository.getAll(brandId),
    enabled: !!brandId && enabled,
    staleTime: 60_000,
  })
}

// ── Client Queries ────────────────────────────────────────────────────────────

export function useClients(brandId) {
  return useQuery({
    queryKey: keys.clients(brandId),
    queryFn: () => clientRepository.getAll(brandId),
    enabled: !!brandId,
    staleTime: 60_000,
  })
}

export function useClientSales(clientId, brandId) {
  return useQuery({
    queryKey: keys.clientSales(clientId, brandId),
    queryFn: () => clientRepository.getSales(clientId, brandId),
    enabled: !!clientId && !!brandId,
    staleTime: 30_000,
  })
}

export function useClientConsults(clientId, brandId) {
  return useQuery({
    queryKey: keys.clientConsults(clientId, brandId),
    queryFn: () => clientRepository.getConsultations(clientId, brandId),
    enabled: !!clientId && !!brandId,
    staleTime: 30_000,
  })
}

export function useClientHistory(clientId, brandId, tab, clientSales, clientConsults) {
  return useQuery({
    queryKey: keys.clientHistory(clientId, brandId, tab),
    queryFn: () => {
      if (tab === 'timeline') {
        return Promise.resolve([
          ...clientSales.map(s => ({ ...s, kind: 'sale', when: s.created_at || '' })),
          ...clientConsults.map(c => ({ ...c, kind: 'consultation', when: (c.consultation_date || '') + 'T' + (c.created_at?.split('T')[1] || '00:00:00') })),
        ].sort((a, b) => b.when.localeCompare(a.when)))
      }
      const fetchFn = tab === 'sales' ? clientRepository.getSales
        : tab === 'appointments' ? clientRepository.getAppointments
        : tab === 'consultations' ? clientRepository.getConsultations
        : clientRepository.getDebts
      return fetchFn(clientId, brandId)
    },
    enabled: !!clientId && !!brandId,
    staleTime: 30_000,
  })
}

// ── Settings Queries ──────────────────────────────────────────────────────────

export function useSettings(brandId) {
  return useQuery({
    queryKey: keys.settings(brandId),
    queryFn: () => settingsRepository.get(brandId),
    enabled: !!brandId,
    staleTime: 300_000, // 5 minutes — settings rarely change
  })
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useCreateClient(brandId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (client) => clientRepository.create(brandId, client),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.clients(brandId) })
    },
  })
}

export function useCreateManyClients(brandId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (clients) => clientRepository.createMany(brandId, clients),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.clients(brandId) })
    },
  })
}

export function useCreateSale(brandId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (saleData) => saleRepository.create(brandId, saleData),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.todaySales(brandId) })
      qc.invalidateQueries({ queryKey: keys.openSales(brandId) })
      qc.invalidateQueries({ queryKey: keys.recentSales(brandId) })
    },
  })
}

export function useUpdateSale(brandId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }) => saleRepository.update(id, brandId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.todaySales(brandId) })
      qc.invalidateQueries({ queryKey: keys.openSales(brandId) })
      qc.invalidateQueries({ queryKey: keys.recentSales(brandId) })
    },
  })
}

export function useInvalidateSales(brandId) {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: keys.todaySales(brandId) })
    qc.invalidateQueries({ queryKey: keys.openSales(brandId) })
    qc.invalidateQueries({ queryKey: keys.recentSales(brandId) })
  }
}
