import {
  generateRequestId, getRequestId, sanitizeLogData,
  logApiRequest, logPaymentOperation, logAuditEvent,
} from '../_lib/observability.js'

describe('Observability utilities', () => {
  describe('generateRequestId', () => {
    it('generates a valid UUID', () => {
      const id = generateRequestId()
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    })

    it('generates unique IDs', () => {
      const id1 = generateRequestId()
      const id2 = generateRequestId()
      expect(id1).not.toBe(id2)
    })
  })

  describe('getRequestId', () => {
    it('returns existing x-request-id header', () => {
      const req = { headers: { 'x-request-id': 'existing-id' } }
      expect(getRequestId(req)).toBe('existing-id')
    })

    it('generates new ID when header missing', () => {
      const req = { headers: {} }
      const id = getRequestId(req)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    })
  })

  describe('sanitizeLogData', () => {
    it('redacts sensitive fields', () => {
      const data = { username: 'john', password: 'secret', token: 'abc' }
      const sanitized = sanitizeLogData(data)
      expect(sanitized.username).toBe('john')
      expect(sanitized.password).toBe('[REDACTED]')
      expect(sanitized.token).toBe('[REDACTED]')
    })

    it('redacts nested sensitive fields', () => {
      const data = { user: { name: 'john', pin: '1234' } }
      const sanitized = sanitizeLogData(data)
      expect(sanitized.user.name).toBe('john')
      expect(sanitized.user.pin).toBe('[REDACTED]')
    })

    it('handles null and undefined', () => {
      expect(sanitizeLogData(null)).toBeNull()
      expect(sanitizeLogData(undefined)).toBeUndefined()
    })

    it('does not redact non-sensitive fields', () => {
      const data = { amount: 100, currency: 'NGN', status: 'success' }
      const sanitized = sanitizeLogData(data)
      expect(sanitized).toEqual(data)
    })
  })

  describe('logApiRequest', () => {
    it('creates a log entry with all fields', () => {
      const req = {
        headers: { 'x-request-id': 'req-1' },
        user: { id: 'user-1' },
        business: { id: 'biz-1' },
        method: 'POST',
        url: '/api/test',
        route: { path: '/api/test' },
      }
      const res = { statusCode: 200 }
      const entry = logApiRequest(req, res, 150.5)
      expect(entry.requestId).toBe('req-1')
      expect(entry.userId).toBe('user-1')
      expect(entry.tenantId).toBe('biz-1')
      expect(entry.statusCode).toBe(200)
      expect(entry.duration).toBe('150.50ms')
    })

    it('includes error info when provided', () => {
      const req = { headers: {}, method: 'POST', url: '/api/test' }
      const res = { statusCode: 500 }
      const error = { code: 'DB_ERROR', message: 'connection failed' }
      const entry = logApiRequest(req, res, 200, error)
      expect(entry.errorCode).toBe('DB_ERROR')
      expect(entry.error).toBe('connection failed')
    })
  })

  describe('logPaymentOperation', () => {
    it('creates a payment log entry', () => {
      const entry = logPaymentOperation({
        requestId: 'req-1',
        userId: 'user-1',
        tenantId: 'biz-1',
        paymentReference: 'pay-123',
        providerReference: 'prov-456',
        transactionType: 'subscription',
        amount: 1000,
        currency: 'NGN',
        idempotencyKey: 'idem-789',
        status: 'success',
      })
      expect(entry.paymentReference).toBe('pay-123')
      expect(entry.providerReference).toBe('prov-456')
      expect(entry.transactionType).toBe('subscription')
      expect(entry.amount).toBe(1000)
      expect(entry.currency).toBe('NGN')
      expect(entry.idempotencyKey).toBe('idem-789')
      expect(entry.status).toBe('success')
    })

    it('includes error info when provided', () => {
      const entry = logPaymentOperation({
        requestId: 'req-1',
        paymentReference: 'pay-123',
        transactionType: 'topup',
        amount: 1000,
        currency: 'NGN',
        status: 'failed',
        error: new Error('timeout'),
      })
      expect(entry.status).toBe('failed')
      expect(entry.error).toBe('timeout')
    })
  })

  describe('logAuditEvent', () => {
    it('creates an audit log entry', () => {
      const entry = logAuditEvent({
        requestId: 'req-1',
        actorId: 'admin-1',
        actorType: 'admin',
        action: 'approve_business',
        targetType: 'businesses',
        targetId: 'biz-1',
        metadata: { businessName: 'Test Biz' },
      })
      expect(entry.actorId).toBe('admin-1')
      expect(entry.action).toBe('approve_business')
      expect(entry.targetType).toBe('businesses')
      expect(entry.status).toBe('success')
    })

    it('sanitizes sensitive metadata', () => {
      const entry = logAuditEvent({
        requestId: 'req-1',
        actorId: 'admin-1',
        actorType: 'admin',
        action: 'update_user',
        targetType: 'users',
        targetId: 'user-1',
        metadata: { password: 'secret', name: 'John' },
      })
      expect(entry.metadata.password).toBe('[REDACTED]')
      expect(entry.metadata.name).toBe('John')
    })
  })
})
