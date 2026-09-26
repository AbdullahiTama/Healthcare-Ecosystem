export async function requireAdmin(req, supabase) {
  const authorization = req.headers?.authorization || req.headers?.Authorization || ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!token) return { admin: null, status: 401, error: 'Unauthorized' }

  let authResult
  try {
    authResult = await supabase.auth.getUser(token)
  } catch {
    return { admin: null, status: 401, error: 'Invalid or expired session' }
  }

  const user = authResult?.data?.user
  if (authResult?.error || !user?.id) {
    return { admin: null, status: 401, error: 'Invalid or expired session' }
  }

  const { data: admin, error } = await supabase
    .from('admin_users')
    .select('id, email, full_name, role, is_active, role_id')
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (error) return { admin: null, status: 500, error: 'Database error while verifying admin identity' }
  if (!admin) return { admin: null, status: 403, error: 'Active admin access required' }
  return { admin, status: null, error: null }
}
