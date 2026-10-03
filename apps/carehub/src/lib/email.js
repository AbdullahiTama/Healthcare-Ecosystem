// Client-side wrappers for server-owned email events.
// All delivery is server-side (api/_handlers/email-send.js → shared EmailService
// → shared-email provider → Resend). This module must never contain Resend
// credentials, template markup, or a Resend client.

import { authClient } from './authClient.js'

async function postEmailEvent(templateKey, toEmail, payload, subject) {
  try {
    const { data: { session } } = await authClient.auth.getSession()
    if (!session) return { success: false, error: 'Not signed in' }
    const res = await fetch('/api/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
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
