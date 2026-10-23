// How long to wait before trying a queued report again: 2 s, 4 s, 8 s ... capped at 5 minutes.
export const BACKOFF_BASE_MS = 2000
export const BACKOFF_MAX_MS = 300000

export function backoffMs(attempts) {
  const n = Number.isFinite(attempts) && attempts > 0 ? Math.floor(attempts) : 0
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, Math.min(n, 30)))
}
