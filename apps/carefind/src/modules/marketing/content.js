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

// Every string below was moved VERBATIM from the pre-rebuild About.jsx
// constants (PILLARS, OFFERINGS, MILESTONES, FOUNDERS) and its inline JSX copy.
// Zero new marketing copy was written for the rebuild.
export const ABOUT = {
  nav: { links: [{ label: 'Mission', target: '#mission' }, { label: 'Story', target: '#story' }, { label: 'Team', target: '#team' }] },
  hero: {
    badge: 'A healthcare social platform by HATMA Brandtech Limited',
    title: 'Connecting people to better healthcare.',
    body: 'CareFind was created with a simple but important realization: the healthcare system shouldn’t be this hard to navigate. Knowing what is available, where to find it, who to trust and how to connect with it should not require a search for a platform.',
    image: 'https://images.unsplash.com/photo-1551076805-e1869033e561?w=1920&q=80&auto=format&fit=crop',
    actions: {
      primary: { label: 'Read our story', target: '#story' },
      secondary: { label: 'Explore care near you', to: '/search' },
    },
    quickFacts: [
      { value: '2020', label: 'Where it began' },
      { value: '500+', label: 'Community members' },
      { value: '2024', label: 'Company founded' },
      { value: '1', label: 'One connected ecosystem' },
    ],
  },
  whyWeExist: {
    eyebrow: 'Why CareFind exists',
    title: 'Finding healthcare should not be difficult.',
    lead: 'Healthcare is one of the most essential parts of human life. Yet accessing the right healthcare product, service, professional, facility, information or support can be extremely difficult.',
    paragraphs: [
      'Whether someone is looking for a hospital, pharmacy, laboratory, diagnostic centre, medical professional, skincare and cosmetic provider, healthcare product, wellness service or another healthcare resource, the challenge is often the same: knowing what is available, where to find it, who to trust, and how to connect with it.',
      'For healthcare professionals, businesses and organizations, the challenge is just as significant — valuable expertise, products and services may exist within a community without ever being discoverable by the people who need them.',
    ],
    // Split so the emphasised clause can render inside <strong> without putting JSX in content.
    closing: {
      text: 'This is the gap CareFind was created to help bridge. Our purpose is one simple idea: ',
      emphasis: 'connecting people to better healthcare.',
    },
  },
  missionVision: {
    heading: {
      eyebrow: 'Mission & vision',
      title: 'CareFind was created for one reason',
      intro: 'To make it simple for everyone — patients, professionals, businesses — to find, understand and connect with the right healthcare.',
    },
    mission: {
      icon: 'Target',
      title: 'Our mission',
      body: 'To connect every person to healthcare they can trust — making it simple to discover the right product, service, professional or information, wherever they are, and to give healthcare professionals and businesses the visibility and tools they need to serve their communities well.',
    },
    vision: {
      icon: 'Eye',
      title: 'Our vision',
      body: 'A future where healthcare is never out of reach — where finding the right care is as simple as asking a question, where trust is built on real experience rather than guesswork, and where every healthcare professional, business and organization is as discoverable as the people who need them.',
    },
    goal: {
      label: 'Our goal: ',
      body: 'to grow CareFind into one of the most trusted and reputable healthcare platforms in the world — not the biggest for its own sake, but the one people turn to first, wherever in the world they are standing.',
    },
  },
  offerings: {
    heading: {
      eyebrow: 'What CareFind does',
      title: 'A healthcare social platform, not just a directory',
      intro: 'CareFind brings discovery, information, experience, connection and business together around the people who need them.',
    },
    items: [
      { icon: 'Star', title: 'Better-informed choices', body: 'Users share their experiences with products, facilities, professionals and services. Over time those experiences gather around each option, giving future patients a broader, real-world picture to consider. Transparency, layered on top of discovery.' },
      { icon: 'MessageCircle', title: 'More than a search', body: 'CareFind is a healthcare social platform, not simply a directory. People have questions, professionals have knowledge, organizations have services — all brought into one healthcare-focused social environment.' },
      { icon: 'Newspaper', title: 'Reliable healthcare information', body: 'A dedicated space for healthcare news and information, plus opportunities to learn from credible voices — helping useful information become easier to discover, not adding to the noise.' },
      { icon: 'Users', title: 'Empowering people behind healthcare', body: 'Doctors, pharmacists, nurses, hospitals, laboratories, wellness providers and healthcare businesses gain a digital presence where their expertise and services can reach the people who need them.' },
    ],
    note: {
      label: 'Smart business management. ',
      body: 'Beyond visibility, CareFind incorporates smart business and inventory management software — because a pharmacy or healthcare business may manage hundreds or thousands of products while dealing with stock, sales and day-to-day operations. CareFind doesn\'t only help people find healthcare; it helps healthcare businesses operate, connect and serve more effectively.',
    },
  },
  pillars: {
    heading: {
      eyebrow: 'Why we believe this matters',
      title: 'Healthcare is fragmented. It doesn\'t have to be.',
      intro: 'People often need one platform for a hospital, another for a pharmacy, another for a professional, another for information and another for business. CareFind is built around a different approach.',
    },
    items: [
      { icon: 'Compass', title: 'Discovery', desc: 'Hospitals, pharmacies, laboratories, professionals, products and services — without navigating a maze of disconnected platforms.' },
      { icon: 'Newspaper', title: 'Information', desc: 'Healthcare news, education and credible voices — so useful information is easier to find than noise.' },
      { icon: 'Star', title: 'Experience', desc: 'Real experiences shared by real users, giving future patients real-world context before they choose.' },
      { icon: 'HeartHandshake', title: 'Connection', desc: 'People with questions, professionals with knowledge, organizations with services — brought closer together.' },
      { icon: 'Building2', title: 'Business', desc: 'Smart business tools, so healthcare businesses can operate well and serve the communities around them.' },
    ],
  },
  story: {
    heading: {
      eyebrow: 'Our story',
      title: 'Where it all began: 2020, in the middle of a pandemic',
      intro: 'Movement was limited, cities went quiet, and people were told to stay indoors. But illness does not pause for a pandemic.',
    },
    milestones: [
      {
        year: '2020',
        title: 'The WhatsApp group',
        body: 'In Nigeria, in the middle of the COVID-19 pandemic, Pharmacist Haruna Abdullahi Tama created a WhatsApp group alongside Pharmacist Maryam Abdul Aziz, Pharmacist John Joseph and Rahanat Yusuf — dedicated to answering people’s healthcare questions when they had nowhere else to turn. It grew to over 500 members: doctors, pharmacists, nurses, medical laboratory scientists and university lecturers, giving their time and knowledge freely, hosting webinars and bringing clarity to a moment full of uncertainty.',
      },
      {
        year: '2024',
        title: 'HATMA Brandtech Limited',
        body: 'Goodwill alone could not scale. Haruna Abdullahi Tama founded HATMA Brandtech, beginning a journey into building real, lasting solutions. A team came together to learn, build and refine what would become CareFind — shaped by experience on the frontlines of hospital, community pharmacy, skincare and pharmaceutical marketing work.',
      },
      {
        year: '2026',
        title: 'CareFind arrives',
        body: 'Now, in 2026, that journey arrives at CareFind: the solution a small WhatsApp group in the middle of a pandemic first set out, in its own way, to build.',
      },
    ],
  },
  team: {
    heading: {
      eyebrow: 'The company',
      title: 'HATMA Brandtech and the people behind CareFind',
      intro: 'CareFind is a product of HATMA Brandtech Limited, founded by Haruna Abdullahi Tama in 2024, alongside a team of professionals united by a belief that technology should be used to solve meaningful, real-world problems.',
    },
    founders: [
      { initials: 'HT', name: 'Haruna Abdullahi Tama', role: 'Founder, HATMA Brandtech' },
      { initials: 'JJ', name: 'Pharmacist John Joseph', role: 'Chief Technology Officer' },
      { initials: 'MA', name: 'Maryam Abdul Aziz', role: 'HATMA Brandtech team' },
      { initials: 'UA', name: 'Unaisa Abdullahi', role: 'HATMA Brandtech team' },
      { initials: 'BZ', name: 'Bolu Zulaikha', role: 'HATMA Brandtech team' },
    ],
  },
  cta: {
    eyebrow: 'Where we are going',
    title: 'Our story is just beginning.',
    body: 'Healthcare should be easier to discover, people should have access to information and experiences that help them make informed choices, and the professionals and businesses behind healthcare should have better ways to connect with the communities they serve. CareFind brings these ambitions together under one platform and one purpose: connecting people to better healthcare.',
    primary: { label: 'Start searching', to: '/search', variant: 'solid' },
    secondary: { label: 'Browse the feed', to: '/feed', variant: 'ghost' },
  },
  footer: {
    brandLine: '© 2026 CareFind · A healthcare social platform by HATMA Brandtech Limited',
    links: [{ label: 'Home', to: '/' }, { label: 'About', to: '/about' }, { label: 'For businesses', to: '/claim-business' }],
  },
}
