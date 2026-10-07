// GET /api/banks: the Nigerian bank list for the withdrawal form, proxied so the client never needs the secret key.
// The list, its 5-minute cache and its fallback live in @care-ecosystem/shared-payments (banks.js), shared by both apps: the bank
// codes must be Paystack's, since the same code is sent to /bank/resolve (account-name lookup) and to the transfer.
import { createBanksHandler } from '@care-ecosystem/shared-payments'
import { paystackFetch } from '../_lib/paystack.js'

export default createBanksHandler({ fetchFn: paystackFetch })
