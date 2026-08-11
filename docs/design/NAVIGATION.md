# Navigation

## CareHub navigation model

### Primary: role-and-business-type-aware sidebar

CareHub already implements the right structural idea (`lib/permissions.js`'s `getNavItems(role, businessType)`, branching between a default retail nav, a hospital-specific nav, and an enterprise/manufacturer nav) — this document formalizes that as the permanent pattern, not a one-off.

**Rule:** navigation is never one-size-fits-all across business types. A pharmacy owner and a hospital administrator are different professionals doing different jobs on the same platform; showing a hospital's Doctor/Lab/Imaging modules to a pharmacy, or vice versa, is not "flexibility," it's noise the user has to visually filter past every single day.

**Structure (desktop):**
```
+--------+------------------------------------------+
| [Logo] |                                           |
+--------+                                           |
| Nav 1  |                                           |
| Nav 2  |              Content                      |
| Nav 3  |                                           |
| ...    |                                           |
+--------+                                           |
| [User] |                                           |
+--------+------------------------------------------+
```
- Fixed 240–260px sidebar, persistent at Desktop/Large Desktop/Laptop.
- Nav items: icon + label, grouped by function where the nav list is long (e.g. Enterprise nav's Orders/Warehouses/Stock cluster vs. Staff/Territories/Messages cluster) with a subtle section label, not a flat undifferentiated list past ~7 items.
- Active state: filled icon (see `ICONS.md`'s one exception) + teal-600 text + a left-edge accent bar or background tint — never color alone (Accessibility rule).
- User/account control anchored at the bottom of the sidebar, always in the same place, containing account switcher, settings, logout.

**Collapse behavior:**
- **Tablet:** icon-only rail (labels hidden, tooltips on hover/long-press) or an off-canvas drawer triggered by a hamburger — pattern chosen per-screen based on whether the content area needs the reclaimed width (dense tables: rail; simpler screens: drawer is fine).
- **Mobile:** off-canvas drawer only, never a persistent rail (no width to spare).

### Secondary: contextual toolbar / sub-navigation

Within a module (e.g., inside "Inventory"), a secondary horizontal tab or toolbar row provides sub-navigation (e.g. Products / Stock Batches / Purchases). This lives at the top of the content area, not nested inside the primary sidebar — the primary sidebar should never grow a third level of nesting; if a module needs that much sub-structure, it's a sign the module should be reconsidered as multiple top-level nav items instead.

### Command palette / global search

Per the Linear-derived principle in `DESIGN_PRINCIPLES.md`: a global, keyboard-triggered (`⌘K`/`Ctrl+K`) command palette is the target pattern for CareHub's power-user navigation — jump to any module, search for a patient/product/order by name, trigger common actions — without requiring a mouse. This supplements, never replaces, the visible sidebar (discoverability for new users still matters).

### Keyboard shortcuts

A documented, consistent shortcut set (not per-screen ad hoc bindings): global shortcuts (command palette, search focus) work everywhere; screen-specific shortcuts (e.g., "N" for new record in a list view) are shown via a `?` help overlay, never hidden knowledge. Shortcuts accelerate; they are never the *only* path to an action (`ACCESSIBILITY.md`).

## CareFind navigation model

### Primary: bottom tab bar (mobile/tablet)

```
+------------------------------------------+
|                                           |
|              Content                     |
|                                           |
+------------------------------------------+
| Home | Search | Live | Notifs | Profile  |
+------------------------------------------+
```
- 4–5 top-level destinations maximum — Feed/Discovery, Search, a distinctive engagement surface (Live), Notifications, Profile — matching what's already structurally present (`BottomNav.jsx`).
- Always visible, always in the same position — a first-time, anxious user should never have to think about "how do I get back."
- Active tab: filled icon + teal-600 label, same active-state logic as CareHub's sidebar for cross-product consistency.
- Badge (unread count) on Notifications, using the same badge/pill treatment as CareHub (`COMPONENT_LIBRARY.md`).

### Desktop expansion

At Laptop+ widths, the bottom tab bar's destinations move to a top header bar (logo left, primary nav center or right, account/notifications far right) — CareFind desktop is a horizontal-nav web pattern, not a stretched mobile app, consistent with `RESPONSIVENESS.md`'s "expansion, not a different product" rule.

### Search as a first-class navigation surface

CareFind's core job is discovery — search is not buried in a tab, it's one tap from anywhere (a persistent search entry point on the Home/Feed screen, not only reachable via the Search tab). See `SCREEN_PATTERNS.md` → Global Search.

## Breadcrumbs

Used in CareHub for deep hierarchical contexts only (e.g., Enterprise's Warehouses → a specific warehouse → its stock) — not applied universally, since most CareHub screens are one level deep from the sidebar and a breadcrumb there would be redundant chrome. Never used in CareFind — its navigation depth is intentionally shallow (search → results → detail, three levels, always with a clear back action rather than a breadcrumb trail).

## Back navigation

- **CareHub:** relies on the sidebar remaining visible/persistent rather than a dedicated back button in most cases; detail views that push over a list (see `LAYOUTS.md`) get an explicit close/back control in the same position every time (top-left of the pushed panel).
- **CareFind:** every pushed screen (detail views, checkout-style flows) has an explicit, consistently-positioned back control (top-left) — mobile users rely on it more than OS-level back gestures, which aren't universally available (web app context).
