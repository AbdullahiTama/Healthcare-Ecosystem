# CareFind Landing Premium Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild CareFind's two marketing surfaces (`/` and `/about`) on extracted marketing primitives at premium quality — curated imagery treatment, disciplined type scale, reduced-motion support, keyboard accessibility, render tests — cutting fabricated social proof.

**Architecture:** `src/modules/marketing/` gains reusable primitives (nav, footer, marquee, section heading, CTA band, reveal hook) plus `content.js` holding all copy/data. Pages become thin compositions. Cross-app sharing deliberately rejected (spec §4).

**Tech Stack:** React 18 + Vite SPA, inline styles against design-system theme tokens, GSAP + ScrollTrigger (existing deps), Vitest + Testing Library (existing devDeps), lucide-react.

**Spec:** `docs/superpowers/specs/2026-08-24-landing-pages-premium-design.md`

## Global Constraints

- No new runtime dependencies.
- All colors/radii/motion from `theme` (`apps/carefind/src/styles/theme.js`). Hardcoded values allowed only: `#fff` on dark surfaces, rgba() white overlays on dark, and the DUOTONE recipe below.
- Every animation gated behind `prefers-reduced-motion`.
- Inline `style={}` objects only — no CSS files (roadmap §5.1).
- Text contrast >= 4.5:1 (white text over DUOTONE overlay satisfies).
- Run tests/build from `apps/carefind`: `npm test`, `npm run build`. Full suite must stay green.
- One commit per task. Route paths unchanged (`/`, `/about`).
- Test note: `@testing-library/user-event` is NOT installed — use `fireEvent` from `@testing-library/react`. jsdom setup already mocks matchMedia/IntersectionObserver/ResizeObserver (`src/test/setup.js`); page-level render tests set `matchMedia` to report reduced-motion so GSAP/ScrollTrigger never initialize under test (asserted in Task 6).

---

### Task 1: Marketing foundation — type tokens, reveal hook, SectionHeading, Marquee

**Files:**
- Create: `apps/carefind/src/modules/marketing/components/tokens.js`
- Create: `apps/carefind/src/modules/marketing/components/useRevealOnScroll.js`
- Create: `apps/carefind/src/modules/marketing/components/SectionHeading.jsx`
- Create: `apps/carefind/src/modules/marketing/components/Marquee.jsx`
- Test: `apps/carefind/src/modules/marketing/components/marketing.test.jsx`

**Interfaces:**
- Consumes: `theme` from `../../styles/theme`.
- Produces (Tasks 3-5 depend on these):
  - `TYPE.displayXL | displayL | displayM | lead` — clamp() font-size strings.
  - `DUOTONE` — standard photo overlay gradient string.
  - `prefersReducedMotion()` -> boolean.
  - `useRevealOnScroll(scopeRef, { selector = "[data-reveal]", y = 30 })` — no-op under reduced motion.
  - `<SectionHeading eyebrow title intro dark />`; `<Marquee items label speed />` (items: string[]).

- [ ] **Step 1: Write failing tests**

Create `apps/carefind/src/modules/marketing/components/marketing.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SectionHeading from './SectionHeading'
import Marquee from './Marquee'

export const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('SectionHeading', () => {
  it('renders eyebrow, title and optional intro', () => {
    wrap(<SectionHeading eyebrow="Mission" title="Built for one reason" intro="To connect people." />)
    expect(screen.getByText('Mission')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Built for one reason' })).toBeInTheDocument()
    expect(screen.getByText('To connect people.')).toBeInTheDocument()
  })

  it('omits intro paragraph when not provided', () => {
    wrap(<SectionHeading eyebrow="Team" title="The people" />)
    expect(screen.queryByText('Mission')).not.toBeInTheDocument()
  })
})

describe('Marquee', () => {
  it('renders items twice with the duplicate aria-hidden', () => {
    wrap(<Marquee items={['Pharmacies', 'Hospitals']} label="What you can find" />)
    const copies = screen.getAllByText('Pharmacies')
    expect(copies).toHaveLength(2)
    expect(copies[1].closest('[aria-hidden="true"]')).not.toBeNull()
    expect(screen.getByLabelText('What you can find')).toBeInTheDocument()
  })
})
```

(The `wrap` helper export is reused by later tasks appended to this file.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/modules/marketing/components/marketing.test.jsx`
Expected: FAIL — cannot resolve `./SectionHeading` / `./Marquee`.

- [ ] **Step 3: Implement the four files**

`tokens.js`:

```js
import { theme } from '../../../styles/theme'

// Shared display scale for all CareFind marketing pages (spec section 3).
export const TYPE = {
  displayXL: 'clamp(2.6rem, 5.5vw, 4.5rem)',
  displayL: 'clamp(1.9rem, 3.6vw, 2.75rem)',
  displayM: 'clamp(1.4rem, 2.6vw, 1.9rem)',
  lead: 'clamp(0.95rem, 1.4vw, 1.0625rem)',
}

// Standard art-directed photo treatment (spec section 3): one recipe, every photo.
export const DUOTONE =
  'linear-gradient(180deg, rgba(11,74,62,0.55) 0%, rgba(11,74,62,0.85) 100%)'

export { prefersReducedMotion } from './useRevealOnScroll'
export { theme }
```

`useRevealOnScroll.js`:

```js
import { useEffect } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

export function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
}

// Canonical reveal-on-scroll for marketing pages. No-op when the user prefers
// reduced motion — content simply renders in place (About.jsx precedent).
export function useRevealOnScroll(scopeRef, { selector = '[data-reveal]', y = 30 } = {}) {
  useEffect(() => {
    if (!scopeRef.current || prefersReducedMotion()) return undefined
    const ctx = gsap.context(() => {
      gsap.utils.toArray(selector).forEach((el) => {
        gsap.from(el, {
          y, opacity: 0, duration: 0.8, ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 88%' },
        })
      })
    }, scopeRef)
    return () => ctx.revert()
  }, [scopeRef, selector, y])
}
```

`SectionHeading.jsx`:

```jsx
import { theme } from '../../../styles/theme'

const { tealDeep, textDark, textMid } = theme

// Eyebrow + title + intro block used above every marketing section.
export default function SectionHeading({ eyebrow, title, intro, dark = false }) {
  return (
    <div data-reveal style={{ maxWidth: 640, margin: '0 auto 44px', textAlign: 'center' }}>
      <div style={{
        fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase',
        color: dark ? 'rgba(255,255,255,0.65)' : tealDeep, marginBottom: 12,
      }}>
        {eyebrow}
      </div>
      <h2 style={{
        fontFamily: theme.fontDisplay, fontWeight: 900,
        fontSize: 'clamp(1.7rem, 3.2vw, 2.6rem)', lineHeight: 1.15, letterSpacing: '-0.02em',
        color: dark ? '#fff' : textDark, margin: '0 0 14px',
      }}>
        {title}
      </h2>
      {intro && (
        <p style={{ fontSize: 15, color: dark ? 'rgba(255,255,255,0.8)' : textMid, lineHeight: 1.7, margin: 0 }}>
          {intro}
        </p>
      )}
    </div>
  )
}
```

`Marquee.jsx`:

```jsx
import { theme } from '../../../styles/theme'

const { textLight } = theme

// Infinite horizontal marquee. Duplicated list is aria-hidden; accessible name
// comes from `label` so screen readers hear one copy. Reduced motion stops it.
export default function Marquee({ items = [], label, speed = 30 }) {
  return (
    <div role="group" aria-label={label} style={{ overflow: 'hidden', padding: '8px 0' }}>
      <style>{`
        @keyframes cf-marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        .cf-marquee-track { animation: cf-marquee ${speed}s linear infinite; }
        .cf-marquee-track:hover { animation-play-state: paused; }
        @media (prefers-reduced-motion: reduce) { .cf-marquee-track { animation: none; } }
      `}</style>
      <div style={{
        display: 'flex', overflow: 'hidden',
        maskImage: 'linear-gradient(90deg, transparent 0%, black 8%, black 92%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(90deg, transparent 0%, black 8%, black 92%, transparent 100%)',
      }}>
        {[false, true].map((hidden) => (
          <div key={hidden} className="cf-marquee-track" aria-hidden={hidden || undefined}
            style={{ display: 'flex', gap: 48, flexShrink: 0, padding: '0 24px' }}>
            {items.map((item) => (
              <span key={item} style={{ flexShrink: 0, fontSize: 14, fontWeight: 700, color: textLight, letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
                {item}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/modules/marketing/components/marketing.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/carefind/src/modules/marketing/components
git commit -m "feat(carefind): marketing type tokens, reveal hook, SectionHeading and Marquee primitives"
```

---

### Task 2: LandingNav, SiteFooter, CtaBand primitives

**Files:**
- Create: `apps/carefind/src/modules/marketing/components/LandingNav.jsx`
- Create: `apps/carefind/src/modules/marketing/components/SiteFooter.jsx`
- Create: `apps/carefind/src/modules/marketing/components/CtaBand.jsx`
- Test: append to `apps/carefind/src/modules/marketing/components/marketing.test.jsx`

**Interfaces:**
- Consumes: `theme`; `Logo` from `../../social-feed/Logo.jsx` (props `{ size, tone: 'light'|'dark'|'muted', markOnly }`); `useBreakpoint` from `../../../hooks/useBreakpoint` returning `{ isMobile }`.
- Produces:
  - `<LandingNav links signInTo getStartedTo getStartedLabel />` — `links: [{ label, target }]`; `target` starting with `#` renders an anchor that smooth-scrolls; otherwise a router Link.
  - `<SiteFooter brandLine links />` — `links: [{ label, to }]` (`#...` targets render as anchors).
  - `<CtaBand eyebrow title body primary secondary />` — primary/secondary: `{ label, to, variant: 'solid'|'ghost' }`, rendered as router Links.

- [ ] **Step 1: Write failing tests**

Append to `marketing.test.jsx`:

```jsx
import { fireEvent } from '@testing-library/react'
import LandingNav from './LandingNav'
import SiteFooter from './SiteFooter'
import CtaBand from './CtaBand'

describe('LandingNav', () => {
  it('renders anchor links and both action buttons', () => {
    wrap(
      <LandingNav
        links={[{ label: 'Features', target: '#features' }, { label: 'About', target: '/about' }]}
        signInTo="/login"
        getStartedTo="/search"
      />,
    )
    expect(screen.getByRole('link', { name: 'Features' })).toHaveAttribute('href', '#features')
    expect(screen.getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Get started' })).toBeInTheDocument()
  })

  it('navigates to getStartedTo when Get started is clicked', () => {
    wrap(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<LandingNav links={[]} signInTo="/login" getStartedTo="/search" />} />
          <Route path="/search" element={<div>search page marker</div>} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }))
    expect(screen.getByText('search page marker')).toBeInTheDocument()
  })

  it('renders as a banner landmark', () => {
    wrap(<LandingNav links={[]} signInTo="/login" getStartedTo="/search" />)
    expect(screen.getByRole('banner')).toBeInTheDocument()
  })
})

describe('SiteFooter', () => {
  it('renders brand line and links inside a contentinfo landmark', () => {
    wrap(
      <SiteFooter
        brandLine="(c) 2026 CareFind"
        links={[{ label: 'About', to: '/about' }, { label: 'Top', to: '#top' }]}
      />,
    )
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    expect(screen.getByText('(c) 2026 CareFind')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about')
    expect(screen.getByRole('link', { name: 'Top' })).toHaveAttribute('href', '#top')
  })
})

describe('CtaBand', () => {
  it('renders title, body and both actions as links', () => {
    wrap(
      <CtaBand
        title="Ready to find care?"
        body="Join thousands."
        primary={{ label: 'Start searching', to: '/search', variant: 'solid' }}
        secondary={{ label: 'Browse feed', to: '/feed', variant: 'ghost' }}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Ready to find care?' })).toBeInTheDocument()
    expect(screen.getByText('Join thousands.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start searching' })).toHaveAttribute('href', '/search')
    expect(screen.getByRole('link', { name: 'Browse feed' })).toHaveAttribute('href', '/feed')
  })
})
```

Update the react-router import at the top of the file to include Routes and Route.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/modules/marketing/components/marketing.test.jsx`
Expected: FAIL — cannot resolve `./LandingNav` / `./SiteFooter` / `./CtaBand`.

- [ ] **Step 3: Implement the three components**

`LandingNav.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { theme } from '../../../styles/theme'
import { useBreakpoint } from '../../../hooks/useBreakpoint'
import Logo from '../../social-feed/Logo.jsx'

const { navy, border } = theme

// Glass pill nav shared by marketing pages. Anchor targets smooth-scroll,
// route targets navigate. Turns solid after 80px of scroll (plain scroll
// listener — no ScrollTrigger needed for this).
export default function LandingNav({
  links = [], signInTo = '/login', getStartedTo = '/search', getStartedLabel = 'Get started',
}) {
  const navigate = useNavigate()
  const { isMobile } = useBreakpoint()
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const renderTarget = ({ label, target }) => (
    target.startsWith('#') ? (
      <a key={label} href={target}
        onClick={(e) => { e.preventDefault(); document.getElementById(target.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
        style={{ padding: '6px 14px', fontSize: 13, fontWeight: 600, color: scrolled ? navy : '#fff', opacity: 0.85, textDecoration: 'none' }}>
        {label}
      </a>
    ) : (
      <Link key={label} to={target}
        style={{ padding: '6px 14px', fontSize: 13, fontWeight: 600, color: scrolled ? navy : '#fff', opacity: 0.85, textDecoration: 'none' }}>
        {label}
      </Link>
    )
  )

  return (
    <nav role="banner" style={{
      position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
      background: scrolled ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.08)',
      backdropFilter: scrolled ? 'blur(16px)' : 'blur(0px)',
      borderRadius: 60, padding: '8px 10px 8px 20px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      zIndex: 100, width: isMobile ? 'calc(100% - 24px)' : 720,
      border: `1px solid ${scrolled ? border : 'rgba(255,255,255,0.15)'}`,
      transition: 'background 0.3s ease',
    }}>
      <Link to="/" aria-label="CareFind home" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center' }}>
        <Logo size={24} tone={isMobile || scrolled ? 'dark' : 'light'} />
      </Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {!isMobile && links.map(renderTarget)}
        <button onClick={() => navigate(signInTo)} style={{
          padding: '8px 16px', borderRadius: 40, cursor: 'pointer', fontFamily: 'inherit',
          border: `1px solid ${scrolled ? border : 'rgba(255,255,255,0.3)'}`,
          background: 'transparent', color: scrolled ? navy : '#fff', fontWeight: 600, fontSize: 13,
        }}>
          Sign in
        </button>
        <button onClick={() => navigate(getStartedTo)} style={{
          padding: '8px 18px', borderRadius: 40, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          background: '#fff', color: navy, fontWeight: 700, fontSize: 13,
        }}>
          {getStartedLabel}
        </button>
      </div>
    </nav>
  )
}
```

Note: `role="banner"` on `<nav>` is intentional here because the nav sits outside `<header>` in page compositions; if a task wraps it in `<header>`, drop the explicit role.

`SiteFooter.jsx`:

```jsx
import { Link } from 'react-router-dom'
import Logo from '../../social-feed/Logo.jsx'

// Footer for marketing pages. `#...` link targets render as plain anchors.
export default function SiteFooter({ brandLine, links = [] }) {
  return (
    <footer style={{
      padding: '32px 24px', maxWidth: 1100, margin: '0 auto',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      flexWrap: 'wrap', gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: theme.textLight }}>
        <Logo size={18} tone="dark" markOnly />
        <span>{brandLine}</span>
      </div>
      <div style={{ display: 'flex', gap: 20 }}>
        {links.map(({ label, to }) => (
          to.startsWith('#') ? (
            <a key={label} href={to} style={{ fontSize: 13, fontWeight: 600, color: theme.textMid, textDecoration: 'none' }}>{label}</a>
          ) : (
            <Link key={label} to={to} style={{ fontSize: 13, fontWeight: 600, color: theme.textMid, textDecoration: 'none' }}>{label}</Link>
          )
        ))}
      </div>
    </footer>
  )
}
```

(The file's full import block is: `Link` from react-router-dom, then `theme` from `'../../../styles/theme'`, then `Logo` from `'../../social-feed/Logo.jsx'` — in that order, at the top.)

`CtaBand.jsx`:

```jsx
import { Link } from 'react-router-dom'
import { theme } from '../../../styles/theme'
import { TYPE } from './tokens'

const { navy, navySoft, tealDeep } = theme

function Action({ action }) {
  const solid = action.variant !== 'ghost'
  return (
    <Link to={action.to} style={{
      padding: '16px 32px', borderRadius: 60, textDecoration: 'none',
      border: solid ? 'none' : '1px solid rgba(255,255,255,0.35)',
      background: solid ? '#fff' : 'rgba(255,255,255,0.08)',
      color: solid ? navy : '#fff', fontWeight: 800, fontSize: 15,
      display: 'inline-flex', alignItems: 'center', gap: 8,
    }}>
      {action.label}
    </Link>
  )
}

// Gradient call-to-action band closing every marketing page (spec section 5).
export default function CtaBand({ eyebrow, title, body, primary, secondary }) {
  return (
    <section data-reveal style={{ background: `linear-gradient(135deg, ${navy} 0%, ${navySoft} 55%, ${tealDeep} 100%)`, padding: '80px 24px', textAlign: 'center' }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        {eyebrow && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 14px', borderRadius: 40,
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
            fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.85)', marginBottom: 18,
          }}>
            {eyebrow}
          </div>
        )}
        <h2 style={{
          fontFamily: theme.fontDisplay, fontWeight: 900, fontSize: TYPE.displayL,
          letterSpacing: '-0.02em', color: '#fff', margin: '0 0 14px', lineHeight: 1.15,
        }}>
          {title}
        </h2>
        {body && <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.82)', lineHeight: 1.8, margin: '0 0 30px' }}>{body}</p>}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          {primary && <Action action={primary} />}
          {secondary && <Action action={secondary} />}
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/modules/marketing/components/marketing.test.jsx`
Expected: PASS (all tests including Task 1's).

- [ ] **Step 5: Commit**

```bash
git add apps/carefind/src/modules/marketing/components
git commit -m "feat(carefind): LandingNav, SiteFooter and CtaBand marketing primitives"
```

---

### Task 3: content.js + rebuilt Home page (route `/`) + main.jsx rename

**Files:**
- Create: `apps/carefind/src/modules/marketing/content.js`
- Create: `apps/carefind/src/modules/marketing/Home.jsx`
- Delete: `apps/carefind/src/modules/marketing/ForBusiness.jsx` (replaced by Home.jsx)
- Modify: `apps/carefind/src/main.jsx:35,53` — import/rename
- Modify: `apps/carefind/index.html` — add `<link rel="preconnect" href="https://images.unsplash.com" crossorigin />` before the module script (spec §6 performance)
- Test: `apps/carefind/src/modules/marketing/Home.test.jsx`

**Interfaces:**
- Consumes: all primitives from Tasks 1-2; `Logo` not needed directly.
- Produces:
  - `content.js` exports `HOME` and `ABOUT` plain objects holding every string/list both pages render. Later tasks and future copy edits touch ONLY this file.
  - `Home` default export composed of LandingNav / Marquee / SectionHeading / CtaBand / SiteFooter.

- [ ] **Step 1: Write failing tests**

Create `apps/carefind/src/modules/marketing/Home.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Home from './Home'

// Render under reduced-motion so GSAP/ScrollTrigger never initialize in jsdom;
// structural output is identical either way (hook no-ops).
beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
})

const renderHome = () => render(<MemoryRouter><Home /></MemoryRouter>)

describe('Home (CareFind landing)', () => {
  it('renders hero headline and both CTAs', () => {
    renderHome()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Find the care you need')
    // Hero AND closing CtaBand both offer these actions — assert existence, not uniqueness.
    expect(screen.getAllByRole('link', { name: 'Start searching' }).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByRole('link', { name: 'Browse feed' }).length).toBeGreaterThanOrEqual(1)
  })

  it('renders the true category strip, features and steps', () => {
    renderHome()
    expect(screen.getByLabelText(/categories of care/i)).toBeInTheDocument()
    // Marquee duplicates its track for the loop; assert one visible copy set.
    expect(screen.getAllByText('Pharmacies').length).toBe(2)
    expect(screen.getByRole('heading', { name: /make informed health decisions/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Search/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Compare/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Connect/i })).toBeInTheDocument()
  })

  it('does not render fabricated social proof', () => {
    renderHome()
    expect(screen.queryByText(/Sarah K\./)).not.toBeInTheDocument()
    expect(screen.queryByText(/Lagos State Hospital/)).not.toBeInTheDocument()
    expect(screen.queryByText(/MedPlus Pharmacy/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/modules/marketing/Home.test.jsx`
Expected: FAIL — cannot resolve `./Home`.

- [ ] **Step 3: Create content.js**

`apps/carefind/src/modules/marketing/content.js`:

```js
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
```

Icon mapping: feature items store lucide icon NAMES as strings; Home.jsx imports the icons statically and maps them locally:

In Home.jsx: `import { Search, Star, MessageCircle, Shield } from 'lucide-react'` and a local map `const FEATURE_ICONS = { Search, Star, MessageCircle, Shield }`.

- [ ] **Step 4: Create Home.jsx**

Full component structure (compose exactly this order):

```jsx
import { useRef, useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Search, Star, MessageCircle, Shield } from 'lucide-react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import LandingNav from './components/LandingNav'
import Marquee from './components/Marquee'
import SectionHeading from './components/SectionHeading'
import CtaBand from './components/CtaBand'
import SiteFooter from './components/SiteFooter'
import { TYPE, DUOTONE, prefersReducedMotion } from './components/tokens'
import { useRevealOnScroll } from './components/useRevealOnScroll'
import { HOME } from './content'

gsap.registerPlugin(ScrollTrigger)

const FEATURE_ICONS = { Search, Star, MessageCircle, Shield }
```

Complete implementation requirements (write these as real JSX, following ForBusiness.jsx as the visual base but with the changes listed):

1. `<main ref={pageRef}>` wrapper: `fontFamily: theme.fontFamily, background: theme.bg, color: theme.textDark, overflowX hidden`.
2. `<header>` wrapping `<LandingNav links={HOME.nav.links} signInTo="/login" getStartedTo="/search" />`.
3. **Hero section**: full-height div, `<img>` (not background-image) `src={HOME.hero.image}` absolutely positioned `objectFit: cover`, `fetchPriority="high"` attribute via `{...{ fetchpriority: 'high' }}`; overlay div with `background: DUOTONE`; content: h1 (`fontSize: TYPE.displayXL`, Lora 900, white), p (`TYPE.lead`), CTA row: primary Link `/search` white pill "Start searching" with ArrowRight, secondary Link `/feed` ghost "Browse feed"; trust chips row mapping `hero.trustChips` (white dots like old page).
4. **Hero entrance animation** in `useEffect`: if `prefersReducedMotion()` return; else gsap.from `[data-hero]` stagger. Mark h1/p/CTA row/chips with `data-hero`.
5. **Category strip**: `<Marquee items={HOME.categories.items} label={HOME.categories.label} />` inside a padded section with the small uppercase caption replaced BY the marquee label rendered visually-hidden? No — pass label as aria-label only; render visible caption `HOME.categories.label` above marquee at fontSize 11 uppercase letterSpacing .08em color textLight.
6. **Features section** id="features": `<SectionHeading {...HOME.features.heading} />` then grid 2 cols (1 col mobile): cards mapping items, `icon: FEATURE_ICONS[item.icon]`, card style per current FeatureCard (cardBg, radius.xl, border, padding 28).
7. **Steps section** id="how-it-works", background cardBg: `<SectionHeading {...HOME.steps.heading} />`. Desktop: horizontal accordion — buttons (not divs!) with `aria-expanded={active===i}`, `onMouseEnter` AND `onFocus` AND `onClick` set active; flex values 3/1 like current StepPanel; number badge, title, desc when active; each panel is `<button>` with textAlign left, border none, position relative overflow hidden, minHeight 320; inner image layer opacity .3 + gradient overlay. Mobile: stacked cards always showing desc (reuse same markup without flex animation).
8. **CTA band**: `<CtaBand {...HOME.cta} />`.
9. `<SiteFooter brandLine={HOME.footer.brandLine} links={HOME.footer.links} />`.
10. Scroll reveals: `useRevealOnScroll(pageRef)` (default selector).

Also update `main.jsx`: line 35 becomes `import Home from './modules/marketing/Home.jsx'`; line 53 becomes `<Route path="/" element={<Home />} />`. Delete `ForBusiness.jsx`.

Also update `index.html`: inside `<head>`, add `<link rel="preconnect" href="https://images.unsplash.com" crossorigin />` (spec §6).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/modules/marketing/Home.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Run full suite + build**

Run: `npm test` then `npm run build`
Expected: suite green (existing 208+ still pass — nothing referenced ForBusiness except main.jsx), build clean.

- [ ] **Step 7: Commit**

```bash
git add apps/carefind/src/modules/marketing apps/carefind/src/main.jsx
git rm apps/carefind/src/modules/marketing/ForBusiness.jsx
git commit -m "feat(carefind): rebuild consumer landing as Home on marketing primitives"
```

---

### Task 4: About page rebuilt on primitives

**Files:**
- Modify: `apps/carefind/src/modules/marketing/content.js` — fill `ABOUT` export
- Modify: `apps/carefind/src/modules/marketing/About.jsx` — rebuild composition
- Test: `apps/carefind/src/modules/marketing/About.test.jsx`

**Interfaces:**
- Consumes: primitives (Tasks 1-2); `ABOUT` from content.js.
- Produces: `About` default export; same route `/about`; ALL existing section content preserved verbatim.

- [ ] **Step 1: Write failing tests**

Create `apps/carefind/src/modules/marketing/About.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import About from './About'

beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
})

const renderAbout = () => render(<MemoryRouter><About /></MemoryRouter>)

describe('About', () => {
  it('renders hero and mission/vision sections', () => {
    renderAbout()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Connecting people to better healthcare.')
    expect(screen.getByRole('heading', { name: /our mission/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /our vision/i })).toBeInTheDocument()
  })

  it('preserves story timeline and team verbatim', () => {
    renderAbout()
    expect(screen.getByText('2020')).toBeInTheDocument()
    expect(screen.getByText('The WhatsApp group')).toBeInTheDocument()
    expect(screen.getByText('HATMA Brandtech Limited')).toBeInTheDocument()
    expect(screen.getByText('Haruna Abdullahi Tama')).toBeInTheDocument()
    expect(screen.getByText('Pharmacist John Joseph')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/modules/marketing/About.test.jsx`
Expected: FAIL or PASS-partial — current About renders similar text but headings/structure differ; after rebuild must pass. If it already passes pre-rebuild, still proceed (tests guard the rebuild).

- [ ] **Step 3: Fill ABOUT in content.js**

Move the following constants VERBATIM from the current `About.jsx` into `ABOUT` (do not reword): PILLARS -> `about.pillars`, OFFERINGS -> `about.offerings`, MILESTONES -> `about.milestones`, FOUNDERS -> `about.founders`, plus:
`hero` { badge: 'A healthcare social platform by HATMA Brandtech Limited', title: 'Connecting people to better healthcare.', body: <existing paragraph>, image: keep existing URL }, `whyWeExist` paragraphs (existing ProseParagraph texts), `missionVision` { mission, vision, goal } (existing strings), `offeringsIntro`, `pillarsHeading`, `storyHeading`, `teamHeading`, `ctaSection`, `footer`.

Structure mirrors HOME's shape; every string comes from today's file — zero new copy.

- [ ] **Step 4: Rebuild About.jsx**

Composition order (identical to current page): LandingNav (in `<header>`) -> hero (`<img>` + DUOTONE overlay + badge pill + h1 TYPE.displayXL + body + CTAs "Read our story" scroll-to #story and "Explore care near you" Link /search + quick facts row) -> why-we-exist prose -> mission/vision cards (#mission) -> offerings grid -> pillars grid -> story timeline (#story, dark gradient section) -> team (#team) -> `<CtaBand {...about.cta} />` -> SiteFooter.

Requirements:
- All GSAP entrance/reveal via `useRevealOnScroll(pageRef)` + one hero useEffect gated by `prefersReducedMotion()` (replaces the component's bespoke context block).
- Nav is now the shared LandingNav; delete the local nav markup and its ScrollTrigger logic.
- Footer is SiteFooter with about.footer data.
- Every section keeps its `data-reveal`.
- Keep semantic sections: `<section id="story">`, `<section id="team">` etc.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/modules/marketing/About.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/carefind/src/modules/marketing
git commit -m "feat(carefind): rebuild About page on shared marketing primitives"
```

---

### Task 5: Docs, audit entry, full verification

**Files:**
- Create: `apps/carefind/src/modules/marketing/README.md`
- Modify: `planning/CODE_AUDIT.md` (UI section)

- [ ] **Step 1: Write marketing README**

Content: purpose of the module; primitives inventory table (component -> props -> used-by); conventions (copy lives in content.js only; DUOTONE for every photo; TYPE scale for display sizes; every animation through useRevealOnScroll/prefersReducedMotion; reduced-motion is mandatory for any new animation); how to run tests.

- [ ] **Step 2: Add CODE_AUDIT UI entry**

Under `## UI` add:

```markdown
- [x] **Fabricated social proof removed from landing pages (2026-08-24).** CareFind Home previously showed invented patient testimonials ("Sarah K." et al.) and a partner marquee naming real-sounding hospitals (Lagos State Hospital, MedPlus...) that are not platform listings; CareHub Landing showed invented testimonials. All removed during the landing premium pass (spec: docs/superpowers/specs/2026-08-24-landing-pages-premium-design.md). Testimonials return only against real quotes; CareFind's marquee now lists true product categories instead of fake partners.
```

- [ ] **Step 3: Full verification**

Run from `apps/carefind`: `npm test` and `npm run build`. Expected: green + clean build.
Manual pass (dev server): each page at 375/768/1280 widths vs spec section lists; keyboard-only walkthrough (tab to nav links/buttons/steps accordion; visible focus); reduced-motion emulation (DevTools rendering tab) shows no entrance animations anywhere including marquee.

- [ ] **Step 4: Commit**

```bash
git add apps/carefind/src/modules/marketing/README.md planning/CODE_AUDIT.md
git commit -m "docs(carefind): marketing module README and fabricated-proof audit entry"
```
