import { describe, it, expect } from 'vitest'
import { areaLabel, targetLabel, facilityName, facilitySourceLabel } from './activityTarget'

describe('targetLabel: one answer for the feed, table and export', () => {
  it('a directory business is its snapshot name', () => {
    expect(targetLabel({ directory_business_name: 'Allen Pharmacy' })).toBe('Allen Pharmacy')
  })
  it('a facility is its name, falling back to the legacy place_of_visit', () => {
    expect(targetLabel({ facility_name: 'Lagos General' })).toBe('Lagos General')
    expect(targetLabel({ place_of_visit: 'Old Clinic' })).toBe('Old Clinic')
    expect(facilityName({ place_of_visit: 'Old Clinic' })).toBe('Old Clinic')
  })
  it('an older report carrying both shows both, once each', () => {
    expect(targetLabel({ directory_business_name: 'Allen Pharmacy', facility_name: 'Lagos General' })).toBe('Allen Pharmacy / Lagos General')
    expect(targetLabel({ directory_business_name: 'Same Place', facility_name: 'same place' })).toBe('Same Place')
  })
  it('with no target, the area caption is shown as an area, never as the place visited', () => {
    expect(targetLabel({ location_label: 'Allen Avenue, Ikeja' })).toBe('Near Allen Avenue, Ikeja')
  })
  it('nothing recorded is empty, not invented', () => {
    expect(targetLabel({})).toBe('')
    expect(targetLabel({ location_label: '  ' })).toBe('')
  })
})

describe('areaLabel', () => {
  it('drops a caption that only repeats the target name (how older rows were written)', () => {
    expect(areaLabel({ location_label: 'Lagos General', facility_name: 'Lagos General' })).toBe('')
    expect(areaLabel({ location_label: 'allen pharmacy', directory_business_name: 'Allen Pharmacy' })).toBe('')
  })
  it('keeps a genuine area description', () => {
    expect(areaLabel({ location_label: 'Ikeja', facility_name: 'Lagos General' })).toBe('Ikeja')
  })
})

describe('facilitySourceLabel', () => {
  it('uses plain words and defaults to map data', () => {
    expect(facilitySourceLabel('detected')).toBe('Map data')
    expect(facilitySourceLabel('rep_added')).toBe('Added by a colleague')
    expect(facilitySourceLabel(undefined)).toBe('Map data')
  })
})
