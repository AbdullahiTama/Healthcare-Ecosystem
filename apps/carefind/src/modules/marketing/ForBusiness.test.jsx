import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ForBusiness from './ForBusiness.jsx'
import * as content from './landing/data/landingContent.js'

// This file is the regression net for the landing redesign's honesty rules.
// The page it replaced named six real Nigerian healthcare brands as "trusted
// partners", showed three invented patients with stock photographs, and claimed
// "thousands of patients" — none of which existed anywhere in the repository.
// Those are the kind of regressions that pass every other gate, so they get
// their own assertions.
//
// The honesty assertions read the *exported content values*, not the file
// source. A source scan would also match the code comments that document these
// very rules, which is both noisy and the wrong thing to assert on — a comment
// is not a claim made to a visitor.

// useBreakpoint listens for `resize`, so a width change has to be paired with
// the event for the component to re-read it.
function setViewportWidth(width) {
  window.innerWidth = width
  window.dispatchEvent(new Event('resize'))
}

function renderLanding() {
  return render(
    <MemoryRouter>
      <ForBusiness />
    </MemoryRouter>,
  )
}

// Every string a visitor can actually read on the page. Walks the exported
// content objects and collects their human-facing text.
const USER_FACING = [
  content.HERO.eyebrow, content.HERO.title, content.HERO.body,
  content.HERO.primary.label, content.HERO.secondary.label, content.HERO.preview.disclaimer,
  content.SEARCH_SHOWCASE.eyebrow, content.SEARCH_SHOWCASE.title, content.SEARCH_SHOWCASE.body,
  ...content.SEARCH_SHOWCASE.points.flatMap((p) => [p.title, p.body]),
  ...content.FEATURES.flatMap((f) => [f.title, f.body]),
  ...content.CATEGORIES.map((c) => c.label),
  content.PROVIDER_SHOWCASE.eyebrow, content.PROVIDER_SHOWCASE.title, content.PROVIDER_SHOWCASE.body,
  content.PROVIDER_SHOWCASE.profile.name, content.PROVIDER_SHOWCASE.profile.about,
  ...content.PROVIDER_SHOWCASE.profile.services.map((s) => s.name),
  ...content.STEPS.flatMap((s) => [s.title, s.body]),
  content.TRUST.eyebrow, content.TRUST.title, content.TRUST.body,
  ...content.TRUST.items.flatMap((i) => [i.title, i.body]),
  content.FINAL_CTA.title, content.FINAL_CTA.body,
  content.FINAL_CTA.primary.label, content.FINAL_CTA.secondary.label,
  content.FOOTER.legal,
  ...content.FOOTER.columns.flatMap((c) => [c.title, ...c.links.map((l) => l.label)]),
  ...content.NAV_LINKS.map((l) => l.label),
].join(' \n ')

// Every route the landing page is allowed to link to. Anything else would
// dead-end on NotFound. The `?q=` variants are the category deep links, which
// /search now seeds its query from (healthcareRepository.searchBusinesses
// ilike-matches q against name, business_type, city and state).
const REAL_ROUTES = new Set([
  '/', '/about', '/feed', '/login', '/search',
  '/search?tab=products', '/search?tab=businesses', '/search?tab=professionals',
  '/business-discovery', '/claim-business',
  '/search?tab=businesses&q=pharmacy',
  '/search?tab=businesses&q=hospital',
  '/search?tab=businesses&q=clinic',
  '/search?tab=businesses&q=laboratory',
  '/search?tab=businesses&q=imaging',
  '/search?tab=businesses&q=dental',
  '/search?tab=businesses&q=optometry',
  '/search?tab=businesses&q=physiotherapy',
])

describe('ForBusiness — the public landing page at /', () => {
  describe('structure', () => {
    it('renders the hero headline and both calls to action', () => {
      const { container } = renderLanding()
      const hero = within(container.querySelector('[data-section="hero"]'))
      expect(hero.getByRole('heading', { level: 1, name: content.HERO.title })).toBeInTheDocument()
      expect(hero.getByRole('link', { name: content.HERO.primary.label })).toBeInTheDocument()
      expect(hero.getByRole('link', { name: content.HERO.secondary.label })).toBeInTheDocument()
    })

    it('renders all eight sections, each exactly once', () => {
      const { container } = renderLanding()
      const main = container.querySelector('main')
      expect(main.querySelectorAll(':scope > section')).toHaveLength(8)
      expect(
        Array.from(main.querySelectorAll(':scope > section')).map((s) => s.dataset.section),
      ).toEqual([
        'hero', 'search-showcase', 'features', 'ecosystem',
        'provider', 'how-it-works', 'trust', 'final-cta',
      ])
    })

    it('renders a primary nav with every link the content file declares', () => {
      setViewportWidth(1440)
      renderLanding()
      const nav = screen.getByRole('navigation', { name: 'Primary' })
      for (const link of content.NAV_LINKS) {
        expect(within(nav).getByText(link.label)).toBeInTheDocument()
      }
    })

    // The 768–1023px band is where a naive two-tier nav overflows: five links
    // plus two buttons need ~850px but only 728px are usable. The links collapse
    // to the menu button while the two primary actions stay visible.
    it('collapses the nav link row to a menu button below 1024px', () => {
      setViewportWidth(1023)
      const { container } = renderLanding()
      const nav = within(container.querySelector('nav[aria-label="Primary"]'))

      // Actions survive at tablet.
      expect(nav.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
      expect(nav.getByRole('button', { name: 'Get started' })).toBeInTheDocument()
      // The inline link row does not.
      for (const link of content.NAV_LINKS) {
        expect(nav.queryByText(link.label)).not.toBeInTheDocument()
      }
      // And the menu button is there to reach them.
      expect(nav.getByRole('button', { name: 'Open menu' })).toBeInTheDocument()
    })

    it('shows the full link row from 1024px up', () => {
      setViewportWidth(1280)
      const { container } = renderLanding()
      const nav = within(container.querySelector('nav[aria-label="Primary"]'))
      for (const link of content.NAV_LINKS) {
        expect(nav.getByText(link.label)).toBeInTheDocument()
      }
      expect(nav.queryByRole('button', { name: 'Open menu' })).not.toBeInTheDocument()
    })

    it('renders the three how-it-works stages', () => {
      const { container } = renderLanding()
      const section = within(container.querySelector('[data-section="how-it-works"]'))
      for (const step of content.STEPS) {
        expect(section.getByRole('heading', { level: 3, name: step.title })).toBeInTheDocument()
        // Every stage shows its body — nothing hidden behind a hover state.
        expect(section.getByText(step.body)).toBeInTheDocument()
      }
    })

    it('renders every healthcare category as a link', () => {
      const { container } = renderLanding()
      const section = within(container.querySelector('[data-section="ecosystem"]'))
      for (const category of content.CATEGORIES) {
        const link = section.getByRole('link', { name: new RegExp(category.label, 'i') })
        expect(link).toHaveAttribute('href', category.search)
      }
    })

    // A category tile that lands on an unfiltered tab is a broken promise: the
    // visitor asked for pharmacies and gets everything. Every facility tile
    // must carry the filter term.
    it('deep-links each facility category to a filtered result set', () => {
      for (const category of content.CATEGORIES) {
        if (category.id === 'medicines') {
          expect(category.search).toBe('/search?tab=products')
          continue
        }
        expect(category.search, `${category.id} carries no filter`).toMatch(/^[^?]+\?.*q=/)
      }
    })
  })

  describe('reuses the real product components', () => {
    it('shows the real CareFind search tabs inside the hero preview', () => {
      const { container } = renderLanding()
      const hero = within(container.querySelector('[data-section="hero"]'))
      const tablist = hero.getByRole('tablist', { name: /marketplace categories/i })
      expect(within(tablist).getAllByRole('tab').map((t) => t.textContent.trim()))
        .toEqual(['Shop', 'Products', 'Facilities', 'Professionals'])
    })

    it('shows real facility rows with distance and the booking action', () => {
      const { container } = renderLanding()
      const hero = within(container.querySelector('[data-section="hero"]'))
      for (const facility of content.FIXTURES.facilities) {
        expect(hero.getByText(facility.name)).toBeInTheDocument()
      }
      expect(hero.getByText(content.FIXTURES.facilityDistances['preview-facility-1'])).toBeInTheDocument()
      // FacilityCard's real primary actions.
      expect(hero.getAllByRole('link', { name: 'View Profile' })).toHaveLength(3)
      expect(hero.getAllByRole('button', { name: /book appointment/i })).toHaveLength(3)
    })

    it('shows a real medicine row with price, seller, distance and contact actions', () => {
      const { container } = renderLanding()
      const section = within(container.querySelector('[data-section="search-showcase"]'))
      expect(section.getByText('₦1,200')).toBeInTheDocument()
      expect(section.getByText(content.FIXTURES.productDistance)).toBeInTheDocument()
      // ProductResultCard's real contact row.
      expect(section.getByRole('link', { name: /whatsapp/i })).toBeInTheDocument()
      expect(section.getByRole('link', { name: /call/i })).toBeInTheDocument()
    })

    it('mirrors the real provider profile fields', () => {
      const { container } = renderLanding()
      const section = within(container.querySelector('[data-section="provider"]'))
      const p = content.PROVIDER_SHOWCASE.profile
      expect(section.getByRole('heading', { level: 3, name: p.name })).toBeInTheDocument()
      expect(section.getByText(p.distance)).toBeInTheDocument()
      expect(section.getByText(p.hours)).toBeInTheDocument()
      expect(section.getByText(`${p.rating.count} reviews`)).toBeInTheDocument()
      // A real rating must be exposed to assistive tech as text, never by shape.
      expect(section.getByRole('img', { name: `${p.rating.avg} out of 5` })).toBeInTheDocument()
      expect(section.getByRole('link', { name: 'Directions' })).toBeInTheDocument()
      expect(section.getByRole('link', { name: /book appointment/i })).toBeInTheDocument()
    })

    it('marks every illustrative preview as an example', () => {
      // The previews must never read as live inventory or real ratings.
      renderLanding()
      expect(screen.getAllByText(/illustrative/i).length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('link integrity — nothing may 404', () => {
    it('links only to routes that exist in main.jsx', () => {
      const routes = [
        ...content.NAV_LINKS,
        content.HERO.primary, content.HERO.secondary,
        ...content.FEATURES,
        ...content.CATEGORIES,
        content.FINAL_CTA.primary, content.FINAL_CTA.secondary,
        ...content.FOOTER.columns.flatMap((c) => c.links),
      ].map((l) => l.to).filter(Boolean)

      expect(routes.length).toBeGreaterThan(10)
      for (const route of routes) {
        expect(REAL_ROUTES.has(route), `"${route}" is not a real CareFind route`).toBe(true)
      }
    })

    it('renders not-yet-built pages as plain text rather than dead links', () => {
      const { container } = renderLanding()
      const footer = within(container.querySelector('footer'))
      for (const label of ['Privacy policy', 'Terms of service', 'Help & support']) {
        expect(footer.getByText(label)).toBeInTheDocument()
        expect(footer.queryByRole('link', { name: label })).not.toBeInTheDocument()
      }
    })

    it('gives every anchor navigation link a target that exists on the page', () => {
      renderLanding()
      for (const link of content.NAV_LINKS) {
        if (!link.anchor) continue
        expect(document.getElementById(link.anchor), `#${link.anchor} has no target`).toBeTruthy()
      }
    })
  })

  describe('honesty rules', () => {
    it('names no partner organisations', () => {
      for (const partner of [
        'Lagos State Hospital', 'MedPlus Pharmacy', 'Reddington Hospital',
        'HealthPlus', 'ecare Africa', 'ClinicPlus',
      ]) {
        expect(USER_FACING).not.toContain(partner)
      }
    })

    it('invents no testimonials or patient quotes', () => {
      for (const quote of ['Sarah K.', 'James M.', 'Amara O.', 'What patients are saying']) {
        expect(USER_FACING).not.toContain(quote)
      }
    })

    it('claims no user, provider or transaction counts', () => {
      expect(USER_FACING).not.toMatch(/thousands of/i)
      expect(USER_FACING).not.toMatch(/\b\d[\d,]*\+?\s*(patients|users|providers|downloads)\b/i)
    })

    it('never claims a business is verified', () => {
      // profiles.is_verified is real for professionals. The "Verified on CareHub"
      // chip in BusinessProfile.jsx is hard-coded with no column behind it, so
      // the landing page must not restate it for a business.
      expect(USER_FACING).not.toMatch(/verified on carehub/i)
      const titles = content.FEATURES.map((f) => f.title)
      expect(titles).toContain('Verified professionals')
      expect(titles).toContain('Claimed businesses')
      expect(titles).not.toContain('Verified providers')
    })

    it('does not claim reviews require a verified visit', () => {
      // createReview is a plain INSERT from any signed-in user.
      expect(USER_FACING).not.toMatch(/verified visit/i)
    })

    it('does not claim live open/closed status', () => {
      // businesses.hours is a free-text string; no open-now computation exists.
      // Matching on the assertions a claim would be phrased with, rather than
      // any mention of the word — "no guessing which pharmacy is open" is a
      // negation, not a claim.
      expect(USER_FACING).not.toMatch(/\bopen now\b|\bcurrently open\b|\bopen for (business|appointments)\b/i)
    })

    it('advertises only capabilities the codebase supports', () => {
      // Every feature cell must resolve to a real, routed destination.
      for (const feature of content.FEATURES) {
        expect(REAL_ROUTES.has(feature.to), `${feature.id} → ${feature.to}`).toBe(true)
      }
      expect(content.FEATURES).toHaveLength(6)
    })
  })

  describe('motion', () => {
    it('builds no GSAP context when the user prefers reduced motion', () => {
      const matchMedia = vi.fn().mockImplementation(() => ({
        matches: true, media: '', onchange: null,
        addListener: vi.fn(), removeListener: vi.fn(),
        addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
      }))
      const original = window.matchMedia
      window.matchMedia = matchMedia

      try {
        // Must render a finished, readable page — a reduced-motion user should
        // never be left looking at content stuck at opacity 0.
        const { container } = renderLanding()
        expect(
          within(container.querySelector('[data-section="hero"]'))
            .getByRole('heading', { level: 1, name: content.HERO.title }),
        ).toBeInTheDocument()
        expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
      } finally {
        window.matchMedia = original
      }
    })
  })
})
