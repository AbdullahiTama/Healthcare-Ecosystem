export enum NOTIFICATION_TYPES {
  // CareFind types
  LIKE = 'like',
  COMMENT = 'comment',
  REPLY = 'reply',
  REPOST = 'repost',
  FOLLOW = 'follow',
  GIFT = 'gift',
  MENTION = 'mention',
  LIVE = 'live',
  NEWS_LIKE = 'news_like',
  NEWS_COMMENT = 'news_comment',
  PRODUCT_AVAILABLE = 'product_available',
  PROFILE_VIEW = 'profile_view',

  // CareHub types
  MESSAGE = 'message',
  ORDER_CREATED = 'order_created',
  ORDER_ADVANCED = 'order_advanced',
  ACTIVITY_LOGGED = 'activity_logged',
  ACTIVITY_COMMENT = 'activity_comment',
  CONSULTATION_REQUEST = 'consultation_request',
  WITHDRAWAL_REQUEST = 'withdrawal_request',
  TASK_SUBMISSION = 'task_submission',
}

export interface NotificationPayload {
  recipientId: string
  actorId?: string
  type: NOTIFICATION_TYPES | string
  message: string
  link?: string | null
  postId?: string | null
  metadata?: Record<string, any>
}

export interface NotificationRecord {
  id: string
  recipient_id: string
  actor_id: string | null
  type: string
  message: string
  link: string | null
  post_id: string | null
  read: boolean
  created_at: string
  metadata?: Record<string, any>
}

export interface NotificationRepository {
  create(payload: NotificationPayload): Promise<NotificationRecord>
  getByRecipient(recipientId: string, options?: { limit?: number; offset?: number; unreadOnly?: boolean }): Promise<NotificationRecord[]>
  getUnreadCount(recipientId: string): Promise<number>
  markAsRead(id: string): Promise<void>
  markAllAsRead(recipientId: string): Promise<void>
  subscribe(recipientId: string, onInsert: (record: NotificationRecord) => void): () => void
}