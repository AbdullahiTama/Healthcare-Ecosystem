# Elevation

## Philosophy

Elevation (shadow, layering) indicates **temporary vs. permanent** and **interactive vs. static** — it is not a decorative texture applied to make flat things look "nicer." Per Design Principle 1, hierarchy comes from typography and spacing first; elevation is a supporting signal, used sparingly, reserved for genuine layering questions: *is this thing floating above the page, and will it go away?*

## The scale

| Level | Shadow | Usage |
|---|---|---|
| `elevation-0` | none | Default page background, default card resting state on most surfaces |
| `elevation-1` | `0 1px 4px rgba(15,23,42,0.05)` | Default card (the standard `Card` component's resting shadow — barely-there, mostly a soft edge definition against the page background) |
| `elevation-2` | `0 4px 16px rgba(15,23,42,0.08)` | Hover state on an interactive card, dropdown menus |
| `elevation-3` | `0 8px 24px rgba(15,23,42,0.12)` | Popovers, tooltips, floating toast notifications |
| `elevation-4` | `0 20px 48px rgba(15,23,42,0.18)` | Modals, drawers — the highest level, reserved for content that blocks/overlays the rest of the interface |

All shadow values use the navy color family (`rgba(15,23,42,...)`), never pure black — consistent with `COLORS.md`'s "no pure black" rule, keeping shadows warm rather than harsh.

## Z-index layering

| Layer | z-index range | Contents |
|---|---|---|
| Base content | 0–10 | Page content, cards at rest |
| Sticky elements | 20–40 | Sticky table headers, sticky page headers |
| Dropdowns/popovers | 50–100 | Select menus, context menus, tooltips |
| Toasts | 9000–9999 | Toast notifications (always above everything except a currently-open modal) |
| Modals/drawers | 999 (backdrop + content) | Full-screen-blocking overlays |

**Rule:** never introduce a new z-index value outside this scale. Every new overlay-type component picks the layer that matches its actual role, not an arbitrarily large number to "make sure it's on top."

## Borders as an alternative to elevation

For most content separation (a card sitting on a page, a table row separating from the next), prefer a **1px border** (`gray-200`, `#e5e7eb` or `#f0f0f0` for subtler contexts) over a shadow. Borders are:
- Cheaper to render (no blur/composite cost — meaningful for CareFind on lower-end devices)
- Crisper and more precise-feeling — a defined edge reads as more "engineered," a shadow reads as softer/more consumer
- Better suited to CareHub's dense, table-heavy contexts, where dozens of shadow-bearing cards on one screen would create visual noise

**Rule of thumb:** static, resting content on the page uses a border, or `elevation-1` at most. Elevation levels 2+ are reserved for things that are genuinely floating above other content (dropdowns, modals, toasts) — never applied to convey importance on static, in-flow content. A card is not "more important" because it has a bigger shadow; it's more important because of its typography and position (Principle 1).

## What this system avoids

- **No card-on-card nesting with escalating shadows** to imply depth (a card inside a card inside a card, each with its own shadow) — this is a common "AI-generated" tell and a direct Anti-Pattern (see `SCREEN_PATTERNS.md`).
- **No shadows on flat, in-flow UI elements** (buttons at rest, input fields at rest, table rows) — these use borders and background color, not shadow, for their resting state. A button may gain a subtle shadow specifically as a *hover/pressed* affordance, never at rest.
- **No colored shadows** (a shadow tinted teal to "match the brand") — shadows are always the neutral navy family regardless of what color the element casting them is.
