import { useState, useEffect, useCallback } from 'react'
import { theme } from '../../../styles/theme'
import { Card, Button, Empty, Input, Select, Modal } from '@care-ecosystem/design-system/components/ui'
import { AdminPageHeader, AdminSection, timeAgo } from '../ui'
import {
  Mail, Plus, Trash2, Edit3, Eye, Send, ArrowLeft, Loader2,
  ToggleLeft, ToggleRight, Check, AlertCircle,
} from 'lucide-react'
import { ConfirmDialog } from '../../../components/ui'
import { getAdminAuthorizationHeader } from '../adminApi'

const CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'order', label: 'Order' },
  { value: 'auth', label: 'Authentication' },
  { value: 'notification', label: 'Notification' },
  { value: 'marketing', label: 'Marketing' },
]

const CATEGORY_COLORS = {
  general: { bg: theme.gray100, text: theme.gray600 },
  order: { bg: theme.infoBg, text: theme.info },
  auth: { bg: theme.purpleBg, text: theme.purple },
  notification: { bg: theme.warningBg, text: theme.warning },
  marketing: { bg: theme.successBg, text: theme.success },
}

const EMPTY_FORM = {
  name: '', slug: '', subject: '', html_body: '', category: 'general',
  variables: '[]', is_active: true,
}

async function callEmailTemplates(action, payload = {}) {
  const res = await fetch('/api/email-templates', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...await getAdminAuthorizationHeader(),
    },
    body: JSON.stringify({ action, ...payload }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

export default function EmailTemplatesTab({ showToast }) {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [previewHtml, setPreviewHtml] = useState(null)
  const [previewVars, setPreviewVars] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [testEmailModal, setTestEmailModal] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [testSending, setTestSending] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [jsonError, setJsonError] = useState('')
  const [slugManual, setSlugManual] = useState(false)
  const [systemTemplates, setSystemTemplates] = useState([])
  const [systemLoading, setSystemLoading] = useState(true)
  const [systemPreviewHtml, setSystemPreviewHtml] = useState(null)
  const [systemPreviewVars, setSystemPreviewVars] = useState(null)
  const [systemPreviewKey, setSystemPreviewKey] = useState(null)
  const [systemTestModal, setSystemTestModal] = useState(false)
  const [systemTestEmail, setSystemTestEmail] = useState('')
  const [systemTestSending, setSystemTestSending] = useState(false)
  const [systemTestKey, setSystemTestKey] = useState(null)

  const loadTemplates = useCallback(async () => {
    try {
      const { data } = await callEmailTemplates('list')
      setTemplates(data || [])
    } catch (err) {
      showToast(`Failed to load templates: ${err.message}`, { type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [showToast])

  const loadSystemTemplates = useCallback(async () => {
    try {
      const { data } = await callEmailTemplates('list_system')
      setSystemTemplates(data || [])
    } catch (err) {
      showToast(`Failed to load system templates: ${err.message}`, { type: 'error' })
    } finally {
      setSystemLoading(false)
    }
  }, [showToast])

  useEffect(() => { loadTemplates() }, [loadTemplates])
  useEffect(() => { loadSystemTemplates() }, [loadSystemTemplates])

  function startCreate() {
    setEditing({ isNew: true })
    setForm({ ...EMPTY_FORM })
    setSlugManual(false)
    setJsonError('')
  }

  function startEdit(tpl) {
    setEditing(tpl)
    setForm({
      name: tpl.name || '',
      slug: tpl.slug || '',
      subject: tpl.subject || '',
      html_body: tpl.html_body || '',
      category: tpl.category || 'general',
      variables: JSON.stringify(tpl.variables || [], null, 2),
      is_active: tpl.is_active ?? true,
    })
    setSlugManual(true)
    setJsonError('')
  }

  function cancelEdit() {
    setEditing(null)
    setForm({ ...EMPTY_FORM })
    setJsonError('')
  }

  function updateField(field, value) {
    setForm(prev => {
      const next = { ...prev, [field]: value }
      if (field === 'name' && !slugManual) {
        next.slug = slugify(value)
      }
      return next
    })
  }

  async function saveTemplate() {
    if (!form.name.trim() || !form.slug.trim() || !form.subject.trim() || !form.html_body.trim()) {
      showToast('Name, slug, subject and HTML body are required', { type: 'warning' })
      return
    }
    let parsedVars = []
    try {
      parsedVars = JSON.parse(form.variables || '[]')
      if (!Array.isArray(parsedVars)) throw new Error('Variables must be a JSON array')
    } catch (err) {
      setJsonError(`Invalid variables JSON: ${err.message}`)
      return
    }
    setSaving(true)
    try {
      if (editing?.isNew) {
        await callEmailTemplates('create', {
          name: form.name.trim(),
          slug: form.slug.trim(),
          subject: form.subject.trim(),
          html_body: form.html_body,
          variables: parsedVars,
          category: form.category,
        })
        showToast('Template created', { type: 'success' })
      } else {
        await callEmailTemplates('update', {
          id: editing.id,
          name: form.name.trim(),
          slug: form.slug.trim(),
          subject: form.subject.trim(),
          html_body: form.html_body,
          variables: parsedVars,
          category: form.category,
          is_active: form.is_active,
        })
        showToast('Template updated', { type: 'success' })
      }
      cancelEdit()
      loadTemplates()
    } catch (err) {
      showToast(`Save failed: ${err.message}`, { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(tpl) {
    try {
      await callEmailTemplates('update', { id: tpl.id, is_active: !tpl.is_active })
      showToast(tpl.is_active ? 'Template deactivated' : 'Template activated', { type: 'success' })
      loadTemplates()
    } catch (err) {
      showToast(`Failed: ${err.message}`, { type: 'error' })
    }
  }

  function requestDelete(tpl) {
    setDeleteConfirm(tpl)
  }

  async function confirmDelete() {
    if (!deleteConfirm) return
    try {
      await callEmailTemplates('delete', { id: deleteConfirm.id })
      showToast('Template deleted', { type: 'success' })
      loadTemplates()
    } catch (err) {
      showToast(`Delete failed: ${err.message}`, { type: 'error' })
    } finally {
      setDeleteConfirm(null)
    }
  }

  async function showPreview() {
    setPreviewLoading(true)
    try {
      let parsedVars = []
      try { parsedVars = JSON.parse(form.variables || '[]') } catch { parsedVars = [] }
      const payload = editing?.isNew
        ? { html_body: form.html_body, variables: parsedVars }
        : { id: editing.id, html_body: form.html_body, variables: parsedVars }
      const { html, sampleVariables } = await callEmailTemplates('preview', payload)
      setPreviewHtml(html)
      setPreviewVars(sampleVariables)
    } catch (err) {
      showToast(`Preview failed: ${err.message}`, { type: 'error' })
    } finally {
      setPreviewLoading(false)
    }
  }

  function openTestModal() {
    setTestEmail('')
    setTestEmailModal(true)
  }

  async function sendTest() {
    if (!testEmail.trim()) return
    setTestSending(true)
    try {
      let parsedVars = []
      try { parsedVars = JSON.parse(form.variables || '[]') } catch { parsedVars = [] }
      const payload = editing?.isNew
        ? { html_body: form.html_body, variables: parsedVars, to: testEmail.trim() }
        : { id: editing.id, html_body: form.html_body, variables: parsedVars, to: testEmail.trim() }
      const result = await callEmailTemplates('send_test', payload)
      if (result.success) {
        showToast(`Test email sent to ${testEmail}`, { type: 'success' })
        setTestEmailModal(false)
      } else {
        showToast(`Send failed: ${result.error}`, { type: 'error' })
      }
    } catch (err) {
      showToast(`Send failed: ${err.message}`, { type: 'error' })
    } finally {
      setTestSending(false)
    }
  }

  async function previewSystem(key) {
    setSystemPreviewKey(key)
    try {
      const { html, sampleVariables } = await callEmailTemplates('preview_system', { key })
      setSystemPreviewHtml(html)
      setSystemPreviewVars(sampleVariables)
    } catch (err) {
      showToast(`Preview failed: ${err.message}`, { type: 'error' })
    }
  }

  function openSystemTest(key) {
    setSystemTestKey(key)
    setSystemTestEmail('')
    setSystemTestModal(true)
  }

  async function sendSystemTest() {
    if (!systemTestEmail.trim() || !systemTestKey) return
    setSystemTestSending(true)
    try {
      const result = await callEmailTemplates('send_test_system', { key: systemTestKey, to: systemTestEmail.trim() })
      if (result.success) {
        showToast(`Test email sent to ${systemTestEmail}`, { type: 'success' })
        setSystemTestModal(false)
      } else {
        showToast(`Send failed: ${result.error}`, { type: 'error' })
      }
    } catch (err) {
      showToast(`Send failed: ${err.message}`, { type: 'error' })
    } finally {
      setSystemTestSending(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: theme.tealDeep }} />
      </div>
    )
  }

  if (editing) {
    return (
      <div>
        <button
          onClick={cancelEdit}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
            cursor: 'pointer', color: theme.tealDeep, fontWeight: 700, fontSize: theme.type.bodySm.size,
            padding: '0 0 12px 0',
          }}
        >
          <ArrowLeft size={16} /> Back to templates
        </button>

        <AdminPageHeader
          title={editing.isNew ? 'New Template' : 'Edit Template'}
          subtitle={editing.isNew ? 'Create a new email template' : `Editing: ${editing.name}`}
        >
          <Button variant="ghost" size="sm" leftIcon={<Eye size={14} />} onClick={showPreview} disabled={previewLoading || !form.html_body.trim()}>
            {previewLoading ? 'Rendering...' : 'Preview'}
          </Button>
          <Button variant="ghost" size="sm" leftIcon={<Send size={14} />} onClick={openTestModal} disabled={!form.html_body.trim()}>
            Send Test
          </Button>
        </AdminPageHeader>

        <AdminSection title="Template Details">
          <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[5] }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: theme.space[5] }}>
              <Input label="Template Name" value={form.name} onChange={v => updateField('name', v)} placeholder="e.g. Order Confirmation" />
              <Input
                label="Slug"
                value={form.slug}
                onChange={v => { setSlugManual(true); updateField('slug', v) }}
                placeholder="e.g. order_confirmation"
                helperText="Unique identifier. Auto-generated from name."
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: theme.space[5] }}>
              <Input label="Subject Line" value={form.subject} onChange={v => updateField('subject', v)} placeholder="e.g. Your order #{{order_ref}} is confirmed" />
              <Select label="Category" value={form.category} onChange={v => updateField('category', v)} options={CATEGORIES} />
            </div>
          </div>
        </AdminSection>

        <AdminSection title="HTML Body" subtitle="Use {{variable_name}} for substitution, {{{raw_html}}} for unescaped content">
          <div style={{ position: 'relative' }}>
            <textarea
              value={form.html_body}
              onChange={e => updateField('html_body', e.target.value)}
              placeholder="<div style='font-family: sans-serif;'>\n  <h1>Hello {{name}}</h1>\n  <p>Your order {{order_ref}} is confirmed.</p>\n</div>"
              style={{
                width: '100%', minHeight: 320, padding: 14, fontSize: 12.5, lineHeight: 1.6,
                fontFamily: theme.fontMono, border: `1px solid ${theme.border}`, borderRadius: theme.radius.md,
                background: theme.bg, color: theme.textDark, resize: 'vertical', boxSizing: 'border-box',
                outline: 'none',
              }}
              spellCheck={false}
            />
          </div>
        </AdminSection>

        <AdminSection title="Variables" subtitle="JSON array of {name, description, example} objects">
          <textarea
            value={form.variables}
            onChange={e => { updateField('variables', e.target.value); setJsonError('') }}
            placeholder={'[\n  { "name": "order_ref", "description": "Order reference number", "example": "CF-2026-001" },\n  { "name": "customer_name", "description": "Customer full name", "example": "John Doe" }\n]'}
            style={{
              width: '100%', minHeight: 160, padding: 14, fontSize: 12.5, lineHeight: 1.6,
              fontFamily: theme.fontMono, border: `1px solid ${jsonError ? theme.danger : theme.border}`,
              borderRadius: theme.radius.md, background: theme.bg, color: theme.textDark,
              resize: 'vertical', boxSizing: 'border-box', outline: 'none',
            }}
            spellCheck={false}
          />
          {jsonError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, color: theme.danger, fontSize: theme.type.bodySm.size }}>
              <AlertCircle size={14} /> {jsonError}
            </div>
          )}
        </AdminSection>

        {!editing.isNew && (
          <AdminSection title="Status">
            <button
              onClick={() => updateField('is_active', !form.is_active)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none',
                cursor: 'pointer', padding: 0,
              }}
            >
              {form.is_active
                ? <ToggleRight size={28} color={theme.success} />
                : <ToggleLeft size={28} color={theme.gray400} />
              }
              <span style={{
                fontSize: theme.type.body.size, fontWeight: 700,
                color: form.is_active ? theme.success : theme.gray500,
              }}>
                {form.is_active ? 'Active' : 'Inactive'}
              </span>
            </button>
          </AdminSection>
        )}

        <div style={{ display: 'flex', gap: theme.space[4], justifyContent: 'flex-end', paddingTop: theme.space[4] }}>
          <Button variant="ghost" size="md" onClick={cancelEdit}>Cancel</Button>
          <Button variant="primary" size="md" onClick={saveTemplate} loading={saving} leftIcon={saving ? <Loader2 size={16} /> : <Check size={16} />}>
            {editing.isNew ? 'Create Template' : 'Save Changes'}
          </Button>
        </div>

        <Modal show={!!previewHtml} onClose={() => setPreviewHtml(null)} title="Email Preview" size="lg">
          {previewVars && (
            <div style={{
              background: theme.gray100, borderRadius: theme.radius.sm, padding: theme.space[4],
              marginBottom: theme.space[4], fontSize: theme.type.bodySm.size, color: theme.textMid,
            }}>
              <strong>Sample variables used:</strong> {JSON.stringify(previewVars)}
            </div>
          )}
          <div style={{ border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, overflow: 'hidden' }}>
            <iframe
              srcDoc={previewHtml || ''}
              title="Email preview"
              style={{ width: '100%', height: 500, border: 'none' }}
            />
          </div>
        </Modal>

        <Modal show={testEmailModal} onClose={() => setTestEmailModal(false)} title="Send Test Email">
          <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[4] }}>
            <Input label="Recipient Email" value={testEmail} onChange={setTestEmail} placeholder="admin@example.com" type="email" />
            <p style={{ margin: 0, fontSize: theme.type.bodySm.size, color: theme.textLight }}>
              The template will be rendered with sample variable values.
            </p>
            <Button variant="primary" size="md" fullWidth onClick={sendTest} loading={testSending} leftIcon={testSending ? <Loader2 size={16} /> : <Send size={16} />}>
              Send Test Email
            </Button>
          </div>
        </Modal>
      </div>
    )
  }

  return (
    <div>
      <AdminPageHeader
        title="Email Templates"
        subtitle={`${templates.length} template${templates.length !== 1 ? 's' : ''} configured`}
      >
        <Button variant="primary" size="md" leftIcon={<Plus size={16} />} onClick={startCreate}>
          New Template
        </Button>
      </AdminPageHeader>

      {systemTemplates.length > 0 && (
        <AdminSection>
          <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[3], marginBottom: theme.space[4] }}>
            <span style={{ fontWeight: 800, fontSize: theme.type.body.size, color: theme.textDark }}>System Templates</span>
            <span style={{
              fontSize: theme.type.micro.size, fontWeight: 700, padding: '2px 8px',
              borderRadius: theme.radius.full, background: theme.gray100, color: theme.gray500,
            }}>Read-only</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[3] }}>
            {systemTemplates.map(tpl => {
              const isPreviewing = systemPreviewKey === tpl.key
              return (
                <Card key={tpl.key} style={{ padding: theme.space[5] }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[4] }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: theme.radius.md, flexShrink: 0,
                      background: theme.tealMist, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Mail size={18} color={theme.tealDeep} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[3], marginBottom: 2 }}>
                        <span style={{ fontWeight: 800, fontSize: theme.type.body.size, color: theme.textDark }}>
                          {tpl.label}
                        </span>
                        <span style={{
                          fontSize: theme.type.micro.size, fontWeight: 700, padding: '2px 8px',
                          borderRadius: theme.radius.full, background: theme.gray100, color: theme.gray500,
                        }}>
                          {tpl.category}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[3] }}>
                        <span style={{
                          fontSize: theme.type.caption.size, color: theme.textLight,
                          fontFamily: theme.fontMono,
                        }}>
                          {tpl.key}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[2] }}>
                      <Button variant="ghost" size="sm" onClick={() => isPreviewing ? null : previewSystem(tpl.key)} leftIcon={<Eye size={14} />}>
                        Preview
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openSystemTest(tpl.key)} leftIcon={<Send size={14} />}>
                        Test
                      </Button>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        </AdminSection>
      )}

      {systemLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: theme.tealDeep }} />
        </div>
      ) : null}

      {templates.length === 0 ? (
        <AdminSection>
          <Empty
            icon={<Mail size={40} strokeWidth={1.5} />}
            message="No email templates yet"
            cause="none"
          />
          <div style={{ textAlign: 'center', marginTop: theme.space[6] }}>
            <Button variant="primary" size="md" leftIcon={<Plus size={16} />} onClick={startCreate}>
              Create your first template
            </Button>
          </div>
        </AdminSection>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[3] }}>
          {templates.map(tpl => {
            const catColor = CATEGORY_COLORS[tpl.category] || CATEGORY_COLORS.general
            return (
              <Card key={tpl.id} style={{ padding: theme.space[5] }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[4] }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: theme.radius.md, flexShrink: 0,
                    background: theme.tealMist, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Mail size={18} color={theme.tealDeep} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[3], marginBottom: 2 }}>
                      <span style={{ fontWeight: 800, fontSize: theme.type.body.size, color: theme.textDark }}>
                        {tpl.name}
                      </span>
                      <span style={{
                        fontSize: theme.type.micro.size, fontWeight: 700, padding: '2px 8px',
                        borderRadius: theme.radius.full, background: catColor.bg, color: catColor.text,
                        textTransform: 'uppercase', letterSpacing: '0.03em',
                      }}>
                        {tpl.category}
                      </span>
                      <span style={{
                        fontSize: theme.type.micro.size, fontWeight: 700, padding: '2px 8px',
                        borderRadius: theme.radius.full,
                        background: tpl.is_active ? theme.successBg : theme.gray100,
                        color: tpl.is_active ? theme.success : theme.gray500,
                      }}>
                        {tpl.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[3] }}>
                      <span style={{
                        fontSize: theme.type.caption.size, color: theme.textLight,
                        fontFamily: theme.fontMono,
                      }}>
                        {tpl.slug}
                      </span>
                      <span style={{ fontSize: theme.type.caption.size, color: theme.textMuted }}>
                        Updated {timeAgo(tpl.updated_at)}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[2] }}>
                    <Button variant="ghost" size="sm" onClick={() => toggleActive(tpl)} title={tpl.is_active ? 'Deactivate' : 'Activate'}>
                      {tpl.is_active
                        ? <ToggleRight size={18} color={theme.success} />
                        : <ToggleLeft size={18} color={theme.gray400} />
                      }
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => startEdit(tpl)} leftIcon={<Edit3 size={14} />}>
                      Edit
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => requestDelete(tpl)} leftIcon={<Trash2 size={14} />}>
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {systemPreviewHtml && (
        <Modal show={!!systemPreviewHtml} onClose={() => { setSystemPreviewHtml(null); setSystemPreviewKey(null) }} title={`Preview: ${systemPreviewKey}`} size="lg">
          {systemPreviewVars && (
            <div style={{
              background: theme.gray100, borderRadius: theme.radius.sm, padding: theme.space[4],
              marginBottom: theme.space[4], fontSize: theme.type.bodySm.size, color: theme.textMid,
            }}>
              <strong>Sample variables used:</strong> {JSON.stringify(systemPreviewVars)}
            </div>
          )}
          <div style={{ border: `1px solid ${theme.border}`, borderRadius: theme.radius.md, overflow: 'hidden' }}>
            <iframe
              srcDoc={systemPreviewHtml || ''}
              title="System template preview"
              style={{ width: '100%', height: 500, border: 'none' }}
            />
          </div>
        </Modal>
      )}

      <Modal show={systemTestModal} onClose={() => setSystemTestModal(false)} title="Send Test Email (System Template)">
        <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[4] }}>
          <Input label="Recipient Email" value={systemTestEmail} onChange={setSystemTestEmail} placeholder="admin@example.com" type="email" />
          <p style={{ margin: 0, fontSize: theme.type.bodySm.size, color: theme.textLight }}>
            The system template will be rendered with sample variable values.
          </p>
          <Button variant="primary" size="md" fullWidth onClick={sendSystemTest} loading={systemTestSending} leftIcon={systemTestSending ? <Loader2 size={16} /> : <Send size={16} />}>
            Send Test Email
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        show={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={confirmDelete}
        title="Delete this email template?"
        consequence={`This permanently removes the "${deleteConfirm?.name}" template. Emails using this template will fall back to hardcoded defaults. This cannot be undone.`}
        confirmLabel="Delete Template"
      />
    </div>
  )
}
