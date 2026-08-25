// ALL copy/data for the CareHub landing page. Edit here, never in JSX.
//
// Every string is moved verbatim from the pre-rebuild Landing.jsx except the
// hero image (a curated photo, spec §6). Two things are deliberately ABSENT and
// must not be reinstated without real, attributable material behind them:
//
//   - TESTIMONIALS. The page carried three invented quotes with invented names,
//     roles and cities ("Adaeze Okafor, Superintendent Pharmacist, Lagos").
//   - The "Trusted by healthcare businesses across Nigeria" marquee, which
//     scrolled BUSINESS_TYPES — a list of categories the product supports, not
//     customers it has — under a headline claiming they were customers.
//
// See the CODE_AUDIT entry dated 2026-08-24.

export const LANDING = {
  nav: {
    links: [{ label: 'Features', target: '#features' }, { label: 'Pricing', target: '#pricing' }],
  },
  hero: {
    title: 'Run your healthcare business. Get found by patients.',
    body: 'Sales, inventory, staff and patient workflow in one calm, reliable platform — for pharmacies, hospitals, labs and clinics across Nigeria.',
    image: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=1920&q=80&auto=format&fit=crop',
    primary: { label: 'Get started free', to: '/register' },
    secondary: { label: 'See pricing', target: '#pricing' },
    chips: ['Free 14-day trial', 'Works offline', 'Role-based access'],
  },
  businessTypes: {
    caption: 'Built for every healthcare business',
  },
  features: {
    heading: {
      title: 'One platform for the counter, the storeroom and the books.',
      intro: 'Everything you need to run your healthcare business, from point-of-sale to patient discovery.',
    },
    // The first entry renders as the 2x2 feature card on desktop.
    primary: [
      { icon: 'ShoppingCart', title: 'Smart POS', desc: 'Cash, transfer, POS machine, split payment, credit sales and sales on hold in one streamlined interface.', span: true },
      { icon: 'Package', title: 'Inventory', desc: 'Stock levels, cost price, margins, Excel import and barcode scanning at your fingertips.' },
      { icon: 'BarChart2', title: 'Reports & analytics', desc: 'Revenue, expenses and profit breakdown with real-time dashboards exportable to Excel.' },
    ],
    secondary: [
      { icon: 'Users', title: 'Staff & roles' },
      { icon: 'Search', title: 'CareFind listing' },
      { icon: 'MapPin', title: 'Multi-location' },
      { icon: 'WifiOff', title: 'Works offline' },
    ],
  },
  steps: {
    heading: {
      title: 'Selling within the hour, not the week.',
      intro: 'Three steps to get your business online and selling.',
    },
    items: [
      { title: 'Register your business', desc: 'Pick your business type and set up your first location in under five minutes.' },
      { title: 'Add products or services', desc: 'Import via Excel or add them one by one with prices, stock levels, and reorder points.' },
      { title: 'Start selling', desc: 'Ring up sales at the POS while CareFind brings new patients to your door.' },
    ],
  },
  pricing: {
    heading: {
      title: 'Plain pricing in Naira',
      intro: 'Every plan includes POS, inventory, reports and your CareFind listing.',
    },
    plans: [
      { name: 'Basic', price: '10,000', period: '/month', items: ['Single location', 'Up to 5 staff', 'All core features'], popular: false },
      { name: 'Growth', price: '25,000', period: '/month', items: ['Up to 5 branches', 'Unlimited staff', 'Cross-branch reports'], popular: true },
      { name: 'Hospital', price: '35,000', period: '/month', items: ['Full hospital workflow', 'Lab & imaging', 'E-prescriptions'], popular: false },
      { name: 'Enterprise', price: '60,000', period: '/month', items: ['Unlimited locations', 'Large hospitals', 'Priority support'], popular: false },
    ],
    ctaTo: '/register',
  },
  referral: {
    eyebrow: 'EARN WHILE YOU INTRODUCE',
    title: 'Become a CareHub Referral Agent.',
    // Split so the two rate clauses can render inside <strong> without JSX here.
    bodyParts: [
      { text: 'Own one area. Earn ' },
      { text: '40% of the first payment', strong: true },
      { text: ' on every healthcare business you bring in, then ' },
      { text: '5% on every renewal', strong: true },
      { text: ' for as long as they stay. Real public in your neighbourhood, recurring income for you.' },
    ],
    cta: { label: 'Apply to cover your area', to: '/apply-agent' },
    bullets: ['Free to apply', 'No purchase needed', 'You keep your day job'],
  },
  cta: {
    title: 'Your patients are already searching on CareFind.',
    body: 'Register your business and be visible to thousands of patients looking for healthcare near them.',
    primary: { label: 'Get started free', to: '/register', variant: 'solid' },
  },
  footer: {
    brandLine: '© 2026 CareHub · Part of the Care ecosystem',
    // "CareFind" carries no `to`: it renders as plain text. The pre-rebuild
    // footer linked it to #carefind, a section that does not exist on the page.
    links: [
      { label: 'Features', to: '#features' },
      { label: 'Pricing', to: '#pricing' },
      { label: 'CareFind' },
      { label: 'support@carehub.ng', to: 'mailto:support@carehub.ng' },
    ],
  },
}
