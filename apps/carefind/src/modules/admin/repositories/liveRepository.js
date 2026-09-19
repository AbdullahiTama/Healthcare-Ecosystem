import { adminTransport } from './transport.js'

export function createLiveRepository(transport = adminTransport) {
  return {
    async getActiveShows() {
      const { data } = await transport.query('live_shows', {
        select: 'id, title, status, started_at, host_id',
        filters: [{ op: 'eq', col: 'status', val: 'live' }],
        order: { column: 'started_at', ascending: false },
      })
      return data
    },

    async getScheduledShows() {
      const { data } = await transport.query('live_shows', {
        select: 'id, title, status, scheduled_at, trailer_url, host_id',
        filters: [{ op: 'eq', col: 'status', val: 'scheduled' }],
        order: { column: 'scheduled_at', ascending: true },
      })
      return data
    },

    async startShow(title, guestIds = []) {
      return transport.api('start_live_show', { title, guestIds })
    },

    async scheduleShow(title, scheduledAt, trailerUrl = null, guestIds = []) {
      return transport.api('schedule_show', { title, scheduledAt, trailerUrl, guestIds })
    },

    async startScheduledShow(showId) {
      return transport.api('start_scheduled_show', { showId })
    },

    async cancelScheduledShow(showId) {
      return transport.api('cancel_scheduled_show', { showId })
    },

    async endShow(showId) {
      return transport.api('end_live_show', { showId })
    },

    async getLiveControl(showId) {
      const [itemsRes, commentsRes, likeRes, shareRes, viewRes, giftRes] = await Promise.all([
        transport.query('live_items', {
          select: 'id, kind, content, created_at',
          filters: [{ op: 'eq', col: 'show_id', val: showId }],
          order: { column: 'created_at', ascending: false },
        }),
        transport.query('live_comments', {
          select: 'id, content, hidden, created_at, profiles(full_name, display_name)',
          filters: [{ op: 'eq', col: 'show_id', val: showId }],
          order: { column: 'created_at', ascending: false },
          limit: 60,
        }),
        transport.query('live_reactions', {
          select: 'id',
          filters: [{ op: 'eq', col: 'show_id', val: showId }],
          count: 'head',
        }),
        transport.query('live_shares', {
          select: 'id',
          filters: [{ op: 'eq', col: 'show_id', val: showId }],
          count: 'head',
        }),
        transport.query('live_views', {
          select: 'id',
          filters: [{ op: 'eq', col: 'show_id', val: showId }],
          count: 'head',
        }),
        transport.query('gifts', {
          select: 'coins',
          filters: [{ op: 'eq', col: 'post_id', val: showId }],
        }),
      ])

      return {
        items: itemsRes.data,
        comments: commentsRes.data,
        stats: {
          likes: likeRes.count || 0,
          shares: shareRes.count || 0,
          views: viewRes.count || 0,
          gifts: (giftRes.data || []).reduce((sum, g) => sum + (g.coins || 0), 0),
        },
      }
    },

    async postLiveItem(showId, kind, content) {
      return transport.api('post_live_item', { showId, kind, content })
    },

    async hideComment(commentId) {
      return transport.api('hide_live_comment', { id: commentId })
    },
  }
}

export const liveRepository = createLiveRepository()
