import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls = vi.hoisted(() => [])
vi.mock('../../../config/supabaseClient.js', () => {
  const builder = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (resolve) => resolve({ data: [], error: null, count: 0 })
      return (...args) => { calls.push([prop, ...args]); return builder }
    },
  })
  return { supabase: { from: (t) => { calls.push(['from', t]); return builder }, rpc: vi.fn(), storage: {} } }
})
vi.mock('../adminApi.js', () => ({ callAdminAuth: vi.fn() }))

import { createAdminTransport, likeContains } from './transport.js'

const transport = createAdminTransport()
const orClause = () => calls.find(c => c[0] === 'or')?.[1]
beforeEach(() => { calls.length = 0 })

describe('likeContains', () => {
  it('wraps a plain term', () => expect(likeContains('lagos')).toBe('%lagos%'))
  it('escapes LIKE wildcards and the escape character', () => {
    expect(likeContains('50%_off\\x')).toBe('%50\\%\\_off\\\\x%')
  })
})

describe('or filter op', () => {
  it('builds one or() clause over every column', async () => {
    await transport.query('businesses', { filters: [{ op: 'or', terms: [{ col: 'state', contains: 'lagos' }, { col: 'city', contains: 'lagos' }] }] })
    expect(orClause()).toBe('state.ilike."%lagos%",city.ilike."%lagos%"')
  })

  it('a term with commas, parentheses and quotes stays inside one quoted value', async () => {
    await transport.query('businesses', { filters: [{ op: 'or', terms: [{ col: 'state', contains: 'a",id.eq.1),(x' }] }] })
    const clause = orClause()
    // the injected quote is escaped, so the whole term is a single ilike value
    expect(clause).toBe('state.ilike."%a\\",id.eq.1),(x%"')
    expect(clause.match(/\.ilike\./g)).toHaveLength(1)
  })

  it('escapes % _ and backslash for LIKE and then for the quoted string', async () => {
    await transport.query('businesses', { filters: [{ op: 'or', terms: [{ col: 'state', contains: '50%_\\' }] }] })
    expect(orClause()).toBe('state.ilike."%50\\\\%\\\\_\\\\\\\\%"')
  })

  it('rejects a column name that is not a plain identifier', async () => {
    await expect(transport.query('businesses', { filters: [{ op: 'or', terms: [{ col: 'state,id', contains: 'x' }] }] })).rejects.toThrow('Invalid filter column')
  })

  it('ignores an empty or term list instead of sending or()', async () => {
    await transport.query('businesses', { filters: [{ op: 'or', terms: [] }] })
    expect(orClause()).toBeUndefined()
  })

  it('leaves the existing ops unchanged', async () => {
    await transport.query('businesses', { filters: [{ op: 'eq', col: 'state', val: 'Lagos' }, { op: 'ilike', col: 'name', val: '%x%' }] })
    expect(calls).toContainEqual(['eq', 'state', 'Lagos'])
    expect(calls).toContainEqual(['ilike', 'name', '%x%'])
  })
})
