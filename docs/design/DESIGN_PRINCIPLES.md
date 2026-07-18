# Design Principles

This document has two parts: the **research** that grounds these principles (what we studied, what works, what to adopt, what to avoid), and the **principles themselves** (the rules that follow from that research, stated as things you can check a screen against).

---

## Part 1 — Research

We are not copying any product listed here. We are extracting *why* something works, so we can apply the same reasoning to a healthcare context these products were never designed for.

### Enterprise products

**Stripe**
- *What works:* Documentation-grade information density presented without ever feeling cluttered — achieved almost entirely through typography (a real type scale, consistently applied) and whitespace discipline, not through visual devices. Restrained color: one blue, used sparingly, surrounded by near-monochrome UI.
- *Why it works:* Color and weight are reserved for what actually matters (the primary action, the number that changed), so they carry meaning instead of decorating.
- *Adopt:* Reserve saturated color for meaning, not decoration. Let typography — not boxes and shadows — do the work of separating content.
- *Avoid:* We won't copy Stripe's specific blue or its exact grid; we adopt the *discipline*, not the palette.

**Linear**
- *What works:* Extreme keyboard-first design (command palette, `⌘K`, single-letter shortcuts for common actions) without sacrificing mouse usability. Dark, calm base UI with a single sharp accent color. Nearly zero unnecessary motion — transitions exist only to explain state change, never to delight.
- *Why it works:* Linear's users (engineers) live in the tool for hours; every saved keystroke compounds. This is directly analogous to a pharmacist or doctor in CareHub.
- *Adopt:* Command-palette-style global search/action for CareHub (see `NAVIGATION.md`). Motion that explains, not motion that impresses (see `MOTION.md`).
- *Avoid:* Linear's aesthetic is intentionally cold and technical. CareHub needs to feel calm and premium, not cold — healthcare software that feels like a spreadsheet erodes trust even among professional users.

**GitHub**
- *What works:* An enormous surface area of features that still feels navigable because of extremely consistent layout primitives (the same page-header-plus-tabs shape reused everywhere) and a restrained, functional color system (green for good, red for bad, everything else neutral).
- *Why it works:* Once you've learned one GitHub page, you've learned the shape of every GitHub page.
- *Adopt:* A small number of page-level layout templates (`LAYOUTS.md`), reused relentlessly rather than each screen inventing its own structure.
- *Avoid:* GitHub's density can tip into overwhelming for a first-time user — a real risk for CareFind, whose users are not repeat power users.

**Notion**
- *What works:* Progressive disclosure — almost everything starts simple and reveals complexity only on interaction (hover reveals actions, click reveals options). Generous whitespace that never feels wasteful because the content itself is well-organized.
- *Why it works:* A new user is never confronted with every capability at once.
- *Adopt:* Progressive disclosure for CareHub's more complex forms and for CareFind's search/filter surfaces (`UX_PATTERNS.md`).
- *Avoid:* Notion's infinite flexibility (anything can be anything) is wrong for CareHub, where workflows are structured and consistency matters more than configurability.

**Figma**
- *What works:* A toolbar and properties-panel model that puts the content canvas first and controls at the edges, always in the same place. Precise, technical typography (real numeric inputs, real units) that signals "this tool is exact."
- *Why it works:* Spatial consistency means muscle memory forms fast.
- *Adopt:* Fixed, predictable placement of navigation, filters, and actions in CareHub's multi-panel layouts (`LAYOUTS.md`).

**Atlassian (Jira/Confluence)**
- *What works (post-redesign, i.e. the current design system, not legacy Jira):* Clear, consistent status/badge vocabulary across a huge product surface. Strong information hierarchy in list views via typography weight rather than boxes.
- *What to avoid:* Legacy Jira is the canonical example of "so configurable it becomes incoherent" — different teams' Jira instances look and behave completely differently. The Care Ecosystem's screen patterns exist specifically to prevent this failure mode.

**Slack**
- *What works:* A sidebar-plus-content model that scales from one workspace to hundreds of channels without becoming unusable, via strong visual hierarchy (unread state, section grouping) rather than raw information density.
- *Adopt:* Sidebar patterns for CareHub's navigation (`NAVIGATION.md`), unread/pending-count badges applied consistently.

### Healthcare products

**Epic, Cerner, Athenahealth**
- *What they get right:* Extreme information density that experienced clinical staff can navigate very fast once trained — dense tables, keyboard-driven data entry, minimal wasted screen space.
- *What they get badly wrong, and why we study them anyway:* These are the industry's own cautionary tales. Notoriously punishing onboarding curves. Visual hierarchy that relies entirely on position memorization rather than actual design (a button is "the third one from the left," not "the one that looks like the primary action"). Color used inconsistently or not at all for status. The result: clinician burnout that's been directly studied and linked to EHR usability specifically.
- *What we take:* The legitimacy of high density for expert daily-use software (CareHub can and should be denser than a consumer app).
- *What we explicitly reject:* Density achieved by abandoning visual hierarchy. CareHub is allowed to show a lot of information on screen; it is never allowed to make that information equally weighted so the user has to already know where to look.

### Design systems

**Apple Human Interface Guidelines**
- *Take:* Clarity as the top-level design value; content over chrome; deference (the UI supports content, it doesn't compete with it).
- *Leave:* Apple's specific iOS interaction patterns (swipe gestures, sheet behaviors) are mobile-OS-specific — useful reference for CareFind, largely irrelevant to CareHub's desktop context.

**Google Material Design 3**
- *Take:* A genuinely rigorous elevation/shadow system and a well-reasoned dynamic color methodology (tonal palettes derived systematically rather than picked by eye) — see `COLORS.md` and `ELEVATION.md`, which borrow the *method*, not the *values*.
- *Leave:* Material's visual signature (large filled buttons, pronounced ripple effects, heavy use of colored surfaces) reads as "Android app," which actively works against the "not templated" requirement.

**IBM Carbon**
- *Take:* This is the single closest reference for CareHub specifically — Carbon is a design system built explicitly for dense, data-heavy enterprise software (IBM's own admin tools), with real guidance on data tables, forms at scale, and a sober, restrained color story. Its 2px-grid-driven spacing discipline and its explicit "don't use elevation/shadow to fake hierarchy that should come from typography" stance are directly adopted here.
- *Leave:* Carbon's specific typeface (IBM Plex) and its very square, sharp-cornered aesthetic — the Care Ecosystem uses a slightly softer corner-radius language (`SPACING.md`, `COMPONENT_LIBRARY.md`) to stay warmer, appropriate for healthcare.

**Microsoft Fluent**
- *Take:* Fluent's acrylic/depth system for indicating temporary, overlaid UI (dialogs, flyouts) versus permanent UI is a useful mental model, informing `ELEVATION.md`'s z-index and shadow rules.
- *Leave:* Fluent's translucency/blur effects are a performance cost the Care Ecosystem doesn't take on, especially for CareFind on lower-end devices/slower connections.

**Shopify Polaris**
- *Take:* This is the second-closest reference, alongside Carbon — Polaris is built for merchants running a business through the software, which is structurally identical to CareHub's pharmacy-owner-running-a-business context. Its empty-state guidance (always actionable, never just decorative) and its resource-list pattern (the shape underlying most of CareHub's list/table screens) are directly adopted in `SCREEN_PATTERNS.md`.
- *Leave:* Polaris's green identity is Shopify's; not relevant to visual identity, only to structural pattern.

**Ant Design**
- *Take:* Genuinely comprehensive form and data-entry component coverage — one of the few systems with real guidance for complex multi-field enterprise forms at scale, informing `UX_PATTERNS.md`'s validation and data-entry standards.
- *Leave:* Ant's default visual styling reads unmistakably as "Chinese enterprise admin template" — exactly the generic, templated feeling this system is built to avoid. Pattern structure only, never surface styling.

### Synthesis: what this means for CareHub and CareFind specifically

| Source | What CareHub takes | What CareFind takes |
|---|---|---|
| Stripe | Restrained, meaningful color; typography-led hierarchy | Same restraint, applied to a warmer palette |
| Linear | Command palette, keyboard-first, minimal motion | Minimal motion only (no command palette — not a power-user context) |
| GitHub | Reused layout templates across a large surface | Reused card/list templates for provider/business results |
| Notion | Progressive disclosure in complex forms | Progressive disclosure in search/filter |
| Carbon | Data-table discipline, typography over elevation | — |
| Polaris | Resource-list pattern, actionable empty states | Actionable empty states |
| Epic/Cerner (negative) | High density is fine; losing hierarchy is not | — |
| Apple HIG | — (desktop-first) | Content-over-chrome, deference |

---

## Part 2 — The principles

Every principle below is written so it can be used as a yes/no check against a real screen.

### 1. Hierarchy comes from typography and spacing first, color and boxes second
**Check:** Could you understand what's most important on this screen with all color removed, using only size, weight, and position? If not, the hierarchy is faked with color instead of built with structure.

### 2. Color is meaning, not decoration
**Check:** Does every use of a saturated color on this screen correspond to a real semantic state (primary action, success, warning, danger, active/selected)? If a color is there because the screen "felt empty," remove it and fix the layout instead.

### 3. One primary action per screen
**Check:** Can you point to exactly one button that is visually the primary action? If there are two, one of them is wrong — either it's not actually as important as it looks, or the screen is trying to do two jobs and should be two screens.

### 4. Density is earned by hierarchy, not avoided by whitespace
**Check:** CareHub screens are allowed to be dense. The question is never "is there enough whitespace" but "given the density, can a trained user find what they need in under two seconds." Whitespace is a tool for hierarchy, not a default posture.

### 5. Every screen has three states beyond the happy path: loading, empty, error
**Check:** Has each of these actually been designed, or does the spec only show the screen full of good data? An unhandled empty state is not a minor omission — for a new CareHub business or a CareFind search with no results, it's the *first* thing a real user sees.

### 6. Progressive disclosure over configuration sprawl
**Check:** Does this screen show every option all the time, or does it show the common path by default and reveal advanced options on demand? Prefer the latter, always.

### 7. Consistency beats local optimization
**Check:** Would a designer solving this screen's problem in isolation invent something different from what `SCREEN_PATTERNS.md` already specifies? If the local solution is marginally better but breaks the pattern, use the pattern. A slightly-worse-but-consistent system beats a slightly-better-but-fragmented one, because the fragmentation cost compounds across every future screen.

### 8. Motion explains state, it doesn't perform
**Check:** If you removed this animation, would the user be confused about what just happened? If not, it's decoration — cut it. See `MOTION.md`.

### 9. Confirm the irreversible, don't confirm the routine
**Check:** Is this confirmation dialog protecting against real, hard-to-reverse harm (deleting a patient record, refunding a sale), or is it just friction on a routine, reversible action? The latter trains users to click through dialogs without reading them, which defeats the former.

### 10. Accessibility is a constraint on the design, not a pass afterward
**Check:** Was this screen designed with keyboard navigation, screen-reader labeling, and color-contrast in mind from the first draft, or is accessibility being retrofitted after the visual design is "done"? See `ACCESSIBILITY.md`.

### 11. Design for the breakpoint you're in, not a shrunk version of another one
**Check:** Does this mobile layout do a genuinely different job than the desktop layout, appropriate to a thumb and a smaller viewport — or is it the same layout with things stacked and made smaller? See `RESPONSIVENESS.md`.

### 12. Trust is a design output, not a marketing claim
**Check (CareFind specifically):** Does this screen give a first-time, anxious user concrete reasons to trust what they're seeing (verification badges, real review counts, clear provenance) — or does it just assert trustworthiness through polish alone? Polish is necessary but not sufficient.

### 13. Speed is a feature
**Check (CareHub specifically):** Does this workflow require the minimum number of clicks/keystrokes for a repeat user doing this action for the hundredth time? Optimize for the expert's hundredth use, while remaining learnable on the first.
