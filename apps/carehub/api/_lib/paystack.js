// Single place that reads and validates the Paystack secret key (same
// contract as apps/carefind/api/_lib/paystack.js). The live "invalid key"
// incident was a publishable key (pk_live_...) sitting in
// PAYSTACK_SECRET_KEY. Paystack only accepts secret keys (sk_live_ or
// sk_test_) on server-side calls.
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

export async function paystackFetch(path, options = {}) {
  const response = await fetch('https://api.paystack.co' + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${getPaystackSecretKey()}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  return response.json()
}
