import { createClient } from '@supabase/supabase-js'
import { processBatch as flushOutbox } from '../_lib/emailService.js'

export default async function handler(req, res) {
  try {
    return await handleRequest(req, res)
  } catch (err) {
    console.error('[admin-auth] Unhandled error:', err)
    return res.status(500).json({ error: 'Internal server error: ' + (err.message || 'Unknown error') })
  }
}

async function handleRequest(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' })
  }

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
    try {
      if (!email) return res.status(400).json({ error: 'Email required' })
      const { data: admin, error: queryErr } = await supabase
        .from('admin_users')
        .select('id, email, full_name, role, is_active')
        .eq('email', email.toLowerCase())
        .eq('is_active', true)
        .maybeSingle()
      if (queryErr) return res.status(500).json({ error: 'Database error: ' + queryErr.message })
      if (!admin) return res.status(401).json({ error: 'No active admin account for this email' })
      await supabase.from('admin_users').update({ last_login: new Date().toISOString() }).eq('id', admin.id)
      const sessionToken = generateToken(admin.id, admin.role)
      let perms = {}
      try { const r = await supabase.rpc('get_admin_permissions', { p_admin_id: admin.id }); perms = r.data || {} } catch {}
      return res.status(200).json({ token: sessionToken, admin: { id: admin.id, email: admin.email, full_name: admin.full_name, role: admin.role }, permissions: perms })
    } catch (err) {
      return res.status(500).json({ error: 'Login failed: ' + (err.message || 'Unknown error') })
    }
  }

  if (action === 'verify') {
    try {
      if (!token) return res.status(401).json({ error: 'No token' })
      const payload = verifyToken(token)
      if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
      const { data: admin, error: queryErr } = await supabase.from('admin_users').select('id, email, full_name, role, is_active, role_id').eq('id', payload.adminId).eq('is_active', true).maybeSingle()
      if (queryErr) return res.status(500).json({ error: 'Database error: ' + queryErr.message })
      if (!admin) return res.status(401).json({ error: 'Admin not found' })
      let perms = {}
      try { const r = await supabase.rpc('get_admin_permissions', { p_admin_id: admin.id }); perms = r.data || {} } catch {}
      return res.status(200).json({ admin, permissions: perms || {} })
    } catch (err) {
      return res.status(500).json({ error: 'Verification failed: ' + (err.message || 'Unknown error') })
    }
  }

  if (action === 'create_staff') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload || payload.role !== 'super_admin') return res.status(403).json({ error: 'Only super admin can create staff' })
    const { newEmail, newPassword, newName, newRole, teamId, roleId } = req.body
    if (!newEmail || !newPassword || !newName || !newRole) return res.status(400).json({ error: 'All fields required' })
    const insertData = { email: newEmail.toLowerCase(), password_hash: hashPassword(newPassword), full_name: newName, role: newRole, team_id: teamId || null, created_by: payload.adminId }
    if (roleId) insertData.role_id = roleId
    const { error } = await supabase.from('admin_users').insert(insertData)
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

  if (action === 'list_posts') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { search, type, dateFrom, dateTo, limit: lim, offset } = req.body
    let query = supabase
      .from('posts')
      .select('id, content, post_type, created_at, user_id, image_url, image_urls, video_url, audio_url, theme, rating, view_count, subscriber_only')
      .order('created_at', { ascending: false })
      .limit(lim || 50)
    if (offset) query = query.range(offset, offset + (lim || 50) - 1)
    if (type && type !== 'all') query = query.eq('post_type', type)
    if (dateFrom) query = query.gte('created_at', dateFrom)
    if (dateTo) query = query.lte('created_at', dateTo + 'T23:59:59')
    if (search) query = query.ilike('content', `%${search}%`)
    const { data, error } = await query
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ data: data || [] })
  }

  if (action === 'list_user_profiles') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { search, verified, specialty, limit: lim, offset } = req.body
    let query = supabase
      .from('profiles')
      .select('id, full_name, display_name, is_verified, verification_label, specialty, location, website, created_at, cover_url')
      .order('created_at', { ascending: false })
      .limit(lim || 100)
    if (offset) query = query.range(offset, offset + (lim || 100) - 1)
    if (verified === 'verified') query = query.eq('is_verified', true)
    else if (verified === 'unverified') query = query.neq('is_verified', true)
    if (specialty) query = query.ilike('specialty', `%${specialty}%`)
    if (search) query = query.or(`full_name.ilike.%${search}%,display_name.ilike.%${search}%`)
    const { data, error } = await query
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ data: data || [] })
  }

  if (action === 'get_user_profile') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { userId } = req.body
    if (!userId) return res.status(400).json({ error: 'Missing userId' })
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, display_name, is_verified, verification_label, cover_url')
      .eq('id', userId)
      .single()
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ data: data || null })
  }

  if (action === 'get_user_posts') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { userId, limit: lim } = req.body
    if (!userId) return res.status(400).json({ error: 'Missing userId' })
    const { data, error } = await supabase
      .from('posts')
      .select('id, content, post_type, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(lim || 10)
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ data: data || [] })
  }

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

  // --------------------------------------------------------------------
  // Credential review (issue #5). The `credentials` bucket holds professional
  // licences, MDCN/PCN certificates and work IDs — identity documents — and
  // is now PRIVATE (20260822_credentials_bucket_hardening.sql). It used to be
  // a public bucket, so AdminPanel could link straight at credential_url and
  // so could anyone else who had or guessed that URL.
  //
  // Reviewers reach a document through here instead: this handler holds the
  // service-role key, so it is the one caller that can read another user's
  // object, and it hands back a URL that expires. Requires a valid admin
  // session, same as every other action above.
  // --------------------------------------------------------------------
  if (action === 'credential_url') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })

    const { requestId } = req.body
    if (!requestId) return res.status(400).json({ error: 'requestId required' })

    const { data: request, error: readError } = await supabase
      .from('verification_requests')
      .select('id, credential_url')
      .eq('id', requestId)
      .maybeSingle()
    if (readError) return res.status(400).json({ error: readError.message })
    if (!request || !request.credential_url) {
      return res.status(404).json({ error: 'This request has no credential document attached.' })
    }

    // Rows written before this change stored a full public URL; rows written
    // after store the bare object path. Accept both, and never let a stored
    // value walk out of the bucket.
    const stored = String(request.credential_url)
    const marker = '/credentials/'
    const idx = stored.indexOf(marker)
    const objectPath = (idx >= 0 ? stored.slice(idx + marker.length) : stored).replace(/^\/+/, '')
    if (!objectPath || objectPath.includes('..')) {
      return res.status(400).json({ error: 'Stored credential path is not usable.' })
    }

    const { data: signed, error: signError } = await supabase.storage
      .from('credentials')
      .createSignedUrl(objectPath, 300) // five minutes is long enough to review
    if (signError) return res.status(400).json({ error: signError.message })

    return res.status(200).json({ url: signed.signedUrl, expiresIn: 300 })
  }

  // --------------------------------------------------------------------
  // Shop / E-commerce admin (Spec A18)
  // --------------------------------------------------------------------
  if (action === 'list_ecommerce_applications') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { data } = await supabase.from('ecommerce_applications').select('*, businesses(name, business_type, city, state)').order('created_at', { ascending: false }).limit(100)
    return res.status(200).json({ data: data || [] })
  }
  if (action === 'update_ecommerce_application') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { id, status, rejection_reason } = req.body
    if (!id || !status) return res.status(400).json({ error: 'id and status required' })
    const allowed = ['Approved','Rejected','Suspended','Under Review']
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' })
    const patch = { status, updated_at: new Date().toISOString(), reviewed_at: new Date().toISOString(), reviewer_id: payload.adminId }
    if (rejection_reason) patch.rejection_reason = rejection_reason
    const { error } = await supabase.from('ecommerce_applications').update(patch).eq('id', id)
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }
  if (action === 'list_ecommerce_products_admin') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { data } = await supabase.from('ecommerce_products').select('id,status,category,prescription_required,is_restricted,active_at,business_id,product_id, businesses(name), products(name,price,stock)').order('created_at', { ascending: false }).limit(100)
    return res.status(200).json({ data: data || [] })
  }
  if (action === 'moderate_ecommerce_product') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { id, is_restricted, status } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    const patch = {}
    if (typeof is_restricted === 'boolean') patch.is_restricted = is_restricted
    if (status) patch.status = status
    patch.updated_at = new Date().toISOString()
    const { error } = await supabase.from('ecommerce_products').update(patch).eq('id', id)
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }
  if (action === 'list_shop_orders_admin') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { data } = await supabase.from('shop_orders').select('*, shop_order_items(*)').order('created_at', { ascending: false }).limit(50)
    return res.status(200).json({ data: data || [] })
  }
  if (action === 'admin_update_shop_order_status') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { orderId, status, note } = req.body
    if (!orderId || !status) return res.status(400).json({ error: 'orderId and status required' })
    const { error } = await supabase.rpc('update_shop_order_status', { p_order_id: orderId, p_to_status: status, p_changed_by: null, p_note: note || null })
    if (error) return res.status(400).json({ error: error.message })

    const NOTIF_MAP = {
      paid: 'payment_confirmed', accepted: 'order_processing', processing: 'order_processing',
      packed: 'order_packed', at_pickup_station: 'at_pickup_station',
      ready_for_pickup: 'ready_for_pickup', in_transit: 'out_for_delivery', delivered: 'order_delivered',
    }
    const NOTIF_MESSAGES = {
      payment_confirmed: 'Your payment has been confirmed.',
      order_processing: 'Your order is being processed.',
      order_packed: 'Your order has been packed.',
      at_pickup_station: 'Your order is now at the pickup station.',
      ready_for_pickup: 'Your order is ready for pickup.',
      out_for_delivery: 'Your order is out for delivery.',
      order_delivered: 'Your order has been delivered.',
    }
    const notifType = NOTIF_MAP[status]
    if (notifType) {
      const { data: order } = await supabase.from('shop_orders').select('customer_id').eq('id', orderId).maybeSingle()
      if (order?.customer_id) {
        try { await supabase.rpc('record_shop_notification', {
          p_order_id: orderId, p_notification_type: notifType,
          p_message: NOTIF_MESSAGES[notifType] || 'Order status updated.',
          p_recipient_id: order.customer_id,
        }) } catch {}
      }
    }
    if (status === 'delivered') {
      const { data: order } = await supabase.from('shop_orders').select('customer_id').eq('id', orderId).maybeSingle()
      if (order?.customer_id) {
        try { await supabase.rpc('record_shop_notification', {
          p_order_id: orderId, p_notification_type: 'review_request',
          p_message: 'How was your order? Leave a review to help other customers.',
          p_recipient_id: order.customer_id,
        }) } catch {}
      }
    }

    // Order status email: enqueued by DB trigger on shop_orders status change.
    // Trigger covers the admin handler AND CareHub vendor-side RPC calls.
    flushOutbox().catch((err) => {
      console.error('[admin-auth] outbox flush error:', err)
    })
    return res.status(200).json({ success: true })
  }

  // --- Shop Admin: Enhanced Order Management ---

  if (action === 'get_shop_order_detail') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { orderId } = req.body
    if (!orderId) return res.status(400).json({ error: 'orderId required' })
    const { data: order, error } = await supabase
      .from('shop_orders')
      .select('*, shop_order_items(*), shop_order_status_history(*), shop_payments(*), shop_pickup_stations(*), businesses!shop_orders_vendor_business_id_fkey(id, name, business_type, city, state, whatsapp, address), profiles!shop_orders_customer_id_fkey(id, full_name, display_name, email)')
      .eq('id', orderId)
      .maybeSingle()
    if (error) return res.status(400).json({ error: error.message })
    if (!order) return res.status(404).json({ error: 'Order not found' })
    const { data: tracking } = await supabase.from('shop_order_tracking_events').select('*').eq('order_id', orderId).order('created_at')
    let notifications = []
    try { const r = await supabase.rpc('get_order_notification_history', { p_order_id: orderId }); notifications = r.data || [] } catch {}
    const { data: messages } = await supabase.from('shop_order_messages').select('*, profiles(full_name, display_name)').eq('order_id', orderId).order('created_at')
    return res.status(200).json({ data: { ...order, tracking_events: tracking || [], notifications: notifications || [], messages: messages || [] } })
  }

  if (action === 'list_shop_orders_filtered') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { status, vendorId, customerId, dateFrom, dateTo, search, limit: lim } = req.body
    let query = supabase.from('shop_orders').select('*, shop_order_items(*), businesses!shop_orders_vendor_business_id_fkey(id, name, business_type, city), profiles!shop_orders_customer_id_fkey(id, full_name, display_name)', { count: 'exact' }).order('created_at', { ascending: false }).limit(lim || 100)
    if (status) query = query.eq('status', status)
    if (vendorId) query = query.eq('vendor_business_id', vendorId)
    if (customerId) query = query.eq('customer_id', customerId)
    if (dateFrom) query = query.gte('created_at', dateFrom)
    if (dateTo) query = query.lte('created_at', dateTo + 'T23:59:59')
    if (search) query = query.or(`order_ref.ilike.%${search}%,customer_name.ilike.%${search}%`)
    const { data, count, error } = await query
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ data: data || [], count: count || 0 })
  }

  if (action === 'get_admin_shop_overview') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { data, error } = await supabase.rpc('get_admin_shop_overview')
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ data: data || {} })
  }

  // --- Shop Admin: Customer Intelligence ---

  if (action === 'get_customer_purchase_history') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { customerId } = req.body
    if (!customerId) return res.status(400).json({ error: 'customerId required' })
    const { data: orders, error } = await supabase
      .from('shop_orders')
      .select('*, shop_order_items(*), businesses!shop_orders_vendor_business_id_fkey(id, name, business_type, city)')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) return res.status(400).json({ error: error.message })
    let summary = {}
    try { const r = await supabase.rpc('get_customer_purchase_summary', { p_customer_id: customerId }); summary = r.data || {} } catch {}
    const { data: profile } = await supabase.from('profiles').select('id, full_name, display_name, email, phone').eq('id', customerId).maybeSingle()
    return res.status(200).json({ orders: orders || [], summary: summary || {}, profile: profile || {} })
  }

  if (action === 'list_shop_customers') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { search } = req.body
    let query = supabase.rpc('get_admin_shop_overview').then(() => null)
    const { data: orders } = await supabase
      .from('shop_orders')
      .select('customer_id, customer_name, total_kobo, status, created_at, vendor_business_id')
      .order('created_at', { ascending: false })
      .limit(1000)
    const customerMap = {}
    ;(orders || []).forEach(o => {
      if (!customerMap[o.customer_id]) {
        customerMap[o.customer_id] = { customer_id: o.customer_id, customer_name: o.customer_name, total_orders: 0, total_spent_kobo: 0, completed_orders: 0, last_order_at: null }
      }
      const c = customerMap[o.customer_id]
      if (o.status !== 'cancelled') { c.total_orders++; c.total_spent_kobo += (o.total_kobo || 0) }
      if (o.status === 'delivered') c.completed_orders++
      if (!c.last_order_at || o.created_at > c.last_order_at) c.last_order_at = o.created_at
      if (o.customer_name && !c.customer_name) c.customer_name = o.customer_name
    })
    let customers = Object.values(customerMap).sort((a, b) => b.total_spent_kobo - a.total_spent_kobo)
    if (search) {
      const q = search.toLowerCase()
      customers = customers.filter(c => (c.customer_name || '').toLowerCase().includes(q) || (c.customer_id || '').includes(q))
    }
    return res.status(200).json({ data: customers.slice(0, 100) })
  }

  // --- Shop Admin: Vendor & Fulfilment ---

  if (action === 'get_vendor_order_summary') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { vendorId } = req.body
    if (!vendorId) return res.status(400).json({ error: 'vendorId required' })
    const { data: biz } = await supabase.from('businesses').select('id, name, business_type, city, state, whatsapp, address').eq('id', vendorId).maybeSingle()
    const { data: orders } = await supabase.from('shop_orders').select('*, shop_order_items(*)').eq('vendor_business_id', vendorId).order('created_at', { ascending: false }).limit(200)
    const stats = { total_orders: 0, pending: 0, processing: 0, delivered: 0, cancelled: 0, revenue_kobo: 0 }
    ;(orders || []).forEach(o => {
      stats.total_orders++
      if (['pending_payment', 'paid'].includes(o.status)) stats.pending++
      else if (['accepted', 'processing', 'ready_for_pickup', 'in_transit'].includes(o.status)) stats.processing++
      else if (o.status === 'delivered') { stats.delivered++; stats.revenue_kobo += (o.total_kobo || 0) }
      else if (o.status === 'cancelled') stats.cancelled++
    })
    return res.status(200).json({ vendor: biz || {}, orders: orders || [], stats })
  }

  if (action === 'list_pickup_stations_admin') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { data } = await supabase.from('shop_pickup_stations').select('*').order('name')
    return res.status(200).json({ data: data || [] })
  }

  if (action === 'get_fulfilment_orders') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { status: filterStatus } = req.body
    const activeStatuses = ['paid', 'accepted', 'processing', 'packed', 'at_pickup_station', 'ready_for_pickup', 'in_transit']
    let query = supabase.from('shop_orders').select('*, shop_order_items(*), businesses!shop_orders_vendor_business_id_fkey(id, name, city), shop_pickup_stations(id, name, address, city), profiles!shop_orders_customer_id_fkey(id, full_name, display_name)').in('status', filterStatus ? [filterStatus] : activeStatuses).order('created_at', { ascending: false }).limit(200)
    const { data, error } = await query
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ data: data || [] })
  }

  // --- Shop Admin: Reports & History ---

  if (action === 'get_shop_reports') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { dateFrom, dateTo } = req.body
    let dateFilter = ''
    if (dateFrom && dateTo) dateFilter = `AND created_at >= '${dateFrom}' AND created_at <= '${dateTo}T23:59:59'`
    else if (dateFrom) dateFilter = `AND created_at >= '${dateFrom}'`
    else if (dateTo) dateFilter = `AND created_at <= '${dateTo}T23:59:59'`

    const { data: revenueByDay } = await supabase.rpc('get_admin_shop_overview').then(() => null)
    const { data: completedOrders } = await supabase
      .from('shop_orders').select('id, order_ref, total_kobo, commission_kobo, created_at, customer_name, businesses!shop_orders_vendor_business_id_fkey(name)')
      .eq('status', 'delivered').order('created_at', { ascending: false }).limit(200)
    const { data: topProducts } = await supabase
      .from('shop_order_items').select('product_name, quantity, line_total_kobo, shop_orders!inner(status, created_at)')
      .eq('shop_orders.status', 'delivered').order('line_total_kobo', { ascending: false }).limit(50)
    const productAgg = {}
    ;(topProducts || []).forEach(item => {
      if (dateFrom && item.shop_orders?.created_at < dateFrom) return
      if (dateTo && item.shop_orders?.created_at > dateTo + 'T23:59:59') return
      if (!productAgg[item.product_name]) productAgg[item.product_name] = { product_name: item.product_name, total_qty: 0, total_revenue_kobo: 0, order_count: 0 }
      productAgg[item.product_name].total_qty += item.quantity
      productAgg[item.product_name].total_revenue_kobo += item.line_total_kobo
      productAgg[item.product_name].order_count++
    })
    const topProductsList = Object.values(productAgg).sort((a, b) => b.total_revenue_kobo - a.total_revenue_kobo).slice(0, 20)

    const { data: allOrders } = await supabase
      .from('shop_orders').select('customer_id, customer_name, total_kobo, status, created_at')
      .order('created_at', { ascending: false }).limit(2000)
    const customerAgg = {}
    ;(allOrders || []).forEach(o => {
      if (o.status === 'cancelled') return
      if (dateFrom && o.created_at < dateFrom) return
      if (dateTo && o.created_at > dateTo + 'T23:59:59') return
      if (!customerAgg[o.customer_id]) customerAgg[o.customer_id] = { customer_id: o.customer_id, customer_name: o.customer_name, total_orders: 0, total_spent_kobo: 0 }
      customerAgg[o.customer_id].total_orders++
      customerAgg[o.customer_id].total_spent_kobo += (o.total_kobo || 0)
    })
    const topCustomersList = Object.values(customerAgg).sort((a, b) => b.total_spent_kobo - a.total_spent_kobo).slice(0, 20)

    const completedFiltered = (completedOrders || []).filter(o => {
      if (dateFrom && o.created_at < dateFrom) return false
      if (dateTo && o.created_at > dateTo + 'T23:59:59') return false
      return true
    })
    const totalRevenue = completedFiltered.reduce((s, o) => s + (o.total_kobo || 0), 0)
    const totalCommission = completedFiltered.reduce((s, o) => s + (o.commission_kobo || 0), 0)

    return res.status(200).json({
      summary: { total_completed: completedFiltered.length, total_revenue_kobo: totalRevenue, total_commission_kobo: totalCommission },
      completed_orders: completedFiltered,
      top_products: topProductsList,
      top_customers: topCustomersList,
    })
  }

  if (action === 'get_shop_product_views') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { data } = await supabase
      .from('shop_product_views')
      .select('*, ecommerce_products(id, business_id, status, businesses(name))')
      .order('viewed_at', { ascending: false })
      .limit(200)
    const viewAgg = {}
    ;(data || []).forEach(v => {
      const pid = v.product_id
      if (!viewAgg[pid]) viewAgg[pid] = { product_id: pid, product_name: v.ecommerce_products?.id?.slice(0, 8) || pid.slice(0, 8), vendor_name: v.ecommerce_products?.businesses?.name || 'Unknown', view_count: 0, unique_users: new Set(), latest_view: null }
      viewAgg[pid].view_count++
      if (v.user_id) viewAgg[pid].unique_users.add(v.user_id)
      if (!viewAgg[pid].latest_view || v.viewed_at > viewAgg[pid].latest_view) viewAgg[pid].latest_view = v.viewed_at
    })
    const products = Object.values(viewAgg).map(p => ({ ...p, unique_users: p.unique_users.size })).sort((a, b) => b.view_count - a.view_count)
    return res.status(200).json({ data: products.slice(0, 50), raw_views: data || [] })
  }

  // --- Role & Permission Management ---

  if (action === 'list_admin_roles') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { data } = await supabase.from('admin_roles').select('*').order('created_at')
    return res.status(200).json({ data: data || [] })
  }

  if (action === 'create_admin_role') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload || payload.role !== 'super_admin') return res.status(403).json({ error: 'Only super admin can create roles' })
    const { name, description, carefindTabs } = req.body
    if (!name) return res.status(400).json({ error: 'Role name required' })
    const { data, error } = await supabase.from('admin_roles').insert({
      name: name.toLowerCase().replace(/\s+/g, '_'),
      description: description || '',
      is_system: false,
      carefind_tabs: carefindTabs || {},
      created_by: payload.adminId,
    }).select().maybeSingle()
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ data })
  }

  if (action === 'update_admin_role') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload || payload.role !== 'super_admin') return res.status(403).json({ error: 'Only super admin can update roles' })
    const { roleId, description, carefindTabs } = req.body
    if (!roleId) return res.status(400).json({ error: 'roleId required' })
    const patch = { updated_at: new Date().toISOString() }
    if (description !== undefined) patch.description = description
    if (carefindTabs !== undefined) patch.carefind_tabs = carefindTabs
    const { error } = await supabase.from('admin_roles').update(patch).eq('id', roleId)
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  if (action === 'delete_admin_role') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload || payload.role !== 'super_admin') return res.status(403).json({ error: 'Only super admin can delete roles' })
    const { roleId } = req.body
    if (!roleId) return res.status(400).json({ error: 'roleId required' })
    const { data: roleCheck } = await supabase.from('admin_roles').select('is_system').eq('id', roleId).maybeSingle()
    if (roleCheck?.is_system) return res.status(400).json({ error: 'Cannot delete system roles' })
    const { error } = await supabase.from('admin_roles').delete().eq('id', roleId)
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  if (action === 'assign_admin_role') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload || payload.role !== 'super_admin') return res.status(403).json({ error: 'Only super admin can assign roles' })
    const { staffId, roleId } = req.body
    if (!staffId || !roleId) return res.status(400).json({ error: 'staffId and roleId required' })
    const { data: roleData } = await supabase.from('admin_roles').select('name').eq('id', roleId).maybeSingle()
    const patch = { role_id: roleId, updated_at: new Date().toISOString() }
    if (roleData) patch.role = roleData.name
    const { error } = await supabase.from('admin_users').update(patch).eq('id', staffId)
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  if (action === 'get_admin_permissions') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { data, error } = await supabase.rpc('get_admin_permissions', { p_admin_id: payload.adminId })
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ permissions: data || {} })
  }

  // --------------------------------------------------------------------
  // Audit Logging & Bulk Operations (Phase 3)
  // --------------------------------------------------------------------

  if (action === 'log_audit_action') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { auditAction, targetType, targetId, metadata } = req.body
    if (!auditAction || !targetType || !targetId) return res.status(400).json({ error: 'auditAction, targetType and targetId required' })
    const { error } = await supabase.from('admin_audit_log').insert({
      actor_admin_id: payload.adminId,
      action: auditAction,
      target_table: targetType,
      target_id: String(targetId),
      after: metadata || null,
    })
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  if (action === 'list_audit_logs') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { limit: lim, action: filterAction, target_type: filterTarget, dateFrom, dateTo } = req.body
    let query = supabase.from('admin_audit_log').select('id, actor_admin_id, action, target_table, target_id, after, created_at').order('created_at', { ascending: false }).limit(lim || 100)
    if (filterAction && filterAction !== 'all') query = query.eq('action', filterAction)
    if (filterTarget && filterTarget !== 'all') query = query.eq('target_table', filterTarget)
    if (dateFrom) query = query.gte('created_at', dateFrom)
    if (dateTo) query = query.lte('created_at', dateTo + 'T23:59:59')
    const { data, error } = await query
    if (error) return res.status(400).json({ error: error.message })
    // Resolve actor names from admin_users
    const actorIds = [...new Set((data || []).map(l => l.actor_admin_id).filter(Boolean))]
    let actorNames = {}
    if (actorIds.length) {
      const { data: admins } = await supabase.from('admin_users').select('id, full_name').in('id', actorIds)
      ;(admins || []).forEach(a => { actorNames[a.id] = a.full_name })
    }
    const enriched = (data || []).map(l => ({
      ...l,
      actor_name: actorNames[l.actor_admin_id] || 'Admin',
      target_type: l.target_table,
      metadata: l.after,
    }))
    return res.status(200).json({ data: enriched })
  }

  if (action === 'bulk_action') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { bulkAction, items } = req.body
    if (!bulkAction || !items?.length) return res.status(400).json({ error: 'bulkAction and items required' })

    const results = []
    let allSucceeded = true

    for (const item of items) {
      try {
        if (bulkAction === 'delete') {
          if (item.target_type === 'post') {
            const { error } = await supabase.from('posts').delete().eq('id', item.target_id)
            if (error) throw error
          } else if (item.target_type === 'user') {
            await supabase.from('post_reactions').delete().eq('user_id', item.target_id)
            await supabase.from('post_comments').delete().eq('user_id', item.target_id)
            await supabase.from('posts').delete().eq('user_id', item.target_id)
            const { error } = await supabase.from('profiles').delete().eq('id', item.target_id)
            if (error) throw error
          }
        } else if (bulkAction === 'approve') {
          if (item.target_type === 'verification') {
            const { error: e1 } = await supabase.from('verification_requests').update({ status: 'approved' }).eq('id', item.target_id)
            if (e1) throw e1
            const { error: e2 } = await supabase.from('profiles').update({ is_verified: true }).eq('id', item.target_id)
            if (e2) throw e2
          } else if (item.target_type === 'report') {
            const { error } = await supabase.from('reports').update({ status: 'resolved' }).eq('id', item.target_id)
            if (error) throw error
          }
        } else if (bulkAction === 'reject') {
          if (item.target_type === 'verification') {
            const { error } = await supabase.from('verification_requests').update({ status: 'rejected' }).eq('id', item.target_id)
            if (error) throw error
          }
        }

        await supabase.from('admin_audit_log').insert({
          actor_admin_id: payload.adminId,
          action: `bulk_${bulkAction}`,
          target_table: item.target_type,
          target_id: String(item.target_id),
          after: item.metadata || null,
        })
        results.push({ id: item.target_id, success: true })
      } catch (err) {
        allSucceeded = false
        results.push({ id: item.target_id, success: false, error: err.message })
      }
    }

    if (!allSucceeded) {
      return res.status(207).json({ success: false, results, message: 'Some operations failed — no further rollback attempted. Individual results in results array.' })
    }
    return res.status(200).json({ success: true, results })
  }

  // --------------------------------------------------------------------
  // AI Copilot Intelligence (Phase 4)
  // --------------------------------------------------------------------

  if (action === 'analyze_sentiment') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { text } = req.body
    if (!text) return res.status(400).json({ error: 'text required' })
    const result = analyzeSentiment(text)
    await supabase.from('admin_audit_log').insert({
      actor_admin_id: payload.adminId,
      action: 'copilot_sentiment_analysis',
      target_table: 'copilot',
      target_id: 'sentiment',
      after: { text_preview: text.slice(0, 120), score: result.score, category: result.category },
    }).then(() => null).catch(() => null)
    return res.status(200).json(result)
  }

  if (action === 'get_recommendations') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { currentTab, recentActions } = req.body
    const recommendations = generateRecommendations(currentTab, recentActions || [])
    return res.status(200).json({ recommendations })
  }

  if (action === 'log_copilot_feedback') {
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const payload = verifyToken(token)
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' })
    const { suggestionId, accepted, reasoning } = req.body
    if (suggestionId === undefined || accepted === undefined) return res.status(400).json({ error: 'suggestionId and accepted required' })
    const { error } = await supabase.from('admin_audit_log').insert({
      actor_admin_id: payload.adminId,
      action: accepted ? 'copilot_feedback_accept' : 'copilot_feedback_reject',
      target_table: 'copilot',
      target_id: String(suggestionId),
      after: { accepted, reasoning: reasoning || null, timestamp: new Date().toISOString() },
    })
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  return res.status(400).json({ error: 'Unknown action' })
}

// --- Sentiment Analysis Engine (regex-based, deterministic) ---

const TOXIC_WORDS = [
  'fuck', 'shit', 'damn', 'hell', 'ass', 'bitch', 'bastard', 'crap', 'piss',
  'stupid', 'idiot', 'moron', 'dumb', 'loser', 'pathetic', 'worthless', 'trash',
  'ugly', 'disgusting', 'hate', 'kill', 'die', 'murder', 'destroy', 'burn',
  'attack', 'fight', 'beat', 'punch', 'slap', 'kick', 'threat', 'warning',
  'rip', 'end you', 'shut up', 'go away', 'get lost', 'drop dead',
]

const HARASSMENT_WORDS = [
  'ugly', 'fat', 'skinny', 'short', 'tall', 'weak', ' pathetic', 'failure',
  'loser', 'nobody', 'nothing', 'waste', 'burden', 'annoying', 'stupid',
  'dumb', 'retard', 'slow', 'special needs', 'handicapped', 'cripple',
  'gay', 'fag', 'queer', 'dyke', 'tranny', 'slut', 'whore', 'ho',
  'nigger', 'nigga', 'spic', 'chink', 'kike', 'wetback', 'towelhead',
]

const SPAM_SIGNALS = [
  'buy now', 'limited time', 'act fast', 'click here', 'free money',
  'make money fast', 'work from home', 'no experience needed', 'join now',
  'earn cash', 'get rich', 'double your money', 'investment opportunity',
  'whatsapp me', 'dm me', 'follow me', 'check my profile', 'link in bio',
  'discount code', 'promo code', 'use code', 'shop now', 'order now',
]

function analyzeSentiment(text) {
  if (!text || typeof text !== 'string') {
    return { score: 0, category: 'neutral', confidence: 0, reason: 'No content to analyze' }
  }

  const lower = text.toLowerCase()
  const words = lower.split(/\s+/)
  const wordCount = words.length

  let toxicHits = 0
  let harassmentHits = 0
  let spamHits = 0
  const matchedPatterns = []

  for (const word of TOXIC_WORDS) {
    if (lower.includes(word)) {
      toxicHits++
      matchedPatterns.push(`toxic:${word}`)
    }
  }
  for (const word of HARASSMENT_WORDS) {
    if (lower.includes(word)) {
      harassmentHits++
      matchedPatterns.push(`harassment:${word}`)
    }
  }
  for (const phrase of SPAM_SIGNALS) {
    if (lower.includes(phrase)) {
      spamHits++
      matchedPatterns.push(`spam:${phrase}`)
    }
  }

  const toxicDensity = Math.min(toxicHits / Math.max(wordCount, 1) * 10, 1)
  const harassmentDensity = Math.min(harassmentHits / Math.max(wordCount, 1) * 10, 1)
  const spamDensity = Math.min(spamHits / Math.max(wordCount, 1) * 5, 1)

  const capsRatio = (text.replace(/[^A-Z]/g, '').length / Math.max(text.replace(/[^a-zA-Z]/g, '').length, 1))
  const exclamationCount = (text.match(/!/g) || []).length
  const capsBoost = capsRatio > 0.5 ? 0.2 : 0
  const exclamationBoost = Math.min(exclamationCount * 0.05, 0.15)

  const toxicScore = Math.min(toxicDensity + capsBoost + exclamationBoost, 1)
  const harassmentScore = Math.min(harassmentDensity + capsBoost, 1)
  const spamScore = Math.min(spamDensity + exclamationBoost, 1)

  const scores = [
    { category: 'toxic', score: toxicScore },
    { category: 'harassment', score: harassmentScore },
    { category: 'spam', score: spamScore },
  ]

  const top = scores.sort((a, b) => b.score - a.score)[0]
  const overallScore = Math.min(Math.max(toxicScore, harassmentScore, spamScore), 1)
  const confidence = Math.min(0.3 + (toxicHits + harassmentHits + spamHits) * 0.1, 0.95)

  let category = 'neutral'
  if (overallScore > 0.1) {
    category = top.category
  }

  const CATEGORY_LABELS = {
    toxic: 'Toxic content detected — contains aggressive or abusive language',
    harassment: 'Harassment detected — targets or attacks individuals',
    spam: 'Spam detected — promotional or unsolicited content',
    neutral: 'No significant issues detected',
  }

  return {
    score: Math.round(overallScore * 100) / 100,
    category,
    confidence: Math.round(confidence * 100) / 100,
    reason: CATEGORY_LABELS[category],
    matchedPatterns: matchedPatterns.slice(0, 5),
    breakdown: { toxic: Math.round(toxicScore * 100) / 100, harassment: Math.round(harassmentScore * 100) / 100, spam: Math.round(spamScore * 100) / 100 },
  }
}

function generateRecommendations(currentTab, recentActions) {
  const recommendations = []

  if (currentTab === 'reports' || currentTab === 'moderation') {
    recommendations.push({
      id: 'show_pending_reports',
      text: 'Show pending reports',
      reasoning: 'You\'re on the reports tab — reviewing pending reports is the most common next action.',
      priority: 'high',
    })
    recommendations.push({
      id: 'analyze_top_report',
      text: 'Analyze top reported post for sentiment',
      reasoning: 'Sentiment analysis can help prioritize which reports to handle first.',
      priority: 'medium',
    })
  }

  if (currentTab === 'users') {
    recommendations.push({
      id: 'show_pending_verifications',
      text: 'Show pending verifications',
      reasoning: 'User management is often paired with verification review.',
      priority: 'medium',
    })
  }

  if (currentTab === 'news') {
    recommendations.push({
      id: 'show_pending_news',
      text: 'Show pending news submissions',
      reasoning: 'You\'re on the news tab — reviewing submissions is the primary workflow.',
      priority: 'high',
    })
  }

  if (recentActions.length >= 3) {
    const lastThree = recentActions.slice(-3)
    const allApproved = lastThree.every(a => a.action === 'approve')
    const allRejected = lastThree.every(a => a.action === 'reject')

    if (allApproved) {
      recommendations.push({
        id: 'continue_approving',
        text: 'You might want to approve the next item — you\'ve been approving recent ones.',
        reasoning: 'Pattern detected: you\'ve approved the last 3 items. This suggestion is based on your recent behavior.',
        priority: 'low',
      })
    }
    if (allRejected) {
      recommendations.push({
        id: 'consider_approving',
        text: 'Consider reviewing criteria — you\'ve rejected the last 3 items.',
        reasoning: 'Pattern detected: you\'ve rejected the last 3 items. You may want to check if the criteria need adjustment.',
        priority: 'low',
      })
    }
  }

  if (recommendations.length === 0) {
    recommendations.push({
      id: 'generic_stats',
      text: 'Ask me about users, reports, or revenue',
      reasoning: 'No specific pattern detected — here are some general things I can help with.',
      priority: 'info',
    })
  }

  return recommendations.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2, info: 3 }
    return (order[a.priority] ?? 3) - (order[b.priority] ?? 3)
  })
}
