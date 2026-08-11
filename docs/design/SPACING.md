# Spacing

## The scale

An 4px-based scale, matching the increments already in dominant use across both codebases:

| Token | Value | Usage |
|---|---|---|
| `space-1` | 2px | Hairline adjustments only (icon-to-badge overlap, fine alignment) |
| `space-2` | 4px | Tightest real gap — between an icon and its adjacent label |
| `space-3` | 6px | Gap between closely related small elements (pill row, tag list) |
| `space-4` | 8px | Default small gap — form field internal padding component, icon button padding |
| `space-5` | 10px | Input padding (vertical), tight card padding |
| `space-6` | 12px | Default gap between related elements (form fields in a stack, list item padding) |
| `space-7` | 14px | Card internal padding (compact) |
| `space-8` | 16px | Default gap between distinct elements/sections within a component |
| `space-9` | 18px | — |
| `space-10` | 20px | Card internal padding (standard), section spacing |
| `space-11` | 24px | Page-level padding, gap between major page sections |
| `space-12` | 32px | Large section breaks |

**Why 4px-based rather than 8px-based:** the existing codebases use 4px-resolution values extensively (6px, 10px, 14px, 18px all appear frequently, not just multiples of 8), which gives finer control appropriate for dense, information-heavy interfaces. An 8px-only scale is common in consumer apps with more generous whitespace; this system's density requirements (Principle 4, `DESIGN_PRINCIPLES.md`) call for the finer resolution.

## How to choose a spacing value

Don't pick a value because it "looks right" in isolation — pick it based on relationship:

1. **Elements that are part of the same unit** (an icon and its label, a value and its unit) → `space-2`–`space-3`.
2. **Elements that are related but distinct** (fields in the same form, items in the same list) → `space-6`–`space-8`.
3. **Elements that are different sections of the same component** (a card's header vs. its body) → `space-8`–`space-10`.
4. **Elements that are different components entirely** (one card vs. the next card, the sidebar vs. the content area) → `space-10`–`space-12`.

This is the same principle as typographic hierarchy applied to space: the *distance* between two things should communicate their *relationship*, before the user reads a single word.

## Component-level defaults

| Component | Padding | Notes |
|---|---|---|
| Button (default) | `10px 20px` | `space-5` / `space-8` × 2 |
| Button (compact/ghost) | `7px 13px` | Used for secondary/tertiary actions in dense contexts |
| Input field | `9–11px 12px` | Vertical slightly tighter than horizontal — inputs read as more compact than buttons |
| Card (standard) | `20px` (`space-10`) all sides | |
| Card (compact, list-row context) | `14–16px` (`space-7`–`space-8`) | Used inside dense tables/lists where many cards stack |
| Modal body | `20px 24px` | |
| Page container | `24px` (`space-11`) | CareHub desktop default |

## Grid gaps

- Card grids (stat cards, dashboard tiles): `10–14px` gap.
- Form field grids (2-column form layouts): `10–12px` gap.
- List item stacks: `8–10px` gap between items.

See `GRID_SYSTEM.md` for column/container behavior; this section covers only the gap value between grid items.

## Responsive spacing adjustment

Spacing values do not scale proportionally between breakpoints — they step down discretely (see `RESPONSIVENESS.md` for the full philosophy):

- **Desktop/Laptop:** values as specified above.
- **Tablet:** page-level padding steps down one increment (24px → 20px); component-internal padding unchanged.
- **Mobile:** page-level padding steps down to 16px; card padding steps down to 14–16px; button padding unchanged (touch targets must not shrink — see `ACCESSIBILITY.md`).

## What this system avoids

- **No arbitrary one-off values.** If a screen needs "13px" of gap because nothing in the scale looks right, that's a signal the layout's relationships aren't well understood yet — solve the relationship, then pick from the scale.
- **No spacing used to fake a border or a boundary.** If two sections need visual separation, use an actual border/divider (`ELEVATION.md`) or a background color change — don't rely on a large gap alone to imply a boundary that isn't visually confirmed.
