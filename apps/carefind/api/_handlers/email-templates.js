import { createClient } from '@supabase/supabase-js'
import { renderEmailTemplate, generateSampleVariables } from '@care-ecosystem/shared-email'
import { sendEmail } from '../_lib/email.js'
import { TEMPLATE_REGISTRY } from '@care-ecosystem/shared-email'
import { SAMPLES, TEMPLATE_META } from '@care-ecosystem/shared-email/src/templates/samples.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' })
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

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

  async function requireAdmin() {
    const { token } = req.body
    if (!token) return { error: res.status(401).json({ error: 'Unauthorized' }) }
    const payload = verifyToken(token)
    if (!payload) return { error: res.status(401).json({ error: 'Invalid or expired token' }) }
    const { data: admin } = await sb
      .from('admin_users')
      .select('id, role, is_active')
      .eq('id', payload.adminId)
      .eq('is_active', true)
      .maybeSingle()
    if (!admin) return { error: res.status(401).json({ error: 'Admin not found or inactive' }) }
    return { adminId: admin.id }
  }

  const { action } = req.body

  if (action === 'list_system') {
    const auth = await requireAdmin()
    if (auth.error) return
    return res.status(200).json({ data: TEMPLATE_META })
  }

  if (action === 'preview_system') {
    const auth = await requireAdmin()
    if (auth.error) return
    const { key, payload: overridePayload } = req.body
    if (!key) return res.status(400).json({ error: 'key required' })
    const fn = TEMPLATE_REGISTRY[key]
    if (!fn) return res.status(404).json({ error: `Unknown system template: ${key}` })
    const payload = { ...(SAMPLES[key] || {}), ...(overridePayload || {}) }
    try {
      const html = fn(payload)
      return res.status(200).json({ html, sampleVariables: payload, meta: TEMPLATE_META.find(t => t.key === key) })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  if (action === 'send_test_system') {
    const auth = await requireAdmin()
    if (auth.error) return
    const { key, to, payload: overridePayload } = req.body
    if (!key || !to) return res.status(400).json({ error: 'key and to required' })
    const fn = TEMPLATE_REGISTRY[key]
    if (!fn) return res.status(404).json({ error: `Unknown system template: ${key}` })
    const meta = TEMPLATE_META.find(t => t.key === key)
    const payload = { ...(SAMPLES[key] || {}), ...(overridePayload || {}) }
    const html = fn(payload)
    const subject = meta ? `[TEST] ${meta.label}` : `[TEST] ${key}`
    const result = await sendEmail({ to, subject, html })
    return res.status(200).json(result)
  }

  if (action === 'list') {
    const auth = await requireAdmin()
    if (auth.error) return
    const { data, error } = await sb
      .from('email_templates')
      .select('id, name, slug, subject, category, is_active, created_at, updated_at')
      .order('updated_at', { ascending: false })
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ data: data || [] })
  }

  if (action === 'get') {
    const auth = await requireAdmin()
    if (auth.error) return
    const { id, slug } = req.body
    if (!id && !slug) return res.status(400).json({ error: 'id or slug required' })
    let query = sb.from('email_templates').select('*')
    if (id) query = query.eq('id', id)
    else query = query.eq('slug', slug)
    const { data, error } = await query.maybeSingle()
    if (error) return res.status(400).json({ error: error.message })
    if (!data) return res.status(404).json({ error: 'Template not found' })
    return res.status(200).json({ data })
  }

  if (action === 'create') {
    const auth = await requireAdmin()
    if (auth.error) return
    const { name, slug, subject, html_body, variables, category } = req.body
    if (!name || !slug || !subject || !html_body) {
      return res.status(400).json({ error: 'name, slug, subject and html_body are required' })
    }
    const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9_-]/g, '_')
    const { data, error } = await sb
      .from('email_templates')
      .insert({
        name,
        slug: cleanSlug,
        subject,
        html_body,
        variables: variables || [],
        category: category || 'general',
        created_by: auth.adminId,
      })
      .select()
      .maybeSingle()
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ data })
  }

  if (action === 'update') {
    const auth = await requireAdmin()
    if (auth.error) return
    const { id, name, slug, subject, html_body, variables, category, is_active } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    const patch = { updated_at: new Date().toISOString() }
    if (name !== undefined) patch.name = name
    if (slug !== undefined) patch.slug = slug.toLowerCase().replace(/[^a-z0-9_-]/g, '_')
    if (subject !== undefined) patch.subject = subject
    if (html_body !== undefined) patch.html_body = html_body
    if (variables !== undefined) patch.variables = variables
    if (category !== undefined) patch.category = category
    if (is_active !== undefined) patch.is_active = is_active
    const { data, error } = await sb
      .from('email_templates')
      .update(patch)
      .eq('id', id)
      .select()
      .maybeSingle()
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ data })
  }

  if (action === 'delete') {
    const auth = await requireAdmin()
    if (auth.error) return
    const { id } = req.body
    if (!id) return res.status(400).json({ error: 'id required' })
    const { error } = await sb.from('email_templates').delete().eq('id', id)
    if (error) return res.status(400).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  if (action === 'preview') {
    const auth = await requireAdmin()
    if (auth.error) return
    const { id, slug, html_body, variables } = req.body
    let templateHtml = html_body
    let varDefs = variables

    if (id || slug) {
      let query = sb.from('email_templates').select('html_body, variables')
      if (id) query = query.eq('id', id)
      else query = query.eq('slug', slug)
      const { data: tpl, error } = await query.maybeSingle()
      if (error) return res.status(400).json({ error: error.message })
      if (!tpl) return res.status(404).json({ error: 'Template not found' })
      templateHtml = tpl.html_body
      varDefs = tpl.variables
    }

    if (!templateHtml) return res.status(400).json({ error: 'No template HTML provided' })

    const sampleVars = generateSampleVariables(varDefs)
    const rendered = renderEmailTemplate(templateHtml, sampleVars)
    return res.status(200).json({ html: rendered, sampleVariables: sampleVars })
  }

  if (action === 'send_test') {
    const auth = await requireAdmin()
    if (auth.error) return
    const { id, slug, html_body, variables, to } = req.body
    if (!to) return res.status(400).json({ error: 'to (email address) required' })

    let templateHtml = html_body
    let varDefs = variables
    let subject = 'Test Email'

    if (id || slug) {
      let query = sb.from('email_templates').select('html_body, variables, subject')
      if (id) query = query.eq('id', id)
      else query = query.eq('slug', slug)
      const { data: tpl, error } = await query.maybeSingle()
      if (error) return res.status(400).json({ error: error.message })
      if (!tpl) return res.status(404).json({ error: 'Template not found' })
      templateHtml = tpl.html_body
      varDefs = tpl.variables
      subject = tpl.subject
    }

    if (!templateHtml) return res.status(400).json({ error: 'No template HTML provided' })

    const sampleVars = generateSampleVariables(varDefs)
    const rendered = renderEmailTemplate(templateHtml, sampleVars)
    const result = await sendEmail({ to, subject: `[TEST] ${subject}`, html: rendered })
    return res.status(200).json(result)
  }

  return res.status(400).json({ error: 'Unknown action' })
}
