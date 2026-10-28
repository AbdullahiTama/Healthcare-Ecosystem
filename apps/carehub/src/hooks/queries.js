import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { saleRepository, paymentRepository } from '../modules/pos/repositories'
import { appointmentRepository } from '../modules/appointments/repositories'
import { clientRepository } from '../modules/clients/repositories'
import { settingsRepository } from '../modules/settings/repositories'
import { purchaseRepository } from '../modules/purchases/repositories'

// ── Query Keys ───────────────────────────────────────────────────────────────
export const keys = {
  todaySales: (brandId) => ['sales', 'today', brandId],
  openSales: (brandId) => ['sales', 'open', brandId],
  recentSales: (brandId) => ['sales', 'recent', brandId],
  appointments: (brandId) => ['appointments', brandId],
  clients: (brandId) => ['clients', brandId],
  settings: (brandId) => ['settings', brandId],
  products: (brandId) => ['products', brandId],
  salePayments: (saleId) => ['sales', 'payments', saleId],
  supplierBalances: (brandId) => ['purchases', 'suppliers', brandId],
  supplierPurchases: (brandId, supplierKey) => ['purchases', 'supplier', brandId, supplierKey],
  purchasePayments: (brandId, scope) => ['purchases', 'payments', brandId, scope],
  purchase: (brandId, purchaseId) => ['purchases', 'one', brandId, purchaseId],
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
    // A sale changes its client's visits and total spent (kept by the database).
    qc.invalidateQueries({ queryKey: keys.clients(brandId) })
  }
}

// ── Credit-sale payments ──────────────────────────────────────────────────────

// Payment history for one credit sale, newest first, from the sale_payments
// ledger (carehub_20261210_pos_accounting). Loaded only when asked for.
export function useSalePayments(saleId, brandId, enabled = true) {
  return useQuery({
    queryKey: keys.salePayments(saleId),
    queryFn: async () => [...((await paymentRepository.getForSale(brandId, saleId)) || [])].reverse(),
    enabled: !!saleId && !!brandId && enabled,
    staleTime: 30_000,
  })
}

// Records a full or partial payment against a credit sale through
// record_sale_payment(), which writes the ledger row (cashier and shift taken
// from the session), the sale and its debt in one transaction and returns
// { applied, amount_paid, balance }. The new balance is applied to the
// open-sales list straight away (a fully paid sale leaves it), then the lists
// are refreshed from the server.
export function useRecordSalePayment(brandId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ saleId, amount, method }) => paymentRepository.recordCollection(saleId, amount, method),
    onSuccess: (result, { saleId }) => {
      qc.setQueryData(keys.openSales(brandId), (prev) => {
        if (!Array.isArray(prev) || !result) return prev
        return prev
          .map((s) => (s.id === saleId ? { ...s, amount_paid: result.amount_paid, balance: result.balance, is_credit: result.balance > 0 } : s))
          .filter((s) => s.is_on_hold || (s.is_credit && Number(s.balance) > 0))
      })
      qc.invalidateQueries({ queryKey: keys.openSales(brandId) })
      qc.invalidateQueries({ queryKey: keys.salePayments(saleId) })
      qc.invalidateQueries({ queryKey: keys.todaySales(brandId) })
    },
  })
}

// ── Supplier payments ─────────────────────────────────────────────────────────

// Totals per supplier: bought, paid, outstanding (get_supplier_balances).
export function useSupplierBalances(brandId, enabled = true) {
  return useQuery({
    queryKey: keys.supplierBalances(brandId),
    queryFn: () => purchaseRepository.getSupplierBalances(brandId),
    enabled: !!brandId && enabled,
    staleTime: 30_000,
  })
}

// One supplier's purchases (same grouping key as the totals).
export function useSupplierPurchases(brandId, supplierKey) {
  return useQuery({
    queryKey: keys.supplierPurchases(brandId, supplierKey),
    queryFn: () => purchaseRepository.getBySupplier(brandId, supplierKey),
    enabled: !!brandId && !!supplierKey,
    staleTime: 30_000,
  })
}

// One purchase in full (the list's page function returns summary columns
// only; this includes the invoice lines). `placeholder` is the list row, shown
// while the full record loads.
export function usePurchase(brandId, purchaseId, placeholder) {
  return useQuery({
    queryKey: keys.purchase(brandId, purchaseId),
    queryFn: () => purchaseRepository.getById(purchaseId, brandId),
    enabled: !!brandId && !!purchaseId,
    placeholderData: placeholder || undefined,
    staleTime: 30_000,
  })
}

// Payment history for one purchase ({ purchaseId }) or one supplier ({ supplierKey }).
export function usePurchasePayments(brandId, scope) {
  const id = scope?.purchaseId ? 'p:' + scope.purchaseId : scope?.supplierKey ? 's:' + scope.supplierKey : null
  return useQuery({
    queryKey: keys.purchasePayments(brandId, id),
    queryFn: () => purchaseRepository.getPayments(brandId, scope),
    enabled: !!brandId && !!id,
    staleTime: 30_000,
  })
}

// Records a full or partial payment to a supplier; refreshes every supplier
// total, supplier list and payment history (prefix ['purchases']).
export function useRecordPurchasePayment(brandId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ purchaseId, ...payment }) => purchaseRepository.recordPayment(purchaseId, payment),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchases'] })
    },
  })
}
