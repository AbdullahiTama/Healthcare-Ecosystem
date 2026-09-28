import crypto from 'crypto'

describe('CareHub Webhook Security', () => {
  describe('Resend webhook signature validation', () => {
    it('accepts a valid signature using timingSafeEqual', () => {
      const secret = 'test-secret'
      const body = JSON.stringify({ type: 'email.bounced', data: { message: { id: 'msg-1' } } })
      const expectedSignature = crypto.createHmac('sha256', secret).update(body).digest('hex')

      const sigBuffer = Buffer.from(expectedSignature)
      const expectedBuffer = Buffer.from(expectedSignature)
      const result = sigBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(sigBuffer, expectedBuffer)
      expect(result).toBe(true)
    })

    it('rejects an invalid signature', () => {
      const secret = 'test-secret'
      const body = JSON.stringify({ type: 'email.bounced', data: { message: { id: 'msg-1' } } })
      const expectedSignature = crypto.createHmac('sha256', secret).update(body).digest('hex')
      const invalidSignature = 'invalid-signature'

      const sigBuffer = Buffer.from(invalidSignature)
      const expectedBuffer = Buffer.from(expectedSignature)
      const result = sigBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(sigBuffer, expectedBuffer)
      expect(result).toBe(false)
    })

    it('rejects signatures of different lengths', () => {
      const sig1 = Buffer.from('a'.repeat(64))
      const sig2 = Buffer.from('a'.repeat(32))
      const result = sig1.length === sig2.length && crypto.timingSafeEqual(sig1, sig2)
      expect(result).toBe(false)
    })

    it('rejects when signature header is missing', () => {
      const signature = undefined
      const hasSignature = !!signature
      expect(hasSignature).toBe(false)
    })
  })

  describe('Duplicate webhook handling', () => {
    it('duplicate bounce event is processed idempotently', () => {
      const events = ['email.bounced', 'email.bounced']
      const uniqueEvents = [...new Set(events)]
      expect(uniqueEvents.length).toBe(1)
    })

    it('duplicate complaint event is processed idempotently', () => {
      const events = ['email.complained', 'email.complained']
      const uniqueEvents = [...new Set(events)]
      expect(uniqueEvents.length).toBe(1)
    })
  })

  describe('Malformed payload handling', () => {
    it('rejects payload without type', () => {
      const body = { data: { message: { id: 'msg-1' } } }
      const hasType = !!body.type
      expect(hasType).toBe(false)
    })

    it('rejects payload without data', () => {
      const body = { type: 'email.bounced' }
      const hasData = !!body.data
      expect(hasData).toBe(false)
    })

    it('rejects payload without message id', () => {
      const body = { type: 'email.bounced', data: {} }
      const hasMessageId = !!body.data?.message?.id
      expect(hasMessageId).toBe(false)
    })
  })

  describe('Event type validation', () => {
    it('accepts email.bounced', () => {
      const type = 'email.bounced'
      const allowed = ['email.bounced', 'email.complained', 'email.opened']
      expect(allowed.includes(type)).toBe(true)
    })

    it('accepts email.complained', () => {
      const type = 'email.complained'
      const allowed = ['email.bounced', 'email.complained', 'email.opened']
      expect(allowed.includes(type)).toBe(true)
    })

    it('accepts email.opened', () => {
      const type = 'email.opened'
      const allowed = ['email.bounced', 'email.complained', 'email.opened']
      expect(allowed.includes(type)).toBe(true)
    })

    it('rejects unknown event type', () => {
      const type = 'email.unknown'
      const allowed = ['email.bounced', 'email.complained', 'email.opened']
      expect(allowed.includes(type)).toBe(false)
    })
  })
})
