// Capability figures for the marketing page.
//
// Every number here is a structural fact read out of the product source, not a
// traction, usage or performance statistic. Each carries the `source` it was
// verified against so a reviewer can re-derive it.
//
// The repository contains NO authenticated usage, customer-count, uptime or
// benchmark figure anywhere. The audit snapshot numbers that do appear
// (planning/CODE_AUDIT.md — 19 live businesses, 54 sales, 3645 products) were
// read by a security audit and are emphatically not marketing material, so
// they are not used. The doc test-count claims are mutually inconsistent across
// five files and are historical, so they are not used either.
//
// This is a deliberate design decision, not an omission: publishing "3k+
// businesses" or "98% uptime" here would be fabrication.
export const CAPABILITIES = [
  {
    value: '32',
    label: 'Dashboard modules',
    detail: 'POS, inventory, appointments, lab, imaging, reports, staff, locations and more.',
    source: 'src/lib/permissions.js — MODULES (32 keys, cross-checked against the 32-entry nav array)',
  },
  {
    value: '9',
    label: 'Business types',
    detail: 'Each one gets its own navigation, dashboard and vocabulary.',
    source: 'src/config/constants.js — BUSINESS_TYPES',
  },
  {
    value: '8',
    label: 'Built-in staff roles',
    detail: 'Owner through Doctor, plus any custom role your business defines.',
    source: 'src/lib/permissions.js — ROLES',
  },
  {
    value: '5',
    label: 'Pricing plans',
    detail: 'Basic, Growth, Premium, Enterprise and Custom.',
    source: 'src/lib/planLimits.js — PLAN_YEARLY_NAIRA',
  },
]

export const CAPABILITY_NOTE =
  'Platform capabilities, measured from the product — not usage statistics.'
