# CareFind admin Phase 5b: Teams, staff and roles, and Tasks

Date: 2026-10-13
Builds on: Phase 5a (`2026-10-13-carefind-admin-phase5a-design.md`, PR #28).
Branch: `feat/carefind-admin-phase5b`, based on the Phase 5a branch.
Phase 5c is Shop, Email templates, and deleting `legacy/` and the dead hooks.

## Goal

Move the Teams & Staff tab (teams, staff accounts, roles and permissions) and the Sponsored Tasks tab out of
`legacy/LegacyTabHost.jsx`. This is the most sensitive screen in the console: it creates privileged accounts and
decides what every other admin may see. The redesign must not weaken any check, must stop showing a failed or
forbidden read as "no members", and must use the server actions that already exist but have no UI.

## Scope and constraints

- No backend, SQL or auth change. Same `callAdminAuth` actions and payloads: `list_teams {}`, `create_team { name }`,
  `list_staff {}`, `create_staff { newEmail, newPassword, newName, newRole, teamId, roleId }`,
  `toggle_staff { staffId, isActive }`, `assign_admin_role { staffId, roleId }`, `list_admin_roles {}`,
  `create_admin_role { name, description, carefindTabs }`, `update_admin_role { roleId, description, carefindTabs }`,
  `delete_admin_role { roleId }`, `create_task { title, description, compensation, specialty }`, audit through
  `log_audit_action`. Never a `token` field.
- The server enforces `super_admin` for staff, team and role actions (verified in `admin-auth.js`). The UI hides
  the staff and role controls from a non-super admin as a courtesy only; the server decides. Nothing in the UI is
  presented as the security check (Phase 1 finding 1 still applies to the read actions that only verify the token).
- Never log, audit, toast or store a password. The audit metadata for staff creation holds the role, team and
  email, nothing secret.
- A source that fails to load shows "Couldn't load, Retry", never "No members yet" or an empty list.
- Tasks reads keep `dashboardRepository.getTasks` (browser client under RLS) and `create_task`.

## Units

| Unit | Responsibility |
|---|---|
| `hooks/useTeamsData.js` | Key `['admin','teams']`. `teams` (`list_teams`), `roles` (`list_admin_roles`) and, only when `enabled` for a super admin, `staff` (`list_staff`), each settled to `{ status:'ok', data }` or `{ status:'error' }`; a failed refresh of a list that last loaded keeps it as `{ status:'ok', data, stale:true }` (the Phase 4b pattern). For a caller that is not a super admin the hook makes no `list_staff` call and returns `staff: { status:'restricted' }`. |
| `hooks/useStaffActions.js` | `createTeam({ name })`, `createStaff({ name, email, password, role, roleId, teamId })`, `toggleStaff({ id, isActive })`, `assignRole({ staffId, roleId })`, `createRole({ name, description, tabs })`, `updateRole({ roleId, description, tabs })`, `deleteRole({ roleId })`. Each resolves `{ ok }` / `{ ok:false, error }`; only the server call inside the `try`; refresh, toast and audit via `bestEffort`; a per-key in-flight guard (Phase 4b pattern). `createStaff` normalises the email (`trim().toLowerCase()`), requires a password of at least 8 characters (stricter than the legacy `required`), and sends the selected role's `roleId` when the role is a custom role. Audit entries: `create_staff`, `toggle_staff`, `assign_role`, `create_team`, `create_role`, `update_role`, `delete_role` (target type `admin_user`/`admin_team`/`admin_role`), best effort and never failing the action. |
| `hooks/useTasksData.js` | Key `['admin','tasks']`; `dashboardRepository.getTasks()`; failure is an error, not `[]`. `useTaskActions().createTask({ title, description, compensation, specialty })` resolves `{ ok }`/`{ ok:false, error }`; validates a positive whole-number compensation before calling. |
| `sections/TeamsSection.jsx` | Teams and members, staff table (super admin only), create team, create staff, role assignment, deactivate/reactivate, roles and permissions (super admin only). |
| `sections/TasksSection.jsx` | Create task panel and the task list. |
| `ui/PermissionMatrix.jsx` | The "which sections may this role open" checkbox grid shared by create and edit role (grouped by the navigation groups, one component, labelled). |

Removed from `LegacyTabHost`: the `teams` and `tasks` render lines; the task state (`taskTitle, taskDesc, taskComp,
taskSpec, savingTask`), team/staff/role state (`teamName, staffEmail, staffPass, staffName, staffRole, staffTeam,
savingStaff, staffMsg, newRoleName, newRoleDesc, newRoleTabs, editingRoleId, editingRoleTabs, savingRole`) and the
handlers `createTask`, `createStaff`, `createTeam`; `useAdminRoles` and the `tasks, teams, staff` destructure when
nothing remaining uses them (grep first). `tabs/TeamsTab.jsx` and `tabs/TasksTab.jsx` are deleted. What remains in
the host after 5b is Shop and Email templates (5c). `useAdminRoles` in `hooks/queries.js` becomes dead.

## Behaviour

| Area | Behaviour |
|---|---|
| Teams | Create team (name required, trimmed, confirmation not needed). Each team lists its members (name, role, status); a team with none says "No members yet" only after the staff list loaded. |
| Staff list | Table: name, email, role, team, status (active/suspended), last sign-in. Super admins are listed in their own band as today. Not a super admin: the section says "Only a super admin can see staff accounts" and calls nothing. A failed load: "Couldn't load staff" + Retry, never "No members yet". |
| Create staff | Full name, email, password (min 8, show/hide toggle), role, team. The role list is the five system roles plus the custom roles from `list_admin_roles`; choosing a custom role also sends its `roleId`. `super_admin` is never offered (the server would accept it; documented, not changed). Success clears the form and says the account was created; a failure keeps everything but the password field and shows the server error in `role="alert"`. |
| Deactivate / reactivate | A staff row's drawer has "Deactivate" / "Reactivate" with confirmation ("This signs the staff member out of the console and stops them signing in. Their account and history are kept." — only if the server really revokes sessions; otherwise "This stops them signing in. ..." verify against `toggle_staff` and state exactly what it does). The acting admin's own row has no Deactivate. |
| Change role | A staff row's drawer has "Change role" (a select of the assignable roles) -> `assign_admin_role`, with confirmation naming the person and the new role. |
| Roles & permissions | Super admin only. Create role (name, description, permitted sections via `PermissionMatrix`); edit permissions of a non-system role; delete a non-system role with confirmation ("Staff currently on this role keep their account; check their access." — verify what the server does to staff on a deleted role before wording). System roles are shown read-only with an explanation. The matrix always includes `overview` (as legacy). |
| Tasks | Create task (title, description, compensation as a positive whole number, optional specialty) with field-level validation and the server error inline; the task list shows title, specialty, compensation (₦, as legacy) and created time; failed load -> Retry; empty -> "No tasks yet" only after a successful read. |

## States

Loading placeholders; failed lists -> Retry; a failed refresh of a loaded list keeps it with a "Couldn't refresh"
note; "restricted" is its own state, never an empty list; all destructive actions confirm, disable while running and
resolve a late result after unmount into a toast.

## Findings to document (numbering continues from 79)

80. The Teams tab created custom-role staff with the role name only; `role_id` stayed NULL. Whether access follows
    the name or the id is decided by `get_admin_permissions`, which is not in the repository's SQL (live only), so
    the effect on custom-role staff is unverified. The screen now sends `roleId`.
81. `toggle_staff` and `assign_admin_role` existed with no UI, so a staff member could not be deactivated or moved
    to another role from the console. Wired.
82. `list_staff` is super-admin only but its failure was turned into `[]`, so a non-super admin with the Teams
    permission saw "No members yet" for every team. Now an explicit restricted state.
83. `create_staff` accepts any `newRole` string including `super_admin`, and `update_admin_role` has no
    `is_system` check, so a super admin can edit a system role's permissions. The UI offers neither; the server
    still allows both (documented, not changed).
84. Staff, team and role changes wrote no audit entries. Added (best effort).
85. The password for a new staff account is chosen by the super admin and sent in the request body; there is no
    invite or forced-reset flow, and the server enforces no password policy. A client minimum of 8 characters was
    added; the policy gap is documented.
86. Task submissions have a list action (feeding Alerts) but no approve/reject action or screen, and no task edit
    or close action exists. Tasks can only be created and listed. Documented; needs a backend decision.

## Testing

- `useTeamsData`: each source settles on its own; failed list is an error; stale keep on a failed refresh; a non-super
  caller makes no `list_staff` call and gets `restricted`.
- `useStaffActions`: exact payloads (incl. `roleId` for custom roles, lower-cased email), password never in any
  audit/toast/log call, password < 8 never calls the server, failure returns `{ ok:false, error }`, one refresh,
  audit entries best effort, in-flight guard, no `super_admin` option.
- `useTasksData`/`createTask`: validation (positive integer), payload, failure, failed list is an error.
- Sections: states, restricted state, create-staff keep-on-failure (password cleared), confirmations with exact
  texts, own row has no Deactivate, system roles read-only, matrix component, late-result rule, permission-hidden
  fallback; routing test extended for the two tabs. Full suite, build and lint before the PR.
- Responsive widths and behaviour against the live admin cannot be exercised without an admin session; the PR
  says so. The custom-role access question (finding 80) must be checked by the owner in Supabase.

## Delivery

One commit per unit. `docs/ADMIN_REDESIGN.md` gets findings 80-86, the phase table update and the dead-code notes.
The PR is a draft stacked on PR #28 with the responsive and live-access checks stated as outstanding.
