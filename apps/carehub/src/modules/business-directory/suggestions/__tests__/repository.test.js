import { describe, it, expect, vi } from 'vitest'
import { createSuggestionRepository, SUGGESTION_TYPES } from '../repository.js'

// Businesses reps suggest for the CareHub directory (draft carehub_20261027_directory_field_link). Who suggested
// it and its status are set by the database; the client only sends what was suggested.

function backend(answer = async () => []) {
  const calls = []
  const request = vi.fn(async (path, opts = {}) => {
    calls.push({ path, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null, prefer: opts.prefer })
    return answer(path, opts)
  })
  return { calls, repo: createSuggestionRepository({ request }) }
}
const SUGGESTION = { name: ' Kemi Stores ', business_type: 'retail', address: '2 Allen Ave', latitude: 6.6, longitude: 3.35, note: 'by the junction' }

describe('suggestionRepository', () => {
  it('create sends only what was suggested, trimmed, for this company, and returns the saved row', async () => {
    const { repo, calls } = backend(async () => [{ id: 's1', status: 'pending' }])
    const saved = await repo.create('biz-1', SUGGESTION)
    expect(saved).toEqual({ id: 's1', status: 'pending' })
    expect(calls[0].path).toBe('directory_suggestions')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].body).toEqual({ business_id: 'biz-1', name: 'Kemi Stores', business_type: 'retail', address: '2 Allen Ave', latitude: 6.6, longitude: 3.35, note: 'by the junction' })
    expect(calls[0].prefer).toBe('return=representation')
  })

  it('create sends empty address and note as null', async () => {
    const { repo, calls } = backend(async () => [{ id: 's1' }])
    await repo.create('biz-1', { ...SUGGESTION, address: '  ', note: '' })
    expect(calls[0].body.address).toBeNull()
    expect(calls[0].body.note).toBeNull()
  })

  it('listMine asks for this person\'s own suggestions, newest first; no email means none', async () => {
    const { repo, calls } = backend(async () => [{ id: 's1' }])
    expect(await repo.listMine('rep+1@a.test')).toEqual([{ id: 's1' }])
    expect(calls[0].path).toBe('directory_suggestions?suggested_by_email=eq.' + encodeURIComponent('rep+1@a.test') + '&order=created_at.desc&select=id,name,business_type,status,review_note,created_at')
    expect(await repo.listMine('')).toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('listPending asks for pending suggestions oldest first, with the company name', async () => {
    const { repo, calls } = backend()
    await repo.listPending()
    expect(calls[0].path).toBe('directory_suggestions?status=eq.pending&order=created_at.asc&select=*,businesses(name)')
  })

  it('markAccepted records the listing; reject records the reason (or none)', async () => {
    const { repo, calls } = backend(async () => [{ id: 's1' }])
    await repo.markAccepted('s1', 'dir-9')
    await repo.reject('s2', '  duplicate ')
    await repo.reject('s3', '')
    expect(calls[0]).toMatchObject({ path: 'directory_suggestions?id=eq.s1', method: 'PATCH', body: { status: 'accepted', directory_business_id: 'dir-9' } })
    expect(calls[1]).toMatchObject({ path: 'directory_suggestions?id=eq.s2', method: 'PATCH', body: { status: 'rejected', review_note: 'duplicate' } })
    expect(calls[2].body).toEqual({ status: 'rejected', review_note: null })
  })

  it('a review that changed nothing (already handled, or not allowed) is reported', async () => {
    const { repo } = backend(async () => [])
    await expect(repo.markAccepted('s1', 'dir-9')).rejects.toThrow(/already been handled/i)
    await expect(repo.reject('s1')).rejects.toThrow(/already been handled/i)
  })

  it('before the draft is applied the table is missing: NOT_AVAILABLE', async () => {
    const { repo } = backend(async () => { throw new Error("Supabase error (404): Could not find the table 'public.directory_suggestions' in the schema cache (PGRST205)") })
    await expect(repo.listMine('a@b.c')).rejects.toMatchObject({ code: 'NOT_AVAILABLE' })
    await expect(repo.create('biz-1', SUGGESTION)).rejects.toMatchObject({ code: 'NOT_AVAILABLE' })
  })

  it('the daily cap becomes TOO_MANY', async () => {
    const { repo } = backend(async () => { throw new Error('Supabase error (400): Too many suggestions today (P0001)') })
    await expect(repo.create('biz-1', SUGGESTION)).rejects.toMatchObject({ code: 'TOO_MANY' })
  })

  it('offers the seven types', () => {
    expect(SUGGESTION_TYPES).toEqual([
      ['pharmacy', 'Pharmacy'], ['hospital', 'Hospital'], ['clinic', 'Clinic'], ['laboratory', 'Laboratory'],
      ['distributor', 'Distributor'], ['retail', 'Retail shop'], ['other', 'Other'],
    ])
  })
})
