import { adminTransport } from './transport.js'

export function createContentRepository(transport = adminTransport) {
  return {
    async getPosts({ search = '', type = 'all', dateFrom = '', dateTo = '', limit = 50, offset = 0 } = {}) {
      const filters = []

      if (type !== 'all') filters.push({ op: 'eq', col: 'post_type', val: type })
      if (dateFrom) filters.push({ op: 'gte', col: 'created_at', val: dateFrom })
      if (dateTo) filters.push({ op: 'lte', col: 'created_at', val: dateTo })

      const { data } = await transport.query('posts', {
        select: 'id, content, post_type, created_at, user_id',
        filters,
        order: { column: 'created_at', ascending: false },
        limit,
        offset,
      })

      if (search) {
        const q = search.toLowerCase()
        return data.filter(p => (p.content || '').toLowerCase().includes(q))
      }

      return data
    },

    async deletePost(id) {
      return transport.api('delete_post', { id })
    },

    async getStories() {
      const { data } = await transport.query('stories', {
        select: '*',
        order: { column: 'created_at', ascending: false },
      })
      return data
    },

    async createStory({ title, body, imageUrl, bgColor }) {
      return transport.api('create_story', { title, body, imageUrl, bgColor })
    },

    async deleteStory(id) {
      return transport.api('delete_story', { id })
    },

    async getNews() {
      const { data, phones } = await transport.api('list_news')
      return { items: data || [], phones: phones || {} }
    },

    async approveNews(id, edits = {}) {
      return transport.api('approve_news', { id, edits })
    },

    async rejectNews(id) {
      return transport.api('reject_news', { id })
    },

    async deleteNews(id) {
      return transport.api('delete_news', { id })
    },
  }
}

export const contentRepository = createContentRepository()
