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
    const { creates, parentLinks } = resolveTerritoryUpload(
      [{ name: 'Ikeja', level: 'LGA', parent_name: 'lagos region' }],
      existing,
    )
    expect(creates).toEqual([{ name: 'Ikeja', level: 'LGA', parent_territory_id: 't2' }])
    expect(parentLinks).toEqual([])
  })

  it('defers a child whose parent is defined later in the same file (two-pass)', () => {
    // Parallel batch inserts give no ordering guarantee, so the child inserts
    // with a null parent first; the link is patched once every row exists.
    const { creates, parentLinks, failed } = resolveTerritoryUpload(
      [
        { name: 'Ikeja', level: 'LGA', parent_name: 'Lagos Region' },
        { name: 'Lagos Region', level: 'Region', parent_name: '' },
      ],
      [],
    )
    expect(creates).toEqual([
      { name: 'Ikeja', level: 'LGA', parent_territory_id: null },
      { name: 'Lagos Region', level: 'Region', parent_territory_id: null },
    ])
    expect(parentLinks).toEqual([{ name: 'Ikeja', parent_name: 'Lagos Region' }])
    expect(failed).toEqual([])
  })

  it('fails rows whose parent exists nowhere with a reason', () => {
    const { creates, parentLinks, failed } = resolveTerritoryUpload(
      [{ name: 'Ikeja', level: 'LGA', parent_name: 'Atlantis' }],
      existing,
    )
    expect(creates).toHaveLength(0)
    expect(parentLinks).toEqual([])
    expect(failed).toHaveLength(1)
    expect(failed[0].name).toBe('Ikeja')
    expect(failed[0].reason).toMatch(/unknown parent/i)
    expect(failed[0].reason).toContain('Atlantis')
  })

  it('fails every row in a parent cycle instead of guessing an order', () => {
    const { creates, parentLinks, failed } = resolveTerritoryUpload(
      [
        { name: 'Area A', level: '', parent_name: 'Area B' },
        { name: 'Area B', level: '', parent_name: 'Area A' },
      ],
      [],
    )
    expect(creates).toEqual([])
    expect(parentLinks).toEqual([])
    expect(failed.map(f => f.name).sort()).toEqual(['Area A', 'Area B'])
    for (const f of failed) expect(f.reason).toMatch(/circular/i)
  })

  it('fails rows hanging off a cycle — they can never resolve either', () => {
    const { parentLinks, failed } = resolveTerritoryUpload(
      [
        { name: 'Area A', level: '', parent_name: 'Area B' },
        { name: 'Area B', level: '', parent_name: 'Area A' },
        { name: 'Depot', level: '', parent_name: 'Area A' },
      ],
      [],
    )
    expect(parentLinks).toEqual([])
    expect(failed.map(f => f.name).sort()).toEqual(['Area A', 'Area B', 'Depot'])
  })

  it('chains multi-level in-file hierarchies onto their file-created parents', () => {
    const { creates, parentLinks } = resolveTerritoryUpload(
      [
        { name: 'Region R', level: 'Region', parent_name: '' },
        { name: 'State S', level: 'State', parent_name: 'Region R' },
        { name: 'LGA L', level: 'LGA', parent_name: 'State S' },
      ],
      [],
    )
    expect(creates).toHaveLength(3)
    expect(parentLinks).toEqual([
      { name: 'State S', parent_name: 'Region R' },
      { name: 'LGA L', parent_name: 'State S' },
    ])
  })

  it('skips names that already exist, case-insensitively, and dedupes within the file', () => {
    const { creates, skipped } = resolveTerritoryUpload(
      [
        { name: 'LAGOS REGION', level: '', parent_name: '' },
        { name: 'Ibadan', level: '', parent_name: '' },
        { name: 'ibadan', level: '', parent_name: '' },
      ],
      existing,
    )
    expect(creates.map(r => r.name)).toEqual(['Ibadan'])
    expect(skipped).toEqual(['LAGOS REGION', 'ibadan'])
  })

  it('reports rows without a name as invalid with their file position', () => {
    const { creates, invalid } = resolveTerritoryUpload(
      [{ name: '', level: 'Region', parent_name: '' }],
      existing,
    )
    expect(creates).toHaveLength(0)
    expect(invalid).toEqual(['row 1'])
  })

  it('nulls blank levels for the nullable column', () => {
    const { creates } = resolveTerritoryUpload([{ name: 'Kano', level: '', parent_name: '' }], [])
    expect(creates[0]).toEqual({ name: 'Kano', level: null, parent_territory_id: null })
  })
})
