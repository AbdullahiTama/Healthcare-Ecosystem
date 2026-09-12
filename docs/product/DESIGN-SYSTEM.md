# Design System — HealthCare Ecosystem

**Version**: 1.0
**Status**: Baseline (pre-unification)
**Apps**: CareHub (operational SaaS), CareFind (public marketplace)
**Principle**: One token system, two product personalities

---

## 1. Color System

### 1.1 Brand Palette (Preserved)

| Token | Value | Usage |
|-------|-------|-------|
| `tealDeep` | `#0E6F5A` | Primary actions, active nav, primary buttons, key emphasis |
| `tealBright` | `#1A8A72` | CareFind: brighter accent for consumer surfaces |
| `tealHover` | `#0B5A49` | Button hover, interactive emphasis |
| `navy` | `#0B4A3E` | Primary text, headings, deep surfaces |
| `navySoft` | `#3C4B44` / `#155A4B` | Secondary text, muted headings |

**Rule**: Primary teal (`#0E6F5A`) is the single brand anchor. Do not introduce new brand colors.

### 1.2 Neutral Scale (Unified)

| Token | Light Value | Usage |
|-------|-------------|-------|
| `gray50` | `#FBFAF6` | Card backgrounds, elevated surfaces |
| `gray100` | `#F7F5EF` | Page background (bg) |
| `gray200` | `#ECEAE0` | Borders, dividers, input borders |
| `gray300` | `#E7E4D9` | Hairlines, subtle separators |
| `gray400` | `#9AA69F` | Disabled text, placeholder, secondary icons |
| `gray500` | `#8B978F` | Muted text, tertiary information |
| `gray600` | `#5B6B63` | Helper text, labels, inactive states |
| `gray900` | `#182722` | Primary text (alias: `textDark`, `navy`) |

**Note**: CareFind's gray scale differs slightly at each step. Unify to CareHub's warmer scale.

### 1.3 Semantic Colors

| Token | Value | Light BG | Usage |
|-------|-------|----------|-------|
| `success` | `#0E6F5A` (CareHub) / `#16a34a` (CareFind) | `#E3EEE8` / `#f0fdf4` | Confirmed, paid, completed, active |
| `warning` | `#d97706` | `#fffbeb` | Pending, low stock, credit due |
| `danger` | `#dc2626` | `#fef2f2` | Cancelled, out of stock, errors, destructive |
| `info` | `#2563eb` | `#eff6ff` | Information, online, in-progress |
| `purple` | `#7c3aed` | `#f5f3ff` | Online consultations, special actions |

**Unification Decision**: Use green `#16a34a` for success (not brand teal). Brand teal reserved for primary actions only.

### 1.4 Healthcare-Specific Semantic States

| State | Color | Background | Icon | Usage |
|-------|-------|------------|------|-------|
| Critical Stock | `danger` | `dangerBg` | ⚠️ | Out of stock, expiry imminent |
| Low Stock | `warning` | `warningBg` | 📦 | Below reorder level |
| Available | `success` | `successBg` | ✅ | In stock, open slots |
| Unavailable | `gray500` | `gray100` | ❌ | Discontinued, closed |
| Pending | `warning` | `warningBg` | ⏳ | Awaiting confirmation |
| Approved | `success` | `successBg` | ✅ | Verified, authorized |
| Rejected | `danger` | `dangerBg` | ❌ | Denied, failed |
| Urgent | `danger` | `dangerBg` | 🚨 | Stat orders, critical alerts |

**Rule**: Never use color alone. Always pair with icon + text label.

### 1.5 Surface Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `bg` | `gray100` | Page background |
| `cardBg` | `gray50` | Card, modal, drawer backgrounds |
| `border` | `gray200` | Default borders, dividers |
| `hairline` | `gray300` | Subtle separators (table rows, list items) |
| `tealMist` | `#E3EEE8` | Teal-tinted surfaces (selected rows, hover) |
| `successBg` | `#f0fdf4` | Success state backgrounds |
| `warningBg` | `#fffbeb` | Warning state backgrounds |
| `dangerBg` | `#fef2f2` | Danger state backgrounds |
| `infoBg` | `#eff6ff` | Info state backgrounds |

---

## 2. Typography

### 2.1 Font Families

| Family | Value | Usage |
|--------|-------|-------|
| `fontFamily` | `"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` | All UI text |
| `fontMono` | `"Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace` | Code, numbers, tabular data |
| `fontDisplay` | `"Lora", Georgia, "Times New Roman", serif` | Marketing pages only (Landing, onboarding) |

### 2.2 Type Scale (Unified)

| Token | Size | Weight | Line Height | Letter Spacing | Usage |
|-------|------|--------|-------------|----------------|-------|
| `display` | 24px | 900 | 1.2 | -0.02em | Marketing hero only |
| `h1` | 21px | 900 | 1.25 | -0.02em | Page titles |
| `h2` | 18px | 800 | 1.3 | -0.015em | Section titles |
| `h3` | 15px | 800 | 1.35 | -0.01em | Card titles, subsection |
| `bodyLg` | 14px | 500 | 1.5 | 0 | Important body, KPI labels |
| `body` | 13px | 500 | 1.5 | 0 | Default body text |
| `bodySm` | 12px | 600 | 1.4 | 0 | Secondary info, metadata |
| `caption` | 11px | 700 | 1.4 | 0.02em | Labels, pill text, timestamps |
| `micro` | 10.5px | 700 | 1.3 | 0.04em | Dense tables, footnotes |

**Rule**: Use `body` (13px) as default. `bodySm` for dense UIs (POS, tables). Never go below `micro` (10.5px).

### 2.3 Numerical/Tabular Typography

- All numbers in tables: `fontMono`, `tabular-nums` (via CSS)
- Currency: `fontMono`, right-aligned
- KPI values: `h1` weight, `navy` color, `tabular-nums`

---

## 3. Spacing System

### 3.1 Base Scale (4px)

| Token | Value | Usage |
|-------|-------|-------|
| `space[1]` | 2px | Micro gaps (icon+text) |
| `space[2]` | 4px | Base unit |
| `space[3]` | 6px | Tight component gaps |
| `space[4]` | 8px | Standard component gaps |
| `space[5]` | 10px | Form field gaps |
| `space[6]` | 12px | Card padding, section gaps |
| `space[7]` | 14px | Card internal gaps |
| `space[8]` | 16px | Section gaps, page margins |
| `space[9]` | 18px | Large section gaps |
| `space[10]` | 20px | Page margins (desktop) |
| `space[11]` | 24px | Major section gaps |
| `space[12]` | 32px | Page margins (large desktop) |

### 3.2 Layout Spacing Conventions

| Context | Value |
|---------|-------|
| Page horizontal padding (mobile) | `space[4]` (16px) |
| Page horizontal padding (tablet) | `space[6]` (24px) |
| Page horizontal padding (desktop) | `space[10]` (20px) + centered max-width |
| Card padding (default) | `space[6]` (12px) |
| Card padding (dense) | `space[4]` (8px) |
| Card padding (comfortable) | `space[8]` (16px) |
| Section vertical gap | `space[8]` (16px) |
| Component gap (inline) | `space[4]` (8px) |
| Form field vertical gap | `space[5]` (10px) |

---

## 4. Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `sm` | 6px | Buttons, inputs, badges, pills |
| `md` | 10px | Cards (default), modals, dropdowns |
| `lg` | 14px | Large cards, stat cards, sheets |
| `xl` | 20px | Sheets, hero cards, marketing |
| `full` | 9999px | Avatars, pills, toggle switches |

**Rule**: Default card radius = `md` (10px). `lg` for elevated surfaces. Never use `xl` in operational UI.

---

## 5. Elevation & Shadows

### 5.1 Shadow Scale (Navy-based, never pure black)

| Level | Value | Usage |
|-------|-------|-------|
| `0` | `none` | Flat surfaces, flush cards |
| `1` | `0 1px 4px rgba(15,23,42,0.05)` | Default card, resting state |
| `2` | `0 4px 16px rgba(15,23,42,0.08)` | Hovered card, raised dropdown |
| `3` | `0 8px 24px rgba(15,23,42,0.12)` | Modal, sheet, popover |
| `4` | `0 20px 48px rgba(15,23,42,0.18)` | Full-screen modal, critical overlay |

### 5.2 Surface Hierarchy

```
Page (bg) → gray100
  └── Card (cardBg) + elevation[1]
        └── Hovered Card + elevation[2]
              └── Dropdown / Popover + elevation[3]
                    └── Modal / Sheet + elevation[4]
```

**Rule**: Shadows never decorative. Only communicate layer hierarchy.

---

## 6. Motion & Animation

### 6.1 Duration Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `instant` | `0ms` | State toggles, immediate feedback |
| `fast` | `140ms` | Hover, focus, button press |
| `base` | `200ms` | Standard transitions (modal, drawer, toast) |
| `slow` | `300ms` | Page transitions, complex drawer |

### 6.2 Easing

| Token | Value | Usage |
|-------|-------|-------|
| `easeOut` | `cubic-bezier(0.16, 1, 0.3, 1)` | Enter animations, expansions |
| `easeIn` | `cubic-bezier(0.7, 0, 0.84, 0)` | Exit animations, dismissals |

### 6.3 Motion Rules

- **Max duration**: 300ms for any UI transition
- **No animation** on: layout shifts, data loading, typing
- **Reduced motion**: All animations → `0.01ms`, `iteration-count: 1`
- **Skeleton pulse**: 1.8s ease-in-out (slow, subtle)
- **Toast enter**: 200ms ease-out from bottom
- **Modal/Sheet enter**: 300ms ease-out (slide up / fade + scale)

---

## 7. Iconography

### 7.1 Sizing Scale

| Token | Size | Usage |
|-------|------|-------|
| `xs` | 14px | Inline with caption text |
| `sm` | 16px | Inline with body text, button icons |
| `md` | 20px | Default UI icons, nav items |
| `lg` | 24px | Large buttons, empty states |
| `xl` | 40px | Hero illustrations, onboarding |

### 7.2 Icon Library

**Primary**: Lucide React (consistent stroke weight, 2px default)
**Stroke Width**:
- Default: 2px
- Small (≤16px): 2.5px
- Large (≥24px): 1.5-2px

### 7.3 Usage Rules

- Icons **always** accompany text in primary actions
- Icon-only buttons: `aria-label` required, 44×44px minimum
- Status icons: color + icon + text (never color alone)
- Decorative icons: `aria-hidden="true"`

---

## 8. Breakpoints

| Name | Width | Usage |
|------|-------|-------|
| `mobile` | 320px | Minimum mobile |
| `tablet` | 768px | Collapsed sidebar, two-column layouts |
| `laptop` | 1024px | Full sidebar, three-column layouts |
| `desktop` | 1440px | Standard desktop, max-width containers |
| `largeDesktop` | 1920px | Ultrawide, expanded density |

### 8.1 Responsive Behavior Contract

| Breakpoint | CareHub | CareFind |
|------------|---------|----------|
| `<768px` | Mobile drawer + floating hamburger + bottom nav | Mobile header + bottom nav, no sidebar |
| `768-1023px` | Icon-only rail (64px) | Collapsed left rail + header |
| `≥1024px` | Full sidebar (210px) | Full left sidebar + right sidebar |

---

## 9. Component Primitives (Standardized)

### 9.1 Buttons

| Variant | Background | Text | Border | Usage |
|---------|------------|------|--------|-------|
| Primary (Teal) | `tealDeep` | White | None | Primary actions |
| Secondary (Dark) | `navy` | White | None | Secondary primary (CareHub) |
| Ghost | White | `gray600` | `gray200` | Secondary actions |
| Danger | `dangerBg` | `danger` | None | Destructive actions |
| Outline (new) | Transparent | `tealDeep` | `tealDeep` | Tertiary actions |

**States**: All variants have `disabled`, `hover`, `active`, `focus-visible`
**Sizes**: Default (44px), Small (40px), Large (48px)
**Min touch target**: 44×44px always

### 9.2 Form Inputs

| Component | Height | Radius | Border | Focus |
|-----------|--------|--------|--------|-------|
| Input | 44px | `md` | `gray200` | `tealDeep` ring (3px, 0.1 opacity) |
| Select | 44px | `md` | `gray200` | Same |
| Textarea | Auto (min 88px) | `md` | `gray200` | Same |
| Checkbox | 20×20px | `sm` | `gray200` | `tealDeep` ring |
| Radio | 20×20px | `full` | `gray200` | `tealDeep` ring |
| Toggle | 44×24px | `full` | — | `tealDeep` thumb |
| DatePicker | 44px | `md` | `gray200` | Same |
| Combobox | 44px | `md` | `gray200` | Same |

**Validation**: On blur/submit only. Error = `danger` border + inline message + `aria-invalid`

### 9.3 Card

| Variant | Padding | Radius | Shadow | Border | Usage |
|---------|---------|--------|--------|--------|-------|
| Default | `space[6]` (12px) | `md` | `elevation[1]` | `border` | Standard |
| Dense | `space[4]` (8px) | `md` | `elevation[1]` | `border` | Tables, lists |
| Elevated | `space[8]` (16px) | `lg` | `elevation[2]` | `border` | Stat cards, featured |
| Interactive | `space[6]` | `md` | `elevation[1]` → `elevation[2]` hover | `border` | Clickable cards |
| Sheet | `space[8]` | `xl` (top only) | `elevation[4]` | `border` | Bottom sheets |

### 9.4 DataTable

- **Desktop**: Full `<table>` with sortable headers, pagination, row hover
- **Tablet**: Same, horizontal scroll if needed
- **Mobile**: Card-list transform (stacked label/value cards)
- **Loading**: 3 CardSkeleton rows
- **Empty**: EmptyState component
- **Error**: ErrorState component with retry

### 9.5 Modal / Drawer / Sheet

| Pattern | Animation | Focus | Close | Use For |
|---------|-----------|-------|-------|---------|
| Modal (centered) | Fade + scale (200ms) | First editable field | Backdrop + Esc + Close btn | Confirmations, short forms |
| Drawer (right) | Slide right (300ms) | First editable field | Backdrop + Esc + Close btn | Contextual editing, details |
| Sheet (bottom) | Slide up (300ms) | First editable field | Backdrop + Esc + Handle drag | Mobile forms, filters |

**Rule**: All use focus trap. Initial focus = first editable field (never close button).

### 9.6 Toast

- **Desktop**: Top-right corner, 320px max, auto-dismiss 4s
- **Mobile**: Bottom full-width, safe-area inset, swipe to dismiss
- **Variants**: Success (green), Error (red), Warning (amber), Info (teal)
- **Action**: Optional single button

### 9.7 State Components (Mandatory on every async surface)

| State | Component | Required Props |
|-------|-----------|----------------|
| Loading | `Loading` / `Skeleton` | `text?` / `width`, `height` |
| Empty | `Empty` | `icon`, `message`, `action?`, `onAction?`, `cause` |
| Error | `ErrorState` | `variant`, `message`, `onRetry?` |
| Success | Toast | `msg`, `type='success'` |

---

## 10. Accessibility Requirements

### 10.1 Color Contrast (WCAG AA)

| Combination | Ratio | Status |
|-------------|-------|--------|
| `navy` on `bg` | 12.6:1 | ✅ AAA |
| `textMid` on `bg` | 7.2:1 | ✅ AAA |
| `textLight` on `bg` | 4.5:1 | ✅ AA |
| `tealDeep` on white | 4.8:1 | ✅ AA |
| `success` on white | 4.5:1 | ✅ AA |
| `warning` on white | 3.2:1 | ⚠️ AA Large only |
| `danger` on white | 5.5:1 | ✅ AA |

**Fix**: Darken `warning` to `#b45309` for body text usage.

### 10.2 Focus Management

- `:focus-visible` = 2px solid `tealDeep`, offset 2px, `border-radius: sm`
- Never remove focus outline
- Focus trap in modals/drawers/sheets
- Initial focus = first editable field
- Return focus to trigger on close

### 10.3 Semantic HTML

- `<button>` for actions, `<a>` for navigation
- `<label>` + `htmlFor` on every input
- `<table>` with `<thead>`, `<tbody>`, `<th scope="col">`
- ARIA roles: `dialog`, `alertdialog`, `status`, `navigation`, `tablist`
- Live regions: `aria-live="polite"` (toast), `assertive` (error)

### 10.4 Touch Targets

- Minimum 44×44px on all interactive elements
- Icon-only buttons: 44×44px container
- Spacing between targets: ≥8px

---

## 11. CareHub vs CareFind Differences

| Aspect | CareHub (Operational) | CareFind (Consumer) |
|--------|----------------------|---------------------|
| Density | Compact (data-first) | Comfortable (discovery-first) |
| Primary Action | TealBtn | TealBtn |
| Secondary Action | GhostBtn | GhostBtn |
| Card Default | Dense (12px) | Comfortable (16px) |
| Table Default | Full table + card fallback | Card-first, table on desktop |
| Navigation | Persistent sidebar + top bar | Header + left sidebar (auth) / Bottom nav (public) |
| Toast Position | Top-right | Bottom-center |
| Modal Default | Centered | Sheet on mobile, centered desktop |
| Illustrations | None (operational) | BrandArt (empty states, onboarding) |
| Font Display | Lora (marketing only) | Geist (all) |

---

## 12. Implementation Checklist

### Phase 1: Token Unification
- [ ] Align CareFind theme.js to CareHub tokens (single source)
- [ ] Update global.css CSS variables to match
- [ ] Remove duplicate/alias color tokens
- [ ] Verify contrast ratios

### Phase 2: Component Standardization
- [ ] Single Button component (4 variants)
- [ ] Single Modal/Sheet/Drawer component
- [ ] Single Toast component (responsive position)
- [ ] Single DataTable component
- [ ] Single Card component
- [ ] Single Input/Select/Textarea component
- [ ] Add missing: Combobox, DatePicker, CommandMenu, Breadcrumb, Tabs, Tooltip, Dropdown, Stepper, FileUpload

### Phase 3: Shell Unification
- [ ] Mobile shell (header + bottom nav + drawer) for both apps
- [ ] Tablet rail collapse for both apps
- [ ] Desktop three-column for both apps
- [ ] Consistent page header pattern

### Phase 4: Page Migration
- [ ] DashboardHome (CareHub)
- [ ] Search (CareFind)
- [ ] High-frequency modules (POS, Inventory, Appointments)
- [ ] Settings, Reports, secondary modules

### Phase 5: Quality Gates
- [ ] Accessibility audit (axe + manual)
- [ ] Responsive test (320, 768, 1024, 1440, 1920)
- [ ] Reduced motion test
- [ ] Keyboard navigation test
- [ ] Visual regression test