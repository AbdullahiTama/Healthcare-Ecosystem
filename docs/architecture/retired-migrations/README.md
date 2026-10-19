# Retired migrations: DO NOT APPLY

These files were written on `feat/enterprise-directory` against a **wrong assumption**: that no business directory existed. One already does, and it is live: the CareFind Business Directory and Business Discovery (commits `c651fed` and `4331e88`, spec 0001), with `directory_businesses`, `directory_categories`, `directory_subcategories`, `directory_import_batches`, `directory_import_errors`, `directory_duplicate_dismissals`, `directory_reports` and the rep-activity functions, plus `field_activities.directory_business_id` and its link guard.

Applying anything here would collide with that schema (for example it would replace the live `directory_businesses_guard()` function and silently skip creating tables that already exist with a different shape). They were moved out of `supabase/migrations/` so no pipeline can pick them up, and are kept only for reference and for their tests (`scripts/db-tests`).

| File | Why retired |
|---|---|
| `20261119_discover_facilities_cursor_lockdown` | Replaced by `supabase/migrations/carehub_20261129_revoke_anon_discover_facilities_cursor.sql` (permission-only, applied to production 2026-10-19). This one also replaced the live function body. |
| `20261120_business_directory`, `20261121_directory_imports`, `20261122_directory_search`, `20261128_directory_import_merge` | Duplicate the live directory. |
| `20261124_field_activity_directory_link` | The columns and link guard already exist live. |
| `20261126_staff_privilege_guard` | Already fixed live by `guard_staff_writes` (c21 migrations). |
| `20261127_realtime_activity_tables` | `field_activities`, `activity_reactions` and `activity_comments` are already in the `supabase_realtime` publication. |

What is worth keeping from this work is being ported onto the live schema instead (reviewed merge, Excel import).
