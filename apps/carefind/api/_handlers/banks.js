// Proxies Paystack's banks list so the client doesn't need the secret key.
// Cached server-side for 5 minutes so we're not hitting Paystack on every
// dropdown open ΓÇö Paystack's bank list rarely changes.
import { paystackFetch } from '../_lib/paystack.js'

let cached = null
let cachedAt = 0

const PAGE_SIZE = 100
const MAX_PAGES = 10

// Paystack's /bank list with use_cursor=true is paginated:
//   { status, message, data: [...], meta: { next: bool, next_cursor: string } }
// Each page caps at `perPage`, and Nigeria has more banks than one page, so a
// single page silently drops the tail (the old "missing OPay/PalmPay/Kuda…"
// bug). This follows meta.next_cursor until meta.next is false, bounded by
// MAX_PAGES so a broken cursor can never loop forever.
// `fetchFn` is injectable for tests.
export async function fetchAllBanks(fetchFn = paystackFetch) {
  const banks = []
  let cursor
  let pages = 0

  do {
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
    const data = await fetchFn(`/bank?country=nigeria&use_cursor=true&perPage=${PAGE_SIZE}${cursorParam}`)

    // Fail loudly on a Paystack error instead of silently serving a partial
    // list as success (same behavior as before pagination).
    if (!data.status) {
      const err = new Error('Paystack error')
      err.code = 'PAYSTACK_FAILED'
      throw err
    }

    for (const b of (data.data || [])) banks.push({ code: b.code, name: b.name, slug: b.slug })

    cursor = data.meta?.next ? data.meta.next_cursor : undefined
    pages += 1
  } while (cursor && pages < MAX_PAGES)

  return banks
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  if (cached && Date.now() - cachedAt < 300000) {
    return res.status(200).json(cached)
  }

  try {
    const banks = await fetchAllBanks()
    cached = banks
    cachedAt = Date.now()
    return res.status(200).json(banks)
  } catch (err) {
    if (err.code === 'PAYSTACK_FAILED') return res.status(502).json({ error: 'Paystack error' })
    if (cached) return res.status(200).json(cached)
    return res.status(500).json({ error: err.message || 'Could not fetch banks' })
  }
}
