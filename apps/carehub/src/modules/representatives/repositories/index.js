import { sbFetch } from '../../../services/supabase'
import { isMissingObject } from '../../../lib/dbErrors'

// ── Representatives and operating models (carehub_20270102_importer_operating_models) ─────────────────────────────
// Every write is a database function that checks who is asking and does the whole job in one transaction (ledger
// entry, stock movements, audit row). Reads of the ledger tables go through their RLS: ledger viewers see every
// representative of their company; a representative sees only their own rows. Statements and the summary are
// computed in the database so the screen, the printout and the spreadsheet always show the same figures.
//
// Until the migration is applied the functions do not exist; reads report `available: false` instead of failing,
// so the rest of the app keeps working.
// Before the migration, selecting the new businesses columns fails with "column ... does not exist" (or PGRST204).
const MISSING_COLUMN = /column [\w.]*(operating_model|account_kind)\w* does not exist|Could not find the '(operating_model|account_kind)\w*' column/i

export function createRepresentativesRepository(request = sbFetch) {
  // Every function here returns one jsonb value, which PostgREST sends back as that value.
  const rpc = (name, body = {}) => request(`rpc/${name}`, { method: 'POST', body: JSON.stringify(body) })
  const soft = async (fn, empty) => {
    try { return { available: true, ...(await fn()) } } catch (e) {
      if (isMissingObject(e) || MISSING_COLUMN.test(String(e?.message))) return { available: false, ...empty }
      throw e
    }
  }
  const key = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`)

  return {
    newRequestKey: key,

    // The signed-in account's operating fields. A rep account can read its own row (policy added by the migration).
    async accountProfile(businessId) {
      return soft(async () => {
        const rows = await request(`businesses?id=eq.${businessId}&select=id,operating_model,operating_model_changed_at,account_kind,parent_business_id`)
        return { profile: rows?.[0] || null }
      }, { profile: null })
    },

    // The signed-in person's representative row (either model), or null.
    async myProfile() {
      return soft(async () => ({ profile: (await rpc('my_representative')) || null }), { profile: null })
    },

    async list(companyId) {
      return soft(async () => ({
        representatives: await request(`company_representatives?company_id=eq.${companyId}&order=full_name.asc,id.asc&select=*`) || [],
      }), { representatives: [] })
    },

    // Company staff who could be made representatives (not already one).
    async candidateStaff(companyId, existingStaffIds = []) {
      const rows = await request(`staff?business_id=eq.${companyId}&status=in.(active,invited)&order=full_name.asc&select=id,full_name,email,role,status`)
      const taken = new Set(existingStaffIds.filter(Boolean))
      return (rows || []).filter((s) => !taken.has(s.id))
    },

    async add(companyId, staffId) { return rpc('add_company_representative', { p_company: companyId, p_staff_id: staffId }) },
    async setStatus(repId, status) { return rpc('set_representative_status', { p_representative_id: repId, p_status: status }) },

    // Company products for the entry forms (the company's own catalogue, with its price and cost as defaults).
    async searchProducts(companyId, search = '') {
      const q = String(search).trim().replace(/[*,()]/g, ' ').trim()
      return request(`products?business_id=eq.${companyId}`
        + (q ? `&name=ilike.*${encodeURIComponent(q)}*` : '')
        + '&order=name.asc,id.asc&limit=30&select=id,name,price,cost_price,stock,master_product_id')
    },

    async custody(repId) {
      return request(`rep_custody?representative_id=eq.${repId}&quantity=gt.0&order=product_name.asc&select=company_product_id,product_name,quantity`)
    },

    async pending(companyId) {
      return request(`rep_ledger_entries?company_id=eq.${companyId}&status=eq.pending&entry_type=in.(return,transfer_out)`
        + '&order=created_at.asc&select=*,rep_ledger_lines(*),company_representatives!rep_ledger_entries_representative_id_fkey(full_name,rep_code)')
    },

    async supply(companyId, repId, { lines, entryDate, reference, note, requestKey }) {
      return rpc('record_rep_supply', { p_company: companyId, p_representative_id: repId, p_lines: lines,
        p_entry_date: entryDate || null, p_reference: reference || null, p_note: note || null, p_idempotency_key: requestKey })
    },
    async payment(companyId, repId, { amount, method, recipient, entryDate, reference, note, requestKey }) {
      return rpc('record_rep_payment', { p_company: companyId, p_representative_id: repId, p_amount: amount, p_method: method,
        p_recipient: recipient, p_entry_date: entryDate || null, p_reference: reference || null, p_note: note || null, p_idempotency_key: requestKey })
    },
    async returnGoods(companyId, repId, { lines, condition, accept, entryDate, reference, note, requestKey }) {
      return rpc('record_rep_return', { p_company: companyId, p_representative_id: repId, p_lines: lines, p_condition: condition,
        p_accept: accept, p_entry_date: entryDate || null, p_reference: reference || null, p_note: note || null, p_idempotency_key: requestKey })
    },
    async transfer(companyId, fromRepId, toRepId, { lines, reason, approve, entryDate, reference, requestKey }) {
      return rpc('record_rep_transfer', { p_company: companyId, p_from_representative_id: fromRepId, p_to_representative_id: toRepId,
        p_lines: lines, p_reason: reason, p_approve: approve, p_entry_date: entryDate || null, p_reference: reference || null,
        p_idempotency_key: requestKey })
    },
    async adjustment(companyId, repId, { direction, amount, reason, reference, entryDate, requestKey }) {
      return rpc('record_rep_adjustment', { p_company: companyId, p_representative_id: repId, p_direction: direction, p_amount: amount,
        p_reason: reason, p_reference: reference, p_entry_date: entryDate || null, p_idempotency_key: requestKey })
    },
    async decide(entryId, decision, { note, values } = {}) {
      return rpc('decide_rep_entry', { p_entry_id: entryId, p_decision: decision, p_note: note || null, p_values: values || null })
    },
    async reverse(entryId, reason, requestKey) {
      return rpc('reverse_rep_entry', { p_entry_id: entryId, p_reason: reason, p_idempotency_key: requestKey })
    },

    async statement(repId, from, to) { return rpc('rep_statement', { p_representative_id: repId, p_from: from, p_to: to }) },
    async summary(companyId, from, to) { return rpc('rep_ledger_summary', { p_company: companyId, p_from: from, p_to: to }) },

    async companyCatalog(search = '', offset = 0) {
      return rpc('rep_company_catalog', { p_search: search || null, p_limit: 50, p_offset: offset })
    },

    async preview(companyId, target) { return rpc('operating_model_preview', { p_company: companyId, p_target: target }) },
    async switchModel(companyId, target, token, { stockPlan = null, note = '' } = {}) {
      return rpc('switch_operating_model', { p_company: companyId, p_target: target, p_token: token,
        p_stock_plan: stockPlan, p_note: note || null })
    },
    async history(companyId) {
      return soft(async () => ({
        changes: await request(`operating_model_changes?company_id=eq.${companyId}&order=effective_at.desc&limit=20`
          + '&select=id,from_model,to_model,effective_at,initiated_by_name,note,exceptions') || [],
      }), { changes: [] })
    },
  }
}

export const representativesRepository = createRepresentativesRepository()
