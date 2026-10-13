import { useState } from 'react'
import { Search, Pill, Star, Download } from 'lucide-react'
import { Button, Empty, Input } from '@care-ecosystem/design-system/components/ui'
import { useDrugReviews } from '../hooks/useDrugReviews'
import { FilterPills, DateRange, timeAgo, exportCSV } from '../ui'
import MetricStrip from '../ui/MetricStrip.jsx'
import '../ui/admin.css'

// Drug intelligence: search a medication, read its reviews, see the sentiment
// of whatever the filters leave. Every state names what it searched; a failed
// search is never shown as "no match" or "no reviews".

const RATING_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: '1', label: '1 Star' },
  { value: '2', label: '2 Stars' },
  { value: '3', label: '3 Stars' },
  { value: '4', label: '4 Stars' },
  { value: '5', label: '5 Stars' },
]

function Stars({ rating }) {
  const filled = Number.isFinite(rating) ? Math.max(0, Math.min(5, Math.round(rating))) : 0
  return (
    <span className="adm-stars" role="img" aria-label={`${filled} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} size={14} strokeWidth={2} className={`adm-star${i < filled ? ' adm-star--on' : ''}`} />
      ))}
    </span>
  )
}

export default function DrugIntelSection() {
  const { result, searching, search } = useDrugReviews()
  const [term, setTerm] = useState('')
  const [rating, setRating] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const canSearch = !searching && term.trim() !== ''
  const submit = (e) => {
    e.preventDefault()
    if (!canSearch) return
    const next = term.trim()
    // Filters set for one search must not silently hide another's reviews.
    if (next !== result?.term) { setRating('all'); setFrom(''); setTo('') }
    search(next)
  }

  const hasFilters = rating !== 'all' || !!from || !!to
  const clearFilters = () => { setRating('all'); setFrom(''); setTo('') }

  const all = result?.status === 'ok' ? result.reviews : []
  const filtered = all.filter(r => {
    const matchRating = rating === 'all' || r.rating === parseInt(rating, 10)
    const matchFrom = !from || r.created_at >= from
    const matchTo = !to || r.created_at <= `${to}T23:59:59`
    return matchRating && matchFrom && matchTo
  })
  // A review without a numeric rating is listed but is not a rating: it is in
  // none of the sentiment counts and not in the average (`null <= 2` is true).
  const rated = filtered.filter(r => Number.isFinite(r.rating))
  const positive = rated.filter(r => r.rating >= 4).length
  const negative = rated.filter(r => r.rating <= 2).length
  const neutral = rated.length - positive - negative
  const avg = rated.length ? (rated.reduce((s, r) => s + r.rating, 0) / rated.length).toFixed(1) : '0'

  const exportReviews = () => {
    exportCSV(
      filtered.map(r => ({ id: r.id, rating: r.rating, comment: r.comment, created_at: r.created_at })),
      `${result.matches > 1 ? result.term : result.product.name}_filtered_reviews.csv`,
    )
  }

  let body
  if (!result) {
    body = searching ? null : (
      <Empty icon={<Search size={40} strokeWidth={1.5} />}
        message="Search for a medication to view user reviews and sentiment analysis" cause="none" />
    )
  } else if (result.status === 'error') {
    body = (
      <div role="alert" className="adm-notice">
        Couldn't search for "{result.term}".{' '}
        <button type="button" className="adm-btn-reset adm-retry" onClick={() => search(result.term)}>Retry</button>
      </div>
    )
  } else if (!result.product) {
    body = (
      <Empty icon={<Pill size={40} strokeWidth={1.5} />} title="No medication matches"
        description={`Nothing found for "${result.term}"`} cause="none" />
    )
  } else {
    const { product, matches } = result
    const sentiment = [
      { key: 'positive', label: 'Positive', value: positive, hint: 'Reviews (4-5 stars)' },
      { key: 'neutral', label: 'Neutral', value: neutral, hint: 'Reviews (3 stars)' },
      { key: 'negative', label: 'Negative', value: negative, hint: 'Reviews (1-2 stars)' },
    ]
    body = (
      <>
        <section className="adm-panel" aria-labelledby="drug-summary-h">
          <div className="adm-drug-summary">
            <div>
              <h2 id="drug-summary-h">
                {matches > 1 ? `Reviews for ${matches} products matching “${result.term}”` : `Reviews for ${product.name}`}
              </h2>
              {matches > 1 && <p className="adm-note">Reviews from all {matches} matching products are combined.</p>}
              {filtered.length > 0 && (
                <p className="adm-note">
                  {filtered.length} reviews · Avg: <Star size={12} aria-hidden="true" className="adm-star-inline" /> {avg}
                </p>
              )}
            </div>
            <Button variant="outline" size="sm" leftIcon={<Download size={14} aria-hidden="true" />}
              disabled={filtered.length === 0} onClick={exportReviews}>
              Export CSV
            </Button>
          </div>
          {all.length > 0 && (
            <div className="adm-drug-filters">
              <FilterPills options={RATING_OPTIONS} value={rating} onChange={setRating} label="Filter by rating" />
              <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
            </div>
          )}
        </section>

        {all.length > 0 && <MetricStrip items={sentiment} label="Review sentiment" />}

        {all.length === 0 ? (
          <Empty icon={<Pill size={40} strokeWidth={1.5} />} message="No reviews yet" cause="none" />
        ) : filtered.length === 0 ? (
          <Empty icon={<Pill size={40} strokeWidth={1.5} />} title="No reviews match these filters"
            action={hasFilters ? 'Clear filters' : undefined} onAction={clearFilters} cause="filtered" />
        ) : (
          <section className="adm-panel" aria-labelledby="drug-reviews-h">
            <div className="adm-phead"><h2 id="drug-reviews-h">Reviews</h2></div>
            <ul className="adm-queue" aria-labelledby="drug-reviews-h">
              {filtered.map(r => (
                <li key={r.id} className="adm-review">
                  <div className="adm-review-top">
                    <Stars rating={r.rating} />
                    <span className="adm-note">{timeAgo(r.created_at)}</span>
                  </div>
                  {r.comment && <p>{r.comment}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    )
  }

  return (
    <div className="adm-page">
      <header className="adm-head">
        <div>
          <h1>Drug Intelligence</h1>
          <p className="adm-note">Search medications and analyze user reviews</p>
        </div>
      </header>

      <form className="adm-panel adm-drug-form" onSubmit={submit} role="search" aria-label="Search medications">
        <div className="adm-drug-field">
          <Input label="Medication name" value={term} onChange={setTerm} placeholder="Search medication name..." />
        </div>
        <Button type="submit" variant="primary" size="sm" disabled={!canSearch} loading={searching} loadingText="Searching…"
          leftIcon={<Search size={14} aria-hidden="true" />}>
          Search
        </Button>
      </form>

      {searching && <p role="status" className="adm-clear">Searching…</p>}
      <div className={searching ? 'adm-drug-busy' : undefined} aria-busy={searching}>{body}</div>
    </div>
  )
}
