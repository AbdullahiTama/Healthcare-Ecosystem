import { describe, it, expect } from 'vitest'
import { categoryForKind, NOTIFICATION_CATEGORIES } from './notificationCategories.js'

describe('categoryForKind', () => {
  it('routes appointment kinds to appointments', () => {
    expect(categoryForKind('booking_confirmed')).toBe('appointments')
    expect(categoryForKind('booking_created')).toBe('appointments')
    expect(categoryForKind('booking_paid')).toBe('appointments')
  })

  it('routes stock and expiry kinds to inventory', () => {
    for (const kind of ['product_expiring_soon', 'product_expired', 'low_stock', 'out_of_stock']) {
      expect(categoryForKind(kind)).toBe('inventory')
    }
  })

  it('routes CareFind social kinds to social', () => {
    expect(categoryForKind('contact_lead')).toBe('social')
    expect(categoryForKind('review_created')).toBe('social')
  })

  it('keeps operational kinds in general', () => {
    for (const kind of ['activity', 'activity_comment', 'order_approval', 'order_copy', 'order_update', 'message']) {
      expect(categoryForKind(kind)).toBe('general')
    }
  })

  it('falls back to general for unknown and missing kinds', () => {
    expect(categoryForKind('something_new')).toBe('general')
    expect(categoryForKind('')).toBe('general')
    expect(categoryForKind(null)).toBe('general')
    expect(categoryForKind(undefined)).toBe('general')
  })

  it('exposes exactly the four tab categories', () => {
    expect(NOTIFICATION_CATEGORIES).toEqual(['appointments', 'inventory', 'social', 'general'])
  })
})
