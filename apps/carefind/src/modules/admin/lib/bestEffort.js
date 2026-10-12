// Runs a follow-up that must not change an outcome the server already decided
// (refreshing the lists, a success toast). A failure is logged, never thrown, so
// an action that committed on the server is never reported to the admin as
// failed.
export function bestEffort(label, fn) {
  try {
    fn()
  } catch (err) {
    console.error(`[admin] ${label} failed after the server call:`, err?.message ?? err)
  }
}
