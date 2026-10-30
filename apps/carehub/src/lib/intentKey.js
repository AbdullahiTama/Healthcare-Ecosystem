// A key naming one user intent (one restock dialog, one "Update Existing
// Product" warning, one stock count worksheet) for a write that is idempotent
// on it (receive_stock, save_stock_validation_session): the same intent retried
// is recognised and not applied twice.
export function intentKey(prefix) {
  const rand = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  return prefix + ':' + rand
}
