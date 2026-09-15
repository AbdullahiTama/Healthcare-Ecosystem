import { adminTransport } from './transport.js'

export function createUsersRepository(transport = adminTransport) {
  return {
    async getUsers({ search = '', verified = 'all', specialty = '', limit = 100, offset = 0 } = {}) {
      const filters = []

      if (verified === 'verified') filters.push({ op: 'eq', col: 'is_verified', val: true })
      else if (verified === 'unverified') filters.push({ op: 'neq', col: 'is_verified', val: true })

      if (specialty) filters.push({ op: 'ilike', col: 'specialty', val: `%${specialty}%` })

      const { data } = await transport.query('profiles', {
        select: 'id, full_name, display_name, is_verified, verification_label, specialty, location, website, created_at, cover_url',
        filters,
        order: { column: 'created_at', ascending: false },
        limit,
        offset,
      })

      if (search) {
        const q = search.toLowerCase()
        return data.filter(u =>
          (u.full_name || '').toLowerCase().includes(q) ||
          (u.display_name || '').toLowerCase().includes(q)
        )
      }

      return data
    },

    async getUser(id) {
      const { data: posts } = await transport.query('posts', {
        select: 'id, content, post_type, created_at',
        filters: [{ op: 'eq', col: 'user_id', val: id }],
        order: { column: 'created_at', ascending: false },
        limit: 10,
      })

      return { id, posts }
    },

    async getUserPosts(userId, limit = 10) {
      const { data } = await transport.query('posts', {
        select: 'id, content, post_type, created_at',
        filters: [{ op: 'eq', col: 'user_id', val: userId }],
        order: { column: 'created_at', ascending: false },
        limit,
      })
      return data
    },

    async getUserProfile(userId) {
      const { data } = await transport.query('profiles', {
        select: 'id, full_name, display_name, is_verified, verification_label, cover_url',
        filters: [{ op: 'eq', col: 'id', val: userId }],
      })
      return data?.[0] || null
    },

    async suspendUser(userId, days) {
      return transport.api('suspend_user', { userId, days })
    },

    async deleteUser(userId) {
      return transport.api('delete_user', { userId })
    },

    async verifyUser(userId, specialty) {
      return transport.api('manual_verify', { userId, specialty })
    },
  }
}

export const usersRepository = createUsersRepository()
