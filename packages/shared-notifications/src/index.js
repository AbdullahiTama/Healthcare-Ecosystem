// Core notification types and contracts
// This module defines the seam that both apps will implement

export * from './types.js'
export { CareFindNotificationRepository, createCareFindNotificationService, careFindMessages } from './adapters/CareFindAdapter.js'
export { CareHubNotificationRepository, createCareHubNotificationService, careHubMessages } from './adapters/CareHubAdapter.js'

// Default human-readable messages per type.
//
// The single source of truth is ./types.js. It used to be redefined here, and
// because a local `export const` shadows a name arriving via `export *`, the
// local copy silently won — which is how product_expiring_soon went missing
// from the map the adapters actually read. Re-export instead of redefining.
export { DEFAULT_MESSAGES } from './types.js'