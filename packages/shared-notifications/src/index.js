// Core notification types and contracts
// This module defines the seam that both apps will implement

// NOTIFICATION_TYPES and DEFAULT_MESSAGES both live in types.js and are
// re-exported here. This file previously declared its own second copy of
// DEFAULT_MESSAGES, which shadowed the star export and silently drifted from
// it — the duplicate was missing PRODUCT_EXPIRING_SOON, so consumers reading
// the map through this module resolved that type to undefined. One map, one
// place.
export * from './types.js'
export { CareFindNotificationRepository, createCareFindNotificationService, careFindMessages } from './adapters/CareFindAdapter.js'
export { CareHubNotificationRepository, createCareHubNotificationService, careHubMessages } from './adapters/CareHubAdapter.js'
