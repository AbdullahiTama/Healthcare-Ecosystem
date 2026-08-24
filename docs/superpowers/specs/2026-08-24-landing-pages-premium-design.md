# Landing Pages Premium Pass — Design Spec

**Date:** 2026-08-24
**Status:** Approved design, pending implementation plan
**Scope:** All three landing surfaces — CareHub `/`, CareFind `/`, CareFind `/about`

---

## 1. Problem

The ecosystem's three marketing pages were built independently and have drifted:

| Surface | File | Known issues |
|---|---|---|
| CareHub SaaS landing | `apps/carehub/src/pages/Landing.jsx` (537 lines) | No reduced-motion support; fabricated testimonials; redundant business-type marquee duplicating the business-types strip; no tests |
| CareFind consumer landing | `apps/carefind/src/modules/marketing/ForBusiness.jsx` (359 lines) | Misleading filename (it is the consumer home, not a business page); invalid CSS (`gap: -8`); no reduced-motion support; fabricated testimonials; fake partner marquee naming real-sounding hospitals; stock face avatars of people who don't exist; no tests |
| CareFind About | `apps/carefind/src/modules/marketing/About.jsx` (496 lines) | Strongest page (has reduced-motion) but duplicates nav/footer patterns with Home; no tests |

Cross-cutting: nav / marquee / testimonial carousel / CTA / footer logic is duplicated within CareFind's two pages with drift between copies; generic Unsplash imagery with foreign-looking contexts; ad-hoc type sizes on every element.

## 2. Decisions made during brainstorming

1. **Scope:** all three pages.
2. **Direction:** refine the existing identity (teal/navy/Lora) to a higher execution level. No new art direction.
3. **Imagery:** curated photography (African healthcare contexts where possible) with a consistent art-directed treatment. Stock *face* avatars are eliminated in favor of initials monograms.
4. **Content latitude:** sections may be rewritten, reordered, cut. Fabricated social proof (testimonials, partner names) is removed — recorded as a deliberate credibility decision.
5. **Approach:** per-app marketing primitives + rebuilt page compositions. Cross-app sharing is explicitly rejected (roadmap §4: do not converge CareHub and CareFind).

## 3. Design language

- **Typography.** Lora (`theme.fontDisplay`) remains display-only for headlines; Geist (`theme.fontFamily`) for body/UI. A single responsive display/heading scale built on `clamp()` replaces the per-element ad-hoc sizes currently scattered across the three files. Body sizes come from `theme.type`.
- **Color.** Tokens unchanged. Teal/navy gradients confined to hero and CTA bands (design-system rule: "Marketing/hero only"). Cards stay flat `cardBg` with hairline borders; elevation only on genuine hover affordances via `theme.elevation`.
- **Imagery treatment.** One reusable recipe applied to every photo: teal-navy duotone overlay over a consistent crop ratio, rounded with `theme.radius.xl`. Hero images preloaded/prioritized; below-fold images lazy-loaded with explicit aspect-ratio boxes (no CLS). Avatars are initials monograms on token gradients (pattern already exists in About's founders grid).
- **Motion.** GSAP stays (existing dependency). One shared vocabulary: hero entrance, staggered scroll reveals, hover lifts. Implemented once as `useRevealOnScroll` per app. Every animation gated behind `prefers-reduced-motion` (About.jsx's existing check becomes canonical). Easings from `theme.motion`.

## 4. Architecture

### CareFind

```
apps/carefind/src/modules/marketing/
  components/
    LandingNav.jsx           glass pill nav; scroll-state; link config via props
    SiteFooter.jsx           shared footer; link config via props
    SectionHeading.jsx       eyebrow + title + intro
    Marquee.jsx              generic infinite marquee (CSS keyframes, pause on hover)
    CtaBand.jsx              gradient CTA band; heading/body/actions via props
    useRevealOnScroll.js     canonical GSAP reveal hook incl. reduced-motion gate
  content.js                 ALL copy/data for both pages (editable without touching JSX)
  Home.jsx                   renamed from ForBusiness.jsx (route `/` unchanged)
  About.jsx                  rebuilt composition on primitives
```

`main.jsx` import updated for the rename. Route paths unchanged (`/`, `/about`).

### CareHub

```
apps/carehub/src/components/marketing/
  LandingNav.jsx · SiteFooter.jsx · SectionHeading.jsx
  CtaBand.jsx · useRevealOnScroll.js
apps/carehub/src/pages/
  Landing.jsx                rebuilt composition
  landing/content.js         copy/data extracted
```

Near-identical primitives will exist across the two apps. This duplication between apps is accepted deliberately: the roadmap forbids converging the products' UI systems, and their navs/footers genuinely differ (different links, brands, audiences).

Note: no testimonial-carousel primitive is built. Both pages carrying fabricated testimonials are cutting them (§5), and no remaining page uses one. When real testimonials exist, the component gets built against real content — not speculatively.

### Data flow

Marketing pages are static compositions — no data fetching, no server state. Content lives in plain JS modules (`content.js`) so copy edits never touch presentation code and tests can assert against exported content objects.

## 5. Page plans

### CareFind `Home.jsx` (route `/`)

1. **Hero** — refined headline; curated photo with duotone treatment; primary CTA → `/search`, secondary → `/feed`; trust chips (*Verified providers · Real patient reviews · Connect on WhatsApp*).
2. **Category strip** — replaces the fake-partners marquee. Marquee of what CareFind aggregates: Pharmacies · Hospitals · Laboratories · Imaging Centers · Wellness providers. True by product definition.
3. **Features bento** — same four features (search, reviews, WhatsApp connect, verified providers), refined cards.
4. **How it works** — keep the three-step horizontal accordion (strongest existing section); desktop hover-expand preserved, mobile stacked variant preserved; keyboard accessible.
5. ~~Testimonials~~ — **CUT.** All current quotes are invented ("Sarah K.", "James M.", "Amara O."). Returns only when real quotes exist. Space yielded to the CTA band.
6. **CTA band + footer** — on primitives.

### CareHub `Landing.jsx` (route `/`)

1. **Hero** — headline kept (*Run your healthcare business. Get found by patients.*); photo-led with art direction; trial/offline/roles chips kept.
2. **Business types strip** — kept (true content).
3. **Features bento** — eight features kept; refined grid rhythm; hover states from tokens.
4. **Steps** — three steps kept.
5. **Pricing** — structure unchanged (real plans, Naira pricing); visual polish only.
6. ~~Testimonials~~ — **CUT**, same fabrication reasoning as above.
7. **Referral Agent** — kept (real program with real terms).
8. ~~Business-type marquee~~ — **consolidated into #2** (was redundant).
9. **CTA band + footer** — on primitives.

### CareFind `About.jsx` (route `/about`)

Light pass. Rebuild on shared primitives for consistency; keep every section and all story/team content verbatim (why-we-exist, mission/vision, offerings, pillars, story timeline, team, CTA).

## 6. Quality standards

- **Accessibility.** Semantic landmarks (`header`/`main`/`section`/`footer`); carousels and accordions keyboard-operable with visible focus (`:focus-visible` rings); aria-labels on icon-only buttons; contrast ≥ 4.5:1 verified for text-on-image combinations (current white chips need checking); `prefers-reduced-motion` honored on every page.
- **Performance.** Hero image prioritized; below-fold media lazy-loaded inside aspect-ratio boxes; `preconnect` to `images.unsplash.com`; zero new runtime dependencies.
- **States.** Static pages — loading/error handled by the existing `ErrorBoundary`; interactive elements get hover/focus/disabled treatments from tokens.
- **Responsiveness.** Verified at 375 / 768 / 1280 (project Definition of Done).
- **Logging.** None added — static pages have nothing worth logging.

## 7. Testing

- **CareFind** (Vitest + Testing Library already standard): render tests for `Home` and `About` — key sections render; nav links navigate; category strip renders categories. Primitive components tested once each.
- **CareHub**: Vitest + jsdom exist but Testing Library does not. Add `@testing-library/react` (+ `jest-dom`) as dev dependencies — test tooling the sibling app already standardizes on; not a UI framework change. Same test shapes for `Landing`.
- Reduced-motion path exercised at least once (mock `matchMedia`) to prove animations degrade cleanly.
- Existing suites must keep passing; both builds clean.

## 8. Documentation

- Module READMEs at `apps/carefind/src/modules/marketing/README.md` and `apps/carehub/src/components/marketing/README.md`: primitives inventory, conventions, how to edit copy.
- `planning/CODE_AUDIT.md`: entry recording the fabricated-social-proof removal decision (UI section).
- Design-system docs updated only if a pattern proves generalizable (e.g., the duotone recipe); not assumed upfront.

## 9. Out of scope

- Real testimonial collection (product work, not engineering).
- SSR/SEO beyond what exists (OG rewrites shipped separately on 2026-08-22; meta title/description polish allowed opportunistically but not a goal).
- Any styling-approach migration (inline styles + theme tokens stay, per roadmap §5.1).
- Cross-app component sharing (rejected, §4).
- New runtime dependencies (dev-only Testing Library addition excepted, §7).

## 10. Verification plan

1. `npm test` green in both apps after each milestone.
2. `npm run build` clean in both apps.
3. Manual visual pass at 375/768/1280 per page against this spec's section lists.
4. Keyboard-only walkthrough per page (tab order, how-it-works accordion operation, visible focus).
5. Reduced-motion emulation pass per page.
