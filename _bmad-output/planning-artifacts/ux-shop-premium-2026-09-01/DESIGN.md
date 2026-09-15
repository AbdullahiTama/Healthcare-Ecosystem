---
status: final
date: 2026-09-01
type: design
workspace: _bmad-output/planning-artifacts/ux-shop-premium-2026-09-01
project: HealthCare-Ecosystem
feature: Shop — Premium E-commerce (MedMarket Shop tab + CareFind marketplace)
---

# Shop — DESIGN.md
> Visual identity for CareFind MedMarket Shop + CareHub E-commerce ops, extending the ecosystem token system (`packages/design-system/src/theme.js:1`). Spines win on conflict with any mock.
> Sources: `sql/2026-09-01` shop spec (Combined v1.1, 32 sections), `_bmad-output/brainstorming/*`, live `apps/carefind/src/modules/shop/*`, `apps/carehub/src/modules/ecommerce/*`, `packages/design-system/src/theme.js`.

```yaml
colors:
  primary: "#0E6F5A"      # tealDeep — price, ATC, active filter, station accent
  primaryHover: "#0B5A49"  # tealHover
  primaryMist: "#E3EEE8"  # tealMist — selected row, gallery dot track, pill Bg
  ink: "#182722"           # gray900/textDark — headings, product name
  muted: "#8B978F"         # textLight — generic_name, category, metadata
  border: "#ECEAE0"        # gray200 — card, input, divider
  pageBg: "#F7F5EF"        # gray100/bg — page
  cardBg: "#FBFAF6"        # gray50 — card
  warning: "#d97706"       # delivery quote pending, prescription
  danger: "#dc2626"        # out of stock, restricted, error
  success: "#16a34a"       # paid/delivered/in stock
  overlay: "rgba(15,23,42,0.55)"

typography:
  family: '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  display: { size: 25, weight: 900, lineHeight: 1.1, letterSpacing: "-0.02em" } # MedMarket hero
  h1: { size: 21, weight: 900, lineHeight: 1.25 }
  h2: { size: 18, weight: 800, lineHeight: 1.3 }
  h3: { size: 15, weight: 800, lineHeight: 1.35 }
  body: { size: 13, weight: 500, lineHeight: 1.5 }
  caption: { size: 11, weight: 700, lineHeight: 1.4, letterSpacing: "0.02em" }

rounded:
  sm: 6    # pills, badges
  md: 10   # inputs
  lg: 14   # cards
  xl: 20   # modals, sheets
  full: 9999

spacing:
  xs: 6
  sm: 8
  md: 12
  lg: 16
  xl: 20
  section: 24

components:
  card: { bg: "cardBg", border: "1px solid border", radius: "lg", elevation: "0 1px 4px rgba(15,23,42,0.05)" }
  pill: { radius: "full", padding: "2px 8px", fontSize: 11 }
  gallery: { dot: { active: "#fff", idle: "rgba(255,255,255,0.5)" }, counter: "rgba(0,0,0,0.6) #fff" }
  atc: { bg: "primary", color: "#fff", radius: "md", height: 44, hover: "primaryHover" }
```

## Brand & Style
Medical-premium, not bazaar. Photographic products on warm `pageBg` (`#F7F5EF`) with teal as the single accent (`#0E6F5A`). Cards are calm (`cardBg` + `border` + elevation 1), never shadow-heavy. Dense but airy: 2-per-row grid at `minmax 160px` gives Amazon-like scan speed without the noise. Every price is `#0E6F5A 800`; every generic name is italic `muted`. No vendor-as-social-tag anywhere — trust comes from controlled catalog, not social proof.

## Colors
*Inherits* `theme.js` — no new hue. `tealMist` marks selected filters/station rows; `warningBg #fffbeb` marks `delivery_quote_pending`; `dangerBg #fef2f2` marks `Out of stock / Restricted`; `successBg #f0fdf4` marks `paid/delivered`. Gallery counter/dots use `overlay` + `white`.

## Typography
`Geist` everywhere; `Lora` never in shop. Product name `h3 15/800 navy` 2-line clamp; price `h3 15/800 tealDeep`; generic `body 12 italic muted`. Badges `caption 11/700`. ATC `body 14/800 white`. Preserve `textLight` for city/state/phone metadata.

## Layout & Spacing
Mobile ≤480 `paddingBottom calc(90px + safe-area)` for bottom nav. Grid `repeat(auto-fill, minmax(160px,1fr)) gap 12` (catalog) + `flex gap 12 overflowX:auto` (Featured). Detail max `720 centered`. Checkout/Cart max `800`. Spacing scale `12/16/24` between card sections; no `gap > 24` inside a card.

## Elevation & Depth
Elevation 1 on cards, 2 on hovered card, 3 on modal/cart drawer, 0 on pills. No gradient on cards — `tealGradient` only on Admin primary. Gallery arrows `rgba(255,255,255,0.9) + border`.

## Shapes
Cards `lg 14`, inputs `md 10`, ATC `md 10`, pills/dots `full`. Gallery image `cover 320h` top, details `padding 16` below.

## Components
* **Product Card:** thumb `120h cover` (fallback `tealMist + Package 28`), title clamp 2 `minH 32`, generic italic, price `mt auto`, `sale_type` pill `Retail/Wholesale/Distributor`. Featured variant `160w flex 0 0`. Hover `elevation 2`.
* **Gallery:** `320h`, chevrons `36 circle`, dots track `rgba(0,0,0,0.6) 12h`, counter `8,8`.
* **Filters:** pills `6/12 px, radius full, border tealDeep when active else border`, `aria-pressed`.
* **ATC:** `primary → primaryHover` on press `scale 0.98`, disabled `gray200/textLight`, success flash `success`.
* **Station Picker:** native `<select>` `height 44 border 10`, options `name — address, city`.
* **Timeline:** `32 circle` tint `color+20`, line implicit via `gap 12`.

## Do's and Don'ts
* Do show `prescription_required ⚠️` + `warnings` left-border `3px warning` — never hide Rx behind a tab.
* Do keep `fulfilment MAX(600,3%)` label next to its value — transparency is premium.
* Do render `delivery_quote_pending` as `PENDING` amber, not `0` or `FREE`.
* Don't introduce a new accent (no purple/amber on cards); use semantic tints only on status.
* Don't single-column the catalog (violates A5.3 — Amazon 2/row bar).
* Don't expose `vendor as social tag` in Shop (A5) — internal routing only.
