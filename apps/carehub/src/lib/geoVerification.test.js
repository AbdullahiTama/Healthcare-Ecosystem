import { describe, it, expect } from 'vitest'
import { facilityVerification, FACILITY_VERIFICATION, FACILITY_VERIFY_THRESHOLD_M } from './geo'

// facilityVerification judges a logged position against the chosen facility, now with the GPS accuracy
// taken into account: a poor fix cannot confirm a match, and cannot prove the rep was elsewhere either.
const T = FACILITY_VERIFY_THRESHOLD_M
const facility = { lat: 6.5, lng: 3.3 }
// ~111,320 m per degree of latitude: shift the fix north by `m` metres.
const gpsAt = (m) => ({ lat: facility.lat + m / 111320, lng: facility.lng })

describe('facilityVerification with accuracy', () => {
  it.each([
    ['close, accuracy unknown', T - 20, null, 'verified'],
    ['close, accuracy exactly the low-accuracy limit (100 m)', T - 20, 100, 'verified'],
    ['close, accuracy just over the limit (101 m)', T - 20, 101, 'uncertain'],
    ['a little past the threshold, accuracy 101 m reaches it', T + 50, 101, 'uncertain'],
    ['far past threshold plus accuracy', T + 500, 101, 'unverified'],
    ['close but accuracy is 5000 m', T - 20, 5000, 'uncertain'],
    ['past the threshold with a good fix (50 m)', T + 50, 50, 'unverified'],
    ['accuracy 0 is a known, perfect fix', T - 20, 0, 'verified'],
    ['accuracy NaN counts as unknown', T - 20, NaN, 'verified'],
  ])('%s -> %s', (_name, distanceM, accuracyM, expected) => {
    expect(facilityVerification(gpsAt(distanceM), facility, T, accuracyM)).toBe(expected)
  })

  it('a poor fix is never reported as verified, whatever its size', () => {
    for (const a of [101, 250, 1000, 5000, 1e6]) {
      expect(facilityVerification(gpsAt(0), facility, T, a)).not.toBe(FACILITY_VERIFICATION.VERIFIED)
    }
  })

  it('a rep-added place awaiting review stays pending, accuracy or not', () => {
    expect(facilityVerification(gpsAt(0), { ...facility, pendingReview: true }, T, 5000)).toBe('pending')
  })

  it('no GPS or no facility reads as unverified and does not throw', () => {
    expect(facilityVerification(null, facility, T, 300)).toBe('unverified')
    expect(facilityVerification(gpsAt(0), null, T, 300)).toBe('unverified')
  })

  it('the three-argument call that existing callers make is unchanged', () => {
    expect(facilityVerification(gpsAt(T - 20), facility)).toBe('verified')
    expect(facilityVerification(gpsAt(T + 50), facility)).toBe('unverified')
  })

  it('exposes the new state as a constant', () => {
    expect(FACILITY_VERIFICATION.UNCERTAIN).toBe('uncertain')
  })
})
