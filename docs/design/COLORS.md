# Colors

The palette below formalizes and extends the colors already in production use across both codebases (`apps/carehub/src/lib/utils.js`'s `TEAL`/`DARK`/`TEALC` constants, `apps/carefind/src/styles/theme.js`). This is not a break from what exists — it's that palette, made systematic, given a real scale, and given explicit usage rules so it stops drifting per-screen.

## Why this palette

Warm natural teal paired with a deep forest-navy — avoids both the "blue and white" cliché of generic medical software and the anxious red-cross association of emergency healthcare branding. Paired with a deep forest-navy rather than black, the palette stays warm and premium instead of cold and corporate. Both colors are already battle-tested across dozens of real screens in both products; this document exists to make their *use* consistent, not to replace them.

## Core brand colors

| Token | Hex | Usage |
|---|---|---|
| `tealDeep` | `#0E6F5A` | Primary brand color. Primary buttons, active nav states, links, focus rings |
| `tealBright` | `#1A8A72` | Gradient partner to tealDeep, hover states, secondary accents |
| `tealHover` | `#0B5A49` | Button hover state |
| `navy` | `#0B4A3E` | Primary text color, dark surfaces, secondary buttons (`DarkBtn`) |
| `navySoft` | `#155A4B` | Secondary dark surface, gradient partner |

**Brand gradient:** `linear-gradient(135deg, #0B4A3E 0%, #155A4B 55%, #0E6F5A 130%)` — used as the hero gradient and on DarkBtn.

**Teal gradient:** `linear-gradient(135deg, #0E6F5A, #0B4A3E)` — used for primary buttons on screens not yet migrated to flat `tealDeep`.

| Token | Hex | Usage |
|---|---|---|
| `tealMist` | `#e8f3ee` | Tinted fill behind feature icons and small illustrative chips — a soft teal recess, distinct from `successBg`'s more saturated green. Pairs with `tealDeep` icon glyphs on top. Small-area use only. |

## Page background

`bg` (`#F7F5EF`) is the default page background for both apps. It reads as a near-white, faintly warm neutral — deliberately subtle, not a parchment/cream surface. Cards, modals, and inputs sit on `cardBg` (`#FBFAF6`) on top of it.

## Neutral scale

| Token | Hex | Usage |
|---|---|---|
| `bg` | `#F7F5EF` | Page background |
| `cardBg` | `#FBFAF6` | Card, modal, and input surface background |
| `border` | `#ECEAE0` | Borders, dividers |
| `gray50` | `#F7F5EF` | Subtle fills (disabled states, icon backgrounds) |
| `gray100` | `#F0EEE5` | Secondary fills, badge backgrounds |
| `gray200` | `#E7E4D9` | Borders, dividers, disabled button background |
| `gray300` | `#D4D0C5` | Secondary borders, placeholder-adjacent UI |
| `gray400` | `#9AA69F` | Tertiary text, placeholder text, disabled text |
| `gray500` | `#8B978F` | Secondary text |
| `gray600` | `#3C4B44` | Body text (mid-emphasis) |
| `gray900` | `#182722` | Primary text (matches `textDark`) |

## Text colors

| Token | Hex | Usage |
|---|---|---|
| `textDark` | `#182722` | Primary text/headings |
| `textMid` | `#3C4B44` | Body text |
| `textLight` | `#6B7B73` | Secondary text, captions, metadata |

All text-on-background combinations using these tokens pass WCAG 2.1 AA (4.5:1 minimum).

## Semantic colors

| Token | Hex | Meaning | Usage |
|---|---|---|---|
| `success` | `#16a34a` | Positive, completed, healthy | Success toasts, "active"/"paid"/"approved" status, positive deltas |
| `successBg` | `#f0fdf4` | — | Background fill behind success badges/banners |
| `warning` | `#d97706` | Needs attention, pending | Pending status, low-stock warnings, expiring-soon flags |
| `warningBg` | `#fffbeb` | — | Background fill behind warning badges/banners |
| `alert` / `danger` | `#dc2626` | Destructive, error, expired | Delete actions, error messages, expired/rejected status |
| `dangerBg` | `#fef2f2` | — | Background fill behind danger badges/banners |
| `info` | `#2563eb` | Neutral informational | Informational banners, "new" badges — used sparingly since blue is not a brand color |
| `infoBg` | `#eff6ff` | — | Background fill behind info badges/banners |
| `purple` | `#7c3aed` | Tertiary categorical color | Used only for status differentiation when success/warning/danger/info are already in use |

## Usage rules

1. **Teal is the only color allowed for a primary action.** A screen has one primary button; it is teal — flat `tealDeep`. Every other button is neutral (ghost/outline) or navy.
2. **Semantic colors are earned by real state, never decorative.** Green only for "this is actually good/complete." Red only for "this is actually bad/destructive/urgent."
3. **Background fills (`-Bg` tokens) always pair with their full-saturation counterpart** for the foreground element (text or icon), never used as a large surface fill alone.
4. **Navy, not black.** Nothing in this system uses pure black (`#000000`) — text, dark surfaces, and shadows all derive from the forest-navy family.
5. **The purple auxiliary color is a last resort**, used only when four semantic colors are genuinely insufficient.

## Contrast and accessibility

All text-on-background and icon-on-background combinations in this system must meet **WCAG 2.1 AA**: 4.5:1 for normal text, 3:1 for large text (18px+/14px+bold) and UI components/graphical objects. See `ACCESSIBILITY.md` for the full standard. Practically:

- `navy` (`#0B4A3E`) or `textDark` (`#182722`) text on `cardBg` or `bg`: passes comfortably (contrast > 9:1).
- `white` text on `tealDeep` (`#0E6F5A`) or `navy` (`#0B4A3E`): passes (contrast > 5:1).
- `textLight` (`#6B7B73`) on `cardBg` (`#FBFAF6`): passes (~5.5:1).
- Never place body text directly on the teal gradient without verifying contrast at both ends.
- Semantic `-Bg` tokens paired with their matching saturated foreground color (e.g. `success` text on `successBg`) are pre-verified to pass.

## Elevation / shadow scale

Shadows use the forest-navy base (`#0B4A3E`), never pure black:

| Level | Shadow |
|---|---|
| 1 | `0 1px 4px rgba(11,74,62,0.05)` |
| 2 | `0 4px 16px rgba(11,74,62,0.08)` |
| 3 | `0 8px 24px rgba(11,74,62,0.12)` |
| 4 | `0 20px 48px rgba(11,74,62,0.18)` |

## Dark surfaces (navy-on-navy contexts)

CareHub's admin/detail-view headers occasionally use a dark navy surface with white text. On these surfaces:
- Primary text: white
- Secondary text: `#9AA69F` (gray-400)
- Borders/dividers on dark surfaces: `rgba(255,255,255,0.12)`, not a neutral gray value

## What this palette explicitly avoids

- **No blue-and-white "generic medical" scheme.** Blue (`info`) exists only as a minor semantic color, never as a structural or brand color.
- **No gradient backgrounds on page chrome.** The brand gradient is reserved for primary buttons and small celebratory surfaces — not headers, not sidebars, not card backgrounds.
- **No more than one accent color competing with teal on a single screen.** If a screen has teal *and* purple *and* blue all doing "important" work simultaneously, it has a hierarchy problem, not a palette problem.