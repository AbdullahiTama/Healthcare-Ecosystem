# Expenses — Business Domain

## Purpose
Tracks business operating expenses (rent, salaries, utilities, supplies, etc.) as discrete logged entries, feeding into the Reports domain's financial summaries.

## Files
`apps/carehub/src/pages/dashboard/Expenses.jsx` (the entire module), `pages/dashboard/Reports.jsx` (read-only consumer).

## Components
Single default-exported component, list + add-modal, no sub-file decomposition. Shared primitives from `components/ui/index.jsx`.

## Services
`lib/supabase.js`: `getExpenses`, `addExpense`, `deleteExpense`. **No `updateExpense` exists** — an entered expense can only be deleted and re-created, not corrected in place.

## Dependencies
`lib/utils.js` (`fmt`, `todayDate`, `currentMonth`, `EXPENSE_CATS`).

## Database Tables
`expenses` (`id, business_id, category, amount, created_at`, category values drawn from `lib/utils.js`'s `EXPENSE_CATS`).

## Current State
Log and delete are implemented; there is no edit path. No pagination — the full expense history loads on every visit and on every `Reports.jsx` computation.

## Missing Documentation
No document explains why Expenses lacks an update function when every other financial-record domain (Debts, Purchases, Sales) supports one — whether this is a deliberate "expenses are immutable, correct by deleting" policy or an oversight is not recorded anywhere.
