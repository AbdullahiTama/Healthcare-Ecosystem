import { useEffect, useState } from 'react'
import { Trash2, Megaphone, X } from 'lucide-react'
import { Button, Input, Select, Empty } from '@care-ecosystem/design-system/components/ui'
import { timeAgo } from '../ui'
import { usePromotionsList } from '../hooks/useContentLists'
import { useContentActions } from '../hooks/useContentActions'
import { useAdmin } from '../provider/AdminProvider.jsx'

const DURATION_OPTIONS = [
  { value: '3', label: '3 days' },
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
]
const DEFAULT_DAYS = '7'
const DELETE_CONSEQUENCE = 'This permanently removes the promotion from the app. This cannot be undone.'

// Promotion fields come from the database: a link or image is only ever
// treated as a URL when it is http(s), so a javascript: value is never an href.
const isHttpUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url)

const labelStyle = { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--adm-ink-mid)', marginBottom: 6 }
const fieldsStyle = { display: 'flex', flexDirection: 'column', gap: 16, padding: 16 }
const errorStyle = { margin: 0, padding: '10px 12px', borderRadius: 8, background: 'var(--adm-urgent-wash)', color: 'var(--adm-urgent)', fontSize: 13 }

function expiryText(promo) {
  if (!promo.expires_at) return 'No expiry'
  const t = new Date(promo.expires_at)
  if (isNaN(t)) return 'No expiry'
  return t < new Date() ? 'Expired' : `Expires ${t.toLocaleDateString()}`
}

function PromotionRow({ promo, disabled, error, onDelete }) {
  const expired = promo.expires_at && new Date(promo.expires_at) < new Date()
  return (
    <li style={{ padding: '12px 16px', opacity: expired ? 0.6 : 1 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {isHttpUrl(promo.image_url)
          ? <img src={promo.image_url} alt="" loading="lazy" style={{ width: 64, height: 64, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
          : (
            <span aria-hidden="true" style={{ width: 64, height: 64, borderRadius: 8, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--adm-line-soft)', color: 'var(--adm-ink-soft)', fontSize: 11, fontWeight: 700 }}>
              No image
            </span>
          )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, overflowWrap: 'anywhere' }}>{promo.title}</div>
          {promo.link_url && (
            <div className="adm-note" style={{ overflowWrap: 'anywhere' }}>
              {isHttpUrl(promo.link_url)
                ? <a href={promo.link_url} target="_blank" rel="noreferrer">{promo.link_url}</a>
                : promo.link_url}
            </div>
          )}
          <div className="adm-note"><span>{expiryText(promo)}</span> · <span>{timeAgo(promo.created_at)}</span></div>
        </div>
        <Button variant="danger" size="sm" disabled={disabled} aria-label={`Delete promotion ${promo.title}`}
          leftIcon={<Trash2 size={14} aria-hidden="true" />} onClick={onDelete}>
          Delete
        </Button>
      </div>
      {error && <p role="alert" style={{ ...errorStyle, marginTop: 8 }}>{error}</p>}
    </li>
  )
}

export default function PromotionsSection() {
  const query = usePromotionsList()
  const { busy, createPromotion, deletePromotion } = useContentActions()
  const { askConfirm } = useAdmin()

  const [title, setTitle] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [days, setDays] = useState(DEFAULT_DAYS)
  const [file, setFile] = useState(null)
  const [fileKey, setFileKey] = useState(0) // remounts the file input to clear it
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [deleteErrors, setDeleteErrors] = useState({})

  useEffect(() => {
    if (!file) { setPreview(null); return undefined }
    let cancelled = false
    const reader = new FileReader()
    reader.onloadend = () => { if (!cancelled) setPreview(reader.result) }
    reader.readAsDataURL(file)
    return () => { cancelled = true }
  }, [file])

  const valid = !!title.trim()

  const pickFile = (e) => {
    setFile(e.target.files?.[0] || null)
    setError('')
  }
  const removeFile = () => { setFile(null); setFileKey(k => k + 1) }

  const submit = async (e) => {
    e.preventDefault()
    if (busy || !valid) return
    setError('')
    const res = await createPromotion({ title: title.trim(), linkUrl, days, imageFile: file })
    if (res.ok) {
      setTitle(''); setLinkUrl(''); setDays(DEFAULT_DAYS); removeFile()
    } else {
      setError(res.error || "Couldn't add the promotion")
    }
  }

  const confirmDelete = (promo) => askConfirm({
    title: 'Delete this promotion?',
    consequence: DELETE_CONSEQUENCE,
    confirmLabel: 'Delete',
    action: async () => {
      const res = await deletePromotion(promo.id)
      setDeleteErrors(prev => {
        const next = { ...prev }
        if (res.ok) delete next[promo.id]
        else next[promo.id] = `Couldn't delete the promotion: ${res.error}`
        return next
      })
    },
  })

  let list
  if (query.isError) {
    list = (
      <div style={{ padding: 16 }}>
        <p className="adm-note">Couldn't load promotions</p>
        <Button variant="ghost" size="sm" onClick={() => query.refetch()}>Retry</Button>
      </div>
    )
  } else if (query.isLoading || !query.data) {
    list = <p role="status" className="adm-note" style={{ padding: 16 }}>Loading promotions…</p>
  } else if (query.data.length === 0) {
    list = <Empty icon={<Megaphone size={40} strokeWidth={1.5} />} message="No promotions yet" cause="none" />
  } else {
    list = (
      <ul className="adm-queue">
        {query.data.map(p => (
          <PromotionRow key={p.id} promo={p} disabled={busy} error={deleteErrors[p.id]} onDelete={() => confirmDelete(p)} />
        ))}
      </ul>
    )
  }

  return (
    <div className="adm-page">
      <header className="adm-head">
        <div>
          <h1>Promotions</h1>
          <p className="adm-note">Manage featured promotions in the MedMarket strip</p>
        </div>
      </header>

      <section className="adm-panel" aria-labelledby="promo-create-h">
        <div className="adm-phead">
          <div>
            <h2 id="promo-create-h">Add a Promotion</h2>
            <p className="adm-note">Promotions appear in the moving featured strip and auto-expire</p>
          </div>
        </div>
        <form onSubmit={submit} style={fieldsStyle}>
          <Input label="Promotion Title" value={title} onChange={setTitle} disabled={busy} required placeholder="e.g. 50% off Vitamin C" />
          <Input label="Link URL" value={linkUrl} onChange={setLinkUrl} disabled={busy}
            placeholder="e.g. /business/xyz or product page" helperText="Where users go when they tap the promotion" />
          <Select label="Duration" value={days} onChange={(v) => setDays(v || DEFAULT_DAYS)} disabled={busy} options={DURATION_OPTIONS} />

          <div>
            <label htmlFor="promo-image" style={labelStyle}>Image (optional)</label>
            <input key={fileKey} id="promo-image" type="file" accept="image/*" onChange={pickFile} disabled={busy} />
            {file && <div className="adm-note" style={{ marginTop: 6, overflowWrap: 'anywhere' }}>{file.name}</div>}
            {preview && (
              <div style={{ marginTop: 8 }}>
                <img src={preview} alt="Selected image preview" style={{ width: '100%', maxHeight: 160, objectFit: 'cover', display: 'block', borderRadius: 8, border: '1px solid var(--adm-line)' }} />
              </div>
            )}
            {file && (
              <Button variant="ghost" size="sm" disabled={busy} leftIcon={<X size={14} aria-hidden="true" />}
                onClick={removeFile} style={{ marginTop: 8 }}>
                Remove image
              </Button>
            )}
          </div>

          {error && <p role="alert" style={errorStyle}>{error}</p>}
          <Button type="submit" variant="primary" fullWidth loading={busy} loadingText="Adding…" disabled={busy || !valid}>
            Add promotion
          </Button>
        </form>
      </section>

      <section className="adm-panel" aria-labelledby="promo-list-h">
        <div className="adm-phead"><h2 id="promo-list-h">Active Promotions</h2></div>
        {list}
      </section>
    </div>
  )
}
