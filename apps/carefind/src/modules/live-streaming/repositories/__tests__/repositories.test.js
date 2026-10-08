import { describe, it, expect } from 'vitest'
import { createShowRepository } from '../showRepository'
import { createSessionRepository } from '../sessionRepository'
import { createLiveStreamingRepositories } from '../index'

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
        order(col, opts) { _orderBy = { col, ...opts }; return chain },
        limit(n) { _limitVal = n; return chain },
        single() { _single = true; return chain },
        maybeSingle() { _maybeSingle = true; return chain },
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
            filtered = filtered.filter(r => f.op === 'neq' ? r[f.col] !== f.val : r[f.col] === f.val)
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
      return { data: 'ok', error: null }
    },
  }
}

describe('showRepository', () => {
  const tables = {
    live_shows: [
      { id: 's1', title: 'Test Show', status: 'live', host_id: 'u1' },
    ],
    live_participants: [
      { show_id: 's1', user_id: 'u2', role: 'guest', joined: false, profiles: { full_name: 'Guest' } },
    ],
    live_reactions: [
      { id: 'r1', show_id: 's1', user_id: 'u2', created_at: '2026-01-01', profiles: { full_name: 'User' } },
    ],
    live_shares: [
      { id: 'sh1', show_id: 's1', user_id: 'u2', created_at: '2026-01-01', profiles: { full_name: 'User' } },
    ],
    live_views: [
      { id: 'v1', show_id: 's1', user_id: 'u2', created_at: '2026-01-01', profiles: { full_name: 'User' } },
    ],
    gifts: [
      { id: 'g1', post_id: 's1', sender_id: 'u2', coins: 10, created_at: '2026-01-01', profiles: { full_name: 'Gifter' } },
    ],
    live_items: [
      { id: 'i1', show_id: 's1', kind: 'text', content: 'hello', created_at: '2026-01-01', sender_id: 'u2', profiles: { full_name: 'User' } },
    ],
    live_comments: [
      { id: 'c1', show_id: 's1', content: 'nice!', hidden: false, created_at: '2026-01-01', user_id: 'u2', profiles: { full_name: 'User' } },
    ],
  }

  const repo = createShowRepository({ client: mockClient(tables) })

  it('getShowById returns show with profiles', async () => {
    const show = await repo.getShowById('s1')
    expect(show).toBeTruthy()
    expect(show.id).toBe('s1')
  })

  it('getParticipants returns participant rows', async () => {
    const p = await repo.getParticipants('s1')
    expect(p).toHaveLength(1)
    expect(p[0].user_id).toBe('u2')
  })

  it('getReactionCount returns count', async () => {
    const count = await repo.getReactionCount('s1')
    expect(count).toBe(1)
  })

  it('getRecentReactions returns reactions', async () => {
    const r = await repo.getRecentReactions('s1')
    expect(r).toHaveLength(1)
  })

  it('getShareCount returns count', async () => {
    const count = await repo.getShareCount('s1')
    expect(count).toBe(1)
  })

  it('getViewCount returns count', async () => {
    const count = await repo.getViewCount('s1')
    expect(count).toBe(1)
  })

  it('getGiftStats returns gift data', async () => {
    const g = await repo.getGiftStats('s1')
    expect(g).toHaveLength(1)
    expect(g[0].coins).toBe(10)
  })

  it('getItems returns items', async () => {
    const items = await repo.getItems('s1')
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('text')
  })

  it('getComments returns comments', async () => {
    const c = await repo.getComments('s1')
    expect(c).toHaveLength(1)
    expect(c[0].content).toBe('nice!')
  })

  it('addComment inserts a comment', async () => {
    await expect(repo.addComment('s1', 'u2', 'great')).resolves.not.toThrow()
  })

  it('hideComment updates hidden flag', async () => {
    await expect(repo.hideComment('c1')).resolves.not.toThrow()
  })

  it('addReaction inserts a reaction', async () => {
    await expect(repo.addReaction('s1', 'u2')).resolves.not.toThrow()
  })

  it('addShare inserts a share', async () => {
    await expect(repo.addShare('s1', 'u2')).resolves.not.toThrow()
  })

  it('addItem inserts an item', async () => {
    const item = await repo.addItem('s1', 'u2', 'text', 'hello')
    expect(item.id).toBeTruthy()
  })

  it('getWhoGifts returns gift data with profiles', async () => {
    const g = await repo.getWhoGifts('s1')
    expect(g).toHaveLength(1)
  })
})

describe('sessionRepository', () => {
  const tables = {
    live_sessions: [
      { id: 'sess1', title: 'Session', status: 'active', board_strokes: [], profiles: { full_name: 'Host' } },
    ],
    live_messages: [
      { id: 'm1', session_id: 'sess1', content: 'hi', type: 'text', user_id: 'u1', profiles: { full_name: 'User' } },
    ],
    wallets: [
      { user_id: 'u1', balance: 100 },
    ],
  }

  const repo = createSessionRepository({ client: mockClient(tables) })

  it('getSessionById returns session with profile', async () => {
    const s = await repo.getSessionById('sess1')
    expect(s).toBeTruthy()
    expect(s.id).toBe('sess1')
    expect(s.profiles.full_name).toBe('Host')
  })

  it('getMessages returns messages', async () => {
    const m = await repo.getMessages('sess1')
    expect(m).toHaveLength(1)
    expect(m[0].content).toBe('hi')
  })

  it('getWalletBalance returns balance', async () => {
    const b = await repo.getWalletBalance('u1')
    expect(b).toBe(100)
  })

  it('addMessage inserts a message', async () => {
    await expect(repo.addMessage('sess1', 'u1', 'hello')).resolves.not.toThrow()
  })

  it('sendGift calls RPC', async () => {
    const result = await repo.sendGift('u2', 10, 'heart', '❤️', 'sess1')
    expect(result).toBe('ok')
  })
})

describe('createLiveStreamingRepositories', () => {
  it('creates both show and session repos', () => {
    const repos = createLiveStreamingRepositories({ client: mockClient() })
    expect(repos.show).toBeTruthy()
    expect(repos.session).toBeTruthy()
    expect(typeof repos.show.getShowById).toBe('function')
    expect(typeof repos.session.getSessionById).toBe('function')
  })
})
