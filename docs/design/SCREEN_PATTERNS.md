# Screen Patterns

**This is the most important document in the system.** No new screen, component, or workflow should be designed or built without first selecting the closest matching pattern here. If nothing fits, that's a signal to extend this document deliberately — not to freelance a one-off.

Every pattern is specified across the same 14 dimensions: Purpose, Users, When to use, When NOT to use, Layout, Information hierarchy, Components used, User workflow, UX rules, Accessibility requirements, Responsive behavior, Common mistakes, Design rules, Reusable patterns. Foundational rules (spacing, color, motion, accessibility baseline) are defined once in their own documents and referenced here, not restated in full each time.

---

## 1. Login

**Purpose:** Authenticate a returning user with minimum friction and maximum trust signal.

**Users:** CareHub — business owners, staff. CareFind — patients, providers.

**When to use:** The entry point for any authenticated session, for both products.

**When NOT to use:** Never gate genuinely public content behind login (CareFind's search/browse/provider-profile viewing is public by design — see `DESIGN_VISION.md`; login is required only to act, e.g. book, review, claim).

**Layout:**
```
CareHub (desktop)                    CareFind (mobile)
+------------------------+           +------------------+
|  [Logo]                |           |     [Logo]       |
|                        |           |                  |
|  Centered card:        |           |  Email/Phone      |
|  Email                 |           |  [___________]    |
|  [___________]         |           |  Password          |
|  Password               |          |  [___________]    |
|  [___________]         |           |                    |
|  [ ] Remember me       |           |  [   Log In    ]   |
|  [    Log In    ]      |           |  Forgot password?  |
|  Forgot password?      |           |  ------------------ |
|                        |           |  New here? Sign up  |
+------------------------+           +------------------+
```
**Why it works:** a single, centered, unambiguous task — no navigation, no distraction. CareHub's version may include a subtle business-context visual (not decorative marketing content); CareFind's is even more minimal, since it's often reached mid-task (e.g., "log in to book").

**Information hierarchy:** Logo/brand (orientation) → form fields (the task) → primary action (Log In) → secondary paths (forgot password, sign up), in that visual order, top to bottom.

**Components used:** Text input ×2, Button (primary), Checkbox (Remember me — CareHub only), inline link (Forgot password), inline error banner.

**User workflow:** Enter credentials → submit → (success: redirect to last-intended destination, not always the dashboard — see UX rules) → (failure: specific inline error, credentials preserved except password).

**UX rules:**
- Redirect to wherever the user was trying to go before being asked to log in, not always to the default dashboard/home.
- Never say "email not found" vs. "wrong password" as distinct errors (user-enumeration risk) — a single "Incorrect email or password" message for both.
- Password field has a visibility toggle (show/hide) — this is a usability requirement, not optional, especially on mobile where mistyped passwords are common.

**Accessibility requirements:** Form fields have real labels, error is announced via `aria-live`, Enter key submits from any field, focus starts on the first empty field on load.

**Responsive behavior:** Desktop: centered card, ~400px wide, generous surrounding whitespace. Mobile: full-width form with page-level padding, no card chrome (the whole screen *is* the card at this width).

**Common mistakes:** A giant background hero image competing with the form for attention; asking for more than email+password (defer MFA to its own step, see pattern 4); auto-focusing the password field before email is filled.

**Design rules:** One primary button. No secondary "or continue as guest" competing visually with the primary action.

**Reusable patterns:** Uses the base Form pattern (data entry rules in `UX_PATTERNS.md`); the centered-card shape reappears in Forgot Password, Reset Password, and MFA.

---

## 2. Forgot Password

**Purpose:** Let a locked-out user regain access without support intervention.

**Users:** Same as Login.

**When to use:** Reached only via the Login screen's "Forgot password?" link.

**When NOT to use:** Never as a first-run screen; never skip straight to a password-reset form without the identity-verification step.

**Layout:** Same centered-card shape as Login, single field (email or phone), single action.
```
+------------------------+
|  [Logo]                |
|  Reset your password    |
|  Enter the email on     |
|  your account.          |
|  [___________]         |
|  [  Send Reset Link  ]  |
|  ← Back to Login        |
+------------------------+
```

**Information hierarchy:** A one-sentence explanation of what happens next, above the field — users in this flow are often anxious/frustrated; clarity reduces support burden.

**Components used:** Text input ×1, Button (primary), back-link.

**User workflow:** Enter email → submit → confirmation screen ("If that email exists, we've sent a link") shown regardless of whether the email matches an account (prevents user enumeration).

**UX rules:** Always show the same "check your email" confirmation regardless of match result — this is a security requirement, not a UX nicety. Never reveal whether an email exists in the system.

**Accessibility requirements:** Confirmation message is announced (`aria-live`), not just visually swapped in.

**Responsive behavior:** Identical shape to Login at every breakpoint — no additional responsive complexity, since it's a single field.

**Common mistakes:** Confirming or denying account existence via different messaging (security leak); requiring the reset link to be opened on the same device (breaks the common case of requesting on desktop, checking email on phone).

**Design rules:** Same visual weight and restraint as Login — this is not a place for reassurance copy to become long-winded.

**Reusable patterns:** Centered-card shape (see Login). Feeds into Reset Password.

---

## 3. Reset Password

**Purpose:** Let a user set a new password after verifying identity via the emailed link.

**Users:** Same as Login, arriving via a tokenized link.

**When to use:** Only reachable via a valid, unexpired reset token.

**When NOT to use:** Never accessible without a token (a bare "/reset-password" route with no token should show an error state, not a form).

**Layout:** Centered card, two fields (new password, confirm password), strength indicator.
```
+------------------------+
|  [Logo]                |
|  Set a new password     |
|  New password           |
|  [___________]         |
|  [Strength: ▓▓▓░░]      |
|  Confirm password        |
|  [___________]         |
|  [   Save Password   ]  |
+------------------------+
```

**Information hierarchy:** Password requirements shown proactively (min length, etc.) before the user gets an error, not only after a failed attempt.

**Components used:** Text input ×2 (with visibility toggle), password-strength indicator, Button (primary).

**User workflow:** Set new password → confirm matches → submit → success → auto-redirect to Login (pre-filled email, if safely available) or directly into the app if the reset itself establishes a session.

**UX rules:** An expired/invalid token shows a clear error with a path back to Forgot Password, never a silent failure or a confusing generic form.

**Accessibility requirements:** Password strength communicated with text, not color alone (`ACCESSIBILITY.md`).

**Responsive behavior:** Same centered-card shape at all breakpoints.

**Common mistakes:** Silently failing on an expired token instead of explaining why; not confirming the password was actually changed with clear success feedback.

**Design rules:** Same as Login/Forgot Password — restraint, one action.

**Reusable patterns:** Centered-card shape; password-strength indicator is reusable in Create Account / Change Password (Settings).

---

## 4. Multi-Factor Authentication

**Purpose:** A second verification step for higher-security contexts (CareHub admin/owner accounts especially).

**Users:** CareHub business owners/admins primarily; optional for CareFind.

**When to use:** After primary credential verification succeeds, before session is granted, for accounts/roles where it's enabled.

**When NOT to use:** Never for every login on every account by default in early-stage rollout (friction cost must be justified by the account's actual risk profile) — see `Security-Risks.md` in the broader engineering docs for which accounts warrant this.

**Layout:**
```
+------------------------+
|  [Logo]                |
|  Enter the 6-digit code |
|  sent to ***-**89       |
|  [_] [_] [_] [_] [_] [_]|
|  [    Verify    ]       |
|  Resend code (0:45)     |
+------------------------+
```

**Information hierarchy:** Masked destination (phone/email) shown for reassurance the code went somewhere real, code input as the sole focus.

**Components used:** Six single-digit inputs (auto-advancing focus) or one 6-digit field, Button (primary), countdown-gated resend link.

**User workflow:** Code arrives → auto-focus first digit → auto-advance between digits → auto-submit on 6th digit entered (don't require an extra tap) → verify.

**UX rules:** Resend is rate-limited and shows a visible countdown, not a bare disabled link with no explanation of when it re-enables.

**Accessibility requirements:** Digit inputs are operable via paste (a user pasting a full code from their SMS app should populate all fields, not fail) and via keyboard tab order.

**Responsive behavior:** Identical centered-card shape at all breakpoints; digit-input sizing stays touch-friendly (44px min) on mobile.

**Common mistakes:** Requiring a manual "Submit" click after a complete, valid code is entered (adds a needless step); not supporting paste-from-clipboard for the code.

**Design rules:** Fastest possible path once the code is known — this step should feel like it takes two seconds, not thirty.

**Reusable patterns:** Segmented-digit input reusable anywhere else a numeric code is entered.

---

## 5. Dashboard

**Purpose:** Answer "how am I doing, and what do I need to do next" in the first five seconds a user looks at the screen.

**Users:** CareHub — business owner/manager landing screen. CareFind — the Feed serves a related-but-distinct discovery role (see Layouts `LAYOUTS.md` — Feed pattern, not this one).

**When to use:** The default landing screen after login for CareHub roles with a genuine overview need (owner, manager). Role-specific dashboards for narrower roles (a cashier's dashboard is much smaller than an owner's).

**When NOT to use:** Never for a role whose job is a single repeated task (e.g., a pure POS cashier role might skip straight to the POS screen — a dashboard they never act on is wasted screen real estate and a wasted click every shift).

**Layout:** See `LAYOUTS.md` → Dashboard Grid.
```
+--------+------------------------------------------+
| Side   | Good morning, [Name]                      |
| bar    +--------------------------------------------+
|        | [Sales] [Stock] [Patients] [Revenue]       |
|        +--------------------------------------------+
|        | Needs Attention (pending approvals, low     |
|        | stock, urgent notifications)                |
|        +--------------------------------------------+
|        | Recent Activity                             |
+--------+--------------------------------------------+
```

**Information hierarchy:** Stat cards (state, glanceable) → "Needs Attention" (action-oriented, the actual reason to visit today) → Recent Activity (context, lowest priority). "Needs Attention" outranks Recent Activity because it's actionable — a generic activity log a user has to interpret themselves is a lower-value use of prime screen space than a system that's already done the interpretation for them.

**Components used:** Stat Card, list/card panels, Badge (pending counts), Empty State (when nothing needs attention — a genuinely positive empty state, not treated as a missing-data problem).

**User workflow:** Land → scan stat cards → check Needs Attention → act on the top item or move to a specific module via sidebar.

**UX rules:** Stat cards are never purely decorative vanity numbers — each one should be clickable, taking the user to the filtered view that explains the number (e.g., clicking "3 low stock" goes to Inventory filtered to low-stock items).

**Accessibility requirements:** Stat cards are real interactive elements (button/link semantics) if clickable, not divs with a click handler and no keyboard path.

**Responsive behavior:** Desktop: full 4+ column stat grid, two-panel layout below. Tablet: stat grid reflows via `auto-fit`, panels stack. Mobile: 2-column stat grid (`COMPONENT_LIBRARY.md`), single-column stacked panels, "Needs Attention" panel promoted above the fold, Recent Activity may collapse behind a "View all" link rather than showing inline.

**Common mistakes:** The generic-dashboard Anti-Pattern — a wall of undifferentiated widgets with no priority order; stat cards with no drill-down action; charts included because "dashboards have charts" rather than because a specific question needs answering.

**Design rules:** Every element on this screen earns its place by answering "how am I doing" or "what's next" — nothing is here purely for visual balance.

**Reusable patterns:** Stat Card, Needs Attention panel shape reused across module-level dashboards (Reception, Inventory overview, etc.).

---

## 6. List/Table Page

**Purpose:** Browse, search, filter, and act on a collection of records.

**Users:** Nearly every CareHub role, for nearly every entity (products, patients, staff, orders, sales).

**When to use:** The default pattern for viewing any collection of ≥1 record type.

**When NOT to use:** Collections of a small, fixed, rarely-changing set (e.g., a 3-item settings toggle list) don't need the full table apparatus — a simple list suffices.

**Layout:** See `LAYOUTS.md` → Sidebar + Single Content Panel.
```
+--------+------------------------------------------+
| Side   | Products                    [+ Add New]   |
| bar    +--------------------------------------------+
|        | [Search......] [Filters ▾] [Columns ▾]    |
|        +--------------------------------------------+
|        | Name      | Stock | Price | Status |  ⋯    |
|        | -------------------------------------------|
|        | Product A |  120  | ₦500  | Active |  ⋯    |
|        | Product B |   4   | ₦1200 | Low    |  ⋯    |
+--------+------------------------------------------+
```

**Information hierarchy:** Page title + primary action (top) → search/filter toolbar → table, with the most identifying column (name) leftmost and status/actions rightmost, matching left-to-right reading order from "what is this" to "what can I do about it."

**Components used:** Table, Search input, Filter control, Pagination, Badge (status column), row-hover action menu.

**User workflow:** Land on full/default-sorted list → search or filter to narrow → scan → act on a row (view detail, inline quick-action, or bulk-select).

**UX rules:** See `UX_PATTERNS.md` → Sorting, Filtering, Bulk Actions in full. Table always shows a result count ("142 products, 3 filtered").

**Accessibility requirements:** Real `<table>` markup, sortable column headers are real buttons with `aria-sort` state, row actions have accessible labels.

**Responsive behavior:** See `COMPONENT_LIBRARY.md` → Tables in full — desktop full table → laptop column-hiding → tablet further reduction + overflow menu → **mobile: transforms to a stacked card list**, not a shrunk table.

**Common mistakes:** A table with more columns than any single user needs, shown to everyone regardless of role; no empty state designed for "no results match your filter" vs. "no records exist yet" (these need different messaging — see Empty State pattern); horizontal scroll as the *primary* mobile strategy instead of the card-list transformation.

**Design rules:** One primary action (top-right, "+ Add New" or equivalent) — bulk/row actions are secondary and never compete visually with it.

**Reusable patterns:** This is the base pattern for Inventory, Pharmacy queues, Laboratory queues, Billing lists, and most of Reports — those patterns extend this one with domain-specific columns and actions rather than reinventing the shape.

---

## 7. Detail View

**Purpose:** Show the complete picture of a single record and the actions available on it.

**Users:** Any role that needs to inspect or act on one specific record after finding it via a List/Table Page or Search.

**When to use:** Reached by selecting a row/card from a list, or directly via a permalink.

**When NOT to use:** Don't build a full detail view for a record type simple enough that a Modal (pattern 27) showing the same info is sufficient — a detail view is justified when the record has enough depth (multiple sections, related sub-records, a real action set) to warrant a dedicated screen.

**Layout:**
```
+------------------------------------------------------+
| ← Back    Product A                    [Edit] [⋯]     |
+------------------------------------------------------+
| Key facts panel        | Related records / tabs        |
| (price, stock, SKU)    | (History, Reviews, Batches)   |
|                        |                                |
+------------------------------------------------------+
```

**Information hierarchy:** Identity (name/title) and primary actions in a persistent header → key facts (the "at a glance" answer) → deeper/related content below or in tabs, ordered by how often each is actually consulted (most-used tab first, not alphabetical).

**Components used:** Page header with actions, Tabs, key-value fact panel, related-record tables/cards, Activity Timeline (pattern 26) where relevant.

**User workflow:** Arrive from a list → scan key facts → drill into a tab if more depth is needed → act (edit, and workflow-specific actions).

**UX rules:** The record's edit action is always in the same header position across every detail-view instance in the product — a user should never have to hunt for it screen to screen.

**Accessibility requirements:** Tab panels use proper ARIA tab/tabpanel roles; back navigation is keyboard-reachable and clearly labeled.

**Responsive behavior:** Desktop: side-by-side key facts + tabs, or full-width single column depending on content volume. Tablet: single column, key facts panel moves above tabs. Mobile: single column, tabs become a horizontally-scrollable row (`COMPONENT_LIBRARY.md`), header actions collapse into a `⋯` overflow menu beside the title.

**Common mistakes:** Cramming every possible field onto the main view instead of using tabs/sections to organize by relevance; an edit action that's inconsistently placed relative to other detail views in the same product.

**Design rules:** One clear identity element (the record's name) at the top, unmistakably, at every breakpoint.

**Reusable patterns:** The base pattern for Patient Profile, Provider Profile, and most Billing/Order detail screens.

---

## 8. Create Form

**Purpose:** Capture a new record.

**Users:** Any role with create permission for the entity in question.

**When to use:** Triggered from a List/Table Page's primary action, or inline within a related workflow (e.g., creating a patient during Reception intake).

**When NOT to use:** If the "creation" is really a single field (e.g., quickly tagging something), a Modal is more appropriate than a full-page form.

**Layout:**
```
+------------------------------------------------------+
| ← Cancel    New Patient                    [Save]     |
+------------------------------------------------------+
| Full Name *          |  Phone *                        |
| [_____________]      |  [_____________]                |
| Date of Birth         |  Gender                         |
| [_____________]      |  [_____________]                |
|         ▾ Show more fields (insurance, next of kin)    |
+------------------------------------------------------+
```

**Information hierarchy:** Required fields first and visually distinguished (Design Principle applies — asterisk plus, ideally, grouped above optional fields), optional/advanced fields behind progressive disclosure (Design Principle 6).

**Components used:** Form inputs (`COMPONENT_LIBRARY.md`), section grouping, Save/Cancel action pair.

**User workflow:** Fill required fields → optionally expand and fill additional fields → submit → success feedback → land on the new record's Detail View (not back on an empty list) so the user can immediately confirm what they created.

**UX rules:** Cancel always confirms if the user has entered meaningful data and tries to navigate away (prevents silent data loss) — see `UX_PATTERNS.md` → Saving.

**Accessibility requirements:** Logical tab order matches visual order; required-field indicators are programmatic, not color-only.

**Responsive behavior:** Desktop/Tablet: 2-column grid for short related fields. **Mobile: always single column, full-width fields** (`COMPONENT_LIBRARY.md`) — non-negotiable at this breakpoint.

**Common mistakes:** A single giant undifferentiated form with 20+ visible fields at once (use progressive disclosure or a Wizard instead); losing entered data on an accidental back-navigation with no warning.

**Design rules:** One primary action (Save), positioned consistently (top-right header, mirrored at the bottom on long/mobile forms so the user doesn't have to scroll back up).

**Reusable patterns:** Shares its shape with Edit Form (pattern 9) almost entirely — see that pattern for the differences.

---

## 9. Edit Form

**Purpose:** Modify an existing record.

**Users:** Same as Create Form, plus "editor" of an existing record specifically.

**When to use:** Reached from a Detail View's Edit action, or inline editing within a table for simple field changes.

**When NOT to use:** Don't build a separate Edit Form screen for a single-field change that inline/quick-edit can handle (e.g., toggling a status) — reserve the full form for genuinely multi-field edits.

**Layout:** Identical structure to Create Form, pre-populated with existing values.

**Information hierarchy:** Same as Create Form, with one addition: a visible indicator of unsaved changes (a "You have unsaved changes" state on the Save button or a subtle banner) so the user always knows their edit state.

**Components used:** Same as Create Form.

**User workflow:** Arrive with fields pre-filled → change what's needed → submit → success feedback → return to the Detail View showing the updated values (not back to a list, unless the edit happened *from* a list's inline context).

**UX rules:** Changing a field and then reverting it back to its original value should not register as "unsaved changes" if the system can detect true equivalence — avoids false-positive "are you sure you want to leave" prompts.

**Accessibility requirements:** Same as Create Form.

**Responsive behavior:** Same as Create Form.

**Common mistakes:** Silently discarding an in-progress edit on navigation with no warning; not visually distinguishing which fields actually changed when a confirmation summary is shown (for high-stakes edits).

**Design rules:** Same as Create Form.

**Reusable patterns:** Shares its shape with Create Form almost entirely; the two should be implemented as one underlying pattern with a "mode" (create vs. edit), not two divergent implementations that drift apart over time.

---

## 10. Multi-Step Wizard

**Purpose:** Break a long or genuinely staged process into digestible steps.

**Users:** Any role completing a process with more than ~7-8 fields or with real sequential dependency between stages (e.g., patient intake: identity → medical history → insurance; business onboarding: business info → verification → payment setup).

**When to use:** When the process has genuine stages a user thinks about separately, or when later fields depend on earlier ones.

**When NOT to use:** Never for a form that's merely long but has no real staging — that's just a Create Form that needs better progressive disclosure, not a wizard. A wizard imposed on a non-staged process adds friction (forced linearity) without adding clarity.

**Layout:**
```
+------------------------------------------------------+
| ● Personal Info  ○ Medical History  ○ Insurance        |
+------------------------------------------------------+
|                                                        |
|              Step content (one step's fields)          |
|                                                        |
+------------------------------------------------------+
|  [← Back]                          [Continue →]        |
+------------------------------------------------------+
```

**Information hierarchy:** Step indicator (orientation — where am I, how much is left) → current step's content (sole focus) → navigation (back/continue), in that order.

**Components used:** Step indicator (numbered or labeled, showing completed/current/upcoming state), form fields per step, Back/Continue button pair.

**User workflow:** Complete step → Continue validates that step only (not the whole form) → next step → ... → final step's action is a real submit ("Complete Registration"), not another "Continue."

**UX rules:** Each step is independently validated before allowing Continue — don't let a user reach step 4 with an invalid step 1. Back never discards already-entered data. Auto-save progress between steps where the process is long enough that abandonment/return is likely (`UX_PATTERNS.md` → Saving).

**Accessibility requirements:** Step indicator announces current step and total ("Step 2 of 3: Medical History") to screen readers; focus moves to the new step's first field on Continue.

**Responsive behavior:** Desktop: step indicator as a horizontal labeled row. Tablet: labels may abbreviate. **Mobile:** step indicator compresses to a simple progress bar or "Step 2 of 3" text (full labels for every step rarely fit) — content area stays single-column and full-width at every breakpoint, consistent with Create Form's mobile rule.

**Common mistakes:** A wizard for a process with no real stages (added complexity with no benefit); losing all progress if the user navigates away and returns; not allowing Back to revisit a completed step.

**Design rules:** Exactly one forward action and one back action visible at a time — never additional competing actions during a wizard step.

**Reusable patterns:** Step indicator is reusable in any staged process; the per-step validation model reuses Create Form's field-level validation rules.

---

## 11. Search Results

**Purpose:** Present the outcome of a search query as a scannable, actionable list.

**Users:** CareFind — the core discovery experience. CareHub — searching within a specific module (e.g., product search).

**When to use:** Any time a query (typed or filter-derived) produces a set of results to browse.

**When NOT to use:** A search that resolves to exactly one obvious result (e.g., an exact SKU match) may skip straight to that result's Detail View rather than showing a one-item results list.

**Layout (CareFind):**
```
+------------------------------------------+
| ← "pediatrician lagos"        [Filter ▾] |
+------------------------------------------+
| [Result card: photo, name, badge, rating] |
| [Result card]                             |
| [Result card]                             |
+------------------------------------------+
```

**Information hierarchy:** Query context (what was searched, how many results) → filters (refine) → results ranked by relevance, each result card showing exactly the information needed to decide "is this worth opening" (name, verification badge, key differentiator, rating) — not every field the underlying record has.

**Components used:** Result Card, Filter chips, result count, Empty State (zero results).

**User workflow:** Query → scan results → refine via filters if needed → open a result into its Detail/Profile view.

**UX rules:** See `UX_PATTERNS.md` → Search, Filtering. Results update live as filters change (desktop) or on explicit Apply (mobile bottom sheet).

**Accessibility requirements:** Result count and "no results" states are announced via `aria-live` when they update from a filter change.

**Responsive behavior:** Desktop: results may show as a grid (2-3 columns) with filters as a persistent sidebar. Tablet: 2-column grid, filters may be a top toolbar. **Mobile: single-column card list, filters as a bottom sheet** (`COMPONENT_LIBRARY.md`).

**Common mistakes:** Result cards showing too much information (defeating scannability) or too little (forcing a tap into every result just to compare them); no distinction between "no results for this query" and "no results because your filters are too narrow" (the recovery action differs — broaden filters vs. try a different search).

**Design rules:** Every result card has one clear tap target for its full area (not a tiny "view" link buried in the corner) — the whole card is interactive.

**Reusable patterns:** Result Card is reusable across provider search, business search, drug/product search.

---

## 12. Global Search

**Purpose:** Find anything, from anywhere, fast — the CareHub command-palette pattern and CareFind's persistent search entry point.

**Users:** CareHub — any staff role, power-user acceleration. CareFind — any user, the core discovery entry point.

**When to use:** CareHub: triggered via `⌘K`/`Ctrl+K` or a persistent header search field. CareFind: the primary Search tab plus a persistent entry point from Home.

**When NOT to use:** CareHub's global search isn't a replacement for a module's local List/Table Page search (which searches within a known, already-narrow context) — global search is for "I don't know which module this is in."

**Layout (CareHub command palette):**
```
+------------------------------------------+
| 🔍 Search patients, products, orders...   |
+------------------------------------------+
| PATIENTS                                  |
|   John Doe — #REG-2201                    |
| PRODUCTS                                  |
|   Paracetamol 500mg                       |
| ACTIONS                                   |
|   + New Sale        ⌘N                    |
+------------------------------------------+
```

**Information hierarchy:** Input at top, results grouped by type (not one undifferentiated list) so the user can visually jump to the category they meant, actions mixed in alongside data results for true "do anything from here" power.

**Components used:** Overlay search input, grouped result list, keyboard-navigable selection (arrow keys + Enter).

**User workflow:** Trigger → type → results update live, grouped → arrow/click to select → navigate or execute.

**UX rules:** Recent/frequent items shown when the input is empty (don't show a blank overlay). Fuzzy matching, not just exact-substring matching — CareHub users searching for "paracetmol" (typo) should still find "Paracetamol."

**Accessibility requirements:** Full keyboard operability is the core requirement here, not an add-on — this pattern exists specifically for keyboard-first power users (`ACCESSIBILITY.md`, `NAVIGATION.md`).

**Responsive behavior:** Desktop: overlay modal, keyboard-triggered. Tablet: same, touch-triggered via a header search icon. **Mobile:** becomes a full-screen search experience rather than a small overlay (too little room for an overlay-within-a-page at this width) — see `COMPONENT_LIBRARY.md` → Search.

**Common mistakes:** Results with no grouping/categorization at high result counts; no keyboard navigation (defeats the entire purpose of the pattern); slow/unindexed search that can't keep up with fast typing.

**Design rules:** This overlay always closes on Escape and on selecting a result — it never lingers.

**Reusable patterns:** Feeds into Search Results (pattern 11) for CareFind's full-results context; the grouped-result-list shape is reusable in any type-ahead select component.

---

## 13. Patient Profile

**Purpose:** The complete clinical and administrative record for one patient, and the hub for acting on their care.

**Users:** CareHub — receptionist, nurse, doctor, pharmacist, lab tech (each sees a role-appropriate subset).

**When to use:** The canonical Detail View (pattern 7) extension for the `patients` entity.

**When NOT to use:** A quick patient lookup mid-workflow (e.g., confirming identity at checkout) doesn't need the full profile — a lighter card/popover suffices there.

**Layout:**
```
+------------------------------------------------------+
| ← Back   John Doe · #REG-2201    [At Doctor]  [Edit]  |
+------------------------------------------------------+
| Demographics panel     | Tabs: Visits | Prescriptions |
| (DOB, phone, NOK,      |       | Lab Results | Billing|
|  insurance)            |                                |
|                        | [Tab content]                  |
+------------------------------------------------------+
```

**Information hierarchy:** Identity + current status badge (where are they *right now* in the care pipeline — at triage, at doctor, discharged) is the single most important piece of information for staff coordinating around this patient, so it sits in the persistent header, not buried in a tab.

**Components used:** Status Badge, Demographics panel, Tabs, Activity Timeline (visit history), role-gated action buttons (a doctor sees "New Consultation," a pharmacist sees "Dispense," etc. — see `lib/permissions.js`'s existing role model, formalized here as the UI-level rule: show only actions the current role can actually perform, don't show-then-disable).

**User workflow:** Arrive via Reception/Triage/Doctor queue or search → confirm identity via header → act via the role-appropriate action → outcome updates the patient's pipeline status, visible immediately in the header badge.

**UX rules:** The pipeline status badge (H8's `admitted`/`referred`/`transferred`/`at_doctor`/etc. model) uses the same semantic color logic as every other status badge in the system (`COLORS.md`) — a patient's status is never a bespoke color scheme unique to this screen.

**Accessibility requirements:** Status changes are announced (`aria-live`) for staff using assistive tech in a fast-paced clinical setting where visual-only status changes could be missed.

**Responsive behavior:** Desktop: side panel + tabs side-by-side. Tablet: stacked, demographics collapse to a summary strip that expands on tap. Mobile: this is one of the CareHub screens explicitly scoped for mobile use (a nurse checking a patient's info on a ward tablet/phone) — single column, tabs scroll horizontally, header status badge remains persistent and visible while scrolling (sticky).

**Common mistakes:** Showing every role every action regardless of permission (then disabling the ones they can't use) instead of simply not showing them — a cluttered action bar full of disabled buttons is worse than a clean, role-appropriate one.

**Design rules:** The status badge is never omitted from the header — it is the single fastest-scanning piece of information on this screen for a busy staff member.

**Reusable patterns:** Extends Detail View (pattern 7); Status Badge and Activity Timeline are shared components used identically elsewhere.

---

## 14. Provider Profile

**Purpose:** Help a CareFind user decide whether to trust and choose this provider/business.

**Users:** CareFind — patients/public visitors (viewing), providers/businesses (managing their own).

**When to use:** Reached from Search Results, a direct link, or a business's own dashboard preview.

**When NOT to use:** N/A — this is the canonical destination for provider/business discovery.

**Layout:** See `LAYOUTS.md` → Profile Detail.
```
+------------------------------------------+
| [Photo]  Dr. Amaka Obi  ✓ Verified        |
|          Pediatrician · Lagos              |
+------------------------------------------+
| [    Book Consultation    ]                |
+------------------------------------------+
| About | Reviews (128) | Services            |
+------------------------------------------+
| Tab content                                |
+------------------------------------------+
```

**Information hierarchy:** Trust signal (verification badge) is inseparable from the identity — it sits directly beside the name, never demoted to a small icon buried elsewhere (Design Principle 12). Primary action (Book/Contact) sits above any tabbed detail content, always visible without scrolling on a typical phone screen.

**Components used:** Verification Badge, hero photo/avatar, primary action button, Tabs, Review list/summary.

**User workflow:** Arrive → assess trust signal + key facts in under five seconds → either act immediately (Book) or explore tabs (Reviews specifically, for a more considered decision) → act.

**UX rules:** Review summary (average rating + count) is visible without opening the Reviews tab — a user shouldn't have to tap into a sub-tab just to see "4.8 (128 reviews)." Claimed-but-unverified vs. verified businesses are visually distinguished, honestly — never implying verification that hasn't happened.

**Accessibility requirements:** Verification badge has real accessible text ("Verified provider"), not just a checkmark icon with no label.

**Responsive behavior:** Mobile: as shown above, single column, primary action fixed/sticky near the bottom of the viewport once the user scrolls past it in the header (so it's always reachable without scrolling back up). Tablet: hero and key facts may sit side-by-side. Desktop: two-column layout — profile content left, a summary/booking card persistently visible right (matches how Stripe/booking-style products keep the conversion action visible during content browsing).

**Common mistakes:** Burying the primary action below a long About section; a reviews tab with no visible summary until opened; no visual distinction between verified and unverified listings.

**Design rules:** Trust signal and primary action are both above the fold at every breakpoint — no exceptions.

**Reusable patterns:** Extends the Profile Detail layout (`LAYOUTS.md`); Verification Badge and Review components are reused on Search Results cards in summarized form.

---

## 15. Appointment Workflow

**Purpose:** Take a user from "I want to see this provider" to a confirmed booking, and let staff manage the resulting schedule.

**Users:** CareFind — the patient booking. CareHub — reception/staff managing the resulting appointment.

**When to use:** Triggered from a Provider Profile's "Book" action (CareFind) or created directly by staff (CareHub).

**When NOT to use:** A same-day walk-in patient at a CareHub front desk doesn't need the multi-step booking flow — that's a direct Create Form (Reception intake), not this pattern.

**Layout (CareFind booking, a lightweight Wizard):**
```
+------------------------------------------+
| Choose a time             Dr. Amaka Obi   |
+------------------------------------------+
| [Date picker: horizontal day strip]        |
+------------------------------------------+
| [9:00] [9:30] [10:00] [10:30 - full]       |
+------------------------------------------+
| [       Confirm Booking       ]            |
+------------------------------------------+
```

**Information hierarchy:** Provider context stays visible (small header) throughout the flow so the user never loses track of who they're booking — date selection → time-slot selection → confirmation, in that order, matching how a person actually thinks about scheduling.

**Components used:** Date strip/picker, time-slot grid (with unavailable slots visibly disabled, not hidden — a user should see that 10:30 exists and is full, not wonder why it's missing), confirmation summary, Button (primary).

**User workflow:** Select date → select available time → review summary (provider, date, time, any fee) → confirm → success screen with clear next-step info (what happens now, how to reschedule/cancel).

**UX rules:** Unavailable slots are shown-but-disabled, not omitted (omission makes the schedule feel arbitrary/broken). Time zone is stated explicitly if there's any ambiguity. Cancellation/reschedule policy is stated before the final confirm tap, not discovered after.

**Accessibility requirements:** Time-slot grid is fully keyboard-navigable; selected state is conveyed by more than color (a checkmark or border, not fill-color alone).

**Responsive behavior:** Mobile (primary): vertical flow as shown, one decision per screen-height. Tablet/Desktop: date and time-slot selection may sit side-by-side (a calendar-plus-slots layout) since there's room to show both simultaneously without the progressive-disclosure benefit being lost.

**Common mistakes:** Showing only available slots with no indication of the full schedule (makes the system feel opaque); requiring account creation before letting a user see *whether* a time is even available (let them see the calendar first, require auth only to actually confirm).

**Design rules:** The provider being booked is never ambiguous — persistent context header throughout every step.

**Reusable patterns:** Uses the Multi-Step Wizard pattern's step-validation model in a lightweight form; feeds into CareHub's own appointment/consultation queue views (List/Table Page pattern).

---

## 16. Inventory

**Purpose:** Track and manage stock — products, quantities, batches, movement.

**Users:** CareHub — pharmacy/retail staff, warehouse staff (enterprise vertical).

**When to use:** The extension of List/Table Page (pattern 6) for the `products`/`stock_batches` entities.

**When NOT to use:** Individual sale-time stock deduction happens inside POS, not here — Inventory is for management/oversight, not transaction-time interaction.

**Layout:** Extends List/Table Page, with domain-specific additions:
```
+--------+------------------------------------------+
| Side   | Inventory              [+ Receive Stock]  |
| bar    +--------------------------------------------+
|        | ⚠ 3 batches expiring within 60 days        |
|        +--------------------------------------------+
|        | [Search] [Location ▾] [Status ▾]           |
|        +--------------------------------------------+
|        | Product | Batch | Qty | Expiry | Status     |
+--------+------------------------------------------+
```

**Information hierarchy:** Proactive alerts (expiring stock, low stock) sit above the table itself — this is information the user needs *before* they even start searching/filtering, not something they should have to discover by scanning every row.

**Components used:** Alert banner (warning-semantic), Table (extends List/Table Page), Status Badge (available/reserved/damaged/expired), quantity/expiry-tone indicators (color-coded proximity-to-expiry, matching existing product convention).

**User workflow:** Land → check alerts → search/filter to find a specific product or batch → view detail or act (transfer, adjust, mark status).

**UX rules:** Expiry-proximity coloring follows the same semantic scale as everywhere else (`COLORS.md`) — red for expired, warning-orange for expiring soon, neutral for healthy — never a bespoke color scale unique to this screen.

**Accessibility requirements:** Alert banner is announced on page load if it contains genuinely time-sensitive information (expiring stock).

**Responsive behavior:** Desktop: full table with all batch detail columns. Tablet: reduced columns, alerts remain prominent. Mobile: card-list transformation (`COMPONENT_LIBRARY.md`) — each card shows product name, quantity, and expiry-tone badge; batch-level detail available on tap into the card.

**Common mistakes:** Burying expiry/low-stock alerts inside the table (requiring the user to scan every row to notice a problem) instead of surfacing them proactively.

**Design rules:** Alerts are dismissible per-item (marking a batch reviewed) but the alert banner itself never permanently disappears while a real condition exists — no "snooze forever" on genuine stock-safety information.

**Reusable patterns:** Extends List/Table Page; Status Badge and alert-banner pattern reused in Pharmacy and Laboratory queues.

---

## 17. Pharmacy

**Purpose:** Manage the prescription-dispensing queue — from a doctor's order to a patient receiving medication.

**Users:** CareHub — pharmacists.

**When to use:** The queue-management extension of List/Table Page for the `prescriptions` entity.

**When NOT to use:** Retail (non-prescription) sales go through POS, not this queue.

**Layout:**
```
+--------+------------------------------------------+
| Side   | Prescription Queue                        |
| bar    +--------------------------------------------+
|        | Pending (4)  |  Dispensed today (12)       |
|        +--------------------------------------------+
|        | [Patient] [Doctor] [Medicines] [Time] [Act] |
+--------+------------------------------------------+
```

**Information hierarchy:** A two-state queue split (Pending vs. Dispensed) is the single most important structural decision — pharmacists work the pending queue continuously; dispensed history is reference, not action.

**Components used:** Queue tabs/split view, Table (extends List/Table Page), quick-action ("Dispense") inline per row, patient-communication link where relevant.

**User workflow:** Monitor pending queue (often left open on a screen throughout a shift) → open a prescription's detail to review medicines/dosage → mark dispensed → queue updates in real time (new prescriptions from doctors appear without a manual refresh).

**UX rules:** Real-time updates are essential here (a pharmacist shouldn't have to manually refresh to see a new doctor order) — see `UX_PATTERNS.md` → Performance Feedback for how updates should surface (a subtle "new item" indicator, not a jarring re-sort of the list mid-scan).

**Accessibility requirements:** New-item arrival is announced for screen-reader users monitoring the queue.

**Responsive behavior:** Desktop: this screen is frequently left open on a dedicated pharmacy-counter monitor — optimize for at-a-glance scanning from a slight distance (larger row height, higher-contrast status). Tablet: viable secondary device at the counter. Mobile: reference-only use case (checking queue status from elsewhere), not the primary dispensing workflow.

**Common mistakes:** Auto-refresh that re-sorts or jumps the list while a pharmacist is mid-read of a row (should append new items without disturbing scroll position/current focus).

**Design rules:** Pending-count is visible in the tab/section label itself, not just inferred from scrolling the list.

**Reusable patterns:** Queue-split pattern (Pending/Completed) reused in Laboratory, Imaging, and Task Submissions-style review screens.

---

## 18. Laboratory

**Purpose:** Manage lab test requests from order to result.

**Users:** CareHub — lab technicians, with results ultimately visible to ordering doctors.

**When to use:** The queue-management extension of List/Table Page for `lab_requests`/`lab_results`.

**When NOT to use:** N/A within CareHub's clinical modules — this is the canonical lab workflow screen.

**Layout:** Same queue-split shape as Pharmacy (pattern 17): Pending / Completed, table with patient, requested tests, priority, requesting doctor.

**Information hierarchy:** Priority (routine vs. urgent) is a first-class visual signal, not a buried column — an urgent request should be impossible to miss at a glance, sitting at the top of the pending queue by default sort order and visually flagged (semantic danger/warning color, not just text saying "urgent").

**Components used:** Priority Badge, queue tabs, Table, result-entry form (opened per request).

**User workflow:** Monitor pending queue, prioritized → open a request → enter/attach results → mark complete → result becomes visible on the patient's record (Patient Profile, pattern 13) and to the ordering doctor.

**UX rules:** Result entry is validated for plausibility where possible (e.g., a wildly out-of-range value flagged for double-check, not silently accepted) — this is a place where a small UX safeguard has real clinical stakes.

**Accessibility requirements:** Priority is conveyed by icon/text plus color, never color alone (`ACCESSIBILITY.md`).

**Responsive behavior:** Same as Pharmacy — desktop/tablet primary, mobile reference-only.

**Common mistakes:** Sorting the pending queue purely by submission time with no priority weighting, burying an urgent request behind older routine ones.

**Design rules:** Urgent items are never just "higher in a list" — they get a distinct, unmissable visual treatment.

**Reusable patterns:** Extends the Pharmacy queue-split pattern; result-entry form follows Create/Edit Form rules.

---

## 19. Imaging

**Purpose:** Manage imaging requests (X-ray, ultrasound, etc.) from order to report.

**Users:** CareHub — imaging/radiology staff.

**When to use:** Structurally identical to Laboratory (pattern 18) — same queue-split shape, same priority model, adapted to `imaging_requests`.

**When NOT to use:** N/A.

**Layout:** Identical to Laboratory's queue-split table, with a report/image-attachment step in place of Laboratory's numeric result entry.

**Information hierarchy:** Same priority-first model as Laboratory.

**Components used:** Same as Laboratory, plus a file/image attachment component for the report.

**User workflow:** Same as Laboratory, with the terminal action being "attach report" rather than "enter values."

**UX rules:** Image/file upload shows real progress feedback for what may be a large file on a constrained connection (`UX_PATTERNS.md` → Loading & Performance Feedback) — this is one of the more bandwidth-sensitive interactions in CareHub.

**Accessibility requirements:** Same as Laboratory.

**Responsive behavior:** Same as Laboratory.

**Common mistakes:** Same as Laboratory, plus: no upload-progress feedback on a large image file, leaving the user unsure if the upload is working.

**Design rules:** Same as Laboratory.

**Reusable patterns:** Directly extends the Laboratory pattern — implemented as the same underlying queue-split shape with a different terminal action, not a divergent one-off.

---

## 20. Billing

**Purpose:** Manage charges, payments, and financial records tied to patients, sales, or subscriptions.

**Users:** CareHub — accountants, front-desk staff, business owners. CareFind — wallet/transaction views for users and professionals.

**When to use:** Any screen showing a financial ledger, an invoice, or a payment action.

**When NOT to use:** The point-of-transaction moment (POS ringing up a sale) is its own focused Full-Width Workspace layout (`LAYOUTS.md`), not this pattern — Billing is for reviewing/managing the resulting records afterward.

**Layout:** Extends List/Table Page, with currency-forward formatting and a running-total summary.
```
+--------+------------------------------------------+
| Side   | Billing                                    |
| bar    +--------------------------------------------+
|        | Revenue this month: ₦482,000                |
|        +--------------------------------------------+
|        | [Search] [Status ▾] [Date range]            |
|        +--------------------------------------------+
|        | Date | Patient | Amount | Status | ⋯        |
+--------+------------------------------------------+
```

**Information hierarchy:** A summary figure (revenue, outstanding balance) sits above the table — financial screens are consulted for the headline number first, the detail second.

**Components used:** Summary stat, Table, Status Badge (paid/pending/overdue/refunded), currency formatting (consistent decimal/thousands convention across the entire product, never inconsistent between screens).

**User workflow:** Check summary → filter to a relevant period/status → review individual records → act (mark paid, issue refund — refunds and other financially-irreversible actions require the Confirmation Dialog pattern, pattern 29).

**UX rules:** Currency is always shown with its symbol/code, never a bare number a user has to infer the currency of. Financial totals recalculate live as filters change, and the visible total always matches exactly what's in the filtered table below it (a mismatch here is a trust-destroying bug, not a cosmetic one).

**Accessibility requirements:** Currency values are structured so screen readers announce them correctly (symbol + amount + currency, not a symbol read as a stray character).

**Responsive behavior:** Desktop: full table with summary stats in a row above. Tablet: summary stats reflow, table columns reduce. Mobile: card-list transformation, with amount and status as the two most prominent fields per card (the two things a user scanning billing history actually needs at a glance).

**Common mistakes:** A summary total that doesn't match the filtered table state (calculated separately, drifting out of sync); inconsistent currency formatting between screens (one screen shows "₦500", another shows "500 NGN," another shows "N500").

**Design rules:** One consistent currency-formatting convention, defined once, applied everywhere — never decided per-screen.

**Reusable patterns:** Extends List/Table Page; Status Badge and summary-stat pattern reused in Reports/Analytics.

---

## 21. Reports

**Purpose:** Generate and review structured, often exportable, business records over a period.

**Users:** CareHub — business owners, accountants, administrators.

**When to use:** Any time a user needs a period-based, often exportable view of business data (sales report, inventory report) distinct from live day-to-day operational screens.

**When NOT to use:** Real-time operational monitoring (today's queue, current stock) is Dashboard/List territory, not Reports — Reports are retrospective and structured, not live and actionable in the same way.

**Layout:**
```
+--------+------------------------------------------+
| Side   | Reports                                    |
| bar    +--------------------------------------------+
|        | Report type ▾   Date range ▾   [Generate]  |
|        +--------------------------------------------+
|        | [Summary stats]                             |
|        +--------------------------------------------+
|        | [Table or chart, depending on report type]  |
|        |                              [Export ▾]      |
+--------+------------------------------------------+
```

**Information hierarchy:** Report configuration (type, period) at top, since it determines everything below → summary → detail table/chart → export action, positioned last since it's the final step of the workflow, not competing with the report content for attention.

**Components used:** Select controls (report type, date range), summary stats, Table or Chart (`COMPONENT_LIBRARY.md`), Export control (PDF/CSV).

**User workflow:** Choose report type and period → generate → review → export if needed.

**UX rules:** Generation shows real loading/progress feedback for anything non-instant (`UX_PATTERNS.md`) — never a silent multi-second wait with no indication work is happening. Export formats are explicit (CSV vs. PDF are different use cases — data manipulation vs. sharing/printing — and both should be available where relevant, not just one arbitrarily chosen).

**Accessibility requirements:** Generated charts have a text-equivalent summary (a table alternative or a described trend) for screen-reader users, not chart-only presentation of the underlying data.

**Responsive behavior:** Desktop: full chart/table detail. Tablet: chart legend repositions (`COMPONENT_LIBRARY.md`). **Mobile:** simplified summary-first presentation — full report generation/detailed table review is a secondary mobile use case; the mobile view prioritizes the headline numbers and offers "view full report" for anything genuinely dense, rather than cramming a wide table onto a phone.

**Common mistakes:** A report configuration UI so complex it becomes its own usability problem; export buttons with no format clarity ("Export" alone, unclear if it's CSV or PDF).

**Design rules:** Configuration is always visible/editable without starting over — changing the date range and re-generating should not require re-selecting the report type.

**Reusable patterns:** Shares Table/Chart components with Analytics and Billing.

---

## 22. Analytics

**Purpose:** Surface trends and patterns over time, for decision-making rather than record-keeping.

**Users:** CareHub — business owners, administrators, managers.

**When to use:** When the question is "what's the trend" rather than "what's the exact record" (that distinction is what separates Analytics from Reports).

**When NOT to use:** Don't use a dense analytics dashboard to answer a question a single stat card could answer — Analytics is for genuinely multi-dimensional trend questions.

**Layout:**
```
+--------+------------------------------------------+
| Side   | Analytics                Period: [30d ▾]  |
| bar    +--------------------------------------------+
|        | [KPI] [KPI] [KPI]                           |
|        +--------------------------------------------+
|        | [Primary trend chart]                       |
|        +--------------------------------------------+
|        | [Secondary chart]  |  [Secondary chart]      |
+--------+------------------------------------------+
```

**Information hierarchy:** KPIs (the headline "so what") above the charts that explain them — a chart without a stated conclusion forces the user to do the interpretation themselves; a stated KPI plus a supporting chart does the interpretation for them and lets them verify it visually.

**Components used:** KPI stat cards (with period-over-period delta, e.g. "↑ 12% vs last month"), Charts (`COMPONENT_LIBRARY.md`), period selector.

**User workflow:** Choose period → scan KPIs for headline trends → consult charts for detail/explanation → (optionally) drill into a specific chart's underlying data via Reports.

**UX rules:** Every KPI delta is directional and colored semantically (`COLORS.md` — green for genuinely positive change, red for genuinely negative, being careful that "positive number" and "good outcome" aren't always the same thing, e.g. rising expenses is a positive number but a negative outcome — the color must reflect business meaning, not just arithmetic sign).

**Accessibility requirements:** Same chart text-equivalent requirement as Reports.

**Responsive behavior:** Desktop: multi-chart grid as shown. Tablet: charts stack, KPI row reflows. Mobile: KPIs remain (2-column stat grid, `COMPONENT_LIBRARY.md`), detailed charts collapse behind "View chart" expansion or are deferred to desktop entirely, depending on how essential real-time trend-checking on mobile actually is for this specific metric.

**Common mistakes:** Charts included for visual completeness rather than because they answer a real question; KPI deltas colored by raw sign rather than actual business meaning.

**Design rules:** Every chart on this screen answers a question stated somewhere near it (a KPI label, a chart title) — no orphaned charts with no stated purpose.

**Reusable patterns:** Shares KPI stat card and Chart components with Reports and the module-level Dashboard pattern.

---

## 23. Settings

**Purpose:** Configure account, business, and system-level preferences.

**Users:** All roles, scoped to what each role is permitted to configure.

**When to use:** The canonical destination for any configuration that isn't part of day-to-day operational workflow.

**When NOT to use:** Don't bury a frequently-used operational toggle inside Settings if it's actually part of daily workflow (e.g., a POS register's till-open/close state belongs in POS, not Settings).

**Layout:**
```
+--------+------------------------------------------+
| Side   | Settings                                   |
| bar    +--------------------------------------------+
|        | General | Team | Billing | Notifications    |
|        +--------------------------------------------+
|        | [Section content — grouped fields]           |
+--------+------------------------------------------+
```

**Information hierarchy:** Settings are grouped into clearly labeled sections/tabs (never one long undifferentiated scroll of every setting the product has) — a user looking for "notification preferences" should be able to jump straight there.

**Components used:** Tabs or a settings-section sidebar-within-sidebar, form fields, Toggle switches, danger-zone section (visually separated, for destructive settings like account deletion).

**User workflow:** Navigate to the relevant section → change a setting → auto-save (for simple toggles) or explicit save (for multi-field sections) — see `UX_PATTERNS.md` → Saving for which applies when.

**UX rules:** Destructive/high-stakes settings (deleting data, removing a team member's access, deactivating a business) live in a visually distinct "danger zone," always at the bottom of their section, never mixed in among routine preferences.

**Accessibility requirements:** Toggle switches have real accessible state (`aria-checked`), not just a visual slide with no programmatic state.

**Responsive behavior:** Desktop: settings sections as a left-hand sub-nav within the content area, content to the right. Tablet: sub-nav becomes a top tab row. Mobile: sub-nav becomes its own list screen (tap a section, navigate into it, back to return) — a nested-drill-down pattern rather than trying to fit tabs-plus-content on one small screen.

**Common mistakes:** A single infinite-scroll settings page with no sectioning; destructive actions visually indistinguishable from routine ones.

**Design rules:** The danger zone is always the last section, always requires the Confirmation Dialog pattern (29) for its actions, never auto-saves.

**Reusable patterns:** Section/tab navigation shape reused from Detail View; danger-zone pattern reused anywhere a destructive setting exists.

---

## 24. User Profile

**Purpose:** Let a user view and manage their own identity, credentials, and personal preferences.

**Users:** Every authenticated user, for their own account.

**When to use:** The account-level equivalent of Settings, scoped specifically to "me" rather than "the business/system."

**When NOT to use:** Business-level configuration (staff management, business hours) belongs in Settings, not here, even though both are reachable from similar navigation locations — keep the "about me" and "about my business" concerns separate.

**Layout:**
```
+------------------------------------------+
| [Avatar]  Amaka Obi                        |
|           Pharmacist · Samir Pharmaceutical|
+------------------------------------------+
| Profile Info | Security | Preferences      |
+------------------------------------------+
| [Section content]                          |
+------------------------------------------+
```

**Information hierarchy:** Identity (photo, name, role/affiliation) as a persistent header, sections below for editable detail — mirrors Detail View's shape since a user profile *is* a detail view of the "me" record.

**Components used:** Avatar/photo upload, form fields, password-change flow (reuses Reset Password's field pattern), notification preference toggles.

**User workflow:** View → edit a section → save → confirmation.

**UX rules:** Changing a security-sensitive field (email, password) may require re-authentication or a confirmation step — this is a place where slightly more friction than usual is appropriate (Design Principle 9 — protecting against real harm, in this case account takeover).

**Accessibility requirements:** Avatar upload has a keyboard-operable path (not mouse-drag-only).

**Responsive behavior:** Desktop/Tablet: header plus tabbed sections as shown. Mobile: same drill-down sub-nav pattern as Settings.

**Common mistakes:** Mixing personal and business-level settings on the same screen, confusing the mental model of "who does this setting affect."

**Design rules:** Security-sensitive changes are always in their own clearly labeled section, never mixed into general "Profile Info."

**Reusable patterns:** Extends Detail View and Settings' sectioning pattern.

---

## 25. Notifications

**Purpose:** A persistent, reviewable record of things the user needs to know or act on.

**Users:** All roles, both products.

**When to use:** The destination for the Notification Bell/badge; also referenced by toast notifications as "see all in Notifications."

**When NOT to use:** Transient confirmations ("Saved") are toasts, not entries here — this screen is for things worth a persistent record (`UX_PATTERNS.md` → Notifications).

**Layout:**
```
+------------------------------------------+
| Notifications              [Mark all read] |
+------------------------------------------+
| ● New verification request     2m ago     |
| ○ Order #4521 approved          1h ago     |
| ○ Low stock: Paracetamol        3h ago     |
+------------------------------------------+
```

**Information hierarchy:** Unread state (a filled dot or bold text, never color alone) leads each row, most recent first, with enough context in the row itself that the user rarely needs to tap in just to understand what happened.

**Components used:** List, unread indicator, relative timestamp, tap-through to the relevant record.

**User workflow:** Open (often via a badge-count-triggered curiosity) → scan → tap an item to go to its source → optionally mark all read.

**UX rules:** Tapping a notification always navigates to the specific relevant context (the actual order, the actual patient), never to a generic module landing page — "Order #4521 approved" should open that order, not the general Orders list.

**Accessibility requirements:** Unread count badge is announced (`aria-live`) when it changes while the user is on another screen, if a persistent badge is visible in the header/nav.

**Responsive behavior:** Desktop: dropdown panel from a header bell icon, or a full page. Tablet: same. Mobile: full-screen list (a dropdown panel is impractical at this width) — reached via a bottom-nav tab (CareFind) or a header icon (CareHub).

**Common mistakes:** Notifications that all link to the same generic destination regardless of content; no visual distinction between read and unread; a badge count that includes notifications the backend never actually surfaces (mismatched count and content — a real bug class, not just a design concern, but one design should guard against by keeping count and list genuinely coupled).

**Design rules:** Read state changes immediately and optimistically on tap (no waiting for a server round-trip to visually mark something read).

**Reusable patterns:** List shape reused broadly; unread-indicator convention reused on Messages, Activity feeds.

---

## 26. Activity Timeline

**Purpose:** Show a chronological history of what happened to a record — an audit trail a user can actually read.

**Users:** Any role reviewing a record's history (order status changes, a patient's visit history, an admin action log).

**When to use:** As a tab/section within a Detail View, wherever a record's history genuinely matters for the current decision (was this order approved? when? by whom?).

**When NOT to use:** Don't add a timeline to every entity by default — only where history is genuinely consulted, not as decoration implying rigor.

**Layout:**
```
+------------------------------------------+
| ● Approved by Amaka Obi        Jul 18, 2:04pm |
| |  "Confirmed stock available"                 |
| ● Submitted by John Doe        Jul 18, 1:30pm |
+------------------------------------------+
```

**Information hierarchy:** Most recent event first, each event showing what happened, who did it, when, and (where relevant) why/notes — the four facts that actually answer "what's the story here."

**Components used:** Vertical timeline/connector line, event dot (may carry semantic color per event type), actor name, relative-then-absolute timestamp (relative for recent, e.g. "2h ago," with the exact timestamp available on hover/tap for precision when needed).

**User workflow:** Scan chronologically (usually top-down, most-recent-first) to understand how a record reached its current state.

**UX rules:** Every state-changing action anywhere in the system that writes to a timeline does so with a real actor and timestamp — a timeline with anonymous or missing entries defeats its entire purpose (this is as much a data/engineering requirement as a design one, but the design system exists partly to make that requirement visible and non-optional).

**Accessibility requirements:** The connector line is purely decorative (`aria-hidden`); the actual content is a real, readable list to a screen reader, not dependent on the visual line for meaning.

**Responsive behavior:** Desktop/Tablet: as shown, with room for note/comment text inline. Mobile: same vertical structure, condensed spacing, notes may truncate with a "show more" if long.

**Common mistakes:** A timeline that shows raw system events ("status changed to 'approved'") instead of human-readable ones ("Approved by Amaka Obi") — the whole value of this pattern is legibility over a raw log.

**Design rules:** Never more than one visual style of event dot/color scheme per timeline — consistent semantic coloring throughout (`COLORS.md`).

**Reusable patterns:** Reused inside Patient Profile, Order/Billing detail views, and admin audit contexts.

---

## 27. Modal Dialog

**Purpose:** A focused, blocking overlay for a short task that doesn't warrant leaving the current page.

**Users:** All roles, both products.

**When to use:** Quick create/edit forms, confirmations, short informational content — anything the user should complete or dismiss before returning to what they were doing.

**When NOT to use:** Never for a task with more than ~5-6 fields or multiple real stages (use a full Create Form or Wizard instead) — a modal that requires scrolling internally to see its own footer actions has outgrown the pattern.

**Layout:** See `COMPONENT_LIBRARY.md` → Modals/Dialogs for the full responsive specification (centered dialog on desktop/tablet, bottom sheet on mobile).
```
+------------------------------------------+
| Add Location                        ✕     |
+------------------------------------------+
| [Form fields]                              |
+------------------------------------------+
| [Cancel]                    [Save]         |
+------------------------------------------+
```

**Information hierarchy:** Title (what is this) → content (the task) → actions (footer, always in the same relative position: secondary/Cancel left, primary/Save right).

**Components used:** Backdrop, close (×) control, title, content area (scrollable if needed, footer stays fixed), Cancel/primary action pair.

**User workflow:** Triggered by an action elsewhere → complete or cancel → returns to the exact page/scroll state the user was in before.

**UX rules:** Backdrop click dismisses for non-destructive modals; for a modal containing a destructive/irreversible action, backdrop click and Escape are disabled or require the same explicit confirmation as clicking Cancel (prevents accidentally dismissing — and in some flows, accidentally confirming — a high-stakes action).

**Accessibility requirements:** Focus traps within the modal while open, returns to the triggering element on close (`ACCESSIBILITY.md`); modal has `role="dialog"` and `aria-labelledby` pointing to its title.

**Responsive behavior:** Fully specified in `COMPONENT_LIBRARY.md` — centered dialog (desktop/tablet) → bottom sheet (mobile), this transformation applies universally, not per-product.

**Common mistakes:** A modal so tall its footer actions scroll out of view; nested modals (a modal opening another modal) — if a task needs that, it's not a modal-shaped task.

**Design rules:** One modal open at a time, system-wide — never stack them.

**Reusable patterns:** The base shape for Confirmation Dialog (29); Create/Edit Form content can live inside a modal for lightweight entities.

---

## 28. Drawer

**Purpose:** A side-anchored panel for content related to, but secondary to, the main page — detail-on-select without leaving the list, or a supplementary tool panel.

**Users:** CareHub primarily (its multi-panel, desktop-first context is where this pattern earns its keep).

**When to use:** Reviewing an item's detail while keeping the underlying list/context visible and in place (e.g., previewing an order without navigating away from the order queue).

**When NOT to use:** Don't use a drawer for a task that's really a full workflow (creating a multi-step record) — that belongs on its own page or in a Wizard.

**Layout:**
```
+------------------------------------------+------------+
|  Underlying page content, dimmed slightly  | Drawer     |
|  but visible                               | content    |
|                                            | [Actions]  |
+------------------------------------------+------------+
```

**Information hierarchy:** Same as Modal (title → content → actions) but with the added context that the page behind it remains visible and relevant — the drawer is explicitly *about* something the user can still see.

**Components used:** Same as Modal, anchored to the viewport edge rather than centered.

**User workflow:** Triggered from a list-row/card without full navigation → review/act → close, returning exactly to where the underlying list was scrolled.

**UX rules:** The underlying page is visible-but-dimmed and non-interactive while the drawer is open (same focus-trap requirement as Modal) — it's a genuine overlay, not a permanently-docked side panel the user can interact with simultaneously (that would be a different pattern — Sidebar + List/Detail Split, `LAYOUTS.md`).

**Accessibility requirements:** Same as Modal.

**Responsive behavior:** See `COMPONENT_LIBRARY.md` — desktop/tablet: partial-width side panel; **mobile: converges with Modal's bottom-sheet/full-screen behavior**, since a partial-width drawer doesn't work at 360px.

**Common mistakes:** Using a drawer when a persistent split-panel layout (`LAYOUTS.md`, pattern 2) would better serve a workflow the user repeats constantly (a drawer that has to be re-triggered for every item is more friction than a persistent detail panel, for high-frequency review tasks).

**Design rules:** Same as Modal.

**Reusable patterns:** Shares nearly all behavior with Modal; the distinction is purely about anchor position and the implied relationship to the page behind it.

---

## 29. Confirmation Dialog

**Purpose:** Stop an irreversible or high-consequence action from happening by accident.

**Users:** All roles, both products — but used sparingly (Design Principle 9).

**When to use:** Genuinely irreversible or hard-to-reverse actions only: permanent deletion, a financial refund, removing someone's account access, suspending a business.

**When NOT to use:** **Never for routine, reversible actions.** Saving a form, archiving an item, dismissing something — these get Undo (`UX_PATTERNS.md`), not a confirmation dialog. Overusing this pattern is what trains users to click through it without reading, which defeats it entirely for the cases that actually matter.

**Layout:** A minimal Modal variant.
```
+------------------------------------------+
| Delete this patient record?                |
|                                            |
| This cannot be undone. All visit history,  |
| prescriptions, and lab results for John    |
| Doe will be permanently removed.           |
+------------------------------------------+
| [Cancel]                [Delete]           |
+------------------------------------------+
```

**Information hierarchy:** A specific, plain-language statement of *exactly* what will happen — never a generic "Are you sure?" with no specifics. The destructive action names its consequence explicitly.

**Components used:** Modal shell, warning/danger iconography, Cancel (default-focused) + Danger button (destructive action, never default-focused).

**User workflow:** Triggered by a destructive action → read the specific consequence → confirm or cancel.

**UX rules:** The destructive button is never the dialog's default/auto-focused element — an accidental Enter keypress must never confirm a destructive action. For especially high-stakes actions (deleting a business, not just a record), consider requiring the user to type a confirmation phrase (e.g., the record's name) — an escalation of friction proportional to the actual stakes, not applied uniformly to every confirmation.

**Accessibility requirements:** `role="alertdialog"`, focus starts on Cancel (the safe default), not the destructive action.

**Responsive behavior:** Same as Modal at every breakpoint — this pattern doesn't need a different mobile treatment beyond the standard bottom-sheet conversion, since its content is inherently short.

**Common mistakes:** Using this pattern for routine actions until users stop reading it (the single most damaging mistake this pattern can suffer, because it defeats the safety mechanism for the one time it actually matters); vague copy ("This action cannot be undone" with no statement of *what* the action even does).

**Design rules:** Cancel is always the default-focused, visually-safe option. The destructive button is always styled with the danger color (`COLORS.md`), never the primary teal.

**Reusable patterns:** A minimal variant of Modal; reused identically for every destructive action in both products, not reinvented per-feature.

---

## 30. Empty State

**Purpose:** Tell the user clearly why a screen has nothing on it, and what to do about it.

**Users:** Every role, both products — this pattern appears constantly and is one of the most under-designed states in typical software (Design Principle 5).

**When to use:** Any list, table, dashboard panel, or search result that has zero items to show, for any reason.

**When NOT to use:** N/A — every zero-item state needs this pattern; there is no acceptable "just show nothing" alternative.

**Layout:**
```
+------------------------------------------+
|              [Simple icon/illustration]    |
|         No products yet                    |
|   Add your first product to start          |
|   tracking inventory.                       |
|         [ + Add Product ]                   |
+------------------------------------------+
```

**Information hierarchy:** A brief, honest statement of the situation → (where applicable) a brief explanation of why → a clear, actionable next step. Not every empty state needs all three (a "no search results" empty state needs a different next step than a "no records exist yet" one — see below).

**Components used:** Small icon or simple illustration (`BRAND_GUIDELINES.md` — sparing, single consistent style), heading, one line of supporting text, primary action button where a genuine next action exists.

**User workflow:** Land on empty screen → understand why → act (create the first record, adjust filters, or simply understand that "empty" is the correct/expected state here).

**UX rules:** **Distinguish the three real causes of an empty state, each with different messaging:**
1. **Nothing exists yet** ("No products yet — add your first one") — encouraging, action-oriented.
2. **Filters/search excluded everything** ("No results match your filters — try broadening your search") — action is to adjust the filter, with a visible "Clear filters" shortcut right there.
3. **Genuinely, positively empty** ("No pending approvals — you're all caught up") — this is good news, and should read as good news, not as a problem to solve.

**Accessibility requirements:** Empty-state text is real, readable content (not an image with text baked in) so screen readers convey it properly.

**Responsive behavior:** Scales down proportionally at smaller breakpoints — illustration shrinks or is omitted entirely on mobile if space is tight, but the heading/text/action always remain, since they carry the actual meaning.

**Common mistakes:** A single generic "No data" message used for all three causes above, forcing the user to figure out which situation they're in; an empty state with no action at all when a clear one exists (a list screen's empty state should almost always offer the "add new" action, not just describe the absence); a guilt-tripping or overly cute tone (`BRAND_GUIDELINES.md`).

**Design rules:** Illustration is optional and secondary; text and action are mandatory and primary. Never let decoration outweigh clarity here.

**Reusable patterns:** Applies identically across List/Table Page, Search Results, Dashboard panels, and Notifications — one component, parameterized by cause and copy, not reinvented per screen.

---

## 31. Loading State

**Purpose:** Communicate that the system is working, honestly and proportionately to the wait.

**Users:** Every role, both products.

**When to use:** Any moment between a user action/navigation and content being ready to show.

**When NOT to use:** For truly instant (<100ms) operations, no loading state is needed at all — introducing one would itself be a flicker/distraction (Design Principle 8 applies to loading indicators too: don't animate what doesn't need explaining).

**Layout:** See `MOTION.md` for the skeleton-vs-spinner decision logic in full.
```
Skeleton (structured content)         Spinner (short/indeterminate)
+------------------------+            +------------------+
| ▓▓▓▓▓▓▓  ▓▓▓            |            |     [Save ⟳]      |
| ▓▓▓▓▓▓▓▓▓▓▓  ▓▓▓        |            +------------------+
| ▓▓▓▓▓  ▓▓▓▓▓▓▓          |
+------------------------+
```

**Information hierarchy:** A skeleton mirrors the *shape* of the content that's coming (a table skeleton has row-shaped bars, a card skeleton has card-shaped blocks) — this alone communicates "how much is coming" without any text needed.

**Components used:** Skeleton blocks (subtle, slow shimmer per `MOTION.md`), inline spinners (button-level), progress bars (for operations where percentage/step-count is knowable).

**User workflow:** Action triggers load → skeleton/spinner appears immediately (no delay before showing it — a load state that itself takes 200ms to appear defeats the purpose) → content replaces it once ready.

**UX rules:** Never show a loading state for less time than it would take a user to consciously perceive it (roughly <150ms) — a flash of skeleton-then-content is worse than no loading state at all for very fast responses; delay showing the skeleton by ~150-200ms so genuinely fast responses never flash one.

**Accessibility requirements:** Loading regions are marked `aria-busy="true"` while loading, with a polite `aria-live` announcement once content is ready — a screen-reader user shouldn't be left wondering if anything is happening.

**Responsive behavior:** Skeleton shapes match their breakpoint's actual layout (a skeleton for the mobile card-list transformation of a table looks like stacked cards, not like a wide desktop table skeleton squeezed into a phone width).

**Common mistakes:** A generic centered spinner used for a full structured page load (gives the user zero information about what's coming or how much); a loading state that persists after content is actually ready (a race condition to guard against, not just a design concern); animated loading indicators that are visually louder than the content they're about to reveal.

**Design rules:** Loading states are always calmer/quieter than the content they precede — never the most visually attention-grabbing thing on screen.

**Reusable patterns:** Skeleton shape is generated from/matches each screen pattern's actual layout — Table skeleton, Card skeleton, Detail View skeleton, each modeled on its real counterpart.

---

## 32. Error State

**Purpose:** Tell the user something went wrong, honestly, and give them a way forward.

**Users:** Every role, both products.

**When to use:** Any failed request, broken data load, or system-level failure that prevents a screen from showing its intended content.

**When NOT to use:** A single failed field validation is not this pattern — that's inline form validation (`UX_PATTERNS.md`). This pattern is for page/panel-level failures.

**Layout:**
```
+------------------------------------------+
|              [Icon: alert]                  |
|      Couldn't load your products             |
|   Something went wrong on our end.           |
|         [   Retry   ]                        |
+------------------------------------------+
```

**Information hierarchy:** What failed (specific to the content, not generic) → why, in plain language, if genuinely knowable → a concrete next step (retry, go back, contact support), always present.

**Components used:** Icon (danger/warning-semantic, not decorative), heading, supporting text, primary recovery action.

**User workflow:** Encounter failure → read what happened → retry or take the offered alternative path.

**UX rules:** Distinguish network/connectivity failures from application errors where the system can tell the difference (`UX_PATTERNS.md` → Error Recovery) — "You appear to be offline" is more actionable and less alarming than a generic error for what's often a transient, self-resolving condition, especially relevant to CareFind's connectivity context (`DESIGN_VISION.md`).

**Accessibility requirements:** Error state is announced via `aria-live="assertive"` (errors are more urgent than routine content updates, which use `polite`).

**Responsive behavior:** Same structural shape at every breakpoint — this pattern's content is short enough that it doesn't need per-breakpoint redesign, only proportional scaling.

**Common mistakes:** A raw technical error message shown to the user ("TypeError: Cannot read property 'x' of undefined") instead of a translated, human-readable one; an error state with no recovery action at all, leaving the user stuck; treating every error identically regardless of whether it's retryable.

**Design rules:** Every error state offers at least one action — even if that action is just "Go back" or "Contact support," never a dead end with no way forward.

**Reusable patterns:** Shares its shape with Empty State (icon → heading → text → action) but uses danger/warning semantics instead of neutral ones, and its "why" is always about failure, never about absence.

---

## 33. Permission Denied

**Purpose:** Tell a user clearly why they can't access something, without exposing information they shouldn't have.

**Users:** Any role attempting to reach a screen/action outside their permission scope.

**When to use:** A user navigates (directly via URL, a stale link, or a role change) to a screen their current role doesn't permit.

**When NOT to use:** Don't show this for content that should be entirely invisible/unlinked to this role in the first place (`SCREEN_PATTERNS.md`-wide rule: don't show-then-block, hide what a role can't reach at all wherever navigation is under the product's own control — this pattern exists for the residual cases: direct URL access, stale bookmarks, permission changes mid-session).

**Layout:**
```
+------------------------------------------+
|              [Icon: lock]                   |
|      You don't have access to this           |
|   Contact your business owner if you         |
|   believe this is a mistake.                  |
|         [ ← Back to Dashboard ]               |
+------------------------------------------+
```

**Information hierarchy:** Clear, non-alarming statement of the restriction → a plausible next step (who to ask, where to go) → a way back to somewhere useful.

**Components used:** Icon (neutral, not danger-red — this isn't an error, it's an expected boundary), heading, supporting text, return action.

**User workflow:** Land on restricted content → understand why → navigate back to somewhere they *do* have access.

**UX rules:** Never reveal *what* the restricted content actually contains (a permission-denied screen for "Payroll" shouldn't preview payroll data before blocking it) — the message should be generic enough not to leak information, specific enough to be helpful ("You don't have access to Payroll" is fine; showing even blurred payroll figures is not).

**Accessibility requirements:** Same as Error State.

**Responsive behavior:** Same structural shape at every breakpoint, same as Error State.

**Common mistakes:** A confusing generic "404" shown for a permission issue (conflates "doesn't exist" with "you can't see this," which are different situations with different correct user responses — see 404 Page below for the distinction); revealing content and then blocking interaction with it (a "grayed out" preview of restricted data is itself a leak).

**Design rules:** Tone is neutral/informational, never alarming — this is an expected system boundary, not a failure.

**Reusable patterns:** Shares its shape with Error State and 404, distinguished by tone (neutral vs. urgent) and by *never* implying the content doesn't exist when it does (that's the 404 pattern's job, for a genuinely different situation).

---

## 34. 404 Page

**Purpose:** Tell a user clearly that what they're looking for doesn't exist (or genuinely can't be found), and get them back on track.

**Users:** Any user reaching a broken/nonexistent link.

**When to use:** A URL that doesn't correspond to any real resource — a mistyped address, a deleted record's stale link, a broken external link into the product.

**When NOT to use:** A resource that *exists* but the user can't access is Permission Denied (pattern 33), not this — conflating the two is a common and meaningfully confusing mistake, since the correct next step differs (permission denied → "ask for access"; 404 → "this genuinely isn't here, maybe it moved or was deleted").

**Layout:**
```
+------------------------------------------+
|              [Icon: compass/map]            |
|         Page not found                       |
|   The page you're looking for doesn't        |
|   exist or may have been moved.               |
|         [ ← Back to Home ]                    |
|         [   Search instead   ]                |
+------------------------------------------+
```

**Information hierarchy:** Plain statement of the situation → two concrete recovery paths (go home, or search — since a 404 is often the result of a bad link where the user's actual destination is findable another way).

**Components used:** Icon (neutral), heading, supporting text, two recovery actions (primary: go home/dashboard; secondary: search).

**User workflow:** Land on broken link → understand the page doesn't exist → either return home or search for what they were actually looking for.

**UX rules:** Offering a search action specifically (not just "go home") meaningfully improves recovery for CareFind in particular, where 404s are more likely to come from external links (a shared provider link that's since changed) where the user has a real destination in mind, just not this exact URL.

**Accessibility requirements:** Ensure the HTTP status itself is actually 404 (or equivalent) for this content, not a 200 response with "not found" text — screen readers and assistive tooling, and web crawlers/SEO, depend on the real status code, not just the visible message.

**Responsive behavior:** Same structural shape at every breakpoint.

**Common mistakes:** A generic error illustration with no real recovery action beyond "go home," ignoring that the user likely had a specific destination in mind; reusing the exact same copy/pattern as Permission Denied, confusing two genuinely different situations.

**Design rules:** Two distinct recovery actions minimum (home + search, or home + a specific likely-relevant link if context is knowable, e.g. a broken provider-profile link could suggest "search providers").

**Reusable patterns:** Shares its visual shape with Error State and Permission Denied but is semantically and functionally distinct — three related patterns for three genuinely different situations (something broke / you can't see this / this doesn't exist), never collapsed into one generic "problem screen."

---

## 36. Social Feed

**Purpose:** Let a CareFind user read, judge and act on a stream of community health content — and contribute to it — without ever losing track of *who* is speaking.

**Users:** CareFind — patients/public (reading, reacting, asking), verified professionals and businesses (posting, answering).

**When to use:** CareFind's home route, and any screen that presents a chronological/ranked stream of authored posts (a single profile's posts, Saved posts, a tag stream). Reference implementation: `apps/carefind/src/modules/social-feed/Feed.jsx`.

**When NOT to use:** A list of *records* (providers, medicines, orders) is Search Results (11) or List/Table (6) — those are scanned and compared; a feed is read. Don't mix the two shapes: a result card optimizes for comparison, a post card optimizes for reading and attribution.

**Layout:** Desktop is `AppShell`'s three-column shell; mobile is the single column plus `BottomNav` (`LAYOUTS.md` → Feed / Vertical Scroll).
```
+---------------------------------------------------------------+
| Header: [logo]  [ search pill ]              [bell] [avatar]   |
+---------+-------------------------------+-------------------+
| [+ Create]  | For you  Following  Questions … |  TRENDING     |
| Home        | ( story rail )                  |  · item       |
| Discover    | +---------------------------+   |  · item       |
| News        | | composer card             |   |               |
| Wallet      | +---------------------------+   |  SUGGESTED    |
| Saved       | +---------------------------+   |  ARTICLES     |
| Notifs      | | post card                 |   |  [tile] title |
|             | +---------------------------+   |  See all news |
| [me]        |                                 |               |
+---------+-------------------------------+-------------------+
```

**Information hierarchy:** Inside a post card, identity outranks content: avatar → name → verification badge → handle → credential chip → time, *then* the body, *then* the engagement bar. A reader decides whether to trust health advice before reading it (Design Principle 12), so the trust signal can never sit below the fold of the card or behind a tap.

**Components used:** `Card`, `Pill` (one post-kind pill per card — `text` posts get none), `Avatar`, `PostMenu` (the `⋯` overflow menu), `TealBtn`, `Empty`, `CardSkeleton`, `Toast`, `Modal` (report reasons), `AppShell` + `LeftSidebar` + `RightSidebar` + `SidebarSection`.

**User workflow:** Land → filter with the tab rail if wanted → read → react (like/comment/share) inline, or open `⋯` for the rarer actions (save, report; edit/delete on your own post) → compose from the composer card at the top, or the sidebar's Create button / mobile's centre nav button.

**UX rules:**
- **One primary action per card region.** The composer's footer carries exactly one primary button (Post), right-aligned, with the secondary attach action on the left — the same rule as Create Form (8).
- **Engagement bar grouping is fixed:** reading actions (like, comment, share) left; keeping/supporting (views, gift, save) right. The grouping never varies between post kinds, so the target a user reaches for never moves.
- **Counts live inside their action**, and a zero renders as nothing (or the verb) — never a row of "0"s.
- **Read-only means read-only.** A reader must never see an editing affordance on someone else's post (an empty caption input, an editor's frame). Any block component used in both modes hides its inputs when `readOnly`.
- **Anything shown as a snippet is stripped of markup** (`stripArticleMarkup` + `previewText`) — a sidebar or preview that leaks `**bold**`/`==highlight==`/raw block JSON is a bug, not a formatting quirk.
- **Report is a closed set of reasons in a modal**, never a free-text `window.prompt` — free text produces unmoderatable rows, and `prompt` is unstyled and blocked in some mobile browsers.
- **Share falls back to clipboard** where the Web Share API is missing (most desktop browsers), and says which one happened — a share button that silently does nothing is worse than no share button.

**Accessibility requirements:** Every icon-only control (menu trigger, gift, save, story close) has an `aria-label` naming the *action and its subject* ("Save this post", "Options for Dr. X's post"). Toggle state rides on `aria-pressed` (like, save, filter tabs, post-type chips), never on fill colour alone. The overflow menu is a real `menu`/`menuitem` structure that closes on Escape and outside click and returns focus to its trigger. Timestamps are `<time datetime>`. All engagement controls keep a ≥40px target on desktop and 44px on mobile (`ACCESSIBILITY.md`).

**Responsive behavior:** Desktop (≥1024px): three columns, main column capped at 640px for line length. Tablet (768–1023px): icon-only left rail, right sidebar drops below the main column. Mobile (<768px): single column, solid-navy brand band with the filter rail, `BottomNav`, right-sidebar content re-expressed as the inline news/live strips. Every horizontal rail (tabs, stories, news) uses `.cf-hscroll` — swipeable, no visible scrollbar track.

**Common mistakes:** Two pills on one card describing the same thing; exposing edit/delete icons permanently instead of collecting them into `⋯`; a per-card `<style>` tag (50 posts shipped 50 copies of the same CSS — hoist it to `global.css`); showing views as a button that does nothing when pressed; letting the engagement bar's icon order differ between post kinds.

**Design rules:** Flat colour only — `tealDeep` for primary, `navy` for dark surfaces, no gradients on controls or brand marks. Cards are white, `radius.lg`, one hairline border, `elevation[1]`. Lucide icons throughout, never emoji (`ICONS.md` — the one exception is genuinely expressive user content such as the gift catalogue). The system font stack (`TYPOGRAPHY.md`) — the display serif never appears on this screen.

**Reusable patterns:** `PostMenu` is reusable on any authored item (comments, reviews, news). The card header block and the grouped engagement bar are the two pieces to lift verbatim when building Profile, Saved, News and Playlist screens — they should not be re-derived per screen.

**Where this pattern is already implemented:** Feed (`modules/social-feed/Feed.jsx`), News article (`modules/news-publishing/NewsArticle.jsx` — same engagement bar), Saved posts, Public profile and Profile (same card header, same post-tile grid).

**The shared pieces — use these, never a local copy:**

| Piece | Lives in | Used by |
|---|---|---|
| Engagement bar (`.cf-eng-row` / `-group` / `-item` / `-meta`) | `styles/global.css` | Feed, News article |
| Horizontal rails (`.cf-hscroll`) | `styles/global.css` | Feed tabs, Stories, news strip, profile tabs |
| `shareOrCopy()` — Web Share with clipboard fallback | `utils/share.js` | Feed, News article |
| `PostMenu` — the `⋯` overflow menu | `modules/social-feed/PostMenu.jsx` | Feed (reusable on comments, reviews, news) |
| `PostTile` / `PostTileGrid`, `isRepost`, `withoutRepostMark`, `POST_KIND_ICON` | `modules/social-feed/postDisplay.jsx` | Public profile, Profile |
| `Stars` (display) / `StarPicker` (input) | `components/ui` | Public profile, Profile, Business profile, Drug profile, Playlists, Dashboard, Business dashboard |

A rating rendered as `'★'.repeat(n)` or a hand-built star row is a bug — every rating in the product goes through `Stars`/`StarPicker` so the icon, the colour and the screen-reader text stay identical.

---

## How these patterns relate to each other

```
Foundational shapes:
  List/Table Page ──extends──> Inventory, Pharmacy, Laboratory, Imaging, Billing
  Detail View ──extends──> Patient Profile, Provider Profile
  Create Form ──shares shape with──> Edit Form
  Modal Dialog ──minimal variant──> Confirmation Dialog
  Modal Dialog ──anchor variant──> Drawer

Universal states (apply to every pattern above):
  Empty State, Loading State, Error State, Permission Denied, 404 Page

Entry/auth sequence:
  Login → Forgot Password → Reset Password
  Login → Multi-Factor Authentication

Discovery sequence (CareFind):
  Global Search → Search Results → Provider Profile → Appointment Workflow

Community sequence (CareFind):
  Social Feed → Provider Profile → (Appointment Workflow)
  Social Feed → Detail/Article → Saved
```

When building anything new, find the closest node in this graph before inventing something new.
