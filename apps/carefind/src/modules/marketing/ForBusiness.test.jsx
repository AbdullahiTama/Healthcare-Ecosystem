import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ForBusiness from './ForBusiness.jsx'
import * as content from './landing/data/landingContent.js'

// This file is the regression net for the landing page's honesty rules and
// structure. The page this one replaced named six real Nigerian healthcare
// brands as "trusted partners", showed three invented patients with stock
// photographs, and claimed "thousands of patients" — none of which existed
// anywhere in the repository. Those are the kind of regressions that pass every
// other gate, so they get their own assertions.
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

function cardText(card) {
  return [
    card.name, card.body, card.role, card.price, card.venue, card.badge,
    ...(Array.isArray(card.meta) ? card.meta.map((m) => m.label) : [card.meta]),
  ].filter(Boolean)
}

// Every string a visitor can actually read on the page. Walks the exported
// content objects and collects their human-facing text.
const USER_FACING = [
  content.HERO.eyebrow, content.HERO.title, content.HERO.body,
  content.HERO.primary.label, content.HERO.secondary.label, content.HERO.photo.alt,
  content.PREVIEW.disclaimer,
  ...content.PREVIEW.cards.flatMap(cardText),
  ...content.FEATURE_STRIP.flatMap((f) => [f.title, f.body]),
  ...content.TRUST_STRIP.flatMap((t) => [t.title, t.body]),
  ...content.STEPS.flatMap((s) => [s.title, s.body]),
  content.CAPABILITIES.eyebrow, content.CAPABILITIES.title, content.CAPABILITIES.body,
  ...content.CAPABILITIES.items.flatMap((i) => [i.title, i.body]),
  content.FINAL_CTA.title, content.FINAL_CTA.body,
  content.FINAL_CTA.primary.label, content.FINAL_CTA.secondary.label,
  content.FOOTER.legal,
  ...content.FOOTER.columns.flatMap((c) => [c.title, ...c.links.map((l) => l.label)]),
  ...content.NAV_LINKS.map((l) => l.label),
].join(' \n ')

// Every route the landing page is allowed to link to. Anything else would
// dead-end on NotFound.
const REAL_ROUTES = new Set([
  '/', '/about', '/feed', '/login', '/search',
  '/search?tab=products', '/search?tab=businesses', '/search?tab=professionals',
  '/business-discovery', '/claim-business',
])

const FEATURE_TITLES = [
  'Ask questions', 'Connect with professionals', 'Find pharmacies',
  'Search medicines', 'Book appointments',
]

describe('ForBusiness — the public landing page at /', () => {
  describe('structure', () => {
    it('renders the hero headline, the primary action into the product, and the anchor action', () => {
      const { container } = renderLanding()
      const hero = within(container.querySelector('[data-section="hero"]'))

      expect(hero.getByRole('heading', { level: 1, name: content.HERO.title })).toBeInTheDocument()

      const primary = hero.getByRole('link', { name: /enter carefind/i })
      expect(primary).toHaveAttribute('href', content.HERO.primary.to)
      expect(content.HERO.primary.to).toBe('/feed')

      const secondary = hero.getByRole('link', { name: /see how it works/i })
      expect(secondary).toHaveAttribute('href', `#${content.HERO.secondary.anchor}`)
    })

    it('renders exactly the four short-page sections, in order', () => {
      const { container } = renderLanding()
      const main = container.querySelector('main')
      expect(main.querySelectorAll(':scope > section')).toHaveLength(4)
      expect(
        Array.from(main.querySelectorAll(':scope > section')).map((s) => s.dataset.section),
      ).toEqual(['hero', 'how-it-works', 'capabilities', 'final-cta'])
    })

    it('renders a licensed hero photograph with real alt text and a phone-sized source', () => {
      const { container } = renderLanding()
      const hero = container.querySelector('[data-section="hero"]')
      const img = hero.querySelector('img')
      expect(img).toHaveAttribute('src', content.HERO.photo.desktop)
      expect(img.getAttribute('alt')).toBeTruthy()
      expect(img.getAttribute('alt').length).toBeGreaterThan(20)
      const source = hero.querySelector('source')
      expect(source).toHaveAttribute('srcset', content.HERO.photo.mobile)
    })

    it('lists the five feature-strip capabilities by their exact titles', () => {
      const { container } = renderLanding()
      const hero = within(container.querySelector('[data-section="hero"]'))
      for (const title of FEATURE_TITLES) {
        expect(hero.getByText(title)).toBeInTheDocument()
      }
      expect(content.FEATURE_STRIP.map((f) => f.title)).toEqual(FEATURE_TITLES)
    })

    it('renders the three-item capability strip with no numbers anywhere in it', () => {
      const { container } = renderLanding()
      const hero = within(container.querySelector('[data-section="hero"]'))
      expect(content.TRUST_STRIP).toHaveLength(3)
      for (const item of content.TRUST_STRIP) {
        expect(hero.getByText(item.title)).toBeInTheDocument()
        expect(hero.getByText(item.body)).toBeInTheDocument()
        // No invented statistics: a digit would be a number a visitor could
        // read as a claim about CareFind's scale or ratings.
        expect(`${item.title}${item.body}`).not.toMatch(/\d/)
      }
    })

    it('renders the floating preview cards as a decorative, non-focusable group', () => {
      setViewportWidth(1440)
      const { container } = renderLanding()
      const hero = within(container.querySelector('[data-section="hero"]'))
      const cards = container.querySelectorAll('[data-section="hero"] article')
      expect(cards.length).toBeGreaterThanOrEqual(3)
      for (const card of cards) {
        const group = card.closest('[aria-hidden="true"]')
        expect(group, 'preview cards must sit inside an aria-hidden group').toBeTruthy()
      }
      // The visible disclaimer that stops the samples reading as live data.
      expect(hero.getByText(content.PREVIEW.disclaimer)).toBeInTheDocument()
    })

    it('shows three floating cards on desktop and on phones', () => {
      setViewportWidth(1440)
      const wide = renderLanding()
      const wideHero = wide.container.querySelector('[data-section="hero"]')
      expect(wideHero.querySelectorAll('article')).toHaveLength(3)
      wide.unmount()

      setViewportWidth(375)
      const narrow = renderLanding()
      const narrowHero = narrow.container.querySelector('[data-section="hero"]')
      expect(narrowHero.querySelectorAll('article')).toHaveLength(3)
      narrow.unmount()

      setViewportWidth(1440)
    })

    it('renders a primary nav with the logo, Get started and the menu button at every width', () => {
      for (const width of [375, 768, 1440]) {
        setViewportWidth(width)
        const { container, unmount } = renderLanding()
        const nav = within(container.querySelector('nav[aria-label="Primary"]'))
        expect(nav.getByRole('link', { name: 'CareFind home' })).toBeInTheDocument()
        expect(nav.getByRole('button', { name: 'Get started' })).toBeInTheDocument()
        expect(nav.getByRole('button', { name: 'Open menu' })).toBeInTheDocument()
        unmount()
      }
      setViewportWidth(1440)
    })

    it('keeps Sign in in the header only where both actions fit, and always in the menu', () => {
      setViewportWidth(1440)
      const wide = renderLanding()
      const wideNav = within(wide.container.querySelector('nav[aria-label="Primary"]'))
      expect(wideNav.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
      wide.unmount()

      setViewportWidth(375)
      const narrow = renderLanding()
      const narrowHeader = within(narrow.container.querySelector('header'))
      const narrowNav = within(narrow.container.querySelector('nav[aria-label="Primary"]'))
      expect(narrowNav.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()

      fireEvent.click(narrowNav.getByRole('button', { name: 'Open menu' }))
      // The panel is a sibling of the <nav>, not a child of it.
      expect(narrowHeader.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
      narrow.unmount()

      setViewportWidth(1440)
    })

    it('opens the menu with every link the content file declares, and closes on Escape', () => {
      setViewportWidth(1440)
      const { container } = renderLanding()
      const nav = within(container.querySelector('nav[aria-label="Primary"]'))

      fireEvent.click(nav.getByRole('button', { name: 'Open menu' }))
      const panel = container.querySelector('#landing-menu')
      expect(panel).toBeTruthy()
      for (const link of content.NAV_LINKS) {
        expect(within(panel).getByText(link.label)).toBeInTheDocument()
      }

      fireEvent.keyDown(document, { key: 'Escape' })
      expect(container.querySelector('#landing-menu')).toBeNull()
      expect(nav.getByRole('button', { name: 'Open menu' })).toBeInTheDocument()
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

    it('renders all four capability cards as links to real surfaces', () => {
      const { container } = renderLanding()
      const section = within(container.querySelector('[data-section="capabilities"]'))
      expect(content.CAPABILITIES.items).toHaveLength(4)
      for (const item of content.CAPABILITIES.items) {
        const link = section.getByRole('link', { name: new RegExp(item.title, 'i') })
        expect(link).toHaveAttribute('href', item.to)
        expect(section.getByText(item.body)).toBeInTheDocument()
      }
    })

    it('sends the closing call to action into the product', () => {
      const { container } = renderLanding()
      const cta = within(container.querySelector('[data-section="final-cta"]'))
      expect(cta.getByRole('link', { name: /enter carefind/i }))
        .toHaveAttribute('href', '/feed')
    })

    it('marks every illustrative preview as an example', () => {
      // The previews must never read as live posts, inventory or ratings.
      renderLanding()
      expect(screen.getAllByText(/illustrative/i).length).toBeGreaterThanOrEqual(1)
      expect(content.PREVIEW.disclaimer).toMatch(/illustrative/i)
    })
  })

  describe('link integrity — nothing may 404', () => {
    it('links only to routes that exist in main.jsx', () => {
      const routes = [
        ...content.NAV_LINKS,
        content.HERO.primary,
        ...content.CAPABILITIES.items,
        content.FINAL_CTA.primary, content.FINAL_CTA.secondary,
        ...content.FOOTER.columns.flatMap((c) => c.links),
      ].map((l) => l.to).filter(Boolean)

      expect(routes.length).toBeGreaterThanOrEqual(10)
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
      const anchors = [
        ...content.NAV_LINKS.filter((l) => l.anchor).map((l) => l.anchor),
        content.HERO.secondary.anchor,
      ]
      expect(anchors.length).toBeGreaterThanOrEqual(2)
      for (const anchor of anchors) {
        expect(document.getElementById(anchor), `#${anchor} has no target`).toBeTruthy()
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
      // The preview post is a labelled sample, not a testimonial.
      expect(content.PREVIEW.cards[0].badge).toMatch(/sample/i)
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
      const trustTitles = content.TRUST_STRIP.map((t) => t.title)
      expect(trustTitles).toContain('Verified professionals')
      expect(trustTitles).not.toContain('Verified providers')
      expect(USER_FACING).not.toContain('Verified businesses')
    })

    it('does not claim reviews require a verified visit', () => {
      // createReview is a plain INSERT from any signed-in user.
      expect(USER_FACING).not.toMatch(/verified visit/i)
    })

    it('does not claim live open/closed status', () => {
      // businesses.hours is a free-text string; no open-now computation exists.
      expect(USER_FACING).not.toMatch(/\bopen now\b|\bcurrently open\b|\bopen for (business|appointments)\b/i)
    })

    it('advertises only capabilities the codebase supports', () => {
      // Every capability card must resolve to a real, routed destination.
      for (const item of content.CAPABILITIES.items) {
        expect(REAL_ROUTES.has(item.to), `${item.id} → ${item.to}`).toBe(true)
      }
      expect(content.CAPABILITIES.items.map((i) => i.title))
        .toEqual(['Ask', 'Discover', 'Connect', 'Book'])
    })

    it('keeps the sample preview data explicitly labelled', () => {
      // Ratings, prices and engagement counts exist only inside PREVIEW, and
      // every card carries a badge saying so.
      for (const card of content.PREVIEW.cards) {
        expect(card.badge).toMatch(/sample|claimed/i)
      }
      expect(content.PREVIEW.disclaimer).toMatch(/not live data/i)
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
