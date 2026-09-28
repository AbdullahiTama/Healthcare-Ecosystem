import crypto from 'crypto'

export function generateRequestId() {
  return crypto.randomUUID()
}

export function getRequestId(req) {
  return req.headers['x-request-id'] || generateRequestId()
}

export function sanitizeLogData(data) {
  if (!data || typeof data !== 'object') return data
  if (Array.isArray(data)) return data.map(sanitizeLogData)
  const sensitive = ['password', 'token', 'secret', 'authorization', 'pin', 'card', 'cvv', 'ssn']
  const sanitized = {}
  for (const [key, value] of Object.entries(data)) {
    if (sensitive.some(s => key.toLowerCase().includes(s))) {
      sanitized[key] = '[REDACTED]'
    } else if (value && typeof value === 'object') {
      sanitized[key] = sanitizeLogData(value)
    } else {
      sanitized[key] = value
    }
  }
  return sanitized
}

export function logApiRequest(req, res, duration, error = null) {
  const requestId = getRequestId(req)
  const userId = req.user?.id || null
  const tenantId = req.business?.id || null
  const operation = req.route?.path || req.url
  const statusCode = res.statusCode
  const errorCode = error?.code || null

  const logEntry = {
    timestamp: new Date().toISOString(),
    requestId,
    userId,
    tenantId,
    operation,
    method: req.method,
    path: req.url,
    statusCode,
    duration: `${duration.toFixed(2)}ms`,
    errorCode,
  }

  if (error) {
    logEntry.error = error.message
  }

  console.log('[API]', JSON.stringify(logEntry))
  return logEntry
}

export function logPaymentOperation({ requestId, userId, tenantId, paymentReference, providerReference, transactionType, amount, currency, idempotencyKey, status, error = null }) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    requestId,
    userId,
    tenantId,
    paymentReference,
    providerReference,
    transactionType,
    amount,
    currency,
    idempotencyKey,
    status,
  }

  if (error) {
    logEntry.error = error.message
  }

  console.log('[PAYMENT]', JSON.stringify(logEntry))
  return logEntry
}

export function logAuditEvent({ requestId, actorId, actorType, action, targetType, targetId, metadata = {}, status = 'success' }) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    requestId,
    actorId,
    actorType,
    action,
    targetType,
    targetId,
    metadata: sanitizeLogData(metadata),
    status,
  }

  console.log('[AUDIT]', JSON.stringify(logEntry))
  return logEntry
}

export function createAuditLogEntry(supabase, { requestId, actorId, actorType, action, targetType, targetId, metadata = {} }) {
  return supabase.from('admin_audit_log').insert({
    actor_admin_id: actorId,
    actor_type: actorType,
    action,
    target_table: targetType,
    target_id: String(targetId),
    after: sanitizeLogData(metadata),
    request_id: requestId,
  })
}

export function createApiAuditLogEntry(supabase, { requestId, actorId, actorType, action, targetType, targetId, metadata = {} }) {
  return supabase.from('audit_log').insert({
    actor_id: actorId,
    actor_type: actorType,
    action,
    target_table: targetType,
    target_id: String(targetId),
    after: sanitizeLogData(metadata),
    request_id: requestId,
  })
}
