# Colors

The palette below formalizes and extends the colors already in production use across both codebases (`apps/carehub/src/lib/utils.js`'s `TEAL`/`DARK`/`TEALC` constants, `apps/carefind/src/styles/theme.js`). This is not a break from what exists — it's that palette, made systematic, given a real scale, and given explicit usage rules so it stops drifting per-screen.

## Why this palette

Teal reads as clinical without reading as sterile — it avoids both the "blue and white" cliché of generic medical software and the anxious red-cross association of emergency healthcare branding. Paired with a deep navy rather than black, the palette stays warm and premium instead of cold and corporate. Both colors are already battle-tested across dozens of real screens in both products; this document exists to make their *use* consistent, not to replace them.

## Core brand colors

| Token | Hex | Usage |
|---|---|---|
| `teal-600` (deep) | `#0f766e` | Primary brand color. Primary buttons, active nav states, links, focus rings |
| `teal-500` (bright) | `#14b8a6` | Gradient partner to teal-600, hover states, secondary accents |
| `navy-900` | `#0f172a` | Primary text color, dark surfaces, secondary buttons (`DarkBtn`) |
| `navy-800` | `#1e293b` | Secondary dark surface, dark-mode card backgrounds |

**Brand gradient** (use sparingly — see rules below): `linear-gradient(135deg, #0f766e, #14b8a6)`. This exists in code today as the primary-button background and should stay reserved for exactly that: primary calls to action and small celebratory moments (success toasts, completion states). It is not a background pattern, not a card treatment, not a page hero by default.

## Neutral scale

| Token | Hex | Usage |
|---|---|---|
| `gray-50` | `#f9fafb` | Page background (CareFind) |
| `gray-100` | `#f3f4f6` | Subtle fills (disabled states, icon backgrounds) |
| `gray-200` | `#e5e7eb` | Borders, dividers, disabled button background |
| `gray-300` | `#cbd5e1` | Secondary borders, placeholder-adjacent UI |
| `gray-400` | `#94a3b8` | Tertiary text, placeholder text, disabled text |
| `gray-500` | `#64748b` | Secondary text |
| `gray-600` | `#475569` | Body text (mid-emphasis) |
| `gray-900` | `#0f172a` | Primary text (same as `navy-900` — text and the darkest neutral are deliberately the same value) |
| `white` | `#ffffff` | Card/surface background, text-on-dark |

## Semantic colors

| Token | Hex | Meaning | Usage |
|---|---|---|---|
| `success` | `#16a34a` | Positive, completed, healthy | Success toasts, "active"/"paid"/"approved" status, positive deltas |
| `success-bg` | `#f0fdf4` | — | Background fill behind success badges/banners |
| `warning` | `#d97706` | Needs attention, pending | Pending status, low-stock warnings, expiring-soon flags |
| `warning-bg` | `#fffbeb` | — | Background fill behind warning badges/banners |
| `danger` | `#dc2626` | Destructive, error, expired | Delete actions, error messages, expired/rejected status |
| `danger-bg` | `#fef2f2` | — | Background fill behind danger badges/banners |
| `info` | `#2563eb` | Neutral informational | Informational banners, "new" badges — used sparingly since blue is not a brand color; prefer teal for anything that isn't strictly neutral-informational |
| `info-bg` | `#eff6ff` | — | Background fill behind info badges/banners |
| `purple` (auxiliary) | `#7c3aed` | Tertiary categorical color | Used only for status differentiation when success/warning/danger/info are already in use on the same screen for other statuses (e.g. a 5-state pipeline) — never as a primary brand color |

## Usage rules

1. **Teal is the only color allowed for a primary action.** A screen has one primary button; it is teal (or the teal gradient). Every other button is neutral (ghost/outline) or navy (secondary-dark).
2. **Semantic colors are earned by real state, never decorative.** Green only for "this is actually good/complete." Red only for "this is actually bad/destructive/urgent." If you want visual variety on a screen with no real status to convey, that's a sign the layout needs work, not more color.
3. **Background fills (`-bg` tokens) always pair with their full-saturation counterpart for the foreground element** (text or icon), never used as a large surface fill alone — these are for small-area contexts: badges, pills, banner backgrounds, table row highlights.
4. **Navy, not black.** Nothing in this system uses pure black (`#000000`) — text, dark surfaces, and shadows all derive from the navy family, keeping the whole palette warm even at its darkest values.
5. **The purple auxiliary color is a last resort**, used only when four semantic colors are genuinely insufficient to distinguish real states on one screen (e.g., an order pipeline: submitted/approved/processing/dispatched/delivered — five real states). Never introduce a sixth categorical color; redesign the status model instead.

## Contrast and accessibility

All text-on-background and icon-on-background combinations in this system must meet **WCAG 2.1 AA**: 4.5:1 for normal text, 3:1 for large text (18px+/14px+bold) and UI components/graphical objects. See `ACCESSIBILITY.md` for the full standard. Practically:

- `navy-900` text on `white` or any `gray-50`–`gray-200` background: passes comfortably.
- `white` text on `teal-600` or `navy-900`: passes.
- `white` text on `teal-500` alone (without the gradient's darker end): **borderline — verify per use, prefer the full gradient or teal-600 for text-bearing surfaces.**
- Never place body text directly on the teal gradient without verifying contrast at both ends of the gradient.
- Semantic `-bg` tokens paired with their matching saturated foreground color (e.g. `success` text on `success-bg`) are pre-verified to pass and are the default pattern for badges/pills — don't substitute other foreground/background pairings without checking contrast.

## Dark surfaces (navy-on-navy contexts)

CareHub's admin/detail-view headers occasionally use a dark navy surface with white text (see `SCREEN_PATTERNS.md` → Detail View). On these surfaces:
- Primary text: white
- Secondary text: `#94a3b8` (gray-400) at reduced opacity is acceptable for de-emphasized metadata
- Borders/dividers on dark surfaces: `rgba(255,255,255,0.12)`, not a neutral gray value

## What this palette explicitly avoids

- **No blue-and-white "generic medical" scheme.** Blue (`info`) exists only as a minor semantic color, never as a structural or brand color.
- **No gradient backgrounds on page chrome.** The brand gradient is reserved for primary buttons and small celebratory surfaces — not headers, not sidebars, not card backgrounds.
- **No more than one accent color competing with teal on a single screen.** If a screen has teal *and* purple *and* blue all doing "important" work simultaneously, it has a hierarchy problem, not a palette problem.
