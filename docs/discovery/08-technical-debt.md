# 08 — Technical Debt / Code Quality Audit

Organized by category as requested. For a severity-tiered (Critical/High/Medium/Low) version of largely the same findings with effort and risk estimates and a suggested execution order, see `architecture/Technical-Debt.md` — that document and this one are two views of the same underlying findings, cross-referenced throughout.

## Dead Code

| Item | Why it's a problem | Risk | Suggested solution | Priority |
|---|---|---|---|---|
| CareFind's `App.jsx` — a full, unused second search implementation | Confuses anyone searching the codebase for "where search actually lives"; duplicated logic drifts silently since it's never exercised | Low | Delete | Low |
| `lib/supabase.js`'s `searchClients` | Written, never called — `Clients.jsx` reimplements the same search client-side instead | Low | Delete, or wire it in once pagination makes client-side search infeasible | Low |
| Lab.jsx's `getLabResults` | Defined, never called by anything including the file it's in — submitted lab results are write-only | Moderate — indicates a "view results" feature was planned and abandoned | Build the missing read path or remove the dead function | Medium |
| `components/ui/index.jsx`'s `OfflineBanner` | Unused, and would crash on mount (`require()` inside a Vite/ESM bundle) — a landmine for the next engineer who wires it in | Low today, **High** the moment someone uses it | Fix the `require()` call or delete | Medium |
| CareHub's `lib/reviewAI.js` — 0 bytes | A feature CareFind fully built exists as an empty stub in the sibling product | Low | Product decision needed: build it out or remove the dead file | Low |

## Duplicate Code

| Item | Why it's a problem | Risk | Suggested solution | Priority |
|---|---|---|---|---|
| `readAuth()` reimplemented identically in 5 CareHub files (`NotificationBell`, `Messages`, `Stock`, `Orders`, `LiveActivity`) | Bypasses the one real `AuthContext`; any future change to the cached-auth shape must be replicated in 5 places by hand | Moderate | Extract to one shared helper, or route all 5 through `useAuth()` | **High — mechanical, cheap, fixes 5 files at once** |
| Three hospital pages (Doctor/Lab/Imaging) each hardcode Supabase credentials and a private `sbFetch` | Key rotation requires editing 5+ files; `getPatientMessages`/`addPatientMessage` copy-pasted 3× with drift risk | High | Fold into `lib/supabase.js` | High |
| Debt reconciliation logic written independently in `POS.jsx` and `Purchases.jsx` | The two can silently drift on what "matching debt" means | Moderate | One shared `reconcileDebtBySource()` function | Medium |
| Four CareFind media components (VideoRecorder/VideoUploader/VoiceRecorder/SlideUploader) reimplement the same upload/error plumbing | Maintainability drag, not correctness | Low–Moderate | Extract a shared `useMediaUpload(bucket, prefix)` hook | Low |
| CareFind's `VisualCard.jsx` reinvents `Logo.jsx`'s mark instead of importing it | The one component built specifically to prevent logo drift is bypassed by another file in the same codebase | Low | Replace with `<Logo markOnly/>` | Low |
| CareHub's CareFind-visibility toggle implemented independently in `Inventory.jsx` and `CareFind.jsx` | Same boolean field, two UIs, no shared source | Low | Consolidate into one owner | Low |

## Large Components

| Item | Size | Why it's a problem | Priority |
|---|---|---|---|
| CareFind `AdminPanel.jsx` | 1,868 lines | Largest file in either product; manages ~7 distinct concerns (verification, claims, reports, transactions, tasks, two admin rosters) in one component with no decomposition | Medium |
| CareFind `Feed.jsx` | 1,823 lines | The app's home screen and largest content surface, no sub-component extraction confirmed | Medium |
| CareHub `LiveActivity.jsx` | 1,226 lines | Dynamic field config + activity logging + GPS/audio capture + live feed + CSV export, all in one file | Medium |
| CareHub `Inventory.jsx` | 706 lines | Page + 2 modal components + 3 inline modal blocks in one file | Low |
| Every CareHub/CareFind page component | — | **No page in either product decomposes into separate component files** — this is the norm, not the exception, across ~78 page files read this engagement. A handful of pages (e.g. CareHub's `Inventory.jsx`) do define in-file sub-components (`ProductModal`, `RestockModal`), so decomposition-as-a-concept isn't entirely absent — but nothing is ever extracted to its own file for reuse, so the maintainability problem (large files, no reuse across pages) stands as described | Low individually, **High cumulatively** |

## Poor Folder Organization

| Item | Why it's a problem | Priority |
|---|---|---|
| CareFind has no `pages/`, `components/`, or `lib/`-for-everything structure — ~45 files flat in `src/` | No discoverability convention; a new engineer cannot predict where a given screen or utility lives | Medium |
| CareHub's enterprise vertical (6 files) sits flat alongside generic pages instead of in its own subfolder, unlike the hospital vertical which does have one | Inconsistent pattern for "how do I organize a new business-type vertical" | Low |
| No shared code exists between the two products despite being one "ecosystem" | Anything genuinely reusable (formatting helpers, an eventual design system) currently can't be shared without duplicating it | Medium |

## Naming Inconsistencies

| Item | Why it's a problem | Priority |
|---|---|---|
| CareHub's `admin_team` vs. CareFind's `admin_teams` + `admin_users` | Near-identical names for what are probably (but not confirmed) entirely separate concepts, with no shared convention | Low |
| `products.cat` vs. `products.category` used interchangeably via `\|\|` fallbacks throughout Inventory | Suggests an unfinished field rename | Low |
| CareHub function style: arrow functions in most files, `function(e){}` throughout the entire enterprise vertical | No enforced style guide; visibly signals two different authorship conventions | Low |

## Tight Coupling

| Item | Why it's a problem | Priority |
|---|---|---|
| `POS.jsx` reads `products.stock` and computes checkout around it with no enforced contract that Inventory's number is accurate | The "coupling" that should exist (a real write-back) doesn't; the UI implies a connection the data layer doesn't honor | High (this is really the C5 correctness bug — see roadmap) |
| CareFind's `products` marketplace columns depend on CareHub populating fields CareHub's own UI has no way to set | Two products coupled through a shared table with no formal contract | Medium |
| The `consultations` table name collision couples two unrelated features (clinical notes, paid bookings) through what is very likely one shared physical table — now that both products are confirmed to point at the same Postgres project/schema, "two separate tables that happen to share a name" is no longer a plausible resolution | Live-schema confirmation still needed, but treat as real, not hypothetical | **Verify immediately** |

## Performance Issues

Full detail: `architecture/Performance-Risks.md`. Summary: no pagination on ~17 of 20 CareHub list queries; all dashboard aggregation computed client-side over unbounded fetches; serial (not bulk) writes in CSV import and offline-sale sync; only one lazy-loaded route in either product (CareFind's `AdminPanel`); no query caching/dedup layer in either product.

## Security Concerns

Full detail: `architecture/Security-Risks.md`. Summary: no confirmed RLS policy for either product, and structurally impossible for CareHub specifically under its current no-session auth model (`auth.uid()` is always null on every CareHub request); plaintext CareHub passwords; a fully forgeable CareFind admin session (and an `AdminPanel.jsx` route guard that checks for the token's presence but never verifies it server-side, so it's ineffective despite existing); an admin-reset endpoint with a hardcoded fallback key whose production reachability needs direct verification; public Storage buckets; five+ independent hardcoded copies of the **anon key** across both products (a maintainability issue — the key itself being public is expected Supabase behavior, not a leak) — separately, `SUPABASE_SERVICE_ROLE_KEY` (the credential that actually matters) is handled correctly everywhere, always server-side via `process.env.*`; zero route-level access control on ~25 CareHub routes and all 29 CareFind routes.

## Missing Tests

**No test file, test runner, or test configuration was found anywhere in either repository.** Neither `package.json` lists a testing dependency. This means every finding in this document currently ships with no regression safety net — a fix for any one item carries the same "did this break something else" risk as the original bug did. **Priority: start now, scoped narrowly** (the highest-risk flows — checkout, authentication, the patient pipeline) rather than attempting broad coverage immediately; the value compounds with every subsequent change, and the cost of starting only grows the longer it's deferred.
