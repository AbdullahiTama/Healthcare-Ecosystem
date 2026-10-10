// The withdrawal bank list for both apps' /api/banks.
//
// The owner approved exactly this list, in this order: their original ten (Zenith, OPay, PalmPay,
// First Bank, UBA, Jaiz, Diamond, Kuda, Sterling, GTBank), then the tier-1 commercial banks and the
// digital banks added at their request. Every code and slug is Paystack's own (verified against GET
// /bank?country=nigeria, and each code probed through /bank/resolve without an "Unknown bank code"
// reply): the same code is sent to /bank/resolve (the account-name lookup) and to /transferrecipient
// (the payout), and Paystack accepts only its own codes for either. Diamond Bank merged into Access
// Bank; Paystack lists it as "Access Bank (Diamond)" under code 063, and a transfer to 063 lands in
// the customer's (Access) account.
//
// The list is static on purpose: a fixed set gains nothing from Paystack's live 288-bank directory,
// so the dropdown is exact and the endpoint needs no network, cache or fallback. Adding a bank is a
// one-line edit here (verify the code against /bank first).

export const NIGERIAN_BANKS = [
  { code: '057',    name: 'Zenith Bank',            slug: 'zenith-bank' },
  { code: '999992', name: 'OPay',                   slug: 'paycom' },
  { code: '999991', name: 'PalmPay',                slug: 'palmpay' },
  { code: '011',    name: 'First Bank of Nigeria',  slug: 'first-bank-of-nigeria' },
  { code: '033',    name: 'United Bank for Africa', slug: 'united-bank-for-africa' },
  { code: '301',    name: 'Jaiz Bank',              slug: 'jaiz-bank' },
  { code: '063',    name: 'Diamond Bank',           slug: 'access-bank-diamond' },
  { code: '50211',  name: 'Kuda',                   slug: 'kuda-bank' },
  { code: '232',    name: 'Sterling Bank',          slug: 'sterling-bank' },
  { code: '058',    name: 'GTBank',                 slug: 'guaranty-trust-bank' },
  { code: '044',    name: 'Access Bank',            slug: 'access-bank' },
  { code: '214',    name: 'First City Monument Bank', slug: 'first-city-monument-bank' },
  { code: '070',    name: 'Fidelity Bank',          slug: 'fidelity-bank' },
  { code: '221',    name: 'Stanbic IBTC Bank',      slug: 'stanbic-ibtc-bank' },
  { code: '032',    name: 'Union Bank of Nigeria',  slug: 'union-bank-of-nigeria' },
  { code: '035',    name: 'Wema Bank',              slug: 'wema-bank' },
  { code: '076',    name: 'Polaris Bank',           slug: 'polaris-bank' },
  { code: '050',    name: 'Ecobank Nigeria',        slug: 'ecobank-nigeria' },
  { code: '068',    name: 'Standard Chartered Bank', slug: 'standard-chartered-bank' },
  { code: '082',    name: 'Keystone Bank',          slug: 'keystone-bank' },
  { code: '215',    name: 'Unity Bank',             slug: 'unity-bank' },
  { code: '101',    name: 'Providus Bank',          slug: 'providus-bank' },
  { code: '023',    name: 'Citibank Nigeria',       slug: 'citibank-nigeria' },
  { code: '50515',  name: 'Moniepoint MFB',        slug: 'moniepoint-mfb-ng' },
  { code: '102',    name: 'Titan Bank',             slug: 'titan-bank' },
  { code: '00103',  name: 'Globus Bank',            slug: 'globus-bank' },
  { code: '107',    name: 'Optimus Bank Limited',   slug: 'optimus-bank-ltd' },
  { code: '104',    name: 'Parallex Bank',          slug: 'parallex-bank' },
  { code: '100',    name: 'Suntrust Bank',          slug: 'suntrust-bank' },
  { code: '035A',   name: 'ALAT by WEMA',           slug: 'alat-by-wema' },
]

// GET /api/banks: the list above, served as it is; any other method is 405.
export function createBanksHandler() {
  return async function banksHandler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
    return res.status(200).json(NIGERIAN_BANKS)
  }
}

// Server-side bank lookups for the saved-payout-account flow: it needs the bank's NAME for a CODE and must never trust a
// name from the browser. The directory is the same fixed list /api/banks serves, so a saved account can only name a bank
// the withdrawal form offers.
export function createBankDirectory({ banks = NIGERIAN_BANKS } = {}) {
  const list = async () => banks
  return { list, nameFor: async (code) => banks.find((b) => b.code === String(code))?.name || null }
}
