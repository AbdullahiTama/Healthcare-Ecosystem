import { describe, it, expect } from 'vitest'
import { generateCalendarUrl } from '../calendar.js'

describe('generateCalendarUrl', () => {
  it('returns null if no scheduled_at', () => {
    const result = generateCalendarUrl({ title: 'Test' })
    expect(result).toBeNull()
  })

  it('generates Google Calendar URL', () => {
    const show = {
      title: 'Test Live',
      scheduled_at: '2026-09-15T14:00:00Z',
      description: 'A test live show',
      host_name: 'John Doe',
    }
    const result = generateCalendarUrl(show)
    expect(result).not.toBeNull()
    expect(result.gcalUrl).toContain('google.com/calendar')
    expect(result.gcalUrl).toContain('Test')
    expect(result.gcalUrl).toContain('Live')
    expect(result.gcalUrl).toContain('action=TEMPLATE')
  })

  it('generates ICS content', () => {
    const show = {
      title: 'Test Live',
      scheduled_at: '2026-09-15T14:00:00Z',
      description: 'A test live show',
    }
    const result = generateCalendarUrl(show)
    expect(result).not.toBeNull()
    expect(result.icsContent).toContain('BEGIN:VCALENDAR')
    expect(result.icsContent).toContain('SUMMARY:Test Live')
    expect(result.icsContent).toContain('END:VCALENDAR')
  })

  it('uses default title if not provided', () => {
    const show = {
      scheduled_at: '2026-09-15T14:00:00Z',
    }
    const result = generateCalendarUrl(show)
    expect(result.gcalUrl).toContain('CareFind')
    expect(result.icsContent).toContain('SUMMARY:CareFind Live')
  })
})
