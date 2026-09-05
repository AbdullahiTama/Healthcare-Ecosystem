import { createClient } from '@supabase/supabase-js'
import { sendEmail, buildBusinessStatusHtml, buildBusinessApprovedHtml, buildBusinessRejectedHtml } from './_lib/email.js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Verify admin session via Supabase Auth token
  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return res.status(401).json({ error: 'Missing authorization' })

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return res.status(401).json({ error: 'Invalid session' })

  // Check is_platform_admin via businesses table
  const { data: biz } = await supabase.from('businesses').select('id,is_platform_admin,email').eq('email', user.email.toLowerCase()).maybeSingle()
  const isAdmin = !!(biz && biz.is_platform_admin)
  if (!isAdmin) {
    // Also allow service-role bypass if needed? No — require platform admin.
    return res.status(403).json({ error: 'Not authorized' })
  }

  const { businessId, status, reason } = req.body || {}
  if (!businessId || !status) return res.status(400).json({ error: 'Missing businessId or status' })

  const allowed = ['active', 'pending', 'rejected', 'suspended']
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' })

  // Fetch target business for email details
  const { data: target, error: fetchErr } = await supabase.from('businesses').select('id,name,owner,email').eq('id', businessId).maybeSingle()
  if (fetchErr || !target) return res.status(404).json({ error: 'Business not found' })

  const ownerEmail = target.email
  if (!ownerEmail) return res.status(200).json({ ok: true, warning: 'No owner email, skipped send' })

  let subject = `CareHub — Application Status for ${target.name}`
  if (status === 'active') subject = `🎉 Welcome to CareHub — ${target.name} is Approved!`
  else if (status === 'rejected') subject = `CareHub — Application Status for ${target.name}`
  else if (status === 'suspended') subject = `CareHub — Account Suspended: ${target.name}`
  else if (status === 'pending') subject = `CareHub — Update on ${target.name} (Action Required)`

  const html = buildBusinessStatusHtml({ businessName: target.name, ownerName: target.owner || 'there', ownerEmail, status, reason: reason || '' })

  const result = await sendEmail({ to: ownerEmail, subject, html })
  // Never fail the status change itself — admin already PATCHed the row. Just report email outcome.
  if (!result.success) {
    console.warn('[notify-business-status] send failed', result.error)
    return res.status(200).json({ ok: true, email: result, warning: 'Status updated but email failed' })
  }
  return res.status(200).json({ ok: true, email: result })
}
