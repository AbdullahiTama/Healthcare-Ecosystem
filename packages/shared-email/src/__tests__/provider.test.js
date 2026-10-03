import { describe, it, expect } from 'vitest'
import { createEmailProvider } from '../provider.js'

const validMessage = {
  from: 'CareHub <notifications@carehub.ng>',
  to: 'owner@example.com',
  subject: 'CareHub: your account update',
  html: '<p>Hello</p>',
  replyTo: 'support@carehub.ng',
}

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  }
}

function providerWith(fetchImpl, extra = {}) {
  return createEmailProvider({ apiKey: 're_test_key', fetchImpl, timeoutMs: 50, ...extra })
}

describe('createEmailProvider', () => {
  it('requires an api key', () => {
    expect(() => createEmailProvider({})).toThrow(/apiKey/)
    expect(() => createEmailProvider({ apiKey: '  ' })).toThrow(/apiKey/)
  })

  it('rejects an invalid message without calling fetch', async () => {
    let called = false
    const p = providerWith(async () => { called = true })
    const res = await p.send({ ...validMessage, subject: '  ' })
    expect(res.success).toBe(false)
    expect(res.errorCode).toBe('validation_error')
    expect(res.retryable).toBe(false)
    expect(called).toBe(false)
  })

  it('succeeds on 200 with a message id', async () => {
    const p = providerWith(async () => jsonResponse(200, { id: 'msg_123' }))
    const res = await p.send(validMessage)
    expect(res).toMatchObject({ success: true, provider: 'resend', providerMessageId: 'msg_123', retryable: false, statusCode: 200, errorCode: null, errorMessage: null })
  })

  it('classifies 400 as invalid_request, non-retryable', async () => {
    const p = providerWith(async () => jsonResponse(400, { message: 'bad to address' }))
    const res = await p.send(validMessage)
    expect(res).toMatchObject({ success: false, statusCode: 400, errorCode: 'invalid_request', retryable: false })
  })

  it('classifies 401 as unauthorized, non-retryable', async () => {
    const p = providerWith(async () => jsonResponse(401, { message: 'bad key' }))
    const res = await p.send(validMessage)
    expect(res).toMatchObject({ success: false, statusCode: 401, errorCode: 'unauthorized', retryable: false })
  })

  it('classifies 403 as forbidden, non-retryable', async () => {
    const p = providerWith(async () => jsonResponse(403, { message: 'domain not verified' }))
    const res = await p.send(validMessage)
    expect(res).toMatchObject({ success: false, statusCode: 403, errorCode: 'forbidden', retryable: false })
  })

  it('classifies 409 as conflict, non-retryable', async () => {
    const p = providerWith(async () => jsonResponse(409, { message: 'conflict' }))
    const res = await p.send(validMessage)
    expect(res).toMatchObject({ success: false, statusCode: 409, errorCode: 'conflict', retryable: false })
  })

  it('classifies 429 as rate_limited, retryable, with retryAfterMs', async () => {
    const p = providerWith(async () => jsonResponse(429, { message: 'slow down' }, { 'retry-after': '2' }))
    const res = await p.send(validMessage)
    expect(res).toMatchObject({ success: false, statusCode: 429, errorCode: 'rate_limited', retryable: true, retryAfterMs: 2000 })
  })

  it('classifies 500 as provider_error, retryable', async () => {
    const p = providerWith(async () => jsonResponse(500, { message: 'boom' }))
    const res = await p.send(validMessage)
    expect(res).toMatchObject({ success: false, statusCode: 500, errorCode: 'provider_error', retryable: true })
  })

  it('detects timeout via AbortController', async () => {
    const p = providerWith((_url, opts) => new Promise((_res, rej) => {
      opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }))
    const res = await p.send(validMessage)
    expect(res).toMatchObject({ success: false, errorCode: 'timeout', retryable: true })
  })

  it('detects network failure', async () => {
    const p = providerWith(async () => { throw new TypeError('fetch failed') })
    const res = await p.send(validMessage)
    expect(res).toMatchObject({ success: false, errorCode: 'network_error', retryable: true })
  })

  it('flags malformed success responses', async () => {
    const p = providerWith(async () => jsonResponse(200, { unexpected: true }))
    const res = await p.send(validMessage)
    expect(res).toMatchObject({ success: false, errorCode: 'malformed_provider_response', retryable: false })
  })

  it('flags unparseable success bodies', async () => {
    const p = providerWith(async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new Error('bad json') } }))
    const res = await p.send(validMessage)
    expect(res).toMatchObject({ success: false, errorCode: 'malformed_provider_response' })
  })

  it('sends the idempotency key header and body fields', async () => {
    let seen
    const p = providerWith(async (_url, opts) => { seen = opts; return jsonResponse(200, { id: 'msg_1' }) })
    await p.send({ ...validMessage, idempotencyKey: 'evt_123' })
    expect(seen.headers['Idempotency-Key']).toBe('evt_123')
    const body = JSON.parse(seen.body)
    expect(body).toMatchObject({ from: validMessage.from, to: [validMessage.to], subject: validMessage.subject, html: validMessage.html, reply_to: validMessage.replyTo })
    // Two calls with the same key carry the same header (provider dedupes).
    await p.send({ ...validMessage, idempotencyKey: 'evt_123' })
    expect(seen.headers['Idempotency-Key']).toBe('evt_123')
  })

  it('never includes the api key in error messages', async () => {
    const p = providerWith(async () => jsonResponse(401, { message: 'bad key re_test_key' }))
    const res = await p.send(validMessage)
    expect(res.errorMessage).not.toContain('re_test_key')
  })
})
