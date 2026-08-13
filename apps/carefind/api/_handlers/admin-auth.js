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

  // --------------------------------------------------------------------
  // Content moderation / user-account actions. These all previously wrote
  // directly to their tables from the browser with the anon key ΓÇö same
  // class of gap as approve_claim/reject_claim above (C14 in
  // Technical-Debt.md). No role restriction beyond a valid admin session,
  // matching every action above except the explicit super_admin-only ones.
  // --------------------------------------------------------------------

  if (action === 'approve_verification') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { id, userId, profession } = req.body
    if (!id || !userId || !profession) return res.status(400).json({ error: 'id, userId and profession required' })
    const { error: e1 } = await supabase.from('verification_requests').update({ status: 'approved' }).eq('id', id)
    if (e1) return res.status(400).json({ error: e1.message })
    const { error: e2 } = await supabase.from('profiles').update({ is_verified: true, verification_label: profession, specialty: profession }).eq('id', userId)
    if (e2) return res.status(400).json({ error: e2.message })
    return res.status(200).json({ success: true })
  }

  if (action === 'reject_verification') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { id } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    const { error } = await supabase.from('verification_requests').update({ status: 'rejected' }).eq('id', id)
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  if (action === 'manual_verify') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { userId, specialty } = req.body
    if (!userId || !specialty) return res.status(400).json({ error: 'userId and specialty required' })
    const { error } = await supabase.from('profiles').update({ is_verified: true, verification_label: specialty, specialty }).eq('id', userId)
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  if (action === 'suspend_user') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { userId, days } = req.body
    if (!userId || !days) return res.status(400).json({ error: 'userId and days required' })
    const suspendedUntil = new Date(Date.now() + parseInt(days) * 86400000).toISOString()
    const { error } = await supabase.from('profiles').update({ suspended_until: suspendedUntil, is_verified: false }).eq('id', userId)
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  if (action === 'delete_user') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { userId } = req.body
    if (!userId) return res.status(400).json({ error: 'userId required' })
    await supabase.from('post_reactions').delete().eq('user_id', userId)
    await supabase.from('post_comments').delete().eq('user_id', userId)
    await supabase.from('saved_posts').delete().eq('user_id', userId)
    await supabase.from('follows').delete().eq('follower_id', userId)
    await supabase.from('follows').delete().eq('following_id', userId)
    await supabase.from('posts').delete().eq('user_id', userId)
    const { error } = await supabase.from('profiles').delete().eq('id', userId)
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  if (action === 'delete_post') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { id } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    const { error } = await supabase.from('posts').delete().eq('id', id)
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  if (action === 'resolve_report') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { id } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    const { error } = await supabase.from('reports').update({ status: 'resolved' }).eq('id', id)
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  if (action === 'create_task') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { title, description, compensation, specialty } = req.body
    if (!title || !description || !compensation) return res.status(400).json({ error: 'title, description and compensation required' })
    const { error } = await supabase.from('tasks').insert({ title, description, compensation: parseInt(compensation), specialty: specialty || null })
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  if (action === 'approve_withdrawal') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { id } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    // request_withdrawal() already deducted the coins when the request was
    // filed, so approval is just a status change. Routed through a
    // SECURITY DEFINER RPC (row-locks the request) instead of a JS
    // read-then-write so two concurrent approve calls for the same request
    // (retry, stale tab, two admins) can't both pass the pending check.
    const { data: result, error } = await supabase.rpc('approve_withdrawal_request', { p_request_id: id })
    if (error) return res.status(400).json({ error: error.message })
    if (result !== 'ok') return res.status(400).json({ error: result === 'not_found' ? 'Withdrawal request not found' : `Already ${result.replace('already_', '')}` })
    return res.status(200).json({ success: true })
  }

  if (action === 'reject_withdrawal') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { id } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })

    // Coins were deducted when the request was filed ΓÇö a rejection has to
    // give them back, or they'd just vanish. reject_withdrawal_request()
    // does the pending-status check, the refund, and the status change as
    // one atomic unit (row-locked), replacing a JS read-balance/
    // compute-in-JS/write sequence that could double-refund under a
    // concurrent double-submit.
    const { data: result, error } = await supabase.rpc('reject_withdrawal_request', { p_request_id: id })
    if (error) return res.status(400).json({ error: error.message })
    if (result !== 'ok') return res.status(400).json({ error: result === 'not_found' ? 'Withdrawal request not found' : `Already ${result.replace('already_', '')}` })
    return res.status(200).json({ success: true })
  }

  // --- Live shows ---

  async function inviteGuests(showId, title, guestIds, inviteMessage) {
    for (const guestId of (guestIds || [])) {
      await supabase.from('live_participants').insert({ show_id: showId, user_id: guestId, role: 'guest' })
      await supabase.from('notifications').insert({
        recipient_id: guestId, type: 'live_invite',
        message: inviteMessage(title),
        link: `/live-dashboard/${showId}`,
      })
    }
  }

  if (action === 'schedule_show') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { title, scheduledAt, trailerUrl, guestIds } = req.body
    if (!title || !scheduledAt) return res.status(400).json({ error: 'title and scheduledAt required' })
    const { data: show, error } = await supabase.from('live_shows').insert({
      title, status: 'scheduled', host_id: null, is_platform: true,
      scheduled_at: new Date(scheduledAt).toISOString(), trailer_url: trailerUrl || null,
    }).select().maybeSingle()
    if (error || !show) return res.status(400).json({ error: error?.message || 'Could not schedule show' })
    await inviteGuests(show.id, title, guestIds, t => `invited you to co-host an upcoming live: "${t}"`)
    return res.status(200).json({ success: true, show })
  }

  if (action === 'start_live_show') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { title, guestIds } = req.body
    if (!title) return res.status(400).json({ error: 'title required' })
    const { data: show, error } = await supabase.from('live_shows').insert({
      title, status: 'live', host_id: null, is_platform: true,
    }).select().maybeSingle()
    if (error || !show) return res.status(400).json({ error: error?.message || 'Could not start show' })
    await inviteGuests(show.id, title, guestIds, t => `invited you to co-host a live show: "${t}"`)
    return res.status(200).json({ success: true, show })
  }

  if (action === 'start_scheduled_show') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { showId } = req.body
    if (!showId) return res.status(400).json({ error: 'showId required' })
    const { error } = await supabase.from('live_shows').update({ status: 'live', started_at: new Date().toISOString() }).eq('id', showId)
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  if (action === 'cancel_scheduled_show') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { showId } = req.body
    if (!showId) return res.status(400).json({ error: 'showId required' })
    const { error } = await supabase.from('live_shows').update({ status: 'ended' }).eq('id', showId)
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  if (action === 'end_live_show') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { showId } = req.body
    if (!showId) return res.status(400).json({ error: 'showId required' })
    const { error } = await supabase.from('live_shows').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', showId)
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  if (action === 'post_live_item') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { showId, kind, content } = req.body
    if (!showId || !kind || !content) return res.status(400).json({ error: 'showId, kind and content required' })
    const { error } = await supabase.from('live_items').insert({ show_id: showId, sender_id: null, kind, content })
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  if (action === 'hide_live_comment') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { id } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    const { error } = await supabase.from('live_comments').update({ hidden: true }).eq('id', id)
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  // --- Promotions ---

  if (action === 'create_promotion') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { title, linkUrl, imageUrl, days } = req.body
    if (!title) return res.status(400).json({ error: 'title required' })
    const expiresAt = new Date(Date.now() + parseInt(days || '7') * 86400000).toISOString()
    const { error } = await supabase.from('promotions').insert({ title, link_url: linkUrl || null, image_url: imageUrl || null, expires_at: expiresAt })
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  if (action === 'delete_promotion') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { id } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    const { error } = await supabase.from('promotions').delete().eq('id', id)
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  // --- News ---

  if (action === 'approve_news') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { id, edits } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    const { error } = await supabase.from('news').update({
      ...(edits || {}),
      status: 'approved',
      published_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  if (action === 'reject_news') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { id } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    const { error } = await supabase.from('news').update({ status: 'rejected' }).eq('id', id)
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  if (action === 'delete_news') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { id } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    const { error } = await supabase.from('news').delete().eq('id', id)
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  // --- Stories ---

  if (action === 'create_story') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { title, body, imageUrl, bgColor } = req.body
    if (!title && !body && !imageUrl) return res.status(400).json({ error: 'title, body or imageUrl required' })
    const expiresAt = new Date(Date.now() + 24 * 3600000).toISOString()
    const { error } = await supabase.from('stories').insert({
      title: title || null, body: body || null, image_url: imageUrl || null,
      bg_color: bgColor || '#0f766e', is_platform: true, expires_at: expiresAt,
    })
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  // --------------------------------------------------------------------
  // Admin-only reads (moderation queues). These previously read directly
  // from the browser with the anon key too ΓÇö once RLS actually restricts
  // these tables to self-only/approved-only access (C14), these plain
  // reads would return nothing for an admin session, which has no real
  // Supabase Auth session behind it. Same fix as the writes above: read
  // via the service-role client instead.
  // --------------------------------------------------------------------

  if (action === 'list_verification_requests') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { data } = await supabase.from('verification_requests').select('*').order('created_at', { ascending: false })
    return res.status(200).json({ data: data || [] })
  }

  if (action === 'list_reports') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { data } = await supabase.from('reports').select('*, posts(content)').order('created_at', { ascending: false }).limit(30)
    return res.status(200).json({ data: data || [] })
  }

  if (action === 'list_transactions') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { data } = await supabase.from('transactions').select('*').order('created_at', { ascending: false }).limit(50)
    return res.status(200).json({ data: data || [] })
  }

  if (action === 'list_withdrawal_requests') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { data } = await supabase.from('withdrawal_requests').select('*, profiles(full_name, display_name)').order('created_at', { ascending: false })
    return res.status(200).json({ data: data || [] })
  }

  if (action === 'list_task_submissions') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { data } = await supabase.from('task_submissions').select('*, tasks(title), profiles(full_name, display_name)').order('created_at', { ascending: false }).limit(20)
    return res.status(200).json({ data: data || [] })
  }

  if (action === 'list_business_claims') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { data } = await supabase.from('business_claims').select('*, businesses(name)').order('created_at', { ascending: false })
    return res.status(200).json({ data: data || [] })
  }

  if (action === 'list_news') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { data } = await supabase.from('news').select('*, profiles(full_name, display_name)').order('created_at', { ascending: false }).limit(60)
    const authorIds = [...new Set((data || []).map(n => n.author_id).filter(Boolean))]
    let phones = {}
    if (authorIds.length) {
      const { data: verifs } = await supabase.from('verification_requests').select('user_id, phone').in('user_id', authorIds)
      ;(verifs || []).forEach(v => { if (v.user_id && v.phone) phones[v.user_id] = v.phone })
    }
    return res.status(200).json({ data: data || [], phones })
  }

  if (action === 'list_search_logs') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { data } = await supabase.from('search_logs').select('id, query, category, results_count, found, user_id, created_at, profiles(full_name, display_name)').order('created_at', { ascending: false }).limit(300)
    return res.status(200).json({ data: data || [] })
  }

  if (action === 'delete_story') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { id } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    const { error } = await supabase.from('stories').delete().eq('id', id)
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  return res.status(400).json({ error: 'Unknown action' })
}
