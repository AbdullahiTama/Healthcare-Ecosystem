import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../lib/authClient', () => ({ authClient: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })) } } }))

import PayoutAccountsPanel from './PayoutAccountsPanel.jsx'

let root, host
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

function fakeManager(state, over = {}) {
  const s = { loading: false, loadError: '', kyc: { verified: false }, accounts: [], required: false, busy: '', error: '', code: '', codeSent: false, sentTo: '', ...state }
  return { getState: () => s, subscribe: () => () => {}, load: vi.fn(), clearError: vi.fn(), verifyIdentity: vi.fn(async () => true), verifySelfie: vi.fn(async () => true), sendCode: vi.fn(), addAccount: vi.fn(), setDefault: vi.fn(), remove: vi.fn(async () => true), ...over }
}
const mount = async (manager, extra = {}) => act(async () => root.render(<PayoutAccountsPanel manager={manager} selectedId="" onSelect={vi.fn()} banks={[]} banksStatus="ready" onRetryBanks={vi.fn()} {...extra} />))
const type = async (id, value) => {
  const el = host.querySelector(`#${id}`)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.includes(text))

describe('PayoutAccountsPanel (CareHub)', () => {
  it('loading and error states', async () => {
    await mount(fakeManager({ loading: true }))
    expect(host.querySelector('[aria-busy="true"]')).toBeTruthy()
    const m = fakeManager({ loadError: 'Could not load your payout details. Try again.' })
    await mount(m)
    expect(host.querySelector('[role="alert"]').textContent).toMatch(/Could not load/)
    await act(async () => { button('Try again').click() })
    expect(m.load).toHaveBeenCalled()
  })

  it('unverified owner: masked BVN/NIN fields, digits only, submit only when 11 + 11; adding is blocked', async () => {
    const m = fakeManager({})
    await mount(m)
    expect(host.querySelector('#kyc-bvn').type).toBe('password')
    expect(host.querySelector('#kyc-nin').type).toBe('password')
    expect(button('Verify identity').disabled).toBe(true)
    expect(button('+ Add account').disabled).toBe(true)
    await type('kyc-bvn', '2222222222x2'); await type('kyc-nin', '11111111111')
    expect(host.querySelector('#kyc-bvn').value).toBe('22222222222')
    expect(button('Verify identity').disabled).toBe(false)
    await act(async () => { button('Verify identity').click() })
    expect(m.verifyIdentity).toHaveBeenCalledWith({ bvn: '22222222222', nin: '11111111111' })
  })

  it('verified owner: shows the verified name (BVN last four only) and masked saved accounts as a radio group', async () => {
    const accounts = [{ id: 'a1', bankName: 'GTBank', accountLast4: '6789', accountName: 'GRACE PHARMACY LIMITED', isDefault: true }]
    const onSelect = vi.fn()
    await mount(fakeManager({ kyc: { verified: true, legalName: 'ADA OBI', bvnLast4: '1234' }, accounts }), { selectedId: 'a1', onSelect })
    expect(host.textContent).toContain('Identity verified')
    expect(host.textContent).toContain('••••1234')
    expect(host.textContent).toContain('••••6789')
    expect(host.textContent).not.toMatch(/\d{10}/)
    expect(host.querySelector('[role="radiogroup"]')).toBeTruthy()
    expect(host.querySelector('input[type="radio"]').checked).toBe(true)
    expect(button('+ Add account').disabled).toBe(false)
  })

  it('removing needs the PIN', async () => {
    const accounts = [{ id: 'a1', bankName: 'GTBank', accountLast4: '6789', accountName: 'X', isDefault: true }]
    const m = fakeManager({ kyc: { verified: true, legalName: 'ADA OBI', bvnLast4: '1234' }, accounts })
    await mount(m, { selectedId: 'a1' })
    await act(async () => { button('Remove').click() })
    expect(button('Remove account').disabled).toBe(true)
    await type('rm-pin-a1', '1234')
    await act(async () => { button('Remove account').click() })
    expect(m.remove).toHaveBeenCalledWith({ id: 'a1', pin: '1234' })
  })

  it('shows a new account\'s cooling-off cap, and never offers the selfie step to a business owner', async () => {
    const ends = new Date(Date.now() + 3 * 3600_000).toISOString()
    const accounts = [{ id: 'n1', bankName: 'GTBank', accountLast4: '6789', accountName: 'GRACE PHARMACY LIMITED', isDefault: true, coolingEndsAt: ends }]
    await mount(fakeManager({ kyc: { verified: true, legalName: 'ADA OBI', bvnLast4: '1234' }, accounts, limits: { tier: 1, dailyCapKobo: null, nextTierCapKobo: null, cooloffHours: 24, cooloffCapKobo: 2000000 } }), { selectedId: 'n1' })
    expect(host.querySelector('[role="note"]').textContent).toMatch(/limited to ₦20,000 in any 24 hours until/)
    expect(host.querySelector('#selfie-file')).toBeNull()
    expect(host.textContent).not.toContain('Daily withdrawal limit')
  })
})
