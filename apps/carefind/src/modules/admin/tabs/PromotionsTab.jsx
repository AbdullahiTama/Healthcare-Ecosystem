import { useState } from 'react'
import { theme } from '../../../styles/theme'
import { Card, Button, Empty, Input, Select, Textarea } from '@care-ecosystem/design-system/components/ui'
import { AdminPageHeader, AdminSection } from '../ui'
import { Megaphone, Plus, Trash2, Clock, ExternalLink, Image as ImageIcon, Loader2 } from 'lucide-react'

function timeAgo(d) {
  if (!d) return 'Never'
  const diff = Math.floor((Date.now() - new Date(d)) / 1000)
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const DURATION_OPTIONS = [
  { value: '3', label: '3 days' },
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
]

export default function PromotionsTab({
  promotions,
  promoTitle, setPromoTitle,
  promoLink, setPromoLink,
  promoDays, setPromoDays,
  promoImage, setPromoImage,
  savingPromo,
  createPromotion,
  deletePromotion,
}) {
  const [imagePreview, setImagePreview] = useState(null)

  function handleImageSelect(e) {
    const file = e.target.files[0] || null
    setPromoImage(file)
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
        title="Promotions"
        subtitle="Manage featured promotions in the MedMarket strip"
      />

      <AdminSection title="Add a Promotion" subtitle="Promotions appear in the moving featured strip and auto-expire">
        <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[4] }}>
          <Input
            label="Promotion Title"
            value={promoTitle}
            onChange={setPromoTitle}
            placeholder="e.g. 50% off Vitamin C"
          />
          <Input
            label="Link URL"
            value={promoLink}
            onChange={setPromoLink}
            placeholder="e.g. /business/xyz or product page"
            helperText="Where users go when they tap the promotion"
          />
          <Select
            label="Duration"
            value={promoDays}
            onChange={setPromoDays}
            options={DURATION_OPTIONS}
          />

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
              {promoImage ? promoImage.name : 'Upload promotion image'}
              <input
                type="file"
                accept="image/*"
                onChange={handleImageSelect}
                style={{ display: 'none' }}
              />
            </label>
          </div>

          {imagePreview && (
            <div style={{
              borderRadius: theme.radius.md,
              overflow: 'hidden',
              border: `1px solid ${theme.border}`,
            }}>
              <img
                src={imagePreview}
                alt="Promotion preview"
                style={{ width: '100%', maxHeight: 160, objectFit: 'cover', display: 'block' }}
              />
            </div>
          )}

          <Button
            variant="primary"
            size="md"
            fullWidth
            leftIcon={savingPromo ? <Loader2 size={16} className="animate-spin" /> : <Megaphone size={16} />}
            loading={savingPromo}
            loadingText="Posting..."
            onClick={createPromotion}
            disabled={savingPromo}
          >
            Add Promotion
          </Button>
        </div>
      </AdminSection>

      <AdminSection title="Active Promotions" subtitle={`${promotions.length} promotions`} style={{ marginTop: theme.space[4] }}>
        {promotions.length === 0 ? (
          <Empty
            icon={<Megaphone size={40} strokeWidth={1.5} />}
            message="No promotions yet"
            cause="none"
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[3] }}>
            {promotions.map(p => {
              const expired = p.expires_at && new Date(p.expires_at) < new Date()
              return (
                <Card
                  key={p.id}
                  style={{
                    padding: theme.space[5],
                    opacity: expired ? 0.5 : 1,
                  }}
                >
                  <div style={{ display: 'flex', gap: theme.space[4], alignItems: 'center' }}>
                    <div style={{
                      width: 64,
                      height: 64,
                      borderRadius: theme.radius.md,
                      flexShrink: 0,
                      background: p.image_url
                        ? `url(${p.image_url}) center/cover no-repeat`
                        : theme.tealGradient,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                      fontWeight: 800,
                      fontSize: theme.type.caption.size,
                    }}>
                      {!p.image_url && 'No image'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: '0 0 2px 0', fontWeight: 800, fontSize: theme.type.body.size, color: theme.textDark }}>
                        {p.title}
                      </p>
                      {p.link_url && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[2], marginBottom: theme.space[1] }}>
                          <ExternalLink size={12} color={theme.tealDeep} />
                          <span style={{ fontSize: theme.type.caption.size, color: theme.tealDeep, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.link_url}
                          </span>
                        </div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: theme.space[2] }}>
                        <Clock size={12} color={expired ? theme.danger : theme.textLight} />
                        <p style={{ margin: 0, fontSize: theme.type.caption.size, color: expired ? theme.danger : theme.textLight }}>
                          {expired
                            ? 'Expired'
                            : p.expires_at
                              ? `Expires ${new Date(p.expires_at).toLocaleDateString()}`
                              : 'No expiry'
                          }
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="danger"
                      size="sm"
                      leftIcon={<Trash2 size={14} />}
                      onClick={() => deletePromotion(p.id)}
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
