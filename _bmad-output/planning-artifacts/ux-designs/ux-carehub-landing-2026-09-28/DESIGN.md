# CareHub Landing — Premium SaaS Redesign

**Surface:** `apps/carehub/src/pages/Landing.jsx` (route `/`, public, logged-out)
**Status:** Spec approved for implementation
**Scope:** Marketing surface only. No changes to auth, payments, database, API business logic, or dashboard functionality.

---

## 1. The problem with the current page

The current page is competent but reads as a template. Five structural faults, in order of severity:

**1.1 — No product.** There is no dashboard UI anywhere on the page. The brief calls for a product-led SaaS surface; today a visitor must take the feature claims entirely on faith. The two "product-looking" visuals (the inventory card at `Landing.jsx:384-406` and the CareFind card at `Landing.jsx:337-350`) are CSS `div` mockups, not product, and the inventory one is labelled `Live stock • 3 locations` — a fabricated status claim.

**1.2 — No coherent ground.** `<main>` is `background: tealDeep` (`Landing.jsx:143`) while most sections override it to white or `--bg`. The page therefore alternates dark→dark→white→warm→white with no logic, and the CTA block floats as a rounded rectangle on leftover teal with a second orphaned teal text strip beneath it (`:660`). `overflowX: 'hidden'` on `<main>` is masking overflow rather than preventing it.

**1.3 — Repeated claims, no hierarchy.** "Intelligent technology", "Business intelligence", "Ops cards" and "Why CareHub" each independently claim reporting and insight. Four sections say the same thing at four different sizes. The bento has no dominant feature: two equal teal cards, and six icon+label tiles carrying no copy at all (`:270-306`).

**1.4 — 14 sections, 5 cramped pricing columns.** Five plan cards in `repeat(auto-fit, minmax(180px, 1fr))` inside a 1000px container gives five 180px columns. "Custom" — a different motion (contact sales) — is a fifth peer tier. There is no comparison table.

**1.5 — Accessibility and honesty defects.**
- Body copy is set in `gray500` (2.78:1) and `gray400` (2.31:1) on `--bg`. **Both fail WCAG AA (4.5:1).** This is a page-wide failure, not a one-off.
- On mobile, Features and Pricing are removed from the nav entirely (`:165-170`) with no replacement — those two sections are **unreachable on a phone**.
- Navigation is `<button onClick={() => navigate(...)}>`. Route changes are not links: not keyboard-semantic, not focusable in the expected way, not crawlable, and un-announced to screen readers on SPA navigation.
- 12 GSAP scroll animations fire regardless of `prefers-reduced-motion`.
- No skip link, no `aria-label` on `<nav>`, no `aria-labelledby` on sections, no `<main>` landmark scoping.

### 1.6 Pre-existing marketing claims that the codebase does not support

Found during inspection. These are **not** in scope to "fix" silently — they are decisions for the product owner, and this redesign does not repeat them:

| Claim | Status in code |
|---|---|
| "30-day free trial" | **No trial implementation exists.** The string appears only in `Landing.jsx` itself. There is no trial field, no trial gate, no trial logic anywhere in `src/`. |
| "Offline capability" / "Keep your business moving" | **No service worker, no offline queue, no local write-ahead cache.** `public/` has a `manifest.json` but no `sw.js`. The only offline code is `hooks/useOnlineStatus.js`, an `navigator.onLine` flag. |
| "Live stock • 3 locations" | Hardcoded marketing decoration on a fake inventory list. |

This redesign therefore **drops the 30-day-trial claim** (the brief's own CTA direction — "Get started free" — does not require it) and **reframes offline as connection status**, which is what the code actually does. Flagged again in §11.

---

## 2. Design direction

Premium is restraint. The target is a well-set editorial page that happens to contain a real product — not a page that performs sophistication.

| Decision | Choice | Source |
|---|---|---|
| Ground | Light warm neutral `--bg #F7F5EF` | existing token |
| Ink | Deep teal/navy `#0B4A3E` headings, `#182722` body-strong | `theme.navy`, `theme.fg` |
| Accent | `tealDeep #0E6F5A` — the **only** interactive/brand colour | `theme.tealDeep` |
| Dark surfaces | Exactly two: the Business Types band and the Final CTA | deliberate rhythm break |
| Type | Lora 600/700 for headlines **only**; Geist for everything else | `theme.fontDisplay`, `docs/design/TYPOGRAPHY.md` |
| Separation | 1px `--border #ECEAE0` hairlines first; shadow only on floating product | `theme.border`, `theme.elevation` |
| Radius | 20px cards, 24px feature tiles, `full` for buttons | `theme.radius.xl`, `theme.radius.lg` |
| Motion | Fade + ≤24px translate + 0.98 scale, once, on scroll | `docs/design/MOTION.md` |
| Icons | `lucide-react` only | house standard |
| Dark mode | None. The app is deliberately light-only. | `styles/theme.js` |

### 2.1 Colour usage contract (contrast-verified)

Measured ratios against `--bg #F7F5EF`:

| Token | Ratio | Permitted use |
|---|---|---|
| `fg #182722` | 14.25 | Body strong, numbers |
| `navy #0B4A3E` | 9.34 | All headings |
| `tealDeep #0E6F5A` | 5.60 | Eyebrows, links, primary buttons, accent numerals |
| `gray600 #5B6B63` | 5.17 | **All body copy.** This replaces `gray500`. |
| `gray500 #8B978F` | 2.78 | **Decorative only** — separators, disabled. Never copy. |
| `gray400 #9AA69F` | 2.31 | **Decorative only.** Never copy. |
| `tealBright #1A8A72` | 3.91 | Illustration and borders only. Never text. |
| `tealMist #E3EEE8` | 1.09 | Icon-chip fills only. Never text. |

On dark surfaces, white is used at **≥0.85 alpha for body** (4.89:1) and **≥0.8 for metadata** (4.53:1). Nothing readable goes below 0.8.

### 2.2 Type scale (marketing)

Product scale (`theme.type`) tops out at 24px. Marketing is the sanctioned exception — headlines run large, but the ramp is still disciplined: **1.25 ratio, four sizes, no more.**

| Role | Desktop | Mobile | Family | Weight | Tracking | Line |
|---|---|---|---|---|---|---|
| Hero `h1` | `clamp(40px, 5.2vw, 64px)` | `clamp(30px, 8.4vw, 38px)` | Lora | 700 | -0.03em | 1.06 |
| Section `h2` | `clamp(28px, 3.2vw, 40px)` | `clamp(24px, 6.4vw, 28px)` | Lora | 700 | -0.025em | 1.12 |
| Tile `h3` | 17px | 15px | Geist | 800 | -0.01em | 1.3 |
| Body | 16px | 15px | Geist | 500 | 0 | 1.65 |
| Small body | 14px | 14px | Geist | 500 | 0 | 1.6 |
| Eyebrow | 10.5px | 10.5px | Geist | 700 | 0.12em, uppercase | 1.3 |

Only 400/500/600/700/800/900 weights. Hero and section headlines use `text-wrap: balance`; body uses `text-wrap: pretty`.

### 2.3 Spacing & rhythm

Section padding: **144px** desktop ≥1280, **104px** 1024–1279, **80px** 768–1023, **64px** <768. Side gutter: 24px <768, 32px 768–1023, 40px ≥1024. Container: 1200px max, 1120px for prose blocks, 760px for the pricing comparison table.

One `h2` per section, one eyebrow, one lead paragraph — in that order, always. This is the main lever against the current page's flatness.

---

## 3. Information architecture

Eleven sections, in order, with the anchor ids the nav and footer both depend on.

| # | Section | id | Ground | Purpose |
|---|---|---|---|---|
| 1 | Nav | — | sticky, transparent → hairline | Orientation + primary CTA |
| 2 | Hero | — | `--bg` | Promise + product proof |
| 3 | Business-type strip | `#business-types` | `--panel` | "This is for me" |
| 4 | Product showcase | `#product` | `--bg` | The full product |
| 5 | Feature bento | `#features` | white | What it does |
| 6 | Built for healthcare businesses | `#built-for` | dark teal | Who it's for |
| 7 | How it works | `#workflow` | `--bg` | Effort reduction |
| 8 | Capabilities | `#capabilities` | white | Verified scale |
| 9 | Pricing | `#pricing` | `--bg` | Remove price risk |
| 10 | Final CTA | — | dark teal | Convert |
| 11 | Footer | — | white | Navigate, authenticate, legal |

**Why this order.** The trust strip moves up to directly under the hero. "Is this for me?" is the second question a healthcare-business owner asks, and answering it before the feature tour is what converts. The old page answered it at position 5, after a full bento, an inventory section, an AI panel and an e-commerce section.

---

## 4. Section specifications

### 4.1 Nav — `sections/NavBar.jsx`

Fixed, not a floating pill. The current pill is 720px wide, colour-flips between white and translucent teal on scroll, and hides two links on mobile.

- `position: sticky; top: 0; z-index: 100; height: 68px` (60px <768).
- Background `--bg` at 0.86 alpha + `backdrop-filter: blur(16px)`. When `scrollY > 8`, adds `border-bottom: 1px solid --border` and `elevation-2`. One subtle state change, not a colour inversion.
- **Left:** `Logo size={28}` + `CareHub` at 16px/900 in `--navy`.
- **Centre (≥1024):** Product, Features, Business types, Pricing. All four resolve to real section ids.
- **Right:** `Sign in` (`/login`, ghost) + `Get started free` (`/register`, filled teal, 44px, `radius: full`).
- **Mobile:** logo, Sign in icon-link, `Get started free`, and a disclosure toggle. The panel is a real `<nav>` list — **this is the fix for the current page's unreachable Features/Pricing on phones.** `aria-expanded`, `aria-controls`, Esc closes, click-outside closes, focus returns to the toggle on close, body scroll locked while open.

All navigation is `<Link>` / `<a>`, never `<button onClick={navigate}>`.

### 4.2 Hero — `sections/Hero.jsx`

Two-column asymmetric, `minmax(0,1fr) minmax(0,1.08fr)` at ≥1024; single column below, product first in DOM order but copy first visually on desktop.

**Copy column**
- Eyebrow: `Healthcare business operating system` — taken from `docs/PROJECT_OVERVIEW.md` ("It is an operating system for healthcare businesses"), not invented.
- `h1`: **"Run your healthcare business from one calm workspace."**
- Lead: *"Point of sale, inventory, staff, reports and healthcare workflow — with CareFind discovery built in. CareHub is the operating platform behind pharmacies, hospitals, clinics, laboratories and wellness businesses."*
- CTAs: **Get started free** → `/register` (filled teal, 48px, arrow in a 32px circle) · **Explore CareHub** → `#product` (bordered ghost, 48px).
- Trust line, three items, each verified against source:
  - "Built for your business type" — `config/constants.js` `BUSINESS_TYPES`
  - "Plain annual pricing in Naira" — `lib/planLimits.js` `PLAN_YEARLY_NAIRA`
  - "Discovery through CareFind" — `docs/PROJECT_OVERVIEW.md`

**Product column — `components/HeroDashboard.jsx`**

The hero visual is a composed CareHub dashboard, not a stock photo. There is no dashboard screenshot in the repository and every real dashboard module (`DashboardHome`, `Overview`, `Reports`, `Sidebar`) imports Supabase, auth or the router — so reuse means **composing the safe primitives and mirroring the real component's structure and labels**:

- `ProductFrame` — browser chrome, 3 dots in `--gray-300`, address pill `carehub.ng/dashboard` in Geist Mono 11px. 1px `--border`, `radius: 20px`, `elevation-3`.
- Reuses real primitives: `StatCard`, `Card`, `Pill`, `Avatar`, `Logo` from the design system.
- **KPI row mirrors `modules/dashboard-home/DashboardHome.jsx` exactly** — the same four labels, in the same order: Sales today, Held sales, Owed to you, Stock alerts. "Owed to you" carries `tone="warning"`, "Stock alerts" `tone="danger"` — the real tone behaviour.
- Below: "Needs your attention" (out-of-stock / low-stock rows) and "Recent sales" (Avatar + client name + payment method · time + amount), both modelled on the real `WorkItem` and `SaleRow` patterns.
- Inner grid uses `auto-fit, minmax()` so it reflows honestly at 375px instead of being transform-scaled.
- **Every control inside the frame is a `<div>`, never a `<button>`** — nothing fake is focusable. The frame is `role="img"` with a descriptive `aria-label`; inner content is `aria-hidden`, so a screen reader gets one sentence instead of a wall of illustrative numbers.
- An **"Illustrative preview · sample data"** caption sits under the frame. The data is obviously a demo; saying so is cheaper than being accused of it.

### 4.3 Business-type strip — `sections/TrustStrip.jsx`

`--panel` ground, hairline top and bottom, 64px vertical padding. Micro label *"Built for the business you're in"*, then the **real 9 `BUSINESS_TYPES`** as icon pills. Wraps to 2–3 rows on mobile — wrapping, not horizontal scroll, so there is no overflow and no hidden affordance.

### 4.4 Product showcase — `sections/ProductShowcase.jsx`

The large, denser composition. Distinct from the hero: a tab rail (`Overview · POS · Inventory · Reports` — all real modules) above a wider canvas.

Contents, mapped to real modules:
- **Revenue** — hand-built SVG bar chart. No chart library exists in the repo (`recharts`/`chart.js` absent; the only SVG charts are two 5-line `Sparkline` helpers), so this follows the established hand-built-SVG precedent. No new dependency.
- **Sales** — recent sales rows, `SaleRow` pattern.
- **Inventory** — low-stock rows with real `Pill` status. Uses the real reorder rule semantics from `DashboardHome.jsx:65-66` (low = `stock > 0 && stock <= reorder_level`; out = `stock <= 0`).
- **Recent activity** — timeline, `TimelineRow` pattern.
- **Reports** — real report tabs from `modules/reports/ReportsHub.jsx`: "Sales, expenses, purchases and VAT across your business" and the NAFDAC/PCN adverse-drug-reaction report.
- **Staff & business context** — `Avatar` row with the real 8 built-in roles from `lib/permissions.js` `ROLES` (Owner, Manager, Pharmacist, Therapist, Receptionist, Cashier, Nurse, Doctor).

Reveal: ScrollTrigger-driven fade + 24px rise + 0.98→1 scale, once.

### 4.5 Feature bento — `sections/FeatureBento.jsx`

6-column grid ≥1024, 2 at 768, 1 below. **Smart POS dominates** at 3×2.

- **Primary — Smart POS** (3×2, teal gradient, white text): icon chip, `h3`, body copy, and an embedded mini POS UI — line item, quantity stepper, total, `Charge` button. Modelled on the real `.pos-cart-item` / `.pos-charge` chrome already in `styles/global.css`.
- **Inventory** (2×1): mini stock list with real `Pill` status.
- **Financial reports** (1×1), **Staff & roles** (1×1), **CareFind** (1×1), **Multi-location** (1×1), **Healthcare workflow** (1×1), **Connection status** (1×1).

The six secondary tiles get **real body copy** — the current tiles have labels only, which is why they say nothing.

**Connection status, not "offline capability."** The tile describes what the code does: surfaces online/offline state and sync status so staff know whether the dashboard is current. This is the honest version of a claim the codebase cannot support (§1.6). Flagged for product decision.

### 4.6 Built for healthcare businesses — `sections/BusinessTypes.jsx`

The one dark band before the fold-heavy middle. `--teal` → `navy` gradient, white text, `rgba(255,255,255,0.85)` body.

All **9 real `BUSINESS_TYPES`**, 3×3 grid at ≥1024 / 2 at 768 / 1 below. Cards are `rgba(255,255,255,0.05)` with a `rgba(255,255,255,0.10)` hairline. Each carries the real emoji icon from the data plus a one-line note.

Those notes are written against the real module and permission system — e.g. Hospitals genuinely get `labelByType: { hospital: 'Patients' }` and the extra triage/lab/imaging/doctor/reception modules, so hospital-specific copy is defensible; pharmacies genuinely get inventory/POS/ecommerce. **No business category is invented**, per the brief. The taxonomy conflict in §11 is a finding, not something this page resolves.

### 4.7 How it works — `sections/WorkflowSteps.jsx`

Three steps, matching the real product flow:

1. **Set up your business** — choose your business type; CareHub shapes the dashboard, navigation and tools around it.
2. **Sell and stock** — ring up sales, record payments, track stock levels, cost prices and reorder points.
3. **See where you stand** — reports on sales, expenses, purchases and VAT, plus your public CareFind listing.

Horizontal at ≥768 with a connecting hairline; vertical with a connector below. Oversized Lora numerals in `tealMist` as a quiet ordinal, 08/12/20/24px bodies.

### 4.8 Capabilities — `sections/Capabilities.jsx`

Four tiles, each a **verified structural fact** — not traction, not performance, not a percentage.

| Number | Label | Verified against |
|---|---|---|
| **32** | Dashboard modules | `lib/permissions.js` `MODULES` — 32 top-level keys, cross-checked against the 32-entry `nav` array |
| **9** | Business types | `config/constants.js` `BUSINESS_TYPES` |
| **8** | Built-in staff roles | `lib/permissions.js` `ROLES` — plus business-defined custom roles |
| **5** | Pricing plans | `lib/planLimits.js` — Basic, Growth, Premium, Enterprise, Custom |

Large Lora numeral in `tealDeep` (5.60:1 — passes), micro-caps label in `navy`, one-line qualifier in `gray600`.

A quiet line beneath: *"Platform capabilities, measured from the product — not usage statistics."* This turns the absence of traction numbers from a weakness into a position.

### 4.9 Pricing — `sections/Pricing.jsx`

**Values are read from `lib/planLimits.js`, not hardcoded.** The current page duplicates the yearlies as string literals (`:52-58`), so the advertised price is not provably the charged price — and that file's own header comment claims `Landing.jsx` as a consumer. This is the single most valuable fix in the section.

- Head: "Plain annual pricing in Naira" · *"Every plan includes POS, inventory, reports and your CareFind listing."* (existing verified sub-line)
- **4 peer cards** — Basic, Growth *(popular)*, Premium, Enterprise — 4 columns ≥1024, 2 at 768, 1 below.
- **Custom is removed from the grid** into a full-width "Bespoke" band below with a `Talk to us` CTA. It is a different motion, not a fifth tier — and this is what fixes the 180px-column cramping.
- **Popular treatment:** Growth gets a 2px `tealDeep` ring, `elevation-3`, a `Most popular` `Pill` in `tealMist`, and a filled CTA. The other three get 1px `--border`, `elevation-1`, outlined CTAs. Premium hierarchy from ring + space + weight — **not** a saturated gradient block. This is the main visual departure from the current page.
- **Monthly equivalence** shown under each annual price, from `PLAN_MONTHLY_NAIRA` (derived, so it can never drift).
- **Hospitals:** Basic renders "Not available for hospitals", from `isPlanAllowedForBusinessType('basic','hospital') === false`. A truthful constraint that doubles as a trust signal.
- **Feature comparison table** below the cards — a real `<table>` with `<caption class="sr-only">`, `scope="col"` headers and `scope="row"` labels. Rows: Staff, Locations, Products, POS, Inventory, Reports, Staff & roles, CareFind listing, Multi-location. `Infinity` renders "Unlimited". Collapses to per-plan cards below 768, following the `DataTable` precedent already in the codebase.

### 4.10 Final CTA — `sections/FinalCta.jsx`

Second and last dark band. Centered, generous, one h2, one line, one button.

- `h2`: "Bring every part of your business into one system."
- Body: *"Stop running your pharmacy, clinic or practice across scattered tools and disconnected processes."*
- Primary: **Get started free** → `/register`.
- Secondary: `Talk to us` → `mailto:support@carehub.ng`.
- Quiet line: *"Plain annual pricing in Naira. Plans for single-location businesses through multi-location groups."* (verified)

### 4.11 Footer — `sections/SiteFooter.jsx`

Seven groups as specified: **Product · Solutions · Resources · Company · Support · Authentication · Legal.**

- 5 columns at ≥1024, 3 at 768, 1 below. White ground, `border-top: 1px solid --border`.
- **Every link resolves to a real destination.** Verified route inventory is exactly: `/`, `/login`, `/register`, `/forgot-password`, `/apply-agent`, `/dashboard`, `/admin`, plus external `carefind.ng` and `mailto:support@carehub.ng`. Plus this page's own anchors.
- **Groups whose pages do not exist (Legal, and most of Resources/Company) are rendered as a labelled "Coming soon" list, not as dead links.** Inventing `/privacy`, `/terms`, `/blog` or `/careers` would 404 into the catch-all `<Navigate to='/' />` and, worse, would promise pages that do not exist. Structure is correct; nothing lies. This gives the team a shipping checklist. Flagged in §11.
- Bottom bar: `Logo size={18}` + `CareHub`, "© 2026 CareHub · Part of the Care ecosystem", a live `carefind.ng` link, and "Prices in Naira (₦), billed annually."

---

## 5. Component & file architecture

The brief forbids one giant JSX file. The current file is 681 lines; this design does not fit that shape and shouldn't be forced into it.

```
apps/carehub/src/pages/landing/
  Landing.jsx                    page shell — composes sections, owns GSAP, skip link
  useLandingMotion.js            GSAP setup + reduced-motion guard (one owner)
  usePrefersReducedMotion.js     matchMedia hook
  components/
    Eyebrow.jsx                  micro-caps label
    SectionHead.jsx              eyebrow + h2 + lead, with generated ids
    ProductFrame.jsx             browser chrome + frame surface
    MiniStat.jsx                 KPI tile for mockups
    SkipLink.jsx                 keyboard escape hatch
  sections/
    NavBar.jsx                   4.1
    Hero.jsx                     4.2
    HeroDashboard.jsx            4.2 product column
    TrustStrip.jsx               4.3
    ProductShowcase.jsx          4.4
    FeatureBento.jsx             4.5
    MiniPos.jsx                  4.5 embedded POS UI
    BusinessTypes.jsx            4.6
    WorkflowSteps.jsx            4.7
    Capabilities.jsx             4.8
    Pricing.jsx                  4.9
    PricingTable.jsx             4.9 comparison
    FinalCta.jsx                 4.10
    SiteFooter.jsx               4.11
  data/
    navigation.js                nav + footer link manifests
    features.js                  bento content
    workflow.js                  3 steps
    capabilities.js              4 verified figures
    businessTypes.js             BUSINESS_TYPES + per-type notes
  landing.styles.js              injected <style> for the 3 things inline styles cannot do
```

`src/pages/Landing.jsx` becomes a thin re-export shim so `App.jsx`'s lazy import at `App.jsx:9` and the route at `App.jsx:140` keep working untouched.

### 5.1 Rules this implementation follows

1. **No new design system.** Every colour, radius, shadow, easing and font comes from `styles/theme`. Every primitive from `components/ui`. The shared `@care-ecosystem/design-system` package is consumed through the existing Vite alias, as it already is.
2. **House styling style** — React inline style objects, token-first, with a single injected `<style>` for the three things inline styles genuinely cannot express: the dark-surface focus ring, `.sr-only`, and the reduced-motion nuke. This matches `Sheet.jsx`, `Toast.jsx` and `AdminDashboard.jsx`.
3. **No new dependencies.** GSAP and `lucide-react` are already present and sufficient.
4. **Data flows one way.** `BUSINESS_TYPES` and `PLAN_*` are imported from their existing homes. Pricing, business types and capabilities are never re-typed into the landing folder.
5. **Prefer `auto-fit, minmax()` over breakpoints** for anything inside a mockup or grid that can be self-sizing; use `useBreakpoint` only for genuine page-level layout switches. This is what makes 375/390 correct without a JS branch.

---

## 6. Motion

The brief asks for restraint. The current page runs 13 animation blocks with 1.2s durations and 60px travel.

**Single owner.** All of it in `useLandingMotion.js`, one `gsap.context()` scoped to the page root, reverted on unmount — the pattern already in the codebase.

| Target | Effect | Duration | Stagger |
|---|---|---|---|
| Hero copy + product | fade, 20px rise | 0.7s | 0.06 |
| Product showcase | fade, 24px rise, 0.98→1 scale | 0.8s | — |
| Bento tiles | fade, 16px rise | 0.6s | 0.05 |
| Section heads | fade, 16px rise | 0.6s | — |
| Workflow, capabilities, pricing | fade, 16px rise | 0.6s | 0.05 |

Start: `top 85%`. Ease: `power3.out`. Once only — no scrub, no repeat, no parallax, no continuous motion, no zoom. Max travel 24px (down from 60).

**Reduced motion.** `usePrefersReducedMotion()` reads `matchMedia('(prefers-reduced-motion: reduce)')` and, when set, `useLandingMotion` returns before creating a single tween or `ScrollTrigger` — elements render in their natural, final state. This follows the existing convention in `Sheet.jsx:23-25`. A CSS-level nuke additionally neutralises the nav's inline transitions. **This gap exists in the current page and is closed here.**

The nav's `ScrollTrigger` (hero-bottom → scrolled) becomes a plain passive scroll listener — it is a state change, not an animation, and should not depend on GSAP.

---

## 7. Accessibility

| Requirement | Implementation |
|---|---|
| Semantic headings | One `h1`; every section `<section aria-labelledby>` + `<h2 id>`; tiles `<h3>`. No heading-level skips. |
| Landmarks | `<header>`, `<nav aria-label="Primary">`, `<main>`, `<footer>`. |
| Skip link | First focusable element; visually hidden until focused; targets `#main`. |
| Keyboard | Nav disclosure: `aria-expanded` / `aria-controls`, Esc, click-outside, focus return. All focusable things are real `<a>`/`<button>`. |
| Mobile nav | Restores Features/Pricing reachability — the current page's worst defect. |
| Focus states | Global `:focus-visible` teal ring. Added override on dark surfaces (white ring) — see §9. |
| Contrast | §2.1. All body copy moves from `gray500` (2.78:1) to `gray600` (5.17:1). |
| Touch targets | 44px minimum on every interactive element (`theme.button.height.md`). |
| Route navigation | `<Link>`/`<a>` instead of `<button onClick={navigate}>` — crawlable, focusable, announced on SPA nav. |
| Decorative product UI | `role="img"` + `aria-label`, inner `aria-hidden`, zero focusable controls. |
| Comparison table | Real `<table>` with `<caption class="sr-only">` and `scope` attributes. |
| Motion | §6. |
| Scroll offset | `scroll-margin-top: 84px` on every anchored section so the sticky nav never covers a heading. |

---

## 8. Responsive

Verified against the five required widths plus the extremes.

| Width | Nav | Hero | Bento | Showcase | Pricing | Footer |
|---|---|---|---|---|---|---|
| 375 | logo + toggle + CTA | stacked, product below copy | 1 col | 1 col, KPIs 2-up | 1 col, cards then table cards | 1 col |
| 390 | as 375 | as 375 | 1 col | as 375 | 1 col | 1 col |
| 768 | full links appear | 2 col, tight gap | 2 col | 2 col, KPIs 4-up | 2 col | 3 col |
| 1024 | full | 2 col | 6 col, POS 3×2 | 2 col | 4 col, table shown | 5 col |
| 1440 | full, 1200 container | 2 col | 6 col | 2 col | 4 col | 5 col |

Guardrails:
- **No horizontal overflow anywhere.** Every grid is `minmax(0, 1fr)`; long strings get `min-width: 0` + `overflow-wrap`. `overflow-x: hidden` is **not** used as a crutch — it is removed from `<main>`, because it was hiding the problem rather than fixing it. If nothing overflows, nothing needs hiding.
- **No oversized typography.** `clamp()` on every headline, with mobile maxima well below desktop.
- **No unusable buttons.** CTAs never wrap mid-label, never shrink below 44px, never lose their tap target.
- Product mockups reflow via `auto-fit, minmax()` rather than transform-scale, so nothing becomes blurry or unreachable on a phone.

---

## 9. The injected stylesheet

`landing.styles.js` injects exactly three rules that inline styles cannot express, following the `Sheet.jsx` / `Toast.jsx` pattern with an id guard:

1. `.sr-only` — visually hidden but focusable/announced.
2. Dark-surface focus ring — `:focus-visible` overridden to white on `[data-surface="dark"]`, since the global teal ring is invisible on teal.
3. `@media (prefers-reduced-motion: reduce)` — zeroes animation and transition duration on landing-scoped elements, backing up the JS guard.

Everything else is an inline style object reading `theme`.

---

## 10. Verification plan

| Check | Command | Pass condition |
|---|---|---|
| Lint | `eslint src api --ext .js,.jsx` | No new errors (see §10.1) |
| Tests | `npm test` | No new failures vs. baseline (see §10.2) |
| Build | `npm run build` | Succeeds |
| Responsive | Manual review at 375 / 390 / 768 / 1024 / 1440 | §8 matrix holds |
| Overflow | `document.documentElement.scrollWidth` at each width | ≤ `clientWidth` |
| Keyboard | Tab through, open/close mobile nav, skip link | §7 table holds |
| Contrast | Ratio check per §2.1 | All body ≥4.5:1 |
| Reduced motion | Emulate `prefers-reduced-motion` | Content visible, no motion |

**Test plan for the new code.** A `landing.test.jsx` covering: the page renders its `h1`; all four nav anchors resolve to an element that exists; the mobile nav toggle sets `aria-expanded`; the pricing section renders prices from `planLimits.js` (asserting against the real constants, so a price change fails the test); every footer link has a non-empty, real `href`; no rendered element has horizontal overflow at 375px; the Basic plan shows the hospital restriction.

### 10.1 A pre-existing tooling break

`npm run lint` **does not run** in this repo state. `apps/carehub/package.json` pins `eslint: ^8.57.0`, but it is absent from `node_modules`; the only resolvable ESLint is v10, which no longer reads `.eslintrc.json`:

```
ESLint: 10.11.0
ESLint couldn't find an eslint.config.* file.
```

Migration to flat config is a repo-wide tooling change and is out of scope for a landing-page redesign — silently converting it could break the team's CI. Lint is therefore verified by running ESLint v10 against a **temporary** flat config that mirrors `.eslintrc.json` exactly, without modifying the repo. This must be reported honestly rather than presented as a green `npm run lint`.

### 10.2 The pre-existing red suite was load-induced, not real

An earlier draft of this section recorded a red baseline on `main`: **4 files / 9 tests failing**, all unrelated to the landing page. That baseline was wrong, and the reason matters.

Every one of those failures was `Test timed out in 5000ms` — never an assertion failure. Re-running each file in isolation passed. The machine was simply saturated by an unrelated long-running dev server, and jsdom mounts full React trees without any of the work a browser offloads, so wall-clock timeouts were the only thing being measured.

**Current state: `85/85` files and `1018/1018` tests pass.** Two changes got it there, both about measurement rather than product code:

1. **`testTimeout` / `hookTimeout` raised to 30s** in `vitest.config.js`. Vitest's 5s/10s defaults are wall-clock. Several suites mount large component trees, so on a busy box they failed tests that pass in isolation — a test whose only assertion is "this does not hang" was being enforced by a clock.
2. **The landing suites mount the page once instead of per test.** `landing.test.jsx` was doing 20 full mounts and `responsive.test.jsx` 24, because each test rebuilt the page it was about to read. Since `useBreakpoint` re-reads `window.innerWidth` on `resize`, both files now mount once and drive viewports through a resize event — the same code path a real device rotation takes. This took the two files from 14.4s to 9.7s and removed the only genuine flakiness.

The lesson worth carrying: a timeout failure on an isolated component test is a claim about the machine, not about the code. Confirm it in isolation before treating it as a defect.

---

## 11. Open decisions for the product owner

Raised because the redesign is marketing copy and these are claims about the product, not design preferences. **None are resolved unilaterally.**

1. **The 30-day free trial does not exist in code.** It appears only in the old `Landing.jsx`. Either build it or drop the claim. This redesign drops it.
2. **Offline capability is not implemented.** No service worker, no offline queue, no local write path — only an `navigator.onLine` flag. This redesign ships "Connection status" and flags it.
3. **The business-type taxonomy is contradictory.** `config/constants.js` `BUSINESS_TYPES` has 9 entries (pharmacy, hospital, clinic, laboratory, aesthetic, spa, cosmetics, haircare, other) while `lib/permissions.js` `ALL_TYPES` has 8 entirely different ones (skincare, pharmacy, dental, optical, wellness, hospital, manufacturer_importer, wholesale). **No overlap beyond pharmacy and hospital.** Signup uses `BIZ_ICONS` from the second list while importing `BUSINESS_TYPES` from the first, so the site advertises types signup will not accept. This page renders `BUSINESS_TYPES` per the brief — which means it currently advertises dental, optical and supplier businesses that the brief's positioning paragraph mentions but the app does not support.
4. **Pricing disagrees with the database.** `lib/planLimits.js` and the `plan_catalog` seed in `sql/20260908_admin_money.sql` are structurally incompatible: Basic is ₦60,000/year in code but ₦0/month in the DB; Enterprise is ₦250,000/year vs ₦50,000/month; the DB's second tier is a `pro` key no client code can resolve; and `business_subscriptions.plan_key` foreign-keys to `plan_catalog(key)`, so they cannot currently agree. **A customer could be quoted one price and charged another.** This is the most serious finding in the inspection and it is a payments/business-logic issue, so it is out of scope here and must be fixed.
5. **Legal pages do not exist.** Privacy, Terms and Security are rendered as "Coming soon" rather than invented. They need an owner.
6. **The product claim "AI and intelligent technology" is unverifiable.** No AI code was found in `src/`. The old page's dedicated AI section is removed.
