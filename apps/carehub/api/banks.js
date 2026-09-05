// Proxies Paystack's banks list so the client doesn't need the secret key.
// Cached server-side for 5 minutes so we're not hitting Paystack on every
// dropdown open — Paystack's bank list rarely changes.
import { paystackFetch } from './_lib/paystack.js'

// Curated list of major Nigerian banks — ensures the most common ones
// are always available even if Paystack's paginated list has issues.
// Codes match Paystack's official bank codes.
export const MAJOR_NIGERIAN_BANKS = [
  { code: '044', name: 'Access Bank', slug: 'access-bank' },
  { code: '035', name: 'ALAT by WEMA', slug: 'alat-by-wema' },
  { code: '090021', name: 'Carbon', slug: 'carbon' },
  { code: '023', name: 'Citibank Nigeria', slug: 'citibank-nigeria' },
  { code: '502', name: 'Coronation Merchant Bank', slug: 'coronation-merchant-bank' },
  { code: '050', name: 'Ecobank Nigeria', slug: 'ecobank-nigeria' },
  { code: '070', name: 'Fidelity Bank', slug: 'fidelity-bank' },
  { code: '011', name: 'First Bank of Nigeria', slug: 'first-bank-of-nigeria' },
  { code: '214', name: 'First City Monument Bank', slug: 'first-city-monument-bank' },
  { code: '058', name: 'Guaranty Trust Bank', slug: 'guaranty-trust-bank' },
  { code: '030', name: 'Heritage Bank', slug: 'heritage-bank' },
  { code: '301', name: 'Jaiz Bank', slug: 'jaiz-bank' },
  { code: '082', name: 'Keystone Bank', slug: 'keystone-bank' },
  { code: '083', name: 'Kuda Bank', slug: 'kuda-bank' },
  { code: '505', name: 'Lotus Bank', slug: 'lotus-bank' },
  { code: '50515', name: 'Moniepoint MFB', slug: 'moniepoint-mfb' },
  { code: '090405', name: 'OPay', slug: 'opay' },
  { code: '090410', name: 'PalmPay', slug: 'palmpay' },
  { code: '107', name: 'Polaris Bank', slug: 'polaris-bank' },
  { code: '101', name: 'Providus Bank', slug: 'providus-bank' },
  { code: '221', name: 'Stanbic IBTC Bank', slug: 'stanbic-ibtc-bank' },
  { code: '068', name: 'Standard Chartered Bank', slug: 'standard-chartered-bank' },
  { code: '232', name: 'Sterling Bank', slug: 'sterling-bank' },
  { code: '100', name: 'SunTrust Bank', slug: 'suntrust-bank' },
  { code: '032', name: 'Union Bank of Nigeria', slug: 'union-bank-of-nigeria' },
  { code: '033', name: 'United Bank for Africa', slug: 'united-bank-for-africa' },
  { code: '215', name: 'Unity Bank', slug: 'unity-bank' },
  { code: '035', name: 'Wema Bank', slug: 'wema-bank' },
  { code: '057', name: 'Zenith Bank', slug: 'zenith-bank' },
]

let cached = null
let cachedAt = 0

const PAGE_SIZE = 100
const MAX_PAGES = 10

// Paystack's /bank list with use_cursor=true is paginated.
// This follows meta.next_cursor until meta.next is false, bounded by
// MAX_PAGES so a broken cursor can never loop forever.
export async function fetchAllBanks(fetchFn = paystackFetch) {
  const banks = []
  let cursor
  let pages = 0

  do {
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
    const data = await fetchFn(`/bank?country=nigeria&use_cursor=true&perPage=${PAGE_SIZE}${cursorParam}`)

    if (!data.status) {
      const err = new Error('Paystack error')
      err.code = 'PAYSTACK_FAILED'
      throw err
    }

    for (const b of (data.data || [])) banks.push({ code: b.code, name: b.name, slug: b.slug })

    cursor = data.meta?.next ? data.meta.next_cursor : undefined
    pages += 1
  } while (cursor && pages < MAX_PAGES)

  // Merge with curated list — curated takes priority for known major banks
  const curatedByCode = new Map(MAJOR_NIGERIAN_BANKS.map(b => [b.code, b]))
  for (const b of banks) {
    if (!curatedByCode.has(b.code)) curatedByCode.set(b.code, b)
  }
  return Array.from(curatedByCode.values())
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
    // Fallback to curated list if everything fails
    return res.status(200).json(MAJOR_NIGERIAN_BANKS)
  }
}
