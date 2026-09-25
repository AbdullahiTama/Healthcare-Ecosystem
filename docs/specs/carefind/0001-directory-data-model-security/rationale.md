# Rationale: 0001 Trusted directory data model plus security

## Context

CareFind already has directory services plus discovery pages plus migration files, but no single spec names where each value comes from. The same business can appear under different spellings, phone formats vary, coordinates may be missing, and imports can reach thousands of rows. Without a shared target the build would guess at required fields, at duplicate rules, and at who may see contact details.

This decision touches personal details (phone, email) plus precise location (GPS points, home areas). Data protection duty applies in Nigeria plus general privacy duty everywhere. Audit logs are not negotiable for verification changes. The design assumes your existing Supabase Auth plus platform admin helper plus RLS pattern from CareHub hardening. That auth setup has no dedicated spec, so it is stated here as an assumption with a follow up to record it.

If this stays undecided, admin plus search plus field link will drift into three copies of business truth, duplicates will ship, and contact details may leak to logged out readers.

## Options considered

### Option 1: One trusted source with PostGIS plus RLS plus browser batches

Keep the live `business_directory` shape plus categories plus verification plus import batches plus errors, store geography for distance, enforce RLS deny by default, parse imports in browser in batches of 100 with review queue.

**Pros**:
- Reuses your live migrations plus services with no new infra.
- Nearby search stays fast with no full table load.
- Review queue keeps trust when spellings differ.

**Cons**:
- Browser batches strain on very large files over a few thousand rows.
- Platform admin only writes can bottleneck during bulk onboarding.

### Option 2: Search only store with client distance

Keep a lean directory for search, skip verification plus import history for now, compute distance in browser after loading rows.

**Pros**:
- Smallest build to first search results.
- No RLS plus audit work up front.

**Cons**:
- Admin trust plus duplicate handling need rework later.
- Full table load breaks at scale and leaks contact details to shape later.

### Option 3: Split locations plus contacts with server processing

Normalize address plus contact into child tables now and process imports in an Edge Function (server function at the edge that runs your code near the database) with file kept in Storage (managed file bucket).

**Pros**:
- Cleaner normal form plus full audit of files.
- Server handles huge files without freezing the browser.

**Cons**:
- More joins from day one plus new server code plus storage plus PII retention to operate.
- Overkill for the first trusted slice the team can run on a Tuesday afternoon.

## Rationale

Your answers lock a full thread from add to verify to search to confirm, which needs one truth plus fast nearby plus audit, not a thin search cache. Context forces are duplicate spellings, PII plus GPS sensitivity, and thousand row imports that must not freeze. Option 1 meets those with boring proven pieces you already operate. Option 2 would force a second data rework once verification matters. Option 3 adds operational cost your team does not need for day one scale.

The engineer chose light required only for limits. However trust plus scale favor strict format plus size checks because free text phones plus missing coordinates plus uncapped files weaken matching and risk frozen uploads. Light is honored in AC-3 to respect your call, with a conscious tradeoff recorded in Consequences plus a strict follow up queued.
