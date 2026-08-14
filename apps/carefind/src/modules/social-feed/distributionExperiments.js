// Staged content distribution (Phase 7): experiment resolution + metrics.
//
// Pure, I/O-free (except the thin `logExperimentEvent` wrapper) so the whole
// module unit-tests without mocks. Feed.jsx fetches
// content_distribution_experiments (public read) and resolves the reader's
// bucket via resolveExperiment; the For You ranking then applies the
// treatment's config overrides via applyExperimentConfig, and engagement
// writes are tagged with the reader's variant through logExperimentEvent.
//
// BUCKETING
// ---------
// Assignment is deterministic — hash(experiment key + reader id) → [0,100) —
// so a reader stays in the same group across sessions with no assignment
// table to maintain. The reader id is their auth user id when signed in and
// the app-load session id otherwise (stable for one session, which is all an
// anonymous reader can be). `rollout_pct` is the treatment's share; everyone
// else is the control group and, crucially, STILL logs metrics — that is what
// makes control-vs-treatment comparison valid.

// Deterministic FNV-1a over `${key}:${id}` → an integer in [0, buckets).
// Not cryptographically strong, but it does not need to be: it only spreads
// readers across buckets reproducibly, never guards access.
export function bucketFor(id, key, buckets = 100) {
  const h = (s) => {
    let hash = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i)
      hash = (hash * 0x01000193) >>> 0
    }
    // FNV-1a's raw output has weak low-bit distribution for short inputs, and
    // % buckets reads exactly those low bits. Avalanche the state so every bit
    // influences the bucket, or readers cluster badly (measured: 65/200).
    hash ^= hash >>> 16
    hash = (hash * 0x85ebca6b) >>> 0
    hash ^= hash >>> 13
    hash = (hash * 0xc2b2ae35) >>> 0
    hash ^= hash >>> 16
    return hash >>> 0
  }
  const seed = `${key}:${id == null ? 'anonymous' : id}`
  return h(seed) % buckets
}

// Is `now` inside the experiment's [start_at, end_at] window? A missing bound
// is an open window on that side.
export function isWithinWindow(experiment, now = Date.now()) {
  if (experiment.start_at && new Date(experiment.start_at).getTime() > now) return false
  if (experiment.end_at && new Date(experiment.end_at).getTime() < now) return false
  return true
}

// Resolve the reader's group for the FIRST active experiment in the list.
// Active = enabled (kill switch on) AND rollout_pct > 0 AND inside the window.
// Returns null when nothing is staged, so the feed and metrics both stay inert.
// Returns { key, label, variant, treatment, config, rolloutPct } otherwise —
// `variant` is 'control' or the experiment's treatment variant name, and
// `treatment` is true only for the staged group.
export function resolveExperiment({ experiments = [], userId, sessionId, now = Date.now() }) {
  const readerId = userId || sessionId
  for (const exp of experiments) {
    if (!exp || !exp.enabled) continue
    if (Number(exp.rollout_pct) <= 0) continue
    if (!isWithinWindow(exp, now)) continue
    const pct = Math.min(100, Math.max(0, Number(exp.rollout_pct)))
    const treatment = pct >= 100 || bucketFor(readerId, exp.key) < pct
    return {
      key: exp.key,
      label: exp.label,
      variant: treatment ? (exp.variant || 'treatment') : 'control',
      treatment,
      config: exp.config || {},
      rolloutPct: pct,
    }
  }
  return null
}

// Merge the treatment's config over the resolved base config. Only applied
// when the reader is actually in the treatment group; control keeps the base
// exactly as-is. Each section (weights / diversity / pools) is merged field by
// field so a partial override never drops the rest of the base.
export function applyExperimentConfig({ base, experiment }) {
  if (!experiment || !experiment.treatment || !experiment.config) return base
  const { weights = {}, diversity = {}, pools = {} } = experiment.config
  const hasOverrides =
    Object.keys(weights).length || Object.keys(diversity).length || Object.keys(pools).length
  if (!hasOverrides) return base
  const merged = { ...(base || {}) }
  if (weights && Object.keys(weights).length) {
    merged.weights = { ...(merged.weights || {}), ...weights }
  }
  if (diversity && Object.keys(diversity).length) {
    merged.diversity = { ...(merged.diversity || {}), ...diversity }
  }
  if (pools && Object.keys(pools).length) {
    merged.pools = { ...(merged.pools || {}), ...pools }
  }
  return merged
}

// Fire-and-forget metric write: one row in distribution_experiment_events via
// log_distribution_event (INVOKER, pins user_id = auth.uid()). Returns a
// promise the caller may `.catch()` — metrics must never fail a UI action.
// No experiment key/variant ⇒ no-op, so an un-staged feed logs nothing.
export function logExperimentEvent(client, { experimentKey, variant, eventType, postId }) {
  if (!experimentKey || !variant) return Promise.resolve()
  // Promise.resolve() turns the thenable postgrest builder into a real
  // Promise so callers may `.catch()` it (builders have no `.catch`).
  return Promise.resolve(client.rpc('log_distribution_event', {
    p_experiment_key: experimentKey,
    p_variant: variant,
    p_event_type: eventType,
    p_post_id: postId || null,
  }))
}
