import { createClient } from '@supabase/supabase-js'
import { createPayoutAccountsHandler } from '@care-ecosystem/shared-payments'
import { verifyUser } from '../_lib/verifyUser.js'
import { resolveAccount } from '../_lib/paystackTransfer.js'
import { bankDirectory } from '../_lib/bankDirectory.js'
import { getSecurityMailer } from '../_lib/securityMailer.js'

// POST /api/payout-accounts/{list,otp,add,default,remove}: saved, verified bank accounts for withdrawals.
// A CareFind user owns their own accounts. Rules: @care-ecosystem/shared-payments (shared with CareHub).
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

export default createPayoutAccountsHandler({
  supabase,
  authenticate: async (req) => {
    const user = await verifyUser(supabase, req)
    return user ? { user, ownerType: 'user', ownerId: user.id } : { status: 401, error: 'Not signed in' }
  },
  resolveAccount,
  banks: bankDirectory,
  getMailer: getSecurityMailer,
})
