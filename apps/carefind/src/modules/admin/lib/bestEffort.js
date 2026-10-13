// Runs a follow-up that must not change an outcome the server already decided
// (refreshing the lists, a success toast). A failure is logged, never thrown, so
// an action that committed on the server is never reported to the admin as
// failed. When the follow-up is async the returned promise settles once it has
// (never rejects), so a caller may await it; sync callers can ignore it.
export function bestEffort(label, fn) {
  const log = (err) => console.error(`[admin] ${label} failed after the server call:`, err?.message ?? err)
  try {
    const out = fn()
    if (out && typeof out.then === 'function') return out.then(undefined, log)
  } catch (err) {
    log(err)
  }
  return Promise.resolve()
}
