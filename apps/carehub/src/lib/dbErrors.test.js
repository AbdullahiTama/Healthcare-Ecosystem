import { describe, it, expect } from 'vitest'
import { refusalMessage } from './dbErrors'

describe('refusalMessage', () => {
  it('shows a database function refusal sent as 400, 403, 404 or 409', () => {
    for (const status of [400, 403, 404, 409]) {
      expect(refusalMessage(new Error(`Supabase error (${status}): Only 10 of Paracetamol in stock at Ikeja.`), 'fallback'))
        .toBe('Only 10 of Paracetamol in stock at Ikeja.')
    }
  })

  it('shows a refused duplicate (409) written for the person', () => {
    const e = new Error('Supabase error (409): Another library item already has this name and strength, or this NAFDAC number. Search for it and merge instead.')
    expect(refusalMessage(e, 'fallback')).toMatch(/^Another library item already has this name/)
  })

  it('hides raw database text, including a 409 duplicate key', () => {
    expect(refusalMessage(new Error('Supabase error (409): duplicate key value violates unique constraint "x"'), 'fallback')).toBe('fallback')
    expect(refusalMessage(new Error('Supabase error (400): relation "public.catalog_items" does not exist'), 'fallback')).toBe('fallback')
  })

  it('hides server and network errors behind the fallback', () => {
    expect(refusalMessage(new Error('Supabase error (500): Something broke.'), 'fallback')).toBe('fallback')
    expect(refusalMessage(new Error('Failed to fetch'), 'fallback')).toBe('fallback')
  })

  it('uses a default fallback when none is given', () => {
    expect(refusalMessage(new Error('Failed to fetch'))).toBe('Could not complete this. Please try again.')
  })

  it('passes a session expiry through', () => {
    expect(refusalMessage(new Error('Session expired. Sign in again.'), 'fallback')).toBe('Session expired. Sign in again.')
  })
})
