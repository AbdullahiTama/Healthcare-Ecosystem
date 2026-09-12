// Single source of truth for what each CareHub plan actually means — limits,
// display label, and yearly/monthly naira price. Referenced by both the client
// (Staff.jsx/Locations.jsx/Inventory.jsx enforcement, Settings.jsx billing display,
// Register.jsx hospital gate, Landing.jsx pricing) and api/initiate-plan-payment.js
// (which looks the price up here rather than trusting anything the client sends).
export const PLAN_LIMITS = {
  basic: { maxStaff: 5, maxLocations: 2, maxProducts: 5000 },
  growth: { maxStaff: Infinity, maxLocations: 5, maxProducts: Infinity },
  premium: { maxStaff: Infinity, maxLocations: 10, maxProducts: Infinity },
  enterprise: { maxStaff: Infinity, maxLocations: 30, maxProducts: Infinity },
  custom: { maxStaff: Infinity, maxLocations: Infinity, maxProducts: Infinity },
  // Backward compat: legacy hospital plan rows map to growth limits
  hospital: { maxStaff: Infinity, maxLocations: 5, maxProducts: Infinity },
}

export const PLAN_LABELS = {
  basic: 'Basic',
  growth: 'Growth',
  premium: 'Premium',
  enterprise: 'Enterprise',
  custom: 'Custom',
  hospital: 'Hospital',
}

// Yearly Naira — canonical per brief (affordable adoption)
// Custom has no fixed price — negotiated offline.
export const PLAN_YEARLY_NAIRA = {
  basic: 60000,
  growth: 100000,
  premium: 150000,
  enterprise: 250000,
  custom: null,
  hospital: 100000,
}

// Monthly derived for backward compat (yearly/12). Kept so existing monthly
// renew paths and UI that show per-month still work without duplicating source.
export const PLAN_MONTHLY_NAIRA = {
  basic: Math.round(60000 / 12),
  growth: Math.round(100000 / 12),
  premium: Math.round(150000 / 12),
  enterprise: Math.round(250000 / 12),
  custom: null,
  hospital: Math.round(100000 / 12),
}

export function planLimitsFor(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.basic
}

export function planYearlyNairaFor(plan) {
  return PLAN_YEARLY_NAIRA[plan] ?? null
}

export function isPlanAllowedForBusinessType(plan, businessType) {
  if (businessType === 'hospital' && plan === 'basic') return false
  return true
}

export function getMinPlanForBusinessType(businessType) {
  if (businessType === 'hospital') return 'growth'
  return 'basic'
}
