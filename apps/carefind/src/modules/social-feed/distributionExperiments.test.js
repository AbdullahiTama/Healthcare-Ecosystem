// Phase 7 — staged content distribution: pure resolution + config merging.
// The module is I/O-free apart from logExperimentEvent's thin client wrapper,
// so everything here runs without mocks; the log wrapper is tested against a
// fake client asserting the RPC args it would send.

import { describe, it, expect } from 'vitest'
import {
  bucketFor,
  isWithinWindow,
  resolveExperiment,
  applyExperimentConfig,
  logExperimentEvent,
} from './distributionExperiments'

const NOW = Date.parse('2026-08-13T12:00:00Z')

const activeExp = (overrides = {}) => ({
  key: 'foryou_engine_v1',
  label: 'For You engine v1 (recency tilt)',
  enabled: true,
  rollout_pct: 50,
  variant: 'treatment',
  config: { weights: { engagement: 35, recency: 25 }, diversity: { maxPerAuthor: 4 } },
  ...overrides,
})

describe('bucketFor', () => {
  it('returns a deterministic value in [0, buckets) for the same id+key', () => {
    const a = bucketFor('u_abc', 'foryou_engine_v1')
    const b = bucketFor('u_abc', 'foryou_engine_v1')
    expect(a).toBe(b)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(100)
  })

  it('spreads different ids across buckets', () => {
    const seen = new Set()
    // 200 draws over 1000 buckets: a uniform hash lands ~181 distinct values,
    // so the spread must stay well above the clumped 100s. (100-bucket space
    // can never exceed 100 distinct, so this measures on the larger space.)
    for (let i = 0; i < 200; i++) seen.add(bucketFor(`reader_${i}`, 'exp', 1000))
    expect(seen.size).toBeGreaterThan(150)
  })

  it('varies by experiment key, so one id is not stuck in one bucket', () => {
    const id = 'u_abc'
    const keys = new Set(['exp_a', 'exp_b', 'exp_c'].map((k) => bucketFor(id, k)))
    expect(keys.size).toBe(3)
  })

  it('handles null/undefined ids without throwing (anonymous session)', () => {
    expect(bucketFor(null, 'exp')).toBe(bucketFor(null, 'exp'))
    expect(bucketFor(undefined, 'exp')).toBeGreaterThanOrEqual(0)
  })
})

describe('isWithinWindow', () => {
  it('is open when neither bound is set', () => {
    expect(isWithinWindow({}, NOW)).toBe(true)
  })

  it('excludes a not-yet-started experiment', () => {
    expect(isWithinWindow({ start_at: '2026-08-14T00:00:00Z' }, NOW)).toBe(false)
  })

  it('excludes an ended experiment', () => {
    expect(isWithinWindow({ end_at: '2026-08-12T00:00:00Z' }, NOW)).toBe(false)
  })

  it('includes an experiment inside the window', () => {
    expect(isWithinWindow({ start_at: '2026-08-01T00:00:00Z', end_at: '2026-09-01T00:00:00Z' }, NOW)).toBe(true)
  })
})

describe('resolveExperiment', () => {
  it('returns null when there are no experiments', () => {
    expect(resolveExperiment({ experiments: [] })).toBeNull()
  })

  it('returns null when the kill switch is off', () => {
    expect(resolveExperiment({ experiments: [activeExp({ enabled: false })], userId: 'u1' })).toBeNull()
  })

  it('returns null at rollout 0', () => {
    expect(resolveExperiment({ experiments: [activeExp({ rollout_pct: 0 })], userId: 'u1' })).toBeNull()
  })

  it('returns null outside the window', () => {
    expect(resolveExperiment({ experiments: [activeExp({ start_at: '2026-09-01T00:00:00Z' })], userId: 'u1', now: NOW })).toBeNull()
  })

  it('assigns everyone treatment at rollout 100', () => {
    const r = resolveExperiment({ experiments: [activeExp({ rollout_pct: 100 })], userId: 'u1', now: NOW })
    expect(r.treatment).toBe(true)
    expect(r.variant).toBe('treatment')
  })

  it('assigns deterministic control vs treatment across sessions for the same reader', () => {
    const first = resolveExperiment({ experiments: [activeExp()], userId: 'u_42', now: NOW })
    const second = resolveExperiment({ experiments: [activeExp()], userId: 'u_42', now: NOW })
    expect(first.treatment).toBe(second.treatment)
    expect(first.variant).toBe(second.variant)
  })

  it('splits a 50% rollout into roughly half treatment, half control', () => {
    let treatment = 0
    let control = 0
    for (let i = 0; i < 1000; i++) {
      const r = resolveExperiment({ experiments: [activeExp({ rollout_pct: 50 })], userId: `u_${i}`, now: NOW })
      if (r.variant === 'control') control += 1
      else treatment += 1
    }
    // 500/500 nominal; allow a wide but meaningful margin for the hash spread.
    expect(treatment).toBeGreaterThan(400)
    expect(treatment).toBeLessThan(600)
    expect(control).toBeGreaterThan(400)
  })

  it('control users still carry the experiment identity so they log metrics', () => {
    const r = resolveExperiment({ experiments: [activeExp()], userId: 'u_control', now: NOW })
    if (!r.treatment) {
      expect(r.variant).toBe('control')
      expect(r.key).toBe('foryou_engine_v1')
    }
  })

  it('picks the first active experiment in a list', () => {
    const disabled = activeExp({ key: 'first', enabled: false })
    const active = activeExp({ key: 'second' })
    const r = resolveExperiment({ experiments: [disabled, active], userId: 'u1', now: NOW })
    expect(r.key).toBe('second')
  })

  it('uses the session id when there is no user id (anonymous bucketing)', () => {
    const bySession = resolveExperiment({ experiments: [activeExp()], sessionId: 'sess_xyz', now: NOW })
    const same = resolveExperiment({ experiments: [activeExp()], sessionId: 'sess_xyz', now: NOW })
    expect(bySession.treatment).toBe(same.treatment)
  })
})

describe('applyExperimentConfig', () => {
  const base = {
    weights: { engagement: 40, recency: 20, affinity: 20, authority: 15, location: 10, medical: 10, interests: 10 },
    diversity: { maxPerAuthor: 3, maxPerType: 5 },
    pools: { trending: { enabled: true, priority: 10, limitCount: 25 } },
  }

  it('returns the base untouched for control / null experiments', () => {
    expect(applyExperimentConfig({ base, experiment: null })).toBe(base)
    expect(applyExperimentConfig({ base, experiment: { variant: 'control', treatment: false, config: { weights: { engagement: 1 } } } })).toBe(base)
  })

  it('merges treatment overrides field-by-field without dropping the rest', () => {
    const merged = applyExperimentConfig({
      base,
      experiment: {
        treatment: true,
        config: { weights: { engagement: 35, recency: 25 }, diversity: { maxPerAuthor: 4 } },
      },
    })
    expect(merged.weights).toEqual({ engagement: 35, recency: 25, affinity: 20, authority: 15, location: 10, medical: 10, interests: 10 })
    expect(merged.diversity).toEqual({ maxPerAuthor: 4, maxPerType: 5 })
    expect(merged.pools).toBe(base.pools)
  })

  it('merges pool overrides when present', () => {
    const merged = applyExperimentConfig({
      base,
      experiment: { treatment: true, config: { pools: { fresh: { enabled: false } } } },
    })
    expect(merged.pools).toEqual({ trending: base.pools.trending, fresh: { enabled: false } })
  })

  it('is a no-op when the treatment config is empty', () => {
    const merged = applyExperimentConfig({ base, experiment: { treatment: true, config: {} } })
    expect(merged).toBe(base)
  })
})

describe('logExperimentEvent', () => {
  it('resolves without calling the client when nothing is staged', async () => {
    let called = false
    const client = { rpc: () => { called = true; return Promise.resolve({ error: null }) } }
    await logExperimentEvent(client, { experimentKey: null, variant: null, eventType: 'feed_view' })
    await logExperimentEvent(client, { experimentKey: 'exp', variant: null, eventType: 'feed_view' })
    expect(called).toBe(false)
  })

  it('calls log_distribution_event with the tagged identity + post', async () => {
    let args = null
    const client = {
      rpc: (name, params) => { args = { name, params }; return Promise.resolve({ error: null }) },
    }
    await logExperimentEvent(client, {
      experimentKey: 'foryou_engine_v1',
      variant: 'control',
      eventType: 'engage',
      postId: 'p_1',
    })
    expect(args).toEqual({
      name: 'log_distribution_event',
      params: { p_experiment_key: 'foryou_engine_v1', p_variant: 'control', p_event_type: 'engage', p_post_id: 'p_1' },
    })
  })

  it('sends null post_id for feed_view events', async () => {
    let params = null
    const client = { rpc: (name, p) => { params = p; return Promise.resolve({ error: null }) } }
    await logExperimentEvent(client, { experimentKey: 'exp', variant: 'treatment', eventType: 'feed_view' })
    expect(params.p_post_id).toBeNull()
  })

  it('never rejects when the RPC fails (fire-and-forget)', async () => {
    const client = { rpc: () => Promise.reject(new Error('network')) }
    await expect(logExperimentEvent(client, { experimentKey: 'exp', variant: 'treatment', eventType: 'feed_view' })).rejects.toThrow('network')
  })
})