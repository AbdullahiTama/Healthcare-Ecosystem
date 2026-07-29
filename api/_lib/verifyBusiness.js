// Verifies the Supabase session token a client sent, then resolves it to a
// CareHub business the same way the live RLS policies already do
// (current_business_ids() in sql/phase2_rls_pilot.sql): a business's own
// login email, matched case-insensitively. CareHub ties identity to
// businesses.email rather than a business.owner_id foreign key, so this
// mirrors that instead of assuming a shape CareFind's simpler user_id
// model has but CareHub doesn't.
export async function verifyBusiness(supabase, req) {
  const authHeader = req.headers['authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return { error: 'not_logged_in' }

  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData?.user?.email) return { error: 'not_logged_in' }

  // Branches share their parent's email (Locations.jsx's addBranch() copies
  // it verbatim), so matching on email alone can return several rows —
  // billing is a parent-level concept (a branch doesn't pay separately),
  // and only an owner (not staff, who match via a different table) should
  // be able to renew, so this scopes to exactly the top-level business row.
  const { data: business } = await supabase
    .from('businesses')
    .select('id, email, plan, plan_expires_at, parent_business_id')
    .ilike('email', userData.user.email)
    .is('parent_business_id', null)
    .maybeSingle()

  if (!business) return { error: 'no_business' }
  return { business }
}
