# Dependency upgrades (October 2026)

Status: implemented. Both apps' `npm audit` report **0 vulnerabilities**; the shared packages too.

CI's "Security audit" step (`npm audit --audit-level=high`) had been failing in both apps, which stopped CI before the tests and the build. This page records what was upgraded, why, and what to watch for.

## What was found

| Package | Severity | Where it runs | Issue |
|---|---|---|---|
| vitest ≤4.1.10, tinypool, @vitest/mocker, vite-node | critical | developer machines and CI | file read / code execution through the test runner and its UI server |
| vite ≤6.4.3, esbuild ≤0.24.2 | high / moderate | developer machines and CI | dev-server path traversal; any website can query the dev server |
| xlsx 0.18.5 (CareFind) | high, **no fix on npm** | CareFind API server | prototype pollution and ReDoS while parsing uploaded spreadsheets |
| react-router 6.0–7.17 | moderate | users' browsers | open redirect through backslashes in links |
| uuid <11.1.1 (via exceljs, CareHub) | moderate | users' browsers (Excel export) | missing bounds check |

## What changed

| | Before | After |
|---|---|---|
| vite (both apps) | 5.4 | 7.3.7 |
| vitest, @vitest/coverage-v8 (apps and shared packages) | 2.1 | 4.1.12 |
| react-router-dom (both apps) | 6.30 | 7.18.4 |
| uuid (through exceljs) | 8.3 | ^11.1.1, forced with `overrides` in each app's `package.json` |
| xlsx (CareFind API) | 0.18.5 | removed; replaced by exceljs (`apps/carefind/api/_lib/spreadsheet.js`) |
| Node in CI | 20 (end of life since April 2026) | 22 |

Not changed: `@vitejs/plugin-react` 4.7 already supports Vite 7. Vite 8 and Vitest 5 need Node 22.12+ everywhere (including Vercel), so they are a later step.

### Behaviour that changed

* **CareFind directory import accepts `.xlsx` and `.csv` only.** Old binary `.xls` (Excel 97–2003) is refused with: "Old .xls files are not supported. In Excel, use File > Save As > Excel Workbook (.xlsx)". The file picker limit is now 5 MB, matching the server (it said 10 MB, so 5–10 MB files used to fail after upload).
* **Zip-bomb guard.** An `.xlsx` is a zip. Before decompressing, the parser reads the zip's directory and refuses more than 50 MB uncompressed, more than 2,000 entries, ZIP64 or a forged size (HTTP 413). The 5 MB upload cap alone did not bound what a file expands to.
* **Export file names** are restricted to letters, digits, space, `.`, `-` and `_` (they were written into the `Content-Disposition` header unescaped).

Nothing changes for users of CareHub, or for old browsers: both apps set `build.target: 'es2015'`, so Vite 7's newer default target does not apply.

### Test-runner notes (Vitest 2 → 4)

* All existing tests passed unchanged except one: since Vitest 3, `vi.restoreAllMocks()` no longer resets plain `vi.fn()` mocks, so `packages/shared-email/src/__tests__/authEmail.test.js` now calls `mockReset()` on its mock in `beforeEach`. Use `mockReset()` / `vi.resetAllMocks()` where a test relies on call counts starting at zero.

## How to install dependencies

npm 10 crashes when resolving these apps (`Cannot read properties of null (reading 'edgesOut')`, an arborist bug triggered by the `file:` links to `packages/*`). Use npm 11 to add or change dependencies:

```
npx -y npm@11 install <package>
```

The lockfile format (v3) is unchanged, so `npm ci` in CI (npm 10) reads it as before.

The app lockfiles also record the linked packages' own `node_modules`. When a shared package changes its dependencies, those entries can go stale (this is how Vitest 2 stayed in CareHub's audit after the upgrade): re-run `npm install` in the app, or remove the `../../packages/*/node_modules/*` entries from `package-lock.json` and install again.

## Verification

* CareHub: 2,545 tests, coverage run, build; `npm audit`: 0.
* CareFind: full suite, lint, `lint:undef`, build; `npm audit`: 0. New `api/_lib/__tests__/spreadsheet.test.js` covers the parser, the zip guard and the export round trip.
* Shared packages: 1,170 tests; `npm audit`: 0.

Manual checks before release: sign in, make a POS sale, export Inventory to Excel (CareHub), import a directory `.xlsx` and try an `.xls` (CareFind), open a deep link, reload while offline.
