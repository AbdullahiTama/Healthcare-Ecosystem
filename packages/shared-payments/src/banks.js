// The Nigerian bank list for withdrawal forms (both apps' /api/banks).
//
// The bank code a customer picks is sent to Paystack twice: to /bank/resolve (the account-name lookup) and to
// /transferrecipient (the payout). Both accept only PAYSTACK's codes. Paystack's own list is therefore the source of truth.
//
// The old list merged a curated set over Paystack's list "by code, curated first". The curated set carried NIBSS (NIP)
// codes for the online banks (OPay 090405, PalmPay 090410, Kuda 083). Those never collided with Paystack's codes for the
// same banks (999992, 999991, 50211), so the dropdown showed each of them twice. The curated copy, whose code Paystack does
// not recognise, could never resolve an account name or receive a transfer. Now Paystack's list is served as it is (sorted,
// one entry per code), and the curated set is only a fallback for when Paystack cannot be reached. Its codes are Paystack's.

export const FALLBACK_NIGERIAN_BANKS = [
  { code: '044', name: 'Access Bank', slug: 'access-bank' },
  { code: '023', name: 'Citibank Nigeria', slug: 'citibank-nigeria' },
  { code: '050', name: 'Ecobank Nigeria', slug: 'ecobank-nigeria' },
  { code: '070', name: 'Fidelity Bank', slug: 'fidelity-bank' },
  { code: '011', name: 'First Bank of Nigeria', slug: 'first-bank-of-nigeria' },
  { code: '214', name: 'First City Monument Bank', slug: 'first-city-monument-bank' },
  { code: '058', name: 'Guaranty Trust Bank', slug: 'guaranty-trust-bank' },
  { code: '030', name: 'Heritage Bank', slug: 'heritage-bank' },
  { code: '301', name: 'Jaiz Bank', slug: 'jaiz-bank' },
  { code: '082', name: 'Keystone Bank', slug: 'keystone-bank' },
  { code: '50211', name: 'Kuda Bank', slug: 'kuda-bank' },
  { code: '50515', name: 'Moniepoint MFB', slug: 'moniepoint-mfb' },
  { code: '999992', name: 'OPay', slug: 'paycom' },
  { code: '999991', name: 'PalmPay', slug: 'palmpay' },
  { code: '076', name: 'Polaris Bank', slug: 'polaris-bank' },
  { code: '101', name: 'Providus Bank', slug: 'providus-bank' },
  { code: '221', name: 'Stanbic IBTC Bank', slug: 'stanbic-ibtc-bank' },
  { code: '068', name: 'Standard Chartered Bank', slug: 'standard-chartered-bank' },
  { code: '232', name: 'Sterling Bank', slug: 'sterling-bank' },
  { code: '032', name: 'Union Bank of Nigeria', slug: 'union-bank-of-nigeria' },
  { code: '033', name: 'United Bank for Africa', slug: 'united-bank-for-africa' },
  { code: '215', name: 'Unity Bank', slug: 'unity-bank' },
  { code: '035', name: 'Wema Bank', slug: 'wema-bank' },
  { code: '057', name: 'Zenith Bank', slug: 'zenith-bank' },
]

const PAGE_SIZE = 100
const MAX_PAGES = 10

// Paystack's /bank list with use_cursor=true is paginated ({ data, meta: { next, next_cursor } }), and Nigeria has more banks
// than one page: follow next_cursor until meta.next is false, bounded by MAX_PAGES so a broken cursor cannot loop forever.
// `fetchFn(path)` is the app's authenticated Paystack GET; injectable for tests.
export async function fetchAllBanks(fetchFn) {
  const byCode = new Map()
  let cursor
  let pages = 0

  do {
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
    const data = await fetchFn(`/bank?country=nigeria&use_cursor=true&perPage=${PAGE_SIZE}${cursorParam}`)
    // a Paystack error is an error, never a silently partial list
    if (!data?.status) {
      const err = new Error('Paystack error')
      err.code = 'PAYSTACK_FAILED'
      throw err
    }
    for (const b of (data.data || [])) {
      if (b?.code && b?.name && !byCode.has(String(b.code))) byCode.set(String(b.code), { code: String(b.code), name: b.name, slug: b.slug })
    }
    cursor = data.meta?.next ? data.meta.next_cursor : undefined
    pages += 1
  } while (cursor && pages < MAX_PAGES)

  if (byCode.size === 0) {
    const err = new Error('Paystack returned no banks')
    err.code = 'PAYSTACK_FAILED'
    throw err
  }
  return Array.from(byCode.values()).sort((a, b) => a.name.localeCompare(b.name))
}

// The /api/banks handler both apps mount: Paystack's list, cached for 5 minutes; on failure the last good list, else the
// fallback list (whose codes are Paystack's, so a lookup still works for the banks it carries).
export function createBanksHandler({ fetchFn, ttlMs = 300_000, now = () => Date.now(), logger = console } = {}) {
  let cached = null
  let cachedAt = 0
  return async function banksHandler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
    if (cached && now() - cachedAt < ttlMs) return res.status(200).json(cached)
    try {
      cached = await fetchAllBanks(fetchFn)
      cachedAt = now()
      return res.status(200).json(cached)
    } catch (err) {
      logger.error?.('[banks] Paystack bank list unavailable:', err?.message)
      return res.status(200).json(cached || FALLBACK_NIGERIAN_BANKS)
    }
  }
}
