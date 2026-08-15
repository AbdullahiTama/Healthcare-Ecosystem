// ── Database error translation ────────────────────────────────────────────────
// Some deletes are meant to fail. A row that other rows still point at is
// protected by a foreign key with no cascade, and the database refusing to
// remove it is the correct answer — the record is still in use. What was wrong
// was the answer reaching the user verbatim:
//
//   Delete failed: Supabase error (409): update or delete on table
//   "enterprise_locations" violates foreign key constraint
//   "stock_batches_location_id_fkey" on table "stock_batches"
//
// `translateConstraintError` maps that to something actionable.
//
// Matching on the CONSTRAINT NAME, not the violation's prose: constraint names
// are stable schema objects, while the wording of a Postgres error is a
// server-version detail nobody should depend on. `sbFetch` collapses the
// PostgREST error body down to its `message` string, which is where the
// constraint name survives.
//
// Anything unrecognised is returned untouched. A repository must never flatten
// a network failure into a confident, wrong explanation that a record is in
// use — that would be a worse bug than the raw message it replaces.

/**
 * @param subject  what the user tried to delete, for the message ("Ikeja Warehouse")
 * @param error    the error thrown by the transport
 * @param blockers [constraintName, reason] pairs, most specific first
 * @returns a friendlier Error, or the original if nothing matched
 */
export function translateConstraintError(subject, error, blockers) {
  const raw = error?.message || ''
  for (const [constraint, reason] of blockers) {
    if (raw.includes(constraint)) return new Error(`"${subject}" ${reason}`)
  }
  return error
}

// ── Duplicate-key recognition ─────────────────────────────────────────────────
// A partial UNIQUE index (clients_phone_unique_per_business, the dispense_ref
// guard on sales) surfaces through sbFetch as a PostgREST 409 whose message
// carries Postgres' "duplicate key value violates unique constraint". That
// shape means "this exact row already exists", which some callers treat as
// success-with-existing (a retried dispense is not an error — it must not
// double-dispense). Anything else (5xx, network) stays a genuine failure.
export function isDuplicateError(e) {
  return e && typeof e.message === 'string' &&
    (/Supabase error \(409\)/.test(e.message) || /duplicate key value violates unique constraint/i.test(e.message))
}
