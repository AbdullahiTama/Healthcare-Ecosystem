import { useState } from 'react'
import { theme } from '../../../styles/theme'
import { Card, Button, Empty, Input, Textarea } from '@care-ecosystem/design-system/components/ui'
import { AdminPageHeader, AdminSection } from '../ui'
import { BookOpen, Plus, Trash2, Clock, Image as ImageIcon, Palette, Loader2 } from 'lucide-react'

function timeAgo(d) {
  if (!d) return 'Never'
  const diff = Math.floor((Date.now() - new Date(d)) / 1000)
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const COLOR_PRESETS = [
  { value: '#0E6F5A', label: 'Teal' },
  { value: '#0B4A3E', label: 'Dark Teal' },
  { value: '#7c3aed', label: 'Purple' },
  { value: '#be123c', label: 'Rose' },
  { value: '#c2410c', label: 'Orange' },
  { value: '#0369a1', label: 'Blue' },
]

export default function StoriesTab({
  stories,
  storyTitle, setStoryTitle,
  storyBody, setStoryBody,
  storyBg, setStoryBg,
  storyImageFile, setStoryImageFile,
  savingStory,
  createStory,
  deleteStory,
}) {
  const [imagePreview, setImagePreview] = useState(null)

  function handleImageSelect(e) {
    const file = e.target.files[0] || null
    setStoryImageFile(file)
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => setImagePreview(reader.result)
      reader.readAsDataURL(file)
    } else {
      setImagePreview(null)
    }
  }

  return (
    <div>
      <AdminPageHeader
        title="Stories"
        subtitle="Manage stories that appear at the top of the feed"
      />

      <AdminSection title="Post a Story" subtitle="Stories auto-expire after 24 hours">
        <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[4] }}>
          <Input
            label="Story Title"
            value={storyTitle}
            onChange={setStoryTitle}
            placeholder="e.g. New Feature!"
          />
          <Textarea
            label="Story Message"
            value={storyBody}
            onChange={setStoryBody}
            rows={3}
            placeholder="Write your story message..."
          />

          <div>
            <label style={{
              display: 'block',
              fontSize: theme.type.caption.size,
              fontWeight: 700,
              color: theme.gray600,
              marginBottom: theme.space[3],
            }}>
              Background Color
            </label>
            <div style={{ display: 'flex', gap: theme.space[3], flexWrap: 'wrap' }}>
              {COLOR_PRESETS.map(c => (
                <button
                  key={c.value}
                  onClick={() => setStoryBg(c.value)}
                  title={c.label}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: c.value,
                    cursor: 'pointer',
                    border: storyBg === c.value ? `3px solid ${theme.textDark}` : `2px solid ${theme.border}`,
                    boxShadow: storyBg === c.value ? theme.elevation[2] : theme.elevation[1],
                    transition: `all ${theme.motion.fast}`,
                  }}
                />
              ))}
            </div>
          </div>

          <div>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: theme.space[2],
              fontSize: theme.type.body.size,
              color: theme.tealDeep,
              fontWeight: 700,
              cursor: 'pointer',
            }}>
              <ImageIcon size={16} />
              {storyImageFile ? storyImageFile.name : 'Add an image (optional)'}
              <input
                type="file"
                accept="image/*"
                onChange={handleImageSelect}
                style={{ display: 'none' }}
              />
            </label>
          </div>

          <div style={{
            borderRadius: theme.radius.lg,
            padding: theme.space[6],
            minHeight: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: storyImageFile
              ? `url(${imagePreview || ''}) center/cover no-repeat, ${theme.gray200}`
              : storyBg,
            textAlign: 'center',
          }}>
            {storyImageFile ? (
              <div style={{
                background: 'rgba(0,0,0,0.5)',
                padding: `${theme.space[3]}px ${theme.space[5]}px`,
                borderRadius: theme.radius.md,
              }}>
                <p style={{ margin: 0, fontSize: theme.type.bodySm.size, color: '#fff' }}>
                  Image selected — text shows over it
                </p>
              </div>
            ) : (
              <div>
                {storyTitle && (
                  <p style={{ margin: '0 0 6px 0', color: '#fff', fontWeight: 900, fontSize: 16 }}>
                    {storyTitle}
                  </p>
                )}
                {storyBody && (
                  <p style={{ margin: 0, color: 'rgba(255,255,255,0.9)', fontSize: theme.type.body.size }}>
                    {storyBody}
                  </p>
                )}
                {!storyTitle && !storyBody && (
                  <p style={{ margin: 0, color: 'rgba(255,255,255,0.6)', fontSize: theme.type.bodySm.size }}>
                    Preview
                  </p>
                )}
              </div>
            )}
          </div>

          <Button
            variant="primary"
            size="md"
            fullWidth
            leftIcon={savingStory ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            loading={savingStory}
            loadingText="Posting..."
            onClick={createStory}
            disabled={savingStory}
          >
            Post Story
          </Button>
        </div>
      </AdminSection>

      <AdminSection title="Active Stories" subtitle={`${stories.length} stories`} style={{ marginTop: theme.space[4] }}>
        {stories.length === 0 ? (
          <Empty
            icon={<BookOpen size={40} strokeWidth={1.5} />}
            message="No stories posted yet"
            cause="none"
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[3] }}>
            {stories.map(s => {
              const expired = new Date(s.expires_at) < new Date()
              return (
                <Card
                  key={s.id}
                  style={{
                    padding: theme.space[5],
                    opacity: expired ? 0.5 : 1,
                  }}
                >
                  <div style={{ display: 'flex', gap: theme.space[4], alignItems: 'center' }}>
                    <div style={{
                      width: 50,
                      height: 50,
                      borderRadius: theme.radius.md,
                      flexShrink: 0,
                      background: s.image_url
                        ? `url(${s.image_url}) center/cover no-repeat`
                        : (s.bg_color || theme.tealDeep),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                      fontWeight: 900,
                      fontSize: theme.type.body.size,
                    }}>
                      {!s.image_url && (s.title?.[0]?.toUpperCase() || '★')}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: '0 0 2px 0', fontWeight: 800, fontSize: theme.type.body.size, color: theme.textDark }}>
                        {s.title || '(no title)'}
                      </p>
                      {s.body && (
                        <p style={{ margin: '0 0 4px 0', fontSize: theme.type.bodySm.size, color: theme.textMid, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {s.body.slice(0, 60)}
                        </p>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[2] }}>
                        <Clock size={12} color={expired ? theme.danger : theme.textLight} />
                        <p style={{ margin: 0, fontSize: theme.type.caption.size, color: expired ? theme.danger : theme.textLight }}>
                          {expired ? 'Expired' : `Expires ${timeAgo(s.expires_at).replace(' ago', '')} from now`}
                          {' · '}
                          {timeAgo(s.created_at)}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="danger"
                      size="sm"
                      leftIcon={<Trash2 size={14} />}
                      onClick={() => deleteStory(s.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </AdminSection>
    </div>
  )
}
