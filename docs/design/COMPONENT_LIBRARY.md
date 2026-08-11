# Component Library

Every reusable component in the system: what it's for, its required states, and — per the brief's explicit requirement — its behavior at each breakpoint, defined intentionally rather than left to "shrink and hope."

Tokens referenced below (colors, spacing, elevation, motion, typography) are defined in their respective documents; this document is about structure and behavior, not raw values.

---

## Buttons

**Variants:** Primary (teal gradient, one per screen), Secondary/Dark (navy), Ghost (outline/neutral), Danger (red, destructive actions only).
**States:** default, hover, active/pressed, focus (visible ring), disabled, loading (inline spinner replacing/preceding label).
**Responsive:**
- **Desktop/Tablet:** as designed, `10px 20px` padding, hover states active (mouse-driven).
- **Mobile:** minimum 44px touch height regardless of visual padding; hover states are irrelevant (no mouse) — active/pressed state (slight opacity or scale-down on tap) is what confirms the tap registered instead.
- Button groups (e.g. Cancel/Save) stack full-width on mobile rather than staying side-by-side if the combined width would compress either label.

## Forms & Inputs

**Components:** text input, textarea, select, checkbox, radio, toggle, date picker, file upload.
**States:** default, focus, filled, error (with associated message), disabled, read-only.
**Responsive:**
- **Desktop:** multi-column form layouts (2-column grids for related short fields — e.g. State/Country) are appropriate, per `GRID_SYSTEM.md`.
- **Tablet:** 2-column grids may persist if fields are short; longer fields (address, notes) go full-width regardless of breakpoint.
- **Mobile:** always single-column, full-width — this is one of the least negotiable responsive rules in the system, since a 2-column form on a 360px-wide screen produces unusably narrow fields.
- **Validation timing (all breakpoints):** on blur or submit, never on every keystroke while the user is still forming their first input — see `UX_PATTERNS.md`.

## Date Pickers

**Responsive:**
- **Desktop/Tablet:** inline calendar popover anchored to the trigger field.
- **Mobile:** native OS date picker (via `<input type="date">`) or a full-screen modal calendar — never a small popover calendar on a touch screen, where date-cell targets would fall below the 44px minimum.

## Tables

The highest-stakes responsive component in CareHub, given its data density (Design Principle 4).
**States:** default, row-hover (desktop only), row-selected, sorted-column indicator, empty, loading (skeleton rows).
**Responsive:**
- **Desktop/Large Desktop:** full table, all columns, hover-revealed row actions (icons appear on row hover rather than a permanently-visible action column, keeping the table visually calm at rest — the Carbon-derived lesson).
- **Laptop:** lower-priority columns (defined per-screen, not universally) hide behind a "Columns" control (already an existing pattern in CareHub's field-activity module — formalized here as the standard, not a one-off) rather than the table overflowing into horizontal scroll as a default behavior. Horizontal scroll is acceptable as a fallback, never the primary design.
- **Tablet:** further column reduction; row actions become a persistent overflow (`⋯`) menu rather than hover-revealed (no hover on touch).
- **Mobile:** the table **transforms into a stacked card list** — one card per row, the row's most important 2–3 fields promoted to visible text, everything else available on tapping into the row's detail. This is not a compromise; it's the intentional mobile-appropriate shape for tabular data, matching Principle 11.

## Pagination

**Responsive:**
- **Desktop/Tablet:** numbered pagination with prev/next, page-size selector visible.
- **Mobile:** simplified to prev/next plus a page indicator ("Page 2 of 14") — numbered page links are too small a touch target to be usable at this width. Infinite scroll / "load more" is preferred over pagination entirely for CareFind's browse/discovery contexts specifically (matches consumer discovery product conventions); CareHub's data tables keep explicit pagination at all breakpoints since precise navigation ("go to page 40") matters more than casual scrolling for administrative work.

## Search

**Responsive:**
- **Desktop:** persistent search field in the toolbar/header, always visible.
- **Tablet:** persistent if space allows, otherwise a search icon that expands into a full-width field on tap.
- **Mobile:** search icon → full-screen (or full-width, header-anchored) search experience with its own back action, not a cramped inline field — see `SCREEN_PATTERNS.md` → Global Search.

## Filters

**Responsive:**
- **Desktop:** persistent filter sidebar/row alongside results, all options visible.
- **Tablet:** filters may collapse into a "Filters" button that opens a panel, depending on how many filter dimensions exist (few → inline chips; many → panel).
- **Mobile:** filters become a **bottom sheet** triggered by a "Filter" button — never a persistent sidebar, never a cramped inline row. Applied filters show as removable chips below the search bar so the user doesn't have to reopen the sheet to see what's active.

## Navigation (Sidebar, Header)

See `NAVIGATION.md` for full detail. Summary: CareHub sidebar → icon rail → off-canvas drawer as width decreases; CareFind header nav → bottom tab bar as width decreases (inverse direction, since CareFind is mobile-first).

## Tabs

**Responsive:**
- **Desktop/Tablet:** horizontal tab row, all tabs visible.
- **Mobile:** if tabs exceed ~4 items or labels are long, tabs become horizontally scrollable (with a visible partial-next-tab affordance so the user knows to scroll) rather than wrapping to multiple rows, which breaks the tab metaphor.

## Breadcrumbs

**Responsive:**
- **Desktop/Tablet:** full breadcrumb trail.
- **Mobile:** collapse to a single "← Back to [parent]" control rather than a full trail — a multi-level breadcrumb is rarely useful at 360px width and competes with limited header space.

## Modals / Dialogs

**States:** default, with footer actions, with a nested scroll region for long content.
**Responsive:**
- **Desktop/Tablet:** centered dialog, max-width capped (500px default / 700px "wide" variant — matches the existing `Modal` component's `wide` prop), backdrop dismissible unless the action is destructive/irreversible (in which case dismissal requires an explicit Cancel, not a backdrop click — preventing accidental loss of a destructive-action confirmation).
- **Mobile:** becomes a **bottom sheet** (slides up from the bottom edge, rounded top corners, can extend near full-height) rather than a small centered box — matches the existing `Modal` component's `sheet` variant, now formalized as the mobile default for CareFind and for CareHub's touch-context screens, not an enterprise-vertical-only special case.

## Drawers

**Responsive:**
- **Desktop/Tablet:** slides in from the side (right, typically), partial width, page content remains visible/dimmed behind it.
- **Mobile:** becomes full-screen (a drawer at partial width on a 360px screen leaves too little room to be useful) — functionally converges with the Modal's mobile bottom-sheet behavior; the distinction between "drawer" and "mobile modal" mostly disappears at this breakpoint.

## Charts

**Responsive:**
- **Desktop:** full detail — legends, gridlines, hover tooltips, multiple series.
- **Tablet:** legend may move from side to below the chart to preserve chart width.
- **Mobile:** simplify aggressively — fewer visible data points/gridlines, tap instead of hover for tooltips, consider whether a chart is even the right pattern at this width vs. a simpler summary stat with a "view full report on a larger screen" affordance for genuinely dense visualizations (CareHub's Reports/Analytics context).

## Dashboards

See `LAYOUTS.md` → Dashboard Grid. Responsive note: stat-card grid uses `auto-fit`/`minmax` reflow (`GRID_SYSTEM.md`) at all breakpoints down to Tablet; at Mobile, stat cards go to a 2-column grid (never 1-column for pure stat numbers — two small numbers side by side remain scannable; one-per-row wastes vertical space the user has to scroll past).

## Status Indicators & Badges

**Variants:** pill-shaped, semantic-colored (`COLORS.md`), always paired with text (never a bare color dot as the only signal — Accessibility rule).
**Responsive:** size-invariant across breakpoints (badges don't need to shrink further than their `micro`/`caption` type scale already provides); on mobile card-list contexts, badges relocate from a table cell to a corner/inline position within the card.

## Notifications (Toasts)

**Responsive:**
- **Desktop:** bottom-right or top-right corner, stacking if multiple appear.
- **Mobile:** full-width, anchored to the top or bottom safe area, one at a time (stacking multiple toasts on a small screen is overwhelming — queue them instead).
