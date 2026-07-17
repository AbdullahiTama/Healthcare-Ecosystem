// Sentiment classification for reviews
// Combines star rating with keyword analysis for a more accurate signal

const positiveWords = [
  'good', 'great', 'excellent', 'amazing', 'wonderful', 'effective', 'works', 'helpful',
  'recommend', 'best', 'perfect', 'fast', 'quick', 'relief', 'better', 'improved',
  'love', 'nice', 'satisfied', 'happy', 'affordable', 'cheap', 'value', 'genuine',
  'original', 'legit', 'trusted', 'clean', 'professional', 'kind', 'friendly',
]

const negativeWords = [
  'bad', 'terrible', 'awful', 'horrible', 'poor', 'worst', 'fake', 'expired',
  'ineffective', 'useless', 'waste', 'expensive', 'overpriced', 'slow', 'rude',
  'dirty', 'avoid', 'scam', 'wrong', 'side effect', 'reaction', 'pain', 'worse',
  'disappointed', 'unhappy', 'regret', 'failed', 'no effect', 'didn\'t work',
]

export function classifySentiment(rating, comment = '') {
  const lower = (comment || '').toLowerCase()
  let score = 0

  // Base from rating
  if (rating >= 4) score += 2
  else if (rating === 3) score += 0
  else score -= 2

  // Adjust from keywords
  positiveWords.forEach((w) => { if (lower.includes(w)) score += 1 })
  negativeWords.forEach((w) => { if (lower.includes(w)) score -= 1 })

  if (score >= 2) return 'positive'
  if (score <= -1) return 'negative'
  return 'neutral'
}

export function extractCommonThemes(reviews) {
  // Count keyword frequency across all review comments
  const allWords = reviews
    .map((r) => (r.comment || '').toLowerCase())
    .join(' ')
    .split(/\s+/)
    .filter((w) => w.length > 4)

  const stopWords = new Set([
    'this', 'that', 'with', 'from', 'they', 'them', 'their', 'there', 'where',
    'what', 'when', 'which', 'have', 'been', 'were', 'would', 'could', 'should',
    'very', 'really', 'just', 'also', 'more', 'than', 'about', 'after', 'before',
    'product', 'medication', 'medicine', 'drug', 'pills', 'tablet',
  ])

  const freq = {}
  allWords.forEach((w) => {
    const clean = w.replace(/[^a-z]/g, '')
    if (clean.length > 4 && !stopWords.has(clean)) {
      freq[clean] = (freq[clean] || 0) + 1
    }
  })

  return Object.entries(freq)
    .filter(([, count]) => count >= 2)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([word]) => word)
}

export function getSentimentSummary(reviews) {
  const classified = reviews.map((r) => ({
    ...r,
    sentiment: classifySentiment(r.rating, r.comment),
  }))

  const positive = classified.filter((r) => r.sentiment === 'positive')
  const negative = classified.filter((r) => r.sentiment === 'negative')
  const neutral = classified.filter((r) => r.sentiment === 'neutral')
  const themes = extractCommonThemes(reviews)

  return { positive, negative, neutral, themes, classified }
}
