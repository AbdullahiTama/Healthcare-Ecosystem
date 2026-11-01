import { createRoot } from 'react-dom/client'
import { act, useState } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../lib/utils', async (orig) => ({ ...(await orig()), todayDate: () => '2026-10-31' }))
import PeriodFilter from './PeriodFilter'
import { periodBounds } from '../lib/datePeriods'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, seen
function Harness() {
  const [p, setP] = useState({ mode: 'all' })
  seen = p
  return <PeriodFilter value={p} onChange={setP} label='Supply date' />
}
const select = () => host.querySelector('select')
async function choose(el, value) {
  await act(async () => {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
}

beforeEach(async () => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => root.render(<Harness />))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('PeriodFilter', () => {
  it('starts at all time and is a labelled group', () => {
    expect(host.querySelector('[role="group"]').getAttribute('aria-label')).toBe('Supply date')
    expect(host.textContent).toContain('Showing: All time')
  })

  it('each mode starts from today, then follows the control', async () => {
    await choose(select(), 'week')
    expect(periodBounds(seen)).toMatchObject({ from: '2026-10-26', to: '2026-11-01' })
    await choose(host.querySelector('input[type="date"]'), '2026-10-14')
    expect(periodBounds(seen)).toMatchObject({ from: '2026-10-12', to: '2026-10-18' })

    await choose(select(), 'month')
    expect(periodBounds(seen)).toMatchObject({ from: '2026-10-01', to: '2026-10-31' })

    await choose(select(), 'range')
    const [from, to] = host.querySelectorAll('input[type="date"]')
    await choose(from, '2026-09-01')
    await choose(to, '2026-09-15')
    expect(periodBounds(seen)).toMatchObject({ from: '2026-09-01', to: '2026-09-15' })
    expect(host.textContent).toContain('Showing: 1 Sep 2026 to 15 Sep 2026')

    await choose(select(), 'year')
    await choose(host.querySelectorAll('select')[1], '2025')
    expect(periodBounds(seen)).toMatchObject({ from: '2025-01-01', to: '2025-12-31' })
  })

  it('presets set the period and show which one is on', async () => {
    const preset = (t) => [...host.querySelectorAll('button')].find((b) => b.textContent === t)
    await act(async () => preset('Last month').click())
    expect(periodBounds(seen)).toMatchObject({ from: '2026-09-01', to: '2026-09-30' })
    expect(preset('Last month').getAttribute('aria-pressed')).toBe('true')
    expect(preset('This month').getAttribute('aria-pressed')).toBe('false')
  })
})
