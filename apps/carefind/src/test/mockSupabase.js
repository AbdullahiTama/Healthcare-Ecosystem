// ── In-memory adapter for Supabase JS client repository tests ────────────────
// Repositories accept a Supabase JS client (`client`) with the chainable API:
//   client.from('table').select('*').eq('col', val).maybeSingle()
//
// Production binds the real Supabase client; tests bind this mock. It
// understands the chainable shapes CareFind repositories actually use:
//   .select(), .eq(), .neq(), .in(), .order(), .limit(), .maybeSingle(),
//   .single(), .insert(), .update(), .delete()
//
// Returns { data, error } on every terminal operation, matching Supabase's
// return shape so repository code doesn't need special-casing for tests.

export function mockSupabaseClient(seed = {}) {
  const db = {}
  for (const [table, rows] of Object.entries(seed)) {
    db[table] = rows.map(r => ({ ...r }))
  }
  let autoId = 1000

  function chain(table, rows) {
    let _rows = [...rows]
    let _columns = '*'
    let _orderBy = null
    let _ascending = true
    let _limitVal = null

    const getResult = () => {
      api._applyOrderAndLimit()
      return { data: _rows, error: null }
    }

    const api = {
      then(resolve, reject) {
        try { resolve(getResult()) } catch (e) { reject?.(e) }
      },
      select(cols = '*') {
        _columns = cols
        return api
      },
      eq(col, val) {
        _rows = _rows.filter(r => String(r[col]) === String(val))
        return api
      },
      neq(col, val) {
        _rows = _rows.filter(r => String(r[col]) !== String(val))
        return api
      },
      in(col, values) {
        const set = values.map(String)
        _rows = _rows.filter(r => set.includes(String(r[col])))
        return api
      },
      gte(col, val) {
        _rows = _rows.filter(r => r[col] != null && String(r[col]) >= String(val))
        return api
      },
      lte(col, val) {
        _rows = _rows.filter(r => r[col] != null && String(r[col]) <= String(val))
        return api
      },
      gt(col, val) {
        _rows = _rows.filter(r => r[col] != null && String(r[col]) > String(val))
        return api
      },
      lt(col, val) {
        _rows = _rows.filter(r => r[col] != null && String(r[col]) < String(val))
        return api
      },
      order(col, opts = { ascending: true }) {
        _orderBy = col
        _ascending = opts.ascending !== false
        return api
      },
      limit(n) {
        _limitVal = n
        return api
      },
      _applyOrderAndLimit() {
        if (_orderBy) {
          _rows.sort((a, b) => {
            const av = a[_orderBy], bv = b[_orderBy]
            const cmp = av < bv ? -1 : av > bv ? 1 : 0
            return _ascending ? cmp : -cmp
          })
        }
        if (_limitVal != null) _rows = _rows.slice(0, _limitVal)
      },
      maybeSingle() {
        api._applyOrderAndLimit()
        const row = _rows[0] || null
        return { data: row, error: null }
      },
      single() {
        api._applyOrderAndLimit()
        if (_rows.length === 0) return { data: null, error: { message: 'Row not found', code: 'PGRST116' } }
        if (_rows.length > 1) return { data: null, error: { message: 'Multiple rows returned', code: 'PGRST116' } }
        return { data: _rows[0], error: null }
      },
      insert(rows) {
        const toInsert = (Array.isArray(rows) ? rows : [rows]).map(r => ({
          id: r.id ?? ++autoId,
          ...r,
        }))
        db[table].push(...toInsert.map(r => ({ ...r })))
        return {
          select() {
            return {
              single() {
                return { data: toInsert[0], error: null }
              },
            }
          },
          data: toInsert,
          error: null,
        }
      },
      update(patch) {
        const affected = [..._rows]
        affected.forEach(r => Object.assign(r, patch))
        const updateApi = {
          eq(col, val) {
            _rows = _rows.filter(r => String(r[col]) === String(val))
            _rows.forEach(r => Object.assign(r, patch))
            return updateApi
          },
          select() { return { single: () => ({ data: _rows[0] || null, error: null }) } },
          data: affected,
          error: null,
        }
        return updateApi
      },
      delete() {
        const deleteApi = {
          eq(col, val) {
            _rows = _rows.filter(r => String(r[col]) === String(val))
            return deleteApi
          },
          data: null,
          error: null,
        }
        const toDelete = new Set(_rows.map(r => r.id))
        db[table] = db[table].filter(r => !toDelete.has(r.id))
        return deleteApi
      },
    }
    return api
  }

  return {
    from(table) {
      db[table] = db[table] || []
      return chain(table, db[table])
    },
    // Inspection helper for assertions
    _rows(table) {
      return (db[table] || []).map(r => ({ ...r }))
    },
    _seed(table, rows) {
      db[table] = rows.map(r => ({ ...r }))
    },
  }
}
