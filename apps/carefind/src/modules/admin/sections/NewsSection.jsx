import { useEffect, useRef, useState } from 'react'
import { Check, Pencil, Trash2, X } from 'lucide-react'
import { Button, Input, StatusBadge, Textarea } from '@care-ecosystem/design-system/components/ui'
import ReviewQueue from '../ui/ReviewQueue.jsx'
import { timeAgo } from '../ui'
import { useNewsList } from '../hooks/useContentLists'
import { useNewsActions } from '../hooks/useNewsActions'
import { useAdmin } from '../provider/AdminProvider.jsx'

// What the server's news handlers do, read from api/_handlers/admin-auth.js.
// Keep these true: change them whenever those handlers change.
//   approve_news -> applies `edits`, sets status 'approved' and published_at (publishes it)
//   reject_news  -> sets status 'rejected' only (not published, not deleted)
//   delete_news  -> deletes the row
const REJECT_CONSEQUENCE = 'The item is marked as rejected and is not published. It stays in the list under All, where it can still be approved.'
const DELETE_CONSEQUENCE = 'This permanently removes the news item from the app. This cannot be undone.'

const FIELDS = ['headline', 'subtitle', 'body']
const BODY_NOTE = 'Note: Body is stored as rich blocks; heavy formatting is best done in-app. Light text edits here are fine.'
// The queue's Pending tab holds only pending items.
const isOpen = (n) => n.status === 'pending'
// Which actions an item offers, as the legacy News tab had them: Edit and
// Reject only while pending; Approve for anything not yet approved, so a
// rejected item can still be published; Delete always.
const canEdit = (n) => n.status === 'pending'
const canReject = (n) => n.status === 'pending'
const canApprove = (n) => n.status !== 'approved'
const person = (n) => n.profiles?.full_name || n.profiles?.display_name || 'User'
const headlineOf = (n) => n.headline || 'News item'
const submitted = (n) => (n.created_at ? timeAgo(n.created_at) : '—')
// Only an http(s) URL from the database is ever loaded as an image.
const isHttpUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url)
const text = (v) => (v == null ? '' : String(v))
// A tel: target of digits and + only ('' when nothing remains: no link).
const telTarget = (phone) => text(phone).replace(/[^+\d]/g, '')
// An email is a link only when it is ONE plain address: no whitespace, exactly
// one '@', and no ',' or ';' (which would add recipients). Anything else is
// shown as text.
const SINGLE_ADDRESS = /^[^\s@,;]+@[^\s@,;]+$/
const isSingleAddress = (email) => SINGLE_ADDRESS.test(text(email))
// The mailto: target keeps '@' literal; the characters that would start a
// query or fragment, add a recipient, or break the URL are encoded, so a
// crafted address cannot add cc/subject/body headers.
const mailtoTarget = (email) => text(email).replace(/[?&#%,;\s]/g, c => encodeURIComponent(c))

// Submitted is not sortable: the server returns the newest 60 only, so sorting
// would reorder a partial list and mislead (Phase 2b finding 44).
export const columns = [
  { key: 'headline', label: 'Headline', render: n => n.headline || '—' },
  { key: 'person', label: 'Submitted by', render: person },
  { key: 'status', label: 'Status', render: n => <StatusBadge status={n.status} /> },
  { key: 'created_at', label: 'Submitted', render: submitted },
]

// What Approve sends. A field counts as edited only when the admin opened Edit
// and its value differs from the item's; an untouched field keeps the item's
// own value (a missing subtitle stays missing rather than becoming '').
function approvalOf(n, draft) {
  const changed = (f) => !!draft && text(draft[f]) !== text(n[f])
  const value = (f) => (changed(f) ? draft[f] : n[f])
  return {
    id: n.id,
    headline: value('headline'),
    subtitle: value('subtitle'),
    body: value('body'),
    edited: FIELDS.some(changed),
    // The audit records the item's own headline, as legacy did.
    originalHeadline: n.headline,
  }
}

const sectionStyle = { marginTop: 16 }
const headingStyle = { margin: '0 0 8px', fontSize: 13, fontWeight: 600 }
// The shared Modal footer is a non-wrapping row; three buttons would be crushed
// on a phone, so they sit in a wrapping row that stacks below ~320px.
const footerRowStyle = { display: 'flex', flexWrap: 'wrap', gap: 8, width: '100%' }
const footerButtonStyle = { flex: '1 1 150px' }

// While mounted it marks its item as the one on screen; its unmount (drawer
// closed or another item opened) clears the mark and any unsaved edits, so a
// late result knows its drawer is gone and edits never carry over.
function NewsBody({ n, phone, shownId, draft, setDraft, busy }) {
  const { id } = n
  useEffect(() => {
    shownId.current = id
    return () => {
      if (shownId.current === id) shownId.current = null
      setDraft(d => (d?.id === id ? null : d))
    }
  }, [id, shownId, setDraft])

  const editing = draft?.id === id
  const email = n.contact_email
  const set = (field) => (value) => setDraft(d => ({ ...d, [field]: value }))

  return (
    <>
      <dl className="adm-drawer-grid">
        <dt>Submitted by</dt><dd>{person(n)}</dd>
        <dt>Submitted</dt><dd>{n.created_at ? `${timeAgo(n.created_at)} · ${new Date(n.created_at).toLocaleString()}` : '—'}</dd>
      </dl>

      {(phone || email) && (
        <section aria-label="Contact the submitter" style={sectionStyle}>
          <h3 style={headingStyle}>Contact the submitter</h3>
          <dl className="adm-drawer-grid">
            {phone && (
              <><dt>Phone</dt><dd>{telTarget(phone)
                ? <a href={`tel:${telTarget(phone)}`} aria-label={`Call ${phone}`}>{phone}</a>
                : text(phone)}</dd></>
            )}
            {email && (
              <><dt>Email</dt><dd>{isSingleAddress(email)
                ? <a href={`mailto:${mailtoTarget(email)}`} aria-label={`Email ${email}`}>{email}</a>
                : text(email)}</dd></>
            )}
          </dl>
        </section>
      )}

      {isHttpUrl(n.hero_image_url) && (
        <section aria-label="Image" style={sectionStyle}>
          <img src={n.hero_image_url} alt="News image" loading="lazy"
            style={{ display: 'block', width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--adm-line)' }} />
        </section>
      )}

      <section aria-label="Article" style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <h3 style={{ ...headingStyle, margin: 0 }}>{editing ? 'Edit before publishing' : 'Article'}</h3>
          {canEdit(n) && (editing ? (
            <Button size="sm" variant="ghost" disabled={busy} leftIcon={<X size={14} aria-hidden="true" />} onClick={() => setDraft(null)}>
              Cancel edit
            </Button>
          ) : (
            <Button size="sm" variant="ghost" disabled={busy} leftIcon={<Pencil size={14} aria-hidden="true" />}
              onClick={() => setDraft({ id, headline: n.headline, subtitle: n.subtitle, body: n.body })}>
              Edit
            </Button>
          ))}
        </div>
        {editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Input id="news-edit-headline" label="Headline" required value={draft.headline} onChange={set('headline')} disabled={busy}
              error={text(draft.headline).trim() ? undefined : 'A headline is required to publish.'} />
            <Input id="news-edit-subtitle" label="Subtitle" value={draft.subtitle} onChange={set('subtitle')} disabled={busy} />
            <Textarea id="news-edit-body" label="Body" value={draft.body} onChange={set('body')} rows={8} disabled={busy} helperText={BODY_NOTE} />
          </div>
        ) : (
          <>
            {n.subtitle && <p style={{ margin: '0 0 8px', fontStyle: 'italic', overflowWrap: 'anywhere' }}>{n.subtitle}</p>}
            {n.body
              ? <p className="adm-drawer-text" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{text(n.body)}</p>
              : <p className="adm-note">This item has no body text</p>}
          </>
        )}
      </section>
    </>
  )
}

// The news review queue. Approving publishes a community submission; Reject
// and Delete ask first. The "Pending" tab holds submissions awaiting review.
export default function NewsSection() {
  const { data, isLoading, isError, refetch } = useNewsList()
  const { busyId, approveNews, rejectNews, deleteNews } = useNewsActions()
  const { askConfirm, showToast } = useAdmin()
  // The id of the item the drawer is rendering (null once no drawer is shown).
  const shownId = useRef(null)
  // Unsaved edits: { id, headline, subtitle, body } for the item being edited.
  const [draft, setDraft] = useState(null)
  // Which action this screen started, so only that button says it is working.
  const [acting, setActing] = useState(null)

  // A settled query with no data is a failure, never an empty queue.
  const source = isLoading ? undefined
    : (isError || !Array.isArray(data?.items)) ? { status: 'error' }
      : { status: 'ok', data: data.items }
  const phones = data?.phones || {}
  const busy = busyId != null

  const renderDrawer = (n, { close, setError }) => {
    shownId.current = n.id
    // close and setError act on whichever drawer is open now. The admin may have
    // closed this drawer or opened another by the time a result arrives: then a
    // failure is toasted, never dropped, and a success needs nothing more (the
    // hook has toasted and refreshed).
    // A throw, or a result without ok, is a failure like any other, so
    // nothing escapes the onClick or the confirm action.
    const run = async (kind, call) => {
      setActing({ id: n.id, kind })
      let res
      try {
        const out = await call()
        res = out?.ok === true ? out : { ok: false, error: out?.error || 'The server gave no result' }
      } catch (err) {
        res = { ok: false, error: err?.message || String(err) }
      } finally {
        setActing(null)
      }
      const message = res.ok ? null : `Couldn't ${kind} the news item: ${res.error}`
      if (shownId.current !== n.id) {
        if (message) showToast(message, { type: 'error' })
        return
      }
      if (res.ok) close(); else setError(message)
    }
    const working = (kind) => acting?.id === n.id && acting.kind === kind
    const editing = draft?.id === n.id
    const approval = approvalOf(n, editing ? draft : null)
    // Only an edited headline can block Approve; the item's own is never checked.
    const headlineBlank = editing && !text(draft.headline).trim()
    const phone = n.contact_phone || phones[n.author_id]

    const deleteButton = (
      <Button variant="danger" style={footerButtonStyle} disabled={busy} loading={working('delete')} loadingText="Deleting…"
        leftIcon={<Trash2 size={14} aria-hidden="true" />}
        onClick={() => askConfirm({
          title: 'Permanently delete this news item?',
          consequence: DELETE_CONSEQUENCE,
          confirmLabel: 'Delete',
          action: () => run('delete', () => deleteNews(n.id)),
        })}>
        Delete
      </Button>
    )

    return {
      body: <NewsBody key={n.id} n={n} phone={phone} shownId={shownId} draft={draft} setDraft={setDraft} busy={busy} />,
      footer: (
        <div style={footerRowStyle}>
          {canApprove(n) && (
            <Button variant="primary" style={footerButtonStyle} disabled={busy || headlineBlank} loading={working('approve')} loadingText="Publishing…"
              leftIcon={<Check size={14} aria-hidden="true" />}
              onClick={() => run('approve', () => approveNews(approval))}>
              Approve and publish
            </Button>
          )}
          {canReject(n) && (
            <Button variant="secondary" style={footerButtonStyle} disabled={busy} loading={working('reject')} loadingText="Rejecting…"
              leftIcon={<X size={14} aria-hidden="true" />}
              onClick={() => askConfirm({
                title: 'Reject this news item?',
                consequence: REJECT_CONSEQUENCE,
                confirmLabel: 'Reject',
                action: () => run('reject', () => rejectNews(n.id)),
              })}>
              Reject
            </Button>
          )}
          {deleteButton}
        </div>
      ),
    }
  }

  return (
    <ReviewQueue
      title="News"
      source={source}
      onRetry={() => refetch()}
      columns={columns}
      isOpen={isOpen}
      cap={60}
      nothingWaiting="Nothing pending"
      noneYet="No news submissions yet"
      drawerTitle={headlineOf}
      renderDrawer={renderDrawer}
    />
  )
}
