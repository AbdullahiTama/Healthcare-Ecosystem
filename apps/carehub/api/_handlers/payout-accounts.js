import { createPayoutAccountsHandler } from '@care-ecosystem/shared-payments'
import { supabase } from '../_lib/supabase.js'
import { verifyBusiness } from '../_lib/verifyBusiness.js'
import { resolveAccount } from '../_lib/paystackTransfer.js'
import { bankDirectory } from '../_lib/bankDirectory.js'
import { getSecurityMailer } from '../_lib/securityMailer.js'

// POST /api/payout-accounts/{list,otp,add,default,remove}: the business's saved, verified bank accounts.
// The verified OWNER manages them (the parent business owns them; its branches withdraw to them). An account must
// belong to the verified owner or carry the registered business name. Rules: @care-ecosystem/shared-payments.
export default createPayoutAccountsHandler({
  supabase,
  authenticate: async (req) => {
    const { business, user, error } = await verifyBusiness(supabase, req)
    return error ? { status: 401, error } : { user, ownerType: 'business', ownerId: business.id, businessName: business.name }
  },
  resolveAccount,
  banks: bankDirectory,
  getMailer: getSecurityMailer,
})
