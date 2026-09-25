# Scope: CareHub Live Field Activity plus Directory Link

You serve field reps who report real work plus managers who need a reliable view of field operations.

**Build approach:** Tracer Bullet (vertical slices, each feature built end to end through every layer, working).
**Workflow:** GA (after develop you run check verify then test then fresh review then document).

_These are recommendations to keep your build orderly, not requirements. Skip anything that does not fit. You decide when a feature is done._

## At a glance

| # | Feature | Phase | Status |
|---|---|---|---|
| A | Live field activity current | Foundation | existing |
| 1 | Field work entry with two options | Slice 3 | planned |
| 2 | Nearby business identification with safe labels | Slice 3 | planned |
| 3 | Rep confirm plus activity submit | Slice 3 | planned |
| 4 | Territory links plus basic counts | Slice 4 | planned |
| 5 | Visited versus not visited plus manager view | Slice 4 | planned |

## Foundations

### A. Live field activity current · existing
Custom fields plus GPS plus voice notes plus live feed plus reactions plus comments plus history plus export plus map. You must preserve all of this.
code in `apps/carehub/src/modules/live-activity/LiveActivity.jsx`

## Slice 3: Field link

### 1. Field work entry with two options · planned
Clear entry with Live Field Report for official reporting plus Business Discovery for finding opportunities so reps never confuse search with attendance.
**Done when:** rep can choose report or discovery and discovery never creates activity plus never notifies manager plus never appears in feed.
- [ ] Build it: `/develop field work entry with two options`

### 2. Nearby business identification with safe labels · planned · needs a decision
GPS lookup in directory shows Possible nearby business plus Detected nearby plus Location captured plus Selected business without claiming a visit.
**Done when:** report shows nearby candidates with distance plus source plus verification and rep must confirm before submit and proximity alone never counts as proof.
- [ ] Design it (spec): `/architect nearby business identification with safe labels`

### 3. Rep confirm plus activity submit · planned
Confirm business plus enter activity plus submit to manager live feed reusing location plus matching plus distance services.
**Done when:** confirmed report with activity plus time plus territory plus voice note appears in manager feed with correct business link.
- [ ] Build it: `/develop rep confirm plus activity submit`

## Slice 4: Territory insight

### 4. Territory links plus basic counts · planned
State plus LGA plus territory plus segmentation on each business so coverage planning has a base.
**Done when:** each business carries state plus LGA plus territory and manager can see counts by territory.
- [ ] Design it (spec): `/architect territory links plus basic counts`

### 5. Visited versus not visited plus manager view · planned · needs a decision
Compare directory against reported activity to surface not recently visited opportunities for planning.
**Done when:** manager can see visited versus not visited by territory plus filter by recency without changing official reporting rules.
- [ ] Design it (spec): `/architect visited versus not visited plus manager view`

## Deferred
Out of scope for the current build pass, kept so the plan stays honest.
1. Rep assignment plus route planning · needs a decision
2. Advanced segmentation plus concentration heat view · needs a decision
