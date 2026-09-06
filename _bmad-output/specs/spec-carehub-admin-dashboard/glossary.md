# Glossary — CareHub Super Admin Dashboard

| Term | Meaning |
|---|---|
| **Owner** | Human platform owner at `carefindhub.com/admin`, `businesses.is_platform_admin` or `admin_team_members` super role. Lives in panel hours/day. |
| **Job nav** | Stripe pattern: nav labeled by owner job (Find business, Approve vendors, Pay agents) not data model. |
| **Table as product** | Stripe pattern: dense table is the primary UI, not cards/charts. 36px rows, sticky header, tabular money. |
| **Timeline lifecycle** | Business state as `pending → active → suspended (temp) → revoked (withdrawal) → reapply`, not just pill. |
| **Sheet** | Linear slide-over side sheet (40% width, bottom sheet mobile) for business drill, keeps context vs modal. |
| **6-cap KPIs** | At most 6 numbers, one hero, each with delta + sparkline. Plausible restraint. |
| **Matrix perms** | `admin_roles.permissions` 8-perm matrix (Dashboard,Businesses,Team-Agents,Team-Platform,Applications,Ledger,Payouts,Coverage) + templates. |
| **Vault** | Bank vault dual-control: Approve and Mark Paid must be different `admin_team_members`. |
| **Statement as product** | Mercury pattern: Ledger is styled PDF statement (running balance), CSV is debug. |
| **Daily Brief** | Attio AI summary card on inspectable data, not chat widget. |
| **Rail** | 64px collapsed icon rail with tooltips, expands to 256px sidebar (Vercel). |
| **Cmd+K** | `cmdk` command palette with `command-score` fuzzy, <5ms for 1k commands. |
| **Color=state** | Monochrome system, color only signals state (amber/green/red/gray). |
| **Soft-delete** | Sets `businesses.deleted_at` + `revoked`, preserves ledger; hard requires typing name. |
| **Aggregate ledger** | View over `business_wallet_transactions` etc., not new source of truth. |
| **Pulse** | Vercel deploy-style dot + `last-synced` badge via `supabase.realtime`, not 30s poll. |
