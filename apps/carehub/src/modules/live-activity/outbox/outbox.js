import { backoffMs } from './backoff'
import { classifyFailure } from './failureClass'
import { OutboxStoreError } from './outboxStore'

// The queue of reports written without a connection. It sends them with the same idempotent
// logActivity the page uses, so a report that was in fact already saved cannot be saved twice.
//
//   enqueue({ activity, viewers, voiceBlob })  keep a report on this device (rejects if it cannot be kept)
//   flush()                                    send what is due; never rejects, returns a summary
//   list() / retry(id) / discard(id)           what the person sees and can do
//   purgeAll()                                 empty the queue for everyone (sign-out)
//   subscribe(fn) -> stop                      fn() is called after every change
//   start(env?) -> stop                        flush now, on 'online', when the tab becomes visible, every 60 s
//
// Only the signed-in person's own reports (getScope() -> { businessId, staffId } or null) are listed or sent.
// A transient failure stops the round (the next report would fail the same way) and waits 2 s, 4 s ... 5 min.
// A refusal or a malformed request is parked as 'failed_permanent' for the person to read; it is never
// retried by itself. Background Sync is not used: it exists only in Chromium browsers.

const LOCK_NAME = 'carehub-outbox-flush'
export const FLUSH_INTERVAL_MS = 60000

const messageOf = (e) => String(e && e.message ? e.message : e)

export function createOutbox({
  store,
  repository,
  now = Date.now,
  getScope,
  locks = typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null,
}) {
  const listeners = new Set()
  let inFlight = null

  const notify = () => { listeners.forEach((fn) => { try { fn() } catch (e) { /* a listener must not break the queue */ } }) }
  const scopeNow = () => {
    const s = getScope ? getScope() : null
    return s && s.businessId ? s : null
  }

  async function sendOne(entry) {
    let voiceUrl = entry.voiceUrl
    if (entry.voiceBlob && !voiceUrl) {
      voiceUrl = await repository.uploadActivityVoice(entry.voiceBlob, { businessId: entry.businessId, activityId: entry.id })
      await store.update(entry.id, { voiceUrl })   // a later failure must not upload the recording again
    }
    const activity = voiceUrl ? { ...entry.activity, voice_url: voiceUrl } : entry.activity
    await repository.logActivity(activity, entry.viewers || [])
  }

  async function round() {
    const summary = { sent: 0, permanent: 0, retrying: 0, error: null }
    const scope = scopeNow()
    if (!scope) return summary
    const due = (await store.list(scope)).filter((e) => e.state === 'pending' && (e.nextAttemptAt || 0) <= now())
    for (const entry of due) {
      try {
        await sendOne(entry)
        await store.remove(entry.id)
        summary.sent++
      } catch (e) {
        if (e instanceof OutboxStoreError) throw e
        if (classifyFailure(e) === 'permanent') {
          await store.update(entry.id, { state: 'failed_permanent', lastError: messageOf(e) })
          summary.permanent++
        } else {
          await store.update(entry.id, { attempts: entry.attempts + 1, nextAttemptAt: now() + backoffMs(entry.attempts), lastError: messageOf(e) })
          summary.retrying++
          break
        }
      }
      notify()
    }
    return summary
  }

  function flush() {
    if (inFlight) return inFlight
    const run = locks
      ? locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => (lock ? round() : { sent: 0, permanent: 0, retrying: 0, error: null }))
      : round()
    inFlight = Promise.resolve(run)
      .catch((e) => ({ sent: 0, permanent: 0, retrying: 0, error: messageOf(e) }))
      .finally(() => { inFlight = null; notify() })
    return inFlight
  }

  const api = {
    async enqueue({ activity, viewers = [], voiceBlob = null }) {
      const scope = scopeNow()
      if (!scope) throw new OutboxStoreError('invalid', 'Not signed in')
      const existing = activity && activity.id ? await store.get(activity.id) : null
      if (existing) return existing
      const entry = {
        id: activity && activity.id, businessId: scope.businessId, staffId: scope.staffId || null,
        activity, viewers, voiceBlob, voiceUrl: null,
        state: 'pending', attempts: 0, nextAttemptAt: 0, lastError: null, createdAt: now(),
      }
      await store.put(entry)
      notify()
      return entry
    },
    flush,
    async list() {
      const scope = scopeNow()
      return scope ? store.list(scope) : []
    },
    async retry(id) {
      await store.update(id, { state: 'pending', attempts: 0, nextAttemptAt: 0, lastError: null })
      notify()
      return flush()
    },
    async discard(id) {
      await store.remove(id)
      notify()
    },
    async purgeAll() {
      await store.clearAll()
      notify()
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    start(env = {}) {
      const win = 'window' in env ? env.window : (typeof window !== 'undefined' ? window : null)
      const doc = 'document' in env ? env.document : (typeof document !== 'undefined' ? document : null)
      const setTimer = env.setInterval || globalThis.setInterval
      const clearTimer = env.clearInterval || globalThis.clearInterval
      const kick = () => { api.flush() }
      const onVisible = () => { if (doc && doc.visibilityState === 'visible') kick() }
      if (win) win.addEventListener('online', kick)
      if (doc) doc.addEventListener('visibilitychange', onVisible)
      const timer = setTimer(kick, FLUSH_INTERVAL_MS)
      kick()
      return function stop() {
        if (win) win.removeEventListener('online', kick)
        if (doc) doc.removeEventListener('visibilitychange', onVisible)
        clearTimer(timer)
      }
    },
  }
  return api
}
