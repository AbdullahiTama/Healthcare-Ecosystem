// Core notification types and contracts
// This module defines the seam that both apps will implement

import { NOTIFICATION_TYPES } from './types.js'

export * from './types.js'
export { CareFindNotificationRepository, createCareFindNotificationService, careFindMessages } from './adapters/CareFindAdapter.js'
export { CareHubNotificationRepository, createCareHubNotificationService, careHubMessages } from './adapters/CareHubAdapter.js'

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
}