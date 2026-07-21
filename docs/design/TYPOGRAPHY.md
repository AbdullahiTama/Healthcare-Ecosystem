# Typography

Typography is the primary hierarchy tool in this system (`DESIGN_PRINCIPLES.md`, Principle 1) — it does more of the work than color or elevation, so it has to be genuinely precise, not left at defaults.

## Type family

**System font stack**, deliberately — not a custom webfont:

```
-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif
```

**Why a system stack instead of a branded webfont:** both products serve markets where connection speed and data cost are real constraints (see `DESIGN_VISION.md`). A webfont is a render-blocking cost paid by every user on every load for a marginal brand benefit. The system stack also guarantees every character (including Naira symbols, accented names, and non-Latin script in user-generated content) renders correctly without a font-loading fallback flash. This remains the family for every authenticated product surface — dashboards, POS, forms, tables, cards — in both apps, with no exception.

## Display serif (public marketing surfaces only)

Exercising the scoped exception this document has always anticipated: public marketing/landing pages (CareHub's logged-out `Landing.jsx`, and any future CareFind equivalent) use **Lora**, a warm, moderate-contrast book serif, for headline-level text only — not `body`, not any authenticated product screen.

```
"Lora", Georgia, "Times New Roman", serif
```

- Self-hosted, 2 static weights only (600 SemiBold, 700 Bold — enough for hero headlines and section eyebrows), as local `.woff2` files with `font-display: swap`.
- Declared via `@font-face` only — **no `<link rel="preload">`** in either app's `index.html`. A preload fetches on every route regardless of whether that route uses the font; a bare `@font-face` only triggers a network request when an element actually rendered on screen uses that `font-family`. Since no dashboard/POS/table/form screen ever references it, the file is never fetched outside the marketing pages that use it — the original "never loaded inside CareHub or the CareFind app shell" intent is preserved in practice, just implemented at the CSS level rather than by physically excluding the font declaration from the bundle.
- Applied only through the `fontDisplay` token in each app's `theme.js` — never hardcoded inline, so the scope stays enforceable in review.
- Still four weights max system-wide when you count the serif alongside the sans scale below (600/700 for serif, the existing sans weights for everything else) — this doesn't reopen the "no in-between values" rule.

**Monospace** (for reference numbers, batch codes, order IDs — already used in both codebases for exactly this purpose):
```
ui-monospace, "SF Mono", Menlo, Consolas, monospace
```

## Type scale

A restrained scale, matching the sizes already in real use across both codebases (10.5px–22px covers the overwhelming majority of existing UI; this table formalizes it and closes the gaps):

| Token | Size | Weight | Line-height | Usage |
|---|---|---|---|---|
| `display` | 24px | 900 | 1.2 | Page-level heroes (rare — most pages use `h1`, not `display`) |
| `h1` | 20–22px | 900 | 1.25 | Page title (`SectionHead`) |
| `h2` | 18px | 800–900 | 1.3 | Section title within a page |
| `h3` | 15–16px | 800 | 1.35 | Card title, subsection title |
| `body-lg` | 14px | 400–600 | 1.5 | Emphasized body text, form field values |
| `body` | 13px | 400–600 | 1.5 | Default body text — the most common size in the entire system |
| `body-sm` | 12px | 500–700 | 1.4 | Secondary text, table cell text, button labels |
| `caption` | 11px | 600–700 | 1.4 | Metadata, timestamps, helper text under inputs |
| `micro` | 10–10.5px | 700 | 1.3 | Badge text, uppercase eyebrow labels |

**Numeric emphasis sizes** (stat cards, prices, totals — a distinct use case from headings): 17–22px at weight 900, always paired with a much smaller (11–12px, weight 700) label above or beside it. This pattern — a big number, a small label — appears throughout CareHub's dashboards and should stay consistent rather than each screen inventing its own stat-display size.

## Weight scale

Only four weights are used anywhere in the system:

| Weight | Numeric | Usage |
|---|---|---|
| Regular | 400 | Body copy, long-form text (rare in this system — most UI text is at least 600) |
| Medium | 500–600 | Default UI text — labels, table cells, secondary buttons |
| Bold | 700–800 | Emphasis, primary button labels, section headers |
| Black | 900 | Page titles, big numbers, the brand wordmark |

**Rule:** never use a weight below 400 or between the defined steps (no 300, no 450, no 850). The jump from 600→900 for emphasis (skipping 700–800 for headline-level text) is a deliberate, existing pattern — it produces sharper contrast between "important" and "very important" than a more gradual scale would.

## Letter-spacing

- Body text and headings: default (no tracking adjustment).
- Uppercase micro-labels (eyebrow text, table column headers, badge text): `+0.03em` to `+0.04em` — uppercase text needs slightly opened tracking to stay legible at 10–11px.

## Line-height

- Headings (`h1`–`h3`): tight, 1.2–1.35 — headings should feel compact.
- Body and captions: 1.4–1.5 — body text needs room to breathe, especially at 12–13px.
- Never below 1.2 (headings) or below 1.4 (body) — tighter than that starts clipping descenders and hurting readability, especially for users with low vision.

## Color pairing

Typography color follows the neutral/text scale in `COLORS.md`:
- Primary text: `navy-900` (`#0f172a`)
- Secondary text: `gray-600` (`#475569`)
- Tertiary/metadata text: `gray-400` (`#94a3b8`)
- Never pure black, never a text color below `gray-400` for anything meant to be read (lighter values are reserved for genuinely decorative or disabled contexts, and disabled text has its own explicit token, not "whatever gray looks faded enough").

## Product-specific application

**CareHub:** leans on the smaller end of the scale (`body-sm`/`caption` for table-dense views) because density is a feature, not a compromise (`DESIGN_PRINCIPLES.md`, Principle 4). Headings stay small and frequent (many `h3`-level section labels per screen) rather than one big `h1` per page.

**CareFind:** leans on the larger end (`body-lg`/`h2`/`h3` more prominent) because its content needs to work at arm's length, one-handed, often for an anxious first-time user who needs generous, unambiguous type — not a trained professional scanning a table.

## What this system avoids

- No decorative/script/serif display faces inside the product itself — a hospital administrator's dashboard or a patient's search results should never read as an editorial or luxury brand. The one narrow exception is the display serif defined above, and it is confined to public marketing pages, never the authenticated app.
- No more than one type family within any single surface (the product stays sans-only; a marketing page pairs the display serif with the same sans body/UI face — never two competing families on one screen, and never the monospace exception used for anything but reference codes).
- No text set entirely in italics for emphasis — use weight, not style, for emphasis (italics are reserved for genuinely quoted/notes content, e.g. clinical notes fields, matching existing convention).
- No all-caps body text — all-caps is reserved for `micro`-scale labels only, where the small size and short length keep it legible.
