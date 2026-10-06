import { describe, it, expect, vi } from 'vitest'

vi.mock('../../adminApi.js', () => ({ callAdminAuth: vi.fn() }))
vi.mock('../../../../config/supabaseClient.js', () => ({ supabase: {} }))

import { createDashboardRepository } from '../dashboardRepository.js'

describe('dashboardRepository.getTotals', () => {
  it('asks for head counts only and returns them', async () => {
    const query = vi.fn(async (table) => ({ data: [], count: table === 'profiles' ? 1284 : 9310 }))
    const repo = createDashboardRepository({ query, api: vi.fn() })
    await expect(repo.getTotals()).resolves.toEqual({ users: 1284, posts: 9310 })
    expect(query).toHaveBeenCalledWith('profiles', { select: 'id', count: 'head' })
    expect(query).toHaveBeenCalledWith('posts', { select: 'id', count: 'head' })
  })

  it('reports zero for a missing count and lets failures through', async () => {
    const empty = createDashboardRepository({ query: vi.fn(async () => ({ data: [], count: null })), api: vi.fn() })
    await expect(empty.getTotals()).resolves.toEqual({ users: 0, posts: 0 })
    const broken = createDashboardRepository({ query: vi.fn(async () => { throw new Error('rls') }), api: vi.fn() })
    await expect(broken.getTotals()).rejects.toThrow('rls')
  })
})
