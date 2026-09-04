// Single place that reads and validates the Paystack secret key.
//
// The live "invalid key" incident was a publishable key (pk_live_...) sitting
// in PAYSTACK_SECRET_KEY. Paystack only accepts secret keys (sk_live_ or
// sk_test_) on server-side calls; a publishable key is rejected with a generic
// "Invalid key" message. Every Paystack call in this app now goes through
// these helpers so a misconfigured key fails fast with a descriptive error
// instead of a cryptic one from Paystack.
export function getPaystackSecretKey() {
  const key = process.env.PAYSTACK_SECRET_KEY || ''
  if (!key) {
    throw new Error('Paystack is not configured: PAYSTACK_SECRET_KEY is missing.')
  }
  if (!/^sk_(live|test)_/.test(key)) {
    throw new Error(
      'Invalid Paystack key: PAYSTACK_SECRET_KEY must be a secret key (starts with sk_live_ or sk_test_). ' +
      'The current value starts with "' + key.slice(0, 3) + '", which is a publishable key and is rejected by Paystack.'
    )
  }
  return key
}

export function paystackHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${getPaystackSecretKey()}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

const PAYSTACK_BASE = 'https://api.paystack.co'

export async function paystackFetch(path, options = {}) {
  const response = await fetch(PAYSTACK_BASE + path, {
    ...options,
    headers: paystackHeaders(options.headers),
  })
  const text = await response.text()
  if (!text) {
    throw new Error(`Paystack returned an empty response (HTTP ${response.status})`)
  }
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new Error(`Paystack returned invalid JSON: ${text.slice(0, 200)}`)
  }
}
