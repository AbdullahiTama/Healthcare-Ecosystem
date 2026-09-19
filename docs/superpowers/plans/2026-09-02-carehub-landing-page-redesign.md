# CareHub Landing Page Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the CareHub landing page to position it as an intelligent business management and visibility platform for healthcare, wellness, beauty, and personal-care businesses.

**Architecture:** Single-file rewrite of `Landing.jsx` with updated constants and SEO meta tags. Reuses existing theme tokens, GSAP animations, lucide-react icons, and inline-style conventions. No new dependencies.

**Tech Stack:** React 18, Vite, GSAP (ScrollTrigger), lucide-react, react-router-dom, inline styles

**Spec:** `docs/superpowers/specs/2026-09-02-carehub-landing-page-redesign.md`

## Global Constraints

- Inline styles only (codebase convention) — no CSS modules, no Tailwind
- All colors, spacing, radius, typography from `theme.js` via `packages/design-system/src/theme.js`
- No new npm dependencies
- No generic AI-generated wording, no unsupported AI claims
- Professional, modern, premium, trustworthy tone
- Responsive: mobile (<768px), tablet (768-1024px), desktop (>1024px)
- GSAP for scroll animations, `useBreakpoint` for responsive logic
- Accessible: heading hierarchy h1→h2→h3, alt text on images, focus-visible states

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/carehub/src/config/constants.js` | Modify | Update `BUSINESS_TYPES` to 9 categories |
| `apps/carehub/index.html` | Modify | Update `<title>` and `<meta name="description">` |
| `apps/carehub/src/pages/Landing.jsx` | Rewrite | Full landing page with 15 sections |

---

### Task 1: Update BUSINESS_TYPES constant

**Files:**
- Modify: `apps/carehub/src/config/constants.js:4-13`

**Interfaces:**
- Consumes: none
- Produces: `BUSINESS_TYPES` array with 9 items (used by Landing.jsx business types strip and "Who CareHub Is For" section)

- [ ] **Step 1: Replace BUSINESS_TYPES array**

Replace the existing 8-item array with:

```js
export const BUSINESS_TYPES = [
  { id: 'pharmacy',      icon: '💊', name: 'Pharmacies' },
  { id: 'hospital',      icon: '🏥', name: 'Hospitals' },
  { id: 'clinic',        icon: '🩺', name: 'Clinics & Medical Centres' },
  { id: 'laboratory',    icon: '🧪', name: 'Laboratories' },
  { id: 'aesthetic',     icon: '✨', name: 'Aesthetic Clinics' },
  { id: 'spa',           icon: '🌿', name: 'Spas & Wellness Centres' },
  { id: 'cosmetics',     icon: '💄', name: 'Cosmetics & Beauty' },
  { id: 'haircare',      icon: '💇', name: 'Hair-Care & Salons' },
  { id: 'other',         icon: '🏥', name: 'Other Healthcare' },
]
```

Keep `NIG_STATES`, `EXPENSE_CATS`, `PRODUCT_CATS`, `PRODUCT_EMOJIS` unchanged.

- [ ] **Step 2: Verify no broken imports**

Run: `cd apps/carehub && npx vite build --mode development 2>&1 | head -20`
Expected: No errors about BUSINESS_TYPES

- [ ] **Step 3: Commit**

```bash
git add apps/carehub/src/config/constants.js
git commit -m "chore: update BUSINESS_TYPES to match landing page spec categories"
```

---

### Task 2: Update SEO meta tags

**Files:**
- Modify: `apps/carehub/index.html:6-10`

**Interfaces:**
- Consumes: none
- Produces: updated `<title>` and `<meta name="description">`

- [ ] **Step 1: Update title and meta description**

Replace lines 6-10 of `index.html`:

```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#0f766e" />
    <meta name="description" content="CareHub is an intelligent business management platform fully designed for healthcare, wellness, beauty and personal-care businesses. Manage inventory, sales, staff, appointments, finances and more while increasing visibility across the CareFind health social platform. Start your 30-day free trial." />
    <link rel="manifest" href="/manifest.json" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>CareHub | Smart Business Management Software for Healthcare, Wellness &amp; Beauty Businesses</title>
```

- [ ] **Step 2: Commit**

```bash
git add apps/carehub/index.html
git commit -m "chore: update SEO meta tags for CareHub landing page"
```

---

### Task 3: Rewrite Landing.jsx — Nav and Hero sections

**Files:**
- Modify: `apps/carehub/src/pages/Landing.jsx` (full rewrite, start fresh)

**Interfaces:**
- Consumes: `theme` from `../styles/theme`, `Logo` from `../components/ui`, `BUSINESS_TYPES` from `../config/constants`, `useBreakpoint` from `../hooks/useBreakpoint`
- Produces: Landing component with glass nav and hero section

- [ ] **Step 1: Write the Nav and Hero skeleton**

Create the new `Landing.jsx` with imports, theme destructuring, component definition, nav, and hero section. The nav follows the existing glass-pill pattern. The hero uses the new spec copy.

Key elements:
- Imports: `useEffect, useRef, useState` from react, `useNavigate` from react-router-dom, lucide icons (`ArrowRight, Package, ShoppingCart, Users, BarChart2, Search, MapPin, WifiOff, Clipboard, Clock, Star, CheckCircle, Check as CheckIcon, ChevronLeft, ChevronRight, Banknote, Wallet, Heart, Eye`), `gsap`, `ScrollTrigger`, `theme`, `Logo`, `BUSINESS_TYPES`, `useBreakpoint`
- Register ScrollTrigger plugin
- Destructure theme tokens
- State: `navScrolled`, `activeTestimonial` (if keeping testimonials — spec removed them, so just `navScrolled`)
- Nav: fixed pill, glass effect, Logo + "CareHub", Features link, Pricing link, Sign in button, Start free trial button
- Hero: gradient bg, headline "Run Your Healthcare Business Smarter. Get Seen. Grow Faster.", subhead, body text, dual CTA, trust badges

- [ ] **Step 2: Verify dev server starts**

Run: `cd apps/carehub && npm run dev`
Expected: Page loads, nav and hero render, no console errors

- [ ] **Step 3: Commit**

```bash
git add apps/carehub/src/pages/Landing.jsx
git commit -m "feat: landing page nav and hero sections"
```

---

### Task 4: Landing.jsx — Business Types Strip

**Files:**
- Modify: `apps/carehub/src/pages/Landing.jsx`

**Interfaces:**
- Consumes: `BUSINESS_TYPES` from constants
- Produces: Business types strip section rendered after hero

- [ ] **Step 1: Add Business Types Strip section**

After the hero `</div>`, add the business types strip:
- Section label: "Built for your type of business" (uppercase, small, gray)
- Horizontal flex wrap of pills
- Each pill: icon + name, white bg, rounded-full, border, small font
- GSAP scroll trigger: fade-in from left with stagger

- [ ] **Step 2: Verify in browser**

Run: `cd apps/carehub && npm run dev`
Expected: Business types strip appears below hero, 9 pills visible

- [ ] **Step 3: Commit**

```bash
git add apps/carehub/src/pages/Landing.jsx
git commit -m "feat: landing page business types strip section"
```

---

### Task 5: Landing.jsx — Core Positioning Bento Grid

**Files:**
- Modify: `apps/carehub/src/pages/Landing.jsx`

**Interfaces:**
- Consumes: theme tokens, lucide icons
- Produces: Bento grid section with featured card + standard cards

- [ ] **Step 1: Add Core Positioning section**

After business types strip, add:
- Heading: "Everything Your Business Needs. In One Place."
- Subhead: "CareHub brings the essential tools required to manage modern healthcare and related businesses into one connected platform."
- Bento grid (3-col desktop, 1-col mobile):
  - Featured card (span 2 cols, teal gradient bg): Inventory Management
  - Standard cards: Sales & POS, Staff Management, Client Management, Financial Management, Reporting, Demand Intelligence, Appointments, Multi-location, E-commerce, CareFind Visibility, Pharmacovigilance
- Each card: lucide icon + title + one-line description
- GSAP: scroll-triggered fade-in with stagger

- [ ] **Step 2: Verify in browser**

Run: `cd apps/carehub && npm run dev`
Expected: Bento grid renders, featured card spans 2 cols on desktop, all cards visible

- [ ] **Step 3: Commit**

```bash
git add apps/carehub/src/pages/Landing.jsx
git commit -m "feat: landing page core positioning bento grid"
```

---

### Task 6: Landing.jsx — Business Visibility section

**Files:**
- Modify: `apps/carehub/src/pages/Landing.jsx`

**Interfaces:**
- Consumes: theme tokens, lucide icons
- Produces: Split layout section for CareFind visibility

- [ ] **Step 1: Add Business Visibility section**

After bento grid, add:
- Heading: "Don't Just Manage Your Business. Get Discovered."
- Body text about CareFind health social platform visibility
- Split layout: text left (2/3), visual right (1/3)
- Text side: paragraph + bullet points (discover business, services, products)
- Visual side: abstract teal gradient card with "CareFind" branding
- Tagline: "Manage your business with CareHub. Get discovered through CareFind."
- GSAP: scroll-triggered fade-in

- [ ] **Step 2: Verify in browser**

Run: `cd apps/carehub && npm run dev`
Expected: Split layout renders, text and visual side by side on desktop, stacked on mobile

- [ ] **Step 3: Commit**

```bash
git add apps/carehub/src/pages/Landing.jsx
git commit -m "feat: landing page business visibility section"
```

---

### Task 7: Landing.jsx — Inventory & Operations section

**Files:**
- Modify: `apps/carehub/src/pages/Landing.jsx`

**Interfaces:**
- Consumes: theme tokens, lucide icons
- Produces: 6-item icon grid for inventory features

- [ ] **Step 1: Add Inventory & Operations section**

After business visibility, add:
- Heading: "Know What You Have. Know What You Need."
- 6-item grid (3x2 desktop, 2-col mobile):
  1. Track inventory and stock levels (Package icon)
  2. Monitor product movement (BarChart2 icon)
  3. Identify products requiring attention (Search icon)
  4. Support restocking decisions (Clipboard icon)
  5. Manage inventory across locations (MapPin icon)
  6. Connect eligible products to e-commerce (ShoppingCart icon)
- Each item: small icon in teal bg circle + short text
- Clean, minimal cards with subtle border
- GSAP: scroll-triggered fade-in with stagger

- [ ] **Step 2: Verify in browser**

Run: `cd apps/carehub && npm run dev`
Expected: 6 items in grid, icons render, responsive layout works

- [ ] **Step 3: Commit**

```bash
git add apps/carehub/src/pages/Landing.jsx
git commit -m "feat: landing page inventory and operations section"
```

---

### Task 8: Landing.jsx — Intelligent Technology section

**Files:**
- Modify: `apps/carehub/src/pages/Landing.jsx`

**Interfaces:**
- Consumes: theme tokens
- Produces: Accent card section for AI/intelligent technology

- [ ] **Step 1: Add Intelligent Technology section**

After inventory section, add:
- Heading: "Built With Intelligent Technology for Modern Businesses."
- Single wide card with teal gradient background
- Body: "CareHub uses AI and intelligent technology as part of its vision for smarter business operations. The platform should help businesses turn operational information into useful insights, reduce guesswork and support better decisions."
- Tagline: "Less guesswork. More control. Better decisions."
- No specific AI claims
- GSAP: scroll-triggered scale+opacity

- [ ] **Step 2: Verify in browser**

Run: `cd apps/carehub && npm run dev`
Expected: Teal gradient card renders centered, text visible

- [ ] **Step 3: Commit**

```bash
git add apps/carehub/src/pages/Landing.jsx
git commit -m "feat: landing page intelligent technology section"
```

---

### Task 9: Landing.jsx — E-Commerce section

**Files:**
- Modify: `apps/carehub/src/pages/Landing.jsx`

**Interfaces:**
- Consumes: theme tokens, lucide icons
- Produces: 3-step vertical flow for e-commerce

- [ ] **Step 1: Add E-Commerce section**

After intelligent technology, add:
- Heading: "Turn Your Inventory Into an Online Storefront."
- 3-step vertical flow:
  1. Select eligible products from inventory
  2. Complete e-commerce info (image, description required)
  3. Activate for CareFind Shop visibility
- Each step: numbered circle (teal bg) + title + description
- Vertical connecting line between steps
- GSAP: scroll-triggered fade-in with stagger

- [ ] **Step 2: Verify in browser**

Run: `cd apps/carehub && npm run dev`
Expected: 3 steps render vertically, numbers visible, connecting line present

- [ ] **Step 3: Commit**

```bash
git add apps/carehub/src/pages/Landing.jsx
git commit -m "feat: landing page e-commerce section"
```

---

### Task 10: Landing.jsx — Business Intelligence section

**Files:**
- Modify: `apps/carehub/src/pages/Landing.jsx`

**Interfaces:**
- Consumes: theme tokens, lucide icons
- Produces: Metrics visual section

- [ ] **Step 1: Add Business Intelligence section**

After e-commerce, add:
- Heading: "Don't Just Run Your Business. Understand It."
- Body: "CareHub helps transform everyday business activity into useful information so owners and managers can better understand sales, inventory, expenses, debts, demand and financial performance."
- 4 metric cards in grid (2x2 desktop, 1-col mobile):
  1. Revenue (BarChart2 icon)
  2. Inventory (Package icon)
  3. Expenses (Wallet icon)
  4. Demand (Search icon)
- Each card: icon + label, clean white bg, subtle border
- Tagline: "Make decisions based on your business data, not guesswork."
- GSAP: scroll-triggered fade-in

- [ ] **Step 2: Verify in browser**

Run: `cd apps/carehub && npm run dev`
Expected: 4 metric cards render in grid, responsive

- [ ] **Step 3: Commit**

```bash
git add apps/carehub/src/pages/Landing.jsx
git commit -m "feat: landing page business intelligence section"
```

---

### Task 11: Landing.jsx — Staff, Locations, Offline section

**Files:**
- Modify: `apps/carehub/src/pages/Landing.jsx`

**Interfaces:**
- Consumes: theme tokens, lucide icons
- Produces: 3-column card grid

- [ ] **Step 1: Add Staff/Locations/Offline section**

After business intelligence, add:
- 3 cards side by side (3-col desktop, 1-col mobile):
  1. Staff: "Your Team. Your Business. Your Control." — manage staff accounts, roles, responsibilities
  2. Locations: "One Business. Multiple Locations. One System." — centralized visibility across locations
  3. Offline: "Keep Your Business Moving." — essential operations without internet, sync when connected
- Each card: icon (Users, MapPin, WifiOff) + heading + description
- White bg, subtle border, consistent padding
- GSAP: scroll-triggered fade-in with stagger

- [ ] **Step 2: Verify in browser**

Run: `cd apps/carehub && npm run dev`
Expected: 3 cards in a row on desktop, stacked on mobile

- [ ] **Step 3: Commit**

```bash
git add apps/carehub/src/pages/Landing.jsx
git commit -m "feat: landing page staff locations offline section"
```

---

### Task 12: Landing.jsx — Who CareHub Is For section

**Files:**
- Modify: `apps/carehub/src/pages/Landing.jsx`

**Interfaces:**
- Consumes: `BUSINESS_TYPES`, theme tokens
- Produces: Two-column business type list

- [ ] **Step 1: Add Who CareHub Is For section**

After staff/locations/offline, add:
- Heading: "Built for the Businesses That Keep Healthcare, Wellness and Personal Care Moving."
- Two columns (desktop), single column (mobile):
  - Pharmacies — inventory, sales, staff, customers, locations
  - Hospitals and clinics — operations, appointments, staff, patients
  - Laboratories — operations, services, clients, staff
  - Aesthetic clinics — services, appointments, staff, clients
  - Spas and wellness centres — appointments, services, staff, products
  - Cosmetics and beauty businesses — products, inventory, sales, staff
  - Hair-care businesses and salons — appointments, services, staff, products
  - Other eligible businesses
- Each: icon (from BUSINESS_TYPES) + bold title + description
- GSAP: scroll-triggered fade-in

- [ ] **Step 2: Verify in browser**

Run: `cd apps/carehub && npm run dev`
Expected: 8 items in 2 columns on desktop, single column on mobile

- [ ] **Step 3: Commit**

```bash
git add apps/carehub/src/pages/Landing.jsx
git commit -m "feat: landing page who carehub is for section"
```

---

### Task 13: Landing.jsx — Why CareHub section

**Files:**
- Modify: `apps/carehub/src/pages/Landing.jsx`

**Interfaces:**
- Consumes: theme tokens, lucide icons
- Produces: Checkmark list section

- [ ] **Step 1: Add Why CareHub section**

After Who CareHub Is For, add:
- Heading: "Why CareHub"
- Checkmark list (CheckIcon + text):
  - Fully designed for healthcare and related service businesses
  - Business-specific tools based on business type
  - One platform for core operations
  - Greater visibility across CareFind
  - Intelligent technology for smarter decisions
  - Scalable for single and multiple-location businesses
  - 30-day free trial
- Clean layout, centered, max-width container
- GSAP: scroll-triggered fade-in

- [ ] **Step 2: Verify in browser**

Run: `cd apps/carehub && npm run dev`
Expected: 7 checkmark items render, centered

- [ ] **Step 3: Commit**

```bash
git add apps/carehub/src/pages/Landing.jsx
git commit -m "feat: landing page why carehub section"
```

---

### Task 14: Landing.jsx — Pricing section (updated)

**Files:**
- Modify: `apps/carehub/src/pages/Landing.jsx`

**Interfaces:**
- Consumes: theme tokens, lucide icons, `useNavigate`
- Produces: Pricing grid section

- [ ] **Step 1: Add Pricing section**

After Why CareHub, add:
- Heading: "Plain pricing in Naira"
- Subhead: "Every plan includes POS, inventory, reports and your CareFind listing."
- Pricing grid (auto-fit, minmax 180px):
  - Plans: Basic (₦60k/yr), Growth (₦100k/yr, MOST POPULAR), Premium (₦150k/yr), Enterprise (₦250k/yr), Custom
  - Each: name, price, feature list, CTA button
- Trial reference updated to "30-day free trial"
- CTA: "Start with [Plan]" or "Talk to us" for Enterprise/Custom
- GSAP: scroll-triggered fade-in with stagger

- [ ] **Step 2: Verify in browser**

Run: `cd apps/carehub && npm run dev`
Expected: 5 pricing cards render, Growth has "MOST POPULAR" badge, buttons navigate to /register

- [ ] **Step 3: Commit**

```bash
git add apps/carehub/src/pages/Landing.jsx
git commit -m "feat: landing page pricing section with 30-day trial"
```

---

### Task 15: Landing.jsx — Final CTA and Footer

**Files:**
- Modify: `apps/carehub/src/pages/Landing.jsx`

**Interfaces:**
- Consumes: theme tokens, lucide icons, `Logo`, `useNavigate`
- Produces: Final CTA section and footer

- [ ] **Step 1: Add Final CTA section**

After pricing, add:
- Heading: "Your Business Deserves a Smarter Way to Operate."
- Body: "Stop managing your business through scattered tools and disconnected processes. Bring your operations together, gain better control, increase your visibility and build for growth with technology designed around your business."
- Dual CTA: "Get Started Free" (solid white) + "Explore CareHub" (outline)
- Tagline: "Manage smarter. Operate better. Get discovered. Grow with CareHub."
- Full-width teal gradient background
- GSAP: scroll-triggered scale+opacity

- [ ] **Step 2: Add Footer**

After CTA, add:
- Logo + copyright: "© 2026 CareHub · Part of the Care ecosystem"
- Links: Features, Pricing, CareFind, support@carehub.ng
- Existing pattern from current landing page

- [ ] **Step 3: Add GSAP animations**

Add all GSAP ScrollTrigger animations in the `useEffect`:
- Hero: staggered fade-in on load
- Business types: scroll-triggered fade-in from left
- Feature cards: scroll-triggered fade-in with stagger
- Step cards: scroll-triggered with scale
- CTA: scroll-triggered scale+opacity
- Nav: ScrollTrigger for background transition

- [ ] **Step 4: Verify full page in browser**

Run: `cd apps/carehub && npm run dev`
Expected: Complete landing page renders with all 15 sections, animations fire on scroll

- [ ] **Step 5: Run build to verify no errors**

Run: `cd apps/carehub && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 6: Commit**

```bash
git add apps/carehub/src/pages/Landing.jsx
git commit -m "feat: landing page final CTA, footer, and GSAP animations"
```

---

### Task 16: Final verification and cleanup

**Files:**
- Verify: `apps/carehub/src/pages/Landing.jsx`
- Verify: `apps/carehub/src/config/constants.js`
- Verify: `apps/carehub/index.html`

**Interfaces:**
- Consumes: all previous tasks
- Produces: verified, working landing page

- [ ] **Step 1: Full responsive test**

Run: `cd apps/carehub && npm run dev`
Test at: 375px (mobile), 768px (tablet), 1024px (laptop), 1440px (desktop)
Check: nav, hero, grids, pricing, footer all responsive

- [ ] **Step 2: Accessibility check**

Verify:
- Single h1 in hero
- h2 for each section heading
- Alt text on all images
- Focus-visible states on buttons and links
- Keyboard navigation works

- [ ] **Step 3: SEO verification**

View page source, verify:
- `<title>` matches spec
- `<meta name="description">` matches spec
- Heading hierarchy is correct

- [ ] **Step 4: Final build**

Run: `cd apps/carehub && npm run build`
Expected: Clean build, no warnings

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete CareHub landing page redesign

- Rewrote Landing.jsx with 15 sections per spec
- Updated BUSINESS_TYPES to 9 categories
- Updated SEO meta tags
- Removed referral agent, appointment booking, payment sections
- Added business visibility, e-commerce, business intelligence sections
- 30-day free trial throughout
- Responsive, accessible, GSAP animations"
```
