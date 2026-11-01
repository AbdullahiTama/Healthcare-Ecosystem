import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act, useState } from 'react'
import SearchSelect, { filterOptions, SHOWN } from '../SearchSelect.jsx'

// A filter you can type into instead of scrolling a long list.

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host
afterEach(async () => { await act(async () => { root.unmount() }); host.remove() })

const PRODUCTS = [
  { value: 'p1', label: 'Amoxicillin 500mg' },
  { value: 'p2', label: 'Paracetamol 500mg' },
  { value: 'p3', label: 'Paracetamol syrup' },
]

function Harness({ options = PRODUCTS, onChange }) {
  const [value, setValue] = useState('')
  return <SearchSelect label='Product' value={value} options={options} placeholder='All products'
    onChange={(v) => { setValue(v); onChange?.(v) }} />
}
async function mount(ui) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(ui) })
  return host.querySelector('input[role="combobox"]')
}
const type = async (el, v) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const key = (el, k) => act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })) })
const options = () => [...host.querySelectorAll('[role="option"]')].map((o) => o.textContent)

describe('SearchSelect', () => {
  it('is a labelled combobox that opens on focus with "All …" first', async () => {
    const box = await mount(<Harness />)
    expect(host.querySelector('label').textContent).toBe('Product')
    expect(box.getAttribute('aria-expanded')).toBe('false')
    await act(async () => { box.focus() })
    expect(box.getAttribute('aria-expanded')).toBe('true')
    expect(options()).toEqual(['All products', 'Amoxicillin 500mg', 'Paracetamol 500mg', 'Paracetamol syrup'])
  })

  it('narrows as you type (every word must match) and picks with the keyboard', async () => {
    const onChange = vi.fn()
    const box = await mount(<Harness onChange={onChange} />)
    await act(async () => { box.focus() })
    await type(box, 'para 500')
    expect(options()).toEqual(['Paracetamol 500mg'])
    await key(box, 'Enter')
    expect(onChange).toHaveBeenCalledWith('p2')
    expect(box.value).toBe('Paracetamol 500mg')
    expect(box.getAttribute('aria-expanded')).toBe('false')
  })

  it('moves with the arrow keys, points aria-activedescendant at the row, and closes on Escape', async () => {
    const onChange = vi.fn()
    const box = await mount(<Harness onChange={onChange} />)
    await act(async () => { box.focus() })
    await key(box, 'ArrowDown')
    await key(box, 'ArrowDown')
    expect(document.getElementById(box.getAttribute('aria-activedescendant')).textContent).toBe('Paracetamol 500mg')
    await key(box, 'Escape')
    expect(box.getAttribute('aria-expanded')).toBe('false')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('says when nothing matches, and clears with the × button', async () => {
    const onChange = vi.fn()
    const box = await mount(<Harness onChange={onChange} />)
    await act(async () => { box.focus() })
    await type(box, 'zzz')
    expect(options()).toEqual(['Nothing matches “zzz”'])
    await type(box, 'amox')
    await key(box, 'Enter')
    await act(async () => { host.querySelector('button[aria-label="Clear Product filter"]').click() })
    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('draws at most a page of a huge list and says how many more to narrow', async () => {
    const many = Array.from({ length: 1200 }, (_, i) => ({ value: 'p' + i, label: 'Product ' + i }))
    const box = await mount(<Harness options={many} />)
    await act(async () => { box.focus() })
    expect(options()).toHaveLength(SHOWN + 1) // + "All products"
    expect(host.textContent).toContain(`${1200 - SHOWN} more — keep typing to narrow the list`)
    await type(box, 'product 1199')
    expect(options()).toEqual(['Product 1199'])
  })

  it('closes when clicking elsewhere', async () => {
    const box = await mount(<Harness />)
    await act(async () => { box.focus() })
    await act(async () => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    expect(box.getAttribute('aria-expanded')).toBe('false')
  })

  it('filterOptions accepts plain strings and matches case-insensitively', () => {
    expect(filterOptions(['Cash', 'Transfer'], 'TRANS')).toEqual([{ value: 'Transfer', label: 'Transfer' }])
  })
})
