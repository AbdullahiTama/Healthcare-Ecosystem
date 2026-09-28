import crypto from 'crypto'

export function generateRequestId() {
  return crypto.randomUUID()
}

export function sendError(res, status, code, message, requestId) {
  const body = { error: { code, message } }
  if (requestId) body.error.request_id = requestId
  return res.status(status).json(body)
}

export function sanitizeError(err) {
  const msg = String(err?.message || 'Internal server error')
  if (msg.includes('stack') || msg.includes('at ') || msg.includes('file://')) {
    return 'Internal server error'
  }
  if (msg.includes('PGRST') || msg.includes('relation') || msg.includes('column') || msg.includes('schema')) {
    return 'Database error'
  }
  if (msg.includes('Paystack') || msg.includes('paystack')) {
    return 'Payment provider error'
  }
  return msg
}

export function handleHandlerError(err, res, requestId, route) {
  console.error(`[${route}] Error:`, err)
  const message = sanitizeError(err)
  return sendError(res, 500, 'INTERNAL_ERROR', message, requestId)
}
