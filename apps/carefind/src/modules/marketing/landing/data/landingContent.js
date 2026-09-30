// ─────────────────────────────────────────────────────────────────────────────
// CAREFIND LANDING — CONTENT
// ─────────────────────────────────────────────────────────────────────────────
// Every string, route and fixture the public landing page renders.
//
// HONESTY RULES ENFORCED HERE (docs/design/DESIGN_PRINCIPLES.md Principle 12 —
// "trust is a design output, not a marketing claim"):
//
//   1. No partner names. No customer counts. No testimonials. Nothing that
//      cannot be traced to a real capability in this repository.
//   2. No claim that a business is "verified" unless a DB column backs it.
//      `profiles.is_verified` is real for professionals; the business
//      "Verified on CareHub" chip in BusinessProfile.jsx is hard-coded and is
//      NOT restated here. The claim businesses can actually make is a
//      successful `business_claims` approval — so "claimed" is what we say.
//   3. No "verified visit" review claim. `createReview` is a plain INSERT from
//      any signed-in user; there is no booking or purchase gate. What is true,
//      and what we say, is that the reviewer's name and verification status are
//      shown alongside every review.
//   4. No "open now" claim. `businesses.hours` is a free-text string with no
//      open/closed computation anywhere in the codebase.
//   5. No usage statistics of any kind. The trust strip carries mechanisms,
//      not numbers — no counts, no ratings of CareFind itself.
//   6. Everything under PREVIEW and FIXTURES is illustrative example data for
//      the hero preview cards — not real listings, not real businesses, not
//      real ratings, not real posts. The card group renders PREVIEW.disclaimer
//      beneath it so a visitor is never misled about what they are looking at.
// ─────────────────────────────────────────────────────────────────────────────

// ── ROUTES (main.jsx is the source of truth; nothing here may 404) ──────────
export const ROUTES = {
  home: '/',
  about: '/about',
  search: '/search',
  searchProducts: '/search?tab=products',
  searchFacilities: '/search?tab=businesses',
  searchProfessionals: '/search?tab=professionals',
  discovery: '/business-discovery',
  claimBusiness: '/claim-business',
  login: '/login',
  feed: '/feed',
}

// ── NAVIGATION ───────────────────────────────────────────────────────────────
// Secondary navigation lives in the menu panel (the header itself carries only
// Sign in / Get started / Menu). `anchor` links scroll within the landing page;
// `to` routes through the router. Every `to` exists in main.jsx.
export const NAV_LINKS = [
  { label: 'About CareFind', to: ROUTES.about },
  { label: 'How CareFind works', anchor: 'how-it-works' },
  { label: 'Features', anchor: 'what-you-can-do' },
  { label: 'For healthcare professionals', to: ROUTES.searchProfessionals },
  { label: 'For healthcare businesses', to: ROUTES.claimBusiness },
]

// ── HERO ─────────────────────────────────────────────────────────────────────
export const HERO = {
  eyebrow: 'Healthcare discovery and community',
  title: 'Find the care you need, right where you are.',
  // The phrase rendered in the accent tint inside the headline — including the
  // trailing period, so the headline stays a text-node + span pair with no
  // trailing text node after the span (accessibility-tree name computation
  // inserts a space between an element and the text that follows it, which
  // would make the accessible name read "you are ."). Must be a substring of
  // `title`; Hero.jsx falls back to plain text if it is not.
  accent: 'right where you are.',
  // Medicines, facilities, reviews, direct contact — all real capabilities.
  body:
    'Search medicines, pharmacies, hospitals, clinics and laboratories near you. '
    + 'Compare what each one offers, read real reviews, and connect directly on '
    + 'WhatsApp or by phone.',
  // The one primary action of the page: into the product itself.
  primary: { label: 'Enter CareFind', to: ROUTES.feed },
  secondary: { label: 'See how it works', anchor: 'how-it-works' },
  photo: {
    // Served from public/; the small file is the srcset candidate for phones.
    desktop: '/images/hero-carefind.jpg',
    mobile: '/images/hero-carefind-sm.jpg',
    alt: 'A pharmacist hands a customer a box of medicine across the counter.',
  },
}

// ── HERO PREVIEW CARDS ───────────────────────────────────────────────────────
// The "floating ecosystem" cards. They are decorative: rendered aria-hidden
// and non-interactive so they can never take focus or block the headline, and
// labelled with a visible disclaimer so nothing here reads as live data.
//
// Names are deliberately generic sample names. Ratings, distances and prices
// restate the FIXTURES below, which are themselves illustrative.
export const PREVIEW = {
  disclaimer:
    'Illustrative sample of CareFind content — not live data.',
  cards: [
    {
      id: 'discussion',
      kind: 'discussion',
      badge: 'Sample post',
      avatar: 'KO',
      name: 'Dr. K. Okafor',
      role: 'Physician',
      body: 'What are the key things to consider when managing hypertension?',
      meta: [
        { icon: 'Heart', label: '124 likes' },
        { icon: 'MessageCircle', label: '28 comments' },
      ],
    },
    {
      id: 'provider',
      kind: 'provider',
      badge: 'Claimed profile',
      icon: 'Building2',
      name: 'Alake Community Pharmacy',
      meta: 'Pharmacy · 1.2km away',
      rating: { avg: 4.6, count: 128 },
    },
    {
      id: 'medicine',
      kind: 'medicine',
      badge: 'Sample listing',
      icon: 'Pill',
      name: 'Paracetamol 500mg',
      price: '₦1,200 / pack',
      meta: 'Alake Community Pharmacy · Lagos',
    },
    {
      id: 'booking',
      kind: 'booking',
      badge: 'Sample slot',
      icon: 'Calendar',
      name: 'Blood pressure check',
      meta: '15 min · ₦1,500',
      venue: 'Alake Community Pharmacy',
    },
  ],
}

// ── FEATURE STRIP (inside the hero) ──────────────────────────────────────────
// Five compact capabilities. Titles are fixed by the page brief; every body
// restates a capability the codebase already has.
export const FEATURE_STRIP = [
  {
    icon: 'MessageCircle',
    title: 'Ask questions',
    body: 'Health questions, answered by the CareFind community.',
  },
  {
    icon: 'Users',
    title: 'Connect with professionals',
    body: 'Verified professionals you can message or call.',
  },
  {
    icon: 'Store',
    title: 'Find pharmacies',
    body: 'Facilities near you, with distance and reviews.',
  },
  {
    icon: 'Pill',
    title: 'Search medicines',
    body: 'Sellers, prices and contact from one search.',
  },
  {
    icon: 'Calendar',
    title: 'Book appointments',
    body: 'Real slots from providers who accept bookings.',
  },
]

// ── TRUST / CAPABILITY STRIP (inside the hero) ───────────────────────────────
// Mechanisms, not statistics. No numbers appear in this strip — deliberately.
export const TRUST_STRIP = [
  {
    icon: 'Users',
    title: 'A healthcare community',
    body: 'Questions, answers and reviews from real accounts.',
  },
  {
    icon: 'BadgeCheck',
    title: 'Verified professionals',
    body: 'A real badge, issued to a real profile.',
  },
  {
    icon: 'Star',
    title: 'Reviews you can trace',
    body: 'Every review names its reviewer.',
  },
]

// ── HOW IT WORKS ─────────────────────────────────────────────────────────────
export const STEPS = [
  {
    id: 'search',
    title: 'Search',
    body:
      'Search a medicine by name, or browse facilities by state and distance. '
      + 'Filters narrow by category, price, sale type and stock.',
  },
  {
    id: 'compare',
    title: 'Compare',
    body:
      'Read ratings with a full star breakdown, browse the services and products a '
      + 'provider actually offers, and check opening hours before you set out.',
  },
  {
    id: 'connect',
    title: 'Connect',
    body:
      'Message on WhatsApp, call, get directions, or book an appointment and pay for '
      + 'it — all from the same profile.',
  },
]

// ── WHAT YOU CAN DO ──────────────────────────────────────────────────────────
// Four capabilities, each pointing at the real surface that performs it.
export const CAPABILITIES = {
  eyebrow: 'What you can do',
  title: 'Ask, discover, connect, book.',
  body:
    'Four things CareFind does today. Each card opens the screen that does the '
    + 'work — no waitlist, no demo.',
  items: [
    {
      id: 'ask',
      icon: 'MessageCircle',
      title: 'Ask',
      body: 'Post a health question and get answers from the CareFind community.',
      to: ROUTES.feed,
    },
    {
      id: 'discover',
      icon: 'Pill',
      title: 'Discover',
      body: 'Search medicines, pharmacies, hospitals, clinics and laboratories near you.',
      to: ROUTES.search,
    },
    {
      id: 'connect',
      icon: 'Phone',
      title: 'Connect',
      body: 'Message on WhatsApp or call a provider directly from their listing.',
      to: ROUTES.searchFacilities,
    },
    {
      id: 'book',
      icon: 'Calendar',
      title: 'Book',
      body: 'Find providers who accept appointments and book a real slot.',
      to: ROUTES.searchFacilities,
    },
  ],
}

// ── FINAL CTA ────────────────────────────────────────────────────────────────
export const FINAL_CTA = {
  title: 'Ready to find the care you need?',
  body:
    'Enter CareFind and search for a medicine, discover a provider near you, or '
    + 'join the conversation.',
  primary: { label: 'Enter CareFind', to: ROUTES.feed },
  // Auth-gated: RequireAuth redirects to /login, which is the correct behaviour
  // — a claim has to be tied to a signed-in account.
  secondary: { label: 'List your healthcare business', to: ROUTES.claimBusiness },
}

// ── FOOTER ───────────────────────────────────────────────────────────────────
// Only routes that exist in main.jsx. Support and Legal have no page yet, so
// they appear as plain text rather than links that 404.
export const FOOTER = {
  columns: [
    {
      title: 'Discover',
      links: [
        { label: 'Search everything', to: ROUTES.search },
        { label: 'Medicines', to: ROUTES.searchProducts },
        { label: 'Facilities', to: ROUTES.searchFacilities },
        { label: 'Professionals', to: ROUTES.searchProfessionals },
        { label: 'Near me', to: ROUTES.discovery },
      ],
    },
    {
      title: 'For providers',
      links: [
        { label: 'List your business', to: ROUTES.claimBusiness },
        { label: 'Sign in', to: ROUTES.login },
      ],
    },
    {
      title: 'Company',
      links: [
        { label: 'About CareFind', to: ROUTES.about },
        { label: 'Community feed', to: ROUTES.feed },
      ],
    },
    {
      title: 'Not available yet',
      // No page exists for these yet. Rendered as muted text, not links.
      links: [
        { label: 'Help & support', disabled: true },
        { label: 'Privacy policy', disabled: true },
        { label: 'Terms of service', disabled: true },
      ],
    },
  ],
  legal: 'CareFind is the public discovery platform of the CareHub ecosystem.',
}

// ── FIXTURES ─────────────────────────────────────────────────────────────────
// ILLUSTRATIVE EXAMPLE DATA — not real listings, businesses, prices or ratings.
// The values here back the PREVIEW cards above; names are deliberately generic
// so they cannot be mistaken for real businesses.

export const FIXTURES = {
  facilities: [
    {
      id: 'preview-facility-1',
      name: 'Alake Community Pharmacy',
      business_type: 'pharmacy',
      city: 'Lagos',
      state: 'Lagos',
      booking_enabled: true,
    },
    {
      id: 'preview-facility-2',
      name: 'Ikeja Diagnostics Centre',
      business_type: 'diagnostic centre',
      city: 'Ikeja',
      state: 'Lagos',
      booking_enabled: false,
    },
    {
      id: 'preview-facility-3',
      name: 'Yaba Primary Health Centre',
      business_type: 'primary healthcare centre',
      city: 'Yaba',
      state: 'Lagos',
      booking_enabled: true,
    },
  ],
  facilityDistances: {
    'preview-facility-1': '1.2km away',
    'preview-facility-2': '3.8km away',
    'preview-facility-3': '5.4km away',
  },
  products: [
    {
      id: 'preview-product-1',
      name: 'Paracetamol 500mg',
      generic_name: 'Paracetamol',
      category: 'Analgesic',
      sale_type: 'retail',
      price: 1200,
      price_unit: 'pack',
      business_id: 'preview-facility-1',
      show_price: true,
      whatsapp: '+2348012345678',
      businesses: {
        name: 'Alake Community Pharmacy',
        show_prices: true,
        whatsapp: '+2348012345678',
        phone: '+2348012345678',
      },
      seller_location: 'Lagos',
    },
  ],
  productDistance: '1.2km away',
}
