import { describe, it, expect } from 'vitest'
import { norm } from './normName'

describe('norm', () => {
  it('trims, lower-cases and turns runs of whitespace into one underscore', () => {
    expect(norm('  Super   Admin ')).toBe('super_admin')
    expect(norm('content_lead')).toBe('content_lead')
  })
  it('treats null and undefined as empty', () => {
    expect(norm(null)).toBe('')
    expect(norm(undefined)).toBe('')
  })
})
