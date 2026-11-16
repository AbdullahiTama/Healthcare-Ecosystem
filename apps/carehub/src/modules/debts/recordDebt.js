// Recording one debt typed into Record Debt, linked to its client (created once when missing) or supplier account, and
// linking older customer debts that have no client record. The Excel/CSV import links in the database instead
// (import_debts), with the same matching rules. Docs: docs/architecture/Debt-Accounts-and-POS-Stock-Limits.md §2
import { resolveDebtParty } from './debtParty'
import { debtRepository as defaultDebts } from './repositories'
import { clientRepository as defaultClients } from '../clients/repositories'
import { isDuplicateError } from '../../lib/dbErrors'

const money = (n) => Math.round((Number(n) || 0) * 100) / 100

/**
 * The amounts of a debt from what was typed. amount must be above 0; paid defaults to 0 and cannot exceed amount.
 * Returns { amount, paid, balance, status } or { error }.
 */
export function debtFigures({ amount, amountPaid }) {
  const a = typeof amount === 'number' ? amount : parseFloat(String(amount ?? '').replace(/[₦,\s]/g, ''))
  const pRaw = String(amountPaid ?? '').trim() === '' ? 0 : amountPaid
  const p = typeof pRaw === 'number' ? pRaw : parseFloat(String(pRaw).replace(/[₦,\s]/g, ''))
  if (!Number.isFinite(a) || a <= 0) return { error: 'Amount must be a number above 0.' }
  if (!Number.isFinite(p) || p < 0) return { error: 'Amount paid must be 0 or more.' }
  if (p > a + 0.005) return { error: `Amount paid (${money(p)}) is more than the amount (${money(a)}).` }
  const amt = money(a)
  const paid = money(p)
  const balance = money(amt - paid)
  return { amount: amt, paid, balance, status: balance <= 0 ? 'paid' : 'pending' }
}

/**
 * Saves one debt.
 *   input: { direction, partyName, phone?, clientId?, amount, amountPaid?, dueDate?, description? }
 *   ctx:   { clients (an array this function appends a created client to, so a later debt
 *            of the same name links to it instead of creating it again), suppliers, debts, clientRepo }
 * Returns { debt, party, createdClient }. Throws a user-facing Error when the debt cannot be saved; nothing is saved
 * then, except that a client created just before a refused debt is kept (and reused on the next try).
 */
export async function recordDebt(businessId, input, { clients = [], suppliers = [], debts = defaultDebts, clientRepo = defaultClients } = {}) {
  const figures = debtFigures(input)
  if (figures.error) throw new Error(figures.error)
  const party = resolveDebtParty(input, { clients, suppliers })
  if (party.kind === 'invalid') throw new Error(party.error)
  if (party.kind === 'ambiguous') throw new Error(`${party.choices.length} clients are named ${party.name}. Pick the right one from the list (or add their phone number).`)

  let client = party.kind === 'client' ? party.client : null
  let createdClient = null
  if (party.kind === 'new-client') {
    try {
      const rows = await clientRepo.create(businessId, { full_name: party.name, phone: party.phone || null, notes: 'Added automatically when a debt was recorded.' })
      createdClient = Array.isArray(rows) ? rows[0] : rows
    } catch (e) {
      if (isDuplicateError(e)) throw new Error(`A client with phone ${party.phone} already exists. Pick them from the list, or leave the phone out.`)
      throw new Error('Could not create the client record for ' + party.name + '. Please try again.')
    }
    if (!createdClient?.id) throw new Error('Could not create the client record for ' + party.name + '. Please try again.')
    clients.push(createdClient)
    client = createdClient
  }

  const rows = await debts.create(businessId, {
    client_id: client ? client.id : null,
    direction: input.direction,
    party_name: party.name,
    amount: figures.amount,
    amount_paid: figures.paid,
    balance: figures.balance,
    due_date: input.dueDate || '',
    status: figures.status,
    description: String(input.description || '').trim(),
  })
  const debt = Array.isArray(rows) ? rows[0] : rows
  console.info('[debts] recorded', { direction: input.direction, party: party.kind, createdClient: !!createdClient })
  return { debt, party, createdClient }
}

/**
 * Links hand-recorded "owed to us" debts that have no client record: to the one client of that name (or phone), or
 * to a client created for it. Debts whose name matches two clients are left for the person to link.
 * Returns { linked, created, skipped: [{ debt, reason }] }. Never throws for one debt; failures are skipped.
 */
export async function linkUnlinkedDebts(businessId, unlinked, { clients = [], debts = defaultDebts, clientRepo = defaultClients } = {}) {
  let linked = 0
  let created = 0
  const skipped = []
  for (const d of unlinked) {
    const party = resolveDebtParty({ direction: 'owes_us', partyName: d.party_name }, { clients })
    try {
      let client = party.kind === 'client' ? party.client : null
      if (party.kind === 'new-client') {
        const rows = await clientRepo.create(businessId, { full_name: party.name, notes: 'Added automatically when a debt was linked.' })
        client = Array.isArray(rows) ? rows[0] : rows
        if (!client?.id) throw new Error('no client returned')
        clients.push(client)
        created++
      }
      if (!client) { skipped.push({ debt: d, reason: party.kind === 'ambiguous' ? `${party.choices.length} clients share this name` : party.error }); continue }
      await debts.update(d.id, businessId, { client_id: client.id })
      linked++
    } catch (e) {
      console.error('[debts] link failed:', d.id, e?.message)
      skipped.push({ debt: d, reason: 'could not be saved' })
    }
  }
  console.info('[debts] linked unlinked debts', { linked, created, skipped: skipped.length })
  return { linked, created, skipped }
}

/** Hand-recorded "owed to us" debts of this business with no client record (sale debts belong to their sale). */
export const unlinkedClientDebts = (debts, businessId) => (debts || []).filter((d) =>
  d.direction === 'owes_us' && !d.client_id && (!d.source || d.source === 'manual') &&
  (!d.business_id || String(d.business_id) === String(businessId)) && String(d.party_name || '').trim())
