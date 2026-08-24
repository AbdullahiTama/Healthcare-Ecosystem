// ALL copy/data for CareFind marketing pages. Edit here, never in JSX.

export const HOME = {
  nav: { links: [{ label: 'Features', target: '#features' }, { label: 'How it works', target: '#how-it-works' }, { label: 'About', target: '/about' }] },
  hero: {
    title: 'Find the care you need, right where you are.',
    body: 'Search medicines, compare pharmacies, read real reviews, and connect with healthcare providers near you — all in one place.',
    image: 'https://images.unsplash.com/photo-1581056771107-24ca5f033842?w=1920&q=80&auto=format&fit=crop',
    trustChips: ['Verified providers', 'Real patient reviews', 'Connect on WhatsApp'],
  },
  categories: {
    label: 'Categories of care on CareFind',
    items: ['Pharmacies', 'Hospitals', 'Laboratories', 'Imaging Centers', 'Skincare & Cosmetic Clinics', 'Wellness Providers'],
  },
  features: {
    heading: { eyebrow: 'Why CareFind', title: 'Everything you need to make informed health decisions.', intro: 'CareFind brings together every tool you need to navigate your health journey with confidence.' },
    items: [
      { icon: 'Search', title: 'Find care near you', desc: 'Search medicines, pharmacies, hospitals and labs in your area. Real listings, real locations.' },
      { icon: 'Star', title: 'Real patient reviews', desc: 'See what actual patients say before you choose. Every review comes from a verified visit.' },
      { icon: 'MessageCircle', title: 'Connect on WhatsApp', desc: 'Message providers directly. No extra app, no phone tag — just tap and talk.' },
      { icon: 'Shield', title: 'Verified providers', desc: 'Every business on CareFind is verified. Your health deserves nothing less.' },
    ],
  },
  steps: {
    heading: { eyebrow: 'How it works', title: 'Three steps to better care.', intro: 'Getting the care you need has never been simpler.' },
    items: [
      { title: 'Search', desc: 'Find the medicine, pharmacy, hospital or lab you need near you. Browse verified listings with detailed profiles.', image: 'https://images.unsplash.com/photo-1581056771107-24ca5f033842?w=800&q=80&auto=format&fit=crop' },
      { title: 'Compare', desc: 'Read reviews from real patients, check ratings, and compare options side by side before making a decision.', image: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=800&q=80&auto=format&fit=crop' },
      { title: 'Connect', desc: 'Message the provider on WhatsApp or visit them in person. Same-day care is just a few taps away.', image: 'https://images.unsplash.com/photo-1631217868264-e5b90bb7e133?w=800&q=80&auto=format&fit=crop' },
    ],
  },
  cta: {
    eyebrow: 'Start today',
    title: 'Ready to find the care you need?',
    body: 'Discover verified healthcare around you — medicines, pharmacies, hospitals and labs.',
    primary: { label: 'Start searching', to: '/search', variant: 'solid' },
    secondary: { label: 'Browse feed', to: '/feed', variant: 'ghost' },
  },
  footer: {
    brandLine: '© 2026 CareFind · Part of the Care ecosystem',
    links: [{ label: 'Feed', to: '/feed' }, { label: 'About', to: '/about' }, { label: 'For businesses', to: '/claim-business' }],
  },
}

export const ABOUT = {
  nav: { links: [{ label: 'Mission', target: '#mission' }, { label: 'Story', target: '#story' }, { label: 'Team', target: '#team' }] },
  // Sections below are moved VERBATIM from the previous About.jsx constants
  // (PILLARS, OFFERINGS, MILESTONES, FOUNDERS) during Task 4 — see Task 4 Step 3.
}
