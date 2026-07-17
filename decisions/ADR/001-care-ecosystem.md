# ADR-001

## Title

Care Ecosystem Architecture

---

## Status

Accepted

---

## Context

The platform consists of multiple applications.

Initially these applications appeared independent.

Further architectural review showed they are part of one ecosystem.

---

## Decision

Treat CareHub and CareFind as products inside one ecosystem.

Both applications may evolve independently while sharing domain knowledge.

---

## Consequences

Pros

Clear architecture

Shared business rules

Cleaner documentation

Scalable engineering

Cons

Requires stronger documentation

Requires better module boundaries

---

## Alternatives Considered

Treat them as completely independent applications.

Rejected.

Reason:

Large duplication of business knowledge.