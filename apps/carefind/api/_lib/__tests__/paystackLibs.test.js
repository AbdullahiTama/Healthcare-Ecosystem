// The CareFind-side Paystack helpers still used by the withdrawal path (recipient, transfer, verify, resolve, balance) and the key guard.
import { getPaystackSecretKey, paystackHeaders, paystackFetch } from '../paystack.js'
import { createTransferRecipient, initiateTransfer, verifyTransfer, resolveAccount, normalizeAccountName, checkBalance, transferReference } from '../paystackTransfer.js'

const KEY = 'sk_test_abcdefghijklmnop'
let fetchMock
const reply = (body, { ok = true, status = 200, raw } = {}) => ({ ok, status, text: async () => (raw !== undefined ? raw : JSON.stringify(body)) })

beforeEach(() => {
  process.env.PAYSTACK_SECRET_KEY = KEY
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals(); delete process.env.PAYSTACK_SECRET_KEY })

describe('the secret key guard', () => {
  it('accepts a secret key and builds the auth header from it', () => {
    expect(getPaystackSecretKey()).toBe(KEY)
    expect(paystackHeaders({ 'X-Extra': '1' })).toEqual({ Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'X-Extra': '1' })
  })
  it('refuses a missing key and a PUBLISHABLE key with a message that names the mistake (and never prints the key)', () => {
    delete process.env.PAYSTACK_SECRET_KEY
    expect(() => getPaystackSecretKey()).toThrow(/PAYSTACK_SECRET_KEY is missing/)
    process.env.PAYSTACK_SECRET_KEY = 'pk_live_supersecretpublishablekey'
    let message = ''
    try { getPaystackSecretKey() } catch (e) { message = e.message }
    expect(message).toMatch(/publishable key/)
    expect(message).not.toContain('supersecretpublishablekey')
  })
})

describe('paystackFetch', () => {
  it('calls the API with the bearer header and parses JSON', async () => {
    fetchMock.mockResolvedValue(reply({ status: true, data: 1 }))
    expect(await paystackFetch('/balance')).toEqual({ status: true, data: 1 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.paystack.co/balance')
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`)
  })
  it('an empty reply and an invalid-JSON reply are errors (never a guess)', async () => {
    fetchMock.mockResolvedValueOnce(reply(null, { raw: '', status: 502 }))
    await expect(paystackFetch('/x')).rejects.toThrow(/empty response \(HTTP 502\)/)
    fetchMock.mockResolvedValueOnce(reply(null, { raw: '<html>bad gateway</html>' }))
    await expect(paystackFetch('/x')).rejects.toThrow(/invalid JSON/)
  })
})

describe('transfers', () => {
  it('creates a recipient from the bank details and returns its code; an answer of "no" is an error with Paystack\'s message', async () => {
    fetchMock.mockResolvedValueOnce(reply({ status: true, data: { recipient_code: 'RCP_1' } }))
    expect(await createTransferRecipient({ bankCode: '058', accountNumber: '0123456789', accountName: 'Ada Obi', userId: 'u1' })).toBe('RCP_1')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ type: 'nuban', account_number: '0123456789', bank_code: '058', currency: 'NGN', metadata: { user_id: 'u1' } })
    fetchMock.mockResolvedValueOnce(reply({ status: false, message: 'Account number is invalid' }))
    await expect(createTransferRecipient({ bankCode: '1', accountNumber: '1', accountName: 'x', userId: 'u' })).rejects.toThrow('Account number is invalid')
  })

  it('initiates a transfer with the exact amount and reference; a refusal is marked paystackRejected (an ambiguous failure is NOT)', async () => {
    fetchMock.mockResolvedValueOnce(reply({ status: true, data: { transfer_code: 'TRF_1', reference: 'cf_wd_ref' } }))
    expect(await initiateTransfer({ recipientCode: 'RCP_1', amountKobo: 160000, reference: 'cf_wd_ref' })).toEqual({ transferCode: 'TRF_1', reference: 'cf_wd_ref' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ source: 'balance', amount: 160000, recipient: 'RCP_1', reason: 'CareFind withdrawal', reference: 'cf_wd_ref' })
    fetchMock.mockResolvedValueOnce(reply({ status: false, message: 'Insufficient balance' }))
    const refused = await initiateTransfer({ recipientCode: 'R', amountKobo: 1, reference: 'r' }).catch((e) => e)
    expect(refused.paystackRejected).toBe(true)
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'))
    const ambiguous = await initiateTransfer({ recipientCode: 'R', amountKobo: 1, reference: 'r' }).catch((e) => e)
    expect(ambiguous.paystackRejected).toBeUndefined()
  })

  it('verifies a transfer by code (url-encoded) and reports the status', async () => {
    fetchMock.mockResolvedValueOnce(reply({ status: true, data: { status: 'success', recipient: { code: 'RCP_1' } } }))
    expect(await verifyTransfer('TRF/1')).toEqual({ status: 'success', recipientCode: 'RCP_1' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.paystack.co/transfer/verify/TRF%2F1')
    fetchMock.mockResolvedValueOnce(reply({ status: false, message: 'not found' }))
    await expect(verifyTransfer('x')).rejects.toThrow('not found')
  })
})

describe('account resolution and balance', () => {
  it('resolves the holder name (query values are encoded) and carries Paystack\'s message on a refusal', async () => {
    fetchMock.mockResolvedValueOnce(reply({ status: true, data: { account_name: 'ADA OBI', account_number: '0123456789' } }))
    expect(await resolveAccount({ bankCode: '058', accountNumber: '0123456789' })).toEqual({ accountName: 'ADA OBI', accountNumber: '0123456789' })
    fetchMock.mockResolvedValueOnce(reply({ status: false, message: 'Could not resolve account name' }))
    const err = await resolveAccount({ bankCode: '058&x=1', accountNumber: '1' }).catch((e) => e)
    expect(err.paystackMessage).toBe('Could not resolve account name')
    expect(fetchMock.mock.calls[1][0]).toContain('bank_code=058%26x%3D1')
  })

  it('counts ONLY the naira balance (a dollar balance is not payable naira)', async () => {
    fetchMock.mockResolvedValueOnce(reply({ status: true, data: [{ currency: 'NGN', available_balance: 5000000 }, { currency: 'USD', available_balance: 99999999 }, { available_balance: 100 }] }))
    expect(await checkBalance()).toBe(5000100)
    fetchMock.mockResolvedValueOnce(reply({ status: false }))
    await expect(checkBalance()).rejects.toThrow(/Could not check balance/)
  })

  it('normalises account names for comparison and builds unique, Paystack-valid transfer references', () => {
    expect(normalizeAccountName('  ADA   Obi ')).toBe('ada obi')
    expect(normalizeAccountName(null)).toBe('')
    const a = transferReference('12345678-aaaa'); const b = transferReference('12345678-aaaa')
    expect(a).not.toBe(b)
    expect(a).toMatch(/^cf_wd_12345678_[0-9a-f]{12}$/)
    expect(a.length).toBeGreaterThanOrEqual(16); expect(a.length).toBeLessThanOrEqual(50)
  })
})
