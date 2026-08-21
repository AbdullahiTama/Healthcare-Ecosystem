import { describe, it, expect } from 'vitest'
import { parseTerritoryCsv, resolveTerritoryUpload } from './territoryImport.js'

const HEADER = 'Territory Name,Level,Sits Under (name)'

describe('parseTerritoryCsv', () => {
  it('parses name, level and parent name positionally', () => {
    const csv = HEADER + '\n"Lagos Region","Region","Nigeria South"\n"Ikeja","LGA","Lagos Region"'
    const { rows, error } = parseTerritoryCsv(csv)
    expect(error).toBeNull()
    expect(rows).toEqual([
      { name: 'Lagos Region', level: 'Region', parent_name: 'Nigeria South' },
      { name: 'Ikeja', level: 'LGA', parent_name: 'Lagos Region' },
    ])
  })

  it('treats level and parent as optional', () => {
    const csv = HEADER + '\n"Abuja Central"'
    const { rows } = parseTerritoryCsv(csv)
    expect(rows[0]).toEqual({ name: 'Abuja Central', level: '', parent_name: '' })
  })

  it('skips rows without a name and errors when nothing valid remains', () => {
    const empty = parseTerritoryCsv('')
    expect(empty.rows).toHaveLength(0)
    expect(empty.error).toBe('File is empty or has no territories.')

    const headerOnly = parseTerritoryCsv(HEADER + '\n,"Region","Parent"')
    expect(headerOnly.rows).toHaveLength(0)
    expect(headerOnly.error).toBe('No valid territories found.')
  })
})

describe('resolveTerritoryUpload', () => {
  const existing = [
    { id: 't1', name: 'Nigeria South', level: 'Region' },
    { id: 't2', name: 'Lagos Region', level: 'Region' },
  ]

  it('resolves parent names case-insensitively to existing territory ids', () => {
    const { fresh } = resolveTerritoryUpload(
      [{ name: 'Ikeja', level: 'LGA', parent_name: 'lagos region' }],
      existing,
    )
    expect(fresh).toEqual([{ name: 'Ikeja', level: 'LGA', parent_territory_id: 't2' }])
  })

  it('skips names that already exist, case-insensitively, and dedupes within the file', () => {
    const { fresh, skipped } = resolveTerritoryUpload(
      [
        { name: 'LAGOS REGION', level: '', parent_name: '' },
        { name: 'Ibadan', level: '', parent_name: '' },
        { name: 'ibadan', level: '', parent_name: '' },
      ],
      existing,
    )
    expect(fresh.map(r => r.name)).toEqual(['Ibadan'])
    expect(skipped).toEqual(['LAGOS REGION', 'ibadan'])
  })

  it('counts rows whose parent does not exist yet instead of guessing an id', () => {
    // The parent is in the same file but not yet in the database; parallel
    // batch inserts give no ordering guarantee, so the row must NOT point at
    // a row that may not exist. It imports as top-level and the count is
    // surfaced so the preview can say so.
    const { fresh, unresolvedParents } = resolveTerritoryUpload(
      [{ name: 'Ikeja', level: 'LGA', parent_name: 'Lagos Region' }],
      [],
    )
    expect(fresh[0].parent_territory_id).toBeNull()
    expect(unresolvedParents).toBe(1)
  })

  it('reports rows without a name as invalid with their file position', () => {
    const { fresh, invalid } = resolveTerritoryUpload(
      [{ name: '', level: 'Region', parent_name: '' }],
      existing,
    )
    expect(fresh).toHaveLength(0)
    expect(invalid).toEqual(['row 1'])
  })

  it('nulls blank levels for the nullable column', () => {
    const { fresh } = resolveTerritoryUpload([{ name: 'Kano', level: '', parent_name: '' }], [])
    expect(fresh[0]).toEqual({ name: 'Kano', level: null, parent_territory_id: null })
  })
})
