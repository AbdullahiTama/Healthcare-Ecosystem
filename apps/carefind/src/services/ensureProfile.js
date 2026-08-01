import { supabase } from '../config/supabaseClient'

// fk_posts_user (and the sibling user_id FKs added in the same migration)
// reference profiles(id), not auth.users(id). Accounts created before the
// on_auth_user_created trigger existed, or whose profile row was deleted,
// have no profiles row, so the first content insert fails with
// "insert or update on table posts violates foreign key constraint
// fk_posts_user". Ensures the row exists (upsert that never overwrites
// existing profile data) before any content insert. The SQL migration
// backfills existing users and installs the trigger going forward; this is
// the code-level safety net that works even before that migration runs.
export async function ensureProfile(user) {
  if (!user) return false
  const { error } = await supabase.from('profiles').upsert(
    { id: user.id, display_name: user.email ? user.email.split('@')[0] : '' },
    { onConflict: 'id', ignoreDuplicates: true }
  )
  if (error) console.error('ensureProfile:', error.message)
  return !error
}
