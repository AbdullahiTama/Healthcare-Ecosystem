import { describe, it, expect, vi } from 'vitest'
import { DojahProvider } from '../kyc/DojahProvider.js'
import { isProviderError } from '../errors.js'

const reply = (status, body) => ({ ok: status < 400, status, headers: { get: () => null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) })
const make = (fetchImpl, over = {}) => new DojahProvider({
  getAppId: () => 'app-123', getSecretKey: () => 'secret-key-abcdef', baseUrl: 'https://sandbox.dojah.io',
  http: { fetchImpl, sleep: async () => {}, ...over },
})
const SELFIE = 'A'.repeat(400)

describe('DojahProvider auth and routing', () => {
  it('sends AppId + the raw secret (no Bearer) to the BVN endpoint with the BVN in the query', async () => {
    const f = vi.fn(async () => reply(200, { entity: { first_name: 'ADA', last_name: 'OBI', middle_name: 'CHINYERE', image: 'BIGBASE64', phone_number1: '0801' } }))
    const r = await make(f).lookupBvn('22222222222')
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://sandbox.dojah.io/api/v1/kyc/bvn/full?bvn=22222222222')
    expect(init.headers.AppId).toBe('app-123')
    expect(init.headers.Authorization).toBe('secret-key-abcdef')
    expect(init.method).toBe('GET')
    // only the fields we need come back; photo / phone / dob are dropped
    expect(Object.keys(r).sort()).toEqual(['firstName', 'lastName', 'middleName', 'providerRef'])
    expect(r).toMatchObject({ firstName: 'ADA', lastName: 'OBI', middleName: 'CHINYERE' })
  })

  it('reads NIN names under either field naming', async () => {
    const a = make(async () => reply(200, { entity: { firstname: 'ADA', surname: 'OBI', middlename: 'C' } }))
    expect(await a.lookupNin('11111111111')).toMatchObject({ firstName: 'ADA', lastName: 'OBI', middleName: 'C' })
    const b = make(async () => reply(200, { entity: { first_name: 'ADA', last_name: 'OBI' } }))
    expect(await b.lookupNin('11111111111')).toMatchObject({ firstName: 'ADA', lastName: 'OBI', middleName: '' })
  })

  it('rejects malformed IDs locally without calling out', async () => {
    const f = vi.fn()
    const p = make(f)
    for (const bad of ['123', 'abcdefghijk', '123456789012', 12345678901]) {
      await expect(p.lookupBvn(bad)).rejects.toMatchObject({ code: 'invalid_request' })
      await expect(p.lookupNin(bad)).rejects.toMatchObject({ code: 'invalid_request' })
    }
    expect(f).not.toHaveBeenCalled()
  })

  it('fails closed with no credentials, without touching the network', async () => {
    const f = vi.fn()
    const p = new DojahProvider({ getAppId: () => '', getSecretKey: () => '', http: { fetchImpl: f } })
    await expect(p.lookupBvn('22222222222')).rejects.toMatchObject({ code: 'config' })
    expect(f).not.toHaveBeenCalled()
  })

  it('an unknown ID is not_found / invalid_request; an unrecognised success body is invalid_response, never a guess', async () => {
    await expect(make(async () => reply(404, { error: 'not found' })).lookupBvn('22222222222')).rejects.toMatchObject({ code: 'not_found' })
    await expect(make(async () => reply(400, { error: 'Invalid BVN' })).lookupBvn('22222222222')).rejects.toMatchObject({ code: 'invalid_request' })
    await expect(make(async () => reply(200, { entity: {} })).lookupBvn('22222222222')).rejects.toMatchObject({ code: 'invalid_response' })
    await expect(make(async () => reply(200, { nothing: true })).lookupNin('11111111111')).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('never lets an 11-digit number or the secret out in an error message', async () => {
    const p = make(async () => reply(400, { message: 'BVN 22222222222 is not valid for secret-key-abcdef' }))
    const err = await p.lookupBvn('22222222222').catch((e) => e)
    expect(isProviderError(err)).toBe(true)
    expect(err.message).not.toMatch(/\d{11}/)
    expect(err.message).not.toContain('secret-key-abcdef')
    expect(JSON.stringify(err)).not.toMatch(/\d{11}/)
  })

  it('does not log the BVN (query string) through the injected logger', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    await make(async () => reply(200, { entity: { first_name: 'A', last_name: 'B' } }), { logger }).lookupBvn('22222222222')
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('22222222222')
  })
})

describe('verifySelfie', () => {
  it('posts the ID and image and returns match + confidence', async () => {
    const f = vi.fn(async () => reply(200, { entity: { selfie_verification: { match: true, confidence_value: 97.5 } } }))
    const r = await make(f).verifySelfie({ idType: 'bvn', idNumber: '22222222222', selfieImage: SELFIE })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://sandbox.dojah.io/api/v1/kyc/bvn/verify')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ bvn: '22222222222', selfie_image: SELFIE })
    expect(r).toMatchObject({ matched: true, confidence: 97.5 })
  })
  it('reports a non-match, and treats an unreadable result as ambiguous rather than a match', async () => {
    expect((await make(async () => reply(200, { entity: { selfie_verification: { match: false, confidence_value: 12 } } })).verifySelfie({ idType: 'nin', idNumber: '11111111111', selfieImage: SELFIE })).matched).toBe(false)
    await expect(make(async () => reply(200, { entity: {} })).verifySelfie({ idType: 'nin', idNumber: '11111111111', selfieImage: SELFIE })).rejects.toMatchObject({ code: 'invalid_response', ambiguous: true })
  })
  it('validates the image and id type before calling out', async () => {
    const f = vi.fn()
    const p = make(f)
    await expect(p.verifySelfie({ idType: 'passport', idNumber: '22222222222', selfieImage: SELFIE })).rejects.toMatchObject({ code: 'invalid_request' })
    await expect(p.verifySelfie({ idType: 'bvn', idNumber: '22222222222', selfieImage: 'short' })).rejects.toMatchObject({ code: 'invalid_request' })
    await expect(p.verifySelfie({ idType: 'bvn', idNumber: '22222222222', selfieImage: '<script>'.repeat(30) })).rejects.toMatchObject({ code: 'invalid_request' })
    await expect(p.verifySelfie({ idType: 'bvn', idNumber: '22222222222', selfieImage: 'A'.repeat(2_000_000) })).rejects.toMatchObject({ code: 'invalid_request' })
    expect(f).not.toHaveBeenCalled()
  })
})
