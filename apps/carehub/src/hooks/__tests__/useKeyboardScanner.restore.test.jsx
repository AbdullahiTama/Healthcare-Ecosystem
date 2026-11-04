// fieldSnapshot / restoreField put back the value of the field a scan was typed
// into, through React's own onChange, whichever component owns that field's
// state (Debts opens other modules' dialogs whose state it cannot reach).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act, useState } from 'react'
import { fieldSnapshot, restoreField } from '../useKeyboardScanner'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let seen
function Owner() {
  const [amount, setAmount] = useState('1500')
  const [method, setMethod] = useState('Cash')
  seen = { amount, method }
  return (
    <>
      <input id='amount' type='number' value={amount} onChange={(e) => setAmount(e.target.value)} />
      <select id='method' value={method} onChange={(e) => setMethod(e.target.value)}><option>Cash</option><option>Transfer</option></select>
      <input id='agree' type='checkbox' readOnly checked />
    </>
  )
}
const type = (el, v) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
}

let host, root
beforeEach(async () => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<Owner />) })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('restoreField', () => {
  it('puts a number input back, and the owning component\'s state follows', async () => {
    const el = host.querySelector('#amount')
    const snap = fieldSnapshot(el)
    await act(async () => { type(el, '1500615110000123') })
    expect(seen.amount).toBe('1500615110000123')
    await act(async () => { restoreField(snap) })
    expect(el.value).toBe('1500')
    expect(seen.amount).toBe('1500')
  })

  it('puts a select back too', async () => {
    const el = host.querySelector('#method')
    const snap = fieldSnapshot(el)
    await act(async () => { type(el, 'Transfer') })
    await act(async () => { restoreField(snap) })
    expect(seen.method).toBe('Cash')
  })

  it('ignores what has nothing to restore: buttons, checkboxes, the body, a removed field', async () => {
    expect(fieldSnapshot(document.body)).toBeNull()
    expect(fieldSnapshot(host.querySelector('#agree'))).toBeNull()
    expect(fieldSnapshot(null)).toBeNull()
    const snap = fieldSnapshot(host.querySelector('#amount'))
    await act(async () => { root.render(<></>) })
    expect(() => restoreField(snap)).not.toThrow()
    expect(() => restoreField(null)).not.toThrow()
  })
})
