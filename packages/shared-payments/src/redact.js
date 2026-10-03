// Nothing that can authenticate us may reach a log line, an error message or a response body.

const PATTERNS = [
  [/\b[sp]k_(?:live|test)_[A-Za-z0-9]+/g, '[redacted-key]'],
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]'],
]

/**
 * @param {unknown} value
 * @param {string[]} [knownSecrets] exact secret strings to scrub in addition to the key patterns
 */
export function redactSecrets(value, knownSecrets = []) {
  let text = typeof value === 'string' ? value : value == null ? '' : String(value)
  for (const secret of knownSecrets) {
    if (secret && secret.length >= 8) text = text.split(secret).join('[redacted-key]')
  }
  for (const [re, replacement] of PATTERNS) text = text.replace(re, replacement)
  return text
}
