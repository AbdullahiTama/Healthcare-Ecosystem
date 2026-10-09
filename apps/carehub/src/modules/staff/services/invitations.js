import { authClient } from '../../../lib/authClient'
import { sbFetch } from '../../../services/supabase'

// ── Staff invitations ─────────────────────────────────────────────────────────
// The client half of sql/20261009_staff_invitations_and_role_governance.sql.
//
//   invite / resend  → POST /api/staff-invitations with the caller's session
//                      token. The server generates the single-use token and
//                      emails it; nothing secret comes back to the browser.
//   lookup / accept  → the anon-callable RPCs the /accept-invite page uses.
//                      `accept` runs with whatever session exists, which is
//                      how an invitee with an existing account proves who they
//                      are (sign in first, then accept — never overwritten).
//
// Dependencies are injected (same seam as the repositories) so tests can bind
// in-memory fakes.

export const MIN_PASSWORD_LENGTH = 8

// sbFetch prefixes errors with "Supabase error (400): " — the RPCs raise
// sentences written for the user, so show those, not the transport noise.
export function readableError(e, fallback = 'Something went wrong. Please try again.') {
  const msg = String(e?.message || '').replace(/^Supabase error \(\d{3}\):\s*/, '').trim()
  return msg || fallback
}

export function createInvitationService({
  fetchImpl = (...args) => fetch(...args),
  getSession = () => authClient.auth.getSession(),
  request = sbFetch,
} = {}) {
  async function callApi(payload) {
    const { data } = await getSession()
    const token = data?.session?.access_token
    if (!token) throw new Error('Your session has expired. Please sign in again.')
    const res = await fetchImpl('/api/staff-invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(payload),
    })
    let body = {}
    try { body = await res.json() } catch (e) {}
    if (!res.ok) throw new Error(body.error || 'Could not send the invitation. Please try again.')
    return { invitation: body.invitation, emailSent: !!body.email_sent }
  }

  return {
    invite(businessId, member) {
      return callApi({
        action: 'invite',
        business_id: businessId,
        full_name: (member.fullName || '').trim(),
        email: (member.email || '').trim().toLowerCase(),
        role: (member.role || '').trim(),
        phone: (member.phone || '').trim(),
        show_on_carefind: !!member.showOnCareFind,
        public_title: (member.publicTitle || '').trim(),
      })
    },

    resend(staffId) {
      return callApi({ action: 'resend', staff_id: staffId })
    },

    // → { state: 'valid' | 'expired' | 'invalid', business_name, full_name,
    //     email, role, expires_at, account_exists }
    async lookup(token) {
      return request('rpc/get_staff_invitation', { method: 'POST', body: JSON.stringify({ p_token: token }) })
    },

    // → { email, account_created }
    async accept(token, password = null) {
      return request('rpc/accept_staff_invitation', {
        method: 'POST',
        body: JSON.stringify({ p_token: token, p_password: password }),
      })
    },
  }
}

export const invitationService = createInvitationService()
