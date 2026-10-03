// Nav and footer link manifests.
//
// Every href here resolves to something that actually exists. The verified
// route inventory for this app is exactly: /, /login, /register,
// /forgot-password, /apply-agent, /dashboard, /admin, /receipt/:id — plus the
// external carefind.ng, mailto:support@carehub.ng, and this page's own
// section anchors.
//
// Nothing is invented. There is no /privacy, /terms, /blog, /docs or /careers
// in this repository, and App.jsx:151 sends every unknown path to the catch-all
// <Navigate to='/' /> — so a fabricated legal link would silently land the
// visitor back on the landing page while promising a document that does not
// exist. Those are listed as `soon: true` and rendered as plainly unavailable.

export const NAV_LINKS = [
  { label: 'Product', href: '#product' },
  { label: 'Features', href: '#features' },
  { label: 'Business types', href: '#built-for' },
  { label: 'Pricing', href: '#pricing' },
]

export const FOOTER_GROUPS = [
  {
    title: 'Product',
    links: [
      { label: 'Features', href: '#features' },
      { label: 'Smart POS', href: '#features' },
      { label: 'Inventory', href: '#features' },
      { label: 'Financial reports', href: '#features' },
      { label: 'Staff & roles', href: '#features' },
      { label: 'CareFind', href: '#features' },
    ],
  },
  {
    title: 'Solutions',
    links: [
      { label: 'Pharmacies', href: '#built-for' },
      { label: 'Hospitals', href: '#built-for' },
      { label: 'Clinics', href: '#built-for' },
      { label: 'Laboratories', href: '#built-for' },
      { label: 'Wellness & spas', href: '#built-for' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Product tour', href: '#product' },
      { label: 'How it works', href: '#workflow' },
      { label: 'Platform capabilities', href: '#capabilities' },
      { label: 'Pricing', href: '#pricing' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'CareFind', href: 'https://carefind.ng', external: true },
      { label: 'Agent programme', href: '/apply-agent' },
    ],
  },
  {
    title: 'Support',
    links: [
      { label: 'Contact support', href: 'mailto:support@carehub.ng' },
      { label: 'Reset password', href: '/forgot-password' },
    ],
  },
  {
    title: 'Authentication',
    links: [
      { label: 'Create account', href: '/register' },
      { label: 'Sign in', href: '/login' },
    ],
  },
  {
    title: 'Legal',
    // No policy pages exist in this repository yet. Rendered as unavailable
    // rather than as dead links — see the note above.
    soon: ['Privacy', 'Terms', 'Security'],
  },
]

export const SUPPORT_EMAIL = 'support@carehub.ng'
export const CAREFIND_URL = 'https://carefind.ng'
