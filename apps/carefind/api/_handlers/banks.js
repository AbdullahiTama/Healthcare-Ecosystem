// GET /api/banks: the fixed withdrawal bank list, shared by both apps in
// @care-ecosystem/shared-payments (banks.js): the codes are Paystack's, since the same code is
// sent to /bank/resolve (account-name lookup) and to the transfer.
import { createBanksHandler } from '@care-ecosystem/shared-payments'

export default createBanksHandler()
