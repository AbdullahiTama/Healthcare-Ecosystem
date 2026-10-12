import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Trash2 } from 'lucide-react'
import { Button } from '@care-ecosystem/design-system/components/ui'
import DirectoryTable from '../ui/DirectoryTable.jsx'
import { DateRange, FilterPills, exportCSV, timeAgo } from '../ui'
import { usePostsDirectory } from '../hooks/usePostsDirectory'
import { useReviewActions } from '../hooks/useReviewActions'
import { useAdmin } from '../provider/AdminProvider.jsx'
import { callAdminAuth } from '../adminApi'

const NO_FILTERS = { search: '', type: 'all', dateFrom: '', dateTo: '', page: 0 }
const capitalised = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '')
const TYPE_OPTIONS = ['all', 'text', 'question', 'review', 'article', 'visual', 'premium']
  .map(value => ({ value, label: capitalised(value) }))
const DELETE_CONSEQUENCE = 'This permanently deletes the post along with its likes and comments. This cannot be undone.'
const EXCERPT_LENGTH = 100

// The list excerpt is one line (runs of whitespace collapse), cut at 100
// characters with an ellipsis; '' for a post without text.
const excerptOf = (p) => {
  const text = typeof p.content === 'string' ? p.content.replace(/\s+/g, ' ').trim() : ''
  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH)}…` : text
}
const rowLabel = (p) => excerptOf(p) || 'Post'
const typeLabel = (p) => capitalised(p.post_type) || 'Post'
const postedAt = (p) => {
  const t = p.created_at ? Date.parse(p.created_at) : NaN
  return Number.isFinite(t) ? t : 0
}

const columns = [
  { key: 'content', label: 'Post', render: p => excerptOf(p) || '—' },
  { key: 'post_type', label: 'Type', render: p => capitalised(p.post_type) || '—' },
  { key: 'user_id', label: 'Author', render: p => (p.user_id ? String(p.user_id).slice(0, 8) : '—') },
  // A missing view count is unknown, never 0.
  { key: 'view_count', label: 'Views', render: p => (p.view_count == null ? '—' : String(p.view_count)) },
  // Sorting reorders only the rows on this page; a post without a date sorts as 0.
  { key: 'created_at', label: 'Posted', sortable: true, sortValue: postedAt, render: p => (p.created_at ? timeAgo(p.created_at) : '—') },
]

// Only an http(s) URL from the database is ever made a link.
const isHttpUrl = (url) => /^https?:\/\//i.test(url)
const imagesOf = (p) => {
  const list = Array.isArray(p.image_urls) ? p.image_urls.filter(u => typeof u === 'string' && u) : []
  if (list.length) return list
  return typeof p.image_url === 'string' && p.image_url ? [p.image_url] : []
}

const sectionStyle = { marginTop: 16 }
const headingStyle = { margin: '0 0 8px', fontSize: 13, fontWeight: 600 }
const badgeStyle = {
  display: 'inline-flex', alignItems: 'center', padding: '2px 10px', borderRadius: 9999,
  fontSize: 12, fontWeight: 600, background: 'var(--adm-line-soft)', color: 'var(--adm-ink)',
}

// The author, loaded only while this drawer is open. A failed or malformed
// response is shown as failed, never as an unknown user. isPending also covers
// a disabled query.
function PostAuthor({ userId }) {
  const author = useQuery({
    queryKey: ['admin', 'post-author', userId],
    queryFn: async () => {
      const res = await callAdminAuth('get_user_profile', { userId })
      const profile = res?.data
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('get_user_profile returned no profile')
      return profile
    },
    enabled: !!userId,
  })

  let content
  if (!userId) content = <p className="adm-note">No author recorded</p>
  else if (author.isPending) content = <p className="adm-note">Loading the author…</p>
  else if (author.isError) content = <p className="adm-note">Couldn't load the author</p>
  else {
    const a = author.data
    const name = a.full_name || a.display_name || 'No name'
    content = (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--teal, #0e6f5a)', color: 'white', fontSize: 14, fontWeight: 700 }}>
          {name[0]?.toUpperCase()}
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, fontSize: 13 }}>
          <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{name}</span>
          {a.full_name && a.display_name && <span className="adm-note">@{a.display_name}</span>}
          {a.verification_label && <span className="adm-note">{a.verification_label}</span>}
        </span>
      </div>
    )
  }

  return (
    <section aria-label="Author">
      <h3 style={headingStyle}>Author</h3>
      {content}
    </section>
  )
}

// While mounted it marks its post as the one on screen; its unmount (drawer
// closed or another post opened) clears the mark, so a late delete result knows
// its drawer is gone.
function PostBody({ p, shownId }) {
  const { id } = p
  useEffect(() => {
    shownId.current = id
    return () => { if (shownId.current === id) shownId.current = null }
  }, [id, shownId])

  const images = imagesOf(p)
  const hasRating = p.rating != null && p.rating !== ''
  const badges = [
    hasRating && `Rating ${p.rating}`,
    p.theme && `Theme: ${p.theme}`,
    p.subscriber_only && 'Subscribers only',
  ].filter(Boolean)

  return (
    <>
      <PostAuthor userId={p.user_id} />

      <section aria-label="Post" style={sectionStyle}>
        <h3 style={headingStyle}>Posted {p.created_at ? timeAgo(p.created_at) : '—'}</h3>
        {p.content
          ? <p className="adm-drawer-text" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{p.content}</p>
          : <p className="adm-note">This post has no text</p>}
        {badges.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {badges.map(b => <span key={b} style={badgeStyle}>{b}</span>)}
          </div>
        )}
      </section>

      {images.length > 0 && (
        <section aria-label="Images" style={sectionStyle}>
          <h3 style={headingStyle}>Images ({images.length})</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
            {images.map((url, i) => {
              const img = (
                <img src={url} alt={`Post image ${i + 1} of ${images.length}`} loading="lazy"
                  style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block', borderRadius: 8, border: '1px solid var(--adm-line)' }} />
              )
              return isHttpUrl(url)
                ? <a key={i} href={url} target="_blank" rel="noreferrer" style={{ display: 'block' }}>{img}</a>
                : <span key={i} style={{ display: 'block' }}>{img}</span>
            })}
          </div>
        </section>
      )}

      {p.video_url && (
        <section aria-label="Video" style={sectionStyle}>
          <h3 style={headingStyle}>Video</h3>
          <video src={p.video_url} controls preload="metadata" aria-label="Post video" style={{ width: '100%', maxHeight: 400, borderRadius: 8, background: 'var(--color-gray-900, #111)' }} />
        </section>
      )}

      {p.audio_url && (
        <section aria-label="Audio" style={sectionStyle}>
          <h3 style={headingStyle}>Audio</h3>
          <audio src={p.audio_url} controls preload="metadata" aria-label="Post audio" style={{ width: '100%' }} />
        </section>
      )}
    </>
  )
}

export default function PostsSection() {
  const [filters, setFilters] = useState(NO_FILTERS)
  const { search, type, dateFrom, dateTo, page } = filters
  // A filter change always returns to the first page; an unchanged value is a no-op.
  const update = (patch) => setFilters(prev => (
    Object.keys(patch).every(k => prev[k] === patch[k]) ? prev : { ...prev, ...patch, page: 0 }
  ))
  // DirectoryTable mirrors search going to '' into its box, so this clears it too.
  const clear = () => setFilters(NO_FILTERS)

  const query = usePostsDirectory({ search, type, dateFrom, dateTo, page })
  const rows = query.data?.rows || []
  const { busyId, deletePost } = useReviewActions()
  const { askConfirm, showToast } = useAdmin()
  // The id of the post the drawer is rendering (null once no drawer is shown).
  const shownId = useRef(null)

  const renderDrawer = (p, { close, setError }) => {
    shownId.current = p.id
    // The confirm closes before the delete runs, so the admin may have closed
    // the drawer or opened another post by the time it ends. Then close and
    // setError would act on the wrong drawer: a failure is toasted instead, and
    // a success needs nothing more (the hook has toasted and refreshed).
    const finish = (res) => {
      if (shownId.current !== p.id) {
        if (!res.ok) showToast(`Couldn't delete the post: ${res.error}`, { type: 'error' })
        return
      }
      if (res.ok) close(); else setError(res.error)
    }
    return {
      title: typeLabel(p),
      body: <PostBody key={p.id} p={p} shownId={shownId} />,
      footer: (
        <Button variant="danger" fullWidth loading={busyId === p.id} loadingText="Deleting…" leftIcon={<Trash2 size={14} aria-hidden="true" />}
          onClick={() => askConfirm({
            title: 'Delete this post?',
            consequence: DELETE_CONSEQUENCE,
            confirmLabel: 'Delete',
            action: async () => finish(await deletePost(p.id)),
          })}>
          Delete post
        </Button>
      ),
    }
  }

  return (
    <DirectoryTable
      title="Posts"
      noun="post"
      query={query}
      columns={columns}
      search={search}
      onSearch={(s) => update({ search: s })}
      searchPlaceholder="Search post text…"
      filters={(
        <>
          <FilterPills label="Post type" options={TYPE_OPTIONS} value={type} onChange={(v) => update({ type: v })} />
          {/* The server treats To as the whole day. */}
          <div role="group" aria-label="Posted between" style={{ minWidth: 260 }}>
            <DateRange from={dateFrom} to={dateTo}
              onFrom={(v) => update({ dateFrom: v })} onTo={(v) => update({ dateTo: v })} />
          </div>
        </>
      )}
      filtersActive={!!(search || type !== 'all' || dateFrom || dateTo)}
      onClear={clear}
      page={page}
      onPage={(n) => setFilters(prev => ({ ...prev, page: n }))}
      renderDrawer={renderDrawer}
      rowLabel={rowLabel}
      toolbar={(
        <Button variant="ghost" size="sm" leftIcon={<Download size={14} />}
          disabled={rows.length === 0 || query.isPlaceholderData}
          onClick={() => exportCSV(rows, 'posts_page.csv')}>
          Export this page (CSV)
        </Button>
      )}
    />
  )
}
