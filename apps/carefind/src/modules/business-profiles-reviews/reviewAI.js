// AI-powered review analysis using Claude API
// Reads actual comment text and extracts structured medical intelligence

export async function analyzeReviews(reviews) {
  if (!reviews || reviews.length === 0) return null

  const reviewTexts = reviews
    .filter((r) => r.comment && r.comment.trim().length > 5)
    .map((r, i) => `Review ${i + 1} (${r.rating} stars): "${r.comment}"`)
    .join('\n')

  if (!reviewTexts) return null

  const prompt = `You are a pharmaceutical intelligence analyst. Read these user reviews for a medication and extract structured insights.

${reviewTexts}

Respond ONLY with a JSON object in this exact format, no markdown, no explanation:
{
  "sideEffects": ["list of specific side effects mentioned, e.g. cough, dizziness, headache"],
  "efficacyReports": {
    "positive": ["specific efficacy claims, e.g. fever reduced in 2 hours, pain relief"],
    "negative": ["specific failure reports, e.g. no effect after 3 days, symptoms worsened"]
  },
  "positiveThemes": ["non-efficacy positive themes, e.g. affordable, fast delivery, genuine product"],
  "negativeThemes": ["non-efficacy negative themes, e.g. expensive, fake, expired, rude staff"],
  "sentiment": {
    "positive": number,
    "neutral": number,
    "negative": number
  },
  "summary": "One sentence summarizing overall user experience with this medication"
}`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const data = await response.json()
    const text = (data.content || []).map((c) => c.text || '').join('')
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch (err) {
    console.error('Review AI error:', err)
    return null
  }
}
