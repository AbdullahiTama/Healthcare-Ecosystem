import { createClient } from '@supabase/supabase-js'
import { NOTIFICATION_TYPES, DEFAULT_MESSAGES } from '../index'

const supabaseUrl = 'https://szdybxmgmhndoytqanfb.supabase.co'
const supabaseAnonKey = 'sb_publishable_xEs5f4L6qSxqXikPZM06SQ_TKy4UNFz'

export class CareHubNotificationRepository {
  constructor() {
    this.supabase = createClient(supabaseUrl, supabaseAnonKey)
  }

  async create(payload) {
    if (!payload.recipientId) return null
    if (payload.recipientId === payload.actorId) return null

    const { data, error } = await this.supabase
      .from('staff_notifications')
      .insert({
        business_id: payload.metadata?.businessId,
        staff_id: payload.recipientId,
        is_owner: payload.metadata?.isOwner || false,
        kind: payload.type,
        title: payload.message || DEFAULT_MESSAGES[payload.type] || 'notification',
        body: '',
        link: payload.link || null,
        read_at: null,
      })
      .select()
      .single()

    if (error) throw error
    return this.mapToStandard(data)
  }

  async getByRecipient(recipientId, options = {}) {
    const { limit = 50, offset = 0, unreadOnly = false } = options
    let query = this.supabase
      .from('staff_notifications')
      .select('*')
      .eq('staff_id', recipientId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (unreadOnly) query = query.is('read_at', null)

    const { data, error } = await query
    if (error) throw error
    return (data || []).map(this.mapToStandard)
  }

  async getUnreadCount(recipientId) {
    const { count, error } = await this.supabase
      .from('staff_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('staff_id', recipientId)
      .is('read_at', null)

    if (error) throw error
    return count || 0
  }

  async markAsRead(id) {
    const { error } = await this.supabase
      .from('staff_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)

    if (error) throw error
  }

  async markAllAsRead(recipientId) {
    const { error } = await this.supabase
      .from('staff_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('staff_id', recipientId)
      .is('read_at', null)

    if (error) throw error
  }

  subscribe(recipientId, onInsert) {
    const channel = this.supabase
      .channel(`carehub-notifications:${recipientId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'staff_notifications',
          filter: `staff_id=eq.${recipientId}`,
        },
        (payload) => {
          if (payload.new) onInsert(this.mapToStandard(payload.new))
        }
      )
      .subscribe()

    return () => {
      this.supabase.removeChannel(channel)
    }
  }

  mapToStandard(row) {
    return {
      id: row.id,
      recipient_id: row.staff_id,
      actor_id: null,
      type: row.kind,
      message: row.title,
      link: row.link,
      post_id: null,
      read: !!row.read_at,
      created_at: row.created_at,
    }
  }
}

export function createCareHubNotificationService(repository) {
  return {
    async notify(payload) {
      try {
        await repository.create({
          ...payload,
          message: payload.message || DEFAULT_MESSAGES[payload.type] || 'notified you',
        })
      } catch (e) {
        console.warn('CareHub notification failed:', e)
      }
    },

    getNotifications: (recipientId, options) => repository.getByRecipient(recipientId, options),
    getUnreadCount: (recipientId) => repository.getUnreadCount(recipientId),
    markAsRead: (id) => repository.markAsRead(id),
    markAllAsRead: (recipientId) => repository.markAllAsRead(recipientId),
    onNotification: (recipientId, handler) => repository.subscribe(recipientId, handler),
  }
}

export const careHubMessages = {
  [NOTIFICATION_TYPES.MESSAGE]: 'sent you a message',
  [NOTIFICATION_TYPES.ORDER_CREATED]: 'created a new order',
  [NOTIFICATION_TYPES.ORDER_ADVANCED]: 'updated an order',
  [NOTIFICATION_TYPES.ACTIVITY_LOGGED]: 'logged an activity',
  [NOTIFICATION_TYPES.ACTIVITY_COMMENT]: 'commented on an activity',
  [NOTIFICATION_TYPES.CONSULTATION_REQUEST]: 'requested a consultation',
  [NOTIFICATION_TYPES.WITHDRAWAL_REQUEST]: 'requested a withdrawal',
  [NOTIFICATION_TYPES.TASK_SUBMISSION]: 'submitted a task',
  [NOTIFICATION_TYPES.BOOKING_CREATED]: 'New appointment booking',
  [NOTIFICATION_TYPES.BOOKING_PAID]: 'Payment received for appointment',
  [NOTIFICATION_TYPES.BOOKING_CONFIRMED]: 'Appointment confirmed',
}