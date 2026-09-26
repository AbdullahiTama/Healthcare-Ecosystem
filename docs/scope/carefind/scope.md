# Scope: CareFind Business Directory plus Discovery

You serve admins plus field reps plus managers who need trusted business data plus fast discovery around any location.

**Build approach:** Tracer Bullet (vertical slices, each feature built end to end through every layer, working).
**Workflow:** GA (after develop you run check verify then test then fresh review then document).

_These are recommendations to keep your build orderly, not requirements. Skip anything that does not fit. You decide when a feature is done._

## At a glance

| # | Feature | Phase | Status |
|---|---|---|---|
| A | Existing directory services | Foundation | in-progress |
| B | Existing discovery pages | Foundation | in-progress |
| C | Directory tables live | Foundation | existing |
| 1 | Directory data model plus security | Foundation | in-progress |
| 2 | Admin directory management | Slice 1 | planned |
| 3 | Categories plus subcategories | Slice 1 | planned |
| 4 | Import template plus upload plus validation | Slice 1 | planned |
| 5 | Duplicate detection plus review | Slice 1 | planned |
| 6 | Natural language search plus radius | Slice 2 | planned |
| 7 | List plus map plus details | Slice 2 | planned |
| 8 | Filters plus sorting plus export | Slice 2 | planned |

## Foundations

### A. Existing directory services · in-progress
Already built parsing plus deduplication plus location plus export plus query parsing. You may reuse this code and wire it to real data.
code in `apps/carefind/src/modules/business-directory/services/`

### B. Existing discovery pages · in-progress
Already built search bar plus filters plus list plus map shells. You may finish wiring once directory data is live.
code in `apps/carefind/src/modules/business-discovery/`

### C. Directory tables live · existing
Core tables plus geography plus import tracking plus verification plus RLS plus indexes plus functions are live in migrations.
code in `supabase/migrations/carefind_20261001_business_directory_tables.sql`

### 1. Directory data model plus security · in-progress
Core records plus geography plus verification plus import batches so admin plus search plus field link build on solid ground.
**Done when:** tables enforce RLS plus nearby query returns ordered by distance plus stats query works for dashboards.
- [x] Design it (spec): `/architect directory data model plus security`
- [x] Build it: `/develop directory data model plus security`
   - [x] Data plus RLS plus derivation (AC-1, AC-4, AC-8)
   - [x] Nearby plus stats RPCs (AC-5, AC-9)
   - [x] Admin plus categories plus import (AC-1, AC-2, AC-3, AC-4, AC-10)
   - [x] Discovery read path plus export (AC-5, AC-6, AC-7, AC-8, AC-10)
- [ ] Verify it: `/check verify directory data model plus security`
- [ ] Test it: `/test directory data model plus security`
- [ ] Review it (fresh model): `/check review directory data model plus security`
- [ ] Document it: `/document directory data model plus security`
Spec [0001](../../specs/carefind/0001-directory-data-model-security/index.md) · code in `apps/carefind/src/modules/business-directory/`, `apps/carefind/src/modules/business-discovery/`, `supabase/migrations/carefind_20261002_directory_spec_gaps.sql`

## Slice 1: Trusted directory

### 2. Admin directory management · planned
Add plus edit plus view plus verify plus deactivate so admins keep one trusted source.
**Done when:** admin can create plus verify plus deactivate a business and see correct status plus audit trail.
- [ ] Design it (spec): `/architect admin directory management`

### 3. Categories plus subcategories · planned
Managed list of 29 health categories plus subcategories so search plus forms stay consistent.
**Done when:** admin can add plus edit plus remove a category and forms plus search reflect it at once.
- [ ] Build it: `/develop categories plus subcategories`

### 4. Import template plus upload plus validation · planned · needs a decision
Template download plus large file upload plus row validation plus preview so thousands of rows import without freezing the browser.
**Done when:** admin can download template plus upload 1000 rows plus see new plus possible duplicate plus invalid counts plus correct before final import.
- [ ] Design it (spec): `/architect import template plus upload plus validation`

### 5. Duplicate detection plus review · planned · needs a decision
Normalized names plus phone plus address plus coordinates plus similarity scoring so same business under different spellings is caught.
**Done when:** import flags new plus possible duplicate plus confirmed duplicate and admin can keep existing or import new or merge or skip.
- [ ] Design it (spec): `/architect duplicate detection plus review`

## Slice 2: Discovery

### 6. Natural language search plus radius · planned · needs a decision
Plain requests like find pharmacies around me become category plus quantity plus radius plus location so reps find opportunities fast.
**Done when:** typed request plus category pick plus current location or named area plus radius returns ranked nearby results with distance and source shown.
- [ ] Design it (spec): `/architect natural language search plus radius`

### 7. List plus map plus details · planned
List with name plus category plus address plus distance plus contact plus map markers that stay in sync plus profile with call plus directions plus share.
**Done when:** you can switch list and map plus select marker to highlight list row plus open profile with verification status and actions.
- [ ] Build it: `/develop list plus map plus details`

### 8. Filters plus sorting plus export · planned
Category plus state plus LGA plus verification plus source filters plus nearest plus alphabetical plus verified first sorting plus CSV plus Excel plus PDF plus JSON export.
**Done when:** filtered sorted results export with name plus category plus address plus phone plus coordinates plus distance plus verification status.
- [ ] Build it: `/develop filters plus sorting plus export`

## Deferred
Out of scope for the current build pass, kept so the plan stays honest.
1. Outside providers pilot with clear source tag · needs a decision
2. Territory dashboards plus coverage counts · needs a decision
3. Prospect assignment plus segmentation for enterprise teams · needs a decision
4. Public masked discovery with hidden contact for logged out readers · from spec 0001
5. Dedicated sources table when outside providers pilot · from spec 0001
