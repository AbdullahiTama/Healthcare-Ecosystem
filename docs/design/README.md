# Care Ecosystem Design System

This is the single source of truth for the UI/UX architecture of **CareHub** (enterprise healthcare management) and **CareFind** (public healthcare discovery) — two products, one design language, two different postures.

**This is documentation, not code.** Nothing here is a component library, a Tailwind config, or a Figma file. It is the set of decisions and rules that any of those artifacts must be built from. If an implementation and this documentation disagree, the implementation is wrong until this documentation is deliberately revised — not the other way around.

**Mandatory before any new screen, component, or workflow is designed or built**: read `DESIGN_PRINCIPLES.md`, then find the closest matching entry in `SCREEN_PATTERNS.md`. Deviating from an existing pattern requires a documented reason, not a default.

---

## How this system is organized

### 1. Why — the reasoning layer
Read these once, deeply. Everything downstream derives from them.

| Document | What it answers |
|---|---|
| [`DESIGN_VISION.md`](DESIGN_VISION.md) | What is the Care Ecosystem trying to be, and for whom? |
| [`DESIGN_PRINCIPLES.md`](DESIGN_PRINCIPLES.md) | What rules govern every design decision, and why? |
| [`BRAND_GUIDELINES.md`](BRAND_GUIDELINES.md) | How do CareHub and CareFind sound and feel as distinct products under one identity? |
| [`INSPIRATION.md`](INSPIRATION.md) | What did we study, what did we take, what did we deliberately leave behind? |

### 2. What — the visual language
The tokens. Numbers and values, not prose.

| Document | Covers |
|---|---|
| [`COLORS.md`](COLORS.md) | Palette, semantic color, usage rules, contrast requirements |
| [`TYPOGRAPHY.md`](TYPOGRAPHY.md) | Type scale, families, weights, line-height |
| [`SPACING.md`](SPACING.md) | The spacing scale and when to use each step |
| [`GRID_SYSTEM.md`](GRID_SYSTEM.md) | Columns, gutters, breakpoints, containers |
| [`ICONS.md`](ICONS.md) | Icon sourcing, sizing, and usage rules |
| [`ELEVATION.md`](ELEVATION.md) | Shadow scale and when elevation is (and isn't) appropriate |
| [`MOTION.md`](MOTION.md) | Timing, easing, and — mostly — restraint |

### 3. How — structure and behavior
How screens are put together and how they behave.

| Document | Covers |
|---|---|
| [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) | The consolidated token + component reference — the "cheat sheet" |
| [`NAVIGATION.md`](NAVIGATION.md) | How users move through each product |
| [`LAYOUTS.md`](LAYOUTS.md) | Page-level structural templates |
| [`COMPONENT_LIBRARY.md`](COMPONENT_LIBRARY.md) | Every reusable component, its states, and its responsive behavior |
| [`UX_PATTERNS.md`](UX_PATTERNS.md) | Standards for search, filtering, forms, validation, bulk actions, undo, and more |
| [`ACCESSIBILITY.md`](ACCESSIBILITY.md) | The accessibility bar every screen must clear |
| [`RESPONSIVENESS.md`](RESPONSIVENESS.md) | How each breakpoint is *designed*, not just scaled |

### 4. The blueprint
| Document | Covers |
|---|---|
| [`SCREEN_PATTERNS.md`](SCREEN_PATTERNS.md) | **The most important document.** Every screen type, fully specified. Start here when building anything new. |

### 5. Governance
| Document | Covers |
|---|---|
| [`DESIGN_CHECKLIST.md`](DESIGN_CHECKLIST.md) | The review gate every screen passes through before shipping |

---

## The two products, in one sentence each

- **CareHub** is where a pharmacist, doctor, or hospital administrator spends eight hours a day. It must feel like a cockpit: dense, fast, keyboard-friendly, calm under load. Desktop-first.
- **CareFind** is where a worried parent looks for a pediatrician at 11pm on their phone. It must feel like it can be trusted in thirty seconds. Mobile-first.

They share a visual language — the same teal-and-navy identity, the same type system, the same spacing scale — because they are one ecosystem and a user may move between them. They do not share a layout philosophy, because they solve different problems for different people under different constraints.

## Non-negotiables

These are referenced throughout the system, so they're stated once, here, plainly:

1. **No screen ships without an empty state, a loading state, and an error state.** All three, not the happy path alone.
2. **No new pattern without checking `SCREEN_PATTERNS.md` first.** If nothing fits, propose an addition to that document — don't invent a one-off.
3. **Accessibility is not a pass at the end.** See `ACCESSIBILITY.md` — it is a constraint on every decision, not a checklist applied retroactively.
4. **Every breakpoint is a designed layout, not a shrunk one.** See `RESPONSIVENESS.md`.
5. **One primary action per screen.** If a screen seems to need two, the screen is wrong, not the rule.

## Who this is for

Every developer, designer, and AI assistant working on CareHub or CareFind. If you are about to design or implement a screen and haven't read `DESIGN_PRINCIPLES.md` and checked `SCREEN_PATTERNS.md`, stop and do that first.
