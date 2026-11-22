// @vitest-environment node
// CODE_AUDIT A25: products.cost_price is not readable by the API roles (carehub_20270203). These pin the helpers and
// guard the source: a `select=*` on products, or a products write that reads the whole row back, would fail for every
// user once the column is closed.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PRODUCT_COLUMNS, fetchProductCosts, withCosts, withSentCost, withoutCosts } from './productColumns'

const SRC = fileURLToPath(new URL('../../', import.meta.url))
function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === 'node_modules' || name === '__tests__' ? [] : sourceFiles(p)
    return /\.(js|jsx)$/.test(name) && !/\.test\.(js|jsx)$/.test(name) ? [p] : []
  })
}

describe('PRODUCT_COLUMNS', () => {
  it('names the readable columns and never cost_price', () => {
    const cols = PRODUCT_COLUMNS.split(',')
    expect(cols).not.toContain('cost_price')
    expect(cols).toEqual(expect.arrayContaining(['id', 'business_id', 'name', 'price', 'stock', 'barcode', 'tracking_mode', 'master_product_id']))
    expect(new Set(cols).size).toBe(cols.length)
  })
})

describe('source guard', () => {
  const files = sourceFiles(SRC).map((p) => ({ p, s: readFileSync(p, 'utf8') }))

  it('no request to products asks for * or for cost_price', () => {
    const bad = []
    for (const { p, s } of files) {
      for (const m of s.matchAll(/[`'"]products\?[^`'"]*[`'"]/g)) {
        if (/select=\*|select=[^&`'"]*cost_price/.test(m[0])) bad.push(`${p}: ${m[0]}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('no write to products reads the whole row back (a POST/PATCH to products without a select list)', () => {
    const bad = []
    for (const { p, s } of files) {
      for (const m of s.matchAll(/(?:request|sbFetch)\(\s*['"`]products['"`]\s*,/g)) bad.push(`${p}: ${m[0]}`)
    }
    expect(bad).toEqual([])
  })
})

describe('helpers', () => {
  it('fetchProductCosts: posts the business and ids; {} when not allowed or on failure', async () => {
    const request = vi.fn(async () => ({ p1: 5 }))
    expect(await fetchProductCosts(request, 'b', ['p1'])).toEqual({ p1: 5 })
    expect(request).toHaveBeenCalledWith('rpc/product_costs', { method: 'POST', body: JSON.stringify({ p_business_id: 'b', p_product_ids: ['p1'] }) })
    expect(await fetchProductCosts(request, null)).toEqual({})
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await fetchProductCosts(async () => { throw new Error('x') }, 'b')).toEqual({})
    err.mockRestore()
  })

  it('withCosts adds only known costs; withoutCosts strips them; withSentCost keeps what was saved', () => {
    const rows = [{ id: 'a' }, { id: 'b' }]
    expect(withCosts(rows, { a: '12.5' })).toEqual([{ id: 'a', cost_price: 12.5 }, { id: 'b' }])
    expect(withCosts(rows, {})).toBe(rows)
    expect(withoutCosts([{ id: 'a', cost_price: 1 }, { id: 'b' }])).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(withSentCost([{ id: 'a' }], { cost_price: 0 })).toEqual([{ id: 'a', cost_price: 0 }])
    expect(withSentCost([{ id: 'a' }, { id: 'b' }], [{ cost_price: 3 }, {}])).toEqual([{ id: 'a', cost_price: 3 }, { id: 'b' }])
  })
})
