import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The realtime publication was live-only state until 2026-10-23. The migration that records it must be
// safe to run twice, must never remove anything, and must not touch tables it does not own.
const sql = readFileSync(
  resolve(__dirname, '../../../../../../docs/architecture/pending-migrations/carehub_20261023_realtime_publication.sql'),
  'utf8',
)

describe('realtime publication migration', () => {
  it.each(['field_activities', 'activity_comments', 'activity_reactions', 'staff_notifications'])(
    'covers public.%s',
    (table) => {
      expect(sql).toContain(table)
    },
  )

  it('guards every ADD TABLE with a membership check so a second run changes nothing', () => {
    const adds = sql.match(/ALTER PUBLICATION supabase_realtime ADD TABLE/g) || []
    const guards = sql.match(/pg_publication_tables/g) || []
    expect(adds.length).toBeGreaterThan(0)
    expect(guards.length).toBeGreaterThanOrEqual(adds.length)
  })

  it('never removes anything from the publication or drops an object', () => {
    expect(sql).not.toMatch(/\bDROP\b/i)
    expect(sql).not.toMatch(/DROP TABLE/i)
  })

  it('does not touch the unrelated Inventory table', () => {
    expect(sql).not.toMatch(/Inventory/)
  })

  it('ends with a check that raises if a table is missing from the publication', () => {
    expect(sql).toMatch(/RAISE EXCEPTION/)
  })
})
