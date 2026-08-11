# CareFind About page — 2026-08-09

## What was built

Public **About page** (`/about`) for the CareFind landing experience, plus navigation wiring.

## Files

| File | Change |
|---|---|
| `apps/carefind/src/modules/marketing/About.jsx` | **New.** Static marketing page mirroring `ForBusiness.jsx` conventions (glass nav, GSAP reveals, theme tokens, inline styles). |
| `apps/carefind/src/main.jsx` | Added public route `<Route path="/about" element={<About />} />`. |
| `apps/carefind/src/modules/marketing/ForBusiness.jsx` | Added "About" link to the landing page nav (desktop) and footer. |

## Page sections (content supplied by the brand team)

1. Hero — "Connecting people to better healthcare" / "A healthcare social platform by HATMA Brandtech Limited", quick facts (2020 origin, 500+ community, 2024 company, one ecosystem).
2. Why CareFind exists — the discovery-gap statement ("finding healthcare should not be difficult").
3. Mission & Vision cards + Our Goal note.
4. What CareFind does — better-informed choices (reviews), social platform, reliable information, empowering professionals, smart business management.
5. Why we believe this matters — the five pillars: Discovery, Information, Experience, Connection, Business.
6. Our Story — 2020 WhatsApp group → 2024 HATMA Brandtech → 2026 CareFind (dark timeline section).
7. The company — HATMA Brandtech team roster (Haruna Abdullahi Tama, John Joseph CTO, Maryam Abdul Aziz, Unaisa Abdullahi, Bolu Zulaikha).
8. Where we are going — closing CTA.
9. Footer — Home / About / For businesses.

## Design & accessibility notes

- Same visual language as `ForBusiness.jsx`: fixed glass nav, full-viewport photo hero with navy gradient overlay, GSAP `ScrollTrigger` reveals, `prefers-reduced-motion` gate (skip all animation when set; this page is the first marketing page to honour it).
- Nav "Mission / Story / Team" links smooth-scroll to anchors; on mobile only Sign in / Get started are shown.
- No data fetching — page is static content, so no loading/error/empty states apply (same as `ForBusiness.jsx`).

## Testing

- `npm test` (apps/carefind): 119/119 pass.
- `npm run build` (apps/carefind): clean; the >500 kB chunk warning is pre-existing (tracked in `planning/CODE_AUDIT.md` → Performance).