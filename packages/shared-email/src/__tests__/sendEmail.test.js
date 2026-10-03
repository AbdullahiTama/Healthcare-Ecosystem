import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendEmail } from '../sendEmail.js'

// The wrapper is the only place a provider error is classified, and the
// processor's whole retry policy hangs off those flags. A 5xx that is treated as
// permanent silently drops a customer's email; a 422 that is treated as
// retryable spins the queue forever. Both directions are pinned here.
function response({ status, body = {}, headers = {} }) {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (map.has(k.toLowerCase()) ? map.get(k.toLowerCase()) : null) },
    json: async () => body,
  }
}

let fetchMock
let env
let logs

beforeEach(() => {
  env = { ...process.env }
  process.env.RESEND_API_KEY = 're_test_key'
  process.env.EMAIL_FROM = 'CareHub <support@mail.carefindhub.com>'
  logs = []
  vi.spyOn(console, 'error').mockImplementation((...a) => { logs.push(a.map(String).join(' ')) })
  vi.spyOn(console, 'warn').mockImplementation((...a) => { logs.push(a.map(String).join(' ')) })
  fetchMock = vi.fn()
  globalThis.fetch = fetchMock
})

afterEach(() => {
  vi.restoreAllMocks()
  process.env = env
})

const args = {
  to: 'customer@example.com',
  subject: 'CareHub: test',
  html: '<p>hi</p>',
}

describe('sendEmail success', () => {
  it('returns the provider payload and the status code on 2xx', async () => {
    fetchMock.mockResolvedValueOnce(response({ status: 200, body: { id: 'resend-1' } }))
    const result = await sendEmail(args)

    expect(result).toMatchObject({ success: true, statusCode: 200 })
    expect(result.data).toEqual({ id: 'resend-1' })
  })
})

describe('sendEmail failure classification', () => {
  it('marks 429 retryable and reads Retry-After in seconds', async () => {
    fetchMock.mockResolvedValueOnce(response({ status: 429, body: { message: 'Too many requests' }, headers: { 'retry-after': '120' } }))
    const result = await sendEmail(args)

    expect(result).toMatchObject({ success: false, statusCode: 429, retryable: true, retryAfterMs: 120_000 })
  })

  it('accepts an HTTP-date Retry-After', async () => {
    const at = new Date(Date.now() + 60000).toUTCString()
    fetchMock.mockResolvedValueOnce(response({ status: 429, body: {}, headers: { 'Retry-After': at } }))
    const result = await sendEmail(args)

    expect(result.retryAfterMs).toBeGreaterThan(50_000)
    expect(result.retryAfterMs).toBeLessThanOrEqual(60_000)
  })

  it('ignores an unparseable Retry-After instead of scheduling at zero', async () => {
    fetchMock.mockResolvedValueOnce(response({ status: 429, body: {}, headers: { 'retry-after': 'soon' } }))
    const result = await sendEmail(args)

    expect(result.retryable).toBe(true)
    expect(result.retryAfterMs).toBeUndefined()
  })

  it('marks 5xx retryable', async () => {
    for (const status of [500, 502, 503]) {
      fetchMock.mockResolvedValueOnce(response({ status, body: { message: 'upstream' } }))
      const result = await sendEmail(args)
      expect(result).toMatchObject({ retryable: true, statusCode: status })
    }
  })

  it('marks 4xx permanent, because retrying a rejected address cannot help', async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      fetchMock.mockResolvedValueOnce(response({ status, body: { message: 'rejected' } }))
      const result = await sendEmail(args)
      expect(result).toMatchObject({ retryable: false, statusCode: status })
      expect(result.retryAfterMs).toBeUndefined()
    }
  })

  it('marks a transport failure retryable', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    const result = await sendEmail(args)

    expect(result).toMatchObject({ success: false, retryable: true })
  })

  it('marks an abort as a retryable timeout', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
    const result = await sendEmail(args)

    expect(result).toMatchObject({ retryable: true, timeout: true })
  })
})

describe('sendEmail configuration and logging', () => {
  it('fails closed without an API key and never retries the row', async () => {
    delete process.env.RESEND_API_KEY
    const result = await sendEmail(args)

    expect(result).toMatchObject({ success: false, retryable: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed without a sender', async () => {
    delete process.env.EMAIL_FROM
    delete process.env.RESEND_FROM_EMAIL
    const result = await sendEmail(args)

    expect(result).toMatchObject({ success: false, retryable: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the API key and the recipient address out of the logs', async () => {
    fetchMock.mockResolvedValueOnce(response({
      status: 422,
      // Resend can echo request content in an error body. It must not reach a
      // log line, where it would be readable by anyone with log access.
      body: { message: 'Validation error', customer: 'customer@example.com', token: 're_secret' },
    }))
    await sendEmail(args)

    const joined = logs.join('\n')
    expect(joined).toContain('422')
    expect(joined).not.toContain('re_test_key')
    expect(joined).not.toContain('re_secret')
    expect(joined).not.toContain('customer@example.com')
  })

  it('reports a missing key without logging the recipient address', async () => {
    delete process.env.RESEND_API_KEY
    await sendEmail(args)

    const joined = logs.join('\n')
    expect(joined).toContain('resend_not_configured')
    expect(joined).not.toContain('customer@example.com')
  })
})
