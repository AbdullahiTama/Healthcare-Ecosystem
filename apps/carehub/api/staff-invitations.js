import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { planLimitsFor } from '../src/lib/planLimits.js'
import { emailStaffInvitation } from '../src/lib/email.js'

// Staff invitations — the only way a person joins a CareHub business.
//
// Why this runs server-side (see sql/20261009_staff_invitations_and_role_governance.sql):
// the invitation token is a credential. It is generated here, only its sha256
// digest is stored, and the raw value goes to exactly one place — the
// invitee's inbox. Neither the owner nor any browser ever sees it, so nobody
// but the invitee can choose their password.
//
// Authorization is NOT decided here. This endpoint proves WHO is calling
// (supabase.auth.getUser on their JWT) and hands that verified email to the
// service-role RPCs, which decide whether that person may manage staff for the
// business and which roles they may grant — the same rules the staff/roles
// triggers enforce for every other write path.
//
// POST { action: 'invite', business_id, full_name, email, role, phone?,
//        show_on_carefind?, public_title? }
// POST { action: 'resend', staff_id }
// → 200 { invitation: { staff_id, email, full_name, role, business_name, expires_at }, email_sent }

export const INVITE_TTL_DAYS = 7

export function createInviteToken() {
  const raw = crypto.randomBytes(32).toString('base64url')
  return { raw, hash: crypto.createHash('sha256').update(raw).digest('hex') }
}

// Billing is a parent-level concept (a branch does not pay separately), so the
// seat limit comes from the top-level business's plan. Bounded walk — a
// malformed parent cycle cannot loop.
async function seatLimitFor(supabase, businessId) {
  let id = businessId
  let row = null
  for (let i = 0; i < 10 && id; i++) {
    const { data } = await supabase.from('businesses').select('id, plan, parent_business_id').eq('id', id).maybeSingle()
    if (!data) break
    row = data
    id = data.parent_business_id
  }
  const max = planLimitsFor(row?.plan).maxStaff
  return Number.isFinite(max) ? max : null
}

function appUrlFor(req) {
  const configured = process.env.CAREHUB_APP_URL
  if (configured) return configured.replace(/\/+$/, '')
  const host = req.headers['x-forwarded-host'] || req.headers.host
  return `https://${host}`
}

export function createHandler({ getSupabase, sendInvitation = emailStaffInvitation, now = () => new Date(), logger = console } = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const supabase = getSupabase()
    const authHeader = req.headers['authorization'] || ''
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!jwt) return res.status(401).json({ error: 'Please sign in again.' })
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt)
    const actorEmail = userData?.user?.email
    if (userErr || !actorEmail) return res.status(401).json({ error: 'Please sign in again.' })

    const body = req.body || {}
    const { raw, hash } = createInviteToken()
    const expiresAt = new Date(now().getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

    let rpc
    if (body.action === 'invite') {
      if (!body.business_id) return res.status(400).json({ error: 'Missing business.' })
      rpc = supabase.rpc('create_staff_invitation', {
        p_actor_email: actorEmail,
        p_business_id: body.business_id,
        p_full_name: body.full_name || '',
        p_email: body.email || '',
        p_role: body.role || '',
        p_phone: body.phone || '',
        p_show_on_carefind: !!body.show_on_carefind,
        p_public_title: body.public_title || '',
        p_token_hash: hash,
        p_expires_at: expiresAt,
        p_max_staff: await seatLimitFor(supabase, body.business_id),
      })
    } else if (body.action === 'resend') {
      if (!body.staff_id) return res.status(400).json({ error: 'Missing staff member.' })
      rpc = supabase.rpc('reissue_staff_invitation', {
        p_actor_email: actorEmail,
        p_staff_id: body.staff_id,
        p_token_hash: hash,
        p_expires_at: expiresAt,
      })
    } else {
      return res.status(400).json({ error: 'Unknown action.' })
    }

    const { data: invitation, error: rpcErr } = await rpc
    if (rpcErr) {
      // The RPCs raise messages written for the person managing staff
      // ("This email is a business owner's CareHub login…"), so they are
      // returned as-is. 42501 = not allowed.
      const status = rpcErr.code === '42501' ? 403 : 400
      if (!rpcErr.message) logger.error('[staff-invitations] rpc failed', rpcErr)
      return res.status(status).json({ error: rpcErr.message || 'Could not create the invitation.' })
    }

    // The invitation exists even if delivery fails — the UI then offers
    // "Resend", which rotates the token. The token itself is never logged.
    let emailSent = false
    try {
      const result = await sendInvitation({
        staffName: invitation.full_name,
        staffEmail: invitation.email,
        businessName: invitation.business_name,
        role: invitation.role,
        acceptUrl: `${appUrlFor(req)}/accept-invite?token=${encodeURIComponent(raw)}`,
        expiresAt: invitation.expires_at,
      })
      emailSent = !!result?.success
      if (!emailSent) logger.error('[staff-invitations] email not delivered', { staff_id: invitation.staff_id, detail: result?.data || result?.error })
    } catch (e) {
      logger.error('[staff-invitations] email threw', { staff_id: invitation.staff_id, message: e?.message })
    }

    return res.status(200).json({ invitation, email_sent: emailSent })
  }
}

let client = null
export default createHandler({
  getSupabase: () => (client ||= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)),
})
