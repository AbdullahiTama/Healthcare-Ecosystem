import { describe, it, expect } from 'vitest'
import { STATUS_CONFIG } from '../orderConstants'

describe('orderConstants emotional status updates', () => {
  it('STATUS_CONFIG has message for all statuses', () => {
    Object.entries(STATUS_CONFIG).forEach(([key, config]) => {
      expect(config.message, `${key} should have a message`).toBeDefined()
      expect(config.message.length, `${key} message should not be empty`).toBeGreaterThan(0)
    })
  })

  it('STATUS_CONFIG has emoji for all statuses', () => {
    Object.entries(STATUS_CONFIG).forEach(([key, config]) => {
      expect(config.emoji, `${key} should have an emoji`).toBeDefined()
      expect(config.emoji.length, `${key} emoji should not be empty`).toBeGreaterThan(0)
    })
  })

  it('pending_payment has appropriate message', () => {
    expect(STATUS_CONFIG.pending_payment.message).toContain('payment')
    expect(STATUS_CONFIG.pending_payment.emoji).toBe('💳')
  })

  it('processing has appropriate message', () => {
    expect(STATUS_CONFIG.processing.message).toContain('prepared')
    expect(STATUS_CONFIG.processing.emoji).toBe('📦')
  })

  it('delivered has appropriate message', () => {
    expect(STATUS_CONFIG.delivered.message).toContain('Enjoy')
    expect(STATUS_CONFIG.delivered.emoji).toBe('🎊')
  })

  it('in_transit has appropriate message', () => {
    expect(STATUS_CONFIG.in_transit.message).toContain('way')
    expect(STATUS_CONFIG.in_transit.emoji).toBe('🚚')
  })
})
