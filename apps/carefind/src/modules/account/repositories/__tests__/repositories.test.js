import { describe, it, expect } from 'vitest'
import { createProfileRepository } from '../profileRepository'
import { createAccountRepositories } from '../index'

function mockClient(tables = {}) {
  return {
    from(table) {
      const rows = tables[table] || []
      let _filters = []
      let _orderBy = null
      let _limitVal = null
      let _count = null
      let _single = false
      let _maybeSingle = false

      const chain = {
        select(cols, opts) {
          if (opts?.count === 'exact') _count = opts
          return chain
        },
        eq(col, val) { _filters.push({ col, val }); return chain },
        neq(col, val) { _filters.push({ col, val, op: 'neq' }); return chain },
        in(col, vals) { _filters.push({ col, val: vals, op: 'in' }); return chain },
        order(col, opts) { _orderBy = { col, ...opts }; return chain },
        limit(n) { _limitVal = n; return chain },
        single() { _single = true; return chain },
        maybeSingle() { _maybeSingle = true; return chain },
        upsert(row) {
          return { data: row, error: null }
        },
        insert(row) {
          return {
            select() {
              return {
                single() {
                  return { data: { id: 'new_1', ...row }, error: null }
                },
              }
            },
          }
        },
        update(updates) {
          return {
            eq(col, val) {
              _filters.push({ col, val })
              return chain
            },
          }
        },
        delete() {
          return {
            eq(col, val) {
              _filters.push({ col, val })
              return chain
            },
          }
        },
        then(resolve) {
          let filtered = rows
          for (const f of _filters) {
            if (f.op === 'in') {
              filtered = filtered.filter(r => f.val.includes(r[f.col]))
            } else if (f.op === 'neq') {
              filtered = filtered.filter(r => r[f.col] !== f.val)
            } else {
              filtered = filtered.filter(r => r[f.col] === f.val)
            }
          }
          if (_orderBy) {
            filtered = [...filtered].sort((a, b) => {
              const av = a[_orderBy.col], bv = b[_orderBy.col]
              return _orderBy.ascending ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1)
            })
          }
          if (_limitVal) filtered = filtered.slice(0, _limitVal)
          if (_count) {
            resolve({ data: filtered, error: null, count: filtered.length })
          } else if (_single) {
            resolve({ data: filtered[0] || null, error: filtered[0] ? null : { message: 'not found' } })
          } else if (_maybeSingle) {
            resolve({ data: filtered[0] || null, error: null })
          } else {
            resolve({ data: filtered, error: null })
          }
        },
      }
      return chain
    },
    rpc(fn, params) {
      return { data: null, error: null }
    },
  }
}

describe('profileRepository', () => {
  const tables = {
    profiles: [
      { id: 'u1', display_name: 'Dr. Smith', full_name: 'John Smith', avatar_url: null, cover_url: null, phone: '555-0100', email: 'doc@test.com', is_verified: true, verification_label: 'Verified Professional', specialty: 'Cardiology', subscription_price: 9.99, location: 'Lagos', country: 'NG' },
    ],
    wallets: [
      { user_id: 'u1', balance: 500 },
    ],
    posts: [
      { id: 'p1', user_id: 'u1', content: 'Hello', created_at: '2026-01-01', post_type: 'text' },
      { id: 'p2', user_id: 'u2', content: 'Other', created_at: '2026-01-02', post_type: 'text' },
    ],
    reviews: [
      { id: 'r1', user_id: 'u1', rating: 5, comment: 'Great!', created_at: '2026-01-01', business_id: 'b1', businesses: { name: 'Clinic' } },
    ],
    saved_posts: [
      { id: 's1', user_id: 'u1', post_id: 'p1' },
    ],
    follows: [
      { id: 'f1', follower_id: 'u1', following_id: 'u2' },
      { id: 'f2', follower_id: 'u3', following_id: 'u1' },
    ],
    post_comments: [
      { id: 'c1', user_id: 'u1', content: 'Nice' },
    ],
    verification_requests: [
      { id: 'v1', user_id: 'u1', status: 'pending' },
    ],
    businesses: [
      { id: 'b1', name: 'My Clinic', owner_id: 'u1', business_type: 'clinic', cover_url: null, visible_on_carefind: true },
    ],
    notifications: [
      { id: 'n1', recipient_id: 'u1', read: false },
    ],
  }

  const repo = createProfileRepository({ client: mockClient(tables) })

  it('getProfileById returns profile data', async () => {
    const p = await repo.getProfileById('u1')
    expect(p).toBeTruthy()
    expect(p.display_name).toBe('Dr. Smith')
    expect(p.specialty).toBe('Cardiology')
  })

  it('getProfilePublic returns public profile', async () => {
    const p = await repo.getProfilePublic('u1')
    expect(p.display_name).toBe('Dr. Smith')
  })

  it('getProfileLocation returns location', async () => {
    const p = await repo.getProfileLocation('u1')
    expect(p.location).toBe('Lagos')
  })

  it('getWalletBalance returns balance', async () => {
    const b = await repo.getWalletBalance('u1')
    expect(b).toBe(500)
  })

  it('getMyPosts returns posts for user', async () => {
    const posts = await repo.getMyPosts('u1')
    expect(posts).toHaveLength(1)
    expect(posts[0].id).toBe('p1')
  })

  it('getMyPostCount returns count', async () => {
    const count = await repo.getMyPostCount('u1')
    expect(count).toBe(1)
  })

  it('getMyReviews returns reviews', async () => {
    const reviews = await repo.getMyReviews('u1')
    expect(reviews).toHaveLength(1)
    expect(reviews[0].rating).toBe(5)
  })

  it('getSavedPostCount returns count', async () => {
    const count = await repo.getSavedPostCount('u1')
    expect(count).toBe(1)
  })

  it('getFollowerCount returns count', async () => {
    const count = await repo.getFollowerCount('u1')
    expect(count).toBe(1)
  })

  it('getFollowingCount returns count', async () => {
    const count = await repo.getFollowingCount('u1')
    expect(count).toBe(1)
  })

  it('getCommentCount returns count', async () => {
    const count = await repo.getCommentCount('u1')
    expect(count).toBe(1)
  })

  it('getVerificationRequest returns status', async () => {
    const v = await repo.getVerificationRequest('u1')
    expect(v.status).toBe('pending')
  })

  it('getMyBusinesses returns businesses', async () => {
    const b = await repo.getMyBusinesses('u1')
    expect(b).toHaveLength(1)
    expect(b[0].name).toBe('My Clinic')
  })

  it('getBusinessesByIds returns matching businesses', async () => {
    const b = await repo.getBusinessesByIds(['b1'])
    expect(b).toHaveLength(1)
  })

  it('getBusinessesByIds returns empty for empty input', async () => {
    const b = await repo.getBusinessesByIds([])
    expect(b).toHaveLength(0)
  })

  it('markNotificationsRead resolves', async () => {
    await expect(repo.markNotificationsRead('u1')).resolves.not.toThrow()
  })

  it('upsertProfile resolves', async () => {
    await expect(repo.upsertProfile({ id: 'u1', display_name: 'Test' })).resolves.not.toThrow()
  })

  it('updateProfile resolves', async () => {
    await expect(repo.updateProfile('u1', { display_name: 'Updated' })).resolves.not.toThrow()
  })

  it('submitVerificationRequest resolves', async () => {
    await expect(repo.submitVerificationRequest({ user_id: 'u1', status: 'pending' })).resolves.not.toThrow()
  })
})

describe('createAccountRepositories', () => {
  it('creates profile repo', () => {
    const repos = createAccountRepositories({ client: mockClient() })
    expect(repos.profile).toBeTruthy()
    expect(typeof repos.profile.getProfileById).toBe('function')
  })
})
