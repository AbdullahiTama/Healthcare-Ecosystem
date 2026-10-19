import { describe, it, expect } from 'vitest'
import { validateDirectoryRecord, normalizeDirectoryRecord, isValidLatLng, duplicateKeys } from './directoryRecord.js'
import { createDirectoryRepository } from './repositories/index.js'

function recording(returns = []) {
  const calls = []
  const repo = createDirectoryRepository(async (path, options) => {
    calls.push({ path, method: options?.method || 'GET', body: options?.body ? JSON.parse(options.body) : null })
    return returns
  })
  return { calls, repo }
}

describe('validateDirectoryRecord', () => {
  it('accepts a minimal record: only the name is mandatory', () => {
    const v = validateDirectoryRecord({ name: '  Alpha Pharmacy ' })
    expect(v.ok).toBe(true)
    expect(v.record.name).toBe('Alpha Pharmacy')
    expect(v.record.latitude).toBeNull()
    expect(v.record.data_source).toBe('manual')
  })

  it('rejects a missing name', () => {
    expect(validateDirectoryRecord({ name: '   ' }).errors.name).toBeTruthy()
  })

  it('rejects out-of-range, non-numeric and half-supplied coordinates', () => {
    expect(validateDirectoryRecord({ name: 'A', latitude: 91, longitude: 3 }).errors.latitude).toBeTruthy()
    expect(validateDirectoryRecord({ name: 'A', latitude: 6, longitude: 181 }).errors.latitude).toBeTruthy()
    expect(validateDirectoryRecord({ name: 'A', latitude: 'abc', longitude: 3 }).errors.latitude).toBeTruthy()
    expect(validateDirectoryRecord({ name: 'A', latitude: 6.5 }).errors.latitude).toBeTruthy()
    expect(validateDirectoryRecord({ name: 'A', latitude: '6.45', longitude: '3.39' }).ok).toBe(true)
  })

  it('treats 0,0 as a valid pair but never fabricates coordinates', () => {
    expect(isValidLatLng(0, 0)).toBe(true)
    expect(normalizeDirectoryRecord({ name: 'A' }).latitude).toBeNull()
  })

  it('validates email, phone and website only when supplied', () => {
    expect(validateDirectoryRecord({ name: 'A', email: 'nope' }).errors.email).toBeTruthy()
    expect(validateDirectoryRecord({ name: 'A', phone: '123' }).errors.phone).toBeTruthy()
    expect(validateDirectoryRecord({ name: 'A', website: 'javascript:alert(1)' }).errors.website).toBeTruthy()
    expect(validateDirectoryRecord({ name: 'A', website: 'example.com', email: 'A@B.CO', phone: '+234 803 123 4567' }).ok).toBe(true)
  })

  it('requires a category before a subcategory', () => {
    expect(validateDirectoryRecord({ name: 'A', subcategory_id: 's1' }).errors.subcategory_id).toBeTruthy()
  })

  it('never carries verification fields from input', () => {
    const r = normalizeDirectoryRecord({ name: 'A', verification_status: 'verified', verified_by: 'u1', is_active: false })
    expect(r).not.toHaveProperty('verification_status')
    expect(r).not.toHaveProperty('verified_by')
    expect(r).not.toHaveProperty('is_active')
  })

  it('computes duplicate keys that match the discovery normalisers', () => {
    expect(duplicateKeys({ name: "St. Mary's  Clinic", phone: '+234 803 123 4567' }))
      .toEqual({ name: 'st marys clinic', phone: '8031234567' })
  })
})

describe('directoryRepository', () => {
  it('sends no request for an invalid record and exposes field errors', async () => {
    const { repo, calls } = recording()
    await expect(repo.create({ name: '' })).rejects.toMatchObject({ fields: { name: expect.any(String) } })
    expect(calls).toHaveLength(0)
  })

  it('create posts the normalised record only', async () => {
    const { repo, calls } = recording([{ id: 'd1' }])
    const saved = await repo.create({ name: 'Alpha', verification_status: 'verified' })
    expect(saved.id).toBe('d1')
    expect(calls[0].path).toBe('directory_businesses')
    expect(calls[0].body).not.toHaveProperty('verification_status')
  })

  it('update does not rewrite provenance', async () => {
    const { repo, calls } = recording([{ id: 'd1' }])
    await repo.update('d1', { name: 'Alpha', data_source: 'google', source_ref: 'x' })
    expect(calls[0].method).toBe('PATCH')
    expect(calls[0].body).not.toHaveProperty('data_source')
    expect(calls[0].body).not.toHaveProperty('source_ref')
  })

  it('verification goes only through the RPC and rejects unknown statuses', async () => {
    const { repo, calls } = recording({})
    await repo.setVerification('d1', 'verified', 'CAC checked')
    expect(calls[0].path).toBe('rpc/directory_set_verification')
    expect(calls[0].body).toEqual({ p_id: 'd1', p_status: 'verified', p_note: 'CAC checked' })
    await expect(repo.setVerification('d1', 'approved')).rejects.toThrow()
    expect(calls).toHaveLength(1)
  })

  it('deactivates by PATCH; the repository has no delete', async () => {
    const { repo, calls } = recording()
    await repo.setActive('d1', false)
    expect(calls[0]).toMatchObject({ method: 'PATCH', body: { is_active: false } })
    expect(repo).not.toHaveProperty('delete')
  })

  it('search paginates server-side, clamps the limit and escapes wildcards', async () => {
    const { repo, calls } = recording([])
    await repo.search({ q: '100%_off', limit: 5000, offset: -3, verification: 'verified' })
    const path = calls[0].path
    expect(path).toContain('limit=100')
    expect(path).toContain('offset=0')
    expect(path).toContain('verification_status=eq.verified')
    expect(decodeURIComponent(path.match(/name=ilike\.([^&]*)/)[1])).toBe('*100\\%\\_off*')
  })

  it('ignores an unknown verification filter instead of passing it through', async () => {
    const { repo, calls } = recording([])
    await repo.search({ verification: 'x;drop' })
    expect(calls[0].path).not.toContain('verification_status=')
  })

  it('duplicate lookup is a no-op without keys and excludes the record itself', async () => {
    const { repo, calls } = recording([])
    expect(await repo.findPossibleDuplicates({})).toEqual([])
    expect(calls).toHaveLength(0)
    await repo.findPossibleDuplicates({ nameNormalized: 'alpha', phoneNormalized: '8031234567', excludeId: 'd1' })
    expect(calls[0].path).toContain('id=neq.d1')
    expect(calls[0].method).toBe('GET')
  })
})
