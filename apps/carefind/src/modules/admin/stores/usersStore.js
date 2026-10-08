import { create } from 'zustand'
import { usersRepository } from '../repositories/usersRepository'

export const useUsersStore = create((set, get) => ({
  users: [],
  loading: false,
  error: null,

  fetchUsers: async () => {
    if (get().loading) return
    set({ loading: true, error: null })
    try {
      const data = await usersRepository.getUsers({ limit: 100 })
      set({ users: data || [], loading: false })
    } catch (err) {
      set({ error: err.message, loading: false })
    }
  },

  setUsers: (users) => set({ users }),

  updateUser: (id, patch) => set((state) => ({
    users: state.users.map(u => u.id === id ? { ...u, ...patch } : u),
  })),

  removeUser: (id) => set((state) => ({
    users: state.users.filter(u => u.id !== id),
  })),
}))
