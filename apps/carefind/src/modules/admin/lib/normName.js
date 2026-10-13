// The server's rule for role names (create_admin_role): trimmed, lower-cased,
// runs of whitespace to one underscore. Used wherever the console compares or
// refuses a role name (notably to keep super_admin out of every choice).
export const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, '_')
