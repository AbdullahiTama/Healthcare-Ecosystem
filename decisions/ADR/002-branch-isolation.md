# ADR-002

## Title

Branch-as-Business Isolation Model

---

## Status

Accepted

---

## Context

CareHub has two parallel multi-location concepts: `enterprise_locations` (physical places within one shared business, used by Stock/Orders) and `businesses.parent_business_id` (branch-as-separate-business). The latter had zero live usage and no owner cross-branch visibility — `current_business_ids()` returned only the single business matching the user's email, making branches invisible to their owner.

The product requirement is: each branch operates independently with its own inventory, sales, staff, and appointments, while the owner sees and manages all branches from one place.

---

## Decision

Adopt the **branch-as-business** model (`businesses.parent_business_id`). Each branch is a full `businesses` row with isolated data. The owner's visibility is extended by rewriting `current_business_ids()` as a recursive CTE that walks `parent_business_id` up to a configurable `branch_depth_limit` (default 5).

`enterprise_locations` is retained for its existing purpose (physical places within one branch — warehouses, showrooms). The two systems do not interact.

---

## Consequences

**Pros**
- Clean data isolation per branch — no cross-branch leaks.
- Owner gets a single cross-branch overview without joining unrelated concepts.
- Matches the mental model of "each branch is its own business."

**Cons**
- Data is duplicated across branches (each branch has its own product list, client records). The master catalog (ADR-004) mitigates product duplication.
- Recursive CTE performance degrades past ~100 branches per tree. Acceptable for now; a materialized path would be needed at scale.
- Existing `enterprise_locations` remains, creating two "location" concepts that must be documented as distinct.

---

## Alternatives Considered

1. **Branch-as-location** (extend `enterprise_locations` with full data isolation). Rejected — that table is shared by design (one inventory across locations); retrofitting per-branch isolation onto it would break Stock and Orders.

2. **Single business with a `branch_id` column on every table**. Rejected — mixes tenant data in every table, complicates RLS, and makes cross-branch queries harder to scope correctly.
