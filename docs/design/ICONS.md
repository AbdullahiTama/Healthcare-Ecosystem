# Icons

## The system

**One icon set, used consistently, sourced from a single outline/line-style icon library** (e.g. Lucide/Feather-class libraries — consistent stroke width, consistent corner treatment, comprehensive healthcare/business/data coverage). The current codebase uses emoji as functional icons in many places (module nav, stat cards, buttons) — this is acceptable as a fast-prototyping shortcut but is **not the long-term system**: emoji render inconsistently across platforms/OSes, cannot take a stroke-weight or color token, and read as informal in a professional tool. This document defines the target state; migrating existing emoji usage to the icon set is tracked as implementation work, not a design decision to make screen-by-screen.

**Concrete choice: `react-icons/fi` (Feather).** First adopted in CareHub's `Landing.jsx`/`Sidebar.jsx` template migration. Migrate screen-by-screen, same pattern as the color/typography rollout — a screen either uses Feather icons throughout, or (if not yet migrated) keeps its existing emoji, never a mix of both on one screen. Config-driven emoji shared across many not-yet-migrated screens (e.g. `BUSINESS_TYPES`, per-role nav item icons) stay emoji until that config itself is migrated — swapping it for just one consumer screen would make that screen *less* consistent with the rest of the app, not more.

**The brand mark is one component per product, not a per-screen icon choice.** `Logo` (`apps/carehub/src/components/ui/index.jsx`) renders the one CareHub mark — `Activity` in a flat `teal-600` rounded square, no gradient — and every surface that shows the CareHub brand (marketing nav/footer, dashboard sidebar) renders it via that component, not a locally recreated icon-in-a-box. CareFind's `Logo` (`apps/carefind/src/modules/social-feed/Logo.jsx`) is the sibling: the **same** `Activity` mark in the same flat teal square, with the CareFind wordmark beside it (it previously carried a gradient tile with a "C"). `BRAND_GUIDELINES.md` asks the two products to be instantly distinguishable but unmistakably related — a shared mark plus a distinct wordmark is how that is expressed here, and it means the mark is defined in exactly two places, not redrawn per screen.

## Migration status

**CareHub:** complete — every user-facing screen is on Lucide.

**CareFind: every user-facing screen is migrated.** Feed, Discover/Search, News + News article, Wallet, Saved, Notifications, Login, Public profile, Profile, Onboarding, Verify professional, Business profile, Drug profile, the claim and dashboard screens, Product upload, Playlists, Live show / Live session / Live dashboard / Go live, Professional monetization, and For business — plus every shared component they render (`PostMenu`, `Stories`, `Logo`, `BottomNav`, the `layout/` shell, `components/ui`, `SupportPrompt`, `VoiceRecorder`, `VideoRecorder`, `VideoUploader`, `SlideUploader`, `DrawingBoard`, `ArticleEditor`), and the emoji that had been baked into data/preview strings (`VisualCard`'s template labels, `richText`'s block summaries, the product glyph on search results, the trailing glyphs in `services/notify.js`'s notification copy).

**The deliberate leftovers, and why each one stays:**

| Where | What | Why |
|---|---|---|
| `GiftPanel`, `LiveSession`'s gift list | 💊 ⭐ ❤️ 🏆 👑 … | The glyph **is** the product being sent — user-generated/expressive content (see below). |
| `LiveShow`'s floating reactions | ❤️ 💚 💛 🧡 💜 | Reactions, same rule. |
| `posts.content` repost prefix | 🔁 | A **data convention**, not an icon. Confined to `isRepost`/`withoutRepostMark` in `modules/social-feed/postDisplay.jsx`. |
| Share/repost copy written to posts and WhatsApp | 🔴 LIVE NOW…, 🔁 Reposted… | User-facing **content text** that leaves the app, not product chrome. |
| `BusinessDashboard`'s CSV import template | 💊 in the sample rows | Changing the sample would change the import contract for files sellers already have. The column is no longer rendered anywhere. |
| `AdminPanel`, `AdminLogin` | ~130 glyphs | Internal tooling — explicitly permitted below. Migrate if admin ever becomes a customer-facing surface. |

Nothing else in the app mixes the two systems: no user-facing screen carries both a Lucide icon and a decorative emoji.

## Sizing

| Token | Size | Usage |
|---|---|---|
| `icon-xs` | 14px | Inline with `caption`/`micro` text, dense table rows |
| `icon-sm` | 16px | Inline with `body`/`body-sm` text, form field icons, button icons |
| `icon-md` | 20px | Default standalone icon — nav items, list-row leading icons |
| `icon-lg` | 24px | Section headers, empty-state secondary icons |
| `icon-xl` | 32–48px | Empty-state primary icons, onboarding |

**Rule:** icon size is always chosen relative to the adjacent text size, never in isolation — an icon sitting next to `body-sm` text uses `icon-sm`, not a size picked because it "looked balanced" on its own.

## Stroke weight

A single consistent stroke weight (1.5–2px at the icon's native size) across the entire set. Never mix stroke weights on the same screen, and never mix a filled icon style with an outline icon style except for the one deliberate exception below.

**The one exception — state indication:** an icon may switch from outline to filled specifically to indicate an active/selected/toggled-on state (e.g., a nav item's icon fills when that section is active). This is a meaningful state change, not decoration, and is the only case where filled icons appear in this system.

## Color

Icons follow the same color rules as text (`COLORS.md`, `TYPOGRAPHY.md`):
- Default: `gray-600` (secondary text color) — icons are rarely full-emphasis `navy-900` unless paired with primary-emphasis text.
- Active/selected state: `teal-600`.
- Semantic icons (status indicators): match their semantic color (`success`/`warning`/`danger`).
- On dark surfaces: white or `gray-400` for de-emphasized icons, matching the dark-surface text rules in `COLORS.md`.
- Icons are never colored purely for decoration — an icon's color always communicates something (default, active, semantic state).

## Icon-only buttons and touch targets

An icon used as a standalone interactive control (no visible label) must have a minimum touch/click target of 44×44px (mobile) / 32×32px (desktop with mouse precision), regardless of the icon's own visual size — the icon can be 20px while its clickable area is 44px. This is a hard accessibility requirement, not a preference (`ACCESSIBILITY.md`). Every icon-only button must have an accessible label (`aria-label` or equivalent) describing its action — "Delete," not "Trash icon."

## Where emoji remain acceptable

- **User-generated/social content** (CareFind's social feed, gifts, reactions) — emoji are appropriate here because the content itself is informal, user-authored, and emotionally expressive by design.
- **Internal/admin tooling as a fast, low-stakes shorthand** during early product stages — acceptable technical debt, not acceptable in the target system for user-facing product surfaces.

## What this system avoids

- No icon set mixing (e.g., some screens using Lucide, others using Font Awesome, others using emoji) — pick one system and apply it everywhere.
- No 3D, gradient-filled, or multi-color decorative icon styles — flat, single-color, consistent stroke.
- No icon used without a text label *or* an accessible label — an icon alone, with neither visible text nor an `aria-label`, is a guessing game for every user, sighted or not.
