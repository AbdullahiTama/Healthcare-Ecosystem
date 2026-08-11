# ADR-004

## Title

Master Product Catalog with Branch Activation

---

## Status

Accepted

---

## Context

In the branch-as-business model, each branch manages its own products. But the owner needs to define products once and roll them out to branches — maintaining separate product lists per branch is unsustainable. Branches also need the ability to carry different subsets and set their own prices.

---

## Decision

Introduce two tables:
- **`master_products`** — the owner's canonical product list (name, description, category, default price). Scoped to the parent business.
- **`branch_products`** — the activation link: which branches carry which master products, with an optional price override. Stock levels continue to live in each branch's existing `products` table.

Branches browse the master catalog and "activate" what they carry. The owner pushes name/description/price updates to all activated branches. Branches can also create their own branch-only products.

New branches are cloned from the parent — they inherit all master-product activations (active=true, no override) and the parent's custom roles. Stock starts at zero.

---

## Consequences

**Pros**
- Single source of truth for product definitions — owner updates once, branches inherit.
- Branches retain autonomy over pricing and which products they carry.
- New branches open ready to operate (cloned catalog + roles).

**Cons**
- Two-layer product model (master + activation + branch stock) adds complexity to the inventory read path.
- Price overrides at the branch level mean the owner's "default price" is a suggestion, not a rule — reporting must handle both.

---

## Alternatives Considered

1. **Fully shared product table** — all branches see the same products. Rejected — removes branch autonomy over what they stock and what they charge.

2. **Owner master catalog with mandatory sync** — new master products auto-appear in all branches. Rejected — too rigid; branches in different regions carry different things.
