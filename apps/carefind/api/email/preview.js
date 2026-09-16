import { TEMPLATE_REGISTRY } from '@care-ecosystem/shared-email'
import { SAMPLES, TEMPLATE_META } from '@care-ecosystem/shared-email/src/templates/samples.js'

export default async function handler(req, res) {
  if (req.method === 'GET' && !req.query?.key) {
    return res.status(200).json({ templates: TEMPLATE_META, available: Object.keys(TEMPLATE_REGISTRY) })
  }

  const key = (req.query?.key || req.body?.key || '').trim()
  if (!key) return res.status(400).json({ error: 'Missing ?key=<templateKey>' })

  const fn = TEMPLATE_REGISTRY[key]
  if (!fn) return res.status(404).json({ error: `Unknown template: ${key}`, available: Object.keys(TEMPLATE_REGISTRY) })

  const payload = { ...(SAMPLES[key] || {}), ...(req.body?.payload || {}) }
  try {
    const html = fn(payload)
    if (req.query?.raw === '1' || req.headers.accept?.includes('text/html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      return res.status(200).send(html)
    }
    return res.status(200).json({ key, html, payload })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
