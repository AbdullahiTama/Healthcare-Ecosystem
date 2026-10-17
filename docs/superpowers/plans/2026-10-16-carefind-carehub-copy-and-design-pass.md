# CareFind and CareHub: copy humanisation, dash removal and design pass

Working plan and outcome record.

## Phase A: inventory and audit

**Tooling:** `scripts/audit-ui-copy.mjs`. Babel AST walk over 8 roots
(660 files). Only strings that can reach a rendered surface are inspected:
JSX text nodes, a curated allowlist of copy attributes, copy-shaped object
keys, and toast/error call arguments. Identifiers, routes, CSS values, query
keys, Supabase columns, personal names, reference formats and SQL never reach
the checker.

```
node scripts/audit-ui-copy.mjs                 # text report, exit 1 on any dash
node scripts/audit-ui-copy.mjs --ai --hyphens   # advisory findings too
node scripts/audit-ui-copy.mjs --format=json    # machine readable
node scripts/audit-ui-copy.mjs --app=carefind  # one app
node scripts/audit-ui-copy.mjs --include-tests  # widen the scope
```

It fails loudly (exit 2) if any file cannot be parsed, because an unparsed file
is an unaudited file. This caught three real syntax breaks during the pass.

### Baseline and result

| Finding | Before | After |
|---|---|---|
| DASH (must be zero) | 372 | 0 |
| HYPHEN (advisory) | 194 | 0 |
| AI patterns (advisory) | 19 | 0 |
| Parse errors | 0 | 0 |

### Route maps

CareFind: 58 routes, 51 distinct screens, entry `src/main.jsx`.
CareHub: 12 top level routes plus 40 nested `/dashboard/*` routes and 15 state
driven admin panels, entry `src/App.jsx`.

### Findings beyond the brief

1. **Mojibake, 6 sites.** `x` (U+00D7) was stored as UTF-8 bytes `C3 97`
   decoded as CP1252, where `0x97` is an em dash. Clear-search buttons rendered
   `A-o`, not a cross. Found by the audit, not by reading.
2. **False offer claim.** "Get started free" appeared on five CareHub landing
   CTAs. `planLimits.js` has no free plan; the cheapest tier is Basic at
   N60,000 a year, and `PricingSection.jsx` even carries a comment saying
   "no trial logic exists in the payment flow".
3. **Engineering notes in production copy.** The CareHub admin console showed
   "One trend only, Plausible restraint. No decorative charts.", "Calculated
   server-side on payment webhook via calculate_agent_earnings", a Postgres
   error code (42501), a spec section reference, and SQL column names.
4. **RLS and schema documentation shown to agents.** `AgentLogin.jsx` told
   agents it "Checks agents.email / password_hash via crypt. RLS own-record +
   service-role scoping."
5. **`PAGE_TITLES` in `BusinessDashboard.jsx` is dead**, as is
   `const Inventory = lazy(...)`. `utils/modulePrefetch.js` still prefetches the
   old inventory path. `modules/adr/AdrNav.js` is orphaned.
6. **CareFind has 34 unreachable files** including `PostModalRoute`,
   `PostComposer` and `BackgroundRoutes`, wired only to their own tests.

## Phase B: copy and dash cleanup

372 dash occurrences removed across roughly 90 files. Notable rewrites:

| Before | After |
|---|---|
| Illustrative sample of CareFind content, not live data | This is a sample of CareFind content, not live data. |
| Request sent, we'll notify you once the business confirms | Request sent. We will let you know when the business confirms. |
| Newborn (0-28 days) | Newborn (0 to 28 days) |
| Mild, did not interfere with daily activities | Mild. It did not interfere with daily activities. |
| Combination review via reference-uniqueness | Retrying is safe. Each retry is recorded in the audit log. |
| Team, Agents | Team: Agents |
| E-commerce (nav label, 23 sites) | Online Store |
| Top-up received | Deposit received |
| Get started free | Start your account |
| Get started (3 sites) | Create an account / Sign up |
| All clear, no pending issues | Nothing needs your attention |

Conventions introduced:

- **Operational tables** say "Not set". **Clinical and regulatory screens** say
  "Not recorded", because there the absence of a value is itself the finding.
- `packages/design-system/src/components/ui/DataTable.jsx` exports
  `NOT_SET` so both apps share one empty-cell string.
- The printed consultation sheet drops a row entirely when the value is missing
  instead of printing a glyph, using an exported `EMPTY` sentinel.

## Phase C: shared design foundation

- `Button.jsx`: added a `:focus-visible` ring, moved hover and active feedback
  out of `onMouseEnter`/`onMouseLeave` and into the injected stylesheet (the old
  handlers wrote inline styles, so a hover colour survived a re-render and
  nothing happened for keyboard or touch), and added a
  `prefers-reduced-motion` branch.
- Button metrics tightened: heights 44/48 to 40/46, radius now follows size
  (6/6/10) so dense operational controls stop reading as padded chips.
  `theme.button` was updated to match so the token and the component agree.
- `DataTable.jsx`: shared `NOT_SET`, and the page range reads "1 to 2 of 3"
  rather than using an en dash.
- Landing preview cards: radius 20 to 10, and the pill badge became a flat
  sentence-case status marker.

## Phase D: screen level design

Partially complete. See the handover section for what is left.

## Phase E: validation

- `apps/carehub`: 1507 tests. 7 failed on copy assertions, all updated, all pass.
- `apps/carefind`: see handover, the suite is slow (PGlite) and exceeded the
  command timeout twice.
- `npm run lint` and `npm run lint:undef`: clean in both apps.
- `npm run build`: both apps build.
- `node scripts/audit-ui-copy.mjs`: exit 0.

## Protected

Not touched: routes and redirects, auth and onboarding, RLS and queries,
payment and settlement logic, wallet and withdrawal rules, inventory and
reconciliation maths, ADR and ICSR validation, PV Tracker privacy masking,
notification delivery, receipts, audit logs. User generated content is
preserved verbatim; only the surrounding first party copy changes.
