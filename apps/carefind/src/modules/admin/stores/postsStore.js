import { create } from 'zustand'
import { contentRepository } from '../repositories/contentRepository'

export const usePostsStore = create((set, get) => ({
  posts: [],
  loading: false,
  error: null,

  fetchPosts: async () => {
    if (get().loading) return
    set({ loading: true, error: null })
    try {
      const data = await contentRepository.getPosts({ limit: 50 })
      set({ posts: data || [], loading: false })
    } catch (err) {
      set({ error: err.message, loading: false })
    }
  },

  setPosts: (posts) => set({ posts }),

  removePost: (id) => set((state) => ({
    posts: state.posts.filter(p => p.id !== id),
  })),

  addPost: (post) => set((state) => ({
    posts: [post, ...state.posts],
  })),

  updatePost: (id, patch) => set((state) => ({
    posts: state.posts.map(p => p.id === id ? { ...p, ...patch } : p),
  })),
}))
