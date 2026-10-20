import { describe, it, expect, beforeEach, vi } from 'vitest'
import { draftKey, saveDraft, loadDraft, clearDraft, hasContent, DRAFT_MAX_AGE_MS } from './draftStore'

// A rep's unsent report text survives a reload or an accidental close. It lives only
// in this browser, is keyed to the person, and every storage call can fail (private
// windows, blocked storage) without breaking the form.

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('draftKey', () => {
  it('is per business and per person, with the owner kept apart from staff', () => {
    expect(draftKey('b1', 's1')).not.toBe(draftKey('b1', 's2'))
    expect(draftKey('b1', 's1')).not.toBe(draftKey('b2', 's1'))
    expect(draftKey('b1', null)).toBe(draftKey('b1', undefined))
    expect(draftKey('b1', null)).not.toBe(draftKey('b1', 's1'))
  })
})

describe('hasContent', () => {
  it('is false for nothing, blanks and an unset territory', () => {
    expect(hasContent({ values: {}, terrId: '' })).toBe(false)
    expect(hasContent({ values: { a: '   ', b: '' }, terrId: '' })).toBe(false)
    expect(hasContent(null)).toBe(false)
  })
  it('is true for any text or a chosen territory', () => {
    expect(hasContent({ values: { a: 'x' }, terrId: '' })).toBe(true)
    expect(hasContent({ values: {}, terrId: 't1' })).toBe(true)
  })
})

describe('save / load / clear', () => {
  it('round-trips what was typed', () => {
    saveDraft('b1', 's1', { values: { a: 'Met the pharmacist' }, terrId: 't1' })
    const d = loadDraft('b1', 's1')
    expect(d.values).toEqual({ a: 'Met the pharmacist' })
    expect(d.terrId).toBe('t1')
    expect(typeof d.savedAt).toBe('number')
  })

  it('one person never sees another\'s draft', () => {
    saveDraft('b1', 's1', { values: { a: 'private' }, terrId: '' })
    expect(loadDraft('b1', 's2')).toBeNull()
    expect(loadDraft('b2', 's1')).toBeNull()
  })

  it('saving an empty form removes the draft rather than keeping a blank one', () => {
    saveDraft('b1', 's1', { values: { a: 'x' }, terrId: '' })
    saveDraft('b1', 's1', { values: { a: '  ' }, terrId: '' })
    expect(loadDraft('b1', 's1')).toBeNull()
  })

  it('clear removes it', () => {
    saveDraft('b1', 's1', { values: { a: 'x' }, terrId: '' })
    clearDraft('b1', 's1')
    expect(loadDraft('b1', 's1')).toBeNull()
  })

  it('a draft older than a week is not offered back, and is cleaned up', () => {
    saveDraft('b1', 's1', { values: { a: 'x' }, terrId: '' }, Date.now() - DRAFT_MAX_AGE_MS - 1000)
    expect(loadDraft('b1', 's1')).toBeNull()
    expect(localStorage.getItem(draftKey('b1', 's1'))).toBeNull()
  })

  it('damaged stored data is treated as no draft', () => {
    localStorage.setItem(draftKey('b1', 's1'), '{not json')
    expect(loadDraft('b1', 's1')).toBeNull()
    localStorage.setItem(draftKey('b1', 's1'), JSON.stringify({ values: 'nope' }))
    expect(loadDraft('b1', 's1')).toBeNull()
  })
})

describe('when storage is unavailable', () => {
  it('never throws', () => {
    const boom = () => { throw new Error('SecurityError') }
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom)
    expect(() => saveDraft('b1', 's1', { values: { a: 'x' }, terrId: '' })).not.toThrow()
    expect(loadDraft('b1', 's1')).toBeNull()
    expect(() => clearDraft('b1', 's1')).not.toThrow()
  })
})
