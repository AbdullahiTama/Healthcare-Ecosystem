import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock supabase
vi.mock('../../config/supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            range: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(() => Promise.resolve({ data: null, error: null })),
          })),
        })),
      })),
      delete: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      })),
    })),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(() => Promise.resolve({ data: { path: 'test' }, error: null })),
        getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://test.com/file.jpg' } })),
      })),
    },
  },
}))

import { postRepository } from '../repositories/postRepository'

describe('postRepository', () => {
  it('should export postRepository functions', () => {
    expect(postRepository.getFeed).toBeDefined()
    expect(postRepository.createPost).toBeDefined()
    expect(postRepository.updatePost).toBeDefined()
    expect(postRepository.deletePost).toBeDefined()
    expect(postRepository.getReactions).toBeDefined()
    expect(postRepository.addReaction).toBeDefined()
    expect(postRepository.removeReaction).toBeDefined()
  })

  it('should call supabase with correct parameters for getFeed', async () => {
    const { supabase } = await import('../../config/supabaseClient')
    const mockFrom = supabase.from
    
    await postRepository.getFeed('foryou')
    
    expect(mockFrom).toHaveBeenCalledWith('posts')
  })
})

import { commentRepository } from '../repositories/commentRepository'

describe('commentRepository', () => {
  it('should export commentRepository functions', () => {
    expect(commentRepository.getComments).toBeDefined()
    expect(commentRepository.addComment).toBeDefined()
    expect(commentRepository.updateComment).toBeDefined()
    expect(commentRepository.deleteComment).toBeDefined()
  })
})