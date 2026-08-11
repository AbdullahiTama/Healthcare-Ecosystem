import { createClient } from '@supabase/supabase-js'
import { NOTIFICATION_TYPES, DEFAULT_MESSAGES } from '../index'

const supabaseUrl = 'https://szdybxmgmhndoytqanfb.supabase.co'
const supabaseAnonKey = 'sb_publishable_xEs5f4L6qSxqXikPZM06SQ_TKy4UNFz'

export class CareFindNotificationRepository {
  constructor() {
    this.supabase = createClient(supabaseUrl, supabaseAnonKey)
  }

  async create(payload) {
    if (!payload.recipientId) return null
    if (payload.recipientId === payload.actorId) return null

    const { data, error } = await this.supabase
      .from('notifications')
      .insert({
        recipient_id: payload.recipientId,
        actor_id: payload.actorId || null,
        type: payload.type,
        message: payload.message || DEFAULT_MESSAGES[payload.type] || 'notified you',
        link: payload.link || null,
        post_id: payload.postId || null,
        read: false,
      })
      .select()
      .single()

    if (error) throw error
    return data
  }

  async getByRecipient(recipientId, options = {}) {
    const { limit = 50, offset = 0, unreadOnly = false } = options
    let query = this.supabase
      .from('notifications')
      .select('*')
      .eq('recipient_id', recipientId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (unreadOnly) query = query.eq('read', false)

    const { data, error } = await query
    if (error) throw error
    return data || []
  }

  async getUnreadCount(recipientId) {
    const { count, error } = await this.supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', recipientId)
      .eq('read', false)

    if (error) throw error
    return count || 0
  }

  async markAsRead(id) {
    const { error } = await this.supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', id)

    if (error) throw error
  }

  async markAllAsRead(recipientId) {
    const { error } = await this.supabase
      .from('notifications')
      .update({ read: true })
      .eq('recipient_id', recipientId)
      .eq('read', false)

    if (error) throw error
  }

  subscribe(recipientId, onInsert) {
    const channel = this.supabase
      .channel(`notifications:${recipientId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${recipientId}`,
        },
        (payload) => {
          if (payload.new) onInsert(payload.new)
        }
      )
      .subscribe()

    return () => {
      this.supabase.removeChannel(channel)
    }
  }
}

export function createCareFindNotificationService(repository) {
  return {
    async notify(payload) {
      try {
        await repository.create({
          ...payload,
          message: payload.message || DEFAULT_MESSAGES[payload.type] || 'notified you',
        })
      } catch (e) {
        console.warn('CareFind notification failed:', e)
      }
    },

    getNotifications: (recipientId, options) => repository.getByRecipient(recipientId, options),
    getUnreadCount: (recipientId) => repository.getUnreadCount(recipientId),
    markAsRead: (id) => repository.markAsRead(id),
    markAllAsRead: (recipientId) => repository.markAllAsRead(recipientId),
    onNotification: (recipientId, handler) => repository.subscribe(recipientId, handler),
  }
}

export const careFindMessages = {
  [NOTIFICATION_TYPES.LIKE]: 'liked your post',
  [NOTIFICATION_TYPES.COMMENT]: 'commented on your post',
  [NOTIFICATION_TYPES.REPLY]: 'replied to you',
  [NOTIFICATION_TYPES.REPOST]: 'reposted your post',
  [NOTIFICATION_TYPES.FOLLOW]: 'started following you',
  [NOTIFICATION_TYPES.GIFT]: 'sent you a gift',
  [NOTIFICATION_TYPES.MENTION]: 'mentioned you',
  [NOTIFICATION_TYPES.LIVE]: 'is live now',
  [NOTIFICATION_TYPES.NEWS_LIKE]: 'liked your article',
  [NOTIFICATION_TYPES.NEWS_COMMENT]: 'commented on your article',
  [NOTIFICATION_TYPES.PRODUCT_AVAILABLE]: 'a product you wanted is now available',
  [NOTIFICATION_TYPES.PROFILE_VIEW]: 'viewed your profile',
}