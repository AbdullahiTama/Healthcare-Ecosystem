import { createClient } from '@supabase/supabase-js'
import { createDojahFromEnv, createKycHandler } from '@care-ecosystem/shared-payments'
import { verifyUser } from '../_lib/verifyUser.js'

// POST /api/kyc/{status,verify,selfie}: identity verification (BVN + NIN, optional selfie) through Dojah.
// The rules live in @care-ecosystem/shared-payments and are shared with CareHub.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
let provider

export default createKycHandler({
  supabase,
  authenticate: async (req) => {
    const user = await verifyUser(supabase, req)
    return user ? { user } : { status: 401, error: 'Not signed in' }
  },
  getProvider: () => (provider ||= createDojahFromEnv()),
})
