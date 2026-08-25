# CareHub marketing components

The primitives behind CareHub's public landing surface, `src/pages/Landing.jsx`
(route `/`). The page is a thin composition — layout and sequencing only. All
its copy and data live in `src/pages/landing/content.js`.

Built during the landing premium pass. Spec:
`docs/superpowers/specs/2026-08-24-landing-pages-premium-design.md`.

## Why these are duplicated from CareFind

Deliberate, per spec §4. CareFind has a near-identical set under
`apps/carefind/src/modules/marketing/components`. They are **not** shared, and
must not be extracted into `packages/design-system`: the two products' marketing
diverges on purpose, and a shared package would force a versioned release to
change a headline on one of them. Duplication across apps is the accepted cost.
Duplication *within* an app is not — that is what this module exists to remove.

## Primitives

| Component | Props | Used by |
|---|---|---|
| `LandingNav` | `links[{label,target}]`, `signInTo`, `getStartedTo` | Landing |
| `SiteFooter` | `brandLine`, `links[{label,to?}]` | Landing |
| `SectionHeading` | `eyebrow?`, `title`, `intro?`, `dark?` | Landing |
| `CtaBand` | `eyebrow?`, `title`, `body?`, `primary`, `secondary?` | Landing |
| `useRevealOnScroll` | `(scopeRef, { selector?, y? })` | Landing |
| `tokens.js` | `TYPE`, `DUOTONE`, `prefersReducedMotion`, `theme` | all of the above |

`LandingNav` targets starting with `#` smooth-scroll; anything else is a router
`Link`. `SiteFooter` entries render three ways: **no `to` at all is plain text**,
`#anchor` and `mailto:` are anchors, anything else is a `Link`.

## Conventions

**Copy lives in `pages/landing/content.js`, never in JSX.** Icons are named
there as strings and mapped to components by the page, so the content file stays
data-only.

**One photo treatment.** Every marketing image gets `DUOTONE` from `tokens.js`.

**Display sizes come from `TYPE`** — `clamp()` strings that *are* the responsive
behaviour, so don't wrap them in breakpoint branches.

**Every animation is reduced-motion gated, without exception.** Scroll reveals
go through `useRevealOnScroll`, which no-ops under reduced motion; anything else
gates on `prefersReducedMotion()` or a `@media (prefers-reduced-motion: reduce)`
block. The pre-rebuild page ran its entire GSAP context unconditionally — that
is the thing not to do.

**Landmarks.** The page wraps `LandingNav` in `<header>`; that is the banner.
The nav is a labelled `navigation` landmark and must not claim `role="banner"` —
that duplicates the banner and destroys the navigation landmark.

**Calls to action are links, not buttons.** A CTA that navigates needs an
`href`, so middle-click, open-in-new-tab and copy-link work. Buttons calling
`navigate()` break all three.

**No fabricated social proof.** Testimonials, trust claims, partner lists and
counts appear only when they are real and attributable. Two things were removed
here and are asserted absent by `pages/landing/Landing.test.jsx`: three invented
testimonials, and a "Trusted by healthcare businesses across Nigeria" marquee
that was scrolling the list of business *categories* the product supports. See
the CODE_AUDIT entry dated 2026-08-24.

**No new runtime dependencies**, and no CSS files — inline `style={}` against
the shared theme.

## Tests

From `apps/carehub`:

```bash
npm test                                       # full suite
npx vitest run src/components/marketing        # primitives
npx vitest run src/pages/landing               # the page
```

Testing Library and the jsdom setup (`src/test/setup.js`: jest-dom matchers, a
`matchMedia` mock defaulting to motion-allowed, a no-op `IntersectionObserver`)
were added for this work. Older suites in this app drive React through
`createRoot` and `react-dom/test-utils` by hand; new tests should use
`@testing-library/react`.

Page-level tests override `matchMedia` to report reduced motion, so GSAP and
ScrollTrigger never initialise under jsdom.
