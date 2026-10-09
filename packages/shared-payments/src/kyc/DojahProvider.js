import { ProviderError, ERROR_CODES as E } from '../errors.js'
import { createHttpClient } from '../http.js'

// Dojah (https://dojah.io) identity lookups for Nigeria: BVN, NIN and a selfie-vs-ID match.
//
// Auth: two headers, `AppId` and `Authorization: <secret key>` (the secret as-is, NOT "Bearer ..."). Production is
// https://api.dojah.io, the sandbox https://sandbox.dojah.io (sandbox BVN 22222222222 is the documented test number).
//
// PRIVACY: a BVN / NIN is sensitive personal data. It travels in a query string (GET) or JSON body (POST) and the HTTP
// layer never logs either. Provider messages are additionally scrubbed of any 11-digit run before they leave this
// class, and only the fields we actually need are returned - Dojah also sends a photo, phone numbers and date of birth,
// which are dropped here and never stored.
//
// VERIFIED vs ASSUMED: the BVN endpoint (/api/v1/kyc/bvn/full) and the headers are from Dojah's published reference.
// The NIN and selfie endpoints/field names below follow Dojah's documented shapes but could not be exercised from the
// build environment - run packages/shared-payments/scripts (or the sandbox) before enabling in production. Every field
// is read defensively and an unrecognised response is an error (INVALID_RESPONSE), never a guess.

const BASE_URLS = { live: 'https://api.dojah.io', sandbox: 'https://sandbox.dojah.io' }
const ID11 = /^\d{11}$/
const isId11 = (v) => typeof v === 'string' && ID11.test(v)
const SELFIE_MAX_BASE64 = 1_500_000 // ~1.1 MB decoded; the API rejects larger images before calling out

const invalid = (operation, message) => new ProviderError({ code: E.INVALID_REQUEST, message, operation })
const scrub = (text) => String(text ?? '').replace(/\d{11}/g, '***********')

function pick(obj, ...keys) {
  for (const k of keys) {
    const v = obj?.[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

export class DojahProvider {
  name = 'dojah'
  #http

  /**
   * @param {object} opts
   * @param {() => string} opts.getAppId
   * @param {() => string} opts.getSecretKey
   * @param {string} [opts.baseUrl]   defaults to production; pass the sandbox URL in test environments
   * @param {object} [opts.http]      http overrides (fetchImpl, sleep, now, logger, defaults)
   */
  constructor({ getAppId, getSecretKey, baseUrl = BASE_URLS.live, http = {} } = {}) {
    this.#http = createHttpClient({
      baseUrl,
      getAuthHeaders: () => {
        const appId = getAppId?.()
        const secret = getSecretKey?.()
        if (!appId || !secret) throw new ProviderError({ code: E.CONFIG, message: 'Dojah is not configured: DOJAH_APP_ID and DOJAH_SECRET_KEY are required' })
        return { AppId: appId, Authorization: secret }
      },
      secrets: [getSecretKey?.() || ''],
      ...http,
    })
  }

  async #call(operation, request) {
    try {
      return await this.#http.request({ operation, ...request })
    } catch (err) {
      if (err instanceof ProviderError) {
        throw new ProviderError({ ...err.toJSON(), message: scrub(err.message), cause: err })
      }
      throw err
    }
  }

  /** -> { firstName, middleName, lastName } for a BVN. Throws INVALID_REQUEST / NOT_FOUND for an unknown BVN. */
  async lookupBvn(bvn) {
    const op = 'lookupBvn'
    if (!isId11(bvn)) throw invalid(op, 'BVN must be 11 digits')
    const { data, correlationId } = await this.#call(op, { path: '/api/v1/kyc/bvn/full', query: { bvn } })
    const e = data?.entity
    const firstName = pick(e, 'first_name', 'firstName', 'firstname')
    const lastName = pick(e, 'last_name', 'lastName', 'surname')
    if (!firstName || !lastName) throw new ProviderError({ code: E.INVALID_RESPONSE, message: 'Identity provider returned no name for this BVN', operation: op, correlationId })
    return { firstName, middleName: pick(e, 'middle_name', 'middleName', 'middlename'), lastName, providerRef: correlationId }
  }

  /** -> { firstName, middleName, lastName } for a NIN. */
  async lookupNin(nin) {
    const op = 'lookupNin'
    if (!isId11(nin)) throw invalid(op, 'NIN must be 11 digits')
    const { data, correlationId } = await this.#call(op, { path: '/api/v1/kyc/nin', query: { nin } })
    const e = data?.entity
    const firstName = pick(e, 'first_name', 'firstname', 'firstName')
    const lastName = pick(e, 'last_name', 'surname', 'lastName')
    if (!firstName || !lastName) throw new ProviderError({ code: E.INVALID_RESPONSE, message: 'Identity provider returned no name for this NIN', operation: op, correlationId })
    return { firstName, middleName: pick(e, 'middle_name', 'middlename', 'middleName'), lastName, providerRef: correlationId }
  }

  /**
   * Compare a selfie with the photo held for an ID. -> { matched: boolean, confidence: number }
   * @param {{ idType: 'bvn'|'nin', idNumber: string, selfieImage: string }} p  selfieImage is base64 (no data: prefix)
   */
  async verifySelfie({ idType, idNumber, selfieImage }) {
    const op = 'verifySelfie'
    if (idType !== 'bvn' && idType !== 'nin') throw invalid(op, 'idType must be bvn or nin')
    if (!isId11(idNumber)) throw invalid(op, 'ID number must be 11 digits')
    if (typeof selfieImage !== 'string' || selfieImage.length < 100 || selfieImage.length > SELFIE_MAX_BASE64 || !/^[A-Za-z0-9+/=\s]+$/.test(selfieImage)) {
      throw invalid(op, 'selfieImage must be a base64 image under about 1 MB')
    }
    const { data, correlationId } = await this.#call(op, {
      method: 'POST',
      path: `/api/v1/kyc/${idType}/verify`,
      body: { [idType]: idNumber, selfie_image: selfieImage },
    })
    const s = data?.entity?.selfie_verification
    if (!s || typeof s.match !== 'boolean') throw new ProviderError({ code: E.INVALID_RESPONSE, message: 'Identity provider returned no selfie result', operation: op, correlationId, ambiguous: true })
    const confidence = Number(s.confidence_value)
    return { matched: s.match === true, confidence: Number.isFinite(confidence) ? confidence : 0, providerRef: correlationId }
  }
}

export { BASE_URLS as DOJAH_BASE_URLS }

/** The provider wired to the environment: DOJAH_APP_ID, DOJAH_SECRET_KEY, optional DOJAH_BASE_URL (sandbox URL in test). */
export function createDojahFromEnv(env = process.env, http = {}) {
  return new DojahProvider({
    getAppId: () => env.DOJAH_APP_ID,
    getSecretKey: () => env.DOJAH_SECRET_KEY,
    baseUrl: env.DOJAH_BASE_URL || BASE_URLS.live,
    http,
  })
}
