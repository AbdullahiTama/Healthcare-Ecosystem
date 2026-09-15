import { useState } from 'react'
import { theme } from '../../../styles/theme'
import { Card, Button, Empty, StatCard, Input } from '@care-ecosystem/design-system/components/ui'
import { AdminPageHeader, AdminSection, AdminFilterBar, FilterPills, DateRange } from '../ui'
import { Search, Pill, Star, TrendingUp, AlertTriangle, ThumbsUp, Minus, ThumbsDown, Download, Filter } from 'lucide-react'

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
  const csv = [keys.join(','), ...data.map(row => keys.map(k => `"${(row[k] || '').toString().replace(/"/g, '""')}"`).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click()
}

export default function DrugsTab({
  drugSearch,
  setDrugSearch,
  drugReviews,
  drugName,
  setDrugName,
  drugRatingFilter,
  setDrugRatingFilter,
  drugDateFrom,
  setDrugDateFrom,
  drugDateTo,
  setDrugDateTo,
  searchDrugs,
}) {
  const ratingOptions = [
    { value: 'all', label: 'All' },
    { value: '1', label: '1 Star' },
    { value: '2', label: '2 Stars' },
    { value: '3', label: '3 Stars' },
    { value: '4', label: '4 Stars' },
    { value: '5', label: '5 Stars' },
  ]

  const filtered = drugReviews.filter(r => {
    const matchRating = drugRatingFilter === 'all' || r.rating === parseInt(drugRatingFilter)
    const matchFrom = !drugDateFrom || r.created_at >= drugDateFrom
    const matchTo = !drugDateTo || r.created_at <= drugDateTo + 'T23:59:59'
    return matchRating && matchFrom && matchTo
  })

  const avgRating = filtered.length ? (filtered.reduce((s, r) => s + r.rating, 0) / filtered.length).toFixed(1) : 0
  const positive = filtered.filter(r => r.rating >= 4).length
  const negative = filtered.filter(r => r.rating <= 2).length
  const neutral = filtered.length - positive - negative

  const hasActiveFilters = drugRatingFilter !== 'all' || drugDateFrom || drugDateTo

  return (
    <div>
      <AdminPageHeader
        title="Drug Intelligence"
        subtitle="Search medications and analyze user reviews"
      />

      <AdminFilterBar
        search={drugSearch}
        onSearch={setDrugSearch}
        searchPlaceholder="Search medication name..."
      >
        <div style={{ display: 'flex', gap: theme.space[3], alignItems: 'center' }}>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Search size={14} />}
            onClick={searchDrugs}
          >
            Search
          </Button>
        </div>
      </AdminFilterBar>

      <AdminFilterBar>
        <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[4] }}>
          <FilterPills
            options={ratingOptions}
            value={drugRatingFilter}
            onChange={setDrugRatingFilter}
          />
          <DateRange
            from={drugDateFrom}
            to={drugDateTo}
            onFrom={setDrugDateFrom}
            onTo={setDrugDateTo}
          />
        </div>
      </AdminFilterBar>

      {filtered.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.space[5] }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: theme.type.h2.size, color: theme.textDark }}>{drugName}</div>
              <div style={{ fontSize: theme.type.bodySm.size, color: theme.textLight }}>
                {filtered.length} reviews · Avg: <Star size={12} style={{ display: 'inline', verticalAlign: 'middle', color: '#f59e0b' }} /> {avgRating}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Download size={14} />}
              onClick={() => exportCSV(filtered, `${drugName}_filtered_reviews.csv`)}
            >
              Export CSV
            </Button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: theme.space[4], marginBottom: theme.space[6] }}>
            <StatCard
              icon={<ThumbsUp size={20} />}
              label="Positive"
              value={positive}
              sub="Reviews (4-5 stars)"
              tone="green"
            />
            <StatCard
              icon={<Minus size={20} />}
              label="Neutral"
              value={neutral}
              sub="Reviews (3 stars)"
              tone="teal"
            />
            <StatCard
              icon={<ThumbsDown size={20} />}
              label="Negative"
              value={negative}
              sub="Reviews (1-2 stars)"
              tone="danger"
            />
          </div>

          <AdminSection title="Reviews" subtitle={`${filtered.length} reviews`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space[3] }}>
              {filtered.map(r => (
                <Card key={r.id} style={{ padding: theme.space[5] }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: theme.space[2] }}>
                    <div style={{ display: 'flex', gap: 2 }}>
                      {Array.from({ length: 5 }, (_, i) => (
                        <Star
                          key={i}
                          size={14}
                          fill={i < r.rating ? '#f59e0b' : 'none'}
                          color={i < r.rating ? '#f59e0b' : theme.gray300}
                          strokeWidth={2}
                        />
                      ))}
                    </div>
                    <span style={{ fontSize: theme.type.caption.size, color: theme.textLight }}>
                      {timeAgo(r.created_at)}
                    </span>
                  </div>
                  {r.comment && (
                    <p style={{ margin: 0, fontSize: theme.type.body.size, color: theme.textMid }}>
                      {r.comment}
                    </p>
                  )}
                </Card>
              ))}
            </div>
          </AdminSection>
        </>
      )}

      {drugReviews.length === 0 && drugSearch && (
        <Empty
          icon={<Pill size={40} strokeWidth={1.5} />}
          message="No reviews found for this medication"
          cause="none"
        />
      )}

      {!drugSearch && (
        <Empty
          icon={<Search size={40} strokeWidth={1.5} />}
          message="Search for a medication to view user reviews and sentiment analysis"
          cause="none"
        />
      )}
    </div>
  )
}
