import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkDatabaseHealth, checkStorageHealth, checkAuthHealth, checkApiHealth, runHealthChecks, HealthStatus, PerformanceMetrics, performanceMetrics } from './healthCheck'

// Mock supabase
vi.mock('../config/supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve({ data: [{ id: '1' }], error: null }))
      }))
    })),
    storage: {
      listBuckets: vi.fn(() => Promise.resolve({ data: [{ name: 'test-bucket' }], error: null }))
    },
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: { user: { id: '1' } } }, error: null }))
    }
  }
}))

// Mock fetch
global.fetch = vi.fn()

describe('healthCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('checkDatabaseHealth', () => {
    it('should return healthy status when database is accessible', async () => {
      const result = await checkDatabaseHealth()
      expect(result.status).toBe(HealthStatus.HEALTHY)
      expect(result.message).toBe('Database is healthy')
      expect(result.responseTime).toBeDefined()
    })

    it('should return unhealthy status when database query fails', async () => {
      const { supabase } = await import('../config/supabaseClient')
      supabase.from.mockImplementationOnce(() => ({
        select: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve({ data: null, error: { message: 'Connection failed' } }))
        }))
      }))

      const result = await checkDatabaseHealth()
      expect(result.status).toBe(HealthStatus.UNHEALTHY)
      expect(result.error).toBe('Connection failed')
    })

    it('should return degraded status when response time is slow', async () => {
      const { supabase } = await import('../config/supabaseClient')
      supabase.from.mockImplementationOnce(() => ({
        select: vi.fn(() => ({
          limit: vi.fn(() => new Promise(resolve => {
            setTimeout(() => resolve({ data: [{ id: '1' }], error: null }), 1100)
          }))
        }))
      }))

      const result = await checkDatabaseHealth()
      expect(result.status).toBe(HealthStatus.DEGRADED)
      expect(result.message).toBe('Database is slow')
    })
  })

  describe('checkStorageHealth', () => {
    it('should return healthy status when storage is accessible', async () => {
      const result = await checkStorageHealth()
      expect(result.status).toBe(HealthStatus.HEALTHY)
      expect(result.message).toBe('Storage is healthy')
      expect(result.bucketCount).toBeDefined()
    })

    it('should return unhealthy status when storage query fails', async () => {
      const { supabase } = await import('../config/supabaseClient')
      supabase.storage.listBuckets.mockImplementationOnce(() => 
        Promise.resolve({ data: null, error: { message: 'Storage error' } })
      )

      const result = await checkStorageHealth()
      expect(result.status).toBe(HealthStatus.UNHEALTHY)
      expect(result.error).toBe('Storage error')
    })
  })

  describe('checkAuthHealth', () => {
    it('should return healthy status when auth service is accessible', async () => {
      const result = await checkAuthHealth()
      expect(result.status).toBe(HealthStatus.HEALTHY)
      expect(result.message).toBe('Auth service is healthy')
      expect(result.hasSession).toBeDefined()
    })

    it('should return unhealthy status when auth query fails', async () => {
      const { supabase } = await import('../config/supabaseClient')
      supabase.auth.getSession.mockImplementationOnce(() => 
        Promise.resolve({ data: { session: null }, error: { message: 'Auth error' } })
      )

      const result = await checkAuthHealth()
      expect(result.status).toBe(HealthStatus.UNHEALTHY)
      expect(result.error).toBe('Auth error')
    })
  })

  describe('checkApiHealth', () => {
    it('should return healthy status when API is accessible', async () => {
      fetch.mockImplementationOnce(() => 
        Promise.resolve({ ok: true, status: 200 })
      )

      const result = await checkApiHealth()
      expect(result.status).toBe(HealthStatus.HEALTHY)
      expect(result.message).toBe('API is healthy')
    })

    it('should return unhealthy status when API returns error', async () => {
      fetch.mockImplementationOnce(() => 
        Promise.resolve({ ok: false, status: 500 })
      )

      const result = await checkApiHealth()
      expect(result.status).toBe(HealthStatus.UNHEALTHY)
      expect(result.statusCode).toBe(500)
    })

    it('should return unhealthy status when API request fails', async () => {
      fetch.mockImplementationOnce(() => 
        Promise.reject(new Error('Network error'))
      )

      const result = await checkApiHealth()
      expect(result.status).toBe(HealthStatus.UNHEALTHY)
      expect(result.error).toBe('Network error')
    })
  })

  describe('runHealthChecks', () => {
    it('should return overall healthy status when all checks pass', async () => {
      fetch.mockImplementation(() => 
        Promise.resolve({ ok: true, status: 200 })
      )

      const result = await runHealthChecks()
      expect(result.status).toBe(HealthStatus.HEALTHY)
      expect(result.checks).toBeDefined()
      expect(result.checks.database).toBeDefined()
      expect(result.checks.storage).toBeDefined()
      expect(result.checks.auth).toBeDefined()
      expect(result.checks.api).toBeDefined()
      expect(result.timestamp).toBeDefined()
    })

    it('should return unhealthy status when any check fails', async () => {
      const { supabase } = await import('../config/supabaseClient')
      supabase.from.mockImplementationOnce(() => ({
        select: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve({ data: null, error: { message: 'DB error' } }))
        }))
      }))

      fetch.mockImplementation(() => 
        Promise.resolve({ ok: true, status: 200 })
      )

      const result = await runHealthChecks()
      expect(result.status).toBe(HealthStatus.UNHEALTHY)
    })
  })

  describe('PerformanceMetrics', () => {
    it('should record and calculate statistics', () => {
      const metrics = new PerformanceMetrics()
      
      metrics.record('test-metric', 100)
      metrics.record('test-metric', 200)
      metrics.record('test-metric', 150)

      const stats = metrics.getStats('test-metric')
      expect(stats).toBeDefined()
      expect(stats.count).toBe(3)
      expect(stats.avg).toBe(150)
      expect(stats.min).toBe(100)
      expect(stats.max).toBe(200)
      expect(stats.last).toBe(150)
    })

    it('should return null for non-existent metrics', () => {
      const metrics = new PerformanceMetrics()
      const stats = metrics.getStats('non-existent')
      expect(stats).toBeNull()
    })

    it('should get all stats', () => {
      const metrics = new PerformanceMetrics()
      
      metrics.record('metric1', 100)
      metrics.record('metric2', 200)

      const allStats = metrics.getAllStats()
      expect(allStats).toBeDefined()
      expect(allStats.metric1).toBeDefined()
      expect(allStats.metric2).toBeDefined()
    })

    it('should clear all metrics', () => {
      const metrics = new PerformanceMetrics()
      
      metrics.record('test-metric', 100)
      metrics.clear()

      const stats = metrics.getStats('test-metric')
      expect(stats).toBeNull()
    })

    it('should keep only last 100 records', () => {
      const metrics = new PerformanceMetrics()
      
      for (let i = 0; i < 150; i++) {
        metrics.record('test-metric', i)
      }

      const stats = metrics.getStats('test-metric')
      expect(stats.count).toBe(100)
      expect(stats.min).toBe(50) // Oldest 50 records were discarded
    })
  })

  describe('performanceMetrics singleton', () => {
    it('should be an instance of PerformanceMetrics', () => {
      expect(performanceMetrics).toBeInstanceOf(PerformanceMetrics)
    })
  })
})
