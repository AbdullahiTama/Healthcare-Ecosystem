// Mobile menu trigger geometry — the single source of truth behind the
// trigger's placement (BusinessDashboard), the bare-route top clearance
// (BusinessDashboard's bareGuard), and TopBar's left clearance. One change
// here keeps all three in sync (docs/design/NAVIGATION.md).
export const MOBILE_MENU_TOP = 12
export const MOBILE_MENU_LEFT = 12
export const MOBILE_MENU_SIZE = 44
export const MOBILE_MENU_CLEAR = MOBILE_MENU_TOP + MOBILE_MENU_SIZE + 8 // 64