import { describe, it, expect } from 'vitest'
import { DEFAULT_REPORT_FIELDS, DEFAULT_SUMMARY_FIELD_ID, effectiveFields, fieldLabel, missingRequired } from './reportFields'

const custom = [{ id: 'f1', label: 'Customer', required: true }, { id: 'f2', label: 'Outcome', required: false }]

describe('effectiveFields', () => {
  it('uses the business\'s own fields when it has any', () => {
    expect(effectiveFields(custom)).toBe(custom)
  })
  it('falls back to one required note when it has none, so a first report is possible', () => {
    for (const none of [[], null, undefined]) {
      const f = effectiveFields(none)
      expect(f).toBe(DEFAULT_REPORT_FIELDS)
      expect(f).toHaveLength(1)
      expect(f[0].required).toBe(true)
    }
  })
})

describe('fieldLabel', () => {
  it('finds custom labels and the built-in note, and nothing else', () => {
    expect(fieldLabel(custom, 'f2')).toBe('Outcome')
    expect(fieldLabel(custom, DEFAULT_SUMMARY_FIELD_ID)).toBe('What happened') // notes made before fields were set up still read
    expect(fieldLabel(custom, 'gone')).toBeNull()
  })
})

describe('missingRequired', () => {
  it('names empty required fields; whitespace counts as empty; optional ones never block', () => {
    expect(missingRequired(custom, {})).toEqual(['Customer'])
    expect(missingRequired(custom, { f1: '   ' })).toEqual(['Customer'])
    expect(missingRequired(custom, { f1: 'Allen' })).toEqual([])
  })
  it('a number of 0 is a real answer, not empty', () => {
    expect(missingRequired([{ id: 'n', label: 'Units', required: true }], { n: 0 })).toEqual([])
    expect(missingRequired([{ id: 'n', label: 'Units', required: true }], { n: '0' })).toEqual([])
  })
})
