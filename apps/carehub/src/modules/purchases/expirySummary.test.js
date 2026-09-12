import { describe, it, expect } from 'vitest'
import { purchaseExpirySummary } from './expirySummary.js'

describe('purchaseExpirySummary', () => {
  it('returns null expiry and batch when no item carries either', () => {
    expect(purchaseExpirySummary([{ expiry: '', batch: '' }, { expiry: '', batch: '' }])).toEqual({ expiry: null, batch: null })
  })

  it('returns the single item expiry and batch verbatim', () => {
    expect(purchaseExpirySummary([{ expiry: '2027-01-15', batch: 'B-1' }])).toEqual({ expiry: '2027-01-15', batch: 'B-1' })
  })

  it('returns the earliest expiry across distinct item expiries', () => {
    expect(purchaseExpirySummary([{ expiry: '2027-01-15', batch: 'B-1' }, { expiry: '2026-12-01', batch: 'B-2' }])).toEqual({ expiry: '2026-12-01', batch: 'B-1, B-2' })
  })

  it('filters empty values while keeping the set ones', () => {
    expect(purchaseExpirySummary([{ expiry: '', batch: '' }, { expiry: '2027-01-15', batch: 'B-1' }])).toEqual({ expiry: '2027-01-15', batch: 'B-1' })
  })

  it('dedupes repeated batch numbers into a single occurrence', () => {
    expect(purchaseExpirySummary([{ expiry: '2027-01-15', batch: 'B-1' }, { expiry: '2027-01-15', batch: 'B-1' }])).toEqual({ expiry: '2027-01-15', batch: 'B-1' })
  })

  it('returns nulls when every value is empty so the purchase can still save', () => {
    expect(purchaseExpirySummary([{ expiry: '', batch: '' }])).toEqual({ expiry: null, batch: null })
  })

  it('does not aggregate items that lack expiry or batch fields entirely', () => {
    expect(purchaseExpirySummary([{ name: 'Amoxicillin' }])).toEqual({ expiry: null, batch: null })
  })

  it('treats undefined input as an empty item list', () => {
    expect(purchaseExpirySummary()).toEqual({ expiry: null, batch: null })
  })

  it('ignores null entries and trims surrounding whitespace when deduping batches', () => {
    expect(purchaseExpirySummary([null, { expiry: '2027-01-15', batch: ' B-1 ' }, { batch: 'B-1' }])).toEqual({ expiry: '2027-01-15', batch: 'B-1' })
  })
})