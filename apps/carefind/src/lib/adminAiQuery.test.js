import { describe, it, expect, vi } from 'vitest'

const callAdminAuth = vi.hoisted(() => vi.fn(async (action) => {
  if (action === 'list_news') return { data: [] }
  return { data: [] }
}))
vi.mock('../modules/admin/adminApi', () => ({ callAdminAuth }))
import { parseAdminQuery, formatQueryResult } from './adminAiQuery'

// Mock supabase
const mockSupabase = {
  from: (table) => ({
    select: (columns, options) => {
      // Handle count queries
      if (options?.count === 'exact') {
        return {
          eq: () => ({
            order: () => ({
              limit: () => Promise.resolve({ count: 0, error: null }),
            }),
          }),
        }
      }
      
      return {
        eq: (col, val) => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
          gte: () => Promise.resolve({ data: [], error: null }),
        }),
        not: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
        in: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
        order: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
        gte: () => Promise.resolve({ data: [], error: null }),
      }
    },
  }),
}

describe('adminAiQuery', () => {
  describe('parseAdminQuery', () => {
    it('recognizes user count queries', async () => {
      const result = await parseAdminQuery('how many users', mockSupabase)
      expect(result.success).toBe(true)
      expect(result.category).toBe('users')
      expect(result.type).toBe('count')
    })

    it('recognizes news queries', async () => {
      const result = await parseAdminQuery('show pending news', mockSupabase)
      expect(result.success).toBe(true)
      expect(result.category).toBe('news')
    })

    it('recognizes order queries', async () => {
      const result = await parseAdminQuery('list pending orders', mockSupabase)
      expect(result.success).toBe(true)
      expect(result.category).toBe('orders')
    })

    it('recognizes revenue queries', async () => {
      const result = await parseAdminQuery('show revenue', mockSupabase)
      expect(result.success).toBe(true)
      expect(result.category).toBe('revenue')
    })

    it('recognizes post queries', async () => {
      const result = await parseAdminQuery('show popular posts', mockSupabase)
      expect(result.success).toBe(true)
      expect(result.category).toBe('posts')
    })

    it('returns error for unrecognized queries', async () => {
      const result = await parseAdminQuery('what is the weather', mockSupabase)
      expect(result.success).toBe(false)
      expect(result.error).toContain('couldn\'t understand')
      expect(result.suggestions).toBeDefined()
    })
  })

  describe('formatQueryResult', () => {
    it('formats count results', () => {
      const result = formatQueryResult({
        success: true,
        type: 'count',
        value: 100,
        label: 'Total users',
      })
      expect(result.type).toBe('stat')
      expect(result.value).toBe('100')
    })

    it('formats list results', () => {
      const result = formatQueryResult({
        success: true,
        type: 'list',
        data: [{ id: 1, name: 'Test' }],
        label: 'Users',
      })
      expect(result.type).toBe('table')
      expect(result.data).toHaveLength(1)
    })

    it('formats revenue results', () => {
      const result = formatQueryResult({
        success: true,
        type: 'revenue',
        value: 50000,
        label: 'Total revenue',
      })
      expect(result.type).toBe('stat')
      expect(result.value).toContain('₦')
    })

    it('formats error results', () => {
      const result = formatQueryResult({
        success: false,
        error: 'Something went wrong',
      })
      expect(result.type).toBe('error')
      expect(result.message).toContain('went wrong')
    })
  })
})
