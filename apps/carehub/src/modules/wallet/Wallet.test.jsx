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
const mount = async ({ entries = ['/dashboard/wallet'], role = 'Owner', perms } = {}) => {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={entries}>
        <Wallet brand={{ id: 'b1' }} role={role} perms={perms} />
      </MemoryRouter>
    )
  })
  await act(async () => {}) // let the verify/load promise chains settle
}
const callsTo = (path) => fetchMock.mock.calls.filter(([u]) => String(u).includes(path))
// The dialog asks the server for the fee rate ({ quote: true }, creates nothing); a real initiation is any other call.
const isQuote = ([, init]) => String(init?.body || '').includes('"quote"')
const initiations = () => callsTo('/api/initiate-wallet-topup').filter((c) => !isQuote(c))

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
    expect(initiations()).toHaveLength(0)
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

    const [url, init] = initiations()[0]
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
    expect(host.textContent).toContain('Deposit received')
    expect(host.textContent).toContain('₦6,500')
  })

  it('a staff member hitting a return URL never triggers verification', async () => {
    await mount({ entries: ['/dashboard/wallet?reference=ch_topup_b1_abcdef123456'], role: 'Staff' })
    expect(callsTo('/api/verify-wallet-topup')).toHaveLength(0)
    expect(host.textContent).toContain('restricted to the business Owner')
  })
})

describe('Wallet withdraw: a dead OTP is cleared on otp_superseded', () => {
  const typeEl = async (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  const waitForEl = async (sel) => {
    for (let i = 0; i < 40 && !host.querySelector(sel); i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    }
    return host.querySelector(sel)
  }

  it('clears the typed code, surfaces the server text, and drops the resume countdown', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/api/banks')) return reply(200, [{ code: '058', name: 'GTBank' }])
      if (String(url).includes('/api/payout-accounts/list')) return reply(200, { accounts: [], required: false, kycEnabled: false })
      if (String(url).includes('/api/withdrawal-pin/draft')) return reply(200, { draft: null })
      if (String(url).includes('/api/withdrawal-pin/otp')) return reply(200, { ok: true, expiresInSeconds: 300 })
      if (String(url).includes('/api/resolve-account')) return reply(200, { accountName: 'TEST USER' })
      if (String(url).includes('/api/initiate-business-withdrawal')) return reply(400, { code: 'otp_superseded', error: 'A newer code was issued. Please use the code in the latest email.' })
      return reply(404, {})
    })
    await mount()
    sessionStorage.clear()
    await click('Withdraw')
    await waitForEl('input[role="combobox"]')

    await typeEl(host.querySelector('input[placeholder="e.g. 5000"]'), '5000')

    await typeEl(host.querySelector('input[role="combobox"]'), 'GTB')
    const option = [...host.querySelectorAll('[role="option"]')].find((o) => o.textContent.includes('GTBank'))
    expect(option).toBeTruthy()
    await act(async () => { option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })) })

    await type('account-number', '0123456789')
    await act(async () => { await new Promise((r) => setTimeout(r, 900)) }) // debounced bank resolve

    await type('withdrawal-pin', '1234')
    await click('Email me a 6-digit code')
    await type('otp-withdrawal', '123456')

    const submit = [...host.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Withdraw').at(-1)
    expect(submit.disabled).toBe(false)
    await act(async () => { submit.click() })
    await act(async () => {})

    expect(host.querySelector('#otp-withdrawal').value).toBe('')
    expect(host.textContent).toContain('A newer code was issued')
    expect(sessionStorage.getItem('ch-withdrawal-otp-meta')).toBeNull()
  })
})
describe('Wallet top-up: the processing fee is shown before checkout (the server decides the charge)', () => {
  const withRate = (rate) => async (url) => {
    if (String(url).includes('/api/banks')) return reply(200, [])
    if (String(url).includes('/api/initiate-wallet-topup')) return reply(200, { fee_rate: rate })
    return reply(404, {})
  }

  it('asks the server for the rate when the dialog opens and shows what the wallet receives, the fee and the total', async () => {
    fetchMock.mockImplementation(withRate(0.1))
    await mount()
    await click('Top Up')
    await act(async () => {})
    const quotes = callsTo('/api/initiate-wallet-topup').filter(isQuote)
    expect(quotes).toHaveLength(1)
    expect(JSON.parse(quotes[0][1].body)).toEqual({ quote: true })
    expect(quotes[0][1].headers.Authorization).toBe('Bearer tok-test')

    await type('topup-amount', '10000')
    const box = host.querySelector('[role="status"]')
    expect(box.textContent).toMatch(/Wallet receives:\s*₦10,000/)
    expect(box.textContent).toMatch(/Processing fee \(10%\):\s*₦1,000/)
    expect(box.textContent).toMatch(/You pay:\s*₦11,000/)
    expect(initiations()).toHaveLength(0) // a quote never starts a payment
  })

  it('a changed rate is shown as the server reports it', async () => {
    fetchMock.mockImplementation(withRate(0.025))
    await mount()
    await click('Top Up')
    await act(async () => {})
    await type('topup-amount', '4000')
    const box = host.querySelector('[role="status"]')
    expect(box.textContent).toMatch(/Processing fee \(2.5%\):\s*₦100/)
    expect(box.textContent).toMatch(/You pay:\s*₦4,100/)
  })

  it('no fee line when the rate is 0 or the quote could not be read (checkout still shows the exact total)', async () => {
    fetchMock.mockImplementation(withRate(0))
    await mount()
    await click('Top Up')
    await act(async () => {})
    await type('topup-amount', '4000')
    expect(host.querySelector('[role="status"]')).toBeNull()
  })
})

describe('a custom role granted the Wallet module sees it read-only', () => {
  it('shows balances and history, and hides every money-moving control', async () => {
    await mount({ role: 'Medical sales rep', perms: { nav: ['wallet', 'inventory'] } })
    expect(host.textContent).toContain('₦5,000')                    // the balance is readable
    expect(host.textContent).toMatch(/View only/)
    expect(button('Withdraw')).toBeUndefined()
    expect(button('Top Up')).toBeUndefined()
    expect(host.textContent).not.toContain('restricted to the business Owner')
  })

  it('still never triggers a top-up verification from a return URL', async () => {
    await mount({ entries: ['/dashboard/wallet?reference=ch_topup_b1_abcdef123456'], role: 'Medical sales rep', perms: { nav: ['wallet'] } })
    expect(callsTo('/api/verify-wallet-topup')).toHaveLength(0)
    expect(host.textContent).toMatch(/View only/)
  })

  it('a role without the grant still gets the restricted screen', async () => {
    await mount({ role: 'Staff', perms: { nav: ['inventory'] } })
    expect(host.textContent).toContain('restricted to the business Owner')
    expect(button('Withdraw')).toBeUndefined()
    expect(button('Top Up')).toBeUndefined()
  })
})
