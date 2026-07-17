import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  function hashPassword(password) {
    return `cf_hashed_${password}`
  }

  function generateToken(adminId, role) {
    const payload = `${adminId}|${role}|${Date.now()}`
    return Buffer.from(payload).toString('base64')
  }

  function verifyToken(token) {
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf8')
      const parts = decoded.split('|')
      if (parts.length !== 3) return null
      const [adminId, role, timestamp] = parts
      if (Date.now() - parseInt(timestamp) > 86400000) return null
      return { adminId, role }
    } catch { return null }
  }

  const { action, email, password, token } = req.body

  if (action === 'login') {
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' })
    const hash = hashPassword(password)
    const { data: admin } = await supabase
      .from('admin_users')
      .select('id, email, full_name, role, is_active')
      .eq('email', email.toLowerCase())
      .eq('password_hash', hash)
      .eq('is_active', true)
      .maybeSingle()
    if (!admin) return res.status(401).json({ error: 'Invalid email or password' })
    await supabase.from('admin_users').update({ last_login: new Date().toISOString() }).eq('id', admin.id)
    const sessionToken = generateToken(admin.id, admin.role)
    return res.status(200).json({ token: sessionToken, admin: { id: admin.id, email: admin.email, full_name: admin.full_name, role: admin.role } })
  }

  if (action === 'verify') {
    if (!token) return res.status(401).json({ error: 'No token' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { data: admin } = await supabase.from('admin_users').select('id, email, full_name, role, is_active').eq('id', payload.adminId).eq('is_active', true).maybeSingle()
    if (!admin) return res.status(401).json({ error: 'Admin not found' })
    return res.status(200).json({ admin })
  }

  if (action === 'create_staff') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload || payload.role !== 'super_admin') return res.status(403).json({ error: 'Only super admin can create staff' })
    const { newEmail, newPassword, newName, newRole, teamId } = req.body
    if (!newEmail || !newPassword || !newName || !newRole) return res.status(400).json({ error: 'All fields required' })
    const { error } = await supabase.from('admin_users').insert({ email: newEmail.toLowerCase(), password_hash: hashPassword(newPassword), full_name: newName, role: newRole, team_id: teamId || null, created_by: payload.adminId })
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  if (action === 'list_staff') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload || payload.role !== 'super_admin') return res.status(403).json({ error: 'Only super admin can view staff' })
    const { data } = await supabase.from('admin_users').select('id, email, full_name, role, is_active, last_login, created_at').order('created_at')
    return res.status(200).json({ staff: data || [] })
  }

  if (action === 'list_teams') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { data } = await supabase.from('admin_teams').select('*').order('created_at')
    return res.status(200).json({ teams: data || [] })
  }

  if (action === 'create_team') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload || payload.role !== 'super_admin') return res.status(403).json({ error: 'Only super admin can create teams' })
    const { name } = req.body
    if (!name) return res.status(400).json({ error: 'Team name required' })
    const { error } = await supabase.from('admin_teams').insert({ name })
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  if (action === 'toggle_staff') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload || payload.role !== 'super_admin') return res.status(403).json({ error: 'Unauthorized' })
    const { staffId, isActive } = req.body
    await supabase.from('admin_users').update({ is_active: isActive }).eq('id', staffId)
    return res.status(200).json({ success: true })
  }

  if (action === 'approve_claim') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { claimId, businessId } = req.body
    if (!claimId || !businessId) return res.status(400).json({ error: 'claimId and businessId required' })
    const { error: claimError } = await supabase.from('business_claims').update({ status: 'approved' }).eq('id', claimId)
    if (claimError) return res.status(400).json({ error: claimError.message })
    const { error: bizError } = await supabase.from('businesses').update({ visible_on_carefind: true }).eq('id', businessId)
    if (bizError) return res.status(400).json({ error: bizError.message })
    return res.status(200).json({ success: true })
  }

  if (action === 'reject_claim') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { claimId } = req.body
    if (!claimId) return res.status(400).json({ error: 'claimId required' })
    const { error } = await supabase.from('business_claims').update({ status: 'rejected' }).eq('id', claimId)
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  return res.status(400).json({ error: 'Unknown action' })
}
