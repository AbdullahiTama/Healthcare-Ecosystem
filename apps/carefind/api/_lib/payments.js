import { PaystackProvider } from '@care-ecosystem/shared-payments'

// The one Paystack provider for CareFind's server code (shared-payments adapter: timeouts, safe
// retries, correlation ids, secret redaction). The key is read lazily from the environment so a
// missing/rotated key never breaks module import.
export const paymentLogger = {
  info: (msg, fields) => console.log(JSON.stringify({ level: 'info', msg, ...fields })),
  warn: (msg, fields) => console.warn(JSON.stringify({ level: 'warn', msg, ...fields })),
  error: (msg, fields) => console.error(JSON.stringify({ level: 'error', msg, ...fields })),
}

let provider
export function getPaystackProvider() {
  if (!provider) {
    provider = new PaystackProvider({
      getSecretKey: () => process.env.PAYSTACK_SECRET_KEY,
      http: { logger: paymentLogger },
    })
  }
  return provider
}
