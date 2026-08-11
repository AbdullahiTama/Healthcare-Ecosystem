# Billing — Business Domain

## Purpose
`README.md` lists "Billing" as a distinct CareHub responsibility, separate from POS. No dedicated Billing screen, route, page component, or table was found anywhere in the codebase during this or any prior review pass.

## Files
None found under this name. Billing-adjacent functionality is distributed across three other domains: **Point of Sale** (`POS.jsx` — checkout/payment collection), **Debts** (`Debts.jsx` — money owed tracking), and **Purchases** (`Purchases.jsx` — supplier payment tracking).

## Components
None specific to this domain.

## Services
None specific to this domain.

## Dependencies
N/A.

## Database Tables
None specific to this domain. `sales`, `debts`, and `purchases` (documented under their respective domains) collectively cover what "Billing" appears to mean in the product's own documentation.

## Current State
No implementation of a domain called "Billing" exists as a distinct concept in the codebase. Whether this is because the responsibility is considered fully covered by POS/Debts/Purchases together, or because a dedicated Billing feature (e.g., invoicing, recurring billing, insurance claims billing for hospital tenants) was planned and not yet built, could not be determined from source.

## Missing Documentation
This entire domain is a documentation gap: `README.md` names "Billing" as a CareHub responsibility with no corresponding module documentation, page, or table anywhere in the codebase, and no other document clarifies whether "Billing" is meant as an umbrella term for POS+Debts+Purchases or as a planned, separate feature.
