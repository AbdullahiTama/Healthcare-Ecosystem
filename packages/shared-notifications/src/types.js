// Notification type constants
export const NOTIFICATION_TYPES = {
  // CareFind types
  LIKE: 'like',
  COMMENT: 'comment',
  REPLY: 'reply',
  REPOST: 'repost',
  FOLLOW: 'follow',
  GIFT: 'gift',
  MENTION: 'mention',
  LIVE: 'live',
  NEWS_LIKE: 'news_like',
  NEWS_COMMENT: 'news_comment',
  PRODUCT_AVAILABLE: 'product_available',
  PROFILE_VIEW: 'profile_view',

  // CareHub types
  MESSAGE: 'message',
  ORDER_CREATED: 'order_created',
  ORDER_ADVANCED: 'order_advanced',
  ACTIVITY_LOGGED: 'activity_logged',
  ACTIVITY_COMMENT: 'activity_comment',
  CONSULTATION_REQUEST: 'consultation_request',
  WITHDRAWAL_REQUEST: 'withdrawal_request',
  TASK_SUBMISSION: 'task_submission',
  BOOKING_CREATED: 'booking_created',
  BOOKING_PAID: 'booking_paid',
  BOOKING_CONFIRMED: 'booking_confirmed',
  PRODUCT_EXPIRING_SOON: 'product_expiring_soon',
}

// Default human-readable messages per type
export const DEFAULT_MESSAGES = {
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
  [NOTIFICATION_TYPES.BOOKING_CONFIRMED]: 'Your appointment was confirmed',
  [NOTIFICATION_TYPES.PRODUCT_EXPIRING_SOON]: ' product is approaching its expiry date',
}

/**
 * @typedef {Object} NotificationPayload
 * @property {string} recipientId - The user who receives the notification
 * @property {string} [actorId] - The user who performed the action
 * @property {string} type - One of NOTIFICATION_TYPES
 * @property {string} [message] - Human-readable message
 * @property {string} [link] - Deep link to related content
 * @property {string} [postId] - Related post ID (CareFind)
 * @property {Object} [metadata] - Additional metadata (businessId, isOwner for CareHub)
 */

/**
 * @typedef {Object} NotificationRecord
 * @property {string} id
 * @property {string} recipient_id
 * @property {string|null} actor_id
 * @property {string} type
 * @property {string} message
 * @property {string|null} link
 * @property {string|null} post_id
 * @property {boolean} read
 * @property {string} created_at
 */

/**
 * @typedef {Object} NotificationRepository
 * @property {function(payload: NotificationPayload): Promise<NotificationRecord>} create
 * @property {function(recipientId: string, options?: Object): Promise<NotificationRecord[]>} getByRecipient
 * @property {function(recipientId: string): Promise<number>} getUnreadCount
 * @property {function(id: string): Promise<void>} markAsRead
 * @property {function(recipientId: string): Promise<void>} markAllAsRead
 * @property {function(recipientId: string, onInsert: function(NotificationRecord): void): function(): void} subscribe
 */

/**
 * @typedef {Object} NotificationService
 * @property {function(payload: NotificationPayload): Promise<void>} notify
 * @property {function(recipientId: string, options?: Object): Promise<NotificationRecord[]>} getNotifications
 * @property {function(recipientId: string): Promise<number>} getUnreadCount
 * @property {function(id: string): Promise<void>} markAsRead
 * @property {function(recipientId: string): Promise<void>} markAllAsRead
 * @property {function(recipientId: string, handler: function(NotificationRecord): void): function(): void} onNotification
 */

// Export type identifiers for JSDoc consumers
export const NotificationPayload = 'NotificationPayload'
export const NotificationRecord = 'NotificationRecord'
export const NotificationRepository = 'NotificationRepository'
export const NotificationService = 'NotificationService'