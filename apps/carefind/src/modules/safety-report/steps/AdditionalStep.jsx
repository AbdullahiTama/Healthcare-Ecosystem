import { useEffect, useState } from 'react'
import { ADDITIONAL_INFO_LABEL } from '../constants.js'
import { Field, TextInput, TextArea, s } from '../ui.jsx'

export default function AdditionalStep({ value, meds, attachments, onExtra, onMeds, onUpload, onRemoveAttachment, resolveUrl }) {
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)

  const patchMed = (index, next) => onMeds(meds.map((m, i) => (i === index ? { ...m, ...next } : m)))
  const addMed = () => onMeds([...meds, { name: '', dose: '', startDate: '', endDate: '' }])
  const removeMed = (index) => onMeds(meds.filter((_, i) => i !== index))

  const handleFiles = async (files) => {
    setUploadError(null)
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        setUploadError('Only photos (JPG, PNG, WebP) can be attached.')
        continue
      }
      if (file.size > 10 * 1024 * 1024) {
        setUploadError(`“${file.name}” is larger than 10MB and was skipped.`)
        continue
      }
      setUploading(true)
      try {
        await onUpload(file)
      } catch {
        setUploadError('Upload failed. Check your connection and retry — your report is still saved.')
      } finally {
        setUploading(false)
      }
    }
  }

  return (
    <section aria-labelledby="sr-additional-h">
      <h2 id="sr-additional-h" style={s.h2}>Anything else</h2>
      <p style={s.muted}>This step is optional. A basic report without it is still valid — continue whenever you are ready.</p>

      <details open={false} style={{ ...s.card, padding: 0 }}>
        <summary style={{ fontSize: 15, fontWeight: 800, cursor: 'pointer', padding: 16 }}>{ADDITIONAL_INFO_LABEL}</summary>
        <div style={{ padding: '0 16px 16px' }}>
          <h3 style={{ ...s.h2, fontSize: 14 }}>Other medicines being taken</h3>
          {meds.map((m, i) => (
            <div key={m.med_id || `new-${i}`} style={{ ...s.row, alignItems: 'flex-end', marginBottom: 8 }}>
              <div style={{ flex: 2, minWidth: 140 }}>
                <Field label={i === 0 ? 'Medicine name' : `Medicine ${i + 1}`} htmlFor={`sr-med-${i}`}>
                  <TextInput id={`sr-med-${i}`} value={m.name} onChange={(e) => patchMed(i, { name: e.target.value })} maxLength={160} autoComplete="off" />
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 100 }}>
                <Field label="Dose" htmlFor={`sr-meddose-${i}`}>
                  <TextInput id={`sr-meddose-${i}`} value={m.dose} onChange={(e) => patchMed(i, { dose: e.target.value })} maxLength={64} autoComplete="off" />
                </Field>
              </div>
              <button type="button" onClick={() => removeMed(i)} style={s.btnGhost} aria-label={`Remove medicine ${i + 1}`}>Remove</button>
            </div>
          ))}
          <button type="button" onClick={addMed} style={s.btnGhost}>+ Add another medicine</button>

          <Field label="Other health conditions" htmlFor="sr-conditions" help="Optional. Conditions the person already lives with.">
            <TextArea id="sr-conditions" value={value.conditions} onChange={(e) => onExtra({ ...value, conditions: e.target.value })} maxLength={2000} />
          </Field>

          <Field label="Anything else for the reviewers" htmlFor="sr-notes" help="Optional. Test results, what the doctor said, or anything that did not fit above.">
            <TextArea id="sr-notes" value={value.notes} onChange={(e) => onExtra({ ...value, notes: e.target.value })} maxLength={4000} />
          </Field>

          <h3 style={{ ...s.h2, fontSize: 14 }}>Photos (optional)</h3>
          <p style={s.help}>A photo of the pack or the effect can help reviewers. Photos stay confidential — they are never published.</p>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            aria-label="Attach photos"
            disabled={uploading}
            onChange={(e) => { handleFiles(Array.from(e.target.files || [])); e.target.value = '' }}
            style={{ marginTop: 6 }}
          />
          {uploading && <p style={s.help} role="status">Uploading…</p>}
          {uploadError && <p style={s.error} role="alert">{uploadError}</p>}
          {attachments.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {attachments.map((a) => (
                <AttachmentItem key={a.photo_id || a.path} attachment={a} resolveUrl={resolveUrl} onRemove={() => onRemoveAttachment(a)} />
              ))}
            </ul>
          )}
        </div>
      </details>
    </section>
  )
}

function AttachmentItem({ attachment, resolveUrl, onRemove }) {
  const [url, setUrl] = useState(attachment.pendingUrl || null)
  useEffect(() => {
    let live = true
    if (attachment.path && !attachment.pendingUrl) {
      resolveUrl(attachment.path).then((u) => { if (live) setUrl(u) }).catch(() => {})
    }
    return () => { live = false }
  }, [attachment.path, attachment.pendingUrl, resolveUrl])
  return (
    <li style={{ ...s.row, justifyContent: 'space-between', border: '1px solid var(--border)', borderRadius: 10, padding: 8 }}>
      <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {url ? <a href={url} target="_blank" rel="noreferrer">View photo</a> : 'Photo attached'}
        {attachment.caption ? ` — ${attachment.caption}` : ''}
      </span>
      <button type="button" onClick={onRemove} style={s.btnGhost} aria-label="Remove photo">Remove</button>
    </li>
  )
}

