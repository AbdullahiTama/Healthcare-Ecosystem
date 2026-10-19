# Business Types and the Module Registry

**Status:** current as of 2026-10-18 (commit that reconciled the signup taxonomy with the registry).

## The single source of truth

`apps/carehub/src/lib/permissions.js` owns the module registry. Every surface that lists modules — the sidebar (`components/layout/Sidebar.jsx`), route guards (`pages/dashboard/BusinessDashboard.jsx`), the Roles & Permissions editor (`modules/staff/Staff.jsx`), the Reports Hub tabs, and the consultation shortcut in `modules/clients/Clients.jsx` — derives from it. No surface hardcodes a business-type list.

Flow: **Business Type → `MODULES` registry → available modules (`getModulesForType`) → role editor / nav / route guards**.

## The two taxonomies

CareHub carries two business-type taxonomies at once:

1. **Legacy types** on rows created before the Sep 2026 Register redesign:
   `skincare, pharmacy, dental, optical, wellness, hospital, manufacturer_importer, wholesale`.
2. **Signup taxonomy** in `src/config/constants.js` (`BUSINESS_TYPES`, the Register wizard and landing-page list):
   `pharmacy, hospital, clinic, laboratory, aesthetic, spa, cosmetics, haircare, other`.

Both must resolve in the registry. `getModulesForType` / `rolesForType` normalise any value the registry doesn't know (a typo, an empty string, `null`, a future addition) to `other`, so an unmapped business type can never produce an empty app.

## What each signup type gets

Universal set (the `ALL_TYPES` gate, 18 modules):
`overview, dashboard, pos, inventory, mastercatalog, clients, expenses, debts, purchases, demand, carefind, locations, staff, wallet, reports, adr-reports, ecommerce, settings`.

| type | adds | clients label | ADR presentation | preset roles offered |
|---|---|---|---|---|
| clinic | appointments, consultations | Patients | hospital | Owner, Manager, Receptionist, Doctor, Cashier |
| laboratory | lab (only clinical module) | Clients | hospital | Owner, Manager, Lab Technician, Cashier |
| aesthetic | appointments, consultations | Clients | skincare (Adverse Cosmetic Event) | Owner, Manager, Therapist, Receptionist, Cashier |
| spa | appointments, consultations | Clients | skincare | Owner, Manager, Therapist, Receptionist, Cashier |
| haircare | appointments, consultations | Clients | skincare | Owner, Manager, Therapist, Receptionist, Cashier |
| cosmetics | — | Clients | skincare | Owner, Manager, Receptionist, Cashier |
| other | — | Clients | community_pharmacy (fallback) | Owner, Manager, Receptionist, Cashier |

These follow the product notes in `src/pages/landing/data/businessTypes.js` (which are written against this registry). Clinical modules (`reception, triage, doctor, rx_inbox, lab, imaging`) stay with `hospital` — plus `lab` for stand-alone laboratories. Enterprise modules (`activity, discovery, orders, warehouses, stock, territories, messages, pv-tracker`) stay with `manufacturer_importer` / `wholesale`.

Ordering: `clinic` has its own `NAV_ORDER` list (appointment book and consultations lead); `laboratory` reuses the hospital ordering (only the lab bench passes its gate from the clinical block).

## Wallet policy

Unchanged by the taxonomy work:

- `wallet` is in the universal set, so **every owner of every business type** sees Wallet in the nav. RLS (`business_id IN current_business_ids()`) is authoritative.
- The wallet row is **created by the first credit**, not at signup — a business without one simply reads zero. (Verified 2026-10-19: **3 of 28** production businesses have a row; the missing 25 are benign.)
- No staff preset (any business type) includes Wallet in its nav. A **custom role** (Staff → Roles → New Role) can tick **Wallet**; `getPerms` resolves the custom role by name, so the tick adds the nav item and passes the route guard.

**Known gap — decision owed (found 2026-10-19).** The Wallet *page* refuses every role that is not literally `Owner`: `Wallet.jsx` hard-gates on `role === 'Owner'` and renders "Wallet is restricted to the business Owner" (pinned by `Wallet.test.jsx`). So the custom-role tick currently ends in a restriction screen. Either relax the page gate (view-only is the natural shape — withdrawals and top-ups need the owner's PIN/OTP) or drop the grant claim from staff docs. Tracked as follow-up 6 in `docs/superpowers/plans/2026-10-18-business-type-taxonomy-registry.md`.

## ADR presentation mapping

The ADR module type (`community_pharmacy | hospital | industry | skincare`) is presentation only — RLS remains the access control. There is exactly **one** business-type map:

- `src/modules/adr/repositories/index.js` → `getModuleTypeFromBusinessType(businessType)`
- `AdrNav.js` and `formEngine.getModuleType` consume it (re-exported by `adr/services.js`); `validation.js` resolves through the same chain. Do not add parallel maps.

## Adding a business type

Checklist:

1. `src/config/constants.js` — add to `BUSINESS_TYPES` (id, name, icon).
2. `src/lib/permissions.js` — add the id to `ALL_TYPES`, plus any specialty gate in the `MODULES` table (`RETAIL_TYPES` = appointments, `CONSULT_TYPES` = consultations, etc.).
3. Ordering — reuse `default` / `hospital` / `enterprise`, or add a `NAV_ORDER` list + `familyOf` branch if it needs its own.
4. `labelByType` if a module presents differently (e.g. `clients` → `Patients`).
5. `ROLES_FOR_TYPE` — preset roles whose nav the type's modules can actually show (a neutralised role is worse than no role).
6. ADR — add it to `getModuleTypeFromBusinessType` only.
7. Tests — the `signup taxonomy (config/constants.js BUSINESS_TYPES)` block in `src/lib/__tests__/permissions.test.js` iterates `BUSINESS_TYPES` directly, so a new type is automatically held to: non-empty owner nav, wallet reachable, no clinical/enterprise leaks.

## Test map

| what | where |
|---|---|
| registry gates, consultation/appointment families, unknown-type normalisation, roles per type, ordering | `src/lib/__tests__/permissions.test.js` |
| ADR nav per business type | `src/modules/adr/AdrNav.test.js` |
| ADR presentation map | `src/modules/adr/repositories/index.test.js` |
| e-commerce segment per type (all signup types → retail) | `src/lib/__tests__/ecommerceSegments.test.js` |

## Related

- `src/pages/landing/data/businessTypes.js` — per-type product notes (the claims this registry backs).
- `src/lib/roleTemplates.js` — New Role templates for pharmacy / hospital / enterprise (clinic, laboratory and beauty template sets are a follow-up content pass).
- `docs/superpowers/plans/2026-10-18-business-type-taxonomy-registry.md` — the plan and decision record for this reconciliation.
