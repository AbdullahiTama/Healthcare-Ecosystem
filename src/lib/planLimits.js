// Single source of truth for what each CareHub plan actually means — limits,
// display label, and monthly naira price. Referenced by both the client
// (Staff.jsx/Locations.jsx enforcement, Settings.jsx billing display) and
// api/initiate-plan-payment.js (which looks the price up here rather than
// trusting anything the client sends, the same principle CareFind's
// api/_lib/topupPackages.js already follows for wallet top-ups).
export const PLAN_LIMITS = {
  basic: { maxStaff: 5, maxLocations: 1 },
  growth: { maxStaff: Infinity, maxLocations: 5 },
  hospital: { maxStaff: Infinity, maxLocations: 1 },
  enterprise: { maxStaff: Infinity, maxLocations: Infinity },
}

export const PLAN_LABELS = {
  basic: 'Basic',
  growth: 'Growth',
  hospital: 'Hospital',
  enterprise: 'Hospital Enterprise',
}

// Naira per month. A 12-month renewal charges 10x this (the landing page's
// "pay 10 months, get 12" offer), computed wherever this is used rather than
// stored twice.
export const PLAN_MONTHLY_NAIRA = {
  basic: 10000,
  growth: 25000,
  hospital: 35000,
  enterprise: 60000,
}

export function planLimitsFor(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.basic
}
