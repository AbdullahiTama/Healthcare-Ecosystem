import { sbFetch } from '../../../services/supabase'
import { isMissingObject } from '../../../lib/dbErrors'

// ── Stock transfer repository (carehub_20261222) ─────────────────────────────
// Moving stock between the locations of one business. Reads go through the
// stock_transfers / stock_transfer_lines visibility rules (both locations and
// the owner above them see a transfer). Every change is a database function
// that checks who is asking and moves the stock in one transaction:
//   send    — owner or manager of the sending location; stock leaves at once.
//   receive — any staff member of the receiving location; records shortfalls.
//   cancel  — owner or manager of the sending location; stock returns.
// Before the migration is applied, reads report `available: false`.
export function createTransferRepository(request = sbFetch) {
  const rpc = async (name, body) => {
    const rows = await request(`rpc/${name}`, { method: 'POST', body: JSON.stringify(body) })
    return Array.isArray(rows) ? rows[0] : rows
  }

  return {
    // The latest transfers in or out of a location, newest first, with their lines.
    async list(locationId, { limit = 100 } = {}) {
      try {
        const rows = await request(`stock_transfers?or=(from_branch_id.eq.${locationId},to_branch_id.eq.${locationId})`
          + `&status=in.(in_transit,received,cancelled)&order=created_at.desc,id.asc&limit=${limit}&select=*,stock_transfer_lines(*)`)
        return { available: true, transfers: rows || [] }
      } catch (e) {
        if (isMissingObject(e) || /stock_transfer_lines|transfer_no/.test(String(e?.message))) return { available: false, transfers: [] }
        throw e
      }
    },

    // Products this location can send: linked to a master item, with stock, matching the search.
    async sendable(locationId, search = '') {
      const q = String(search).trim().replace(/[*,()]/g, ' ').trim()
      return request(`products?business_id=eq.${locationId}&master_product_id=not.is.null&stock=gt.0`
        + (q ? `&name=ilike.*${encodeURIComponent(q)}*` : '')
        + '&order=name.asc,id.asc&limit=30&select=id,name,stock,master_product_id')
    },

    async send(fromId, toId, lines, note = '') {
      return rpc('send_stock_transfer', {
        p_from_branch_id: fromId, p_to_branch_id: toId, p_note: note || null,
        p_lines: lines.map((l) => ({ master_product_id: l.master_product_id, qty: l.qty })),
      })
    },

    // `lines`: [{ line_id, qty_received }] for lines that did not arrive in full; the rest arrived in full.
    async receive(transferId, lines = [], note = '') {
      return rpc('receive_stock_transfer', { p_transfer_id: transferId, p_lines: lines, p_note: note || null })
    },

    async cancel(transferId, reason = '') {
      return rpc('cancel_stock_transfer', { p_transfer_id: transferId, p_reason: reason || null })
    },
  }
}

export const transferRepository = createTransferRepository()
