import { createClient } from '@supabase/supabase-js'
import { emailService } from '../../src/lib/emailService.js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return res.status(401).json({ error: 'Missing authorization' })

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return res.status(401).json({ error: 'Invalid session' })

  const { biz } = await supabase.from('businesses').select('id,is_platform_admin,email').eq('email', user.email.toLowerCase()).maybeSingle()
  const isAdmin = !!(biz && biz.is_platform_admin)
  if (!isAdmin) return res.status(403).json({ error: 'Not authorized' })

  const { businessId, status, reason } = req.body || {}
  if (!businessId || !status) return res.status(400).json({ error: 'Missing businessId or status' })

  const allowed = ['active', 'pending', 'rejected', 'suspended']
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' })

  const { data: target, error: fetchErr } = await supabase.from('businesses').select('id,name,owner,email').eq('id', businessId).maybeSingle()
  if (fetchErr || !target) return res.status(404).json({ error: 'Business not found' })

  const ownerEmail = target.email
  if (!ownerEmail) return res.status(200).json({ ok: true, warning: 'No owner email, skipped send' })

  const subjectMap = {
    active: `🎉 Welcome to CareHub — ${target.name} is Approved!`,
    rejected: `CareHub — Application Status for ${target.name}`,
    suspended: `CareHub — Account Suspended: ${target.name}`,
    pending: `CareHub — Update on ${target.name} (Action Required)`,
  }

  try {
    await emailService.enqueue({
      templateKey: status === 'active' ? 'business_approved' : status === 'rejected' ? 'business_rejected' : 'business_suspended',
      toEmail: ownerEmail,
      payload: { businessName: target.name, ownerName: target.owner || 'there', ownerEmail, status, reason: reason || '' },
      subject: subjectMap[status],
    })
  } catch (e) {
    console.warn('[notify-business-status] enqueue failed', e)
  }

  return res.status(200).json({ ok: true })
}
