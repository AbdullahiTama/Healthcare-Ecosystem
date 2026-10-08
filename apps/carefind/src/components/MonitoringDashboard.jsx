import { useState, useEffect } from 'react'
import { runHealthChecks, HealthStatus, performanceMetrics } from '../lib/healthCheck'
import { Activity, Database, HardDrive, Lock, Server, RefreshCw, AlertCircle, CheckCircle, Clock } from 'lucide-react'
import { theme } from '../styles/theme'

export default function MonitoringDashboard() {
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)

  useEffect(() => {
    checkHealth()
    const interval = setInterval(checkHealth, 30000) // Check every 30 seconds
    return () => clearInterval(interval)
  }, [])

  async function checkHealth() {
    setLoading(true)
    try {
      const result = await runHealthChecks()
      setHealth(result)
      setLastUpdated(new Date())
    } catch (error) {
      console.error('Health check failed:', error)
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (status) => {
    switch (status) {
      case HealthStatus.HEALTHY:
        return theme.success
      case HealthStatus.DEGRADED:
        return theme.warning
      case HealthStatus.UNHEALTHY:
        return theme.danger
      default:
        return theme.textMid
    }
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case HealthStatus.HEALTHY:
        return <CheckCircle size={16} />
      case HealthStatus.DEGRADED:
        return <AlertCircle size={16} />
      case HealthStatus.UNHEALTHY:
        return <AlertCircle size={16} />
      default:
        return null
    }
  }

  const getServiceIcon = (service) => {
    switch (service) {
      case 'database':
        return <Database size={20} />
      case 'storage':
        return <HardDrive size={20} />
      case 'auth':
        return <Lock size={20} />
      case 'api':
        return <Server size={20} />
      default:
        return <Activity size={20} />
    }
  }

  if (loading && !health) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <RefreshCw className="animate-spin" size={24} style={{ margin: '0 auto' }} />
        <p style={{ marginTop: 10, color: theme.textMid }}>Checking system health...</p>
      </div>
    )
  }

  if (!health) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: theme.danger }}>
        <AlertCircle size={24} style={{ margin: '0 auto' }} />
        <p style={{ marginTop: 10 }}>Unable to check system health</p>
      </div>
    )
  }

  const metrics = performanceMetrics.getAllStats()

  return (
    <div style={{ padding: 20, maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: theme.navy, margin: 0 }}>
            System Health
          </h1>
          {lastUpdated && (
            <p style={{ fontSize: 12, color: theme.textMid, margin: '4px 0 0 0' }}>
              Last updated: {lastUpdated.toLocaleTimeString()}
            </p>
          )}
        </div>
        <button
          onClick={checkHealth}
          disabled={loading}
          style={{
            padding: '8px 16px',
            backgroundColor: theme.tealDeep,
            color: '#fff',
            border: 'none',
            borderRadius: theme.radius.md,
            cursor: loading ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            opacity: loading ? 0.6 : 1,
          }}
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Overall Status */}
      <div style={{
        padding: 20,
        backgroundColor: theme.cardBg,
        border: `1px solid ${theme.border}`,
        borderRadius: theme.radius.lg,
        marginBottom: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            backgroundColor: getStatusColor(health.status) + '20',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: getStatusColor(health.status),
          }}>
            {getStatusIcon(health.status)}
          </div>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: theme.navy, margin: 0 }}>
              Overall Status: {health.status.toUpperCase()}
            </h2>
            <p style={{ fontSize: 13, color: theme.textMid, margin: '4px 0 0 0' }}>
              {health.checks && Object.values(health.checks).filter(c => c.status === HealthStatus.HEALTHY).length} of {Object.keys(health.checks || {}).length} services healthy
            </p>
          </div>
        </div>
      </div>

      {/* Service Status Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16, marginBottom: 20 }}>
        {health.checks && Object.entries(health.checks).map(([service, check]) => (
          <div key={service} style={{
            padding: 16,
            backgroundColor: theme.cardBg,
            border: `1px solid ${theme.border}`,
            borderRadius: theme.radius.md,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{
                width: 40,
                height: 40,
                borderRadius: theme.radius.md,
                backgroundColor: getStatusColor(check.status) + '20',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: getStatusColor(check.status),
              }}>
                {getServiceIcon(service)}
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: theme.navy, margin: 0, textTransform: 'capitalize' }}>
                  {service}
                </h3>
                <p style={{ fontSize: 12, color: getStatusColor(check.status), margin: '2px 0 0 0', fontWeight: 600 }}>
                  {check.status.toUpperCase()}
                </p>
              </div>
            </div>
            <div style={{ fontSize: 12, color: theme.textMid }}>
              <p style={{ margin: '4px 0' }}>{check.message}</p>
              {check.responseTime && (
                <p style={{ margin: '4px 0', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Clock size={12} />
                  {check.responseTime}ms
                </p>
              )}
              {check.error && (
                <p style={{ margin: '4px 0', color: theme.danger, fontSize: 11 }}>
                  {check.error}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Performance Metrics */}
      {Object.keys(metrics).length > 0 && (
        <div style={{
          padding: 20,
          backgroundColor: theme.cardBg,
          border: `1px solid ${theme.border}`,
          borderRadius: theme.radius.lg,
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: theme.navy, margin: '0 0 16px 0' }}>
            Performance Metrics
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            {Object.entries(metrics).map(([name, stats]) => (
              <div key={name} style={{
                padding: 12,
                backgroundColor: theme.bg,
                borderRadius: theme.radius.md,
              }}>
                <h4 style={{ fontSize: 12, fontWeight: 600, color: theme.textMid, margin: '0 0 8px 0', textTransform: 'capitalize' }}>
                  {name.replace(/_/g, ' ')}
                </h4>
                <div style={{ fontSize: 24, fontWeight: 700, color: theme.navy, margin: '0 0 4px 0' }}>
                  {stats.avg.toFixed(0)}ms
                </div>
                <div style={{ fontSize: 11, color: theme.textMid }}>
                  Min: {stats.min.toFixed(0)}ms | Max: {stats.max.toFixed(0)}ms
                </div>
                <div style={{ fontSize: 11, color: theme.textMid }}>
                  Samples: {stats.count}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
