import { describe, it, expect } from 'vitest'
import { createSettingsRepository, settingsRepository, BUSINESS_PROFILE_FIELDS } from './index.js'
import { createInMemoryClient } from '../../../test/inMemoryClient.js'

const A = 'biz-A'
const B = 'biz-B'

function seeded() {
  const client = createInMemoryClient({
    business_settings: [
      { id: 's1', business_id: A, currency: 'NGN', tax_rate: 7.5, receipt_footer: 'Thank you' },
      { id: 's9', business_id: B, currency: 'USD', tax_rate: 0, receipt_footer: 'Other tenant' },
    ],
  })
  return { client, repo: createSettingsRepository(client) }
}

// The upsert and the businesses PATCHes are about the request that goes out,
// so those assert the call rather than a resulting row.
function recording(returns = []) {
  const calls = []
  const repo = createSettingsRepository(async (path, options) => {
    calls.push({ path, method: options?.method, prefer: options?.prefer, body: options?.body ? JSON.parse(options.body) : null })
    return returns
  })
  return { calls, repo }
}

describe('settingsRepository', () => {
  describe('get', () => {
    it('returns the calling tenant settings row', async () => {
      const { repo } = seeded()
      expect(await repo.get(A)).toMatchObject({ id: 's1', currency: 'NGN' })
    })

    it('does not see another tenant settings', async () => {
      const { repo } = seeded()
      const row = await repo.get(A)
      expect(row.receipt_footer).not.toBe('Other tenant')
    })

    it('returns null when a business has no settings row yet', async () => {
      const { repo } = seeded()
      expect(await repo.get('biz-new')).toBeNull()
    })
  })

  describe('save', () => {
    it('upserts in one round-trip, resolving on the unique business_id', async () => {
      const { calls, repo } = recording()
      await repo.save(A, { currency: 'NGN', tax_rate: 5 })

      // The old implementation read first, then branched to PATCH or POST —
      // a race two first-time savers could both lose.
      expect(calls).toHaveLength(1)
      expect(calls[0].path).toBe('business_settings')
      expect(calls[0].method).toBe('POST')
      expect(calls[0].prefer).toContain('resolution=merge-duplicates')
    })

    it('stamps the tenant onto the row', async () => {
      const { calls, repo } = recording()
      await repo.save(A, { currency: 'NGN' })
      expect(calls[0].body).toEqual({ currency: 'NGN', business_id: A })
    })

    // Creation is assertable here; the *merge* half is not — resolving a
    // conflict on business_settings' UNIQUE (business_id) is the database's
    // job, and the in-memory adapter would only be emulating it. The prefer
    // header asserted above is what actually asks for it.
    it('creates the row for a business that has none', async () => {
      const { repo, client } = seeded()
      await repo.save('biz-new', { currency: 'GBP' })
      expect(client.rows('business_settings').find((r) => r.business_id === 'biz-new').currency).toBe('GBP')
    })
  })

  describe('saveBusinessProfile', () => {
    it('sends only the whitelisted profile fields', async () => {
      const { calls, repo } = recording()
      await repo.saveBusinessProfile(A, { name: 'Ada Pharmacy', phone: '0800', city: 'Lagos' })

      expect(calls[0].path).toBe(`businesses?id=eq.${A}`)
      expect(calls[0].method).toBe('PATCH')
      expect(calls[0].body).toEqual({ name: 'Ada Pharmacy', phone: '0800', city: 'Lagos' })
    })

    // The point of the whitelist: a field added to the form for display, or a
    // privileged column injected by a caller, never reaches the request. The
    // server-side guard (C18) is the actual security boundary — this keeps the
    // page honest.
    it('drops anything not on the whitelist, including privileged columns', async () => {
      const { calls, repo } = recording()
      await repo.saveBusinessProfile(A, {
        name: 'Ada Pharmacy',
        is_platform_admin: true,
        status: 'approved',
        plan: 'enterprise',
        plan_expires_at: '2099-01-01',
        parent_business_id: 'someone-else',
        referring_agent_id: 'me',
        somethingTheFormAddedLater: 'oops',
      })

      expect(calls[0].body).toEqual({ name: 'Ada Pharmacy' })
      for (const forbidden of ['is_platform_admin', 'status', 'plan', 'plan_expires_at', 'parent_business_id', 'referring_agent_id']) {
        expect(calls[0].body).not.toHaveProperty(forbidden)
      }
    })

    it('omits absent fields rather than nulling them', async () => {
      const { calls, repo } = recording()
      await repo.saveBusinessProfile(A, { name: 'Ada Pharmacy' })
      expect(Object.keys(calls[0].body)).toEqual(['name'])
    })

    it('preserves a deliberate false, which is a real value for visible_on_carefind', async () => {
      const { calls, repo } = recording()
      await repo.saveBusinessProfile(A, { visible_on_carefind: false })
      expect(calls[0].body).toEqual({ visible_on_carefind: false })
    })

    it('whitelist covers every field the Settings form builds', () => {
      // Mirrors the bizForm built in Settings.jsx load().
      for (const k of ['name', 'phone', 'whatsapp', 'address', 'state', 'city', 'hours', 'website', 'logo_url', 'cover_url', 'description', 'visible_on_carefind']) {
        expect(BUSINESS_PROFILE_FIELDS).toContain(k)
      }
    })
  })

  describe('saveBookingConfig', () => {
      it('writes the booking columns and coerces enabled to a boolean', async () => {
        const { calls, repo } = recording()
        await repo.saveBookingConfig(A, { enabled: 'yes', type: 'online', slots: ['09:00', '10:00'], onlineFee: 5000, physicalFee: 3000 })
        expect(calls[0].path).toBe(`businesses?id=eq.${A}`)
        expect(calls[0].body).toEqual({
          booking_enabled: true,
          booking_type: 'online',
          booking_slots: ['09:00', '10:00'],
          online_consultation_fee: 5000,
          physical_consultation_fee: 3000,
        })
      })

      it('stores NULL when a fee is omitted (free appointment type)', async () => {
        const { calls, repo } = recording()
        await repo.saveBookingConfig(A, { enabled: true, type: 'both', slots: ['09:00'], onlineFee: 5000, physicalFee: null })
        expect(calls[0].body.online_consultation_fee).toBe(5000)
        expect(calls[0].body.physical_consultation_fee).toBeNull()
      })

      it('turns booking off without touching anything else', async () => {
        const { calls, repo } = recording()
        await repo.saveBookingConfig(A, { enabled: false, type: 'physical', slots: [], onlineFee: null, physicalFee: null })
        expect(calls[0].body.booking_enabled).toBe(false)
        expect(calls[0].body.online_consultation_fee).toBeNull()
        expect(calls[0].body.physical_consultation_fee).toBeNull()
      })
    })

  it('exports a default settingsRepository instance', () => {
    for (const m of ['get', 'save', 'saveBusinessProfile', 'saveBookingConfig']) {
      expect(typeof settingsRepository[m]).toBe('function')
    }
  })
})
