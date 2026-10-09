import { createDojahFromEnv, createKycHandler } from '@care-ecosystem/shared-payments'
import { supabase } from '../_lib/supabase.js'
import { verifyBusiness } from '../_lib/verifyBusiness.js'

// POST /api/kyc/{status,verify,selfie}: identity verification of the business OWNER (BVN + NIN, optional selfie)
// through Dojah. The person, not the business, is what gets verified; the same verification serves their CareFind
// account. The rules live in @care-ecosystem/shared-payments and are shared with CareFind.
let provider

export default createKycHandler({
  supabase,
  authenticate: async (req) => {
    const { user, error } = await verifyBusiness(supabase, req)
    return error ? { status: 401, error } : { user }
  },
  getProvider: () => (provider ||= createDojahFromEnv()),
})
