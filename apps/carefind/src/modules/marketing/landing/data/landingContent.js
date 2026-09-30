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
//      successful `business_claims` approval — so that is what we say.
//   3. No "verified visit" review claim. `createReview` is a plain INSERT from
//      any signed-in user; there is no booking or purchase gate. What is true,
//      and what we say, is that the reviewer's name and verification status are
//      shown alongside every review.
//   4. No "open now" claim. `businesses.hours` is a free-text string with no
//      open/closed computation anywhere in the codebase.
//   5. Everything under FIXTURES is illustrative example data for the product
//      previews — not real listings, not real businesses, not real ratings.
//      The sections that render it are eyebrowed "Product preview" so a visitor
//      is never misled about what they are looking at.
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
// `anchor` links scroll within the landing page; `to` routes through the router.
export const NAV_LINKS = [
  { label: 'Discover', anchor: 'discover' },
  { label: 'Categories', anchor: 'categories' },
  { label: 'How it works', anchor: 'how-it-works' },
  { label: 'For providers', to: ROUTES.claimBusiness },
  { label: 'About', to: ROUTES.about },
]

// ── HERO ─────────────────────────────────────────────────────────────────────
export const HERO = {
  eyebrow: 'Healthcare discovery',
  title: 'Find trusted healthcare near you.',
  // Medicines, providers, locations, reviews, direct contact — all real.
  body:
    'Search medicines, pharmacies, hospitals, clinics and laboratories near you. '
    + 'Compare what each one offers, read what patients actually wrote, then reach '
    + 'the provider directly on WhatsApp or by phone.',
  primary: { label: 'Find care', to: ROUTES.search },
  secondary: { label: 'Explore providers', to: ROUTES.discovery },
  preview: {
    query: 'Paracetamol 500mg',
    location: 'Lagos',
    // Labels the UI so a visitor knows this is an illustration of the product,
    // not a claim about CareFind's own inventory or usage.
    disclaimer: 'Illustrative example of the CareFind search experience.',
  },
}

// ── SEARCH SHOWCASE ───────────────────────────────────────────────────────────
export const SEARCH_SHOWCASE = {
  eyebrow: 'Product preview',
  title: 'One search. Every answer you need.',
  body:
    'Type a medicine name and CareFind returns the listings that matter: who is '
    + 'selling it, how far away they are, what they charge, and how to reach them. '
    + 'No phone tag, no guessing which pharmacy is open.',
  // The three things a user actually decides on, in decision order.
  points: [
    {
      title: 'Who has it',
      body: 'Sellers matched by name and generic name, across pharmacies and businesses listing on CareFind.',
    },
    {
      title: 'How far away',
      body: 'Distance from your location, so a result you cannot travel to never outranks one you can.',
    },
    {
      title: 'How to reach them',
      body: 'A WhatsApp message or a phone call opens straight from the result. No extra app, no phone tag.',
    },
  ],
}

// ── DISCOVERY FEATURES (bento) ───────────────────────────────────────────────
// Capability claims only. Each maps to code that exists today.
export const FEATURES = [
  {
    id: 'medicines',
    icon: 'Pill',
    title: 'Find medicines',
    body:
      'Search by brand or generic name. Sellers, stock, price or "ask for price" '
      + 'when a pharmacy hides its pricing — your choice, not ours.',
    to: ROUTES.searchProducts,
  },
  {
    id: 'professionals',
    icon: 'BadgeCheck',
    title: 'Verified professionals',
    body:
      'Doctors, pharmacists, laboratory scientists and other professionals carry a '
      + 'real verification badge, along with the specialty or role they were verified for.',
    to: ROUTES.searchProfessionals,
  },
  {
    id: 'businesses',
    icon: 'Building2',
    title: 'Claimed businesses',
    body:
      'Healthcare businesses can claim their CareFind listing and have it reviewed. '
      + 'A successful claim is how you know who is behind the profile.',
    to: ROUTES.claimBusiness,
  },
  {
    id: 'reviews',
    icon: 'Star',
    title: 'Reviews you can trace',
    body:
      'Ratings come with a full breakdown, and every review shows the reviewer\'s name '
      + 'and verification status — so you can see who is speaking, not just what they said.',
    to: ROUTES.searchFacilities,
  },
  {
    id: 'contact',
    icon: 'MessageCircle',
    title: 'Message or call directly',
    body:
      'Contact buttons sit on the search result itself. Send a WhatsApp message with '
      + 'the item pre-filled, or call the provider straight away.',
    to: ROUTES.search,
  },
  {
    id: 'appointments',
    icon: 'Calendar',
    title: 'Book and pay',
    body:
      'Providers who accept appointments publish real bookable slots. Pay by card or '
      + 'with CareCoin balance, and look the booking up later with your phone number.',
    to: ROUTES.discovery,
  },
]

// ── ECOSYSTEM CATEGORIES ─────────────────────────────────────────────────────
// Every entry is a real category: the 28-row `business_categories` table
// (verified live 2026-09-29) plus the medicine/product search surface.
//
// Where each tile points, and why:
//   * Facility tiles go to /search?tab=businesses&q=<business_type>.
//     `businesses` is the populated table (28 rows, 23 visible on CareFind) and
//     `healthcareRepository.searchBusinesses` already ilike-matches `q` against
//     name, business_type, city and state — so this is a real filtered result
//     set, not a decorative link.
//   * Medicines goes to /search?tab=products, which searches the `products`
//     table directly.
//
// They deliberately do NOT point at /business-discovery?category=<uuid>.
// That route exists and reads ?category=, but it queries `business_directory`,
// which is EMPTY (0 rows, verified live 2026-09-29) — so a category-filtered
// link there would always render "0 businesses found". A link that reliably
// returns nothing is worse than a link to an unfiltered but populated list.
export const CATEGORIES = [
  { id: 'pharmacy', label: 'Pharmacies', icon: 'Pill', search: `${ROUTES.searchFacilities}&q=pharmacy` },
  { id: 'hospital', label: 'Hospitals', icon: 'Hospital', search: `${ROUTES.searchFacilities}&q=hospital` },
  { id: 'clinic', label: 'Clinics', icon: 'Stethoscope', search: `${ROUTES.searchFacilities}&q=clinic` },
  { id: 'laboratory', label: 'Laboratories', icon: 'FlaskConical', search: `${ROUTES.searchFacilities}&q=laboratory` },
  { id: 'imaging', label: 'Imaging & Radiology', icon: 'Scan', search: `${ROUTES.searchFacilities}&q=imaging` },
  { id: 'dental', label: 'Dental', icon: 'Smile', search: `${ROUTES.searchFacilities}&q=dental` },
  { id: 'optical', label: 'Eye & Optometry', icon: 'Eye', search: `${ROUTES.searchFacilities}&q=optometry` },
  { id: 'physiotherapy', label: 'Physiotherapy', icon: 'Activity', search: `${ROUTES.searchFacilities}&q=physiotherapy` },
  { id: 'medicines', label: 'Medicines', icon: 'ShoppingBag', search: ROUTES.searchProducts },
]

// ── PROVIDER PROFILE SHOWCASE ────────────────────────────────────────────────
// Field-for-field the real BusinessProfile.jsx surface. Values are illustrative.
export const PROVIDER_SHOWCASE = {
  eyebrow: 'Product preview',
  title: 'Everything about a provider, on one page.',
  body:
    'A CareFind profile puts the decision in front of you before you travel: what it '
    + 'is, where it is, how patients rated it, what it treats or sells, and how to '
    + 'reach it. Booking opens on the same page when the provider accepts appointments.',
  profile: {
    name: 'Alake Community Pharmacy',
    businessType: 'pharmacy',
    typeLabel: 'Pharmacy',
    city: 'Lagos',
    state: 'Lagos',
    distance: '1.2km away',
    hours: 'Mon–Sat, 8:00am – 8:00pm',
    rating: { avg: 4.6, count: 128 },
    about:
      'Neighbourhood pharmacy dispensing prescription and over-the-counter medicines, '
      + 'with home delivery within the surrounding areas.',
    services: [
      { name: 'Prescription dispensing', duration: null, price: null },
      { name: 'Blood pressure check', duration: 15, price: 1500 },
      { name: 'Home delivery', duration: null, price: null },
    ],
    bookingEnabled: true,
    whatsapp: '+2348012345678',
    phone: '+2348012345678',
  },
}

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

// ── TRUST ────────────────────────────────────────────────────────────────────
// Five capabilities, each stated as a mechanism a user can verify themselves.
// No partner names, no counts, no ratings of CareFind itself.
export const TRUST = {
  eyebrow: 'Why CareFind',
  title: 'Trust you can check, not trust you are asked for.',
  body:
    'None of this is a badge we print on ourselves. Each item below is something you '
    + 'can see and check on any listing before you commit.',
  items: [
    {
      icon: 'BadgeCheck',
      title: 'Professionals carry a real verification badge',
      body: 'A verified professional shows their badge and the role they were verified for. Unverified accounts show no badge at all.',
    },
    {
      icon: 'Store',
      title: 'Businesses claim the profile they own',
      body: 'A pharmacy, clinic or lab that manages its own CareFind listing has been through a business claim review.',
    },
    {
      icon: 'Star',
      title: 'Reviews name the reviewer',
      body: 'Every review shows who wrote it and whether that account is verified, alongside a full rating breakdown.',
    },
    {
      icon: 'MapPin',
      title: 'Discovery is location-aware',
      body: 'Radius search across states and local government areas sorts what is genuinely reachable ahead of what is merely listed.',
    },
    {
      icon: 'Lock',
      title: 'Transactions are handled, not improvised',
      body: 'Card payments run through a verified payment callback, and CareCoin balance is checked before it is spent.',
    },
  ],
}

// ── FINAL CTA ────────────────────────────────────────────────────────────────
export const FINAL_CTA = {
  title: 'Your next healthcare decision starts here.',
  body:
    'Search for a medicine, find a provider near you, or put your business in front '
    + 'of the people already looking for it.',
  primary: { label: 'Find care', to: ROUTES.search },
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
// Used only inside sections eyebrowed "Product preview" to show what the real
// CareFind components render. Names are deliberately generic so they are not
// mistaken for real businesses.

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
      // sellerContact() reads product.whatsapp then businesses.whatsapp;
      // sellerPhone() reads businesses.phone. Without these the real
      // ProductResultCard renders no contact row at all, which would hide the
      // single most important thing a medicine search result offers.
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
