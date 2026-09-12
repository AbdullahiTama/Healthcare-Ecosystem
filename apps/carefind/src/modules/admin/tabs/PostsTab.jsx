import { FileText, Search, Trash2, Eye, Clock, Download, X } from 'lucide-react'
import { Card, Button, Empty, Input } from '@care-ecosystem/design-system/components/ui'
import { theme } from '../../../styles/theme'
import { AdminPageHeader, AdminFilterBar, FilterPills, DateRange } from '../ui'

function timeAgo(d) {
  if (!d) return 'Never'
  const diff = Math.floor((Date.now() - new Date(d)) / 1000)
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function exportCSV(data, filename) {
  if (!data.length) return
  const keys = Object.keys(data[0])
  const csv = [keys.join(','), ...data.map(row => keys.map(k => JSON.stringify(row[k] ?? '')).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

const TYPE_OPTIONS = ['all', 'text', 'question', 'review', 'article', 'visual', 'premium']

export default function PostsTab({
  posts, selectedPost, setSelectedPost, postAuthor, setPostAuthor,
  postSearch, setPostSearch, postTypeFilter, setPostTypeFilter,
  postDateFrom, setPostDateFrom, postDateTo, setPostDateTo,
  viewPostDetails, deletePost,
}) {
  const filtered = posts.filter(p => {
    const matchSearch = !postSearch || p.content?.toLowerCase().includes(postSearch.toLowerCase())
    const matchType = postTypeFilter === 'all' || p.post_type === postTypeFilter
    const matchFrom = !postDateFrom || p.created_at >= postDateFrom
    const matchTo = !postDateTo || p.created_at <= postDateTo + 'T23:59:59'
    return matchSearch && matchType && matchFrom && matchTo
  })

  return (
    <div>
      <AdminPageHeader title="Posts" subtitle={`${posts.length} total posts`} />

      {selectedPost && (
        <Card style={{ padding: theme.space[6], marginBottom: theme.space[6], border: `1px solid ${theme.tealBright}`, background: theme.tealMist }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.space[5] }}>
            <div style={{ fontSize: theme.type.h3.size, fontWeight: theme.type.h3.weight, color: theme.textDark, display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileText size={16} /> Post Detail
            </div>
            <button onClick={() => { setSelectedPost(null); setPostAuthor(null) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.textLight }}>
              <X size={18} />
            </button>
          </div>

          {postAuthor && (
            <Card style={{ padding: theme.space[4], marginBottom: theme.space[4] }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ width: 42, height: 42, borderRadius: '50%', background: postAuthor.cover_url ? `url(${postAuthor.cover_url})` : theme.tealGradient, backgroundSize: 'cover', backgroundPosition: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16, fontWeight: 800, flexShrink: 0 }}>
                  {!postAuthor.cover_url && (postAuthor.full_name || postAuthor.display_name || '?')[0]?.toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 14, color: theme.navy }}>{postAuthor.full_name || postAuthor.display_name || 'Unknown user'}</div>
                  {postAuthor.display_name && postAuthor.full_name && <div style={{ fontSize: 11, color: theme.textLight }}>@{postAuthor.display_name}</div>}
                  {postAuthor.verification_label && <div style={{ fontSize: 11, color: theme.tealDeep, fontWeight: 700 }}>{postAuthor.verification_label}</div>}
                </div>
              </div>
            </Card>
          )}

          <div style={{ display: 'flex', gap: 8, marginBottom: theme.space[4], alignItems: 'center' }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: theme.tealDeep, textTransform: 'uppercase', background: '#fff', padding: '3px 9px', borderRadius: theme.radius.full }}>{selectedPost.post_type}</span>
            <span style={{ fontSize: 11, color: theme.textLight, display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={11} /> {timeAgo(selectedPost.created_at)}</span>
          </div>

          <Card style={{ padding: theme.space[5], marginBottom: theme.space[4] }}>
            <p style={{ margin: 0, fontSize: 14, color: theme.textMid, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{selectedPost.content}</p>
          </Card>

          <Button variant="danger" fullWidth onClick={() => { deletePost(selectedPost.id); setSelectedPost(null); setPostAuthor(null) }} leftIcon={<Trash2 size={14} />}>
            Delete This Post
          </Button>
        </Card>
      )}

      <AdminFilterBar search={postSearch} onSearch={setPostSearch} searchPlaceholder="Search by keyword...">
        <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[4] }}>
          <FilterPills options={TYPE_OPTIONS} value={postTypeFilter} onChange={setPostTypeFilter} />
          <DateRange from={postDateFrom} to={postDateTo} onFrom={setPostDateFrom} onTo={setPostDateTo} />
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" size="sm" fullWidth onClick={() => exportCSV(filtered, 'filtered_posts.csv')} leftIcon={<Download size={14} />}>
              Export Filtered CSV
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setPostSearch(''); setPostTypeFilter('all'); setPostDateFrom(''); setPostDateTo('') }}>
              Clear
            </Button>
          </div>
        </div>
      </AdminFilterBar>

      <div style={{ fontSize: 12, color: theme.gray500, marginBottom: theme.space[4], fontWeight: 600 }}>
        {filtered.length} post{filtered.length !== 1 ? 's' : ''} found
      </div>

      {filtered.length === 0 && <Empty icon={<FileText size={40} strokeWidth={1.5} />} message="No posts match your filters" />}

      {filtered.map(p => (
        <Card key={p.id} style={{ padding: theme.space[5], marginBottom: theme.space[4] }}>
          <div onClick={() => viewPostDetails(p)} style={{ cursor: 'pointer' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: theme.space[2] }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: theme.tealDeep, textTransform: 'uppercase', background: theme.tealMist, padding: '2px 7px', borderRadius: theme.radius.full }}>{p.post_type}</span>
              <span style={{ fontSize: 11, color: theme.textLight, display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={11} /> {timeAgo(p.created_at)}</span>
            </div>
            <p style={{ margin: `0 0 ${theme.space[3]}px 0`, fontSize: 13, color: theme.textMid }}>{p.content?.slice(0, 150)}{p.content?.length > 150 ? '...' : ''}</p>
            <div style={{ fontSize: 11, color: theme.tealDeep, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Eye size={12} /> Tap to read full post
            </div>
          </div>
          <div style={{ marginTop: theme.space[3], paddingTop: theme.space[3], borderTop: `1px solid ${theme.gray100}` }}>
            <Button variant="danger" size="sm" onClick={() => deletePost(p.id)} leftIcon={<Trash2 size={12} />}>Delete</Button>
          </div>
        </Card>
      ))}
    </div>
  )
}
