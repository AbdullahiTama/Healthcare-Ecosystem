import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../lib/authClient', () => ({
  authClient: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok-test' } } })) } },
}))

vi.mock('./repositories', () => ({
  walletRepository: {
    getWallet: vi.fn(async () => [{ available_balance: 500_000, held_balance: 0 }]),
    getTransactions: vi.fn(async () => []),
    getWithdrawals: vi.fn(async () => []),
  },
}))

// Real initiate/verify run against the fetch mock; only the redirect is
// stubbed, because jsdom cannot actually navigate.
vi.mock('./topupApi', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, goToPaystack: vi.fn() }
})

import { MemoryRouter } from 'react-router-dom'
import Wallet from './Wallet.jsx'
import { goToPaystack } from './topupApi'
import { walletRepository } from './repositories'

let root, host, fetchMock
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body })

const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
const click = async (text) => {
  const btn = button(text)
  await act(async () => { btn.click() })
}
const type = async (id, value) => {
  const el = host.querySelector(`#${id}`)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const mount = async ({ entries = ['/dashboard/wallet'], role = 'Owner' } = {}) => {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={entries}>
        <Wallet brand={{ id: 'b1' }} role={role} />
      </MemoryRouter>
    )
  })
  await act(async () => {}) // let the verify/load promise chains settle
}
const callsTo = (path) => fetchMock.mock.calls.filter(([u]) => String(u).includes(path))

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.clearAllMocks()
  fetchMock = vi.fn(async (url) => {
    if (String(url).includes('/api/banks')) return reply(200, [{ code: '058', name: 'GTBank' }])
    return reply(404, { error: 'not found' })
  })
  globalThis.fetch = fetchMock
  walletRepository.getWallet.mockResolvedValue([{ available_balance: 500_000, held_balance: 0 }])
  walletRepository.getTransactions.mockResolvedValue([])
  walletRepository.getWithdrawals.mockResolvedValue([])
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Wallet top-up flow', () => {
  it('opens the modal and keeps Continue disabled until the amount is in range', async () => {
    await mount()
    await click('Top Up')
    expect(host.querySelector('[role="dialog"][aria-label="Top up wallet"]')).toBeTruthy()

    await type('topup-amount', '50')
    expect(button('Continue').disabled).toBe(true)
    expect(host.querySelector('#topup-amount-help').textContent).toMatch(/₦100 and ₦100,000/)

    await type('topup-amount', '200000')
    expect(button('Continue').disabled).toBe(true)

    await type('topup-amount', '1500')
    expect(button('Continue').disabled).toBe(false)
    expect(host.querySelector('#topup-amount-help')).toBeNull()
    expect(callsTo('/api/initiate-wallet-topup')).toHaveLength(0)
  })

  it('initiates with the whole-kobo amount and hands the owner to Paystack', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/api/banks')) return reply(200, [])
      if (String(url).includes('/api/initiate-wallet-topup')) return reply(200, { authorization_url: 'https://checkout.test/xyz', reference: 'ch_topup_b1_abcdef123456' })
      return reply(404, {})
    })
    await mount()
    await click('Top Up')
    await type('topup-amount', '1500')
    await click('Continue')

    const [url, init] = callsTo('/api/initiate-wallet-topup')[0]
    expect(url).toBe('/api/initiate-wallet-topup')
    expect(init.headers.Authorization).toBe('Bearer tok-test')
    expect(JSON.parse(init.body)).toEqual({ amount: 150_000, callback_url: `${window.location.origin}/dashboard/wallet` })
    expect(goToPaystack).toHaveBeenCalledWith('https://checkout.test/xyz')
  })

  it('a server refusal is shown and the modal stays usable (error state)', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/api/banks')) return reply(200, [])
      if (String(url).includes('/api/initiate-wallet-topup')) return reply(400, { error: 'Amount must be a whole-kobo integer between N100 and N100,000' })
      return reply(404, {})
    })
    await mount()
    await click('Top Up')
    await type('topup-amount', '1500')
    await click('Continue')

    expect(host.textContent).toMatch(/whole-kobo/)
    expect(goToPaystack).not.toHaveBeenCalled()
    expect(host.querySelector('[role="dialog"]')).toBeTruthy()   // still open for a retry
    expect(button('Continue').disabled).toBe(false)              // not stuck in "starting"
  })

  it('returning from Paystack verifies the reference, reloads the wallet and cleans the URL', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/api/banks')) return reply(200, [])
      if (String(url).includes('/api/verify-wallet-topup')) return reply(200, { credited: true, newAvailable: 650_000 })
      return reply(404, {})
    })
    await mount({ entries: ['/dashboard/wallet?reference=ch_topup_b1_abcdef123456'] })

    const [url, init] = callsTo('/api/verify-wallet-topup')[0]
    expect(url).toBe('/api/verify-wallet-topup')
    expect(init.headers.Authorization).toBe('Bearer tok-test')
    expect(JSON.parse(init.body)).toEqual({ reference: 'ch_topup_b1_abcdef123456' })

    expect(window.location.pathname).toBe('/dashboard/wallet')   // query string gone
    expect(walletRepository.getWallet).toHaveBeenCalledTimes(2)   // initial load + post-verify reload
    expect(host.textContent).toContain('Top-up received')
    expect(host.textContent).toContain('₦6,500')
  })

  it('a staff member hitting a return URL never triggers verification', async () => {
    await mount({ entries: ['/dashboard/wallet?reference=ch_topup_b1_abcdef123456'], role: 'Staff' })
    expect(callsTo('/api/verify-wallet-topup')).toHaveLength(0)
    expect(host.textContent).toContain('restricted to the business Owner')
  })
})
