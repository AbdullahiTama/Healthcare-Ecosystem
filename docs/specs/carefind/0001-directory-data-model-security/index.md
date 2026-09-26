# 0001. Trusted directory data model plus security

**Date**: 2026-09-25
**Status**: In Progress

## Summary

You get one trusted place for every business so admin plus search plus field work all read the same truth. You reuse Supabase (managed Postgres database you already run) plus PostGIS (location add on that stores points and measures distance). Platform admin writes, signed in users read, proximity never proves a visit, demo rows carry a clear tag.

## Rationale

Reasoning and options: see rationale.md.

## Requirements

**User stories**:
- As an admin, I want to add plus verify plus hide a business so that reps trust what they find.
- As a rep, I want to search near me or a named area so that I find opportunities with distance plus source shown.
- As a manager, I want counts by territory plus verification state so that I plan coverage.

**Acceptance criteria**:
- **AC-1**: Admin can create a business with name plus category plus state, verify it, hide it without deleting, and see verifier plus time plus audit trail.
- **AC-2**: Admin can add plus edit plus remove a category or subcategory and forms plus search reflect it at once.
- **AC-3**: Admin can download a template, upload up to 1000 rows, see new plus possible duplicate plus invalid counts, correct before final import by re uploading corrected rows, with valid rows saved plus bad rows kept for review. Required are name plus category plus state, other fields free text in this slice.
- **AC-4**: Import flags new plus possible duplicate plus confirmed duplicate and admin can keep existing or import new or merge or skip, with slug unique blocking silent overwrites.
- **AC-5**: Typed request plus category pick plus current location or named area plus radius returns ranked nearby results with distance plus source plus verification shown, never invented.
- **AC-6**: List plus map stay in sync, marker selects list row and back, profile shows verification plus actions for call plus directions plus share to signed in users.
- **AC-7**: Filters by category plus state plus LGA plus verification plus source, sorting by nearest plus alphabetical plus verified first, export to CSV plus Excel plus PDF plus JSON with name plus category plus address plus phone plus coordinates plus distance plus verification.
- **AC-8**: RLS deny by default, platform admin writes, signed in users read active rows, logged out readers denied contact details, proximity never counts as proof, demo rows tagged, empty search says no verified result found.
- **AC-9**: Nearby RPC returns ordered by distance with paging, stats RPC returns totals plus breakdown by category plus state plus last import summary.
- **AC-10**: Every admin plus search plus import view shows loading plus error plus empty states, works on phone plus desktop with keyboard plus screen reader support, logs status plus batch plus search errors with no phone plus email plus precise GPS in log text.

## Decision

**Chosen option**: Option 1: One trusted source with PostGIS plus RLS plus browser batches

You keep the existing directory shape, add geography plus trigram plus slug discipline, enforce platform admin write plus signed in read, serve nearby plus stats via RPCs (named database functions you call from the app), and run imports in browser batches with counts plus review.

## Feature design

**Data model sketch**:
- `business_categories` holds id plus name plus slug plus description plus icon plus color plus active flag plus order plus times. Slug unique.
- `business_subcategories` holds id plus category id plus name plus slug plus active flag plus order plus times. Unique on category plus slug. Points to categories one to many.
- `business_directory` holds id plus name required plus normalized name required plus slug unique required plus category id required plus subcategory id optional plus business type optional plus address optional plus state required plus LGA optional plus city optional plus area optional plus latitude optional plus longitude optional plus geography optional plus phone optional plus email optional plus website optional plus whatsapp optional plus contact person optional plus opening hours plus description plus logo plus cover plus verification status plus verified at plus verified by plus data source plus import batch id plus legacy id plus demo flag default false plus active flag plus created at plus updated at plus created by. Points to categories, subcategories, import batches one to many. Slug conflict adds sequence and holds the second writer for review. Hide means soft hide. Block hide of a category while rows still link until reassigned.
- `business_verification` holds id plus business id plus verifier id plus status plus notes plus evidence url plus verified at plus created at. Points to directory one to many.
- `business_import_batches` holds id plus filename plus file url optional plus total plus successful plus duplicate plus invalid counts plus status plus error plus importer plus created plus started plus completed times.
- `business_import_errors` holds id plus batch id plus row number plus error type plus error message plus field plus raw data plus suggested fix plus created at. Points to batches one to many.
- Sources stay as data source text (`manual`, `import`, `api`, `crowdsourced`) for now. Separate sources table waits as follow up.

**State transitions**:
- Verification: `unverified` to `pending` to `verified` or `rejected`, by platform admin only, every move logged with verifier plus time plus notes. Rejected stays hidden from search. Re verify by admin is allowed and logged.
- Import batch: `pending` to `processing` to `completed` or `failed`, driven by the import run, counts plus errors written as it goes. Partial save is allowed with counts plus review rows.
- Directory active flag: true to false by platform admin for soft hide, never hard delete in this slice. Active false rows stay out of search plus stats plus export.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `business_directory` | POST | name req, category id req, state req, address opt, lat opt, lng opt, phone opt, email opt | id, slug, verification status | platform admin | 409 slug conflict, 422 missing required |
| `business_directory` | PATCH | id req plus editable fields | id, updated at | platform admin | 404, 409, 422 |
| `business_verification` | POST | business id req, status req, notes opt | id, verified at | platform admin | 404, 422 |
| `search_nearby_businesses` | RPC | lat req, lng req, radius m req with default 5000 and max 25000, named area opt via place search, category opt, state opt, LGA opt, limit opt with default 50 and max 200, offset opt | id, name, category, address, distance m, verification, source, lat, lng ordered by distance | signed in | 422 bad coords, 401 logged out |
| `get_business_stats` | RPC | state opt, category opt | total, verified, unverified, by category, by state, last import with file plus counts plus time plus importer | signed in | 401 logged out |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Create business | normalized name | Derived from name via shared normalize on write |
| Create business | slug | Derived from normalized plus sequence on conflict |
| Create business | geography | Derived from lat plus lng on write, null when coords missing |
| Create business | verification status | Default `unverified`, changed by platform admin verify |
| Create business | data source | Input `manual` or `import` or `api`, default `manual` |
| Search nearby | distance m | Computed by PostGIS from geography to search point |
| Search nearby | source plus verification shown | Columns data source plus verification status |
| Import run | new plus duplicate plus invalid counts | Computed from validate plus duplicate check plus insert results |
| Import run | error rows | Columns in `business_import_errors` with raw data |
| Stats read | totals plus breakdown | Computed from directory plus last batch row |
| List read | territory | Derived from state plus LGA columns |
| Verify action | verifier | Sign in id of the platform admin at write time |
| Verify action | verified time | Database clock at write time |
| Create business | demo flag | Input default false, true only for clearly tagged demo rows |
| Search read | demo exclusion | Demo rows excluded unless demo filter is on |
| Filter read | LGA list | Distinct LGA values from directory data for now |
| Export | file rows | Client side export, max 2000 rows per file, PII only for signed in readers |

**Key invariants**:
- Slug unique, never reused after soft hide. Concurrent inserts with the same slug hold the second for review.
- Normalized name always set from name in one server place on insert plus update.
- Geography matches lat plus lng or stays null, never a guessed point.
- Verification status moves only through allowed moves by platform admin. Rejected stays hidden. Re verify is allowed and logged.
- Required in this slice are name plus category plus state. Other fields stay free text optional with no format enforcement. Strict checks wait as follow up.
- Template columns equal directory fields. Accept CSV plus Excel. Keep 1000 row cap plus batches of 100. Fix by re uploading corrected rows.
- Possible duplicate on high name similarity or exact phone or near geo plus close name. Confirmed on exact slug or exact phone plus name. Merge keeps verified existing fields and fills gaps from new. Slug stays with existing.
- Named area resolves via place search. No GPS needs a named area. Default radius 5000, max 25000. Default limit 50, max 200.
- Verified first tiebreaks by distance then name.
- Import batch counts equal the sum of saved plus error rows on completion.
- Demo rows carry clear demo tag and never mix with verified counts, search, stats, or export unless demo filter is on.
- Proximity never writes a visit, only a candidate with distance.
- Logs carry status plus batch plus search errors only, never phone plus email plus precise GPS.

**Security model**:
Platform admin writes directory plus categories plus verification, checked via your existing platform admin helper. Signed in reps plus managers plus admins read active non demo rows plus call nearby plus stats RPCs. Logged out callers get deny in this slice, no rows plus no contact details, with a masked public view as follow up. RLS deny by default on every new table with explicit grants only to needed roles, helpers pinned with safe search path and no public execute. RPC grants plus search path get a explicit check before ship so server functions cannot bypass row rules. Compliance scope is personal details plus precise location. Audit logs for verification plus status plus import summary are required, with no phone plus email plus precise GPS in log text. GPS needs a visible consent notice before capture.

**Critical test scenarios**:
- Happy path: admin adds plus verifies plus rep searches nearby plus opens profile, verifies **AC-1**, **AC-5**, **AC-6**
- Failure case: 100 row import with 80 valid plus 10 invalid plus 10 duplicates completes partial with correct counts plus review rows, verifies **AC-3**, **AC-4**
- Failure case: no GPS plus no verified result shows honest empty plus area pick, never invented, verifies **AC-5**, **AC-8**
- Auth: logged out nearby call denied, cross role verify denied, platform admin verify allowed, demo rows excluded from search plus stats, verifies **AC-8**
- Scale: 5000 seeded rows, nearby with limit plus offset returns paged ordered by distance with no full load, verifies **AC-9**
- Race plus resume: concurrent same slug import holds second for review, browser batch notes resume point on failure, verifies **AC-4**

## Build plan

1. Apply idempotent tables plus RLS deny by default plus trigram plus geography plus slug indexes plus helpers, satisfies **AC-1**, **AC-8**
2. Add server derivation for normalized plus slug plus geography on write with conflict hold for review, satisfies **AC-1**, **AC-4**
3. Ship nearby RPC plus stats RPC with signed in grants plus safe search path, satisfies **AC-5**, **AC-9**
4. Wire repository plus categories CRUD so forms plus search reflect at once, satisfies **AC-2**
5. Build admin list plus create plus verify plus hide with loading plus error plus empty plus audit view, satisfies **AC-1**, **AC-10**
6. Build template download plus browser batch import in batches of 100 plus preview plus error review with counts plus re upload of corrected rows, satisfies **AC-3**, **AC-4**, **AC-10**
7. Build search plus list plus map sync plus profile plus filters plus sorting plus export for signed in users with CSV plus JSON first then Excel plus PDF in the same slice, satisfies **AC-5**, **AC-6**, **AC-7**, **AC-8**, **AC-10**

## Consequences

**Positive**:
- One truth for admin plus search plus future field link with no rework.
- Fast radius plus paging with no full table load.
- Audit trail for trust plus manager review.

**Negative / tradeoffs**:
- Light limits you chose keep entry fast but weaken matching and risk large uncapped uploads freezing or polluting data.
- Platform admin only writes can queue during bulk onboarding.
- Signed in only reads delay public discovery until a masked view ships.
- Browser batches suit thousands of rows but not tens of thousands without server work.

**Neutral**:
- Sources stay as text until a dedicated table ships.
- Existing services plus pages get wired, not replaced.

## Follow-up

- [ ] Tighten limits to strict format plus 10 MB cap plus coordinate range after first imports land.
- [ ] Design public masked discovery with hidden phone plus email for logged out readers.
- [ ] Promote data source text to a dedicated sources table when outside providers pilot.
- [ ] Spec the carehub field link for safe nearby labels plus rep confirm plus manager feed.
- [ ] Record the assumed Supabase Auth plus platform admin helper as its own decision spec.

## Migration plan

**Strategy**: no migration needed
**Phases**:
1. Apply tables plus indexes idempotently with `IF NOT EXISTS`, no destructive change.
2. Apply RLS plus helpers plus grants, verify logged out sees nothing and admin keeps access.
3. Apply nearby plus stats RPCs, verify ordering plus paging on seeded rows.
**Rollback**: Revert the commit plus drop only objects this spec added, existing data untouched.
**Risks**: RLS misgrant locking admins out, PostGIS missing in a fresh project, slug collisions on legacy names needing manual review.
