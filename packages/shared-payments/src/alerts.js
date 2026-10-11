// Owner security alerts ("your PIN changed", "a payout account was added") are best effort: they must never change the
// answer to the request that triggered them, and they used to vanish without a trace when the provider failed. This
// wrapper keeps the first property and adds the second: a failure is returned as `false` and logged as a structured
// `alert.failed` event (event name and a short, e-mail-free reason only). The retrying outbox for these mails is H05.

const defaultLogger = {
  warn: (event, fields) => console.warn(JSON.stringify({ event, ...fields })),
}

/**
 * @param {string} event            what the alert was about (pin_changed, pin_locked, payout_account_added ...)
 * @param {() => Promise<{ok?: boolean, error?: string}|void>} send
 * @returns {Promise<boolean>} true when the provider accepted it
 */
export async function sendSecurityAlert(event, send, { logger = defaultLogger } = {}) {
  try {
    const r = await send()
    if (r && r.ok === false) {
      logger.warn('alert.failed', { alert: event, reason: String(r.error || 'send_failed').replace(/\S+@\S+/g, '[email]').slice(0, 80) })
      return false
    }
    return true
  } catch (err) {
    logger.warn('alert.failed', { alert: event, reason: String(err?.message || 'exception').replace(/\S+@\S+/g, '[email]').slice(0, 80) })
    return false
  }
}
