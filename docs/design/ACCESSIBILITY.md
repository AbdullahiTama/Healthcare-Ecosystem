# Accessibility

## The standard

**WCAG 2.1 Level AA**, minimum, across both products, with no exceptions carved out for "internal tools" (CareHub is used by professionals, but professionals include people with disabilities, and the tool is used for hours a day — accessibility failures compound faster here than almost anywhere else in the system). This is a floor, not a target to approach eventually — per Design Principle 10, it is a constraint from the first draft of every screen, not a pass applied afterward.

## Color and contrast

- **Text contrast:** 4.5:1 minimum for body text, 3:1 for large text (18px+ regular or 14px+ bold) — see `COLORS.md` for which pairings are pre-verified.
- **Non-text contrast:** 3:1 minimum for UI components and graphical objects that convey meaning (icon-only buttons, form field borders, focus indicators, chart data).
- **Never color alone.** Every place color conveys state (status badges, form validation, chart series) must have a second, non-color signal too — an icon, a text label, a pattern. A red border on an invalid field must be paired with visible error text, not rely on color alone to communicate the problem.

## Keyboard navigation

- **Every interactive element must be reachable and operable via keyboard alone** — tab order follows visual/logical reading order, never a DOM order that doesn't match what's on screen.
- **Focus must be visible.** A clear focus ring (2px, `teal-600`, sufficient contrast against any background it appears on) on every focusable element, never removed via `outline: none` without a replacement.
- **CareHub specifically:** given its dense, repeat-use context (Design Principle 13), keyboard shortcuts are a real feature, not an accessibility afterthought — see `NAVIGATION.md` for the shortcut system. Every shortcut-accessible action must also be reachable through the standard tab-and-click path; shortcuts are an acceleration, never the only path.
- **Modals and drawers trap focus** while open (tab cycles within the modal, doesn't escape to the page behind it) and return focus to the triggering element on close.
- **Escape key closes** any modal, drawer, dropdown, or popover.

## Screen readers

- **Every icon-only interactive element has an accessible label** (`aria-label` or visually-hidden text) describing its action, not its appearance — "Delete product," not "Trash icon" (`ICONS.md`).
- **Form fields have real, programmatically-associated labels** (`<label for>` or `aria-labelledby`), never placeholder text used as the only label — placeholder text disappears on input and is not reliably announced by all screen readers.
- **Status changes are announced.** A toast notification, a form validation error, a loading-to-loaded transition — these need `aria-live` regions so a screen-reader user knows something happened without having to go looking for it.
- **Tables are real tables** (`<table>`/`<th>`/proper scope attributes), not div-based visual approximations, so screen readers can navigate them by row/column.
- **Semantic HTML first.** Use a real `<button>` for a button, a real `<a>` for a link that navigates, before reaching for ARIA roles to patch a div into behaving like one.

## Touch targets

- **Minimum 44×44px** for any tappable control on a touch surface (CareFind primarily, CareHub's tablet-context screens) — matches `ICONS.md`'s icon-button rule. This applies even when the visible control (an icon, a checkbox) is smaller; the tappable *area* must meet the minimum via padding.
- **Adequate spacing between adjacent touch targets** (at least 8px) to prevent mis-taps, especially in CareFind's list/card contexts where a "save," "share," and "report" action might sit close together.

## Forms

- **Errors are specific and actionable**, associated with their field (`aria-describedby`), not just a generic banner at the top of the form saying "please fix errors below."
- **Required fields are marked visually and programmatically** (`required` attribute plus a visible indicator — this system uses a red asterisk, consistent with existing convention).
- **Validation timing:** don't validate a field as an error while the user is still typing their first attempt at it (validate on blur or on submit, not on every keystroke) — see `UX_PATTERNS.md` for the full validation-timing standard.

## Motion and vestibular considerations

- **Respect `prefers-reduced-motion`** system-wide, as detailed in `MOTION.md` — every transition needs a reduced/no-motion fallback.
- **No auto-playing video or audio** anywhere in either product without an explicit user action to start it.
- **No content that flashes more than three times per second** (seizure risk) — relevant to any future data-visualization or live-update feature.

## Content and language

- **Plain language over jargon** where possible, especially in CareFind (a patient should never need to know clinical terminology to use the product) — CareHub can use professional/clinical terminology since its users are professionals, but even there, error messages and system feedback should be plain and specific rather than technical (`BRAND_GUIDELINES.md`).
- **Alt text on every meaningful image**, empty `alt=""` on purely decorative images so screen readers skip them rather than announcing meaningless filenames.
- **Language of page/content is programmatically declared** (`lang` attribute), important for any future multi-language support.

## Testing bar

Before a screen ships, it should be verifiable — not just designed-with-good-intentions — against:
1. Keyboard-only navigation from top to bottom of the screen.
2. A screen reader pass (VoiceOver/NVDA) confirming every control is announced meaningfully.
3. A contrast check (automated tooling is fine) on every text/background and icon/background pairing.
4. `prefers-reduced-motion` enabled, confirming no jarring or missing-context transitions.

This is also the accessibility section referenced by `DESIGN_CHECKLIST.md`'s review gate — nothing here is optional at ship time.
