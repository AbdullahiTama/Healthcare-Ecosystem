# Grid System

## Breakpoints

Five breakpoints, matching the brief exactly — each one is a deliberately designed layout state, not an interpolation point (see `RESPONSIVENESS.md` for the full per-screen philosophy):

| Name | Range | Primary context |
|---|---|---|
| Mobile | 320–767px | CareFind primary; CareHub emergency/limited access only |
| Tablet | 768–1023px | CareFind secondary; CareHub secondary (on-the-floor use, e.g. a nurse with a tablet) |
| Laptop | 1024–1439px | CareHub secondary primary (a smaller work laptop) |
| Desktop | 1440–1919px | CareHub primary target |
| Large Desktop | 1920px+ | CareHub — content max-width caps out, extra space goes to margin, not to stretching components |

## Containers

| Breakpoint | Container max-width | Outer margin |
|---|---|---|
| Mobile | 100% | 16px |
| Tablet | 100% | 24px |
| Laptop | 100% | 24px |
| Desktop | 1400px (content), full-bleed for app chrome (sidebar/header) | 24–32px |
| Large Desktop | 1400px (content stays capped — see below) | Remaining space |

**Why content caps at 1400px even on very large monitors:** CareHub's tables and forms are read left-to-right in structured columns; letting them stretch to fill a 2560px monitor would create excessive line lengths in text columns and force the eye to travel too far between related data. Extra horizontal space on large monitors goes to increased outer margin and, where appropriate, a wider secondary panel (see `LAYOUTS.md` → multi-panel layouts), never to naive stretching of existing components.

## Column grid

**CareHub (desktop-first):** 12-column grid at Laptop and above, gutter 16–24px depending on context (dense data tables use the tighter end; page-level layout composition uses the wider end). Below Laptop, the grid collapses to a single-column stack (see `RESPONSIVENESS.md`).

**CareFind (mobile-first):** 4-column grid at Mobile, 8-column at Tablet, 12-column at Laptop+. Most CareFind screens use far fewer columns than the grid technically allows — the grid exists to keep alignment consistent (card widths, gutter rhythm) even when a screen is visually simple, not to fill every column with content.

## Sidebar and content-area proportions (CareHub)

CareHub's primary layout is sidebar + content (see `LAYOUTS.md`). Grid behavior:

| Breakpoint | Sidebar | Content |
|---|---|---|
| Desktop/Large Desktop | Fixed 240–260px | Remaining width, internally using the 12-col grid, capped at 1400px |
| Laptop | Fixed 220px (slightly narrower — icon+label nav items get tighter) | Remaining width |
| Tablet | Collapsed to icon-only rail (64px) or off-canvas drawer, context-dependent (see `NAVIGATION.md`) | Full remaining width |
| Mobile | Off-canvas drawer only, never persistent | Full width |

## Card grid patterns

Stat-card rows (dashboards) use `repeat(auto-fit, minmax(140px, 1fr))` logic — a fixed minimum card width with automatic wrapping — rather than a hardcoded column count. This is a deliberate departure from a strict N-column grid: dashboards accumulate stat cards over time (see H8's Reception dashboard, which grew from 3 to 6 stat cards), and a hardcoded column count breaks or requires redesign every time a card is added. `auto-fit`/`minmax` absorbs growth without a redesign.

## Grid don'ts

- Don't nest grids more than two levels deep (a page grid containing a card grid is fine; a card grid containing another grid inside each card is a sign the card should be a table row or a different pattern entirely — see Anti-Patterns in `SCREEN_PATTERNS.md`).
- Don't mix column-count logic within one screen — if the top of a page uses a 12-column grid and the bottom switches to a 3-column grid for unrelated reasons, that's a sign the page is actually two screens glued together.
- Don't let CareFind's grid exceed what a thumb can comfortably navigate — even at Laptop+ widths, CareFind avoids CareHub-style dense multi-column data grids; its job is discovery and reassurance, not data density (`DESIGN_VISION.md`).
