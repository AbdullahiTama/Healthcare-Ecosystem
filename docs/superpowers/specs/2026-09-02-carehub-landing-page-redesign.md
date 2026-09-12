# CareHub Landing Page Redesign — Design Spec

**Date:** 2026-09-02
**Scope:** Rewrite `apps/carehub/src/pages/Landing.jsx` in place
**Route:** `/` (unchanged)

---

## Goal

Replace the current landing page with a new version that positions CareHub as an intelligent business management and visibility platform for healthcare, wellness, beauty, and personal-care businesses. The new page emphasizes business-specific tools, CareFind visibility, and a 30-day free trial.

---

## Section Structure

### 1. Glass Nav (existing pattern, updated)

- Fixed pill nav, top-center
- Logo + "CareHub" text
- Desktop: Features link, Pricing link
- Sign in button (outline), Start free trial button (solid)
- Background transitions from transparent to white on scroll
- Uses existing `navScrolled` state and GSAP ScrollTrigger

### 2. Hero

**Headline:** `Run Your Healthcare Business Smarter. Get Seen. Grow Faster.`
**Subhead:** `The intelligent business management platform fully designed for your healthcare, wellness, beauty and personal-care business.`
**Body:** `Manage your inventory, sales, staff, clients, finances, appointments, locations and daily operations from one powerful platform, while giving your business greater visibility across the CareFind health social platform.`

- Dual CTA: "Start Your 30-Day Free Trial" (solid white) + "See How CareHub Works" (outline)
- Trust badges: "30-day free trial · No complicated setup"
- Background: deep teal gradient with subtle radial overlay
- GSAP fade-in animation on load (existing pattern)

### 3. Business Types Strip

- Horizontal scrollable row of pills
- Updated `BUSINESS_TYPES` constant (see below)
- Each pill: icon + name, white bg, rounded-full, border
- Section label: "Built for your type of business"

### 4. Core Positioning — Bento Grid

**Heading:** `Everything Your Business Needs. In One Place.`
**Subhead:** `CareHub brings the essential tools required to manage modern healthcare and related businesses into one connected platform.`

Bento grid layout (3-col desktop, 1-col mobile):
- **Featured card (span 2 cols):** Inventory Management — teal gradient bg, white text
- **Standard cards:** Sales & POS, Staff Management, Client Management, Financial Management, Reporting, Demand Intelligence, Appointments, Multi-location, E-commerce, CareFind Visibility, Pharmacovigilance

Each card: icon (lucide-react) + title + one-line description.

### 5. Business Visibility — Split Layout

**Heading:** `Don't Just Manage Your Business. Get Discovered.`
**Body:** `CareHub gives businesses greater visibility across the CareFind health social platform, helping potential customers discover the business, its services, products and relevant information.`

- Left: text content + bullet points
- Right: visual representation (abstract or illustration-style)
- Emphasis: "Manage your business with CareHub. Get discovered through CareFind."

### 6. Inventory & Operations — Icon Grid

**Heading:** `Know What You Have. Know What You Need.`

6-item grid (3x2 desktop, 2-col mobile):
- Track inventory and stock levels
- Monitor product movement
- Identify products requiring attention
- Support restocking decisions
- Manage inventory across locations
- Connect eligible products to e-commerce

Each item: small icon + short text. Clean, minimal cards.

### 7. Intelligent Technology — Accent Card

**Heading:** `Built With Intelligent Technology for Modern Businesses.`

- Single wide card with teal gradient background
- Body: "CareHub uses AI and intelligent technology as part of its vision for smarter business operations."
- Tagline: "Less guesswork. More control. Better decisions."
- No specific AI capability claims (per spec)

### 8. E-Commerce — Step Flow

**Heading:** `Turn Your Inventory Into an Online Storefront.`

3-step vertical flow:
1. Select eligible products from inventory
2. Complete e-commerce info (image, description required)
3. Activate for CareFind Shop visibility

Each step: numbered circle + title + description. Connected by vertical line.

### 9. Business Intelligence — Metrics Visual

**Heading:** `Don't Just Run Your Business. Understand It.`

- Grid of 4 metric cards (Revenue, Inventory, Expenses, Demand)
- Each: icon + label + implied value
- Body: "CareHub helps transform everyday business activity into useful information."

### 10. Staff, Locations, Offline — 3-Column Grid

**Three cards side by side:**

| Card | Heading | Description |
|------|---------|-------------|
| Staff | `Your Team. Your Business. Your Control.` | Manage staff accounts, roles, responsibilities and access |
| Locations | `One Business. Multiple Locations. One System.` | Centralized visibility and control across locations |
| Offline | `Keep Your Business Moving.` | Essential operations work without internet; syncs when connected |

### 11. Who CareHub Is For — Two-Column List

**Heading:** `Built for the Businesses That Keep Healthcare, Wellness and Personal Care Moving.`

Two columns (desktop), single column (mobile):
- Pharmacies — inventory, sales, staff, customers, locations
- Hospitals and clinics — operations, appointments, staff, patients
- Laboratories — operations, services, clients, staff
- Aesthetic clinics — services, appointments, staff, clients
- Spas and wellness centres — appointments, services, staff, products
- Cosmetics and beauty businesses — products, inventory, sales, staff
- Hair-care businesses and salons — appointments, services, staff, products
- Other eligible businesses

Each: icon + bold title + description.

### 12. Why CareHub — Checkmark List

**Heading:** `Why CareHub`

Bullet list with checkmark icons:
- Fully designed for healthcare and related service businesses
- Business-specific tools based on business type
- One platform for core operations
- Greater visibility across CareFind
- Intelligent technology for smarter decisions
- Scalable for single and multiple-location businesses
- 30-day free trial

### 13. Pricing (kept from existing, updated)

- Keep existing pricing grid structure
- Update trial reference: "14-day" → "30-day"
- Keep Naira pricing (₦60k–₦250k/year + Custom)
- Keep "MOST POPULAR" badge on Growth plan
- CTA buttons: "Start with [Plan]" / "Talk to us"

### 14. Final CTA

**Heading:** `Your Business Deserves a Smarter Way to Operate.`
**Body:** `Stop managing your business through scattered tools and disconnected processes. Bring your operations together, gain better control, increase your visibility and build for growth with technology designed around your business.`

- Dual CTA: "Get Started Free" + "Explore CareHub"
- Tagline: "Manage smarter. Operate better. Get discovered. Grow with CareHub."
- Full-width teal gradient background

### 15. Footer

- Logo + copyright: "© 2026 CareHub · Part of the Care ecosystem"
- Links: Features, Pricing, CareFind, support@carehub.ng
- Existing pattern, unchanged

---

## Files to Modify

| File | Change |
|------|--------|
| `apps/carehub/src/pages/Landing.jsx` | Full rewrite — new sections, updated copy |
| `apps/carehub/src/config/constants.js` | Update `BUSINESS_TYPES` array |
| `apps/carehub/index.html` | Update `<title>`, `<meta name="description">` |

---

## BUSINESS_TYPES Update

Replace current 8-item array with spec categories:

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

---

## SEO Updates (`index.html`)

```html
<title>CareHub | Smart Business Management Software for Healthcare, Wellness & Beauty Businesses</title>
<meta name="description" content="CareHub is an intelligent business management platform fully designed for healthcare, wellness, beauty and personal-care businesses. Manage inventory, sales, staff, appointments, finances and more while increasing visibility across the CareFind health social platform. Start your 30-day free trial." />
```

---

## Design Tokens Used

All from existing `theme.js` — no new tokens needed:
- `tealDeep`, `deepTeal`, `tealBright`, `tealMist` — brand colors
- `navy`, `gray400`, `gray500`, `gray600` — text colors
- `bg`, `cardBg`, `border` — surfaces
- `fontDisplay` — marketing headings (Lora)
- `fontFamily` — body text (Geist)
- `radius.sm/md/lg/xl/full` — border radius
- `elevation.1/2/3/4` — shadows
- `motion.fast/base/slow` — transitions

---

## Animation Strategy

Reuse existing GSAP patterns:
- Hero: staggered fade-in on load
- Feature cards: scroll-triggered fade-in with stagger
- Step cards: scroll-triggered with scale
- CTA: scroll-triggered scale+opacity
- Nav: ScrollTrigger for background transition

---

## Responsive Behavior

| Breakpoint | Nav | Hero | Grids | Pricing |
|------------|-----|------|-------|---------|
| Mobile (<768px) | Compact, no links | Stacked, smaller type | 1-col | 1-col |
| Tablet (768-1024px) | Full nav | Standard | 2-col | 2-col |
| Desktop (>1024px) | Full nav | Standard | 3-col | Auto-fit |

---

## Testing

1. Visual: Run `npm run dev` in `apps/carehub`, verify all sections render
2. Responsive: Test at 375px, 768px, 1024px, 1440px
3. Animations: Verify GSAP scroll triggers fire correctly
4. Nav: Verify glass effect and scroll transition
5. CTAs: Verify all buttons navigate to `/register`
6. SEO: Verify `<title>` and `<meta>` in page source
7. Accessibility: Verify heading hierarchy (h1 → h2 → h3), alt text, focus states

---

## Constraints

- Inline styles only (codebase convention)
- No new dependencies
- Reuse existing theme tokens, icons (lucide-react), GSAP
- No generic AI-generated wording
- No unsupported AI capability claims
- Professional, modern, premium, trustworthy tone
