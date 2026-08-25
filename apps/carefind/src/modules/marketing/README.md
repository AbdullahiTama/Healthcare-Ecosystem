# CareFind marketing module

The public, unauthenticated surfaces: `Home.jsx` (route `/`) and `About.jsx`
(route `/about`). Both are thin compositions — layout and sequencing only. The
shared pieces live in `components/`, and every string on either page lives in
`content.js`.

Built during the landing premium pass. Spec:
`docs/superpowers/specs/2026-08-24-landing-pages-premium-design.md`.

## Why this module does not share with CareHub

Deliberate, per spec §4. CareHub has its own landing surface with its own
primitives under `apps/carehub`. A shared package would couple two products
whose marketing diverges on purpose and force a versioned release to change a
headline. Duplication across apps is the accepted cost; duplication *within*
an app is not.

## Primitives

| Component | Props | Used by |
|---|---|---|
| `LandingNav` | `links[{label,target}]`, `signInTo`, `getStartedTo`, `getStartedLabel` | Home, About |
| `SiteFooter` | `brandLine`, `links[{label,to}]` | Home, About |
| `SectionHeading` | `eyebrow`, `title`, `intro?`, `dark?` | Home, About |
| `CtaBand` | `eyebrow?`, `title`, `body?`, `primary`, `secondary?` | Home, About |
| `Marquee` | `items[]`, `label`, `speed?` | Home |
| `useRevealOnScroll` | `(scopeRef, { selector?, y? })` | Home, About |
| `tokens.js` | `TYPE`, `DUOTONE`, `prefersReducedMotion`, `theme` | all of the above |

`LandingNav` targets starting with `#` smooth-scroll; anything else is a router
`Link`. `SiteFooter` follows the same rule for its `to` values.

## Conventions

**Copy lives in `content.js`, never in JSX.** Both pages export one object each
(`HOME`, `ABOUT`). If you are editing a headline inside a `.jsx` file, the copy
is in the wrong place. Icons are named there as *strings* and mapped to
components by the page, so the content file stays data-only.

**One photo treatment.** Every marketing image gets the `DUOTONE` overlay from
`tokens.js`. Per-page gradients are what the pass removed.

**Display sizes come from `TYPE`.** `displayXL` / `displayL` / `displayM` /
`lead` are `clamp()` strings — they are the responsive behaviour, so do not
wrap them in breakpoint branches.

**Every animation is reduced-motion gated, without exception.** Scroll reveals
go through `useRevealOnScroll`, which no-ops when the user prefers reduced
motion. Anything else — a hero entrance, a CSS transition — gates itself on
`prefersReducedMotion()` or a `@media (prefers-reduced-motion: reduce)` block.
A new animation that skips this is a defect, not a polish item.

**Landmarks.** Pages wrap `LandingNav` in `<header>`; that is the banner. The
nav is a labelled `navigation` landmark and must not claim `role="banner"` —
doing so both duplicates the banner and destroys the navigation landmark.

**No new runtime dependencies**, and no CSS files — inline `style={}` against
the design-system theme (roadmap §5.1).

**No fabricated social proof.** Testimonials, partner logos and counts return
only when they are real. See the CODE_AUDIT entry dated 2026-08-24.

## Tests

From `apps/carefind`:

```bash
npm test                                    # full suite
npx vitest run src/modules/marketing        # this module only
```

Page-level tests render under forced reduced-motion so GSAP and ScrollTrigger
never initialise in jsdom; structural output is identical either way because
the hook no-ops. `@testing-library/user-event` is not installed — use
`fireEvent`.

Note when asserting page text: several strings appear more than once by design
(the hero quick facts repeat years the story timeline also uses; the footer
brand line repeats the hero badge's wording). Scope those queries to a section
with `within(container.querySelector('#story'))` rather than querying the whole
page, or the assertion throws on multiple matches whether or not the thing you
care about rendered.
