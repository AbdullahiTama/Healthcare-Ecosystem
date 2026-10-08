import { createHttpClient } from '../http.js'
import { ProviderError } from '../errors.js'

const SECRET = 'sk_test_abcdefghijklmnop1234567890'

const reply = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  text: async () => (body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)),
})

function harness(responses, over = {}) {
  const calls = []
  const sleeps = []
  const logs = []
  let t = 1_000_000
  const queue = [...responses]
  const fetchImpl = vi.fn(async (url, init) => {
    calls.push({ url, init })
    const next = queue.shift()
    if (typeof next === 'function') return next(init)
    if (next instanceof Error) throw next
    return next
  })
  const client = createHttpClient({
    baseUrl: 'https://api.example.test',
    getAuthHeaders: () => ({ Authorization: `Bearer ${SECRET}` }),
    secrets: [SECRET],
    fetchImpl,
    sleep: async (ms) => { sleeps.push(ms); t += ms },
    random: () => 1,
    now: () => t,
    logger: { info: (m, f) => logs.push(['info', m, f]), warn: (m, f) => logs.push(['warn', m, f]), error: (m, f) => logs.push(['error', m, f]) },
    ...over,
  })
  return { client, calls, sleeps, logs, fetchImpl, advance: (ms) => { t += ms } }
}

describe('http client: success path', () => {
  it('sends auth, a correlation id and JSON, and returns the parsed body', async () => {
    const h = harness([reply(200, { status: true })])
    const out = await h.client.request({ operation: 'op', path: '/x', method: 'POST', body: { a: 1 }, correlationId: 'corr-1' })
    expect(out.data).toEqual({ status: true })
    expect(out.attempts).toBe(1)
    expect(h.calls[0].init.headers).toMatchObject({ Authorization: `Bearer ${SECRET}`, 'X-Correlation-Id': 'corr-1', 'Content-Type': 'application/json' })
    expect(h.calls[0].init.body).toBe('{"a":1}')
  })

  it('generates a correlation id when none is given and returns it', async () => {
    const h = harness([reply(200, { status: true })])
    const out = await h.client.request({ operation: 'op', path: '/x' })
    expect(out.correlationId).toMatch(/\S{8,}/)
    expect(h.calls[0].init.headers['X-Correlation-Id']).toBe(out.correlationId)
  })
})

describe('http client: timeouts', () => {
  const hang = (init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))

  it('aborts a hung request and reports a timeout', async () => {
    const h = harness([hang], { defaults: { timeoutMs: 20, maxAttempts: 1 } })
    const err = await h.client.request({ operation: 'op', path: '/x' }).catch((e) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect(err.code).toBe('timeout')
  })

  it('marks a timed-out WRITE as ambiguous and does not retry it', async () => {
    const h = harness([hang, reply(200, { status: true })], { defaults: { timeoutMs: 20 } })
    const err = await h.client.request({ operation: 'op', path: '/pay', method: 'POST', body: {} }).catch((e) => e)
    expect(err.code).toBe('timeout')
    expect(err.ambiguous).toBe(true)
    expect(h.fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('a timed-out READ is not ambiguous and is retried', async () => {
    const h = harness([hang, reply(200, { status: true })], { defaults: { timeoutMs: 20 } })
    const out = await h.client.request({ operation: 'op', path: '/x' })
    expect(out.attempts).toBe(2)
  })
})

describe('http client: retry policy', () => {
  it.each([500, 502, 503, 504])('retries a GET on %i and then succeeds, with backoff between attempts', async (status) => {
    const h = harness([reply(status, { message: 'boom' }), reply(200, { status: true })])
    const out = await h.client.request({ operation: 'op', path: '/x' })
    expect(out.attempts).toBe(2)
    expect(h.sleeps).toHaveLength(1)
    expect(h.sleeps[0]).toBeGreaterThan(0)
  })

  it('gives up on a GET after maxAttempts and reports a retryable, non-ambiguous error', async () => {
    const h = harness([reply(503, {}), reply(503, {}), reply(503, {}), reply(200, { status: true })])
    const err = await h.client.request({ operation: 'op', path: '/x' }).catch((e) => e)
    expect(err.code).toBe('provider_unavailable')
    expect(err.attempts).toBe(3)
    expect(err.retryable).toBe(true)
    expect(err.ambiguous).toBe(false)
    expect(h.fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('retries a GET after a dropped connection', async () => {
    const h = harness([new Error('socket hang up'), reply(200, { status: true })])
    expect((await h.client.request({ operation: 'op', path: '/x' })).attempts).toBe(2)
  })

  it.each([500, 503])('NEVER retries a POST on %i, and flags it ambiguous (the provider may have acted)', async (status) => {
    const h = harness([reply(status, {}), reply(200, { status: true })])
    const err = await h.client.request({ operation: 'op', path: '/pay', method: 'POST', body: {} }).catch((e) => e)
    expect(err.ambiguous).toBe(true)
    expect(err.retryable).toBe(false)
    expect(h.fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('NEVER retries a POST after a network error', async () => {
    const h = harness([new Error('ECONNRESET'), reply(200, { status: true })])
    const err = await h.client.request({ operation: 'op', path: '/pay', method: 'POST', body: {} }).catch((e) => e)
    expect(err.code).toBe('network')
    expect(err.ambiguous).toBe(true)
    expect(h.fetchImpl).toHaveBeenCalledTimes(1)
  })

  it.each([400, 401, 403, 404, 422])('does not retry a definitive %i', async (status) => {
    const h = harness([reply(status, { message: 'no' }), reply(200, { status: true })])
    await h.client.request({ operation: 'op', path: '/x' }).catch(() => {})
    expect(h.fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('noRetry disables retries even for reads', async () => {
    const h = harness([reply(503, {}), reply(200, { status: true })])
    await h.client.request({ operation: 'op', path: '/x', noRetry: true }).catch(() => {})
    expect(h.fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('stops retrying when the total time budget would be exceeded', async () => {
    const h = harness([reply(503, {}), reply(503, {}), reply(200, { status: true })], { defaults: { totalBudgetMs: 100, baseDelayMs: 500, maxDelayMs: 500 } })
    const err = await h.client.request({ operation: 'op', path: '/x' }).catch((e) => e)
    expect(err.code).toBe('provider_unavailable')
    expect(h.fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('http client: rate limiting', () => {
  it('retries a 429 even on a POST (it was not processed), honouring Retry-After in seconds', async () => {
    const h = harness([reply(429, { message: 'slow down' }, { 'retry-after': '2' }), reply(200, { status: true })])
    const out = await h.client.request({ operation: 'op', path: '/pay', method: 'POST', body: {} })
    expect(out.attempts).toBe(2)
    expect(h.sleeps).toEqual([2000])
  })

  it('caps an excessive Retry-After', async () => {
    const h = harness([reply(429, {}, { 'retry-after': '600' }), reply(200, { status: true })], { defaults: { maxRetryAfterMs: 3000 } })
    await h.client.request({ operation: 'op', path: '/x' })
    expect(h.sleeps).toEqual([3000])
  })

  it('reports rate_limited (retryable, not ambiguous) once attempts run out', async () => {
    const h = harness([reply(429, {}), reply(429, {}), reply(429, {})])
    const err = await h.client.request({ operation: 'op', path: '/pay', method: 'POST', body: {} }).catch((e) => e)
    expect(err.code).toBe('rate_limited')
    expect(err.retryable).toBe(true)
    expect(err.ambiguous).toBe(false)
    expect(h.fetchImpl).toHaveBeenCalledTimes(3)
  })
})

describe('http client: error mapping', () => {
  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [404, 'not_found'],
    [400, 'invalid_request'],
    [422, 'invalid_request'],
  ])('maps %i to %s', async (status, code) => {
    const h = harness([reply(status, { message: 'x' })])
    expect((await h.client.request({ operation: 'op', path: '/x' }).catch((e) => e)).code).toBe(code)
  })

  it('maps a "duplicate reference" 400 to duplicate_reference', async () => {
    const h = harness([reply(400, { message: 'Duplicate Transaction Reference' })])
    expect((await h.client.request({ operation: 'op', path: '/x', method: 'POST', body: {} }).catch((e) => e)).code).toBe('duplicate_reference')
  })

  it('treats an empty or non-JSON 200 as an invalid response (ambiguous for writes only)', async () => {
    const empty = harness([reply(200, undefined)])
    expect((await empty.client.request({ operation: 'op', path: '/x' }).catch((e) => e)).ambiguous).toBe(false)
    const junk = harness([reply(200, '<html>gateway</html>')])
    const err = await junk.client.request({ operation: 'op', path: '/pay', method: 'POST', body: {} }).catch((e) => e)
    expect(err.code).toBe('invalid_response')
    expect(err.ambiguous).toBe(true)
  })

  it('fails with a config error, before sending anything, when credentials cannot be produced', async () => {
    const h = harness([reply(200, {})], { getAuthHeaders: () => { throw new Error('no key') } })
    const err = await h.client.request({ operation: 'op', path: '/x' }).catch((e) => e)
    expect(err.code).toBe('config')
    expect(h.fetchImpl).not.toHaveBeenCalled()
  })
})

describe('http client: no secret leakage', () => {
  it('scrubs the secret from provider messages that echo it, in errors and in logs', async () => {
    const h = harness([reply(400, { message: `bad request, key ${SECRET} and Bearer ${SECRET}` })])
    const err = await h.client.request({ operation: 'op', path: '/x' }).catch((e) => e)
    const everything = JSON.stringify(err) + err.message + err.stack + JSON.stringify(h.logs)
    expect(everything).not.toContain(SECRET)
    expect(everything).not.toContain('abcdefghijklmnop')
  })

  it('never puts the Authorization header or the query string in a log line', async () => {
    const h = harness([reply(200, { status: true })])
    await h.client.request({ operation: 'resolve', path: '/bank/resolve', query: { account_number: '0123456789', bank_code: '058' } })
    const logged = JSON.stringify(h.logs)
    expect(logged).not.toContain('0123456789')
    expect(logged).not.toContain('Bearer')
    expect(logged).not.toContain(SECRET)
    expect(h.calls[0].url).toContain('account_number=0123456789') // but it IS sent to the provider
  })

  it('scrubs a secret out of a network error message', async () => {
    const h = harness([new Error(`connect failed for https://x?key=${SECRET}`)])
    const err = await h.client.request({ operation: 'op', path: '/x', noRetry: true }).catch((e) => e)
    expect(err.message).not.toContain(SECRET)
  })

  it('does not serialise the underlying cause', async () => {
    const h = harness([new Error('socket hang up')])
    const err = await h.client.request({ operation: 'op', path: '/x', noRetry: true }).catch((e) => e)
    expect(Object.keys(JSON.parse(JSON.stringify(err)))).not.toContain('cause')
  })
})

describe('http client: structured logging', () => {
  it('logs one line per attempt with operation, attempt, duration, status and correlation id', async () => {
    const h = harness([reply(503, {}), reply(200, { status: true })])
    await h.client.request({ operation: 'verifyPayment', path: '/transaction/verify/abc', correlationId: 'corr-9' })
    const attempts = h.logs.filter(([, m]) => m === 'provider.request')
    expect(attempts).toHaveLength(2)
    expect(attempts[0][2]).toMatchObject({ operation: 'verifyPayment', attempt: 1, status: 503, outcome: 'provider_unavailable', correlationId: 'corr-9' })
    expect(attempts[1][2]).toMatchObject({ attempt: 2, status: 200, outcome: 'ok' })
    expect(typeof attempts[1][2].durationMs).toBe('number')
  })
})
