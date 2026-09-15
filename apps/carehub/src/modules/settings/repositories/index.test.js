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
          consultation_medium: null,
          consultation_medium_link: null,
        })
      })

      it('writes the consultation medium default (ADR-005)', async () => {
        const { calls, repo } = recording()
        await repo.saveBookingConfig(A, { enabled: true, type: 'online', slots: ['09:00'], onlineFee: 5000, physicalFee: null, consultationMedium: 'zoom', consultationMediumLink: 'https://zoom.us/j/123' })
        expect(calls[0].body.consultation_medium).toBe('zoom')
        expect(calls[0].body.consultation_medium_link).toBe('https://zoom.us/j/123')
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

  describe('services', () => {
    function serviceSeeded() {
      const client = createInMemoryClient({
        business_services: [
          { id: 'svc1', business_id: A, name: 'Consultation', price_kobo: 50000, is_active: true, duration_minutes: 30 },
          { id: 'svc2', business_id: A, name: 'Old Service', price_kobo: 20000, is_active: false, duration_minutes: 15 },
          { id: 'svc9', business_id: B, name: 'Other tenant svc', price_kobo: 30000, is_active: true },
        ],
        service_availability: [
          { id: 'av1', business_id: A, service_id: 'svc1', date: '2026-12-01', time: '09:00', is_booked: false, status: 'available' },
          { id: 'av2', business_id: A, service_id: 'svc1', date: '2026-12-01', time: '10:00', is_booked: true, status: 'booked', appointment_id: 'apt1' },
        ],
      })
      return { client, repo: createSettingsRepository(client) }
    }

    it('getServices returns only calling tenant', async () => {
      const { repo } = serviceSeeded()
      const rows = await repo.getServices(A)
      expect(rows.map(r => r.id).sort()).toEqual(['svc1', 'svc2'])
    })

    it('getActiveServices filters to active only', async () => {
      const { repo } = serviceSeeded()
      const rows = await repo.getActiveServices(A)
      expect(rows.map(r => r.id)).toEqual(['svc1'])
    })

    it('createService validates name required', async () => {
      const { repo } = serviceSeeded()
      await expect(repo.createService(A, { name: '', price_kobo: 10000 })).rejects.toThrow('Service name is required')
      await expect(repo.createService(A, { name: '   ', price_kobo: 10000 })).rejects.toThrow('Service name is required')
    })

    it('createService validates price non-negative', async () => {
      const { repo } = serviceSeeded()
      await expect(repo.createService(A, { name: 'Test', price_kobo: -100 })).rejects.toThrow('Price must be')
    })

    it('createService validates duration positive', async () => {
      const { repo } = serviceSeeded()
      await expect(repo.createService(A, { name: 'Test', duration_minutes: 0 })).rejects.toThrow('Duration')
    })

    it('createService stamps business_id', async () => {
      const { calls, repo } = recording()
      await repo.createService(A, { name: 'New', price_kobo: 10000 })
      expect(calls[0].body).toEqual(expect.objectContaining({ name: 'New', business_id: A }))
    })

    it('deleteService soft-deactivates (PATCH is_active false, not DELETE)', async () => {
      const { calls, repo } = recording()
      await repo.deleteService('svc1', A)
      expect(calls[0].method).toBe('PATCH')
      expect(calls[0].body).toEqual({ is_active: false })
      expect(calls[0].path).toContain('business_services')
    })

    it('saveAvailability rejects past dates', async () => {
      const { repo } = serviceSeeded()
      const past = new Date()
      past.setDate(past.getDate() - 1)
      const pastStr = past.toISOString().split('T')[0]
      await expect(repo.saveAvailability(A, [{ service_id: 'svc1', date: pastStr, time: '09:00' }])).rejects.toThrow('past')
    })

    it('saveAvailability rejects end before start', async () => {
      const { repo } = serviceSeeded()
      const future = '2026-12-10'
      await expect(repo.saveAvailability(A, [{ service_id: 'svc1', date: future, start_time: '10:00', end_time: '09:00', time: '10:00' }])).rejects.toThrow('End time must be after start time')
    })

    it('saveAvailability rejects duplicate in payload', async () => {
      const { repo } = serviceSeeded()
      const future = '2026-12-10'
      await expect(repo.saveAvailability(A, [
        { service_id: 'svc1', date: future, time: '09:00' },
        { service_id: 'svc1', date: future, time: '09:00' },
      ])).rejects.toThrow('Duplicate')
    })

    it('getAvailableSlots filters to available not booked and date >= today', async () => {
      const { repo } = serviceSeeded()
      const rows = await repo.getAvailableSlots(A, 'svc1')
      // av1 is available, av2 is booked; only av1 should return (if date >= today)
      // 2026-12-01 is future relative to today in test, so av1 passes
      expect(rows.map(r => r.id)).toEqual(['av1'])
    })

    it('deleteAvailability prevents deleting booked slot', async () => {
      const { repo } = serviceSeeded()
      await expect(repo.deleteAvailability('av2', A)).rejects.toThrow('Cannot delete a booked slot')
    })
  })

  it('exports a default settingsRepository instance', () => {
    for (const m of ['get', 'save', 'saveBusinessProfile', 'saveBookingConfig', 'getServices', 'getActiveServices', 'createService', 'updateService', 'deleteService', 'getAvailability', 'getAvailableSlots', 'saveAvailability', 'deleteAvailability']) {
      expect(typeof settingsRepository[m]).toBe('function')
    }
  })
})
