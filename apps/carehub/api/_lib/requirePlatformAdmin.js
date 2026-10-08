// Authorisation for the email admin endpoints, which run on the service-role client.
//
// CareHub ties identity to an email address (a platform admin is a businesses row with is_platform_admin = true whose
// email is the user's login email, the same rule notify-business-status.js and ecommerce-review.js use). Because the
// email is the identity, two details matter:
//  - the account's email must be CONFIRMED, or anyone could register an admin's address and inherit their rights;
//  - the lookup must not treat the address as a LIKE pattern, or an address containing _ or % could match another
//    admin's address by wildcard.
// Resolves to { user, status: null, error: null } for an admin, otherwise { status, error } ready to send.
export async function requirePlatformAdmin(req, supabase) {
  const authorization = req.headers?.authorization || req.headers?.Authorization || ''
  const token = authorization.replace(/^Bearer\s+/i, '').trim()
  if (!token) return { user: null, status: 401, error: 'Unauthorized' }

  let result
  try {
    result = await supabase.auth.getUser(token)
  } catch {
    return { user: null, status: 401, error: 'Invalid or expired session' }
  }
  const user = result?.data?.user
  if (result?.error || !user?.id || !user.email) {
    return { user: null, status: 401, error: 'Invalid or expired session' }
  }
  if (!user.email_confirmed_at) {
    return { user: null, status: 403, error: 'Confirm your email address first' }
  }

  const escaped = String(user.email).trim().replace(/[\\%_]/g, (c) => '\\' + c)
  const { data: rows, error } = await supabase
    .from('businesses')
    .select('id')
    .ilike('email', escaped)
    .eq('is_platform_admin', true)
    .limit(1)
  if (error) return { user: null, status: 500, error: 'Database error while verifying admin identity' }
  if (!rows || rows.length === 0) return { user: null, status: 403, error: 'Platform admin access required' }
  return { user, status: null, error: null }
}
