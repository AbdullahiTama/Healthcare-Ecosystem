// Commercial constants live in the financial_config table (one source of truth for JS and SQL).
// Read-through cache: a value changes rarely and a stale minute is harmless for pricing a checkout.
const TTL_MS = 60_000
const cache = new Map()

export async function getFinancialConfig(supabase, key, now = Date.now()) {
  const hit = cache.get(key)
  if (hit && now - hit.at < TTL_MS) return hit.value
  const { data, error } = await supabase.from('financial_config').select('value').eq('key', key).maybeSingle()
  if (error || data?.value == null) throw new Error(`financial_config key "${key}" is not available`)
  const value = Number(data.value)
  if (!Number.isFinite(value)) throw new Error(`financial_config key "${key}" is not numeric`)
  cache.set(key, { value, at: now })
  return value
}

export function clearFinancialConfigCache() { cache.clear() }
