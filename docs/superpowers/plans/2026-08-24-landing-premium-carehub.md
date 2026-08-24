# CareHub Landing Premium Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild CareHub's SaaS landing (`/`) on extracted marketing primitives at premium quality — same design language as the CareFind pass — cutting its fabricated testimonials and redundant marquee, adding reduced-motion support, keyboard accessibility, and render tests.

**Architecture:** New `src/components/marketing/` primitive set (mirroring CareFind's deliberately, per spec §4), copy/data extracted to `src/pages/landing/content.js`, `pages/Landing.jsx` becomes a composition. Testing Library added as a DEV dependency (CareFind already standardizes on it).

**Tech Stack:** React 18 + Vite SPA, inline styles vs theme tokens, GSAP + ScrollTrigger (existing), Vitest + jsdom (existing), @testing-library/react + jest-dom (NEW devDeps only), lucide-react.

**Spec:** `docs/superpowers/specs/2026-08-24-landing-pages-premium-design.md`
**Companion plan:** `docs/superpowers/plans/2026-08-24-landing-premium-carefind.md` (execute either order; this plan does not depend on it)

## Global Constraints

- No new RUNTIME dependencies. Dev-only additions allowed: `@testing-library/react@^16.0.0`, `@testing-library/jest-dom@^6.5.0` (versions matched to carefind's package.json).
- All colors/radii/motion from `theme` (`apps/carehub/src/styles/theme.js`). Hardcoded values allowed only: `#fff` on dark surfaces, rgba() white overlays, DUOTONE recipe below.
- Every animation gated behind `prefers-reduced-motion`.
- Inline styles only. Route `/` unchanged. Existing routes used by CTAs stay: `/login`, `/register`, `/apply-agent`.
- Run from `apps/carehub`: `npm test` (must keep all existing tests green), `npm run build`.
- One commit per task. Test note: page-level render tests set `matchMedia` to report reduced-motion so GSAP never initializes under test.
- CareHub's shared `Logo` (`src/components/ui`) takes `{ size, style }` ONLY — no `tone` prop. Nav handles light/dark via a wordmark span whose color switches with scroll state (as today).

---

### Task 1: Testing infrastructure — devDeps, setup file, vitest wiring

**Files:**
- Modify: `apps/carehub/package.json` (devDependencies)
- Create: `apps/carehub/src/test/setup.js`
- Modify: `apps/carehub/vitest.config.js` (add `setupFiles`)
- Test: `apps/carehub/src/test/setup.test.js`

**Interfaces:**
- Produces: working `render`/`screen`/`fireEvent` + jest-dom matchers in all future `*.test.jsx`; global `matchMedia` mock defaulting to motion-allowed.

- [ ] **Step 1: Install dev dependencies**

Run (from `apps/carehub`):

```bash
npm install --save-dev @testing-library/react@^16.0.0 @testing-library/jest-dom@^6.5.0
```

Expected: package.json devDependencies updated, lockfile updated, no runtime deps touched.

- [ ] **Step 2: Write failing test**

Create `apps/carehub/src/test/setup.test.js`:

```js
import { render, screen } from '@testing-library/react'

describe('carehub test setup', () => {
  it('provides jest-dom matchers', () => {
    render(<div data-testid="probe">hello</div>)
    expect(screen.getByTestId('probe')).toBeInTheDocument()
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('mocks matchMedia reporting motion allowed by default', () => {
    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(false)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/test/setup.test.js`
Expected: FAIL — matchers missing / matchMedia undefined.

- [ ] **Step 4: Create setup file and wire vitest**

`apps/carehub/src/test/setup.js`:

```js
import '@testing-library/jest-dom'

// matchMedia mock (jsdom lacks it). Default: reduced-motion OFF so production
// code paths run; individual suites may override with matches:true.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

global.IntersectionObserver = class IntersectionObserver {
  constructor(callback) { this.callback = callback }
  observe() {}
  unobserve() {}
  disconnect() {}
}
```

In `apps/carehub/vitest.config.js`, inside `test: { ... }` add:

```js
    setupFiles: ['./src/test/setup.js'],
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/test/setup.test.js`
Expected: PASS (2 tests).

- [ ] **Step 6: Verify no regressions, commit**

Run: `npm test`
Expected: full suite green (setup must not break existing repository-style tests).

```bash
git add apps/carehub/package.json apps/carehub/package-lock.json apps/carehub/src/test apps/carehub/vitest.config.js
git commit -m "test(carehub): add Testing Library devDeps, jsdom setup and matchMedia mock"
```

---

### Task 2: Marketing primitives — tokens, reveal hook, SectionHeading, CtaBand

**Files:**
- Create: `apps/carehub/src/components/marketing/tokens.js`
- Create: `apps/carehub/src/components/marketing/useRevealOnScroll.js`
- Create: `apps/carehub/src/components/marketing/SectionHeading.jsx`
- Create: `apps/carehub/src/components/marketing/CtaBand.jsx`
- Test: `apps/carehub/src/components/marketing/marketing.test.jsx`

**Interfaces:**
- Consumes: `theme` from `../../styles/theme`.
- Produces (Tasks 3-4 depend on these):
  - `TYPE.displayXL | displayL | displayM | lead`; `DUOTONE` overlay gradient; `prefersReducedMotion()`; `useRevealOnScroll(scopeRef, opts)`.
  - `<SectionHeading eyebrow title intro dark />`.
  - `<CtaBand eyebrow title body primary secondary />` — primary/secondary `{ label, to, variant }` rendered as router Links.

- [ ] **Step 1: Write failing tests**

Create `apps/carehub/src/components/marketing/marketing.test.jsx`:

```jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import SectionHeading from './SectionHeading'
import CtaBand from './CtaBand'

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('SectionHeading', () => {
  it('renders eyebrow, title and optional intro', () => {
    wrap(<SectionHeading eyebrow="Platform" title="One calm platform" intro="Everything in one place." />)
    expect(screen.getByText('Platform')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'One calm platform' })).toBeInTheDocument()
    expect(screen.getByText('Everything in one place.')).toBeInTheDocument()
  })

  it('omits eyebrow and intro when absent', () => {
    wrap(<SectionHeading title="Plain heading" />)
    expect(screen.queryByText('Platform')).not.toBeInTheDocument()
  })
})

describe('CtaBand', () => {
  it('renders title, body and actions as links', () => {
    wrap(
      <CtaBand
        title="Your patients are already searching."
        body="Register today."
        primary={{ label: 'Get started free', to: '/register', variant: 'solid' }}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Your patients are already searching.' })).toBeInTheDocument()
    expect(screen.getByText('Register today.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Get started free' })).toHaveAttribute('href', '/register')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/components/marketing/marketing.test.jsx`
Expected: FAIL — cannot resolve modules.

- [ ] **Step 3: Implement**

`tokens.js`:

```js
import { theme } from '../../styles/theme'

// Display scale for CareHub marketing surfaces (spec section 3). Mirrors the
// CareFind marketing module by design (spec section 4 — per-app duplication).
export const TYPE = {
  displayXL: 'clamp(2.6rem, 5.5vw, 4.25rem)',
  displayL: 'clamp(1.9rem, 3.4vw, 2.6rem)',
  displayM: 'clamp(1.35rem, 2.4vw, 1.8rem)',
  lead: 'clamp(0.95rem, 1.4vw, 1.0625rem)',
}

export const DUOTONE =
  'linear-gradient(180deg, rgba(11,74,62,0.55) 0%, rgba(11,74,62,0.85) 100%)'

export { theme }
```

`useRevealOnScroll.js` (complete file):

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
// reduced motion — content simply renders in place.
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

`SectionHeading.jsx` (complete file):

```jsx
import { theme } from '../../styles/theme'

const { tealDeep, textDark, gray500 } = theme

export default function SectionHeading({ eyebrow, title, intro, dark = false }) {
  return (
    <div data-reveal style={{ maxWidth: 640, margin: '0 auto 44px', textAlign: 'center' }}>
      {eyebrow && (
        <div style={{
          fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase',
          color: dark ? 'rgba(255,255,255,0.65)' : tealDeep, marginBottom: 12,
        }}>
          {eyebrow}
        </div>
      )}
      <h2 style={{
        fontFamily: theme.fontDisplay, fontWeight: 700,
        fontSize: 'clamp(1.7rem, 3.2vw, 2.6rem)', lineHeight: 1.2, letterSpacing: '-0.02em',
        color: dark ? '#fff' : textDark, margin: '0 0 14px',
      }}>
        {title}
      </h2>
      {intro && (
        <p style={{ fontSize: 14, color: dark ? 'rgba(255,255,255,0.8)' : gray500, lineHeight: 1.7, margin: 0 }}>
          {intro}
        </p>
      )}
    </div>
  )
}
```

(CareHub headings use fontWeight 700 and gray500 body per its established landing styling.)

`CtaBand.jsx` (complete file):

```jsx
import { Link } from 'react-router-dom'
import { theme } from '../../styles/theme'
import { TYPE } from './tokens'

const { deepTeal, tealDeep } = theme

function Action({ action }) {
  const solid = action.variant !== 'ghost'
  return (
    <Link to={action.to} style={{
      padding: '15px 30px', borderRadius: theme.radius.md, textDecoration: 'none',
      border: solid ? 'none' : '1px solid rgba(255,255,255,0.3)',
      background: solid ? '#fff' : 'transparent',
      color: solid ? deepTeal : '#fff', fontWeight: solid ? 800 : 700, fontSize: 14,
      display: 'inline-flex', alignItems: 'center',
    }}>
      {action.label}
    </Link>
  )
}

export default function CtaBand({ eyebrow, title, body, primary, secondary }) {
  return (
    <section data-reveal style={{ background: `linear-gradient(135deg, ${deepTeal} 0%, ${tealDeep} 100%)`, padding: '72px 24px', textAlign: 'center', borderRadius: 20, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        {eyebrow && (
          <div style={{
            display: 'inline-flex', padding: '8px 16px', borderRadius: theme.radius.full,
            background: 'rgba(255,255,255,0.12)', color: '#fff',
            fontSize: 12, fontWeight: 800, letterSpacing: '0.04em', marginBottom: 18,
          }}>
            {eyebrow}
          </div>
        )}
        <h2 style={{
          fontFamily: theme.fontDisplay, fontWeight: 700, fontSize: TYPE.displayL,
          color: '#fff', margin: '0 0 12px', lineHeight: 1.2,
        }}>
          {title}
        </h2>
        {body && <p style={{ color: 'rgba(255,255,255,0.75)', margin: '0 0 28px', fontSize: 14.5, lineHeight: 1.7 }}>{body}</p>}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          {primary && <Action action={primary} />}
          {secondary && <Action action={secondary} />}
        </div>
      </div>
    </section>
  )
}
```

(The deliberate per-app duplication of these primitives is a spec section 4 decision — do NOT extract them into packages/design-system.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/components/marketing/marketing.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/carehub/src/components/marketing
git commit -m "feat(carehub): marketing tokens, reveal hook, SectionHeading and CtaBand primitives"
```

---

### Task 3: LandingNav and SiteFooter primitives

**Files:**
- Create: `apps/carehub/src/components/marketing/LandingNav.jsx`
- Create: `apps/carehub/src/components/marketing/SiteFooter.jsx`
- Test: append to `apps/carehub/src/components/marketing/marketing.test.jsx`

**Interfaces:**
- Consumes: `theme`; `Logo` from `'../ui'` (`{ size }` only).
- Produces:
  - `<LandingNav links signInTo getStartedTo />` — links `{ label, target }`; `#` targets smooth-scroll anchors, others router Links. Wordmark color flips with scroll state.
  - `<SiteFooter brandLine links />` — links `{ label, to }`.

- [ ] **Step 1: Write failing tests**

Append:

```jsx
import LandingNav from './LandingNav'
import SiteFooter from './SiteFooter'

describe('LandingNav', () => {
  it('renders anchor links and action buttons', () => {
    wrap(
      <LandingNav
        links={[{ label: 'Features', target: '#features' }, { label: 'Pricing', target: '#pricing' }]}
        signInTo="/login"
        getStartedTo="/register"
      />,
    )
    expect(screen.getByRole('link', { name: 'Features' })).toHaveAttribute('href', '#features')
    expect(screen.getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '#pricing')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Get started' })).toBeInTheDocument()
  })

  it('navigates to register from Get started', () => {
    wrap(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<LandingNav links={[]} signInTo="/login" getStartedTo="/register" />} />
          <Route path="/register" element={<div>register marker</div>} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }))
    expect(screen.getByText('register marker')).toBeInTheDocument()
  })
})

describe('SiteFooter', () => {
  it('renders brand line and links inside contentinfo', () => {
    wrap(
      <SiteFooter
        brandLine="(c) 2026 CareHub"
        links={[{ label: 'Features', to: '#features' }, { label: 'CareFind', to: '/search' }]}
      />,
    )
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Features' })).toHaveAttribute('href', '#features')
    expect(screen.getByRole('link', { name: 'CareFind' })).toHaveAttribute('href', '/search')
  })
})
```

(The `(c)` above must be written as the real copyright sign when copied into test files; it is spelled out here only for encoding safety.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/components/marketing/marketing.test.jsx`
Expected: FAIL — cannot resolve `./LandingNav`.

- [ ] **Step 3: Implement**

`LandingNav.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { Logo } from '../ui'

const { tealDeep, border } = theme

// Glass pill nav for the CareHub landing. Fixed pill turns solid after 80px;
// wordmark color flips between white (over hero) and teal (solid state).
export default function LandingNav({ links = [], signInTo = '/login', getStartedTo = '/register' }) {
  const navigate = useNavigate()
  const { isMobile } = useBreakpoint()
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const renderTarget = ({ label, target }) => {
    const style = {
      padding: '6px 12px', fontSize: 13, fontWeight: 600,
      color: scrolled ? tealDeep : 'rgba(255,255,255,0.8)',
      textDecoration: 'none', transition: 'color 0.3s ease',
    }
    return target.startsWith('#') ? (
      <a key={label} href={target} style={style}
        onClick={(e) => { e.preventDefault(); document.getElementById(target.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>
        {label}
      </a>
    ) : (
      <Link key={label} to={target} style={style}>{label}</Link>
    )
  }

  return (
    <nav role="banner" style={{
      position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
      background: scrolled ? '#fff' : 'rgba(255,255,255,0.05)',
      backdropFilter: 'blur(20px)',
      borderRadius: 64, padding: '8px 10px 8px 20px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      zIndex: 100, width: isMobile ? 'calc(100% - 24px)' : 720,
      border: scrolled ? '1px solid rgba(0,0,0,0.04)' : '1px solid rgba(255,255,255,0.08)',
      transition: 'background 0.3s ease, border 0.3s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Logo size={28} />
        <span style={{
          fontWeight: 900, fontSize: 16, letterSpacing: '-0.01em',
          color: scrolled ? tealDeep : '#fff', transition: 'color 0.3s ease',
        }}>
          CareHub
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 20 }}>
        {!isMobile && links.map(renderTarget)}
        <button onClick={() => navigate(signInTo)} style={{
          padding: '7px 14px', borderRadius: 40, cursor: 'pointer', fontFamily: 'inherit',
          border: scrolled ? `1px solid ${tealDeep}` : '1px solid rgba(255,255,255,0.25)',
          background: 'transparent', color: scrolled ? tealDeep : '#fff',
          fontWeight: 600, fontSize: 13, transition: 'color 0.3s ease, border 0.3s ease',
        }}>
          Sign in
        </button>
        <button onClick={() => navigate(getStartedTo)} style={{
          padding: '7px 16px', borderRadius: 40, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          background: '#fff', color: theme.deepTeal, fontWeight: 700, fontSize: 13,
        }}>
          Get started
        </button>
      </div>
    </nav>
  )
}
```

`SiteFooter.jsx`: same structure/contract as the CareFind SiteFooter (footer landmark, brand line with Logo markOnly at size 18, links rendered as anchors for `#` targets and Links otherwise) importing:
- `Link` from react-router-dom
- `theme` from `'../../styles/theme'`
- `{ Logo }` from `'../ui'`

with `brandColor = theme.gray500`, link colors `theme.gray500` / hover none, matching today's footer styling (fontSize 12).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/components/marketing/marketing.test.jsx`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add apps/carehub/src/components/marketing
git commit -m "feat(carehub): LandingNav and SiteFooter marketing primitives"
```

---

### Task 4: content.js + rebuilt Landing page (route `/`)

**Files:**
- Create: `apps/carehub/src/pages/landing/content.js`
- Modify: `apps/carehub/src/pages/Landing.jsx` — full rebuild
- Modify: `apps/carehub/index.html` — add `<link rel="preconnect" href="https://images.unsplash.com" crossorigin />` in `<head>` (spec §6)
- Test: `apps/carehub/src/pages/landing/Landing.test.jsx`

**Interfaces:**
- Consumes: primitives from Tasks 2-3; `BUSINESS_TYPES` from `'../../config/constants'`; theme tokens.
- Produces: `content.js` exports `LANDING` object with all copy/data; `Landing` default export.

**Content decisions (spec section 5, CareHub list):** hero headline kept verbatim; testimonials CUT; business-type marquee CUT (consolidated into the static strip); referral agent section kept; pricing data unchanged.

- [ ] **Step 1: Write failing tests**

Create `apps/carehub/src/pages/landing/Landing.test.jsx`:

```jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Landing from '../Landing'

beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
})

const renderLanding = () => render(
  <MemoryRouter initialEntries={['/']}>
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/register" element={<div>register marker</div>} />
      <Route path="/apply-agent" element={<div>agent marker</div>} />
      <Route path="/login" element={<div>login marker</div>} />
    </Routes>
  </MemoryRouter>,
)

describe('CareHub Landing', () => {
  it('renders hero headline and primary CTAs', () => {
    renderLanding()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Run your healthcare business')
    expect(screen.getAllByRole('link', { name: /see pricing/i }).length).toBeGreaterThanOrEqual(1)
  })

  it('renders features, steps, pricing and referral sections', () => {
    renderLanding()
    expect(screen.getByRole('heading', { name: /one platform for the counter/i })).toBeInTheDocument()
    expect(screen.getByText('Register your business')).toBeInTheDocument()
    expect(screen.getByText(/Plain pricing in Naira/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Referral Agent/i })).toBeInTheDocument()
  })

  it('navigates to register from hero CTA', () => {
    renderLanding()
    fireEvent.click(screen.getByRole('link', { name: /get started free/i }))
    expect(screen.getByText('register marker')).toBeInTheDocument()
  })

  it('does not render fabricated testimonials or redundant marquee', () => {
    renderLanding()
    expect(screen.queryByText('Adaeze Okafor')).not.toBeInTheDocument()
    expect(screen.queryByText(/Loved by healthcare teams/i)).not.toBeInTheDocument()
  })
})
```

Note on Step "navigates via link": if the hero CTA is implemented as a `<Link>`, fireEvent.click navigates. Keep it a Link (not button) so this holds.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/pages/landing/Landing.test.jsx`
Expected: partial FAIL — current page still renders testimonials ("Adaeze Okafor") so at least the negative assertion fails, proving the test bites.

- [ ] **Step 3: Create content.js**

`LANDING` object holding (all strings from today's file unless noted): `nav.links` (#features, #pricing), `hero` { title kept, body kept, chips kept, image: NEW curated photo `'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=1920&q=80&auto=format&fit=crop'` }, `features.heading`, `features.primary[3]` (Smart POS span card + Inventory + Reports) and `features.secondary[4]` (Staff & roles / CareFind listing / Multi-location / Works offline), `steps.heading` + `steps.items` (existing three), `pricing.heading` + `pricing.plans` (existing four plans verbatim), `referral` { eyebrow, title, body, bullets, ctaLabel }, `cta` { title, body, primary }, `footer` { brandLine, links }.
NO testimonials entry. NO marquee entry.

- [ ] **Step 4: Rebuild Landing.jsx**

Composition order:
1. `<main ref={pageRef}>` (fontFamily/bg/color as today).
2. `<header><LandingNav links={LANDING.nav.links} signInTo="/login" getStartedTo="/register" /></header>`
3. **Hero** (minHeight 90vh): `<img>` src hero.image absolute cover + DUOTONE overlay div; h1 TYPE.displayXL white (data-hero); p TYPE.lead rgba-white (data-hero); CTA row (data-hero): Link `/register` white pill "Get started free" + ArrowRight icon, anchor-link styled Link `#pricing` ghost "See pricing"; chips row (data-hero).
   Hero entrance useEffect gated by `prefersReducedMotion()` animating `[data-hero]`.
4. **Business types strip**: unchanged content — map `BUSINESS_TYPES` into the existing chip design (Clipboard icon chip row), wrapped in `<section>` with caption.
5. **Features bento** id="features": SectionHeading then grid (3-col desktop / 1-col mobile): first item spans 2x2 with teal gradient (existing pattern), remaining two of primary as white cards, then secondary four as compact horizontal cards. Hover lift via onMouseEnter/Leave using theme.elevation (desktop only).
6. **Steps** id="how-it-works": SectionHeading then the three step cards (number badge + title + desc), reveal via useRevealOnScroll.
7. **Pricing** id="pricing": heading + 4 plan cards (popular = Growth, teal gradient, MOST POPULAR pill, Naira amounts) exactly as today's data; each card's CTA is a Link to `/register` (Enterprise -> label "Talk to us", same route).
8. **Referral Agent** section: eyebrow pill, heading, body (40% first payment / 5% renewals bolded), Link `/apply-agent` teal button, three CheckIcon bullets.
9. **CtaBand** {...LANDING.cta} with primary `{ label: 'Get started free', to: '/register', variant: 'solid' }`.
10. **SiteFooter** brandLine + links (Features #features, Pricing #pricing, CareFind https://carefind (external anchor target _blank rel noreferrer), support@carehub.ng mailto anchor).

Requirements: `useRevealOnScroll(pageRef)` active; every animation reduced-motion-gated; all images except hero get `loading="lazy"` inside aspect-ratio boxes; semantic sections with ids preserved (`#features`, #pricing targets must exist for nav anchors).

Also update `index.html`: inside `<head>`, add `<link rel="preconnect" href="https://images.unsplash.com" crossorigin />` (spec §6).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/pages/landing/Landing.test.jsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Full suite + build**

Run: `npm test` then `npm run build`
Expected: green + clean build.

- [ ] **Step 7: Commit**

```bash
git add apps/carehub/src/pages/landing apps/carehub/src/pages/Landing.jsx
git commit -m "feat(carehub): rebuild SaaS landing on marketing primitives"
```

---

### Task 5: Docs, audit cross-reference, verification

**Files:**
- Create: `apps/carehub/src/components/marketing/README.md`
- Modify: `apps/carehub/README.md` (Testing table note only if needed — otherwise skip)
- Modify: `planning/CODE_AUDIT.md` — extend the UI entry created by the companion CareFind plan (or create it here if executing standalone) to name BOTH apps' testimonial removals.

- [ ] **Step 1: Marketing README**

Same shape as the CareFind marketing README: purpose, primitives inventory (component/props/used-by), conventions (copy in landing/content.js only; DUOTONE recipe; TYPE scale; reduced-motion mandatory; no new deps), how to run tests.

- [ ] **Step 2: CODE_AUDIT cross-reference**

Ensure the `## UI` fabricated-proof entry names both surfaces (CareFind Home + CareHub Landing). If the companion plan already added it, append one sentence: "CareHub Landing's equivalent fabricated testimonials removed in the same pass."

- [ ] **Step 3: Final verification**

From `apps/carehub`: `npm test`, `npm run build` — green/clean.
Manual pass: page at 375/768/1280 vs spec list; keyboard-only walkthrough (nav anchors, pricing CTAs); reduced-motion emulation shows no entrance animations.

- [ ] **Step 4: Commit**

```bash
git add apps/carehub/src/components/marketing/README.md planning/CODE_AUDIT.md
git commit -m "docs(carehub): marketing README and audit cross-reference"
```
