# Layouts

Page-level structural templates. Per Design Principle 7, every new screen should be built from one of these, not invented fresh — this is the GitHub-derived lesson (`DESIGN_PRINCIPLES.md`): a small number of reused shapes makes an enormous product surface feel navigable.

## CareHub layout templates

### 1. Sidebar + Single Content Panel
The default CareHub shape — used for most list/table pages, dashboards, and settings screens.
```
+--------+------------------------------------------+
| Side   | Page Header (title, primary action)       |
| bar    +--------------------------------------------+
|        | Toolbar (search, filters, view toggle)    |
|        +--------------------------------------------+
|        |                                            |
|        |              Content                       |
|        |                                            |
+--------+--------------------------------------------+
```
**Why it works:** one clear content focus, consistent header/toolbar placement regardless of what module you're in — matches Figma's "controls at fixed edges" lesson from `DESIGN_PRINCIPLES.md`.

### 2. Sidebar + List/Detail Split
Used when browsing a collection and inspecting one item without losing place in the list — patient lists, order queues, message threads.
```
+--------+----------------+-----------------------------+
| Side   | List (search,  | Detail panel                 |
| bar    | filter, rows)  | (selected item's full info,  |
|        |                |  actions)                     |
|        | [Item A] <-sel |                               |
|        | [Item B]       |                               |
|        | [Item C]       |                               |
+--------+----------------+-----------------------------+
```
**Why it works:** avoids the cost of a full page navigation for what's usually a quick "check this, then check the next one" workflow (the Orders screen's approval queue, task submissions review).
**Collapse (Laptop/Tablet):** detail panel becomes a full-width overlay/push on selection, list is hidden until back is pressed — one panel at a time, not both shrunk (`RESPONSIVENESS.md`).

### 3. Full-Width Workspace
Used for POS, a doctor's consultation screen, or other single-task, high-focus workflows where sidebar navigation would be a distraction mid-task.
```
+------------------------------------------------------+
| Minimal header (context, exit)                        |
+------------------------------------------------------+
|                                                        |
|              Full-width task content                  |
|         (may itself be multi-panel internally)         |
|                                                        |
+------------------------------------------------------+
| Action bar (primary actions, always visible)           |
+------------------------------------------------------+
```
**Why it works:** removes navigation temptation during a task the user needs to complete in one sitting without distraction (mirrors CareHub's existing `Doctor.jsx` consultation flow, which already drops the sidebar during active consultation).

### 4. Dashboard Grid
Used for the module-level landing screen (business dashboard home, reception overview).
```
+--------+------------------------------------------+
| Side   | Page Header                               |
| bar    +--------------------------------------------+
|        | [Stat] [Stat] [Stat] [Stat]  <- auto-fit   |
|        +--------------------------------------------+
|        | Primary panel (recent activity / queue)    |
|        +--------------------------------------------+
|        | Secondary panel                            |
+--------+--------------------------------------------+
```
**Why it works:** stat cards answer "how am I doing right now" in under a second, primary panel answers "what do I need to do next" — the two questions every dashboard actually needs to answer, in priority order, not a wall of undifferentiated widgets (the generic-dashboard Anti-Pattern this system explicitly rejects).

## CareFind layout templates

### 1. Feed / Vertical Scroll
The default CareFind shape — home feed, search results, list-style content.
```
Mobile (<768px)                       Desktop (≥1024px)
+------------------------+   +---------+---------------+----------+
| Header (logo, search)  |   | Header (logo, search, bell, avatar) |
+------------------------+   +---------+---------------+----------+
| [Card]                 |   | Create  | [Card]        | Trending |
| [Card]                 |   | Nav     | [Card]        | Articles |
| [Card]                 |   | ...     | [Card]        |          |
| ...                    |   | [me]    |               |          |
+------------------------+   +---------+---------------+----------+
| Bottom Nav             |
+------------------------+
```
**Why it works:** matches the mental model of every mobile discovery product a user already knows — no relearning required, which matters enormously for a first-time, possibly anxious user (Design Principle 12).

**Desktop composition** (`apps/carefind/src/components/layout/AppShell.jsx`): a 64px sticky header, a 240px persistent left nav (72px icon-only rail on tablet), the reading column capped at 640px, and a 320px sticky contextual sidebar — the whole row capped at 1320px and centred. The cap is the point: a wide monitor should get *more context* (a second and third column), not a longer line of body text. The right sidebar renders only sections that have real data and never issues its own queries — it is fed by what the page already fetched. Below 1024px the sidebar moves under the main column; below 768px the shell steps aside entirely and the page renders its own mobile chrome.

### 2. Search → Results → Detail (progressive)
```
Screen 1: Search        Screen 2: Results       Screen 3: Detail
+----------------+      +----------------+      +----------------+
| Search input   | -->  | Filter chips   | -->  | Hero/photo     |
|                |      | [Result card]  |      | Key info       |
| Recent/        |      | [Result card]  |      | Reviews        |
| Suggested      |      | [Result card]  |      | Action (Book/  |
+----------------+      +----------------+      | Contact)       |
                                                 +----------------+
```
**Why it works:** one decision at a time, matching Notion/Apple's progressive-disclosure lesson — never confronting an anxious user with search box + filters + results + map simultaneously on a small screen.

### 3. Profile Detail (Provider/Business)
```
+------------------------------------------+
| Hero (photo, name, verification badge)    |
+------------------------------------------+
| Key facts (specialty, location, hours)    |
+------------------------------------------+
| Primary action (Book / Contact / Claim)   |
+------------------------------------------+
| Tabs: About | Reviews | Services          |
+------------------------------------------+
| Tab content                               |
+------------------------------------------+
```
**Why it works:** trust signal (verification) and the primary action are both above the fold, before any secondary content — a decision made under Design Principle 12 (trust is a design output).

## Cross-cutting layout rules

- **One layout template per screen.** A screen that seems to need two templates glued together is a sign it should be split into two screens or a wizard (`SCREEN_PATTERNS.md` → Multi-Step Wizard).
- **Headers are always the same height and always in the same position** within a given template — this is what makes a large product surface feel coherent (the GitHub lesson).
- **The primary action lives in a fixed, predictable place** per template (top-right of page header for CareHub list pages; bottom-anchored or hero-adjacent for CareFind) — never floating inconsistently screen to screen.
