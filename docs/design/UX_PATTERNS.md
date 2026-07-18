# UX Patterns

Behavioral standards — how the system should behave, not just look. Every recommendation here exists to improve productivity or reduce cognitive load (per the brief's explicit framing), and each is written as a rule you can check an implementation against.

## Search

- **Search is always visible or one tap away**, never buried in a menu (`NAVIGATION.md`, `COMPONENT_LIBRARY.md`).
- **Debounced, not on-submit**, for in-app search (results update ~250–300ms after the user stops typing) — CareFind's provider search and CareHub's table/list search both benefit from this; global "press Enter to search" is reserved for search experiences that hit an expensive/paginated backend query, not local filtering.
- **Recent and suggested searches** shown on an empty search field (CareFind) — reduces the blank-page problem for a first-time or returning user.
- **Search always shows what it searched.** A results screen states the query and result count ("14 pharmacies near you") — the user should never have to scroll back up to remember what they searched for.

## Filtering

- **Filters are additive and visible.** Active filters show as removable chips, not hidden inside a panel the user has to reopen to check what's applied.
- **Filter state persists** within a session (returning to a list after viewing a detail keeps the filters the user set) — losing filter state on back-navigation is a common, punishing failure mode.
- **A "Clear all" control** is always available once any filter is active.
- **Filter panels never block the result count from updating live** where feasible (desktop) — on mobile's bottom-sheet filter pattern, an "Apply" action confirms the change explicitly instead (touch contexts benefit from an explicit commit step, since live-updating a full-screen sheet while still selecting is disorienting).

## Sorting

- **One active sort at a time**, shown clearly (column header arrow indicator in tables, a labeled sort control in card lists) — multi-level sort is a power-user feature reserved for CareHub's more advanced table contexts, never the default expectation.
- **Sensible default sort** per screen (most recent first for activity/logs, alphabetical for reference lists, relevance for search results) — never an arbitrary database-insertion-order default.

## Data Entry

- **Progressive disclosure for complex forms** (Design Principle 6) — show required fields first, reveal optional/advanced fields behind a clearly-labeled expander, not all at once.
- **Smart defaults** wherever a sensible one exists (today's date on a new record, the logged-in user's business pre-selected) — every field defaulted correctly is one less decision for the user.
- **Inline creation** for common dependent lookups (e.g., "can't find this product? + Add new" inline in a search-select) rather than forcing a context switch to a different screen and back.
- **Multi-step forms use a wizard pattern** (see `SCREEN_PATTERNS.md` → Multi-Step Wizard) once a form exceeds ~7-8 fields or spans genuinely distinct stages (e.g., patient intake: personal info → medical history → insurance) — a single giant form is a named Anti-Pattern.

## Validation

- **Validate on blur, not on keystroke**, for the field currently being edited — flagging an email as "invalid" after the second character is typed is hostile, not helpful.
- **Validate on submit** for the form as a whole, scrolling/focusing to the first error.
- **Errors are specific, actionable, and adjacent to their field** — "Quantity must be greater than 0," not "Invalid input" and not a generic banner disconnected from the field it refers to.
- **Never clear a field's contents because it errored.** The user's input stays exactly as they left it; only the error state changes.

## Saving

- **Explicit save for consequential actions** (creating a patient record, submitting a sale) — a visible, clearly-labeled Save/Submit action, with a loading state while the request is in flight and clear success/error feedback after.
- **Auto-save for low-stakes, in-progress work** where it genuinely helps (a long-form clinical note being drafted, a multi-step wizard's earlier steps) — always paired with a visible, honest "Saved" / "Saving…" indicator so the user isn't left guessing whether their work is safe. Auto-save must never be silent.
- **Never auto-save a destructive or financial action** (a sale, a stock adjustment, a withdrawal approval) — these always require an explicit, deliberate submit.

## Undo

- **Reversible actions get undo, not a confirmation dialog.** Deleting a draft, archiving an item, dismissing a notification — these are better served by a brief "Undone" toast with an Undo action than by an "Are you sure?" dialog that trains users to click through dialogs mindlessly (Design Principle 9).
- **Irreversible actions get confirmation, not undo** (see below) — the two patterns are deliberately not interchangeable.
- **Undo windows are generous but bounded** (typically 5–8 seconds via a toast action) — long enough to catch a mistake, short enough that the system can commit the action for real shortly after.

## Confirmation for irreversible actions

- **Reserved for genuine, hard-to-reverse harm**: permanently deleting a patient record, refunding a completed sale, removing a staff member's access. A confirmation dialog states plainly *what* will happen and *that it cannot be undone* — never a generic "Are you sure?" with no specifics.
- **The destructive action itself is visually distinct** (danger-red button) and is never the dialog's default-focused/pre-selected button — Cancel or a neutral action is the default so an accidental Enter-key press doesn't confirm a destructive action.

## Bulk Actions

- **Row/card selection via checkbox**, appearing on hover (desktop) or always-visible in "select mode" (mobile, entered via a long-press or an explicit "Select" toggle).
- **A contextual action bar appears once ≥1 item is selected**, showing available bulk actions and a live count ("3 selected") — it replaces or overlays the toolbar rather than requiring the user to scroll to find a separate bulk-action control.
- **Bulk destructive actions always get confirmation**, scaled to the count ("Delete 12 items? This cannot be undone.").

## Notifications (in-app)

- **Toasts for transient, non-critical confirmation** ("Saved," "Product added") — auto-dismiss after ~4 seconds, don't require interaction.
- **Persistent notification center for anything the user needs to act on later** (a pending approval, a message) — never rely on a toast alone for something actionable, since toasts disappear and are easy to miss.
- **Notification badges reflect genuinely unread/unactioned counts**, never a vanity number — a badge that's inaccurate even once teaches the user to ignore it permanently.

## Error Recovery

- **Every error state offers a next step**, not just an explanation. "Couldn't load your products — Retry" beats "An error occurred."
- **Network/connectivity errors are distinguished from application errors** where possible — especially important for CareFind's lower-connectivity contexts (`DESIGN_VISION.md`) — "You're offline, we'll retry automatically" is a different, more reassuring message than a generic failure.
- **Partial failures are reported precisely** (e.g., a bulk import: "18 of 20 rows imported. 2 failed — see details.") rather than an all-or-nothing success/failure binary that hides useful information.

## Loading & Performance Feedback

- **Skeleton screens for structured content**, spinners for button-level/short waits (`MOTION.md`).
- **Never a blank white screen during load** — even a minimal skeleton communicates "something is happening" better than nothing.
- **Long-running operations show progress, not just a spinner**, when the system can know how long something will take (a bulk import, a report generation) — a percentage or step-count beats an indeterminate spinner for anything expected to take more than ~3 seconds.
- **Optimistic UI where it's safe** (e.g., a "like" toggling instantly before server confirmation) — reserved for low-stakes, easily-reversible actions; never used for financial or clinical data changes, which wait for real confirmation.

## Keyboard Shortcuts

See `NAVIGATION.md` for the CareHub shortcut system. Cross-cutting rule: every shortcut is discoverable (a `?` help overlay, or shown in a tooltip/menu next to the action it triggers) — a shortcut that only power users who read documentation will ever find isn't earning its complexity cost.

## Accessibility

See `ACCESSIBILITY.md` for the full standard — referenced here because every pattern above must be built accessibly by default (keyboard-operable filters, screen-reader-announced toasts, focus management on bulk-action bars appearing/disappearing), not accessible as a separate pass.
