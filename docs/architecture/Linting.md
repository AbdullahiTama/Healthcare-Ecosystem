# Linting

One shared ESLint 8 config at the repo root (`.eslintrc.json`) is used by both apps. Each app runs it with `npm run lint` (`eslint src api --ext .js,.jsx --resolve-plugins-relative-to .`), and CI runs that as the first step of "Test & build". A failing Lint step **skips every step behind it** (audit, unit tests, coverage, build), so a red lint hides everything else.

## 1. What was wrong

The Lint step was red on `main` for both apps (CareFind about 1,870 errors, CareHub about 1,750), which meant CI had not run the unit tests or the build for a long time. Most of the errors were configuration, not code:

| Cause | Errors | Fix |
|---|---|---|
| Components used only in JSX (`<Card />`) were reported by `no-unused-vars`, because core ESLint does not understand JSX usage | about 1,480 in CareFind, about 1,300 in CareHub | `eslint-plugin-react` with `react/jsx-uses-vars` and `react/jsx-uses-react` |
| `eqeqeq` rejected `x == null`, the intentional "null or undefined" check | 199 (all of them were that idiom) | `eqeqeq: ["error", "always", { "null": "ignore" }]` |
| `src/test/*` helpers use vitest globals (`vi`, `beforeAll`...) | 10 | an `overrides` entry that declares them (test files themselves stay ignored) |
| Real findings: 17 undefined identifiers in 7 files (section 4), plus about 45 mechanical ones (`prefer-const`, duplicate imports, stray semicolons, useless escapes, a no-op self-assignment, a pointless `try/catch`) | about 60 | fixed in code |
| Legacy unused imports, variables and parameters | about 600 | **now warnings**, see section 3 |

## 2. How it is wired

- **Plugin resolution.** The config sits at the repo root, which has no `node_modules`. ESLint 8 looks for plugins next to the config file, so the lint script passes `--resolve-plugins-relative-to .` and each app lists `eslint-plugin-react` as a devDependency. The flag goes away when the repo moves to ESLint 9 flat config (ESLint 8 is end-of-life; that migration is a separate job).
- **Test files** (`*.test.js`, `*.test.jsx`) are in `ignorePatterns`, so they are not linted. Shared test helpers under `src/test/` are.
- **Rules that matter most.** `no-undef` is an error and must stay one: it finds identifiers that do not exist, which are `ReferenceError`s waiting for the code path to run (section 4). `no-var`, `prefer-const`, `no-duplicate-imports` and `eqeqeq` are errors.

## 3. Legacy debt: `no-unused-vars` is a warning

About 600 unused imports, locals and parameters remain (CareFind 301, CareHub 304), plus about 140 `no-empty` warnings. They are printed on every `npm run lint` but do not fail CI. They were not deleted in the config change because:

- removing dead code in about 200 files is a large diff for a change that is about tooling;
- some of them hide a missing feature rather than dead code (a total that is computed and never shown; a function that was imported and never called; see section 5), and deleting them silently throws that signal away.

Burn-down: work through one module at a time, delete what is dead, **use** what was meant to be used, prefix a deliberately unused argument with `_` (already allowed), and flip `no-unused-vars` back to `"error"` when the count reaches zero. To stop the number growing in the meantime, a ratchet works: `eslint ... --max-warnings <current count>` in the lint script, lowered as the debt falls.

## 4. Real bugs the linter found (all fixed)

Lint could not be made green honestly without fixing these; they had been hidden behind the other errors. Each was traced through git history and read against its callers.

| Where | What happened | Fix |
|---|---|---|
| CareHub `Clients.jsx` | Choosing a CSV in "Upload CSV" rendered the preview, which read `importing` and `warningBg`, neither defined. React threw during render and the whole app went blank. `importing` was dropped by the React Query migration (52de914). | `importing = createManyClients.isPending`; `warningBg` from the theme. |
| CareHub `LiveActivity.jsx` | "Log It" called a bare `logActivity(...)`. Its import was lost in 071e655 and the repository replacement was missed in 0eaad02, so **logging a field visit has failed every time since 2026-08-22** ("Could not log activity: logActivity is not defined"). | `liveActivityRepository.logActivity(...)`. Worth checking `field_activities` for a gap from about that date. |
| CareFind `PublicProfile.jsx` | After a successful CareCoin subscription (already charged), `confirmSubscribe` called `refreshAccess()`, deleted by the React Query migration (c5dc036). It threw before the creator notification and the success toast, and the button did not change, which invites a second click and a second charge. Cancelling auto-renew skipped its toast the same way. | Invalidate `keys.subscriptionAccess`, as the consultation handlers beside it do. |
| CareFind `PlaylistCreate.jsx` | `supabase` was not imported (removed by 0eaad02), so attaching media threw. | Import restored. **This alone does not make the builder work**, see section 5. |
| CareFind `business-discovery/index.js` | `export { default as X } from` creates no local binding, so the default-export object threw on import. Nothing imports the barrel today. | Import, then export. |
| CareFind `PostComposer.jsx` | `mentionMatch` was out of scope in a timer callback. The component is not mounted anywhere. | The write-only ref now uses `mentionQuery.length + 1`, the same value. |
| CareHub `AdminReferralPanels.jsx` | `gray600` not destructured from the theme. The panel is not mounted anywhere. | Added to the destructure. |

Regression tests: `PublicProfile.subscribe.test.jsx`, `Clients.import.test.jsx`, `LiveActivity.log.test.jsx` and `business-discovery/index.test.js`. Each was shown to fail with the fix reverted. For the unmounted components, `no-undef` in CI is the guard.

## 5. Found and not fixed (separate changes)

- **`PlaylistCreate.jsx` still cannot add a part.** The repository seam (0eaad02) changed the return shapes but not the callers: `insertPart` returns the bare row while the caller destructures `{ data, error }` (so `data` is `undefined`, an `undefined` part is appended and the next render throws), and `updatePart` returns nothing while the caller destructures `{ error }` (throws after the update has succeeded). The repository throws on error, so the `insErr`/`upErr2` branches are dead. `addPart` has no `try/catch`, so a failure leaves the button on "Adding…". Fix: `const data = await insertPart(...)`, `await updatePart(...)`, and a `try/catch` that resets `addingPart`.
- **`PublicProfile.jsx` lost the card-payment settlement for consultations** in the same React Query migration: `sessionStorage.setItem('cf_consult_pending', ...)` has no reader anywhere, and `settleConsultationCardPayment` is imported and never called. A consultation paid by card is not settled when the user returns.
- **Double-charge exposure on subscribe.** The subscription RPC has no "already active" guard; a second call charges again and stacks another 30 days. The fix above makes the button flip promptly, but the server should refuse a duplicate.
- **Dead code**, reachable by nothing: `PostComposer.jsx` (the real composer is inline in `Feed.jsx`), four panels in `AdminReferralPanels.jsx`, the `business-discovery/index.js` barrel, and the legacy `logActivity` in CareHub `services/supabase.js`. Delete or wire up.
- `cancelAutoRenew` returns `{ ok, error }` and the caller ignores it, so the "Auto-renew turned off" toast shows even when the update failed.
- Five `// eslint-disable react-hooks/exhaustive-deps` comments referred to a plugin that is not installed, so they did nothing and were removed. They mark effects whose dependency arrays are deliberately incomplete (CareFind `Profile`, `ArticleEditor`, `PostPage`; CareHub `DashboardHome`, `FacilityPicker`). If `eslint-plugin-react-hooks` is added later, those five need a fresh look.

## 6. What this unmasked: the security audit step is red

"Test & build" runs `npm audit --audit-level=high` straight after Lint, so while Lint failed the audit **never ran**. With Lint green it runs for the first time in a long while and fails in both apps (CareFind 13 findings: 4 high, 3 critical; CareHub 12: 4 high, 3 critical). None of it comes from this change (`eslint-plugin-react`'s tree has no advisories). Until it is dealt with, the audit step keeps the later steps (unit tests, coverage, build) from running in CI, even though they pass locally.

| Package | Where | Severity | Fix |
|---|---|---|---|
| `xlsx` 0.18.5 | **CareFind runtime dependency**, used by `api/_handlers/excel-import.js` (any signed-in user can POST a workbook that the server parses with `XLSX.read`) and the business-directory import/export | high: prototype pollution (CVE-2023-30533) and ReDoS (CVE-2024-22363) | none on npm: SheetJS publishes fixed versions (0.19.3 / 0.20.2 and later) only from its own CDN. Install the CDN tarball, or replace the library, and restrict who may call the endpoint. |
| `vitest`, `@vitest/coverage-v8`, `tinypool`, `vite` | dev tooling in both apps (the test runner and bundler; not shipped to users) | critical / high | major upgrades (vitest 5, vite 8), so a planned migration, not a drive-by |
| `brace-expansion`, `source-map-js` | transitive dev dependencies | high | `npm audit fix` (no breaking change) |
| `undici` | CareHub, transitive | high | `npm audit fix` (no breaking change) |

Options for CI, to be decided by the owner (none is done here, because they change what the pipeline enforces): (1) fix the findings (`npm audit fix` clears three at no cost; `xlsx` and the vitest/vite majors need real work); (2) move the audit to the end of the job or to its own job, so tests and the build always run and the audit is still reported; (3) audit production dependencies only (`--omit=dev`), which still fails on `xlsx` until that is fixed.

