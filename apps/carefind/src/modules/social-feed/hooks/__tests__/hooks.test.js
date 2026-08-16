import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const mockUser = vi.hoisted(() => ({ id: 'user1', email: 'test@test.com' }))

// Mock supabase
vi.mock('../../../../config/supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => Promise.resolve({ data: [], error: null })),
        })),
        order: vi.fn(() => Promise.resolve({ data: [], error: null })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: { id: '1', content: 'test', user_id: 'user1', created_at: new Date().toISOString() }, error: null })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      })),
      delete: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      })),
    })),
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: { access_token: 'test-token' } } })),
    },
  },
}))

// Hooks read the current user from the auth context, not from supabase.
vi.mock('../../../../providers/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}))

import { usePostComposer } from '../../hooks/usePostComposer'

describe('usePostComposer', () => {
  it('should initialize with empty content', () => {
    const { result } = renderHook(() => usePostComposer())

    expect(result.current.content).toBe('')
    expect(result.current.postType).toBe('text')
    expect(result.current.posting).toBe(false)
  })

  it('should update content', () => {
    const { result } = renderHook(() => usePostComposer())

    act(() => {
      result.current.setContent('Hello world')
    })

    expect(result.current.content).toBe('Hello world')
  })

  it('should update post type', () => {
    const { result } = renderHook(() => usePostComposer())

    act(() => {
      result.current.setPostType('visual')
    })

    expect(result.current.postType).toBe('visual')
  })
})