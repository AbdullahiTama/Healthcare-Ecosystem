# Responsiveness

## The philosophy, stated plainly

**Responsiveness is designed from the beginning, for each breakpoint, as its own intentional layout — never as a desktop layout that gets shrunk, or a mobile layout that gets stretched.** This is Design Principle 11 and it is the single most commonly violated rule in generic AI-generated or templated UI, which is exactly why the brief calls it out explicitly. A responsive layout that just reflows columns into stacked rows as the viewport narrows is not "responsive design" — it's the *absence* of a design decision at that breakpoint.

For every screen pattern in `SCREEN_PATTERNS.md`, the desktop, tablet, and mobile layouts are specified independently, answering: what moves, what collapses, what becomes a drawer, what a table transforms into, where actions relocate, how navigation changes, whether filters become a bottom sheet, what stacks, and what interaction model changes entirely (hover-driven on desktop vs. tap-driven on mobile).

## Breakpoints (restated from `GRID_SYSTEM.md`)

| Breakpoint | Range |
|---|---|
| Mobile | 320–767px |
| Tablet | 768–1023px |
| Laptop | 1024–1439px |
| Desktop | 1440–1919px |
| Large Desktop | 1920px+ |

## What "intentional" means, concretely

For every component and every screen, answer these questions per breakpoint — don't just answer them once for "mobile" as a monolith:

- **Navigation:** Is it a persistent sidebar, a collapsible rail, a top bar with a menu, or a bottom tab bar at this width? (See `NAVIGATION.md`.)
- **Data tables:** At what width does a table stop being a table? (See `COMPONENT_LIBRARY.md` → Tables — the answer is usually: it becomes a stacked card list well before it becomes unreadable, not after.)
- **Filters:** Persistent sidebar, inline row, or a bottom sheet triggered by a "Filter" button?
- **Secondary panels** (detail-on-select, side info panels): do they sit beside the primary content, or do they become a full-screen push/modal?
- **Actions:** Do primary actions live in a toolbar, or collapse into an overflow menu / floating action button?
- **Multi-column forms:** single column below what width?
- **Modals:** do they stay centered dialogs, or become full-screen sheets on small viewports?

## Product-specific responsive strategy

### CareHub — desktop-first

CareHub is optimized for **1440px+ monitors, multi-panel layouts, high data density, keyboard navigation, and fast repeat workflows.** Its responsive strategy is not "make it work on a phone" — it's "preserve professional workflow efficiency as the viewport shrinks, and be honest about what stops being practical below a certain width."

- **Desktop/Large Desktop (1440px+):** Full experience — persistent sidebar, multi-panel layouts (list + detail side-by-side), dense tables with many visible columns, hover-revealed row actions.
- **Laptop (1024–1439px):** Full experience preserved, but panels get tighter (sidebar narrows, secondary panels may need to be toggled rather than always-visible), and table column count may reduce (lowest-priority columns hidden behind a "more columns" control, not dropped from the data model — see `COMPONENT_LIBRARY.md` → Tables).
- **Tablet (768–1023px):** Workflow-critical screens (POS, patient intake, a doctor's consultation view) remain fully usable — this is a real CareHub use case (staff on the floor with a tablet), not an edge case to deprioritize. Secondary/list-plus-detail layouts collapse to one panel at a time (list, then tap into detail, rather than always-visible side-by-side). Sidebar collapses to an icon rail or off-canvas drawer.
- **Mobile (320–767px):** CareHub explicitly does **not** attempt to replicate its full desktop workflow on a phone. Only screens explicitly designed for mobile use (e.g., a quick stock check, an urgent notification, viewing — not editing — a record) are optimized here. Everything else shows a clear, non-broken "this is easier on a larger screen" state rather than a cramped, unusable attempt at feature parity. This is a deliberate scope decision, not a limitation to apologize for — see `SCREEN_PATTERNS.md` for which specific workflows get mobile treatment.

### CareFind — mobile-first

CareFind is optimized for **touch interaction, search, discovery, and fast trust-building on a phone**, first. Desktop is an *expansion* of that same experience, never a different product bolted on.

- **Mobile (320–767px):** The primary, fully-designed experience. Bottom tab navigation, single-column content, large touch targets, progressive disclosure (search → results → detail, one screen at a time), map/list toggle rather than simultaneous map+list.
- **Tablet (768–1023px):** The mobile experience gains breathing room — cards may go from 1 to 2 columns, but navigation model and interaction pattern (touch-first, bottom-anchored primary actions) stay the same as mobile. This is not "the desktop layout, smaller" — it's the mobile layout, given more room.
- **Laptop/Desktop (1024px+):** Content expands into genuinely desktop-appropriate patterns *where it improves the experience* — e.g., a map-and-list side-by-side view becomes viable and preferable at this width, multi-column result grids — but core interaction patterns (progressive disclosure, minimal chrome, trust-forward content) are preserved, not replaced with a CareHub-style dense data interface. CareFind desktop should never feel like it's trying to become an admin tool.

## The universal anti-pattern

**"Just adding a media query that changes `flex-direction` from `row` to `column`"** is not responsive design under this system. Every breakpoint transition documented in `SCREEN_PATTERNS.md` must answer *why* that specific change is the right one for that specific screen at that specific width — grounded in what the user is actually trying to do at that size, not just "make it fit."
