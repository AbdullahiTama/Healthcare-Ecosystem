import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { saleRepository, paymentRepository } from '../modules/pos/repositories'
import { appointmentRepository } from '../modules/appointments/repositories'
import { clientRepository } from '../modules/clients/repositories'
import { settingsRepository } from '../modules/settings/repositories'
import { purchaseRepository } from '../modules/purchases/repositories'
import { debtRepository } from '../modules/debts/repositories'
import { expenseRepository } from '../modules/expenses/repositories'
import { runBulkUpdates } from '../lib/bulkUpdates'

// ── Query Keys ───────────────────────────────────────────────────────────────
export const keys = {
  openSales: (brandId) => ['sales', 'open', brandId],
  recentSales: (brandId) => ['sales', 'recent', brandId],
  appointments: (brandId) => ['appointments', brandId],
  clients: (brandId) => ['clients', brandId],
  openDebts: (brandId) => ['debts', 'open', brandId],
  unpaidExpenses: (brandId) => ['expenses', 'unpaid', brandId],
  settings: (brandId) => ['settings', brandId],
  products: (brandId) => ['products', brandId],
  salePayments: (saleId) => ['sales', 'payments', saleId],
  supplierBalances: (brandId) => ['purchases', 'suppliers', brandId],
  supplierPurchases: (brandId, supplierKey) => ['purchases', 'supplier', brandId, supplierKey],
  purchasePayments: (brandId, scope) => ['purchases', 'payments', brandId, scope],
  purchase: (brandId, purchaseId) => ['purchases', 'one', brandId, purchaseId],
  purchaseForEdit: (brandId, purchaseId) => ['purchases', 'edit', brandId, purchaseId],
  purchaseEditHistory: (brandId, purchaseId) => ['purchases', 'edits', brandId, purchaseId],
  purchaseSummary: (brandId, filters) => ['purchases', 'summary', brandId, filters],
  purchaseSupplierStats: (brandId, filters) => ['purchases', 'supplierStats', brandId, filters],
  purchaseProductStats: (brandId, filters, opts) => ['purchases', 'productStats', brandId, filters, opts],
  purchaseHistory: (brandId, filters, opts) => ['purchases', 'history', brandId, filters, opts],
  clientSales: (clientId, brandId) => ['clients', 'sales', clientId, brandId],
  clientConsults: (clientId, brandId) => ['clients', 'consults', clientId, brandId],
  clientHistory: (clientId, brandId, tab) => ['clients', 'history', clientId, brandId, tab],
}

// ── Dashboard Queries ─────────────────────────────────────────────────────────

// Held sales and credit sales with a balance owed — the sales that still need
// action. Replaces an "all sales" download that grew with every sale and was
// silently capped at 1000 rows.
//
// Read again every time the POS mounts (the cached list shows at once meanwhile), so returning to the till always
// shows held sales made since on another device.
export function useOpenSales(brandId) {
  return useQuery({
    queryKey: keys.openSales(brandId),
    queryFn: () => saleRepository.getOpen(brandId),
    enabled: !!brandId,
    staleTime: 30_000,
    refetchOnMount: 'always',
  })
}

// The till's handle on upsertOpenSale for its business: (sale) => void.
export function useUpsertOpenSale(brandId) {
  const qc = useQueryClient()
  return (sale) => upsertOpenSale(qc, brandId, sale)
}

// Puts a held sale the till has just saved into the cached open-sales list at once, so it is in Held Sales without
// waiting for (or depending on) the re-read that follows. Matched by id, so the re-read replaces it, never doubles it.
export function upsertOpenSale(qc, brandId, sale) {
  if (!sale?.id) return
  qc.setQueryData(keys.openSales(brandId), (prev) => {
    const list = Array.isArray(prev) ? prev.filter((s) => String(s.id) !== String(sale.id)) : []
    return [sale, ...list].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
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

// Open debts (unpaid, something left), for what each client still owes on the Clients page.
export function useOpenDebts(brandId, enabled = true) {
  return useQuery({
    queryKey: keys.openDebts(brandId),
    queryFn: () => debtRepository.getOpen(brandId),
    enabled: !!brandId && enabled,
    staleTime: 30_000,
  })
}

// Expenses not fully paid, any date (the dashboard's "Bills to pay"). Read again whenever the dashboard opens, so a
// payment just recorded on the Expenses page is never shown as still owed.
export function useUnpaidExpenses(brandId, enabled = true) {
  return useQuery({
    queryKey: keys.unpaidExpenses(brandId),
    queryFn: () => expenseRepository.getUnpaid(brandId),
    enabled: !!brandId && enabled,
    staleTime: 60_000,
    refetchOnMount: 'always',
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
    // The saved client goes into the shared list at once (POS, Clients, Debts and every picker read it), then the
    // list is re-read from the database.
    onSuccess: (rows) => {
      const created = Array.isArray(rows) ? rows[0] : rows
      if (created?.id) {
        qc.setQueryData(keys.clients(brandId), (prev) => {
          if (!Array.isArray(prev)) return prev
          if (prev.some((c) => String(c.id) === String(created.id))) return prev
          return [...prev, created].sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')))
        })
      }
      qc.invalidateQueries({ queryKey: keys.clients(brandId) })
    },
  })
}

// Saves bulk-edit groups ({ ids, updates }) for clients and puts the saved rows into the shared client list at once
// (Clients, POS, Debts and every picker read it), then re-reads it. Resolves to runBulkUpdates' { saved, failed }.
export function useUpdateManyClients(brandId) {
  const qc = useQueryClient()
  return async (groups, onProgress) => {
    const r = await runBulkUpdates(groups, (ids, updates) => clientRepository.updateMany(brandId, ids, updates), { onProgress })
    if (r.saved.length) {
      const byId = new Map(r.saved.map((c) => [String(c.id), c]))
      qc.setQueryData(keys.clients(brandId), (prev) => (Array.isArray(prev) ? prev.map((c) => (byId.has(String(c.id)) ? { ...c, ...byId.get(String(c.id)) } : c)) : prev))
    }
    qc.invalidateQueries({ queryKey: keys.clients(brandId) })
    return r
  }
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
    onSuccess: () => invalidateSalesFigures(qc),
  })
}

export function useUpdateSale(brandId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }) => saleRepository.update(id, brandId, data),
    onSuccess: () => invalidateSalesFigures(qc),
  })
}

// Every query that shows a sales or money figure. A sale, payment, refund,
// edit or deletion refreshes all of them together, so the dashboard, POS lists,
// Sales & Accounts, Financial Reports and the Owner's business activity never
// show a figure from before the change next to one from after it.
export function invalidateSalesFigures(qc) {
  qc.invalidateQueries({ queryKey: ['sales'] })
  qc.invalidateQueries({ queryKey: ['salesReport'] })
  qc.invalidateQueries({ queryKey: ['reports'] })
  qc.invalidateQueries({ queryKey: ['ownerActivity'] })
}

export function useInvalidateSales(brandId) {
  const qc = useQueryClient()
  return () => {
    invalidateSalesFigures(qc)
    // A sale changes its client's visits and total spent (kept by the database), and a credit sale or repayment
    // changes what they owe.
    qc.invalidateQueries({ queryKey: keys.clients(brandId) })
    qc.invalidateQueries({ queryKey: ['debts'] })
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
      invalidateSalesFigures(qc)
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

// ── Purchase editing (carehub_20261229) ───────────────────────────────────────

// The lines as the edit screen needs them (what each added to stock, the
// lowest quantity it can go to, locked lines). Always fresh: stock moves.
export function usePurchaseForEdit(brandId, purchaseId) {
  return useQuery({
    queryKey: keys.purchaseForEdit(brandId, purchaseId),
    queryFn: () => purchaseRepository.getForEdit(purchaseId),
    enabled: !!brandId && !!purchaseId,
    staleTime: 0,
    gcTime: 0,
  })
}

export function usePurchaseEditHistory(brandId, purchaseId, enabled = true) {
  return useQuery({
    queryKey: keys.purchaseEditHistory(brandId, purchaseId),
    queryFn: () => purchaseRepository.getEditHistory(purchaseId, brandId),
    enabled: !!brandId && !!purchaseId && enabled,
    staleTime: 30_000,
  })
}

// Saves an edit. Every purchase figure (list, suppliers, payments, analytics)
// and the money screens that read purchases or their debts are refreshed.
export function useEditPurchase(brandId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ purchaseId, ...edit }) => purchaseRepository.edit(purchaseId, edit),
    onSuccess: () => {
      for (const prefix of ['purchases', 'debts', 'reports']) qc.invalidateQueries({ queryKey: [prefix] })
    },
  })
}

// ── Purchase history and analytics (carehub_20261229) ─────────────────────────
// `filters`: { from, to, search, supplierKey, productKey, productId }. Each is
// part of the key, so a change of period or filter is a new (cached) query.

export function usePurchaseSummary(brandId, filters, enabled = true) {
  return useQuery({
    queryKey: keys.purchaseSummary(brandId, filters),
    queryFn: () => purchaseRepository.getSummary(brandId, filters),
    enabled: !!brandId && enabled,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })
}

export function usePurchaseSupplierStats(brandId, filters, enabled = true) {
  return useQuery({
    queryKey: keys.purchaseSupplierStats(brandId, filters),
    queryFn: () => purchaseRepository.getSupplierStats(brandId, filters),
    enabled: !!brandId && enabled,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })
}

export function usePurchaseProductStats(brandId, filters, opts = {}, enabled = true) {
  return useQuery({
    queryKey: keys.purchaseProductStats(brandId, filters, opts),
    queryFn: () => purchaseRepository.getProductStats(brandId, filters, opts),
    enabled: !!brandId && enabled,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })
}

// Every purchase line for the filters, newest first, a page at a time
// ("Load more" fetches the next page).
export function usePurchaseHistory(brandId, filters, { pageSize = 50 } = {}, enabled = true) {
  return useInfiniteQuery({
    queryKey: keys.purchaseHistory(brandId, filters, { pageSize }),
    queryFn: ({ pageParam }) => purchaseRepository.getHistory(brandId, filters, { offset: pageParam, limit: pageSize }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => ((last || []).length === pageSize ? pages.length * pageSize : undefined),
    enabled: !!brandId && enabled,
    staleTime: 30_000,
  })
}
