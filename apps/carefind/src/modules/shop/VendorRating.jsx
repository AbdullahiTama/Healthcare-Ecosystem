import { useState } from 'react'
import { Star, Send, CheckCircle } from 'lucide-react'
import { theme } from '../../styles/theme'
import { vendorRatingRepository } from './vendorRatingRepository'

const RATING_CATEGORIES = [
  { key: 'fulfillmentSpeed', label: 'Fulfillment Speed', emoji: '⚡' },
  { key: 'packagingQuality', label: 'Packaging Quality', emoji: '📦' },
  { key: 'accuracy', label: 'Order Accuracy', emoji: '✓' },
  { key: 'overall', label: 'Overall Experience', emoji: '⭐' },
]

export default function VendorRating({ order, user, onRated }) {
  const [ratings, setRatings] = useState({
    fulfillmentSpeed: 0,
    packagingQuality: 0,
    accuracy: 0,
    overall: 0,
  })
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  function handleRate(category, value) {
    setRatings(prev => ({ ...prev, [category]: value }))
  }

  async function handleSubmit() {
    if (!user) return
    if (Object.values(ratings).some(r => r === 0)) {
      setError('Please rate all categories')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      await vendorRatingRepository.create(
        order.id,
        order.vendor_business_id,
        user.id,
        ratings,
        comment || null
      )
      setSubmitted(true)
      onRated?.()
    } catch (err) {
      setError(err.message || 'Failed to submit rating')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div style={{
        padding: 24,
        borderRadius: theme.radius.lg,
        background: theme.successBg,
        border: `1px solid ${theme.success}30`,
        textAlign: 'center',
      }}>
        <CheckCircle size={32} color={theme.success} style={{ margin: '0 auto 12px' }} />
        <h3 style={{ fontSize: 16, fontWeight: 700, color: theme.success, margin: '0 0 8px' }}>
          Thank you for your feedback!
        </h3>
        <p style={{ fontSize: 13, color: theme.textMid, margin: 0 }}>
          Your rating helps other customers and improves our service.
        </p>
      </div>
    )
  }

  return (
    <div style={{
      padding: 24,
      borderRadius: theme.radius.lg,
      background: theme.cardBg,
      border: `1px solid ${theme.border}`,
    }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, color: theme.navy, margin: '0 0 16px' }}>
        Rate Your Experience
      </h3>
      <p style={{ fontSize: 13, color: theme.textMid, margin: '0 0 20px' }}>
        How was your experience with this vendor?
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 20 }}>
        {RATING_CATEGORIES.map(category => (
          <div key={category.key}>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 8, 
              marginBottom: 8 
            }}>
              <span style={{ fontSize: 16 }}>{category.emoji}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: theme.navy }}>
                {category.label}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {[1, 2, 3, 4, 5].map(star => (
                <button
                  key={star}
                  onClick={() => handleRate(category.key, star)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 4,
                    transition: 'transform 0.1s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.2)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                >
                  <Star
                    size={24}
                    fill={star <= ratings[category.key] ? '#FBBF24' : 'none'}
                    color={star <= ratings[category.key] ? '#FBBF24' : theme.gray300}
                  />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ 
          display: 'block', 
          fontSize: 13, 
          fontWeight: 600, 
          color: theme.navy, 
          marginBottom: 8 
        }}>
          Comments (optional)
        </label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Share your experience..."
          rows={3}
          style={{
            width: '100%',
            padding: 12,
            borderRadius: theme.radius.md,
            border: `1px solid ${theme.border}`,
            fontSize: 13,
            fontFamily: 'inherit',
            resize: 'vertical',
            background: theme.bg,
            color: theme.textDark,
          }}
        />
      </div>

      {error && (
        <div style={{
          padding: 10,
          borderRadius: theme.radius.md,
          background: theme.dangerBg,
          color: theme.danger,
          fontSize: 12,
          marginBottom: 12,
        }}>
          {error}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={submitting || Object.values(ratings).some(r => r === 0)}
        style={{
          width: '100%',
          padding: '12px 20px',
          borderRadius: theme.radius.md,
          background: theme.tealDeep,
          color: '#fff',
          fontSize: 14,
          fontWeight: 700,
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          opacity: submitting || Object.values(ratings).some(r => r === 0) ? 0.6 : 1,
        }}
      >
        {submitting ? (
          'Submitting...'
        ) : (
          <>
            <Send size={16} />
            Submit Rating
          </>
        )}
      </button>
    </div>
  )
}
