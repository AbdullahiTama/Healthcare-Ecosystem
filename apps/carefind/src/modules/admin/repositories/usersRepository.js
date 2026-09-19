import { adminTransport } from './transport.js'

export function createUsersRepository(transport = adminTransport) {
  return {
    async getUsers({ search = '', verified = 'all', specialty = '', limit = 100, offset = 0 } = {}) {
      const { data } = await transport.api('list_user_profiles', { search, verified, specialty, limit, offset })
      return data || []
    },

    async getUserPosts(userId, limit = 10) {
      const { data } = await transport.api('get_user_posts', { userId, limit })
      return data || []
    },

    async getUserProfile(userId) {
      const { data } = await transport.api('get_user_profile', { userId })
      return data || null
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
