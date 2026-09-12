# MedMarket UX Redesign — Implementation Plan

**Spec:** `docs/design/2026-09-07-medmarket-ux-redesign.md`
**Date:** 2026-09-07
**Estimated Effort:** 4-6 hours

---

## Execution Order

### Phase 1: Foundation (components that other changes depend on)

#### Step 1: Fix Contrast + Unified Card Tokens
**Files:** `apps/carefind/src/modules/marketplace/ProductCard.jsx`, `apps/carefind/src/modules/marketplace/ProductGrid.jsx`

- Change all `theme.textLight` usage in ProductCard to `theme.textMid` (contrast fix)
- Update ProductGrid gap from 10px → 12px
- Update ProductCard padding from 10px → 12px
- Update ProductCard image from fixed `height: 122` → `aspect-ratio: 1/1`
- Update ProductCard name from `fontSize: 13` → `fontSize: 14`
- Update ProductCard price from `fontSize: 14` → `fontSize: 15`
- Add rating display to ProductCard (star + score + count)
- Increase wishlist button from 30px → 36px
- Update ProductGrid skeleton to use 1:1 aspect ratio images
- Add skeleton states for businesses and professionals

#### Step 2: Filter Bottom Sheet Component
**Files:** `apps/carefind/src/components/FilterSheet.jsx` (NEW)

- Create a reusable bottom sheet component
- Props: `open`, `onClose`, `filters`, `onApply`, `onClear`
- Contains: sale type pills, price range inputs, category select, sort select, in-stock toggle, Rx-only toggle
- Backdrop: `rgba(0,0,0,0.4)`, clicks to close
- Drag handle at top
- Apply/Clear buttons at bottom
- Mobile: slides up from bottom, max-height 80vh
- Desktop: centered modal (for completeness, though primary target is mobile)

#### Step 3: Filter FAB Component
**Files:** `apps/carefind/src/components/FilterFAB.jsx` (NEW)

- Small floating pill button: `SlidersHorizontal` icon + "Filters" text
- Shows badge count when filters are active
- Opens FilterSheet on tap
- Positioned in the location filter row (not floating)

---

### Phase 2: Search.jsx Restructure

#### Step 4: Restructure Search.jsx Layout
**Files:** `apps/carefind/src/modules/healthcare-discovery/Search.jsx`

**Current structure (top to bottom):**
1. Gradient header (with Logo, Cart, Avatar)
2. Search bar
3. MarketplaceTabs (sticky)
4. Location filter input
5. BusinessTypeFilter
6. Featured rail (products tab)
7. Content area

**New structure (top to bottom):**
1. Gradient header (simplified — Logo + Cart + Avatar, no search)
2. MarketplaceTabs (NOT sticky — just flow)
3. Search bar (white bg, below tabs)
4. Location input + Filter FAB (one row)
5. Featured/Trending rail (products tab only, static — no auto-scroll)
6. Content area (ProductGrid for shop, business cards, professional cards)

**Key changes:**
- Remove `sticky` from tabs (eliminates magic `top: 64`)
- Remove the `BusinessTypeFilter` import and rendering (moved to FilterSheet)
- Remove the inline product card JSX (lines ~468-536) — delegate to `ProductGrid`
- Add `FilterSheet` state and rendering
- Add `FilterFAB` to the location row
- Add skeleton loading for businesses and professionals tabs
- Remove featured rail auto-scroll animation — make it a static "Trending" section
- Fix header bleed: remove `margin: -20px -20px 0 -20px`, use full-width wrapper

#### Step 5: Simplify Shop.jsx Embedded Mode
**Files:** `apps/carefind/src/modules/shop/Shop.jsx`

When `embedded=true` (rendered inside Search):
- Remove the standalone filter chrome (segment filter, faceted filters, sort)
- Keep: wishlist + cart buttons (compact), product grid, recently viewed
- The parent Search.jsx now handles filtering via the FilterSheet
- Pass filtered products down or let Shop handle its own React Query

**Decision:** Keep Shop's React Query + client-side filtering. The FilterSheet in Search.jsx updates `saleTypeFilter` which is passed as `segment` prop to Shop. Shop already handles this via its `useEffect` on `initialSegment`.

---

### Phase 3: Polish + Verification

#### Step 6: Update Search.jsx Featured Rail
- Remove the `requestAnimationFrame` auto-scroll
- Replace with static horizontal scroll row
- Label: "🔥 Trending Now"
- Only show on products tab with no search query

#### Step 7: Add Skeleton Loading for All Tabs
- Products: 4 skeleton cards in 2×2 grid (already exists, just update aspect ratio)
- Businesses: 3 skeleton cards (horizontal layout)
- Professionals: 3 skeleton cards (horizontal layout)

#### Step 8: Build Verification
- `npm run build` in `apps/carefind` — must pass
- Manual review: all changes compile, no missing imports

#### Step 9: Commit + Push
- Single commit: "feat: MedMarket UX redesign — Jumia-standard layout with trust signals"
- Push to AbdullahiTama/main

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Breaking existing Shop standalone mode | Keep Shop.jsx working standalone (non-embedded). Only simplify embedded mode. |
| FilterSheet mobile gestures | Use CSS `touch-action: pan-y` and `overscroll-behavior: contain` for smooth sheet. |
| Contrast regression on other pages | Only change textLight→textMid in ProductCard/ProductGrid (localized). |
| Missing imports | Run build after each phase. |
| Performance with 80 products + ratings | React Query + `staleTime: 30s` already handles this. Rating fetch is batched. |

---

## Component Dependency Graph

```
FilterSheet (NEW)
    ↓
FilterFAB (NEW) ← opens FilterSheet
    ↓
Search.jsx ← uses FilterFAB, FilterSheet, ProductGrid
    ├── MarketplaceTabs (existing, minor tweaks)
    ├── ProductGrid (existing, updated)
    │   └── ProductCard (existing, redesigned)
    ├── Business cards (inline, updated)
    └── Professional cards (inline, updated)

Shop.jsx ← simplified embedded mode, delegates to ProductGrid
```

---

## What NOT to Change

- BottomNav.jsx — already good
- ProductDetail.jsx — separate concern
- Cart/Checkout flow — separate concern
- CartProvider/WishlistProvider — no changes needed
- Design tokens (theme.js) — no global changes
- supabaseClient.js — no changes
- API layer — no changes
