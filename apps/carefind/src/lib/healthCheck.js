// Health check utilities for monitoring application and database health

import { supabase } from '../config/supabaseClient'
import { logger } from './logger'
import { captureError } from './sentry'

// Health check result structure
export const HealthStatus = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNHEALTHY: 'unhealthy',
}

// Check database connectivity
export async function checkDatabaseHealth() {
  const startTime = Date.now()
  try {
    // Simple query to test database connectivity
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .limit(1)

    const responseTime = Date.now() - startTime

    if (error) {
      logger.error('Database health check failed', { error: error.message, responseTime })
      return {
        status: HealthStatus.UNHEALTHY,
        message: 'Database connection failed',
        error: error.message,
        responseTime,
      }
    }

    // Check response time
    if (responseTime > 1000) {
      logger.warn('Database response time is slow', { responseTime })
      return {
        status: HealthStatus.DEGRADED,
        message: 'Database is slow',
        responseTime,
      }
    }

    return {
      status: HealthStatus.HEALTHY,
      message: 'Database is healthy',
      responseTime,
    }
  } catch (error) {
    logger.error('Database health check error', { error: error.message })
    captureError(error, { context: 'database_health_check' })
    return {
      status: HealthStatus.UNHEALTHY,
      message: 'Database health check failed',
      error: error.message,
      responseTime: Date.now() - startTime,
    }
  }
}

// Check Supabase storage connectivity
export async function checkStorageHealth() {
  const startTime = Date.now()
  try {
    // Try to list buckets
    const { data, error } = await supabase.storage.listBuckets()

    const responseTime = Date.now() - startTime

    if (error) {
      logger.error('Storage health check failed', { error: error.message, responseTime })
      return {
        status: HealthStatus.UNHEALTHY,
        message: 'Storage connection failed',
        error: error.message,
        responseTime,
      }
    }

    return {
      status: HealthStatus.HEALTHY,
      message: 'Storage is healthy',
      bucketCount: data?.length || 0,
      responseTime,
    }
  } catch (error) {
    logger.error('Storage health check error', { error: error.message })
    captureError(error, { context: 'storage_health_check' })
    return {
      status: HealthStatus.UNHEALTHY,
      message: 'Storage health check failed',
      error: error.message,
      responseTime: Date.now() - startTime,
    }
  }
}

// Check authentication service
export async function checkAuthHealth() {
  const startTime = Date.now()
  try {
    const { data: { session }, error } = await supabase.auth.getSession()

    const responseTime = Date.now() - startTime

    if (error) {
      logger.error('Auth health check failed', { error: error.message, responseTime })
      return {
        status: HealthStatus.UNHEALTHY,
        message: 'Auth service failed',
        error: error.message,
        responseTime,
      }
    }

    return {
      status: HealthStatus.HEALTHY,
      message: 'Auth service is healthy',
      hasSession: !!session,
      responseTime,
    }
  } catch (error) {
    logger.error('Auth health check error', { error: error.message })
    captureError(error, { context: 'auth_health_check' })
    return {
      status: HealthStatus.UNHEALTHY,
      message: 'Auth health check failed',
      error: error.message,
      responseTime: Date.now() - startTime,
    }
  }
}

// Check API endpoints
export async function checkApiHealth() {
  const startTime = Date.now()
  try {
    // Test a simple API call
    const response = await fetch('/api/health', { method: 'GET' })
    const responseTime = Date.now() - startTime

    if (!response.ok) {
      return {
        status: HealthStatus.UNHEALTHY,
        message: 'API returned error',
        statusCode: response.status,
        responseTime,
      }
    }

    if (responseTime > 500) {
      logger.warn('API response time is slow', { responseTime })
      return {
        status: HealthStatus.DEGRADED,
        message: 'API is slow',
        responseTime,
      }
    }

    return {
      status: HealthStatus.HEALTHY,
      message: 'API is healthy',
      responseTime,
    }
  } catch (error) {
    logger.error('API health check error', { error: error.message })
    captureError(error, { context: 'api_health_check' })
    return {
      status: HealthStatus.UNHEALTHY,
      message: 'API health check failed',
      error: error.message,
      responseTime: Date.now() - startTime,
    }
  }
}

// Run all health checks
export async function runHealthChecks() {
  logger.info('Running health checks')
  
  const [database, storage, auth, api] = await Promise.all([
    checkDatabaseHealth(),
    checkStorageHealth(),
    checkAuthHealth(),
    checkApiHealth(),
  ])

  const checks = { database, storage, auth, api }
  
  // Determine overall status
  const statuses = Object.values(checks).map(c => c.status)
  let overallStatus = HealthStatus.HEALTHY
  
  if (statuses.includes(HealthStatus.UNHEALTHY)) {
    overallStatus = HealthStatus.UNHEALTHY
  } else if (statuses.includes(HealthStatus.DEGRADED)) {
    overallStatus = HealthStatus.DEGRADED
  }

  const result = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    checks,
  }

  if (overallStatus !== HealthStatus.HEALTHY) {
    logger.warn('Health check completed with issues', result)
  } else {
    logger.info('Health check completed successfully', {
      responseTimes: {
        database: database.responseTime,
        storage: storage.responseTime,
        auth: auth.responseTime,
        api: api.responseTime,
      }
    })
  }

  return result
}

// Periodic health monitoring
export function startHealthMonitoring(intervalMs = 60000) {
  logger.info('Starting health monitoring', { intervalMs })
  
  const interval = setInterval(async () => {
    await runHealthChecks()
  }, intervalMs)

  // Run initial check
  runHealthChecks()

  return () => {
    logger.info('Stopping health monitoring')
    clearInterval(interval)
  }
}

// Performance metrics tracking
export class PerformanceMetrics {
  constructor() {
    this.metrics = new Map()
  }

  record(name, value, unit = 'ms') {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, [])
    }
    
    const records = this.metrics.get(name)
    records.push({
      value,
      unit,
      timestamp: Date.now(),
    })

    // Keep only last 100 records
    if (records.length > 100) {
      records.shift()
    }
  }

  getStats(name) {
    const records = this.metrics.get(name)
    if (!records || records.length === 0) return null

    const values = records.map(r => r.value)
    return {
      count: values.length,
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      last: values[values.length - 1],
    }
  }

  getAllStats() {
    const stats = {}
    for (const [name] of this.metrics) {
      stats[name] = this.getStats(name)
    }
    return stats
  }

  clear() {
    this.metrics.clear()
  }
}

export const performanceMetrics = new PerformanceMetrics()
