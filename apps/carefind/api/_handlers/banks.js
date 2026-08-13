// Proxies Paystack's banks list so the client doesn't need the secret key.
// Cached server-side for 5 minutes so we're not hitting Paystack on every
// dropdown open ΓÇö Paystack's bank list rarely changes.
import { paystackFetch } from '../_lib/paystack.js'

let cached = null
let cachedAt = 0

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  if (cached && Date.now() - cachedAt < 300000) {
    return res.status(200).json(cached)
  }

  try {
    const data = await paystackFetch('/bank?country=nigeria&use_cursor=true&perPage=100')
    if (!data.status) return res.status(502).json({ error: 'Paystack error' })

    const banks = data.data.map(b => ({ code: b.code, name: b.name, slug: b.slug }))
    cached = banks
    cachedAt = Date.now()
    return res.status(200).json(banks)
  } catch (err) {
    if (cached) return res.status(200).json(cached)
    return res.status(500).json({ error: err.message || 'Could not fetch banks' })
  }
}
