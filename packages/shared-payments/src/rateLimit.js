// A small in-memory sliding-window limiter. It is per serverless instance, so it is BEST EFFORT: it stops one signed-in
// session from hammering a paid provider lookup (bank account resolution), not a distributed attacker.
export function createRateLimiter({ windowMs = 60_000, max = 10, now = () => Date.now() } = {}) {
  const hits = new Map()
  return function allow(key) {
    const t = now()
    const recent = (hits.get(key) || []).filter((ts) => t - ts < windowMs)
    if (recent.length >= max) { hits.set(key, recent); return false }
    recent.push(t)
    hits.set(key, recent)
    // Bound memory: drop idle keys when the map grows.
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((ts) => t - ts < windowMs)) hits.delete(k)
    return true
  }
}
