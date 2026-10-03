// Does this signed-in user own this business?
//
// Mirrors CareHub's identity model: businesses.email is the owner's login email (matched
// exactly, case-insensitively - never with ilike, whose `_`/`%` are wildcards). Branches share
// their parent's email, so the parent's owner also owns the branch.
// An unknown business and a business the caller does not own both yield false.
export async function userOwnsBusiness(supabase, user, businessId) {
  const callerEmail = String(user?.email || '').trim().toLowerCase()
  if (!callerEmail || !businessId) return false

  const { data: biz } = await supabase
    .from('businesses')
    .select('id, email, parent_business_id')
    .eq('id', businessId)
    .maybeSingle()
  if (!biz) return false
  if (String(biz.email || '').trim().toLowerCase() === callerEmail) return true

  if (!biz.parent_business_id) return false
  const { data: parent } = await supabase
    .from('businesses')
    .select('email')
    .eq('id', biz.parent_business_id)
    .maybeSingle()
  return String(parent?.email || '').trim().toLowerCase() === callerEmail
}
