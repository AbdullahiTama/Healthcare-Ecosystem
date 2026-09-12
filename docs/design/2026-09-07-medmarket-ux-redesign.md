# MedMarket / Discover Page — UX Redesign Spec

**Date:** 2026-09-07
**Author:** Sally (UX Designer)
**Status:** Draft — Pending User Review
**Direction:** Option A — Jumia-Standard with Healthcare Trust Signals

---

## 1. Problem Statement

The MedMarket/Discover page (`/search`) is the core marketplace entry point for CareFind. Currently it feels unprofessional on mobile due to:

- **4 layers of filter chrome** before any content (tabs → location → business type → collapsible filters → status text)
- **Inconsistent product cards** (inline cards in Search.jsx differ from ProductCard.jsx)
- **Cramped 10px grid** — lower perceived quality than competitors
- **No trust signals** on product cards (no ratings, no verified badges)
- **Color contrast failure** — `textLight` (#8B978F) on `cardBg` (#FBFAF6) = 2.8:1 (needs 4.5:1)

**Goal:** Transform the page to match Jumia/Konga-level professionalism while maintaining healthcare identity.

---

## 2. Design Principles

1. **Content-first** — Products and facilities appear within one scroll of the search bar
2. **Progressive disclosure** — Show essential info on cards, details on tap
3. **Consistent rhythm** — 12px grid, 16px card padding, unified card component
4. **Trust at the point of decision** — Ratings and verification visible on cards
5. **Familiar patterns** — Nigerian users know how Jumia works; don't reinvent

---

## 3. Component-by-Component Design

### 3.1 Page Header (Mobile)

**Keep the gradient header** — it's the CareFind brand signature.

```
┌──────────────────────────────┐
│ 🟢 Logo    🔍 Search    👤   │  ← heroGradient, rounded bottom
└──────────────────────────────┘
```

**Changes:**
- Fix the bleed: remove `margin: -20px -20px 0 -20px`. Instead, extend the gradient to full width via `width: 100vw; margin-left: calc(-50vw + 50%)` or use a full-width wrapper div
- Cart icon: keep the badge (already added in Phase D)
- Height: auto (no fixed height — let content determine it)

### 3.2 Tab Navigation

**Replace the sticky tab row** with a compact pill row directly below the header.

```
┌────────────────────────────────────┐
│ [Shop] [Products] [Facilities] [Pro] │  ← horizontal scroll, no sticky
└────────────────────────────────────┘
```

**Specs:**
- Container: `padding: 12px 0`, NOT sticky (removes the magic `top: 64`)
- Pills: `padding: 8px 16px`, `borderRadius: 999`, `fontSize: 13`, `fontWeight: 700`
- Active: `background: theme.tealDeep`, `color: #fff`, `border: 2px solid theme.tealDeep`
- Inactive: `background: #fff`, `color: theme.textMid`, `border: 1px solid theme.border`
- Gap: `8px` between pills
- Scroll: `overflowX: auto`, `scrollbarWidth: none`, horizontal snap

### 3.3 Search Bar (Below Tabs)

**Move search below tabs** — tabs are the primary navigation, search is secondary.

```
┌──────────────────────────────────────┐
│  🔍 Search medication, facility...   │  ← white bg, rounded 12px
└──────────────────────────────────────┘
```

**Specs:**
- Container: `padding: 0 16px 12px`, `background: #fff` (white surface)
- Input: `minHeight: 44`, `borderRadius: 12`, `border: 1px solid theme.border`
- `fontSize: 16` (prevents iOS zoom)
- Search icon: `size={18}`, absolute left 12px
- No submit button — search is live/debounced (remove the "Search" button)

### 3.4 Location Filter

**Collapse into a single row with the filter FAB.**

```
┌──────────────────────────────────────────┐
│  📍 Lagos, Nigeria          [ Filters ]  │  ← one row
└──────────────────────────────────────────┘
```

**Specs:**
- Container: `padding: 0 16px 12px`, `display: flex`, `gap: 8`, `alignItems: center`
- Location input: `flex: 1`, `minHeight: 40`, `borderRadius: 10`, `fontSize: 13`
- Filter FAB: `minHeight: 40`, `padding: 0 14px`, `borderRadius: 999`
  - `background: theme.tealMist`, `color: theme.tealDeep`, `fontWeight: 700`, `fontSize: 12`
  - Icon: `SlidersHorizontal size={14}`
  - Shows active filter count badge when filters are applied

### 3.5 Filter Bottom Sheet (NEW)

**Replace the inline collapsible filters with a bottom sheet.**

When user taps the "Filters" FAB, a bottom sheet slides up:

```
┌──────────────────────────────┐
│  ━━━ (drag handle)           │
│                              │
│  Filters                 [✕] │
│                              │
│  Sale Type                   │
│  [All] [Retail] [Wholesale]  │
│  [Distributor]               │
│                              │
│  Price Range                 │
│  [Min ₦____] [Max ₦____]   │
│                              │
│  Category                    │
│  [All ▾]                     │
│                              │
│  ☑ In stock only             │
│  ☐ Rx only                   │
│                              │
│  Sort by                     │
│  [Popular ▾]                 │
│                              │
│  [      Apply Filters      ] │
│  [       Clear All         ] │
└──────────────────────────────┘
```

**Specs:**
- Overlay: `rgba(0,0,0,0.4)` backdrop
- Sheet: `borderRadius: 20px 20px 0 0`, `background: #fff`, max-height 80vh
- Drag handle: `width: 40`, `height: 4`, `borderRadius: 2`, `background: theme.border`, centered
- Each filter section: `padding: 16px 20px`
- Section title: `fontSize: 13`, `fontWeight: 800`, `color: theme.navy`, `marginBottom: 10`
- Filter pills: same style as tabs (8px gap, 999 radius, 44px min-height)
- Apply button: full-width, `background: theme.tealDeep`, `color: #fff`, `borderRadius: 12`, `minHeight: 48`, `fontWeight: 800`
- Clear link: centered, `color: theme.tealDeep`, `fontSize: 13`, `fontWeight: 700`

### 3.6 Product Grid (THE core change)

**Replace the 10px cramped grid with a spacious, trust-signal-rich grid.**

```
┌───────────┬───────────┐
│  ┌──────┐ │  ┌──────┐ │
│  │ IMG  │ │  │ IMG  │ │
│  │      │ │  │      │ │
│  ├──────┤ │  ├──────┤ │
│  │Name  │ │  │Name  │ │
│  │₦1,200│ │  │₦3,500│ │
│  │⭐4.8 │ │  │⭐4.2 │ │
│  │[Cart]│ │  │[Cart]│ │
│  └──────┘ │  └──────┘ │
├───────────┼───────────┤
│  ┌──────┐ │  ┌──────┐ │
│  │ IMG  │ │  │ IMG  │ │
│  ...     │ │  ...     │
└───────────┴───────────┘
```

**Grid Specs:**
- `display: grid`, `gap: 12px`
- `grid-template-columns: repeat(2, 1fr)` on mobile
- `grid-template-columns: repeat(3, 1fr)` at ≥768px
- `grid-template-columns: repeat(4, 1fr)` at ≥1024px

**Card Specs (unified ProductCard):**
- `borderRadius: 14`, `border: 1px solid theme.border`, `background: #fff`
- `overflow: hidden`, `display: flex`, `flexDirection: column`

**Image area:**
- `aspect-ratio: 1/1` (square, consistent heights across row)
- `background: theme.tealMist` for fallback
- `object-fit: cover` for real images
- Lazy loading via `<img loading="lazy">`

**Content area:**
- `padding: 12px`
- `display: flex`, `flexDirection: column`, `gap: 6`

**Product name:**
- `fontSize: 14`, `fontWeight: 700`, `color: theme.navy`
- `lineHeight: 1.3`, 2-line clamp via `-webkit-line-clamp: 2`
- `minHeight: 36` (ensures consistent card height)

**Price:**
- `fontSize: 15`, `fontWeight: 800`, `color: theme.tealDeep`
- "Ask for price": `fontSize: 12`, `color: theme.textMid` (NOT textLight — contrast fix)

**Rating (NEW on cards):**
- `display: flex`, `alignItems: center`, `gap: 4`
- Star: `size={12}`, `fill: theme.starAmber`, `color: theme.starAmber`
- Score: `fontSize: 12`, `fontWeight: 700`, `color: theme.textMid`
- Count: `fontSize: 11`, `color: theme.textMid`
- Example: `★ 4.8 (23)`

**Seller info:**
- `fontSize: 11`, `color: theme.textMid` (contrast fix: was textLight)
- 1-line ellipsis

**Add to Cart button:**
- Full-width, `minHeight: 44`, `borderRadius: 10`
- `background: theme.tealDeep`, `color: #fff`
- `fontSize: 12`, `fontWeight: 700`
- Icon: `ShoppingCart size={14}`

**Wishlist button:**
- `position: absolute`, `top: 8`, `right: 8`
- `width: 36`, `height: 36` (up from 28-30, meets 44px when combined with padding)
- `borderRadius: 999`, `background: rgba(255,255,255,0.92)`
- `boxShadow: 0 2px 8px rgba(0,0,0,0.1)`
- Heart icon: `size={16}`

### 3.7 Featured Rail (Products tab only)

**Simplify: remove auto-scroll animation** (janky on 120Hz, feels spammy).

**Replace with a static "Trending" section:**
- Label: "🔥 Trending Now" — `fontSize: 15`, `fontWeight: 800`, `color: theme.navy`, `marginBottom: 12`
- Horizontal scroll row: `gap: 12px`, `overflowX: auto`, `paddingBottom: 8`
- Cards: `flex: 0 0 160px`, same structure as product cards but compact
- Only show when: `tab === 'products'` AND no search query

### 3.8 Business/Facility Cards

**Redesign for clarity:**

```
┌────────────────────────────────────┐
│  🏥 Name                    ⭐ 4.5  │
│  Pharmacy · Lagos, Nigeria         │
│  📍 2.3km away                     │
│                                    │
│  [ View Profile ] [ Book Now ]     │
└────────────────────────────────────┘
```

**Specs:**
- `padding: 16`, `borderRadius: 14`, `border: 1px solid theme.border`
- `gap: 12` between cards
- Avatar/logo: `48×48`, `borderRadius: 12`
- Name: `fontSize: 15`, `fontWeight: 800`
- Type + location: `fontSize: 13`, `color: theme.textMid`
- Distance: `fontSize: 12`, `color: theme.tealDeep`, `fontWeight: 600`
- Rating: `fontSize: 13`, `fontWeight: 700`
- Buttons: full-width side by side, `minHeight: 44`, `borderRadius: 10`
- Add skeleton loading state (3 placeholder cards)

### 3.9 Professional Cards

**Redesign for trust:**

```
┌────────────────────────────────────┐
│  👩‍⚕️ Dr. Amina     ✓ Verified       │
│  Cardiologist · Lagos              │
│  ⭐ 4.9 (156 reviews)              │
└────────────────────────────────────┘
```

**Specs:**
- Same container as business cards
- Avatar: `48×48`, with online/verified ring
- Name + verified badge inline
- Specialty: `fontSize: 13`, `color: theme.textMid`
- Rating + review count: prominent
- Add skeleton loading state

### 3.10 Bottom Navigation

**Already updated in Phase D** — keep as-is. The cart badge on MedMarket tab is good.

---

## 4. Color & Typography Fixes

### Contrast Fix
| Token | Before | After | Ratio |
|-------|--------|-------|-------|
| `textLight` | `#8B978F` | `#6B7B72` | 2.8:1 → 4.6:1 |

**Note:** This is a design system token change that affects ALL pages. We should either:
- (a) Change the token globally (affects all pages — need to verify no visual regressions)
- (b) Override locally on MedMarket only (use a local `textMid` color instead)

**Recommendation:** Option (b) — use `theme.textMid` (`#3C4B44`) for secondary text on cards instead of `theme.textLight`. This is safer and doesn't require a global token audit.

### Typography Consistency
- All card titles: `14px / 700`
- All prices: `15px / 800 / tealDeep`
- All secondary text: `12px / 600 / textMid`
- All micro text: `11px / 600 / textMid`

---

## 5. Loading States

### Skeleton for Products
```
┌───────────┬───────────┐
│  ┌──────┐ │  ┌──────┐ │
│  │ gray │ │  │ gray │ │  ← 1:1 aspect ratio skeleton
│  │      │ │  │      │ │
│  ├──────┤ │  ├──────┤ │
│  │▓▓▓▓▓ │ │  │▓▓▓▓▓ │ │  ← name line
│  │▓▓▓   │ │  │▓▓▓   │ │  ← price line
│  │▓▓▓▓▓ │ │  │▓▓▓▓▓ │ │  ← button
│  └──────┘ │  └──────┘ │
└───────────┴───────────┘
```

- 4 skeleton cards (2×2 grid), pulsing animation
- Use existing `CardSkeleton` component but adjust to 1:1 aspect ratio

### Skeleton for Businesses/Professionals
- 3 skeleton cards, horizontal layout (avatar + 3 lines)
- Match the real card structure

---

## 6. Empty States

### No Products
- Icon: `Package` or `ShoppingBag` in `tealMist` circle
- Title: "No products found"
- Hint: "Try adjusting your filters or search term"
- CTA: "Clear Filters" button

### No Results for Search
- Icon: `SearchX` in `tealMist` circle
- Title: "No results for '{query}'"
- Hint: "Check spelling or try a broader term"

---

## 7. Files to Modify

| File | Changes |
|------|---------|
| `apps/carefind/src/modules/healthcare-discovery/Search.jsx` | Restructure layout: header → tabs → search → location+filter → content. Remove inline product cards (delegate to ProductGrid). Remove featured rail animation. Add skeleton states for all tabs. |
| `apps/carefind/src/modules/shop/Shop.jsx` | Simplify embedded mode: remove standalone filter chrome, keep only the product grid + wishlist/cart bar. Unify card rendering through ProductGrid. |
| `apps/carefind/src/modules/marketplace/ProductCard.jsx` | Redesign: 1:1 aspect image, add rating display, increase wishlist button to 36px, bump padding to 12px, fix text colors for contrast. |
| `apps/carefind/src/modules/marketplace/ProductGrid.jsx` | Update grid gap to 12px, update skeleton to 1:1 aspect. |
| `apps/carefind/src/modules/marketplace/MarketplaceTabs.jsx` | Minor: update padding/gap for tighter integration below header. |
| `apps/carefind/src/modules/marketplace/BusinessTypeFilter.jsx` | **Remove from page** — move sale type into filter bottom sheet. |
| `apps/carefind/src/components/FilterSheet.jsx` | **NEW** — bottom sheet component with all filter controls. |
| `apps/carefind/src/components/BottomNav.jsx` | No changes (already good). |

---

## 8. Interaction Flows

### First Visit (Shop tab, default)
1. Page loads → gradient header visible
2. Tabs below header: [Shop] active
3. Search bar below tabs
4. Location + Filter FAB row
5. Product grid loads with skeleton → populates with products
6. User scrolls through 2-col grid
7. Taps product → ProductDetail page

### Filtering
1. User taps "Filters" FAB
2. Bottom sheet slides up with all filter options
3. User selects filters → Apply
4. Sheet closes → grid updates with filtered results
5. Filter FAB shows badge count: "Filters (3)"

### Tab Switching
1. User taps "Facilities" tab
2. Content area swaps to business card list
3. Location filter remains, sale type filters hidden (irrelevant)
4. Skeleton → business cards

---

## 9. Success Metrics (Post-Launch)

- **Time to first product** — should be < 1.5s on 3G
- **Filter usage** — % of sessions that open filter sheet
- **Card tap rate** — products viewed / products shown
- **Cart additions from grid** — add-to-cart without visiting detail page
- **Accessibility** — all text ≥ 4.5:1 contrast, all touch targets ≥ 44px

---

## 10. Out of Scope

- Dark mode (future)
- Infinite scroll (keep pagination/load-more for now)
- Algorithmic recommendations (future)
- Image lazy-loading optimization (can add later)
- Search autocomplete (future)
