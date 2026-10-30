import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Every product write, in order. `dbStock` is the database's truth, which
// moves underneath the page (POS sales) — the page's own list is stale.
const calls = []
let dbStock = {}
let incrementImpl = null
let mergeImpl = null

vi.mock('../../services/supabase', () => ({ sbFetch: vi.fn(), cacheData: vi.fn(), getCached: vi.fn(() => null) }))
vi.mock('./repositories', () => ({
  productRepository: {
    getAll: async () => [],
    update: async (...a) => { calls.push(['update', ...a]); return { ...AMOXIL, ...a[2], id: a[0] } },
    create: async (...a) => { calls.push(['create', ...a]); return [{ id: 'new' }] },
    incrementStock: async (...a) => {
      calls.push(['incrementStock', ...a])
      if (incrementImpl) return incrementImpl(...a)
      const [id, , qty] = a
      if (!(id in dbStock)) return null
      dbStock[id] += qty
      return dbStock[id]
    },
    delete: async () => null,
    mergeDuplicates: async (...a) => {
      calls.push(['mergeDuplicates', ...a])
      if (mergeImpl) return mergeImpl(...a)
      return { keeper_id: a[1], merged: a[2].length, units_moved: 5, stock: 35 }
    },
  },
}))

import Inventory from './Inventory.jsx'

var AMOXIL = { id: 'p1', name: 'Amoxil 500mg', generic_name: 'Amoxicillin', category: 'Medicines', price: 1500, cost_price: 800, stock: 50, reorder_level: 5 }
const OWNER = { canEditPrice: true, canEditStock: true, canDelete: true }

let host
let root
beforeEach(() => {
  calls.length = 0
  dbStock = { p1: 30 } // 20 sold at the till since the page loaded its list (50)
  incrementImpl = null
  mergeImpl = null
  global.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const catalog = { status: 'ready', refreshing: false, stale: false, staleReason: null, loadedCount: 0, error: null, reload: () => {} }
const render = async (perms = OWNER, products = [AMOXIL]) => {
  await act(async () => { root.render(<MemoryRouter><Inventory brand={{ id: 'B1', plan: 'pro' }} products={products} setProducts={() => {}} catalog={catalog} role='Owner' perms={perms} /></MemoryRouter>) })
  await flush()
}
const type = async (input, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const button = (text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
// Find a form field by the start of its visible label (ids are derived from
// label text, asterisks included, so they are not a stable selector).
const byLabel = (text) => {
  const label = [...host.querySelectorAll('label')].find(l => l.textContent.trim().startsWith(text))
  return label && document.getElementById(label.htmlFor)
}
const dialog = () => host.querySelector('[role="dialog"]')
const stockWrites = () => calls.filter(c => c[0] === 'update' && 'stock' in c[3])

describe('Inventory — stock is never written back from the stale page list', () => {
  it('+ Stock adds units in the database instead of writing shown stock + units', async () => {
    await render()
    await click(button('+ Stock'))
    await type(host.querySelector('#restock-units'), '10')
    await click(button('+ Add Stock'))
    await flush()

    expect(calls.filter(c => c[0] === 'incrementStock')).toEqual([['incrementStock', 'p1', 'B1', 10]])
    expect(stockWrites()).toHaveLength(0)
    // 30 left after the sales, +10 — not the page's 50 + 10 = 60.
    expect(dbStock.p1).toBe(40)
    expect(host.textContent).toContain('now 40 in stock')
    expect(dialog()).toBeNull()
  })

  it('a second tap while saving does not add the stock twice', async () => {
    let release
    incrementImpl = () => new Promise(r => { release = r })
    await render()
    await click(button('+ Stock'))
    await type(host.querySelector('#restock-units'), '10')
    await click(button('+ Add Stock'))
    await click(button('Saving...'))
    await act(async () => { release(40) })
    await flush()
    expect(calls.filter(c => c[0] === 'incrementStock')).toHaveLength(1)
  })

  it('rejects a decimal quantity instead of truncating it', async () => {
    await render()
    await click(button('+ Stock'))
    await type(host.querySelector('#restock-units'), '2.5')
    await click(button('+ Add Stock'))
    await flush()
    expect(calls.filter(c => c[0] === 'incrementStock')).toHaveLength(0)
    expect(host.textContent).toContain('whole number')
  })

  it('keeps the dialog and the typed quantity open when the save fails', async () => {
    incrementImpl = async () => { throw new Error('Supabase error (500): boom') }
    await render()
    await click(button('+ Stock'))
    await type(host.querySelector('#restock-units'), '10')
    await click(button('+ Add Stock'))
    await flush()
    expect(dialog()).not.toBeNull()
    expect(host.querySelector('#restock-units').value).toBe('10')
    expect(host.textContent).toContain('Check the current stock')
  })

  it('hides + Stock from roles without stock permission', async () => {
    await render({ canEditPrice: false, canEditStock: false })
    expect(button('+ Stock')).toBeUndefined()
  })

  it('editing only the price does not send stock back', async () => {
    await render()
    await click(button('Edit'))
    await type(byLabel('Selling Price'), '1600')
    await click(button('Save Changes'))
    await flush()
    const update = calls.find(c => c[0] === 'update')
    expect(update[3].price).toBe(1600)
    expect('stock' in update[3]).toBe(false)
  })

  it('editing the stock count itself is still saved as a correction', async () => {
    await render()
    await click(button('Edit'))
    await type(byLabel('Stock Quantity'), '28')
    await click(button('Save Changes'))
    await flush()
    expect(calls.find(c => c[0] === 'update')[3].stock).toBe(28)
  })

  it('"Update Existing Product" adds the new units in the database and respects price permission', async () => {
    await render({ canEditPrice: false, canEditStock: true })
    await click(button('Add product'))
    await type(byLabel('Product Name'), 'Amoxil 500mg')
    await type(byLabel('Selling Price'), '9999')
    await type(byLabel('Stock Quantity'), '12')
    await click(button('Add Product'))
    await flush()
    await click(button('Update Existing Product'))
    await flush()

    expect(calls.filter(c => c[0] === 'incrementStock')).toEqual([['incrementStock', 'p1', 'B1', 12]])
    const update = calls.find(c => c[0] === 'update')
    expect('stock' in update[3]).toBe(false)
    expect('price' in update[3]).toBe(false)
    expect(dbStock.p1).toBe(42)
  })

  describe('Clean up duplicates', () => {
    // Two groups: Amoxil (kept: has a cost price) with a costless copy, and
    // Panadol with its copy.
    const AMOX_COPY = { id: 'p2', name: 'AMOXIL 500MG', generic_name: 'Amoxicillin', category: 'Medicines', price: 1500, cost_price: 0, stock: 5 }
    const PANADOL = { id: 'p3', name: 'Panadol', generic_name: 'Paracetamol', category: 'Medicines', price: 900, cost_price: 600, stock: 8 }
    const PANADOL_COPY = { id: 'p4', name: 'panadol', generic_name: 'Paracetamol', category: 'Medicines', price: 900, cost_price: 0, stock: 1 }
    const list = [AMOXIL, AMOX_COPY, PANADOL, PANADOL_COPY]
    const cleanupButton = () => [...host.querySelectorAll('button')].find(b => b.textContent.includes('Clean up'))

    it('merges each group through the database function and never writes stock or bulk deletes', async () => {
      await render(OWNER, list)
      await click(cleanupButton())
      expect(dialog().textContent).toContain('keeps Amoxil 500mg')
      expect(dialog().textContent).toContain('Kept')
      await click([...host.querySelectorAll('button')].find(b => b.textContent.startsWith('Merge All')))
      await flush()

      const merges = calls.filter(c => c[0] === 'mergeDuplicates')
      expect(merges).toEqual([
        ['mergeDuplicates', 'B1', 'p1', ['p2']],
        ['mergeDuplicates', 'B1', 'p3', ['p4']],
      ])
      expect(calls.filter(c => c[0] === 'update' || c[0] === 'incrementStock')).toHaveLength(0)
      expect(host.textContent).toContain('Merged 2 duplicate group(s). Removed 2 duplicate item(s)')
    })

    it('a group the database refuses is reported by name and the others still merge', async () => {
      mergeImpl = async (biz, keeper) => {
        if (keeper === 'p1') {
          const e = new Error('More than one of these products has a shop listing. Remove the extra listing, then merge.')
          e.code = 'MERGE_LISTING_CONFLICT'
          throw e
        }
        return { stock: 9 }
      }
      await render(OWNER, list)
      await click(cleanupButton())
      await click([...host.querySelectorAll('button')].find(b => b.textContent.startsWith('Merge All')))
      await flush()

      expect(calls.filter(c => c[0] === 'mergeDuplicates')).toHaveLength(2)
      expect(host.textContent).toContain('Merged 1 of 2 group(s). Not merged: Amoxil 500mg: More than one of these products has a shop listing')
    })

    it('a network failure is not presented as a confident reason', async () => {
      mergeImpl = async () => { throw new TypeError('Failed to fetch') }
      await render(OWNER, [AMOXIL, AMOX_COPY])
      await click(cleanupButton())
      await click([...host.querySelectorAll('button')].find(b => b.textContent.startsWith('Merge All')))
      await flush()
      expect(host.textContent).toContain('Amoxil 500mg: could not confirm the merge')
    })

    it('is not offered to roles that cannot delete products', async () => {
      await render({ canEditPrice: true, canEditStock: true, canDelete: false }, list)
      expect(cleanupButton()).toBeUndefined()
    })
  })
})
