# Brand Guidelines

## The identity, in one line

**Calm competence.** Not clinical-cold, not consumer-cheerful — the visual and verbal tone of a healthcare professional who is very good at their job and doesn't need to raise their voice to prove it.

## The Care Ecosystem umbrella

CareHub and CareFind are siblings under one identity, not two separate brands that happen to share a backend. Both derive from the same core palette (deep teal `#0f766e`/bright teal `#14b8a6`, navy `#0f172a`) and the same wordmark logic (`Care` + a functional suffix: **Hub** for the operational side, **Find** for the discovery side). Future products in the ecosystem should follow the same naming logic (`Care` + a plain English verb/noun describing its job) rather than an invented brand name — the point is that the ecosystem reads as infrastructure, not as a portfolio of unrelated apps.

## Logo and mark

- **Wordmark-led.** Both products should primarily use a wordmark (styled text), not an abstract icon-only mark, at this stage — the brand is young enough that a wordmark builds recognition faster than an abstract symbol would.
- **Weight:** Extra-bold/black weight (matching the `900` font-weight already used for emphasis throughout both codebases), set in the primary type family (`TYPOGRAPHY.md`).
- **Color:** Navy (`#0f172a`) on light backgrounds, white on dark or photographic backgrounds. Never the teal accent as the wordmark's own color — teal is reserved as an *accent to* the brand, not the brand's own color, so it retains meaning when used functionally elsewhere in the UI (Principle 2, `DESIGN_PRINCIPLES.md`).
- **Minimum clear space:** at least the height of the wordmark's cap-height on all sides.
- **Never:** stretched, rotated, placed on a busy photographic background without a scrim, recolored to anything outside the defined palette, or combined with a drop shadow.

## Voice and tone

| Context | Voice |
|---|---|
| CareHub UI copy (buttons, labels, empty states) | Direct, professional, zero filler. "Add Product," not "Let's add a new product!" |
| CareHub error messages | Specific and actionable. "Quantity must be greater than zero," not "Something went wrong." |
| CareFind UI copy | Warm but plain. "Find a doctor near you," not "Discover amazing healthcare providers!!" |
| CareFind trust/safety copy | Calm, factual, never alarmist. Reassurance through clarity, not through exclamation. |
| Both, always | No exclamation points except in genuine celebratory confirmation (e.g. "Order placed!" after a real completed action) — never in routine UI copy. No emoji in production UI copy (emoji are acceptable in internal/admin tooling icons per existing convention, not in user-facing microcopy). |

**Never:** cutesy error messages, guilt-tripping empty states ("Don't leave your patients waiting!"), or marketing-voice language inside the working product (`"Unlock premium features"`-style upsell language has no place in CareHub, which is a tool professionals pay for and rely on, not a freemium consumer app).

## What "premium" means here (and what it doesn't)

Premium in this system means: **precision, restraint, and reliability** — not luxury signifiers borrowed from unrelated industries.

- ✅ Perfectly consistent spacing and alignment
- ✅ Typography that's been actually tuned (real line-height, real letter-spacing on labels), not left at browser defaults
- ✅ Fast, predictable interactions with no jank
- ✅ A palette used with confidence and restraint

- ❌ Gold accents, serif display faces, or other "luxury" visual cliché — wrong industry, wrong message (a hospital administrator does not want their inventory system to look like a boutique hotel's website)
- ❌ Glassmorphism, heavy gradients, or decorative illustration for its own sake
- ❌ Dense marketing-site-style hero sections inside the working product

## Product differentiation within one brand

CareHub and CareFind must be instantly distinguishable from a screenshot (different density, different navigation shape, different dominant layout — see `LAYOUTS.md` and `NAVIGATION.md`) while being unmistakably related from the same screenshot (same palette, same corner-radius language, same type family, same iconography style). Think "two products from the same studio," the way Google Docs and Google Sheets are visibly different tools that are unmistakably Google.

## Photography and illustration

- **Photography (CareFind primarily):** Real, warm, human — actual healthcare settings and people, never generic stock-photo "doctor giving thumbs up" imagery. If real photography isn't available for a given context, prefer no image over a generic stock substitute.
- **Illustration:** Used sparingly, only for empty states and onboarding (see `SCREEN_PATTERNS.md` → Empty State). A single consistent illustration style — simple, geometric, using the brand palette — not a mix of illustration styles pulled from different sources. CareHub uses illustration even more sparingly than CareFind; a professional tool used for hours a day should not decorate itself with cartoons.

## Iconography

See `ICONS.md` for the full system. Brand-level rule: one icon set, used consistently, never mixed with emoji in the same context (emoji are acceptable as a deliberate, isolated device — e.g., a single reaction emoji in a social feed — never interchangeably with the functional icon set in navigation, buttons, or status indicators).
