import { theme } from '../../../styles/theme'
import { Card, Button, Empty, StatusBadge, Input, Textarea } from '@care-ecosystem/design-system/components/ui'
import { AdminPageHeader, AdminSection } from '../ui'
import { Newspaper, Phone, Mail, Edit, Trash2, Check, X, User, Clock, Image, Send, ExternalLink } from 'lucide-react'

function timeAgo(d) {
  if (!d) return 'Never'
  const diff = Math.floor((Date.now() - new Date(d)) / 1000)
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function NewsTab({
  newsItems,
  editingNews,
  setEditingNews,
  newsPhones,
  savingNews,
  approveNews,
  rejectNews,
  deleteNews,
}) {
  return (
    <div>
      <AdminPageHeader
        title="News Submissions"
        subtitle="Review, edit, and publish community news"
      />

      {newsItems.length === 0 ? (
        <Empty
          icon={<Newspaper size={40} strokeWidth={1.5} />}
          message="No news submissions yet"
          cause="none"
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[4] }}>
          {newsItems.map(n => {
            const isEditing = editingNews && editingNews.id === n.id
            const phone = newsPhones[n.author_id]

            return (
              <Card
                key={n.id}
                style={{
                  padding: theme.space[6],
                  border: `1px solid ${n.status === 'pending' ? theme.warningBg : theme.border}`,
                  borderLeftWidth: n.status === 'pending' ? 3 : 1,
                  borderLeftColor: n.status === 'pending' ? theme.warning : theme.border,
                }}
              >
                {/* Status + submitter */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: theme.space[4] }}>
                  <div style={{ flex: 1 }}>
                    <StatusBadge status={n.status} />
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: theme.space[2],
                      marginTop: theme.space[2],
                      fontSize: theme.type.caption.size,
                      color: theme.textLight,
                    }}>
                      <User size={12} />
                      <span>
                        Submitted by <strong style={{ color: theme.textDark }}>{n.profiles?.full_name || n.profiles?.display_name || 'User'}</strong>
                      </span>
                      <span>·</span>
                      <Clock size={12} />
                      <span>{timeAgo(n.created_at)}</span>
                    </div>
                  </div>
                </div>

                {/* Contact submitter */}
                {(n.contact_phone || n.contact_email || phone) && (
                  <div style={{
                    background: theme.tealMist,
                    borderRadius: theme.radius.md,
                    padding: theme.space[4],
                    marginBottom: theme.space[4],
                  }}>
                    <div style={{
                      fontSize: theme.type.caption.size,
                      fontWeight: 800,
                      color: theme.tealDeep,
                      textTransform: 'uppercase',
                      marginBottom: theme.space[3],
                      letterSpacing: '0.05em',
                    }}>
                      Contact Submitter
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[2] }}>
                      {(n.contact_phone || phone) && (
                        <div style={{ display: 'flex', gap: theme.space[3], alignItems: 'center' }}>
                          <Phone size={14} color={theme.textMid} />
                          <span style={{ flex: 1, fontSize: theme.type.body.size, color: theme.textDark, fontWeight: 600 }}>
                            {n.contact_phone || phone}
                          </span>
                          <Button
                            variant="primary"
                            size="sm"
                            leftIcon={<Phone size={12} />}
                            onClick={() => window.location.href = `tel:${n.contact_phone || phone}`}
                          >
                            Call
                          </Button>
                        </div>
                      )}
                      {n.contact_email && (
                        <div style={{ display: 'flex', gap: theme.space[3], alignItems: 'center' }}>
                          <Mail size={14} color={theme.textMid} />
                          <span style={{ flex: 1, fontSize: theme.type.body.size, color: theme.textDark, fontWeight: 600 }}>
                            {n.contact_email}
                          </span>
                          <Button
                            variant="primary"
                            size="sm"
                            leftIcon={<Mail size={12} />}
                            onClick={() => window.location.href = `mailto:${n.contact_email}`}
                          >
                            Email
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Hero image */}
                {n.hero_image_url && (
                  <div style={{
                    width: '100%',
                    height: 140,
                    borderRadius: theme.radius.md,
                    background: `url(${n.hero_image_url})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    marginBottom: theme.space[4],
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <Image size={24} color="rgba(255,255,255,0.5)" />
                  </div>
                )}

                {/* Editable fields */}
                {isEditing ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[3], marginBottom: theme.space[4] }}>
                    <Input
                      label="Headline"
                      value={editingNews.headline}
                      onChange={(val) => setEditingNews({ ...editingNews, headline: val })}
                      placeholder="Headline"
                      required
                    />
                    <Input
                      label="Subtitle"
                      value={editingNews.subtitle || ''}
                      onChange={(val) => setEditingNews({ ...editingNews, subtitle: val })}
                      placeholder="Subtitle"
                    />
                    <Textarea
                      label="Body"
                      value={editingNews.body || ''}
                      onChange={(val) => setEditingNews({ ...editingNews, body: val })}
                      rows={6}
                      placeholder="Write the article body..."
                    />
                    <div style={{ fontSize: theme.type.caption.size, color: theme.textLight, fontStyle: 'italic' }}>
                      Note: Body is stored as rich blocks; heavy formatting is best done in-app. Light text edits here are fine.
                    </div>
                  </div>
                ) : (
                  <div style={{ marginBottom: theme.space[4] }}>
                    <div style={{ fontWeight: 800, fontSize: theme.type.h2.size, color: theme.textDark, marginBottom: theme.space[2] }}>
                      {n.headline}
                    </div>
                    {n.subtitle && (
                      <div style={{ fontSize: theme.type.body.size, color: theme.textMid, fontStyle: 'italic', marginBottom: theme.space[2] }}>
                        {n.subtitle}
                      </div>
                    )}
                    <div style={{ fontSize: theme.type.bodySm.size, color: theme.textLight }}>
                      {(n.body || '').replace(/[{}\[\]"]/g, ' ').slice(0, 180)}…
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: theme.space[3], flexWrap: 'wrap' }}>
                  {!isEditing && n.status === 'pending' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<Edit size={14} />}
                      onClick={() => setEditingNews({ id: n.id, headline: n.headline, subtitle: n.subtitle, body: n.body })}
                    >
                      Edit
                    </Button>
                  )}
                  {isEditing && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingNews(null)}
                    >
                      Cancel Edit
                    </Button>
                  )}
                  {n.status !== 'approved' && (
                    <Button
                      variant="primary"
                      size="sm"
                      leftIcon={isEditing ? <Send size={14} /> : <Check size={14} />}
                      onClick={() => approveNews(n)}
                      disabled={savingNews}
                      loading={savingNews}
                    >
                      {isEditing ? 'Save & Publish' : 'Approve & Publish'}
                    </Button>
                  )}
                  {n.status === 'pending' && (
                    <Button
                      variant="danger"
                      size="sm"
                      leftIcon={<X size={14} />}
                      onClick={() => rejectNews(n.id)}
                    >
                      Reject
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    size="sm"
                    leftIcon={<Trash2 size={14} />}
                    onClick={() => deleteNews(n.id)}
                  >
                    Delete
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
