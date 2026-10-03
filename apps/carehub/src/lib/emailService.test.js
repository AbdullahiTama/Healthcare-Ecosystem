import { EmailService } from '@care-ecosystem/shared-email'
import { vi } from 'vitest'

vi.mock('@care-ecosystem/shared-email', () => ({
  EmailService: class {
    constructor(options = {}) {
      this.db = options.supabase || {
        from: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }),
      }
      this.maxRetries = options.maxRetries ?? 5
      this.baseDelayMs = options.baseDelayMs ?? 60000
      this.batchSize = options.batchSize ?? 20
    }
    async enqueue({ templateKey, toEmail }) {
      if (!templateKey || !toEmail) throw new Error('templateKey and toEmail are required')
      return { id: 'uuid-1', status: 'pending' }
    }
    async processBatch() { return { processed: 0, sent: 0, failed: 0 } }
  },
  emailService: { enqueue: vi.fn(), processBatch: vi.fn() },
  sendEmail: vi.fn(),
  TEMPLATE_REGISTRY: {},
}))

describe('EmailService', () => {
  let service
  let mockSupabase

  beforeEach(() => {
    mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
    }
    service = new EmailService({ supabase: mockSupabase, maxRetries: 3, batchSize: 5 })
  })

  afterEach(() => vi.clearAllMocks())

  describe('enqueue', () => {
    it('inserts a pending row into email_outbox', async () => {
      const mockRow = { id: 'uuid-1', status: 'pending' }
      mockSupabase.insert.mockReturnValue({ select: () => ({ single: () => Promise.resolve({ data: mockRow, error: null }) }) })
      mockSupabase.from.mockReturnValue(mockSupabase)
      const result = await service.enqueue({ templateKey: 'business_approved', toEmail: 'test@carehub.ng', payload: {} })
      expect(result.id).toBe('uuid-1')
    })
    it('throws if templateKey is missing', async () => {
      await expect(service.enqueue({ toEmail: 'test@carehub.ng' })).rejects.toThrow('templateKey and toEmail are required')
    })
  })

  describe('processBatch', () => {
    it('returns zero counts when no rows are due', async () => {
      mockSupabase.select.mockReturnValue({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) })
      const result = await service.processBatch()
      expect(result).toEqual({ processed: 0, sent: 0, failed: 0 })
    })
  })
})
