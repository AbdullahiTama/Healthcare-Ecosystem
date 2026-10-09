// Server-side bank lookups (code -> name) for the saved-payout-account flow. The name always comes from Paystack's list,
// never from the browser.
import { createBankDirectory } from '@care-ecosystem/shared-payments'
import { paystackFetch } from './paystack.js'

export const bankDirectory = createBankDirectory({ fetchFn: paystackFetch })
