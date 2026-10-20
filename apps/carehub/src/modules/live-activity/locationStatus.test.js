import { describe, it, expect } from 'vitest'
import { describeReportLocation, describeArea, REPORT_GPS_MESSAGES } from './locationStatus'

describe('describeReportLocation', () => {
  it('each way location can fail has its own advice', () => {
    const texts = ['denied', 'unavailable', 'timeout', 'unsupported', 'invalid']
      .map((reason) => describeReportLocation({ issue: { reason } }).text)
    expect(new Set(texts).size).toBe(5)
    expect(describeReportLocation({ issue: { reason: 'denied' } }).text).toContain('browser settings')
    expect(describeReportLocation({ issue: { reason: 'timeout' } }).text).toContain('too long')
    expect(describeReportLocation({ issue: { reason: 'unsupported' } }).text).toContain('cannot share a location')
  })

  it('every failure says the report can still be logged', () => {
    for (const msg of Object.values(REPORT_GPS_MESSAGES)) expect(msg).toMatch(/log this report|still log/)
  })

  it('offers a retry for everything but an unsupported browser', () => {
    expect(describeReportLocation({ issue: { reason: 'denied' } }).canRetry).toBe(true)
    expect(describeReportLocation({ issue: { reason: 'timeout' } }).canRetry).toBe(true)
    expect(describeReportLocation({ issue: { reason: 'unsupported' } }).canRetry).toBe(false)
  })

  it('an unknown reason is treated as "could not be determined", not as success', () => {
    const d = describeReportLocation({ issue: { reason: 'something-new' } })
    expect(d.tone).toBe('warn')
    expect(d.text).toBe(REPORT_GPS_MESSAGES.unavailable)
  })

  it('a good fix says how accurate it is and raises no warning', () => {
    const d = describeReportLocation({ gps: { lat: 6.5, lng: 3.4, accuracy: 18 } })
    expect(d).toMatchObject({ tone: 'ok', text: 'Position captured, accurate to about 18 m', note: '', canRetry: false })
  })

  it('a poor fix warns that suggestions may be wrong and offers a retry', () => {
    const d = describeReportLocation({ gps: { lat: 6.5, lng: 3.4, accuracy: 850 } })
    expect(d.tone).toBe('ok')
    expect(d.text).toContain('about 850 m')
    expect(d.note).toContain('accuracy is poor')
    expect(d.canRetry).toBe(true)
  })

  it('an unknown accuracy is said to be unknown and treated as poor, never as good', () => {
    const d = describeReportLocation({ gps: { lat: 6.5, lng: 3.4, accuracy: null } })
    expect(d.text).toContain('accuracy unknown')
    expect(d.note).not.toBe('')
  })

  it('while finding, nothing else is claimed', () => {
    expect(describeReportLocation({ finding: true, gps: { lat: 1, lng: 1 }, issue: { reason: 'denied' } }).tone).toBe('busy')
  })
})

describe('describeArea', () => {
  it('has a line for each outcome, and says nothing before a lookup starts', () => {
    expect(describeArea(null)).toBe('')
    expect(describeArea({ status: 'idle' })).toBe('')
    expect(describeArea({ status: 'looking' })).toContain('Looking up')
    expect(describeArea({ status: 'ok', label: 'Allen Avenue, Ikeja' })).toBe('Area: Allen Avenue, Ikeja')
    expect(describeArea({ status: 'no_result' })).toContain('No area name')
  })
  it('a failed lookup is not described as "no name here"', () => {
    expect(describeArea({ status: 'failed' })).toContain('could not be looked up')
    expect(describeArea({ status: 'failed' })).not.toContain('No area name')
  })
})
