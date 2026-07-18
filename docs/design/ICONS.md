# Icons

## The system

**One icon set, used consistently, sourced from a single outline/line-style icon library** (e.g. Lucide/Feather-class libraries — consistent stroke width, consistent corner treatment, comprehensive healthcare/business/data coverage). The current codebase uses emoji as functional icons in many places (module nav, stat cards, buttons) — this is acceptable as a fast-prototyping shortcut but is **not the long-term system**: emoji render inconsistently across platforms/OSes, cannot take a stroke-weight or color token, and read as informal in a professional tool. This document defines the target state; migrating existing emoji usage to the icon set is tracked as implementation work, not a design decision to make screen-by-screen.

## Sizing

| Token | Size | Usage |
|---|---|---|
| `icon-xs` | 14px | Inline with `caption`/`micro` text, dense table rows |
| `icon-sm` | 16px | Inline with `body`/`body-sm` text, form field icons, button icons |
| `icon-md` | 20px | Default standalone icon — nav items, list-row leading icons |
| `icon-lg` | 24px | Section headers, empty-state secondary icons |
| `icon-xl` | 32–48px | Empty-state primary icons, onboarding |

**Rule:** icon size is always chosen relative to the adjacent text size, never in isolation — an icon sitting next to `body-sm` text uses `icon-sm`, not a size picked because it "looked balanced" on its own.

## Stroke weight

A single consistent stroke weight (1.5–2px at the icon's native size) across the entire set. Never mix stroke weights on the same screen, and never mix a filled icon style with an outline icon style except for the one deliberate exception below.

**The one exception — state indication:** an icon may switch from outline to filled specifically to indicate an active/selected/toggled-on state (e.g., a nav item's icon fills when that section is active). This is a meaningful state change, not decoration, and is the only case where filled icons appear in this system.

## Color

Icons follow the same color rules as text (`COLORS.md`, `TYPOGRAPHY.md`):
- Default: `gray-600` (secondary text color) — icons are rarely full-emphasis `navy-900` unless paired with primary-emphasis text.
- Active/selected state: `teal-600`.
- Semantic icons (status indicators): match their semantic color (`success`/`warning`/`danger`).
- On dark surfaces: white or `gray-400` for de-emphasized icons, matching the dark-surface text rules in `COLORS.md`.
- Icons are never colored purely for decoration — an icon's color always communicates something (default, active, semantic state).

## Icon-only buttons and touch targets

An icon used as a standalone interactive control (no visible label) must have a minimum touch/click target of 44×44px (mobile) / 32×32px (desktop with mouse precision), regardless of the icon's own visual size — the icon can be 20px while its clickable area is 44px. This is a hard accessibility requirement, not a preference (`ACCESSIBILITY.md`). Every icon-only button must have an accessible label (`aria-label` or equivalent) describing its action — "Delete," not "Trash icon."

## Where emoji remain acceptable

- **User-generated/social content** (CareFind's social feed, gifts, reactions) — emoji are appropriate here because the content itself is informal, user-authored, and emotionally expressive by design.
- **Internal/admin tooling as a fast, low-stakes shorthand** during early product stages — acceptable technical debt, not acceptable in the target system for user-facing product surfaces.

## What this system avoids

- No icon set mixing (e.g., some screens using Lucide, others using Font Awesome, others using emoji) — pick one system and apply it everywhere.
- No 3D, gradient-filled, or multi-color decorative icon styles — flat, single-color, consistent stroke.
- No icon used without a text label *or* an accessible label — an icon alone, with neither visible text nor an `aria-label`, is a guessing game for every user, sighted or not.
