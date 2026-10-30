// Client-side wrappers for server-owned email events.
// All delivery is server-side (api/_handlers/email-send.js → shared EmailService
// → shared-email provider → Resend). This module must never contain Resend
// credentials, template markup, or a Resend client.

import { fetchWithSession } from './sessionFetch.js'

// fetchWithSession renews a refused token and retries once. /api/email/send
// answers 401 only when the token itself is refused, before anything is
// mailed, so the retry cannot send an email twice. Signed out, it throws with
// the session message, which is returned as `error` like any other failure.
async function postEmailEvent(templateKey, toEmail, payload, subject) {
  try {
    const res = await fetchWithSession('/api/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateKey, toEmail, payload, subject }),
    })
    const data = await res.json().catch(() => ({}))
    return { success: res.ok, data, error: res.ok ? null : (data.error || 'Email request failed') }
  } catch (e) {
    console.error('[email] event request failed', e)
    return { success: false, error: e.message }
  }
}

export async function emailAgentApproved(args) {
  if (!args?.agentEmail) return { success: false, error: 'agentEmail is required' }
  return postEmailEvent('agent_approved', args.agentEmail, args, undefined)
}

export async function emailAgentRejected(args) {
  if (!args?.agentEmail) return { success: false, error: 'agentEmail is required' }
  return postEmailEvent('agent_rejected', args.agentEmail, args, undefined)
}
