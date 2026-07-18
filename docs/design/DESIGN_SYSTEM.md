# Design System

The consolidated token and component reference — the cheat sheet. Every value below is defined in full, with rationale, in its own dedicated document; this document exists to put them all in one place, with a one-line "why," so a designer or engineer building a screen doesn't have to open eight files to assemble the pieces. **When this document and a dedicated document disagree, the dedicated document is authoritative** — this is a summary, not a second source of truth.

---

## Typography

Full detail: `TYPOGRAPHY.md`.

- **Family:** system font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`) — no webfont, to avoid a render-blocking cost on connection- and data-constrained users. Monospace (`ui-monospace, "SF Mono", Menlo, Consolas, monospace`) for reference codes/IDs only.
- **Scale:** `display` 24px → `h1` 20–22px → `h2` 18px → `h3` 15–16px → `body-lg` 14px → `body` 13px (the system's default) → `body-sm` 12px → `caption` 11px → `micro` 10–10.5px.
- **Weights:** four only — 400 (regular), 500–600 (medium, the default UI weight), 700–800 (bold), 900 (black, page titles and big numbers). Never an in-between value.
- **Why this shape:** typography carries hierarchy before color or elevation does (Design Principle 1) — it's the most information-dense, cheapest-to-render signal available, so it has to be precise and restrained rather than decorative.

## Color usage

Full detail: `COLORS.md`.

- **Brand:** `teal-600` `#0f766e` (primary actions, links, active states), `teal-500` `#14b8a6` (gradient partner). Gradient reserved for primary buttons and small celebratory moments only — never page chrome.
- **Neutrals:** `navy-900` `#0f172a` (primary text, dark surfaces) through `gray-50` `#f9fafb` (page background) — no pure black anywhere.
- **Semantic:** `success` `#16a34a`, `warning` `#d97706`, `danger` `#dc2626`, `info` `#2563eb`, each with a paired `-bg` tint for badges/banners. `purple` `#7c3aed` as a last-resort fifth categorical color.
- **Why this shape:** teal reads clinical without reading sterile or alarming (avoids both the generic "blue and white" medical cliché and red-cross anxiety); semantic color is earned by real state, never decorative — a screen with no real status to show has a layout problem, not a palette gap.

## Spacing scale

Full detail: `SPACING.md`.

- **Base:** 4px-resolution scale, `space-1` (2px) through `space-12` (32px), with `space-6`–`space-8` (12–16px) as the most common "related but distinct elements" gap and `space-10`–`space-11` (20–24px) as the standard section/page gap.
- **Why 4px, not 8px:** the existing codebases already use fine-resolution values (6px, 10px, 14px, 18px) extensively; a coarser 8px-only scale would lose precision this system's density needs (Principle 4).
- **Rule:** the distance between two elements always communicates their relationship — pick a value from the scale based on that relationship, never because it "looks right" in isolation.

## Grid system

Full detail: `GRID_SYSTEM.md`.

- **Breakpoints:** Mobile 320–767px, Tablet 768–1023px, Laptop 1024–1439px, Desktop 1440–1919px, Large Desktop 1920px+.
- **Containers:** content caps at 1400px even on very large monitors — extra width goes to margin, never to naive component stretching.
- **Columns:** CareHub 12-col (Laptop+), collapsing to single-column below. CareFind 4-col (Mobile) → 8-col (Tablet) → 12-col (Laptop+), though most CareFind screens use far fewer columns than the grid allows.
- **Card grids:** `auto-fit`/`minmax(140px, 1fr)` for stat-card rows, so the grid absorbs new cards over time without a redesign.

## Corner radius

Not previously broken out into its own document — defined here directly, matching existing production values:

| Token | Radius | Usage |
|---|---|---|
| `radius-sm` | 6px | Badges, pills, small inline controls |
| `radius-md` | 8–10px | Buttons, inputs, form controls |
| `radius-lg` | 12–14px | Cards, panels |
| `radius-xl` | 16–20px | Modals, bottom sheets (larger surfaces read as more premium with a slightly larger radius) |
| `radius-full` | 9999px | Avatars, circular icon buttons, fully-rounded status pills |

**Rule:** radius scales with surface size — a badge and a modal should never share the same corner radius. Never mix radius values within one component instance (a card with 8px on one corner and 14px on another).

## Borders

- **Default border color:** `gray-200` (`#e5e7eb`) for standard separation, `#f0f0f0`-equivalent subtler value for tighter contexts (dense table row dividers).
- **Weight:** 1px, always — no 2px "emphasis" borders; emphasis comes from color/weight of adjacent content, not a thicker line.
- **Preferred over shadow** for most static content separation — see Elevation below. Borders are cheaper to render (relevant to CareFind on lower-end devices) and read as more precise/engineered than a soft shadow edge.

## Elevation & Shadows

Full detail: `ELEVATION.md`.

- **Scale:** `elevation-0` (none, default) → `elevation-1` (`0 1px 4px rgba(15,23,42,0.05)`, resting cards) → `elevation-2` (hover/dropdowns) → `elevation-3` (popovers/toasts) → `elevation-4` (`0 20px 48px rgba(15,23,42,0.18)`, modals/drawers — the ceiling).
- **All shadows use the navy family** (`rgba(15,23,42,...)`) — never pure black, never a brand-tinted shadow.
- **Rule of thumb:** elevation signals temporary/floating content (dropdowns, modals, toasts), not importance. A card is never "more important" because its shadow is bigger — that job belongs to typography and position. Card-on-card nesting with escalating shadows is an explicit anti-pattern (the "AI-generated tell").

## Icons

Full detail: `ICONS.md`.

- **One outline/line-style icon set**, single consistent stroke weight (1.5–2px). Filled icons reserved for exactly one case: active/selected state.
- **Sizes:** `icon-xs` 14px → `icon-xl` 32–48px, always chosen relative to adjacent text size, never in isolation.
- **Color:** follows text color rules — `gray-600` default, `teal-600` active, semantic color when representing status.
- **Honest note:** current production code uses emoji as functional icons in many places — an acceptable prototyping shortcut, not the target state. Emoji remain acceptable long-term only in user-generated/social content (CareFind's feed, gifts, reactions), never in structural UI.
- **Touch targets:** icon-only controls need a 44×44px (mobile) / 32×32px (desktop) hit area regardless of the icon's visual size, plus a real accessible label.

## Illustrations

Not previously specified in a dedicated document. Rules:

- Used sparingly — empty states, onboarding, and error/404 screens are the only sanctioned contexts (`SCREEN_PATTERNS.md`).
- **Style:** simple, single- or two-color line illustrations consistent with the icon system's stroke language — never a mismatched, colorful, mascot-style illustration set that reads as a different, more consumer-playful product than the one surrounding it.
- **Never load-bearing:** an illustration is always secondary to the heading/text/action in an empty or error state (`SCREEN_PATTERNS.md` pattern 30) — it may be omitted entirely on mobile without losing any actual meaning.
- **Why:** the brief explicitly rejects a "template based" and "generic" feel; a stock illustration library is one of the fastest ways to produce exactly that feeling, so illustration use stays minimal and, where used, custom-consistent with the rest of the system rather than pulled from an unrelated visual language.

## Charts

Full detail: `COMPONENT_LIBRARY.md` → Charts.

- Use the semantic and neutral color scale for series coloring — never introduce chart-specific colors outside `COLORS.md`'s palette.
- Every chart states a conclusion nearby (a KPI, a title) rather than presenting raw data for the user to interpret unassisted (`SCREEN_PATTERNS.md` → Analytics).
- Responsive: full detail (legends, gridlines, hover tooltips) at Desktop; legend repositions at Tablet; aggressive simplification (fewer data points, tap-not-hover) at Mobile, with a "view full report on a larger screen" affordance where a chart genuinely doesn't work at phone width.

## Tables

Full detail: `COMPONENT_LIBRARY.md` → Tables, `SCREEN_PATTERNS.md` → List/Table Page.

- The highest-stakes responsive component in the system: full table (Desktop) → column-hiding behind a "Columns" control (Laptop) → overflow-menu row actions (Tablet) → **stacked card list (Mobile)** — a transformation, not a shrink.
- Row-hover actions on desktop (calm at rest, revealed on interaction); never a permanently-visible action column crowding every row.
- Always real `<table>` markup with sortable, `aria-sort`-carrying headers.

## Forms

Full detail: `COMPONENT_LIBRARY.md` → Forms & Inputs, `UX_PATTERNS.md` → Data Entry/Validation.

- Multi-column layouts (2-column) permitted at Desktop/Tablet for short related fields; **always single-column on Mobile**, without exception.
- Validate on blur/submit, never on keystroke. Errors are specific, adjacent to their field, and never clear the user's input.
- Progressive disclosure past ~7-8 fields; beyond that, a Multi-Step Wizard (`SCREEN_PATTERNS.md` pattern 10).

## Buttons

Full detail: `COMPONENT_LIBRARY.md` → Buttons.

- **Variants:** Primary (teal gradient, exactly one per screen), Secondary/Dark (navy), Ghost (outline/neutral), Danger (red, destructive only).
- **Padding:** `10px 20px` default, `7px 13px` compact.
- **Touch:** 44px minimum height on mobile regardless of visual padding.
- **Rule:** one primary button per screen — every other action is visually subordinate.

## Search

Full detail: `COMPONENT_LIBRARY.md` → Search, `SCREEN_PATTERNS.md` → Search Results, Global Search.

- Always visible or one tap away, never buried in a menu.
- Debounced (~250–300ms after typing stops) for local/in-app search; explicit submit only for expensive backend queries.
- Mobile: search expands to a full-screen/full-width experience with its own back action, not a cramped inline field.

## Filters

Full detail: `COMPONENT_LIBRARY.md` → Filters, `UX_PATTERNS.md` → Filtering.

- Active filters shown as removable chips, always visible, never hidden inside a reopened panel.
- Desktop: persistent sidebar/row, live-updating results. **Mobile: bottom sheet with an explicit Apply**, not live-filtering a full-screen sheet mid-selection.

## Pagination

Full detail: `COMPONENT_LIBRARY.md` → Pagination.

- CareHub data tables: explicit numbered pagination at every breakpoint (precise navigation matters for administrative work) — simplified to prev/next + page indicator on Mobile.
- CareFind browse/discovery: infinite scroll / "load more" preferred over pagination, matching consumer discovery conventions.

## Navigation

Full detail: `NAVIGATION.md`.

- **CareHub:** role-and-business-type-aware sidebar (`getNavItems(role, businessType)`), collapsing to an icon rail or off-canvas drawer below Laptop. Command palette (`⌘K`) for power-user jump-to-anything.
- **CareFind:** persistent bottom tab bar (Mobile/Tablet, 4–5 destinations max), expanding to a header nav bar at Laptop+ — expansion, not a different product.
- Breadcrumbs: CareHub deep-hierarchy contexts only, never CareFind.

## Status indicators & badges

Full detail: `COMPONENT_LIBRARY.md` → Status Indicators & Badges.

- Pill-shaped, semantic-colored, **always paired with text** — never a bare color dot as the sole signal (accessibility requirement).
- Colors map directly to `COLORS.md`'s semantic scale — never a bespoke color scheme invented per screen (Inventory's expiry status, Billing's payment status, and Patient Profile's pipeline status all draw from the same four-to-five semantic values).

## Notifications

Full detail: `COMPONENT_LIBRARY.md` → Notifications (Toasts), `UX_PATTERNS.md` → Notifications, `SCREEN_PATTERNS.md` → Notifications.

- **Toasts:** transient, non-critical confirmations only, auto-dismiss ~4s. Desktop: corner-anchored, stacking. Mobile: full-width, one at a time, queued rather than stacked.
- **Persistent notification center:** anything the user needs to act on later — never rely on a toast alone for something actionable.
- Badge counts always reflect a genuinely unread/unactioned count — an inaccurate badge, even once, teaches the user to ignore it permanently.

---

## How to use this document

Start here for a fast token lookup. For the *why* behind any value, or for a case this summary doesn't cover, go to the linked dedicated document. For which screen shape to use a given token inside, go to `SCREEN_PATTERNS.md` and `LAYOUTS.md`. Before shipping, run `DESIGN_CHECKLIST.md`.
