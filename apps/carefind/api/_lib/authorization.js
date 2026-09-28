import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SUPER_ADMIN = 'super_admin'
const MODERATOR = 'moderator'

const ROLE_PERMISSIONS = {
  [SUPER_ADMIN]: [
    'manage_withdrawals',
    'manage_users',
    'manage_businesses',
    'manage_content',
    'manage_admins',
    'manage_promotions',
    'manage_tasks',
    'manage_ecommerce',
    'manage_agents',
    'manage_payouts',
    'manage_live_shows',
    'manage_stories',
    'manage_news',
    'manage_verifications',
    'manage_reports',
    'manage_transactions',
  ],
  [MODERATOR]: [
    'manage_content',
    'manage_news',
    'manage_verifications',
    'manage_reports',
    'manage_live_shows',
    'manage_stories',
  ],
}

export async function requireAdmin(req) {
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

export async function requirePermission(req, permission) {
  const { admin, status, error } = await requireAdmin(req)
  if (status) return { admin: null, status, error }

  const permissions = ROLE_PERMISSIONS[admin.role] || []
  if (!permissions.includes(permission)) {
    return { admin: null, status: 403, error: `Permission denied: ${permission} required` }
  }
  return { admin, status: null, error: null }
}

export async function requireRole(req, role) {
  const { admin, status, error } = await requireAdmin(req)
  if (status) return { admin: null, status, error }

  if (admin.role !== role) {
    return { admin: null, status: 403, error: `Role denied: ${role} required` }
  }
  return { admin, status: null, error: null }
}

export async function requireUser(req) {
  const authorization = req.headers?.authorization || req.headers?.Authorization || ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!token) return { user: null, status: 401, error: 'Unauthorized' }

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return { user: null, status: 401, error: 'Invalid or expired session' }
  return { user, status: null, error: null }
}

export async function requireOwnership(req, resourceType, resourceId) {
  const { user, status, error } = await requireUser(req)
  if (status) return { user: null, status, error }

  const { data: resource, error: fetchError } = await supabase
    .from(resourceType)
    .select('user_id')
    .eq('id', resourceId)
    .maybeSingle()

  if (fetchError || !resource) return { user: null, status: 404, error: 'Resource not found' }
  if (resource.user_id !== user.id) return { user: null, status: 403, error: 'Access denied' }
  return { user, status: null, error: null }
}

export { ROLE_PERMISSIONS, SUPER_ADMIN, MODERATOR }
