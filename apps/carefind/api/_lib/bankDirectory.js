// Server-side bank lookups (code -> name) for the saved-payout-account flow. The name always comes from the fixed
// withdrawal bank list in shared-payments, never from the browser.
import { createBankDirectory } from '@care-ecosystem/shared-payments'

export const bankDirectory = createBankDirectory()
