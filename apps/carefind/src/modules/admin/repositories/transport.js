import { callAdminAuth } from '../adminApi.js'
import { supabase } from '../../../config/supabaseClient.js'

export function createAdminTransport() {
  return {
    async api(action, payload = {}) {
      const { data, ...rest } = await callAdminAuth(action, payload)
      return { data, ...rest }
    },

    async query(table, { select = '*', filters = [], order, limit, offset, count } = {}) {
      let q = supabase.from(table).select(select, count ? { count: 'exact', head: count === 'head' } : undefined)

      for (const f of filters) {
        if (f.op === 'eq') q = q.eq(f.col, f.val)
        else if (f.op === 'ilike') q = q.ilike(f.col, f.val)
        else if (f.op === 'in') q = q.in(f.col, f.val)
        else if (f.op === 'gte') q = q.gte(f.col, f.val)
        else if (f.op === 'lte') q = q.lte(f.col, f.val)
        else if (f.op === 'neq') q = q.neq(f.col, f.val)
      }

      if (order) q = q.order(order.column, { ascending: order.ascending ?? false })
      if (limit != null && offset != null) q = q.range(offset, offset + limit - 1)
      else if (limit != null) q = q.limit(limit)

      const { data, error, count: totalCount } = await q
      if (error) throw error
      return { data: data || [], count: totalCount }
    },

    async rpc(name, params = {}) {
      const { data, error } = await supabase.rpc(name, params)
      if (error) throw error
      return data
    },

    storage: supabase.storage,
  }
}

export const adminTransport = createAdminTransport()
