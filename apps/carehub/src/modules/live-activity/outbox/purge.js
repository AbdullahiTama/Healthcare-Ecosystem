import { createOutboxStore } from './outboxStore'

// Takes every unsent offline report off this device. Called when a person deliberately signs out, so a
// shared phone does not keep the previous person's reports. Kept apart from the outbox itself so the app
// shell can call it without loading the repository and network layer. Never throws: sign-out must go ahead
// even when the browser's storage is unusable; the result says whether the queue was emptied.
export async function purgeUnsentReports(store = createOutboxStore()) {
  try {
    await store.clearAll()
    return true
  } catch (e) {
    return false
  }
}
