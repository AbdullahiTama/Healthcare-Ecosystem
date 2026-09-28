import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export async function requireBusiness(req) {
  const authHeader = req.headers['authorization'] || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return { business: null, status: 401, error: 'not_logged_in' }

  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData?.user?.email) return { business: null, status: 401, error: 'not_logged_in' }

  const { data: business, error: bizErr } = await supabase
    .from('businesses')
    .select('id, email, plan, plan_expires_at, parent_business_id, is_platform_admin')
    .ilike('email', userData.user.email)
    .is('parent_business_id', null)
    .maybeSingle()

  if (bizErr || !business) return { business: null, status: 403, error: 'no_business' }
  return { business, status: null, error: null }
}

export async function requirePlatformAdmin(req) {
  const { business, status, error } = await requireBusiness(req)
  if (status) return { business: null, status, error }

  if (!business.is_platform_admin) {
    return { business: null, status: 403, error: 'Admin access required' }
  }
  return { business, status: null, error: null }
}

export async function requireBusinessOwnership(req, targetBusinessId) {
  const { business, status, error } = await requireBusiness(req)
  if (status) return { business: null, status, error }

  const { data: target, error: targetErr } = await supabase
    .from('businesses')
    .select('id')
    .eq('id', targetBusinessId)
    .or(`id.eq.${business.id},parent_business_id.eq.${business.id}`)
    .maybeSingle()

  if (targetErr || !target) return { business: null, status: 403, error: 'You do not own this business' }
  return { business, status: null, error: null }
}
